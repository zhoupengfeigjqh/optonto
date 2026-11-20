"""存量本体引用（spec 010）：提取 / 渲染 / 冲突检测 / 体量估算 / 候选清单。

口径（`specs/010-ontology-reuse-context/spec.md`）：

- **严格四类**：概念（含有效属性）、函数、行为。概念关系 / 对象关系 / 规则 / 流程 /
  安全管控 / 数据引擎一律**不提取**；函数与行为只取名称，不取参数、返回与状态迁移。
- **有效属性**：概念属性取 ``services.inheritance.effective_map`` 的结果（自有 ∪ 继承后
  收窄），与 ``ontology_summary.build`` 同口径；输出**不标注**继承来源。
- **约束文本**：复用 ``ontology_summary.format_constraint``（唯一实现），无约束时不落该键。
- **中文名**：缺失即不写该键，不得用英文名冒充、不得编造。
- **渲染安全**：名称与约束中的 ``\\r`` / ``\\n`` 折叠为单个空格（防止行结构被破坏），
  其余可见字符原样输出、不转义。

分层（章程 II）：本模块属领域层，只做业务规则；取数一律经 ``services`` 的公开函数
（``load_ontology_data`` / ``thread_store.resolve_ids``），不 import ``repositories``。
纯函数部分（提取 / 渲染 / 冲突）无 I/O，可直接单测。
"""

from datetime import datetime, timezone

from config import ONTOLOGY_REF_MAX_COUNT, ONTOLOGY_REF_MAX_TOKENS
from errors import InvalidInputError, NotFoundError
from services.context_compactor import estimate_tokens
from services.inheritance import effective_map
from services.ontology_summary import format_constraint

# ─── 常量 ───────────────────────────────────────────────────────────────────────

# 段落在 system prompt 中的唯一定义处（契约 contracts/ontology-refs.md B.2）
SECTION_HEAD = "=== 存量本体参考（既有约定，硬约束）==="
SECTION_TAIL = "=== 存量本体参考结束 ==="

CATEGORY_KEYS = (("concept", "concepts"), ("function", "functions"), ("behavior", "behaviors"))
CATEGORY_LABELS = {"concept": "概念", "function": "函数", "behavior": "行为"}

SKIP_REASON_EMPTY = "暂无可提取内容"

_RULES = (
    "1. 概念、函数、行为三类不得出现同名异义；同一类目内名称必须唯一；"
    "同一名称跨类目出现时必须显式说明二者关系，不得混用。\n"
    "2. 与下列**同名概念**，其属性集合、属性英文名、属性类型与约束必须与所列定义完全一致；"
    "发现不一致时先向用户指出冲突，不得自行取舍或改写。\n"
    "3. 概念不同但语义相同的属性，优先沿用下列已有的属性英文名、类型与约束，不新造第三种写法。\n"
    "4. 以下名称为只读基线：不得重命名、不得合并、不得为同一事物另造同义词。\n"
    "5. 未给中文名的条目只有英文名，禁止自行补写、音译或编造中文名。"
)


# ─── 基础工具 ───────────────────────────────────────────────────────────────────

def _clean(value) -> str:
    """控制字符折叠为单个空格；其余可见字符原样保留（不转义、不改写）。"""
    text = "" if value is None else str(value)
    out: list[str] = []
    prev_space = False
    for ch in text:
        if ch in "\r\n\t":
            if not prev_space:
                out.append(" ")
                prev_space = True
            continue
        out.append(ch)
        prev_space = ch == " "
    return "".join(out).strip()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# ─── 提取 ───────────────────────────────────────────────────────────────────────

