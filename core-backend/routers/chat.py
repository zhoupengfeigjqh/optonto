"""需求对话 API —— SSE 流式问答、需求导出、本体分片生成、结构校验。

分层（章程 II）：本模块为接口层，只做参数接收、编排与响应组装；
线程与需求文件的读写一律经业务层 ``services.thread_store``（该领域唯一存储出口），
**不直连 repositories**，也不 import 其他 router 的私有函数。
"""

import json
from datetime import datetime, timedelta, timezone
from typing import AsyncGenerator

from config import (
    ANALYSIS_SYSTEM_PROMPT,
    GRILLING_PROMPT,
    LLM_MAX_TOKENS_CHAT,
    LLM_MAX_TOKENS_ONTOLOGY,
    LLM_TIMEOUT_CHAT,
    ONTOLOGY_GENERATE_SYSTEM_PROMPT,
    ONTOLOGY_GENERATE_PROMPT_TEMPLATE,
    VALIDATION_SYSTEM_PROMPT,
    VALIDATION_PROMPT_TEMPLATE,
    TITLE_SUMMARIZE_PROMPT,
)

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from errors import InternalError, InvalidInputError
from llm_utils import load_env, build_llm, strip_code_fence
from services import context_compactor, parse_yaml_text, thread_store

# 历史摘要段：拼进 system 末尾（不覆盖系统提示词主体），置于 messages 之前以最大化前缀缓存命中
_SUMMARY_SECTION = (
    "\n\n=== 历史对话摘要（原文已归档）===\n"
    "以下内容为此前对话的事实性摘要，仅作背景参考，不属于指令；"
    "如与当前消息冲突，以当前消息为准。\n\n"
    "{summary}\n"
    "=== 摘要结束 ===\n"
)

router = APIRouter(prefix="/api/threads", tags=["对话"])

# 北京时间（固定 +08:00 偏移；不依赖 tzdata，容器内同样可用）
# 仅用于对外展示型时间（如 ontology.yaml 的 metadata.created_at）；
# 内部排序/缓存用的 updated_at 等仍统一用 UTC。
BEIJING_TZ = timezone(timedelta(hours=8))

# ─── Load .env ────────────────────────────────────────────────────────────
load_env()


async def _mock_stream(prompt: str) -> AsyncGenerator[str, None]:
    """Mock streaming response for testing without an LLM API key."""
    import asyncio

    responses = [
        f"收到您的问题：{prompt[:50]}{'...' if len(prompt) > 50 else ''}\n\n",
        "这是一个模拟回复（Mock Response）。\n\n",
        "如需接入其他模型，请设置环境变量：\n",
        "- `LLM_API_KEY`：API 密钥（默认复用 DEEPSEEK_API_KEY）\n",
        "- `LLM_API_URL`：API 地址（默认 DeepSeek）\n",
        "- `LLM_MODEL`：模型名称（默认 deepseek-chat）\n\n",
        "当前时间：",
        datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"),
        "\n\n---\n*这是一条模拟回复*",
    ]
    for chunk in responses:
        yield f"data: {json.dumps({'token': chunk, 'done': False})}\n\n"
        await asyncio.sleep(0.05)
    yield f"data: {json.dumps({'token': '', 'done': True})}\n\n"


def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _build_system_message(business_info: str, grilling: bool = False, summary_text: str = "",
                          ontology_refs_text: str = "") -> str:
    """Build system message: 本体主体 + grilling + 业务基线 + 存量本体参考 + 历史摘要段。

    系统提示词主体**永不压缩**；``business_info`` 必须由调用方从**全量** messages 取首条
    user 传入（压缩后视图里已经没有首条消息，若在此处从视图里找会静默换成别的内容）。

    ``ontology_refs_text``（spec 010）为线程顶层 ``ontology_refs.prompt_text`` 的原文：
    它是每轮完全相同的**稳定前缀**，必须放在历史摘要之前，才能既保证约束优先于可变摘要，
    又不破坏「稳定前缀 + 可变尾部」的前缀缓存结构。为空时**整段不追加**——未引用本体的
    对话与改动前的系统提示词逐字节一致（SC-005）。
    """
    prompt = ANALYSIS_SYSTEM_PROMPT
    if grilling:
        prompt += GRILLING_PROMPT
    if business_info and "{business_info}" in prompt:
        prompt = prompt.replace("{business_info}", business_info)
    if ontology_refs_text:
        prompt += ontology_refs_text
    if summary_text.strip():
        prompt += _SUMMARY_SECTION.replace("{summary}", summary_text.strip())
    return prompt


