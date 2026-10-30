"""本体 → 文本摘要（喂给生成类 LLM 的上下文）—— 纯函数，无 I/O。

设计口径：摘要只覆盖**技能模板实际包含的章节**（概念 / 关系 / 行为 / 流程）；
函数、规则、安全管控不进摘要——技能模板已不含这些章节，喂进去只会浪费 token
并诱导模型补写模板之外的章节。
"""

import json

from services.inheritance import effective_map

# 关系类型中文标签（与前端 RelationTable 的口径一致；空则不输出，不给 LLM 噪音）
# 2026-10-19 起规范值为大驼峰；保留存量蛇形键兜底（旧 yaml 直接读入未经 schema 归一的历史路径）
RELATION_TYPE_LABELS = {
    "Asymmetric": "非对称", "Symmetric": "对称", "Transitive": "传递",
    "Functional": "函数性", "InverseFunctional": "反函数性",
    "asymmetric": "非对称", "symmetric": "对称", "transitive": "传递",
    "functional": "函数性", "inverse_functional": "反函数性",
}


def format_constraint(constraint) -> str:
    """属性约束压缩为一段可读文本（与 SKILL.md 属性表「约束」列同口径）；无约束返回 `-`。"""
    if constraint is None:
        return "-"
    parts = []
    if constraint.unique:
        parts.append("唯一")
    if constraint.required:
        parts.append("必填")
    if constraint.enum:
        parts.append(f"枚举=[{', '.join(str(v) for v in constraint.enum)}]")
    if constraint.pattern:
        parts.append(f"模式={constraint.pattern}")
    if constraint.min is not None or constraint.max is not None:
        lo = str(constraint.min) if constraint.min is not None else "-∞"
        hi = str(constraint.max) if constraint.max is not None else "+∞"
        parts.append(f"范围={lo}~{hi}")
    return "；".join(parts) if parts else "-"


def build(data) -> str:
    """本体数据（OntologyData）→ 摘要文本。"""
    lines = []
    lines.append(f"概念（{len(data.concepts)}个）:")
    # 有效属性 = 自有 ∪ 继承（spec 005）：继承项标注来源，避免 LLM 误以为可通过行为直接写入
    effective = effective_map(data.concepts)
    for c in data.concepts:
        lines.append(f"  - {c.name}（{c.title or ''}）: {c.description or ''}")
        for ra in effective.get(c.name, []):
            a = ra.attribute
            origin = "自有" if ra.inherited_from == c.name else f"继承自 {ra.inherited_from}"
            lines.append(
                f"    属性: {a.name} ({a.type}) 中文名={a.title or '-'} "
                f"约束={format_constraint(a.constraint)}（{origin}）"
            )
    lines.append(f"\n关系（{len(data.relations)}个）:")
    for r in data.relations:
        link = f", 关联: {r.source}.{r.source_attr} = {r.target}.{r.target_attr}" if r.source_attr and r.target_attr else ""
        rtypes = "、".join(RELATION_TYPE_LABELS.get(t, t) for t in (r.relation_type or []))
        type_txt = f", 类型: {rtypes}" if rtypes else ""
        lines.append(f"  - {r.name}（{r.title or ''}）: {r.source} -> {r.target} ({r.cardinality}{link}{type_txt}) {r.description or ''}")
    lines.append(f"\n行为（{len(data.behaviors)}个）:")
    for b in data.behaviors:
        lines.append(f"  - {b.name}（{b.title or ''}）: {b.description or ''}")
        lines.append(f"    params: {json.dumps(b.params, ensure_ascii=False, default=str)}")
        lines.append(f"    response: {json.dumps(b.response, ensure_ascii=False, default=str)}")
    lines.append(f"\n流程（{len(data.processes)}个）:")
    for p in data.processes:
        lines.append(f"  - {p.name}（{p.title or ''}）: {p.goal or ''}")
        for step in (p.steps or []):
            lines.append(f"    step: {step.current_action}（{step.description or ''}）衔接={step.connection_type}")
    return "\n".join(lines)