def extract_ontology_items(data) -> dict:
    """本体数据（``OntologyData``）→ 四类提取项（严格三类键 + 概念下挂属性）。"""
    effective = effective_map(data.concepts)

    concepts: list[dict] = []
    for concept in data.concepts:
        attributes: list[dict] = []
        for resolved in effective.get(concept.name, []):
            attr = resolved.attribute
            item = {"name": _clean(attr.name), "type": _clean(attr.type)}
            if _clean(attr.title):
                item["title"] = _clean(attr.title)
            constraint_text = _clean(format_constraint(attr.constraint))
            if constraint_text and constraint_text != "-":
                item["constraint"] = constraint_text
            attributes.append(item)
        node = {"name": _clean(concept.name), "attributes": attributes}
        if _clean(concept.title):
            node["title"] = _clean(concept.title)
        concepts.append(node)

    functions: list[dict] = []
    for fn in data.functions:
        item = {"name": _clean(fn.name)}
        if _clean(fn.title):
            item["title"] = _clean(fn.title)
        functions.append(item)

    behaviors: list[dict] = []
    for behavior in data.behaviors:
        item = {"name": _clean(behavior.name)}
        if _clean(behavior.title):
            item["title"] = _clean(behavior.title)
        behaviors.append(item)

    return {"concepts": concepts, "functions": functions, "behaviors": behaviors}


def count_items(items: dict) -> dict:
    """三类条数（供候选列表与置灰判定）。"""
    return {
        "concepts": len(items.get("concepts") or []),
        "functions": len(items.get("functions") or []),
        "behaviors": len(items.get("behaviors") or []),
    }


def is_referenceable(items: dict) -> bool:
    """三类合计为 0 视为不可引用（FR-003）。"""
    return sum(count_items(items).values()) > 0


# ─── 渲染 ───────────────────────────────────────────────────────────────────────

def _render_entry(index: int, entry: dict, snapshot_at: str) -> list[str]:
    items = entry["items"]
    counts = entry["counts"]
    lines = [
        f"[{index}] {entry['scenario_name']} - {entry['ontology_name']}"
        f"（快照 {snapshot_at}：概念 {counts['concepts']} / 函数 {counts['functions']} / 行为 {counts['behaviors']}）"
    ]
    if items["concepts"]:
        lines.append("概念：")
        for concept in items["concepts"]:
            title = f"（{concept['title']}）" if concept.get("title") else ""
            lines.append(f"- {concept['name']}{title}")
            for attr in concept.get("attributes") or []:
                attr_title = f"（{attr['title']}）" if attr.get("title") else ""
                row = f"  - {attr['name']}{attr_title}: {attr['type']}"
                if attr.get("constraint"):
                    row += f"；约束={attr['constraint']}"
                lines.append(row)
    if items["functions"]:
        lines.append("函数：")
        for fn in items["functions"]:
            title = f"（{fn['title']}）" if fn.get("title") else ""
            lines.append(f"- {fn['name']}{title}")
    if items["behaviors"]:
        lines.append("行为：")
        for behavior in items["behaviors"]:
            title = f"（{behavior['title']}）" if behavior.get("title") else ""
            lines.append(f"- {behavior['name']}{title}")
    return lines


def render_prompt_text(entries: list[dict], snapshot_at: str) -> str:
    """引用条目 → system prompt 独立段落；无条目返回空串（FR-009 / SC-005）。"""
    if not entries:
        return ""
    lines = [
        f"\n\n{SECTION_HEAD}",
        f"本次对话引用了 {len(entries)} 个存量本体，其概念、属性、函数、行为的命名是**既有约定**，"
        "优先级高于本次新建内容：",
        _RULES,
        "",
    ]
    for index, entry in enumerate(entries, start=1):
        lines.extend(_render_entry(index, entry, snapshot_at))
        lines.append("")
    lines.append(f"{SECTION_TAIL}\n")
    return "\n".join(lines)


# ─── 冲突检测 ───────────────────────────────────────────────────────────────────

def _attribute_signature(concept: dict) -> tuple:
    return tuple(
        sorted(
            (attr["name"], attr["type"], attr.get("constraint", "-"))
            for attr in (concept.get("attributes") or [])
        )
    )


def _attribute_text(concept: dict) -> str:
    parts = []
    for attr in concept.get("attributes") or []:
        text = f"{attr['name']}({attr['type']}"
        if attr.get("constraint"):
            text += f", {attr['constraint']}"
        parts.append(text + ")")
    return "、".join(parts) or "（无属性）"


def _value_text(signature: tuple) -> dict:
    return {name: f"{atype}，约束={constraint}" if constraint != "-" else atype
            for name, atype, constraint in signature}


