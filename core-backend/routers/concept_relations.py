"""CRUD API for concept-level relations（类级公理：SubClassOf / EquivalentClass / DisjointWith）。

口径（2026-10-19）：
- SubClassOf 由概念设计的父子关系自动同步，**不提供增删**
  （POST 拒绝；DELETE 拒绝；PUT 仅允许改「关联概念属性」）；
- 用户可新增的只有 EquivalentClass / DisjointWith（对称关系，反向重复直接拒绝）；
- 概念关系字段 = 对象关系去掉基数（cardinality）。
"""

from fastapi import APIRouter

from dependencies import get_ontology_names
from errors import ConflictError, InvalidInputError, NotFoundError
from schemas import ConceptRelationItem
from services import concept_relations as cr
from services import load_ontology_data, save_ontology_data
from services.validators import validate_concept_relation, validate_link_attributes

router = APIRouter(prefix="/api/ontologies/{ontology_id}/concept-relations", tags=["概念关系"])


def _ensure_name_available(data, name: str, exclude_name: str | None = None) -> None:
    """关系名唯一：概念关系之间、与派生 SubClassOf 行、与对象关系之间都不允许重名。"""
    if not name:
        raise InvalidInputError("概念关系名称不能为空")
    if name == exclude_name:
        return
    if any(r.name == name for r in cr.derived_sub_class_rows(data)):
        raise ConflictError("概念关系名称已被 SubClassOf 派生关系占用")
    if any(r.name == name for r in data.concept_relations):
        raise ConflictError("概念关系名称已存在")
    if any(r.name == name for r in data.relations):
        raise ConflictError("关系名称已存在")


def _stored_name_index(data, name: str) -> int:
    """在可持久化的概念关系（等价/互斥）中定位；找不到抛 404。"""
    for i, r in enumerate(data.concept_relations):
        if r.name == name and r.relation_type != cr.SUB_CLASS_OF:
            return i
    raise NotFoundError("概念关系不存在")


@router.get("", response_model=list[ConceptRelationItem])
async def list_concept_relations(ontology_id: int):
    """概念关系清单：派生的 SubClassOf 在前，用户登记的等价/互斥在后。"""
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)
    return cr.hydrate(data)


@router.post("", status_code=201)
async def create_concept_relation(ontology_id: int, item: ConceptRelationItem):
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)
    # 写操作先自愈：清掉与概念设计失配的 SubClassOf 锚点，避免占用名称/干扰校验
    cr.prune_stale_sub_class_links(data)

    if item.relation_type == cr.SUB_CLASS_OF:
        raise InvalidInputError(
            "SubClassOf 由概念的父子关系自动同步，不能直接新增；请在「概念」页签中修改子概念的父概念"
        )
    if item.relation_type not in cr.USER_ADDABLE_TYPES:
        raise InvalidInputError("概念关系类型只能为 EquivalentClass 或 DisjointWith")

    _ensure_name_available(data, item.name)
    validate_concept_relation(item, data)

    data.concept_relations.append(item)
    save_ontology_data(sc_name, on_name, data)
    return item


@router.put("/{relation_name}")
async def update_concept_relation(ontology_id: int, relation_name: str, item: ConceptRelationItem):
    """更新概念关系。

    - SubClassOf 行：只接受 ``source_attr`` / ``target_attr``（其余字段一律忽略并保持派生值）；
    - 等价/互斥行：全字段更新（类型不可改为 SubClassOf）。
    """
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)
    cr.prune_stale_sub_class_links(data)

    derived = next((r for r in cr.derived_sub_class_rows(data) if r.name == relation_name), None)
    if derived is not None:
        validate_link_attributes(
            data,
            derived.source,
            derived.target,
            item.source_attr,
            item.target_attr,
            label="SubClassOf",
        )
        if (item.source_attr or "").strip() or (item.target_attr or "").strip():
            cr.upsert_sub_class_link(
                data, derived.source, derived.target, item.source_attr, item.target_attr
            )
        else:
            cr.remove_sub_class_link(data, derived.source, derived.target)
        save_ontology_data(sc_name, on_name, data)
        return next(
            (r for r in cr.hydrate(data) if r.name == relation_name),
            derived,
        )

    idx = _stored_name_index(data, relation_name)
    if item.relation_type == cr.SUB_CLASS_OF:
        raise InvalidInputError("SubClassOf 由概念的父子关系自动同步，不能改为此类型")
    if item.relation_type not in cr.USER_ADDABLE_TYPES:
        raise InvalidInputError("概念关系类型只能为 EquivalentClass 或 DisjointWith")

    _ensure_name_available(data, item.name, exclude_name=relation_name)
    validate_concept_relation(item, data, exclude_name=relation_name)

    data.concept_relations[idx] = item
    save_ontology_data(sc_name, on_name, data)
    return item


@router.delete("/{relation_name}")
async def delete_concept_relation(ontology_id: int, relation_name: str):
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)
    cr.prune_stale_sub_class_links(data)

    if any(r.name == relation_name for r in cr.derived_sub_class_rows(data)):
        raise InvalidInputError(
            "SubClassOf 关系由概念设计同步，不能删除；如需解除，请在「概念」页签中清空该子概念的父概念"
        )

    idx = _stored_name_index(data, relation_name)
    data.concept_relations.pop(idx)
    save_ontology_data(sc_name, on_name, data)
    return {"message": "概念关系已删除"}
