"""需求对话上下文压缩（滚动摘要）—— 纯函数 + 压缩执行。

分层（章程 II）：本模块为业务层，线程读写一律经 ``services.thread_store``（该领域唯一
存储出口），不 import routers，也不直接读写文件。

设计约束（2026-11-20 定稿）：
1. ``thread["messages"]`` **永不改写**——它是 ``/export``、``/validate`` 的
   ``selected_indices`` 索引基准，删元素会让导出/校验静默错位。压缩只产出「prompt 视图」，
   原文全量留在磁盘。
2. 触发：未压轮数 > 70 或 估算 tokens（system + 摘要 + 未压原文）≥ 200K。
3. 轮数触发保留最近 40 轮（稳态每次归档约 30 轮）；token 触发按 40K tokens 反推保留窗口，
   且不少于 8 轮（触底保护，防模型对当前讨论"断片"）。
4. 摘要 ≤ 2000 tokens，由调用方拼进 system prompt 末尾；``digest`` 只增不减，抵抗多次
   摘要累积后的要素漂移。
5. 任何失败（超时 / JSON 非法 / 保真校验不过 / 写盘异常）一律不推进 ``covered_until``，
   调用方退回窗口截断——不阻塞对话，也不丢内容。
"""

import logging
import re
from datetime import datetime, timezone
from functools import lru_cache

from config import (
    ANALYSIS_SYSTEM_PROMPT,
    CONTEXT_KEEP_ROUNDS,
    CONTEXT_KEEP_TOKENS,
    CONTEXT_MIN_KEEP_ROUNDS,
    CONTEXT_SINGLE_MSG_MAX_TOKENS,
    CONTEXT_SUMMARY_MAX_TOKENS,
    CONTEXT_SUMMARY_PROMPT_TEMPLATE,
    CONTEXT_SUMMARY_SOURCE_MAX_TOKENS,
    CONTEXT_SUMMARY_SYSTEM_PROMPT,
    CONTEXT_TRIGGER_ROUNDS,
    CONTEXT_TRIGGER_TOKENS,
    GRILLING_PROMPT,
    LLM_MAX_TOKENS_SUMMARY,
    LLM_TIMEOUT_SUMMARY,
)
from llm_utils import llm_json, llm_text
from services import thread_store

logger = logging.getLogger(__name__)

# 现网会把 LLM 异常文本当作 assistant 内容落盘（历史数据里已存在），归档时必须剔除
_ERROR_PREFIX = "[调用出错"
_ARCHIVED_MARK = "…（该条过长，已截断发送；完整内容见对话记录）"

# 摘要按小节保留的必须项：超长时二次压缩只允许压缩叙述，不允许删这两节
_PROTECTED_SECTIONS = ("【规则与约束】", "【已否决方案】")

_NUMBER_RE = re.compile(r"\d+(?:\.\d+)?%?")
_QUOTED_RE = re.compile(r"[「『“\"《]([^」』”\"》]{2,20})[」』”\"》]")
_CONSTRAINT_WORDS = ("只能", "必须", "不得", "不允许", "至少", "至多", "最多")

_DIGEST_KEYS_BY_NAME = ("concepts", "concept_relations", "functions", "behaviors", "rules", "processes")
_DIGEST_KEYS_APPEND = ("rejected",)
_DIGEST_KEYS_REPLACE = ("open_questions",)


# ─── token 估算 ──────────────────────────────────────────────────────────────

def estimate_tokens(text: str) -> int:
    """本地 token 估算（不引 tiktoken，章程 ⑥ 依赖治理）。

    中文 1 字 ≈ 1 token，其余字符 4 字符 ≈ 1 token；对中文为主的对话误差约 ±15%，
    配合 200K 这种量级阈值足够。
    """
    if not text:
        return 0
    cjk = 0
    for ch in text:
        if "\u4e00" <= ch <= "\u9fff":
            cjk += 1
    return cjk + (len(text) - cjk + 3) // 4


def estimate_messages_tokens(messages: list[dict]) -> int:
    return sum(estimate_tokens(str(m.get("content") or "")) for m in messages)


def truncate_to_tokens(text: str, max_tokens: int) -> str:
    """按估算 token 截断文本（二分，保持前缀完整）。"""
    if max_tokens <= 0:
        return ""
    if estimate_tokens(text) <= max_tokens:
        return text
    lo, hi = 0, len(text)
    while lo < hi:
        mid = (lo + hi + 1) // 2
        if estimate_tokens(text[:mid]) <= max_tokens:
            lo = mid
        else:
            hi = mid - 1
    return text[:lo]