def _diff_against(base: tuple, other: tuple, base_name: str, other_name: str) -> list[str]:
    base_map, other_map = _value_text(base), _value_text(other)
    diffs: list[str] = []
    for name in sorted(set(base_map) | set(other_map)):
        if name not in other_map:
            diffs.append(f"{name}：仅在{base_name}中定义")
        elif name not in base_map:
            diffs.append(f"{name}：仅在{other_name}中定义")
        elif base_map[name] != other_map[name]:
            diffs.append(f"{name}：{base_map[name]} ≠ {other_map[name]}")
    return diffs


def detect_conflicts(entries: list[dict]) -> list[dict]:
    """只检两类冲突（FR-014）：同名概念属性不一致、同一名称跨类目出现。"""
    conflicts: list[dict] = []

    # ① 同名概念、有效属性集合不同
    by_concept: dict[str, list[tuple[dict, dict]]] = {}
    for entry in entries:
        for concept in entry["items"]["concepts"]:
            by_concept.setdefault(concept["name"], []).append((entry, concept))

    for name in sorted(by_concept):
        group = by_concept[name]
        if len(group) < 2:
            continue
        groups: dict[tuple, list[tuple[dict, dict]]] = {}
        for entry, concept in group:
            groups.setdefault(_attribute_signature(concept), []).append((entry, concept))
        if len(groups) < 2:
            continue

        ordered = list(groups.items())
        base_sig, base_members = ordered[0]
        base_entry, base_concept = base_members[0]
        participants = [
            {
                "scenario_name": entry["scenario_name"],
                "ontology_name": entry["ontology_name"],
                "detail": _attribute_text(concept),
            }
            for entry, concept in group
        ]
        differences: list[str] = []
        for sig, members in ordered[1:]:
            other_entry, _ = members[0]
            for line in _diff_against(base_sig, sig, base_entry["ontology_name"], other_entry["ontology_name"]):
                if line not in differences:
                    differences.append(line)
        conflicts.append({
            "kind": "concept_attribute_mismatch",
            "name": name,
            "category": None,
            "participants": participants,
            "differences": differences,
        })

    # ② 同一名称跨类目出现
    by_name: dict[str, dict[str, list[tuple[dict, str]]]] = {}
    for entry in entries:
        for category, key in CATEGORY_KEYS:
            for item in entry["items"][key]:
                by_name.setdefault(item["name"], {}).setdefault(category, []).append(
                    (entry, CATEGORY_LABELS[category])
                )

    for name in sorted(by_name):
        categories = by_name[name]
        if len(categories) < 2:
            continue
        participants = [
            {
                "scenario_name": entry["scenario_name"],
                "ontology_name": entry["ontology_name"],
                "detail": f"{label} {name}",
            }
            for category in sorted(categories)
            for entry, label in categories[category]
        ]
        conflicts.append({
            "kind": "cross_category_duplicate",
            "name": name,
            "category": sorted(categories),
            "participants": participants,
            "differences": [],
        })

    return conflicts


# ─── 引用装配（唯一写盘前校验点） ──────────────────────────────────────────────

def _normalize_inputs(inputs) -> list[tuple[str, str]]:
    """请求体 ``[{scenario_name, ontology_name}]`` → 去重后的 (场景名, 本体名) 列表。"""
    if inputs is None:
        return []
    if not isinstance(inputs, list):
        raise InvalidInputError("请求参数不合法")
    seen: set[tuple[str, str]] = set()
    normalized: list[tuple[str, str]] = []
    for raw in inputs:
        if not isinstance(raw, dict):
            raise InvalidInputError("请求参数不合法")
        scenario = str(raw.get("scenario_name") or "").strip()
        ontology = str(raw.get("ontology_name") or "").strip()
        if not scenario or not ontology:
            raise InvalidInputError("请求参数不合法")
        key = (scenario, ontology)
        if key in seen:
            continue
        seen.add(key)
        normalized.append(key)
    return normalized


