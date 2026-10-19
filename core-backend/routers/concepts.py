"""CRUD API for concepts within an ontology."""

from typing import Any

from fastapi import APIRouter

from errors import InvalidInputError, NotFoundError

from dependencies import get_ontology_names
from schemas import AttributeItem, ConceptItem, ConceptView, InheritedAttributeItem
from services import load_ontology_data, save_ontology_data
from services.entity_crud import ensure_unique, find_index
from services.inheritance import (
    clear_parent_references,
    inherited_of,
    normalized_restrictions,
    prune_restrictions,
    rename_parent_references,
    strip_conflicting_attributes,
)
from services.validators import validate_restrictions, validate_status_attribute, validate_sub_class_of

router = APIRouter(prefix="/api/ontologies/{ontology_id}/concepts", tags=["概念"])


@router.get("", response_model=list[ConceptView])
async def list_concepts(ontology_id: int):
    """概念列表：自有属性 + 派生继承属性（spec 005，继承项只读）。"""
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)
    inherited = inherited_of(data.concepts)
    # 收窄读时自愈：父概念后续收窄后，子概念存量收窄自动交集/钳制，前端拿到的永远合法
    normalized = normalized_restrictions(data.concepts)
    return [
        ConceptView(
            **{**c.model_dump(), "attribute_restrictions": normalized.get(c.name, {})},
            inherited_attributes=[
                InheritedAttributeItem(
                    **ra.attribute.model_dump(),
                    inherited_from=ra.inherited_from,
                    restricted=ra.restricted,
                )
                for ra in inherited.get(c.name, [])
            ],
        )
        for c in data.concepts
    ]


@router.put("/{concept_name}/attributes")
async def update_attributes(ontology_id: int, concept_name: str, body: Any):
    """Update the attribute list of a concept.

    兼容两种请求体：
    - 裸数组（历史形态）：只更新自有属性，收窄不变；
    - ``{attributes, attribute_restrictions}``（spec 005）：同时更新继承属性的收窄。
    """
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)

    concept = next((c for c in data.concepts if c.name == concept_name), None)
    if not concept:
        raise NotFoundError("概念不存在")

    if isinstance(body, list):
        attrs_payload, restrictions_payload = body, None
    elif isinstance(body, dict):
        attrs_payload = body.get("attributes") or []
        restrictions_payload = body.get("attribute_restrictions", None)
    else:
        raise InvalidInputError("属性更新请求体格式不正确：应为属性数组或 {attributes, attribute_restrictions}")

    concept.attributes = [AttributeItem(**a) for a in attrs_payload]
    if restrictions_payload is not None:
        # 复用 ConceptItem 的规范化（丢弃空限制、补默认值）
        concept.attribute_restrictions = ConceptItem(
            name=concept.name,
            attribute_restrictions=restrictions_payload,
        ).attribute_restrictions

    # 强耦合校验：status（生命周期状态）属性至多一个、必须 string 且枚举非空（spec 003 FR-004）
    validate_status_attribute(concept.attributes)
    # spec 005：收窄只能作用于继承属性且不能放宽；同名自有声明按继承优先剔除
    validate_restrictions(concept, data)
    strip_conflicting_attributes(concept, data.concepts)
    prune_restrictions(concept, data.concepts)

    save_ontology_data(sc_name, on_name, data)
    return concept.attributes


@router.put("/{concept_name}")
async def update_concept(ontology_id: int, concept_name: str, item: ConceptItem):
    """Update a concept."""
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)

    idx = find_index(data.concepts, concept_name, "概念")
    ensure_unique(data.concepts, item.name, "概念", exclude_name=concept_name)

    validate_sub_class_of(item, data, old_name=concept_name)
    validate_restrictions(item, data)
    strip_conflicting_attributes(item, data.concepts)
    prune_restrictions(item, data.concepts)

    data.concepts[idx] = item
    # 父概念改名 → 级联改写子概念引用，避免悬空（口径 4 的姊妹规则）
    rename_parent_references(data.concepts, concept_name, item.name)
    save_ontology_data(sc_name, on_name, data)
    return item


@router.post("", status_code=201)
async def create_concept(ontology_id: int, item: ConceptItem):
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)

    ensure_unique(data.concepts, item.name, "概念")

    validate_sub_class_of(item, data)
    validate_restrictions(item, data)
    strip_conflicting_attributes(item, data.concepts)
    prune_restrictions(item, data.concepts)

    data.concepts.append(item)
    save_ontology_data(sc_name, on_name, data)
    return item


@router.delete("/{concept_name}")
async def delete_concept(ontology_id: int, concept_name: str):
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)

    idx = find_index(data.concepts, concept_name, "概念")

    data.concepts.pop(idx)

    # Remove from relations that reference this concept
    data.relations = [
        r for r in data.relations
        if r.source != concept_name and r.target != concept_name
    ]
    # 级联清理引用该概念的行为（行为关联概念唯一，故置空即可）。
    # 顺带修掉既有缺陷：原实现对 RuleItem 访问不存在的 related_concepts 会抛 AttributeError → 500，
    # 且规则已改为绑定行为（behavior），不再直接引用概念，故规则侧无需清理。
    for b in data.behaviors:
        if b.concept == concept_name:
            b.concept = ""
            # 关联概念消失 → 状态跃迁失去取值来源，一并清空
            b.from_status = ""
            b.to_status = ""
    # 子概念保留，只清除父引用与依附于父属性的收窄（spec 005 口径 4）
    clear_parent_references(data.concepts, concept_name)

    save_ontology_data(sc_name, on_name, data)
    return {"message": "概念已删除"}