@lru_cache(maxsize=1)
def _system_prompt_tokens() -> int:
    """system 固定开销（按拷问模式开启的较坏情况估，宁可提前触发）。"""
    return estimate_tokens(ANALYSIS_SYSTEM_PROMPT) + estimate_tokens(GRILLING_PROMPT)


# ─── 消息与轮次 ──────────────────────────────────────────────────────────────

def is_error_message(msg: dict) -> bool:
    return msg.get("role") == "assistant" and str(msg.get("content") or "").lstrip().startswith(_ERROR_PREFIX)


def is_usable_message(msg: dict) -> bool:
    """可进入 prompt / 归档原文的消息：非空、且不是历史遗留的报错占位。"""
    if not str(msg.get("content") or "").strip():
        return False
    return not is_error_message(msg)


def round_spans(messages: list[dict], start: int = 0) -> list[tuple[int, int]]:
    """按 user 消息切轮，返回 [(起, 止)) 的绝对下标区间。

    轮次按 user 消息计数（不按 user/assistant 成对）：历史数据里存在空 assistant 与
    报错占位，成对计数会错位。止于下一条 user，因此末尾轮次自然包含尾部消息。
    """
    spans: list[tuple[int, int]] = []
    cur: int | None = None
    for i in range(start, len(messages)):
        msg = messages[i]
        if msg.get("role") == "user" and is_usable_message(msg):
            if cur is not None:
                spans.append((cur, i))
            cur = i
    if cur is not None:
        spans.append((cur, len(messages)))
    return spans


def round_count(messages: list[dict], start: int = 0) -> int:
    return len(round_spans(messages, start))


def _context_of(thread: dict) -> tuple[int, str]:
    """(covered_until, summary)；旧线程无该字段时等价于「未压缩」。"""
    ctx = thread.get("context") or {}
    messages = thread.get("messages") or []
    try:
        covered = int(ctx.get("covered_until") or 0)
    except (TypeError, ValueError):
        covered = 0
    return max(0, min(covered, len(messages))), str(ctx.get("summary") or "")


def first_business_info(messages: list[dict]) -> str:
    """首条 user 消息（业务基线）；过长时截断，避免 system prompt 被打爆。"""
    for msg in messages:
        if msg.get("role") == "user" and str(msg.get("content") or "").strip():
            return truncate_to_tokens(str(msg["content"]).strip(), CONTEXT_SINGLE_MSG_MAX_TOKENS)
    return ""


# ─── 压缩计划 ────────────────────────────────────────────────────────────────

def plan_compaction(thread: dict) -> dict | None:
    """判断是否需要压缩并算出归档区间；无需压缩返回 None（纯函数，无副作用）。

    返回 ``{covered_from, covered_to, keep_rounds, compress_rounds, tokens_before,
    tokens_after, reason}``。``covered_to`` 即压缩后新的 ``covered_until``。
    """
    messages = thread.get("messages") or []
    covered, summary = _context_of(thread)
    spans = round_spans(messages, covered)
    rounds = len(spans)
    if rounds <= CONTEXT_MIN_KEEP_ROUNDS:
        return None

    pending = messages[covered:]
    system_tok = _system_prompt_tokens()
    summary_tok = estimate_tokens(summary)
    total = system_tok + summary_tok + estimate_messages_tokens(pending)

    by_rounds = rounds > CONTEXT_TRIGGER_ROUNDS
    by_tokens = total >= CONTEXT_TRIGGER_TOKENS
    if not (by_rounds or by_tokens):
        return None

    round_tokens = [estimate_messages_tokens(messages[s:e]) for s, e in spans]

    if by_rounds:
        # 轮数规则：保留最近 40 轮，其余归档（71 轮触发时归档 31 轮，稳态 30-31 轮）
        keep = min(CONTEXT_KEEP_ROUNDS, rounds - 1)
    else:
        # token 规则：从最新一轮向前累加到 KEEP_TOKENS，压缩轮次由 token 反推（变量）
        keep = 1
        acc = round_tokens[-1]
        max_keep = min(CONTEXT_KEEP_ROUNDS, rounds - 1)
        while keep < max_keep and acc < CONTEXT_KEEP_TOKENS:
            acc += round_tokens[rounds - keep - 1]
            keep += 1
        keep = max(keep, min(CONTEXT_MIN_KEEP_ROUNDS, rounds - 1))

    # 收敛校验：即便按轮数保留，仍超 token 阈值时继续前移（长消息场景），但不破触底下限
    def _total_with(keep_rounds: int) -> int:
        return system_tok + summary_tok + sum(round_tokens[rounds - keep_rounds:])

    while by_tokens and keep > CONTEXT_MIN_KEEP_ROUNDS and _total_with(keep) >= CONTEXT_TRIGGER_TOKENS:
        keep -= 1

    covered_to = spans[rounds - keep][0]
    if covered_to <= covered:
        return None

    return {
        "covered_from": covered,
        "covered_to": covered_to,
        "keep_rounds": keep,
        "compress_rounds": rounds - keep,
        "rounds_before": rounds,
        "tokens_before": total,
        "tokens_after": _total_with(keep),
        "reason": "rounds" if by_rounds else "tokens",
    }


