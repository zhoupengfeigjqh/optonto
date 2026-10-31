"""CRUD API for rules within an ontology."""

from fastapi import APIRouter

from dependencies import get_ontology_names
from errors import InvalidInputError
from schemas import RuleDesignGenerateRequest, RuleDesignGenerateResponse, RuleItem
from services import load_ontology_data, save_ontology_data
from services.entity_crud import ensure_unique, find_index
from services.function_catalog import available_function_names
from services.rule_design_generate import generate_rule_design
from services.validators import validate_related_functions, validate_rule_design

router = APIRouter(prefix="/api/ontologies/{ontology_id}/rules", tags=["规则"])


@router.get("")
async def list_rules(ontology_id: int):
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)
    return data.rules


@router.post("", status_code=201)
async def create_rule(ontology_id: int, item: RuleItem):
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)

    ensure_unique(data.rules, item.name, "规则")
    # 强耦合校验：关联函数必须存在（2026-09-30 口径 B）
    validate_related_functions(item, data, available_function_names(data))
    # 规则设计（spec 007）：函数限关联函数、字段/运算符/取值自洽
    validate_rule_design(item, data)

    data.rules.append(item)
    save_ontology_data(sc_name, on_name, data)
    return item


@router.put("/{rule_name}")
async def update_rule(ontology_id: int, rule_name: str, item: RuleItem):
    """Update a rule."""
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)

    idx = find_index(data.rules, rule_name, "规则")
    ensure_unique(data.rules, item.name, "规则", exclude_name=rule_name)
    validate_related_functions(item, data, available_function_names(data))
    validate_rule_design(item, data)

    data.rules[idx] = item
    save_ontology_data(sc_name, on_name, data)
    return item


@router.post("/design/generate", response_model=RuleDesignGenerateResponse)
async def generate_design(ontology_id: int, body: RuleDesignGenerateRequest):
    """智能生成规则设计草稿（spec 008）：上下文 = 规则描述 + 该规则的**全部**关联函数。

    只读端点：不落盘；返回的 `rule_design` 已按保存路径同口径校验，由人工在弹窗确认后随规则保存。
    与已退役的 `rules/generate`（从全量函数里选函数）不是同一件事。
    """
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)

    if not body.related_functions:
        raise InvalidInputError("请先选择关联函数")
    probe = RuleItem(
        name=body.rule_name or '__preview__',
        title=body.title,
        description=body.description,
        position=body.position,
        behavior=body.behavior,
        related_functions=body.related_functions,
    )
    validate_related_functions(probe, data, available_function_names(data))
    result = await generate_rule_design(probe, data)
    return RuleDesignGenerateResponse(**result)


@router.delete("/{rule_name}")
async def delete_rule(ontology_id: int, rule_name: str):
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)

    idx = find_index(data.rules, rule_name, "规则")

    data.rules.pop(idx)
    save_ontology_data(sc_name, on_name, data)
    return {"message": "规则已删除"}