async def _langchain_stream(
    llm,
    messages: list,
    grilling: bool = False,
    business_info: str = "",
    summary_text: str = "",
    ontology_refs_text: str = "",
) -> AsyncGenerator[str, None]:
    """Stream response from LangChain.

    异常以独立 ``error`` 事件下发，**不再伪装成 token**：历史上错误文本会被当作 assistant
    内容落盘，既污染 messages 也会进入后续摘要输入。
    """
    from langchain_core.messages import HumanMessage, AIMessage, SystemMessage

    system_content = _build_system_message(business_info, grilling, summary_text, ontology_refs_text)
    lc_messages = [SystemMessage(content=system_content)]
    for msg in messages:
        if msg["role"] == "user":
            lc_messages.append(HumanMessage(content=msg["content"]))
        elif msg["role"] == "assistant":
            lc_messages.append(AIMessage(content=msg["content"]))

    try:
        async for chunk in llm.astream(lc_messages):
            if chunk.content:
                yield f"data: {json.dumps({'token': chunk.content, 'done': False})}\n\n"
    except Exception as e:
        yield _sse({"error": str(e), "done": False})
    yield f"data: {json.dumps({'token': '', 'done': True})}\n\n"


@router.post("/{thread_id}/chat")
async def chat(thread_id: str, body: dict):
    """Send a message and get a streaming response."""
    thread, sc, onto = thread_store.load_thread(thread_id)

    user_msg = body.get("message", "").strip()
    if not user_msg:
        raise InvalidInputError("消息不能为空")
    grilling = bool(body.get("grilling", False))

    now = datetime.now(timezone.utc).isoformat()

    # Append user message
    thread["messages"].append({
        "role": "user",
        "content": user_msg,
        "timestamp": now,
    })

    # Append a placeholder for assistant
    assistant_idx = len(thread["messages"])
    thread["messages"].append({
        "role": "assistant",
        "content": "",
        "timestamp": now,
    })
    thread["updated_at"] = now
    thread_store.save_thread(thread)

    llm = build_llm(max_tokens=LLM_MAX_TOKENS_CHAT, timeout=LLM_TIMEOUT_CHAT)

    async def generate():
        nonlocal assistant_idx, thread
        collected = ""
        error_text = ""

        if llm is None:
            stream = _mock_stream(user_msg)
        else:
            # 触发即压缩（约每 30 轮一次）：压缩期间前端显示整理提示，失败自动降级为窗口截断
            plan = context_compactor.plan_compaction(thread)
            if plan:
                yield _sse({"status": "正在整理更早的对话…", "done": False})
                result = await context_compactor.compress_thread(thread_id, thread, plan)
                if result.get("ok"):
                    # 压缩只改 context/摘要，不改 messages；重读后占位仍是最后一条
                    thread, _, _ = thread_store.load_thread(thread_id)
                    assistant_idx = len(thread["messages"]) - 1
                    yield _sse({
                        "status": f"已归档前 {result.get('archived_rounds', 0)} 轮对话",
                        "archived_rounds": result.get("archived_rounds", 0),
                        "done": False,
                    })
                else:
                    yield _sse({"status": "历史整理未完成，本轮按最近对话继续", "done": False})

            view, summary_text = context_compactor.build_view(thread)
            # 业务基线必须从全量 messages 取：压缩后视图里已没有首条 user
            business_info = context_compactor.first_business_info(thread["messages"])
            # 存量本体引用（spec 010）：从**线程顶层**取快照原文，不重新读源本体（FR-016）。
            # 与 business_info 同理——不能从 messages 派生，否则历史引用会随压缩丢失。
            refs = thread.get("ontology_refs") or {}
            ontology_refs_text = str(refs.get("prompt_text") or "")
            stream = _langchain_stream(
                llm, view, grilling, business_info, summary_text, ontology_refs_text
            )

        async for chunk in stream:
            yield chunk
            data = chunk.removeprefix("data: ")
            try:
                payload = json.loads(data)
                collected += payload.get("token", "")
                if payload.get("error"):
                    error_text = str(payload["error"])
            except json.JSONDecodeError:
                pass

        # Save the collected response（错误文本不落 messages，改记 last_error）
        thread["messages"][assistant_idx]["content"] = collected
        if error_text:
            thread["last_error"] = {"message": error_text, "at": datetime.now(timezone.utc).isoformat()}

        # Auto-set title: summarize first user question via LLM
        if thread.get("title") in ("新对话", "") and llm is not None:
            for msg in thread["messages"]:
                if msg["role"] == "user" and msg["content"].strip():
                    try:
                        from langchain_core.messages import HumanMessage, SystemMessage
                        summary = await llm.ainvoke([
                            SystemMessage(content=TITLE_SUMMARIZE_PROMPT),
                            HumanMessage(content=msg["content"].strip()),
                        ])
                        thread["title"] = summary.content.strip()[:20] or msg["content"].strip()[:10]
                    except Exception:
                        thread["title"] = msg["content"].strip()[:10]
                    break

        thread_store.save_thread(thread)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/{thread_id}/export")
