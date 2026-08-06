"""CRUD API for rules within an ontology."""

import json

from fastapi import APIRouter, HTTPException

from config import DATA_DIR
from dependencies import get_ontology_names
from schemas import RuleItem
from services import load_ontology_data, save_ontology_data
from services.entity_crud import ensure_unique, find_index
from llm_utils import load_env, llm_json

router = APIRouter(prefix="/api/ontologies/{ontology_id}/rules", tags=["规则"])


load_env()


COMMON_FUNCTIONS_DIR = DATA_DIR / "common_functions"
RULE_TEMPLATE_DIR = DATA_DIR / "rule_template"


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
    """Use LLM to generate rule_detail from rule metadata + behaviors + functions."""
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)

    rule_name = body.get("rule_name", "")
    rule_display_name = body.get("rule_display_name", "")
    rule_type = body.get("rule_type", "")
    rule_description = body.get("rule_description", "")
    related_behaviors = body.get("related_behaviors", [])
    related_functions = body.get("related_functions", [])

    if not rule_type:
        raise HTTPException(status_code=400, detail="规则类型不能为空")

    # 1. Collect behavior info
    behavior_info = ""
    for bname in related_behaviors:
        beh = next((b for b in data.behaviors if b.name == bname), None)
        if not beh:
            continue
        concepts = [c for c in data.concepts if c.name in (beh.related_concepts or [])]
        attrs = []
        for c in concepts:
            for a in (c.attributes or []):
                attrs.append(f"  {c.name}.{a.name} ({a.type}) — {a.display_name or a.description or ''}")
        behavior_info += f"行为：{beh.name} ({beh.display_name or ''})\n"
        behavior_info += f"描述：{beh.description}\n"
        if attrs:
            behavior_info += f"关联概念属性：\n" + "\n".join(attrs) + "\n"
        behavior_info += "\n"

    # 2. Collect function info
    function_info = ""
    for fname in related_functions:
        fn = next((f for f in data.functions if f.name == fname), None)
        if fn:
            function_info += f"函数：{fn.name} ({fn.display_name or ''})\n"
            function_info += f"描述：{fn.description}\n"
            function_info += f"输入参数：{json.dumps(fn.params, ensure_ascii=False, default=str)}\n"
            function_info += f"返回结构：{json.dumps(fn.response, ensure_ascii=False, default=str)}\n\n"
        else:
            # Check common functions
            common_path = COMMON_FUNCTIONS_DIR / "functions.json"
            if common_path.exists():
                try:
                    with open(common_path, encoding="utf-8") as f:
                        common_fns = json.load(f)
                    cf = next((c for c in common_fns if c["name"] == fname), None)
                    if cf:
                        function_info += f"函数：{cf['name']} ({cf.get('display_name', '')}) [公共]\n"
                        function_info += f"描述：{cf.get('description', '')}\n"
                        function_info += f"返回结构：{json.dumps(cf.get('response', {}), ensure_ascii=False, default=str)}\n\n"
                except (json.JSONDecodeError, OSError):
                    pass

    # 3. Find rule template
    rule_template = ""
    for sub_dir in sorted(RULE_TEMPLATE_DIR.iterdir()):
        if not sub_dir.is_dir():
            continue
        for f in sorted(sub_dir.iterdir()):
            if f.suffix == ".json":
                try:
                    with open(f, encoding="utf-8") as fh:
                        tmpl = json.load(fh)
                    if tmpl.get("ruleName") == rule_type:
                        rule_template = json.dumps(tmpl, ensure_ascii=False, indent=2)
                        break
                except (json.JSONDecodeError, OSError):
                    continue
        if rule_template:
            break

    if not rule_template:
        raise HTTPException(status_code=400, detail=f"未找到规则类型 '{rule_type}' 的模板")

    # 4. Call LLM
    from config import RULE_GENERATE_SYSTEM_PROMPT, RULE_GENERATE_PROMPT

    prompt = RULE_GENERATE_PROMPT.format(
        rule_name=rule_name,
        rule_display_name=rule_display_name,
        rule_type=rule_type,
        rule_description=rule_description,
        behavior_info=behavior_info or "（未关联行为）",
        function_info=function_info or "（未关联函数）",
        rule_template=rule_template,
    )

    try:
        rule_detail, stripped = await llm_json(RULE_GENERATE_SYSTEM_PROMPT, prompt, 0.3)
        if rule_detail is None:
            if stripped is None:
                raise HTTPException(status_code=400, detail="未配置 LLM API Key")
            raise HTTPException(status_code=500, detail=f"LLM 返回格式异常: {stripped[:200]}")
        return {"rule_detail": rule_detail}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"生成失败: {str(e)}")