def build_snapshot(inputs, *, max_tokens: int | None = None, max_count: int | None = None) -> dict:
    """引用输入 → 快照 + 校验结果（预检与创建共用，保证体量口径一致）。

    返回：``allowed`` / ``max_tokens`` / ``token_estimate`` / ``conflicts`` / ``reason`` /
    ``entries``（内部用）/ ``prompt_text`` / ``snapshot``（仅 allowed 时非 None）。

    失败语义：引用的本体不存在 → 404；入参不合法或本体无内容 → 400。
    体量/数量超限**不抛异常**，以 ``allowed=False`` + ``reason`` 返回，由调用方决定是否阻断。
    """
    limit_tokens = ONTOLOGY_REF_MAX_TOKENS if max_tokens is None else max_tokens
    limit_count = ONTOLOGY_REF_MAX_COUNT if max_count is None else max_count

    # 延迟导入：避免与 services 包初始化顺序耦合
    from services import load_ontology_data
    from services.thread_store import resolve_ids

    pairs = _normalize_inputs(inputs)
    entries: list[dict] = []
    for scenario_name, ontology_name in pairs:
        scenario_id, ontology_id = resolve_ids(scenario_name, ontology_name)
        if scenario_id is None or ontology_id is None:
            raise NotFoundError(f"本体不存在: {scenario_name} - {ontology_name}")
        items = extract_ontology_items(load_ontology_data(scenario_name, ontology_name))
        if not is_referenceable(items):
            raise InvalidInputError(f"本体暂无可提取内容: {scenario_name} - {ontology_name}")
        entries.append({
            "ontology_id": str(ontology_id),
            "scenario_id": str(scenario_id),
            "scenario_name": scenario_name,
            "ontology_name": ontology_name,
            "counts": count_items(items),
            "items": items,
        })

    snapshot_at = _now_iso()
    prompt_text = render_prompt_text(entries, snapshot_at)
    token_estimate = estimate_tokens(prompt_text)

    reason = None
    if len(entries) > limit_count:
        reason = f"一次最多引用 {limit_count} 个本体，请分批创建"
    elif token_estimate > limit_tokens:
        reason = (
            f"引用内容约 {token_estimate} tokens，超过上限 {limit_tokens}；"
            "请减少勾选或改选内容更少的主体"
        )

    allowed = reason is None
    snapshot = None
    # 无引用（entries 为空）时不生成快照：调用方据此保证 thread JSON 不出现该键（V1）
    if allowed and entries:
        snapshot = {
            "snapshot_at": snapshot_at,
            "max_tokens": limit_tokens,
            "token_estimate": token_estimate,
            "refs": entries,
            "prompt_text": prompt_text,
        }

    return {
        "allowed": allowed,
        "max_tokens": limit_tokens,
        "token_estimate": token_estimate,
        "conflicts": detect_conflicts(entries),
        "reason": reason,
        "entries": entries,
        "prompt_text": prompt_text,
        "snapshot": snapshot,
    }


# ─── 候选清单 ───────────────────────────────────────────────────────────────────

def list_candidates(exclude_scenario: str = "", exclude_ontology: str = "") -> dict:
    """可引用的存量本体清单（含置灰原因）；排除指定本体（防止自我引用）。"""
    from services import load_ontology_data
    from services.ontology_registry import list_all_ontologies

    exclude = (exclude_scenario.strip(), exclude_ontology.strip())
    exclude_active = bool(exclude[0] and exclude[1])

    candidates: list[dict] = []
    for row in list_all_ontologies():
        scenario_name = str(row.get("scenario_name") or "")
        ontology_name = str(row.get("ontology_name") or "")
        if not scenario_name or not ontology_name:
            continue
        if exclude_active and (scenario_name, ontology_name) == exclude:
            continue
        try:
            items = extract_ontology_items(load_ontology_data(scenario_name, ontology_name))
        except Exception:  # noqa: BLE001 —— 单个本体解析失败不得拖垮整个清单
            continue
        counts = count_items(items)
        referenceable = sum(counts.values()) > 0
        candidates.append({
            "ontology_id": str(row.get("ontology_id") or ""),
            "scenario_id": str(row.get("scenario_id") or ""),
            "scenario_name": scenario_name,
            "ontology_name": ontology_name,
            "description": str(row.get("description") or ""),
            "deployed_version": str(row.get("deployed_version") or ""),
            "counts": counts,
            "referenceable": referenceable,
            "skip_reason": None if referenceable else SKIP_REASON_EMPTY,
        })

    return {"candidates": candidates, "max_count": ONTOLOGY_REF_MAX_COUNT}