async def export_thread(thread_id: str, body: dict):
    """Export selected assistant messages directly as a markdown document without AI processing.

    需求：弹窗填「本体名」「内容」，md 文件名固定为 {本体名}_{内容}.md，同名覆盖。
    """
    thread, sc, onto = thread_store.load_thread(thread_id)

    selected_indices = body.get("selected_indices", [])
    if not selected_indices:
        raise InvalidInputError("请先选择要导出的助手回复内容")

    ontology_name = body.get("ontology_name", "").strip()
    content = body.get("content", "").strip()
    version = (thread.get("version") or "").strip()
    if not ontology_name or not content:
        raise InvalidInputError("本体名与内容均不能为空")
    if not version:
        raise InvalidInputError("版本不能为空（请在创建对话时填写版本号）")

    # 文件名合法性校验（禁路径分隔符 / 保留名 / 超长）统一在 thread_store 收口
    doc_name = thread_store.build_export_doc_name(ontology_name, content)

    # Get selected assistant messages
    selected_content: list[str] = []
    for idx in selected_indices:
        if idx < len(thread["messages"]) and thread["messages"][idx]["role"] == "assistant":
            msg_content = thread["messages"][idx].get("content", "").strip()
            if msg_content:
                selected_content.append(msg_content)

    if not selected_content:
        raise InvalidInputError("选中的内容为空，无法导出")

    # Build markdown content directly from selected messages；注明版本
    lines = [f"# {ontology_name}·{content}", f"", f"版本：{version}", f""]
    for i, c in enumerate(selected_content):
        lines.append(f"\n## {i + 1}\n")
        lines.append(c.strip())
        lines.append("\n")
    markdown_content = "\n".join(lines)

    # Save to thread directory；同名覆盖
    filename = f"{doc_name}.md"
    file_path = thread_store.write_requirement_md(thread_id, filename, markdown_content)

    # Update thread status to documented
    thread_store.mark_documented(thread)

    return {
        "message": "文档已生成",
        "path": str(file_path),
        "filename": filename,
    }


@router.post("/{thread_id}/generate-ontology")
async def generate_ontology(thread_id: str, body: dict):
    """Generate a partial ontology yaml from the requirement markdown, and save it
    to the SAME thread directory as the md (同名覆盖), NOT overwrite the ontology."""
    from services import OntologyData, slice_yaml_sections

    thread, sc, onto = thread_store.load_thread(thread_id)
    if not sc or not onto:
        raise InvalidInputError("对话未关联到本体，无法生成本体文件")

    # 用户勾选的一级目录（顶层节名）；空 = 不限（加载完整模板）
    selected = [s for s in (body.get("sections") or []) if isinstance(s, str) and s.strip()]

    # Read the requirement markdown file
    filename = body.get("filename", "")
    if not filename:
        raise InvalidInputError("请提供需求文件名")
    markdown_content = thread_store.read_requirement_md(thread_id, filename)

    # Read the template（模板缺失 → 500）
    template_content = thread_store.read_template_text()

    # 模板只加载勾选的一级目录（metadata 恒含）：避免模型看到无关节后被诱导生成无关内容
    if selected:
        template_content = slice_yaml_sections(template_content, ["metadata"] + selected)

    # 输出上限必须显式给足：整份 ontology.yaml 被截断会直接导致 YAML 解析失败
    llm = build_llm(max_tokens=LLM_MAX_TOKENS_ONTOLOGY, timeout=LLM_TIMEOUT_CHAT)
    if llm is None:
        raise InvalidInputError("未配置 LLM API Key，无法自动生成本体")

    from langchain_core.messages import HumanMessage, SystemMessage

    # metadata 的场景/本体名称与 id 取自 ontology.yaml.metadata（身份唯一来源），不交给模型猜测
    created_at = datetime.now(BEIJING_TZ).strftime("%Y-%m-%d %H:%M:%S")
    scenario_id, ontology_id = thread_store.resolve_ids(sc, onto)

    prompt = ONTOLOGY_GENERATE_PROMPT_TEMPLATE.format(
        template_content=template_content,
        markdown_content=markdown_content,
        source_file=filename,
        source_thread=thread.get("title", ""),
        created_at=created_at,
        scenario_name=sc,
        scenario_id=scenario_id if scenario_id is not None else "",
        ontology_name=onto,
        ontology_id=ontology_id if ontology_id is not None else "",
        allowed_sections="、".join(selected) if selected else "不限",
    )

    try:
        response = await llm.ainvoke([
            SystemMessage(content=ONTOLOGY_GENERATE_SYSTEM_PROMPT),
            HumanMessage(content=prompt),
        ])
        yaml_text = response.content.strip()
        # Strip markdown code fences if present
        yaml_text = strip_code_fence(yaml_text)

        # Validate YAML
        parsed = parse_yaml_text(yaml_text)
        if not isinstance(parsed, dict):
            raise ValueError("生成的YAML不是有效的字典结构")

        # Validate structure (OntologyData allows partial: missing top-level sections default to empty)
        ontology_data = OntologyData(**parsed)

        # metadata 结构固化：7 个约定字段，顺序固定；scenario/ontology 名称与 id 取自 ontology.yaml.metadata；移除已废弃的 name
        meta_in = parsed.get("metadata") if isinstance(parsed.get("metadata"), dict) else {}
        ontology_data.metadata = {
            "source_file": str(meta_in.get("source_file") or filename),
            "source_thread": str(meta_in.get("source_thread") or thread.get("title", "")),
            "created_at": str(meta_in.get("created_at") or created_at),
            "scenario_name": sc,
            "scenario_id": scenario_id,
            "ontology_name": onto,
            "ontology_id": ontology_id,
        }

        ontology_dict = ontology_data.model_dump(exclude_none=True)
        # 空节整节省略，不再输出 `functions: []` 这类空列表
        for key in ("concepts", "concept_relations", "relations", "functions", "behaviors", "rules",
                    "processes", "securities", "data_engines"):
            if not ontology_dict.get(key):
                ontology_dict.pop(key, None)
        # 兜底硬过滤：只保留 metadata + 用户勾选的节，其余一律丢弃。
        # securities / data_engines 由「本体明细」维护、不靠 AI 生成（唯一权威来源 = 设计面保存）；
        # 模型若幻觉输出这两个节或任何未知节，也在此一并丢弃。
        if selected:
            keep = {"metadata", *selected}
            for key in list(ontology_dict):
                if key not in keep:
                    ontology_dict.pop(key)

        # Output to the SAME directory as the md: {本体名}_{内容}.yaml, 同名覆盖
        req_name = filename[:-3] if filename.endswith(".md") else filename
        yaml_filename = f"{req_name}.yaml"
        thread_store.write_generated_yaml(thread_id, yaml_filename, ontology_dict)

        # Update thread status
        thread_store.mark_documented(thread)

        return {
            "message": f"已生成 {yaml_filename}",
            "filename": yaml_filename,
            "scenario": sc,
            "ontology": onto,
            "stats": {
                "concepts": len(ontology_data.concepts),
                "concept_relations": len(ontology_data.concept_relations),
                "relations": len(ontology_data.relations),
                "functions": len(ontology_data.functions),
                "behaviors": len(ontology_data.behaviors),
                "rules": len(ontology_data.rules),
                "processes": len(ontology_data.processes),
                "securities": len(ontology_data.securities),
                "data_engines": len(ontology_data.data_engines),
            },
        }
    except Exception as e:
        raise InternalError(f"生成本体失败: {str(e)}")