# ─── prompt 视图 ─────────────────────────────────────────────────────────────

def build_view(thread: dict) -> tuple[list[dict], str]:
    """组装进 prompt 的 (消息视图, 摘要文本)；摘要由调用方拼进 system 末尾。

    视图 = ``messages[covered_until:]`` 去掉空 assistant 与报错占位；单条超限时截断并标注。
    """
    messages = thread.get("messages") or []
    covered, summary = _context_of(thread)
    view: list[dict] = []
    for msg in messages[covered:]:
        if not is_usable_message(msg):
            continue
        content = str(msg.get("content") or "").strip()
        if estimate_tokens(content) > CONTEXT_SINGLE_MSG_MAX_TOKENS:
            content = truncate_to_tokens(content, CONTEXT_SINGLE_MSG_MAX_TOKENS) + _ARCHIVED_MARK
        view.append({"role": msg.get("role"), "content": content})
    return view, summary


def render_dialogue(messages: list[dict]) -> str:
    """把待归档区间渲染成纯文本（供摘要提示词使用）。"""
    parts: list[str] = []
    for msg in messages:
        if not is_usable_message(msg):
            continue
        role = "用户" if msg.get("role") == "user" else "助手"
        parts.append(f"【{role}】{str(msg.get('content')).strip()}")
    return "\n\n".join(parts)


# ─── 保真校验与 digest 合并 ───────────────────────────────────────────────────

def verify_summary(summary: str, source: str, limit: int = 40) -> list[str]:
    """保真校验：原文中的数字 / 引号内专名 / 约束词是否出现在摘要里。

    返回缺失项列表（空 = 通过）。这是本地零成本校验，不调模型。
    """
    if not source:
        return []
    missing: list[str] = []
    for num in dict.fromkeys(_NUMBER_RE.findall(source)):
        if len(num) >= 2 and num not in summary:
            missing.append(num)
    for term in dict.fromkeys(_QUOTED_RE.findall(source)):
        if term not in summary:
            missing.append(term)
    for word in _CONSTRAINT_WORDS:
        if word in source and word not in summary:
            missing.append(word)
    return missing[:limit]


def _item_name(item) -> str:
    if isinstance(item, dict):
        for key in ("name", "title", "id"):
            if item.get(key):
                return str(item[key]).strip()
        return str(sorted(item.items()))[:80]
    return str(item).strip()


def merge_digest(old: dict | None, diff: dict | None) -> dict:
    """确定性合并 digest：按 name 覆盖、已否决只增不删、待确认问题以新为准。

    要素清单是防摘要漂移的锚点，因此**任何情况下都不删除 rejected**。
    """
    base = dict(old or {})
    new = diff if isinstance(diff, dict) else {}

    for key in _DIGEST_KEYS_BY_NAME:
        merged: dict[str, dict] = {}
        order: list[str] = []
        for item in list(base.get(key) or []) + list(new.get(key) or []):
            name = _item_name(item)
            if not name:
                continue
            if name not in merged:
                order.append(name)
                merged[name] = item if isinstance(item, dict) else {"name": name}
                continue
            if isinstance(item, dict):
                cur = dict(merged[name])
                for k, v in item.items():
                    if v not in (None, "", [], {}):
                        cur[k] = v
                merged[name] = cur
        base[key] = [merged[n] for n in order]

    for key in _DIGEST_KEYS_APPEND:
        merged = {_item_name(i): i for i in (base.get(key) or []) if _item_name(i)}
        order = [_item_name(i) for i in (base.get(key) or []) if _item_name(i)]
        for item in new.get(key) or []:
            name = _item_name(item)
            if name and name not in merged:
                order.append(name)
                merged[name] = item
        base[key] = [merged[n] for n in order]

    for key in _DIGEST_KEYS_REPLACE:
        items = new.get(key) or []
        if items:
            base[key] = items

    for key in _DIGEST_KEYS_BY_NAME + _DIGEST_KEYS_APPEND + _DIGEST_KEYS_REPLACE:
        base.setdefault(key, [])
    return base


# ─── 压缩执行（唯一副作用） ──────────────────────────────────────────────────

