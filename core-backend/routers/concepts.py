"""CRUD API for concepts within an ontology."""

from fastapi import APIRouter, HTTPException

from dependencies import get_ontology_names
from schemas import ConceptItem, AttributeItem
from services import load_ontology_data, save_ontology_data
from services.entity_crud import ensure_unique, find_index
from services.validators import validate_status_attribute

router = APIRouter(prefix="/api/ontologies/{ontology_id}/concepts", tags=["概念"])


@router.get("")
async def list_concepts(ontology_id: int):
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)
    return data.concepts


@router.put("/{concept_name}/attributes")
async def update_attributes(ontology_id: int, concept_name: str, attributes: list[dict]):
    """Update the attribute list of a concept."""
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)

    concept = next((c for c in data.concepts if c.name == concept_name), None)
    if not concept:
        raise HTTPException(status_code=404, detail="概念不存在")

    concept.attributes = [AttributeItem(**a) for a in attributes]
    # 强耦合校验：status（生命周期状态）属性至多一个、必须 string 且枚举非空（spec 003 FR-004）
    validate_status_attribute(concept.attributes)
    save_ontology_data(sc_name, on_name, data)
    return concept.attributes


@router.put("/{concept_name}")
async def update_concept(ontology_id: int, concept_name: str, item: ConceptItem):
    """Update a concept."""
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)

    idx = find_index(data.concepts, concept_name, "概念")
    ensure_unique(data.concepts, item.name, "概念", exclude_name=concept_name)

    data.concepts[idx] = item
    save_ontology_data(sc_name, on_name, data)
    return item


@router.post("", status_code=201)
async def create_concept(ontology_id: int, item: ConceptItem):
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)

    ensure_unique(data.concepts, item.name, "概念")

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

    save_ontology_data(sc_name, on_name, data)
    return {"message": "概念已删除"}
