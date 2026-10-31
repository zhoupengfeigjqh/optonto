"""规则设计（rules[].rule_design）的纯计算（spec 007）。

职责唯一来源：**函数返回结构 → 可选字段路径**。设计期表达，运行期（agent / MCP）不消费，
故本模块不引入任何运行面或 FastAPI 依赖，可直接单测。

返回结构两种形态同解（与 ``routers/rules.py`` 曾经喂给 LLM 的口径一致）：

1. 本体函数：``response`` 直接是属性映射 ``{pass: {type: boolean}}``；
2. 公共函数：``response`` 是 JSON Schema ``{type: object, properties: {...}}``，先解包 ``properties``；
3. 递归：节点含 ``properties`` 继续下钻；``type=array`` 且 ``items.properties`` → 路径追加 ``[]`` 后下钻。
"""

from __future__ import annotations

from typing import Any

from schemas import RULE_OPERATOR_ARITY, RULE_OPERATOR_FIELD_TYPES

# 设计约束（与前端 rule-design.ts 常量逐项一致，改一处必须同改另一侧）
MAX_GROUPS = 5
MAX_CONDITIONS_PER_GROUP = 5
MAX_MESSAGE_LEN = 30


def response_properties(response: Any) -> dict:
    """函数返回结构 → 顶层属性映射（两种形态同解，非法输入 → 空映射）。"""
    if not isinstance(response, dict):
        return {}
    props = response.get('properties')
    if isinstance(props, dict) and response.get('type') == 'object':
        return props
    return response


def resolve_field(response: Any, path: str) -> dict | None:
    """按路径取返回结构中的字段节点（``a.b`` / ``items[].c``）；解析失败 → None。"""
    if not path:
        return None
    node_map: Any = response_properties(response)
    node: dict | None = None
    for segment in path.split('.'):
        is_array = segment.endswith('[]')
        name = segment[:-2] if is_array else segment
        if not isinstance(node_map, dict) or name not in node_map:
            return None
        node = node_map[name]
        if not isinstance(node, dict):
            return None
        if is_array:
            items = node.get('items')
            if not isinstance(items, dict):
                return None
            node = items
        node_map = node.get('properties') or {}
    return node


def field_paths(response: Any) -> list[str]:
    """返回结构里全部可选字段路径（含数组层 ``items[].x``），顺序与声明一致。"""
    out: list[str] = []

    def walk(props: Any, prefix: str) -> None:
        if not isinstance(props, dict):
            return
        for name, node in props.items():
            if not isinstance(node, dict):
                continue
            path = f"{prefix}.{name}" if prefix else name
            out.append(path)
            walk(node.get('properties'), path)
            items = node.get('items')
            if isinstance(items, dict):
                walk(items.get('properties'), path + '[]')

    walk(response_properties(response), '')
    return out


def operators_for_type(field_type: str) -> list[str]:
    """字段类型可用的运算符码（顺序 = `RULE_OPERATOR_ARITY` 声明顺序；未声明类型 = 全集）。"""
    codes: list[str] = []
    for code in RULE_OPERATOR_ARITY:
        allowed = RULE_OPERATOR_FIELD_TYPES.get(code)
        if not allowed or not field_type or field_type in allowed:
            codes.append(code)
    return codes


def designable_fields(response: Any) -> list[dict]:
    """返回结构 → 可设计字段清单（path/label/type/operators）。

    供智能生成提示词与前端字段下拉共用同一口径：字段可选范围 = 函数自己声明的返回结构。
    """
    fields: list[dict] = []
    for path in field_paths(response):
        node = resolve_field(response, path) or {}
        field_type = str(node.get('type') or '')
        fields.append({
            'path': path,
            'label': str(node.get('title') or path.split('.')[-1]),
            'type': field_type,
            'operators': operators_for_type(field_type),
        })
    return fields


def default_value_for_type(field_type: str) -> str:
    """按字段类型给默认取值（与前端 `defaultValueForType` 一致：布尔 true / 数值 0 / 其余空白）。"""
    if field_type == 'boolean':
        return 'true'
    if field_type in ('number', 'integer'):
        return '0'
    return ''


def truncate_message(text: str, limit: int = MAX_MESSAGE_LEN) -> str:
    """按码点截断结果说明（与前端 `truncateChars` 同口径）。"""
    return ''.join(list(text or '')[:limit])
