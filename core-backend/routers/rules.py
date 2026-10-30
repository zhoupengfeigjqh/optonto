"""CRUD API for rules within an ontology."""

import json

from fastapi import APIRouter

from errors import DomainError, InternalError, InvalidInputError

from dependencies import get_ontology_names
from schemas import RuleItem
from services import load_ontology_data, save_ontology_data
from services.entity_crud import ensure_unique, find_index
from services.function_catalog import available_function_names, read_common_functions
from services.inheritance import effective_map
from services.validators import validate_related_functions
from llm_utils import load_env, llm_json

router = APIRouter(prefix="/api/ontologies/{ontology_id}/rules", tags=["规则"])


load_env()


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

    data.rules[idx] = item
    save_ontology_data(sc_name, on_name, data)
    return item


@router.delete("/{rule_name}")
async def delete_rule(ontology_id: int, rule_name: str):
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)

    idx = find_index(data.rules, rule_name, "规则")

    data.rules.pop(idx)
    save_ontology_data(sc_name, on_name, data)
    return {"message": "规则已删除"}


# ─── Smart Generate ─────────────────────────────────────────────────────────

@router.post("/generate")
async def generate_rule(ontology_id: int, body: dict):
    """Use LLM to pick related_functions for a rule from the available function catalog.

    2026-09-30 口径 B：规则约束逻辑 = 关联函数列表（related_functions，可含本体函数与公共函数）；
    其中本体且 type=VALIDATION 者即判断函数（返回 data.pass/reason，运行期真阻断）。
    LLM 依据规则需求从「本体函数 ∪ 公共函数」清单中选择；旧条件树与规则类型生成退役。
    """
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)

    rule_name = body.get("rule_name", "")
    rule_title = body.get("rule_title", "")
    rule_description = body.get("rule_description", "")
    behavior_name = body.get("behavior", "")

    # 1. Collect behavior info（规则绑定行为唯一；带上主体概念与状态跃迁）
    behavior_info = ""
    beh = next((b for b in data.behaviors if b.name == behavior_name), None)
    if beh:
        # 概念属性取有效属性（自有 ∪ 继承，spec 005）：继承属性同样是行为可写字段
        effective = effective_map(data.concepts)
        attrs = []
        for c in [c for c in data.concepts if c.name == beh.concept]:
            for ra in effective.get(c.name, []):
                a = ra.attribute
                origin = "" if ra.inherited_from == c.name else f"，继承自 {ra.inherited_from}"
                attrs.append(f"  {c.name}.{a.name} ({a.type}) — {a.title or a.description or ''}{origin}")
        behavior_info += f"行为：{beh.name} ({beh.title or ''})\n"
        behavior_info += f"描述：{beh.description}\n"
        if beh.concept:
            behavior_info += f"主体概念：{beh.concept}\n"
        if beh.from_status or beh.to_status:
            behavior_info += f"状态跃迁：{beh.from_status or '∅'} → {beh.to_status or '∅'}\n"
        if attrs:
            behavior_info += f"关联概念属性：\n" + "\n".join(attrs) + "\n"
        behavior_info += "\n"

    # 2. Collect the full available function catalog（本体函数 ∪ 公共函数，供 LLM 选择）
    function_info = ""
    for fn in data.functions:
        function_info += f"函数：{fn.name} ({fn.title or ''}) [本体函数，类型 {fn.type or '未标注'}]\n"
        function_info += f"描述：{fn.description}\n"
        function_info += f"输入参数：{json.dumps(fn.params, ensure_ascii=False, default=str)}\n"
        function_info += f"返回结构：{json.dumps(fn.response, ensure_ascii=False, default=str)}\n\n"
    for cf in read_common_functions():
        if not isinstance(cf, dict) or not cf.get("name"):
            continue
        function_info += f"函数：{cf['name']} ({cf.get('title', '')}) [公共函数]\n"
        function_info += f"描述：{cf.get('description', '')}\n"
        function_info += f"返回结构：{json.dumps(cf.get('response', {}), ensure_ascii=False, default=str)}\n\n"

    # 3. Call LLM（从清单中选择关联函数）
    from config import RULE_GENERATE_SYSTEM_PROMPT, RULE_GENERATE_PROMPT

    prompt = RULE_GENERATE_PROMPT.format(
        rule_name=rule_name,
        rule_title=rule_title,
        rule_description=rule_description,
        behavior_info=behavior_info or "（未关联行为）",
        function_info=function_info or "（无可用函数）",
    )

    try:
        result, stripped = await llm_json(RULE_GENERATE_SYSTEM_PROMPT, prompt, 0.3)
        if result is None:
            if stripped is None:
                raise InvalidInputError("未配置 LLM API Key")
            raise InternalError(f"LLM 返回格式异常: {stripped[:200]}")
        # 兜底过滤：只保留真实存在的函数名（LLM 幻觉函数名不透传）
        available = available_function_names(data)
        picked = [f for f in (result.get("related_functions") or []) if isinstance(f, str) and f in available]
        return {"related_functions": picked, "reasoning": result.get("reasoning", "")}
    except DomainError:
        raise
    except Exception as e:
        raise InternalError(f"生成失败: {str(e)}")
