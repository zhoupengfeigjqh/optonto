"""规则设计智能生成（spec 008）——上下文组装 / LLM 调用 / 解析 / 修边 / 校验。

职责内聚在此一处，路由只做参数校验与编排：
1. `build_function_context`：把该规则**全部**关联函数的可设计字段与可用运算符压成文本；
2. `repair_generated_design`：对 LLM 输出做确定性修边（纯函数，可单测），保证结果要么可保存、
   要么明确失败——绝不把脏设计塞回前端；
3. `generate_rule_design`：唯一对外入口，只读本体数据，**不落盘**。

与已退役的 `rules/generate`（从全量函数里选函数）不是同一件事：这里的函数已由人工选定。
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from typing import Any

from errors import InvalidInputError, InternalError
from llm_utils import llm_json, load_env
from prompts import RULE_DESIGN_GENERATE_PROMPT, RULE_DESIGN_GENERATE_SYSTEM_PROMPT
from schemas import (
    RULE_OPERATOR_ARITY,
    OntologyData,
    RuleConditionGroupItem,
    RuleConditionItem,
    RuleDesignItem,
    RuleItem,
)
from services.function_catalog import read_common_functions
from services.rule_design import (
    MAX_CONDITIONS_PER_GROUP,
    MAX_GROUPS,
    MAX_MESSAGE_LEN,
    default_value_for_type,
    designable_fields,
    operators_for_type,
    resolve_field,
    truncate_message,
)
from services.validators import validate_rule_design

load_env()

logger = logging.getLogger(__name__)

# LLM 端点口径（spec 008 FR-006）：目标 P95 ≤ 20s，硬超时 60s
GENERATE_TIMEOUT_SECONDS = 60
GENERATE_TEMPERATURE = 0.2


def function_catalog(data: OntologyData) -> dict[str, Any]:
    """函数名 → 函数对象（本体 ∪ 公共），用于取返回结构。"""
    catalog: dict[str, Any] = {f.name: f for f in data.functions if f.name}
    for cf in read_common_functions():
        if not isinstance(cf, dict):
            continue
        name = cf.get('name')
        if name and str(name) not in catalog:
            catalog[str(name)] = cf
    return catalog


def _fn_field(fn: Any, key: str, default: Any = None) -> Any:
    """兼容本体函数（Pydantic 对象）与公共函数（dict）两种形态。"""
    if isinstance(fn, dict):
        return fn.get(key, default)
    return getattr(fn, key, default)


def build_function_context(rule: RuleItem, data: OntologyData) -> tuple[str, list[str]]:
    """组装**全部**关联函数的上下文，返回 (文本, warnings)。

    每个函数给出可设计字段清单（path / 类型 / 中文名 / 可用运算符码），未声明返回结构的函数
    明确标注并记 warning——这类函数无法作为判断依据。
    """
    catalog = function_catalog(data)
    warnings: list[str] = []
    blocks: list[str] = []

    for index, name in enumerate(rule.related_functions or [], 1):
        fn = catalog.get(name)
        if fn is None:
            warnings.append(f"关联函数 {name} 不存在，已跳过")
            continue

        title = _fn_field(fn, 'title', '') or ''
        fn_type = _fn_field(fn, 'type', '') or ('公共函数' if isinstance(fn, dict) else '未标注')
        description = _fn_field(fn, 'description', '') or ''
        concepts = _fn_field(fn, 'related_concepts', None) or []
        response = _fn_field(fn, 'response', None) or {}

        lines = [
            f"{index}. 函数名：{name}",
            f"   中文名：{title or '（无）'}",
            f"   类型：{fn_type}",
            f"   描述：{description or '（无）'}",
        ]
        if concepts:
            lines.append(f"   关联概念：{'、'.join(str(c) for c in concepts)}")

        fields = designable_fields(response)
        if not fields:
            warnings.append(f"函数 {name} 未声明返回结构，已跳过（不能作为判断依据）")
            lines.append("   可用条件字段：无（该函数未声明返回结构，禁止用它设计条件）")
        else:
            lines.append("   可用条件字段（字段路径 | 类型 | 中文名 → 可用运算符码）：")
            for field in fields:
                lines.append(
                    f"     - {field['path']} | {field['type'] or '未声明'} | {field['label']}"
                    f" → {'/'.join(field['operators'])}"
                )
        blocks.append("\n".join(lines))

    return "\n\n".join(blocks), warnings


def build_prompt(rule: RuleItem, function_info: str) -> str:
    return RULE_DESIGN_GENERATE_PROMPT.format(
        rule_name=rule.name or '（未命名）',
        rule_title=rule.title or '（无）',
        rule_description=rule.description or '（描述缺失）',
        rule_position=rule.position or '（未设）',
        rule_behavior=rule.behavior or '（未绑定行为）',
        function_info=function_info or '（该规则未关联任何函数，无法生成条件）',
    )


def _fit_values(raw_values: Any, operator: str, field_type: str) -> tuple[list[str], bool]:
    """按运算符裁剪/补齐取值；返回 (values, 是否做过校正)。"""
    arity = RULE_OPERATOR_ARITY[operator]
    if arity == 0:
        return [], bool(raw_values)

    items: list[str] = []
    if isinstance(raw_values, (list, tuple)):
        items = [str(v) for v in raw_values if v is not None]
    elif raw_values is not None and str(raw_values).strip() != '':
        items = [str(raw_values)]

    default = default_value_for_type(field_type)
    if arity == 1:
        return [items[0] if items else default], len(items) != 1
    if arity == 2:
        values = [items[0] if items else default, items[1] if len(items) > 1 else default]
        return values, len(items) != 2

    kept = [v for v in items if v.strip() != ''] or [default]
    return kept, len(kept) != len(items)


def _repair_condition(
    raw: Any,
    related: list[str],
    response_of,
) -> tuple[RuleConditionItem | None, list[str]]:
    """单条条件修边：函数/字段必须真实，运算符不适配则替换，取值按个数校正。"""
    notes: list[str] = []
    if not isinstance(raw, dict):
        return None, ["生成结果中存在非对象的条件，已忽略"]

    name = str(raw.get('function') or '').strip()
    if not name:
        return None, ["有一条条件未指定函数，已忽略"]
    if name not in related:
        return None, [f"函数 {name} 不在该规则的关联函数中，已忽略该条件"]

    response = response_of(name)
    field = str(raw.get('field') or '').strip()
    node = resolve_field(response, field)
    if node is None:
        return None, [f"函数 {name} 未声明返回字段 {field or '（空）'}，已忽略该条件"]

    field_type = str(node.get('type') or '')
    allowed = operators_for_type(field_type)
    operator = str(raw.get('operator') or '').strip().lower()
    if operator not in RULE_OPERATOR_ARITY:
        operator = allowed[0] if allowed else ''
        notes.append(f"函数 {name} 字段 {field} 的运算符缺失或非法，已改为 {operator}")
    elif operator not in allowed:
        replacement = allowed[0] if allowed else ''
        notes.append(
            f"函数 {name} 字段 {field}（{field_type}）不支持运算符 {operator}，已改为 {replacement}"
        )
        operator = replacement
    if not operator:
        return None, notes + [f"函数 {name} 字段 {field} 没有可用运算符，已忽略该条件"]

    values, corrected = _fit_values(raw.get('values'), operator, field_type)
    if corrected:
        notes.append(f"函数 {name} 字段 {field} 的取值个数已按运算符 {operator} 校正")

    return RuleConditionItem(
        function=name, field=field, operator=operator, values=values,
    ), notes


def _repair_message(raw: Any, label: str) -> tuple[str, list[str]]:
    text = str(raw or '').strip()
    if not text:
        return '', [f"{label}的结果说明缺失"]
    clipped = truncate_message(text)
    if len(list(text)) > MAX_MESSAGE_LEN:
        return clipped, [f"{label}的结果说明超过 {MAX_MESSAGE_LEN} 字，已截断"]
    return clipped, []


def repair_generated_design(
    raw: Any,
    rule: RuleItem,
    data: OntologyData,
) -> tuple[RuleDesignItem | None, list[str], int]:
    """把 LLM 原始输出修成可保存的 `RuleDesignItem`（纯函数）。

    返回 (design | None, warnings, dropped_conditions)；design 为 None 表示无任何有效条件。
    """
    warnings: list[str] = []
    dropped = 0

    if not isinstance(raw, dict):
        return None, ["生成结果不是 JSON 对象"], 0
    raw_groups = raw.get('groups')
    if not isinstance(raw_groups, list):
        return None, ["生成结果缺少条件组"], 0

    related = [f for f in (rule.related_functions or []) if f]
    catalog = function_catalog(data)

    def response_of(name: str) -> Any:
        fn = catalog.get(name)
        return None if fn is None else _fn_field(fn, 'response', None)

    groups: list[RuleConditionGroupItem] = []
    truncated_groups = 0
    for raw_group in raw_groups:
        if len(groups) >= MAX_GROUPS:
            truncated_groups += 1
            continue
        if not isinstance(raw_group, dict):
            dropped += 1
            continue
        raw_conditions = raw_group.get('conditions')
        if not isinstance(raw_conditions, list):
            continue

        conditions: list[RuleConditionItem] = []
        for raw_condition in raw_conditions:
            if len(conditions) >= MAX_CONDITIONS_PER_GROUP:
                warnings.append(f"某个条件组的条件超过 {MAX_CONDITIONS_PER_GROUP} 条，已截断")
                break
            condition, notes = _repair_condition(raw_condition, related, response_of)
            warnings.extend(notes)
            if condition is None:
                dropped += 1
                continue
            conditions.append(condition)

        if not conditions:
            if raw_conditions:
                warnings.append("某个条件组的条件全部无效，已丢弃该组")
            continue

        combine = str(raw_group.get('combine') or 'and').strip().lower()
        if combine not in ('and', 'or'):
            warnings.append("某个条件组的组内组合方式非法，已按 and 处理")
            combine = 'and'
        groups.append(RuleConditionGroupItem(combine=combine, conditions=conditions))

    if truncated_groups:
        warnings.append(f"条件组超过 {MAX_GROUPS} 个，已截断 {truncated_groups} 组")
    if not groups:
        return None, warnings, dropped

    combine = str(raw.get('combine') or 'and').strip().lower()
    if combine not in ('and', 'or'):
        warnings.append("组间组合方式非法，已按 and 处理")
        combine = 'and'

    pass_message, pass_notes = _repair_message(raw.get('pass_message'), '条件成立')
    fail_message, fail_notes = _repair_message(raw.get('fail_message'), '条件不成立')
    warnings.extend(pass_notes + fail_notes)

    design = RuleDesignItem(
        combine=combine,
        groups=groups,
        pass_message=pass_message,
        fail_message=fail_message,
    )
    return design, warnings, dropped


async def generate_rule_design(rule: RuleItem, data: OntologyData) -> dict:
    """智能生成规则设计草稿（唯一入口）：不落盘，返回 {rule_design, warnings, ...}。"""
    function_info, context_warnings = build_function_context(rule, data)
    prompt = build_prompt(rule, function_info)
    model = os.environ.get('LLM_MODEL', 'deepseek-chat')
    started = time.monotonic()

    try:
        result, stripped = await asyncio.wait_for(
            llm_json(RULE_DESIGN_GENERATE_SYSTEM_PROMPT, prompt, GENERATE_TEMPERATURE),
            timeout=GENERATE_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError:
        raise InvalidInputError(f"生成超时（{GENERATE_TIMEOUT_SECONDS}s），请重试")
    except Exception as exc:  # LLM 网络/鉴权等系统级异常
        raise InternalError(f"生成失败: {exc}")

    if result is None:
        if stripped is None:
            raise InternalError("未配置 LLM API Key，无法智能生成")
        raise InvalidInputError("生成结果格式异常，请重试")

    design, repair_warnings, dropped = repair_generated_design(result, rule, data)
    warnings = context_warnings + repair_warnings
    if design is None:
        raise InvalidInputError("未能生成可用条件，请补充规则描述后重试")

    # 终校验：与保存路径同口径，确保生成物必定可保存
    try:
        validate_rule_design(rule.model_copy(update={'rule_design': design}), data)
    except InvalidInputError as exc:
        raise InvalidInputError(f"生成结果未通过校验：{exc}")

    elapsed_ms = int((time.monotonic() - started) * 1000)
    logger.info(
        "rule_design.generated rule=%s functions=%d model=%s elapsed_ms=%d dropped=%d warnings=%d",
        rule.name, len(rule.related_functions or []), model, elapsed_ms, dropped, len(warnings),
    )

    return {
        'rule_design': design,
        'warnings': warnings,
        'dropped_conditions': dropped,
        'model': model,
        'elapsed_ms': elapsed_ms,
    }