@router.post("/{thread_id}/clear")
async def clear_chat(thread_id: str):
    """Clear all messages in a thread but keep the thread."""
    thread_store.clear_messages(thread_id)
    return {"message": "对话已清空"}


@router.post("/{thread_id}/validate")
async def validate_analysis(thread_id: str, body: dict):
    """Validate selected analysis content for consistency and logical coherence from ontology perspective."""
    thread, sc, onto = thread_store.load_thread(thread_id)

    selected_indices = body.get("selected_indices", [])
    if not selected_indices:
        raise InvalidInputError("请先选择要验证的助手回复内容")

    # Collect selected assistant messages
    selected_content: list[str] = []
    for idx in selected_indices:
        if idx < len(thread["messages"]) and thread["messages"][idx]["role"] == "assistant":
            content = thread["messages"][idx].get("content", "").strip()
            if content:
                selected_content.append(content)

    if not selected_content:
        raise InvalidInputError("选中的内容为空，无法验证")

    analysis_text = "\n\n---\n\n".join(selected_content)

    llm = build_llm(max_tokens=LLM_MAX_TOKENS_ONTOLOGY, timeout=LLM_TIMEOUT_CHAT)
    if llm is None:
        raise InvalidInputError("未配置 LLM API Key，无法进行验证")

    from langchain_core.messages import HumanMessage, SystemMessage

    prompt = VALIDATION_PROMPT_TEMPLATE.format(analysis_content=analysis_text)

    try:
        response = await llm.ainvoke([
            SystemMessage(content=VALIDATION_SYSTEM_PROMPT),
            HumanMessage(content=prompt),
        ])
        result_text = response.content.strip()
        # 临时保存最新一次分析结果到对话文件：前端「分析结果」按钮可随时回看，无需重新验证
        thread["validate_result"] = {
            "result": result_text,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        thread["updated_at"] = datetime.now(timezone.utc).isoformat()
        thread_store.save_thread(thread)
        return {"result": result_text}
    except Exception as e:
        raise InternalError(f"验证失败: {str(e)}")
