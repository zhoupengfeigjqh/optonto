"""概念关系（类级公理）的派生、合并与级联清理 —— 纯函数，无 I/O。

单一权威口径（2026-10-19 决策）：
- ``SubClassOf`` 的成员关系**只来自** ``concepts[].sub_class_of``（概念设计）。
  ``concept_relations`` 中同类型条目仅作「关联概念属性」的持久化锚点：读取时按概念图
  重新派生行（名称/展示名/描述均由概念派生），失配锚点丢弃，避免两处真值漂移。
- ``EquivalentClass`` / ``DisjointWith`` 完全由 ``concept_relations`` 落盘。
- 概念删除/改名时，本节引用同步级联（见 ``remove_concept_references`` /
  ``rename_concept_references``）。
"""

from schemas import ConceptItem, ConceptRelationItem, OntologyData

SUB_CLASS_OF = "SubClassOf"
EQUIVALENT_CLASS = "EquivalentClass"
DISJOINT_WITH = "DisjointWith"

#: 用户可手工新增的概念关系类型（SubClassOf 只能由概念设计产生）
USER_ADDABLE_TYPES = (EQUIVALENT_CLASS, DISJOINT_WITH)


def sub_class_name(child: str, parent: str) -> str:
    """SubClassOf 行的确定性英文名（只读，用户不可改）。"""
    return f"{child}{SUB_CLASS_OF}{parent}"


def sub_class_display(child_display: str, parent_display: str) -> str:
    """SubClassOf 行的确定性中文名（只读，用户不可改）。"""
    return f"{child_display} 是一种 {parent_display}"


def _concept_of(data: OntologyData, name: str) -> ConceptItem | None:
    return next((c for c in data.concepts if c.name == name), None)


def ancestors_of(data: OntologyData, name: str) -> set[str]:
    """某概念的全部祖先（含多级，不含自身）；成环/悬空时安全截断。"""
    by_name = {c.name: c for c in data.concepts if c.name}
    seen: set[str] = set()
    cur = (by_name.get(name).sub_class_of if by_name.get(name) else "") or ""
    while cur and cur not in seen:
        seen.add(cur)
        node = by_name.get(cur)
        cur = (node.sub_class_of or "") if node else ""
    return seen


def is_ancestor(data: OntologyData, ancestor: str, descendant: str) -> bool:
    """ancestor 是否为 descendant 的祖先（含多级）。"""
    return ancestor in ancestors_of(data, descendant)


def derived_sub_class_rows(data: OntologyData) -> list[ConceptRelationItem]:
    """按概念设计派生 SubClassOf 行（合并已保存的关联概念属性锚点）。"""
    links: dict[tuple[str, str], ConceptRelationItem] = {}
    for r in data.concept_relations:
        if r.relation_type == SUB_CLASS_OF and r.source and r.target:
            links[(r.source, r.target)] = r

    rows: list[ConceptRelationItem] = []
    for c in data.concepts:
        parent_name = (c.sub_class_of or "").strip()
        if not parent_name or parent_name == c.name:
            continue
        parent = _concept_of(data, parent_name)
        stored = links.get((c.name, parent_name))
        child_display = c.display_name or c.name
        parent_display = (parent.display_name if parent else "") or parent_name
        rows.append(
            ConceptRelationItem(
                name=sub_class_name(c.name, parent_name),
                display_name=sub_class_display(child_display, parent_display),
                relation_type=SUB_CLASS_OF,
                source=c.name,
                target=parent_name,
                source_attr=stored.source_attr if stored else "",
                target_attr=stored.target_attr if stored else "",
                description=f"由概念设计「{child_display} → {parent_display}」自动同步（子概念继承父概念属性）",
            )
        )
    return rows


def hydrate(data: OntologyData) -> list[ConceptRelationItem]:
    """概念关系视图：派生的 SubClassOf 在前，用户登记的等价/互斥在后（悬空条目不下发）。"""
    derived = derived_sub_class_rows(data)
    concept_names = {c.name for c in data.concepts if c.name}
    stored = [
        r
        for r in data.concept_relations
        if r.relation_type in USER_ADDABLE_TYPES
        and r.source in concept_names
        and r.target in concept_names
    ]
    return derived + stored


def prune_stale_sub_class_links(data: OntologyData) -> int:
    """删除与概念设计失配的 SubClassOf 锚点（父概念被去掉/改名/删除后的自愈）。"""
    pairs = {
        (c.name, (c.sub_class_of or "").strip())
        for c in data.concepts
        if (c.sub_class_of or "").strip()
    }
    before = len(data.concept_relations)
    data.concept_relations = [
        r
        for r in data.concept_relations
        if r.relation_type != SUB_CLASS_OF or (r.source, r.target) in pairs
    ]
    return before - len(data.concept_relations)


def find_sub_class_link(data: OntologyData, source: str, target: str) -> ConceptRelationItem | None:
    return next(
        (
            r
            for r in data.concept_relations
            if r.relation_type == SUB_CLASS_OF and r.source == source and r.target == target
        ),
        None,
    )


def upsert_sub_class_link(
    data: OntologyData, source: str, target: str, source_attr: str, target_attr: str
) -> ConceptRelationItem:
    """写入/更新 SubClassOf 的关联概念属性锚点（其余字段恒由概念派生，不落盘）。"""
    prune_stale_sub_class_links(data)
    item = find_sub_class_link(data, source, target)
    if item is None:
        item = ConceptRelationItem(
            name=sub_class_name(source, target),
            relation_type=SUB_CLASS_OF,
            source=source,
            target=target,
        )
        data.concept_relations.append(item)
    else:
        item.name = sub_class_name(source, target)
    item.source_attr = source_attr
    item.target_attr = target_attr
    return item


def remove_sub_class_link(data: OntologyData, source: str, target: str) -> None:
    """清空某条 SubClassOf 的关联概念属性锚点（两端属性都为空时不再落盘）。"""
    data.concept_relations = [
        r
        for r in data.concept_relations
        if not (r.relation_type == SUB_CLASS_OF and r.source == source and r.target == target)
    ]


def remove_concept_references(data: OntologyData, concept_name: str) -> int:
    """概念被删除 → 清理本节引用该概念的全部条目。"""
    before = len(data.concept_relations)
    data.concept_relations = [
        r
        for r in data.concept_relations
        if r.source != concept_name and r.target != concept_name
    ]
    return before - len(data.concept_relations)


def rename_concept_references(data: OntologyData, old_name: str, new_name: str) -> None:
    """概念改名 → 改写本节 source/target，并刷新 SubClassOf 锚点的派生名。"""
    for r in data.concept_relations:
        if r.source == old_name:
            r.source = new_name
        if r.target == old_name:
            r.target = new_name
        if r.relation_type == SUB_CLASS_OF:
            r.name = sub_class_name(r.source, r.target)
