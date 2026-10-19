"""概念属性继承（subClassOf）解析与收窄合成（spec 005）。

口径（落盘只存引用，读取时合成，父概念始终是唯一权威源）：

- ``concepts[].sub_class_of`` 至多一个父概念，空 = 根概念；
- 有效属性 = 自有属性（未被继承同名占用的）+ 父概念有效属性（可多级传递）；
- **同名时继承优先**：子概念不能再声明父概念已有的属性，只能通过
  ``attribute_restrictions`` 做收窄（enum 只删不增 / min-max 不超父 / pattern 任意覆盖）；
- 收窄沿继承链逐层叠加：enum 取交集、min 取最大、max 取最小、pattern 取最近非 None；
- 环与悬空父概念一律兜底（截断 + 告警），写侧已由 validators 拦截，读侧不得抛错。

本模块只依赖 ``schemas``（章程 II：业务层，不 import fastapi）。
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Iterable

from schemas import AttributeItem, AttributeRestriction, ConceptItem, ConstraintItem

logger = logging.getLogger("core-backend")

# 类型-约束矩阵（与前端 ATTR_TYPES 联动口径一致）
ENUM_TYPES = {"string", "number", "integer"}
RANGE_TYPES = {"number", "integer"}
PATTERN_TYPES = {"string"}


@dataclass(frozen=True)
class ResolvedAttribute:
    """一条合成后的属性：值 + 继承源头 + 是否被本概念收窄过。"""

    attribute: AttributeItem
    inherited_from: str
    restricted: bool = False

    @property
    def name(self) -> str:
        return self.attribute.name


def _enum_key(value: any) -> str:
    """枚举比较键：容忍 YAML 里 "1" 与 1 的形态差异，输出仍保留父定义的原始值。"""
    return str(value)


def _is_empty_constraint(c: ConstraintItem | None) -> bool:
    if c is None:
        return True
    return (
        not c.unique
        and not c.required
        and not c.enum
        and not c.pattern
        and c.min is None
        and c.max is None
    )


def _apply_restriction(attr: AttributeItem, r: AttributeRestriction | dict) -> tuple[AttributeItem, bool]:
    """把一层收窄叠加到父属性上；返回 (新属性, 是否真的改变了约束)。"""
    if isinstance(r, dict):
        r = AttributeRestriction(**r)
    constraint = attr.constraint.model_copy(deep=True) if attr.constraint else ConstraintItem()
    changed = False

    if r.enum is not None and attr.type in ENUM_TYPES and constraint.enum:
        allowed = {_enum_key(v) for v in r.enum}
        narrowed = [v for v in constraint.enum if _enum_key(v) in allowed]
        if narrowed and narrowed != constraint.enum:
            constraint.enum = narrowed
            changed = True

    if (r.min is not None or r.max is not None) and attr.type in RANGE_TYPES:
        lo = [v for v in (constraint.min, r.min) if v is not None]
        hi = [v for v in (constraint.max, r.max) if v is not None]
        new_min = max(lo) if lo else None
        new_max = min(hi) if hi else None
        if new_min is not None and new_min != constraint.min:
            constraint.min = new_min
            changed = True
        if new_max is not None and new_max != constraint.max:
            constraint.max = new_max
            changed = True

    if r.pattern is not None and attr.type in PATTERN_TYPES:
        if (constraint.pattern or "") != r.pattern:
            constraint.pattern = r.pattern
            changed = True

    out = attr.model_copy(deep=True)
    out.constraint = None if _is_empty_constraint(constraint) else constraint
    return out, changed


def effective_map(concepts: Iterable[ConceptItem]) -> dict[str, list[ResolvedAttribute]]:
    """概念名 → 有效属性列表（自有在前、继承在后，同名继承优先）。"""
    by_name: dict[str, ConceptItem] = {c.name: c for c in concepts if c.name}
    memo: dict[str, list[ResolvedAttribute]] = {}

    def walk(name: str, stack: tuple[str, ...]) -> list[ResolvedAttribute]:
        if name in memo:
            return memo[name]
        concept = by_name.get(name)
        if concept is None:
            return []
        if name in stack:
            logger.warning("概念继承存在环，已截断: %s", " -> ".join([*stack, name]))
            return []

        parent_name = (concept.sub_class_of or "").strip()
        parent_eff: list[ResolvedAttribute] = []
        if parent_name:
            if parent_name in by_name:
                parent_eff = walk(parent_name, (*stack, name))
            else:
                logger.warning("概念 %s 的父概念不存在，已忽略继承: %s", name, parent_name)

        inherited_names = {ra.attribute.name for ra in parent_eff}
        resolved: list[ResolvedAttribute] = [
            ResolvedAttribute(a, name, False)
            for a in (concept.attributes or [])
            if a.name not in inherited_names
        ]
        restrictions = concept.attribute_restrictions or {}
        for ra in parent_eff:
            r = restrictions.get(ra.attribute.name)
            if r is None:
                resolved.append(ResolvedAttribute(ra.attribute, ra.inherited_from, ra.restricted))
            else:
                applied, changed = _apply_restriction(ra.attribute, r)
                resolved.append(ResolvedAttribute(applied, ra.inherited_from, ra.restricted or changed))

        memo[name] = resolved
        return resolved

    for c in by_name:
        walk(c, ())
    return memo


def inherited_of(concepts: Iterable[ConceptItem]) -> dict[str, list[ResolvedAttribute]]:
    """概念名 → 仅继承来的属性（不含自有）。"""
    out: dict[str, list[ResolvedAttribute]] = {}
    for name, resolved in effective_map(concepts).items():
        out[name] = [ra for ra in resolved if ra.inherited_from != name]
    return out


def _restriction_delta(base: AttributeItem, applied: AttributeItem) -> AttributeRestriction | None:
    """由「父属性 → 合成后属性」反推一条规范化收窄（全等则返回 None）。"""
    b = base.constraint
    a = applied.constraint
    out = AttributeRestriction()

    base_enum = list(b.enum) if b and b.enum else []
    applied_enum = list(a.enum) if a and a.enum else []
    if base_enum and applied_enum and applied_enum != base_enum:
        out.enum = applied_enum
    if a is not None:
        if a.min is not None and (b is None or a.min != b.min):
            out.min = a.min
        if a.max is not None and (b is None or a.max != b.max):
            out.max = a.max
    # pattern 必须比较「空串」语义：a 为 None 说明约束被清空，等价于显式清除父模式
    base_pattern = (b.pattern or "") if b else ""
    applied_pattern = (a.pattern or "") if a else ""
    if applied_pattern != base_pattern:
        out.pattern = applied_pattern

    if out.enum is None and out.min is None and out.max is None and out.pattern is None:
        return None
    return out


def normalized_restrictions(
    concepts: Iterable[ConceptItem],
) -> dict[str, dict[str, AttributeRestriction]]:
    """概念名 → 规范化后的收窄（按父概念有效范围自动交集/钳制/丢弃失效项）。

    用于设计面读取视图：父概念后续收窄导致子概念存量收窄越界时，读侧自愈，
    前端拿到的永远是合法声明；写侧仍强校验（显式新增越界值 → 400）。
    """
    concepts = list(concepts)
    effective = effective_map(concepts)
    out: dict[str, dict[str, AttributeRestriction]] = {}
    for c in concepts:
        restrictions = c.attribute_restrictions or {}
        if not restrictions:
            out[c.name] = {}
            continue
        parent = (c.sub_class_of or "").strip()
        base = {ra.attribute.name: ra.attribute for ra in effective.get(parent, [])}
        normalized: dict[str, AttributeRestriction] = {}
        for name, r in restrictions.items():
            b = base.get(name)
            if b is None:
                continue
            applied, _ = _apply_restriction(b, r)
            delta = _restriction_delta(b, applied)
            if delta is not None:
                normalized[name] = delta
        out[c.name] = normalized
    return out


def inherited_attribute_names(concepts: Iterable[ConceptItem], parent_name: str | None) -> set[str]:
    """父概念（含其祖先）的有效属性名集合；用于同名冲突剔除与限制校验。"""
    parent = (parent_name or "").strip()
    if not parent:
        return set()
    return {ra.attribute.name for ra in effective_map(concepts).get(parent, [])}


def strip_conflicting_attributes(concept: ConceptItem, concepts: Iterable[ConceptItem]) -> list[str]:
    """剔除与继承属性同名的自有声明（口径 3：同名直接继承父类）。

    返回被剔除的属性名，供路由记日志；前端在保存前会以确认弹窗预告同一名单。
    """
    names = inherited_attribute_names(concepts, concept.sub_class_of)
    if not names:
        return []
    removed = [a.name for a in (concept.attributes or []) if a.name in names]
    if removed:
        concept.attributes = [a for a in (concept.attributes or []) if a.name not in names]
        logger.warning("概念 %s 的自有属性与继承属性同名，已按继承优先剔除: %s", concept.name, ", ".join(removed))
    return removed


def prune_restrictions(concept: ConceptItem, concepts: Iterable[ConceptItem]) -> list[str]:
    """剪掉已不再继承的属性名上的收窄（换父 / 父删属性后的自愈）。"""
    names = inherited_attribute_names(concepts, concept.sub_class_of)
    dropped = [k for k in (concept.attribute_restrictions or {}) if k not in names]
    for k in dropped:
        concept.attribute_restrictions.pop(k, None)
    return dropped


def descendants_of(concepts: Iterable[ConceptItem], name: str) -> set[str]:
    """某概念的全部后代（含多级），用于父概念选择器防环。"""
    children: dict[str, list[str]] = {}
    for c in concepts:
        p = (c.sub_class_of or "").strip()
        if p:
            children.setdefault(p, []).append(c.name)
    out: set[str] = set()
    queue = list(children.get(name, []))
    while queue:
        cur = queue.pop()
        if cur in out or cur == name:
            continue
        out.add(cur)
        queue.extend(children.get(cur, []))
    return out


def clear_parent_references(concepts: list[ConceptItem], removed_name: str) -> list[str]:
    """父概念被删除 → 清空子概念引用与其收窄（不删子概念）。"""
    affected = []
    for c in concepts:
        if (c.sub_class_of or "").strip() == removed_name:
            c.sub_class_of = None
            c.attribute_restrictions = {}
            affected.append(c.name)
    return affected


def rename_parent_references(concepts: list[ConceptItem], old_name: str, new_name: str) -> list[str]:
    """父概念改名 → 级联改写子概念引用（避免悬空）。"""
    affected = []
    for c in concepts:
        if (c.sub_class_of or "").strip() == old_name:
            c.sub_class_of = new_name
            affected.append(c.name)
    return affected
