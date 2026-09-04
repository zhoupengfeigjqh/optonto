"""本体行为/函数 params → MCP Tool inputSchema（JSON Schema）编译器。

声明结构（ontology.yaml `behaviors[].params` / `functions[].params`）：
    {paramName: {type, display_name, description?, example?, required, items?, properties?}}

编译产物是一等 MCP 工具的 inputSchema：
- 参数结构（type/required/嵌套 items/properties）进 schema，参数对 LLM 可见、调用前由 harness 校验；
- 概念属性约束（enum/pattern/min/max）按「参数名 = 属性名」从 related_concepts 回溯合并进 schema
  （build_attr_constraint_map），同名属性取先扫到的，冲突记入 constraint_conflicts 警告（不阻塞）；
- 必填 string 参数附加 minLength: 1——「空串 = 缺失」语义编进 schema（数值型由 type 天然挡住 ""）；
- pattern 按全匹配语义编译（^(?:…)$ 包裹，与历史校验口径一致）。

确定性编译：同输入恒同输出，无 LLM 参与；schema 是契约，本体 yaml 是单一事实源。
"""

_JSON_TYPES = {"string", "number", "integer", "boolean", "object", "array"}


def _map_type(t) -> str:
    """本体类型名 → JSON Schema 类型名；非法/缺失回退 string。"""
    return t if t in _JSON_TYPES else "string"


def build_attr_constraint_map(concepts) -> tuple[dict, list[str]]:
    """概念列表 → ({属性名: {enum/pattern/min/max}}, 冲突警告列表)。

    同名属性取先扫到的（与历史 agent 端校验口径一致）；约束内容不一致时记冲突警告。
    """
    attr_map: dict = {}
    conflicts: list[str] = []
    for c in concepts or []:
        cname = getattr(c, "name", "") or ""
        for a in getattr(c, "attributes", None) or []:
            con = getattr(a, "constraint", None)
            if con is None:
                continue
            entry = {
                "enum": list(con.enum) if con.enum else None,
                "pattern": con.pattern or None,
                "min": con.min,
                "max": con.max,
            }
            entry = {k: v for k, v in entry.items() if v is not None}
            if not entry:
                continue
            if a.name in attr_map:
                if attr_map[a.name] != entry:
                    conflicts.append(f"属性 {a.name}（概念 {cname}）约束与先扫到的定义不一致，已取先扫到的")
                continue
            attr_map[a.name] = entry
    return attr_map, conflicts


def _apply_constraint(schema: dict, constraint: dict | None) -> None:
    """把回溯到的属性约束写进 schema 节点（按节点类型过滤适用关键字）。"""
    if not constraint:
        return
    t = schema.get("type")
    if constraint.get("enum") and "enum" not in schema:
        schema["enum"] = constraint["enum"]
    if constraint.get("pattern") and t == "string" and "pattern" not in schema:
        # 全匹配语义：JSON Schema pattern 是部分匹配，包裹锚点与历史校验口径一致
        schema["pattern"] = f"^(?:{constraint['pattern']})$"
    if t in ("number", "integer"):
        if constraint.get("min") is not None and "minimum" not in schema:
            schema["minimum"] = constraint["min"]
        if constraint.get("max") is not None and "maximum" not in schema:
            schema["maximum"] = constraint["max"]


def _apply_nonempty(props: dict, required: list[str]) -> None:
    """必填 string 参数附加 minLength: 1（空串 = 缺失，编进 schema 由 harness 拦）。"""
    for k in required:
        node = props.get(k)
        if isinstance(node, dict) and node.get("type") == "string" and "minLength" not in node:
            node["minLength"] = 1


def param_spec_to_schema(spec: dict, attr_map: dict | None = None) -> dict:
    """单个参数 spec → JSON Schema 片段（required 由父级聚合，不在此返回）。

    attr_map：概念属性约束回溯表（build_attr_constraint_map 产物），按 key 逐级合并
    （object 的 properties、array 项的 object properties 均生效——与历史 mergeAttrConstraints 同口径）。
    本层节点自身的约束由调用方按节点名应用（本函数不知道自己的名字）。
    """
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
        schema["items"] = param_spec_to_schema(spec["items"], attr_map)
    elif t == "object" and isinstance(spec.get("properties"), dict):
        props: dict = {}
        required: list[str] = []
        for k, v in spec["properties"].items():
            if not isinstance(v, dict):
                continue
            child = param_spec_to_schema(v, attr_map)
            if attr_map:
                _apply_constraint(child, attr_map.get(k))
            props[k] = child
            if v.get("required"):
                required.append(k)
        schema["properties"] = props
        if required:
            schema["required"] = required
            _apply_nonempty(props, required)

    return schema


def params_to_input_schema(params: dict, concepts=None) -> tuple[dict, list[str]]:
    """params dict → (完整 MCP Tool inputSchema, 约束冲突警告列表)。

    前置 ontology_id 必填；concepts 传入时按「参数名 = 属性名」回溯合并属性约束。
    """
    attr_map, conflicts = build_attr_constraint_map(concepts)
    props: dict = {"ontology_id": {"type": "integer", "description": "本体 ID"}}
    required: list[str] = ["ontology_id"]
    for k, v in (params or {}).items():
        if not isinstance(v, dict):
            continue
        node = param_spec_to_schema(v, attr_map)
        if attr_map:
            _apply_constraint(node, attr_map.get(k))
        props[k] = node
        if v.get("required"):
            required.append(k)
    _apply_nonempty(props, required)
    return {"type": "object", "properties": props, "required": required}, conflicts
