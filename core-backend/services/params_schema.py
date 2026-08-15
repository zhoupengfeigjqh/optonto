"""本体函数 params → MCP Tool inputSchema（JSON Schema）转换。

本体函数 params 结构（ontology.yaml `functions[].params`）：
    {paramName: {type, display_name, description?, example?, required, items?, properties?}}
与行为 params 同构。转换目标是 MCP Tool 的 inputSchema（JSON Schema），
用于把本体函数注册为一等 MCP 工具（参数在工具 schema 中可见），
替代原 executeOntoFunction 黑盒包装（params 是 object、参数不可见）。
"""

_JSON_TYPES = {"string", "number", "integer", "boolean", "object", "array"}


def _map_type(t) -> str:
    """本体类型名 → JSON Schema 类型名；非法/缺失回退 string。"""
    return t if t in _JSON_TYPES else "string"


def param_spec_to_schema(spec: dict) -> dict:
    """单个参数 spec → JSON Schema 片段（required 由父级聚合，不在此返回）。"""
    t = _map_type(spec.get("type"))
    schema: dict = {"type": t}

    # 可读说明：展示名（或描述）优先，示例拼进 description（比 examples 关键字兼容性更好）。
    label = spec.get("display_name") or spec.get("description") or ""
    example = spec.get("example")
    parts: list[str] = []
    if label:
        parts.append(str(label))
    if example is not None and str(example) != "":
        parts.append(f"示例: {example}")
    if parts:
        schema["description"] = "，".join(parts)

    if t == "array" and isinstance(spec.get("items"), dict):
        schema["items"] = param_spec_to_schema(spec["items"])
    elif t == "object" and isinstance(spec.get("properties"), dict):
        props: dict = {}
        required: list[str] = []
        for k, v in spec["properties"].items():
            if not isinstance(v, dict):
                continue
            props[k] = param_spec_to_schema(v)
            if v.get("required"):
                required.append(k)
        schema["properties"] = props
        if required:
            schema["required"] = required

    return schema


def params_to_input_schema(params: dict) -> dict:
    """本体函数 params dict → 完整 MCP Tool inputSchema（前置 ontology_id 必填）。"""
    props: dict = {"ontology_id": {"type": "integer", "description": "本体 ID"}}
    required: list[str] = ["ontology_id"]
    for k, v in (params or {}).items():
        if not isinstance(v, dict):
            continue
        props[k] = param_spec_to_schema(v)
        if v.get("required"):
            required.append(k)
    return {"type": "object", "properties": props, "required": required}
