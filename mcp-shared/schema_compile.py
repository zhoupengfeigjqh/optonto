"""params → MCP Tool inputSchema 编译器 + scope 作用域块（迁自 core-backend）。

编译逻辑逐字对应 core services/params_schema.py，唯一差异：概念以 plain dict 访问
（运行面 loaders 不依赖 pydantic）。确定性编译：同输入恒同输出，无 LLM 参与。

scope 块：本体函数/行为工具 schema 前置的作用域块（含所属场景/本体真实值，非输入参数），
供父 Agent 经 listAllMcpFunctions 了解归属；执行路径统一剥离，不传给执行器。
"""

_JSON_TYPES = {"string", "number", "integer", "boolean", "object", "array"}

# scope 作用域块键（含所属场景/本体的真实值，非函数输入参数）。
SCOPE_KEY = "scope"
FUNCTION_SCOPE_KEYS = {SCOPE_KEY}


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
        if not isinstance(c, dict):
            continue
        cname = c.get("name") or ""
        for a in c.get("attributes") or []:
            if not isinstance(a, dict):
                continue
            con = a.get("constraint")
            if not isinstance(con, dict):
                continue
            entry = {
                "enum": list(con["enum"]) if con.get("enum") else None,
                "pattern": con.get("pattern") or None,
                "min": con.get("min"),
                "max": con.get("max"),
            }
            entry = {k: v for k, v in entry.items() if v is not None}
            if not entry:
                continue
            aname = a.get("name")
            if not aname:
                continue
            if aname in attr_map:
                if attr_map[aname] != entry:
                    conflicts.append(f"属性 {aname}（概念 {cname}）约束与先扫到的定义不一致，已取先扫到的")
                continue
            attr_map[aname] = entry
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


def related_concepts(data: dict, names: list[str]) -> list[dict]:
    """按 related_concepts 名解析概念 dict（约束回溯的数据源）。"""
    if not names:
        return []
    wanted = set(names)
    return [c for c in data.get("concepts") or [] if isinstance(c, dict) and c.get("name") in wanted]


def with_function_scope(input_schema: dict, fn: dict, category: str = "本体函数") -> dict:
    """本体函数/行为工具 schema 前置 scope 作用域块（const 带真实值，供规划填子任务对应字段）。

    scope 块放在参数之前；agent-backend 的 listAllMcpFunctions 读出 scope 展示给父 Agent，
    执行路径在调用前剥离 scope，避免污染真实参数。
    category/display_name 为发布方权威标记：agent-backend 据此分类（不再靠特征猜测）。
    """
    props: dict = {
        SCOPE_KEY: {
            "type": "object",
            "description": "本工具所属场景/本体上下文（规划时填子任务对应字段；非输入参数，执行时自动剥离）",
            "properties": {
                "category": {"type": "string", "const": category},
                "name": {"type": "string", "const": fn.get("name") or ""},
                "display_name": {"type": "string", "const": fn.get("display_name") or ""},
            },
        },
    }
    for k, t in (("ontology_id", "integer"), ("scenario_id", "integer"),
                 ("scenario_name", "string"), ("ontology_name", "string")):
        v = fn.get(k)
        if v is not None:
            props[SCOPE_KEY]["properties"][k] = {"type": t, "const": v}
    props.update(input_schema.get("properties", {}))
    return {"type": "object", "properties": props, "required": input_schema.get("required", [])}