async def _shrink_summary(summary: str) -> str:
    """摘要超上限时二次压缩：只压叙述，保留【规则与约束】【已否决方案】。"""
    if estimate_tokens(summary) <= CONTEXT_SUMMARY_MAX_TOKENS:
        return summary
    prompt = (
        f"请把下面的摘要压缩到 {CONTEXT_SUMMARY_MAX_TOKENS} tokens 以内。\n"
        f"要求：保留全部 8 个固定小节；{'、'.join(_PROTECTED_SECTIONS)} 中的条目必须逐条保留；"
        "只输出摘要正文，不要 JSON、不要解释。\n\n"
        f"{summary}"
    )
    text, _ = await llm_text(
        CONTEXT_SUMMARY_SYSTEM_PROMPT,
        prompt,
        temperature=0.2,
        max_tokens=LLM_MAX_TOKENS_SUMMARY,
        timeout=LLM_TIMEOUT_SUMMARY,
    )
    if text and estimate_tokens(text) <= CONTEXT_SUMMARY_MAX_TOKENS:
        return text
    return truncate_to_tokens(summary, CONTEXT_SUMMARY_MAX_TOKENS) + _ARCHIVED_MARK


async def compress_thread(thread_id: str, thread: dict, plan: dict) -> dict:
    """执行一次归档压缩并落盘；失败不推进 covered_until（返回 ok=False）。

    调用方负责：压缩结束后重新 ``load_thread``，因为本函数会写盘。
    """
    try:
        source = thread["messages"][plan["covered_from"]:plan["covered_to"]]
        dialogue = render_dialogue(source)
        if not dialogue.strip():
            return {"ok": False, "reason": "待归档区间无可压缩内容"}

        if estimate_tokens(dialogue) > CONTEXT_SUMMARY_SOURCE_MAX_TOKENS:
            dialogue = truncate_to_tokens(dialogue, CONTEXT_SUMMARY_SOURCE_MAX_TOKENS) + _ARCHIVED_MARK

        previous = _context_of(thread)[1]
        missing_note = ""
        payload: tuple[str, dict] | None = None
        for _ in range(2):
            prompt = CONTEXT_SUMMARY_PROMPT_TEMPLATE.format(
                previous_summary=previous or "（无）",
                dialogue=dialogue,
                max_tokens=CONTEXT_SUMMARY_MAX_TOKENS,
                missing_note=missing_note,
            )
            data, _raw = await llm_json(
                CONTEXT_SUMMARY_SYSTEM_PROMPT,
                prompt,
                temperature=0.2,
                max_tokens=LLM_MAX_TOKENS_SUMMARY,
                timeout=LLM_TIMEOUT_SUMMARY,
            )
            if not isinstance(data, dict):
                missing_note = "\n- 上一次输出不是合法 JSON，请只输出 JSON 对象。"
                continue
            summary = str(data.get("summary") or "").strip()
            if not summary:
                missing_note = "\n- 上一次输出的 summary 为空，请重新生成。"
                continue
            missing = verify_summary(summary, dialogue)
            if missing:
                missing_note = "\n- 上一次摘要遗漏了以下原文字段，请补全后再输出：" + "、".join(missing[:20])
                continue
            digest = data.get("digest")
            payload = (summary, digest if isinstance(digest, dict) else {})
            break

        if payload is None:
            logger.warning("需求对话归档失败：摘要生成或保真校验未通过 thread=%s", thread_id)
            return {"ok": False, "reason": "摘要生成失败或保真校验未通过"}

        summary, digest_diff = payload
        summary = await _shrink_summary(summary)

        covered_to = plan["covered_to"]
        archived_rounds = round_count(thread["messages"], 0) - round_count(thread["messages"], covered_to)
        now = datetime.now(timezone.utc).isoformat()
        ctx = dict(thread.get("context") or {})
        history = list(ctx.get("history") or [])
        history.append({"covered_until": covered_to, "archived_rounds": archived_rounds, "at": now})
        thread["context"] = {
            "summary": summary,
            "covered_until": covered_to,
            "summary_tokens": estimate_tokens(summary),
            "archived_rounds": archived_rounds,
            "updated_at": now,
            "history": history[-10:],
        }
        thread["digest"] = merge_digest(thread.get("digest"), digest_diff)
        thread["updated_at"] = now
        thread_store.save_thread(thread)

        logger.info(
            "需求对话归档完成 thread=%s 归档轮数=%s 摘要tokens=%s",
            thread_id, plan.get("compress_rounds"), estimate_tokens(summary),
        )
        return {
            "ok": True,
            "covered_until": covered_to,
            "archived_rounds": archived_rounds,
            "summary_tokens": estimate_tokens(summary),
        }
    except Exception as exc:  # 降级优先：压缩失败不得阻断对话（章程 ⑨）
        logger.warning("需求对话归档异常 thread=%s: %s: %s", thread_id, type(exc).__name__, exc)
        return {"ok": False, "reason": f"{type(exc).__name__}: {exc}"}
