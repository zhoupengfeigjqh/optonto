"""params → MCP Tool inputSchema 编译器 + 工具发布契约（本模块是**唯一权威**）。

2026-10-01 收口：core 侧的同源副本 `services/params_schema.py` 及其两个消费端点
（`/api/ontologies/functions/all`、`/api/ontologies/behaviors/all`）已删除——运行面自发布后
core 不再需要聚合编译，留着就是"同一语义两处实现"（且 core 版 `behaviors/all` 还带着已废弃的
`onto{ontology_id}__` 前缀消歧命名，与契约 §⑤ 直接冲突）。概念以 plain dict 访问
（运行面 data_store 不依赖 pydantic）。确定性编译：同输入恒同输出，无 LLM 参与。

── 工具发布契约（消费端 agent-backend/src/agent/tool-catalog.ts 按此实现）──────────

**① 分类标记（单一来源：JSON Schema 扩展键，协议透传、不进 properties）**
- ``x-category``：工具类别（五类之一，见下表）；**不再使用 scope 内的 category**（同一语义只允许一种表达）
- ``x-display_name``：发布方权威中文名（同理，不再放 scope）

| x-category | 归位 | 性质 |
|---|---|---|
| 本体行为 | 本体内 | 执行：外部系统集成（走映射翻译 + 下游 MCP） |
| 本体函数 | 本体内 | 执行：本地沙箱（可作判断函数，返回统一信封） |
| 本体查询 | 本体内/全局 | 元数据查询（父 Agent 专用；不进子任务可规划清单） |
| 公共函数 | 全局 | 执行：本地沙箱 |
| （其他MCP工具） | 外部 | 消费端兜底值：**无标记**的工具，发布端不使用该值 |

**② 本体上下文块（scope）**：仅「本体执行类」（本体行为/本体函数）携带——表示"该工具是某本体的
执行入口，调用时必须锁定到该本体"。只含上下文键（``name`` + ``ontology_id``/``scenario_id``/
``scenario_name``/``ontology_name`` 的真实值），**不含分类标记**；执行前由 ``strip_system_params``
剥离，绝不进入业务参数。

**③ 参数契约**

| 类别 | ``ontology_id`` | ``scope`` | 执行前剥离 |
|---|---|---|---|
| 本体行为 / 本体函数 | **必填**（schema.required + require_ontology_id 双保险） | 有 | 剥 |
| 本体查询：``listOnto*`` | **必填** | 无 | 无需（无系统参数） |
| 本体查询：``listScenarios`` / ``listOntologies`` | 无（全局花名册，不针对某本体） | 无 | — |
| 公共函数 | 无 | 无 | 剥（防御性：schema 本就没有这些键） |
| 其他 MCP 工具 | 无 | 无 | 原样透传 |

**④ 归属一致性（执行期）**：本体执行类工具名是裸名（不带本体前缀），故服务端在路由前校验
「**发布方声明的归属**（本体执行的 ``scope.const.ontology_id`` / 行为条目的 ``ontology_id``）」
== 「**调用方传入的**顶层 ``ontology_id``」——不等即拒（``require_ontology_match``，报错文案含
双方 id 与本体的中文名，供调用方/LLM 自纠）；声明缺失则放行（老数据 / 设计期 REST 入口缓存未命中，
不误伤）。这是 ③ 必填口径的下一句：**必填且必须填对**。

⑤ 命名：本体执行类与公共函数一律**工具名 = 裸名**（行为名 / 函数名，不带本体前缀）；本体归属只由
``ontology_id`` 决定（跨本体重名由发布端记错误并保留先出现者，不做前缀消歧）。

**⑥ 就绪发布（行为工具）**：行为**只有在映射完成、真能执行时才发布为工具**——工具清单即对 LLM 的
可调用承诺，"清单里有、调用必失败"就是违约（LLM 会规划它、重试它、烧掉报错预算）。就绪判据见
``is_engine_ready``：``data_engines[]`` 中存在 ``behavior_name`` 匹配的引擎、``engine_type`` 缺省/
``MCP``（其余类型已删除，executor 会报错）、``target.server_url`` 与 ``target.tool_name`` 非空
（与 agent 侧 visibility-guard 收编同口径）。未就绪的行为**从发布面剔除**并记数（设计器仍看得到），
**规划面按同一判据拒绝**（agent 侧对应 ``OntologyGateway.getReadyBehaviorNames``）——两侧同源，
否则会造出"能规划、挂不上"的含糊失败。
"""

_JSON_TYPES = {"string", "number", "integer", "boolean", "object", "array"}

# ─── 分类标记（单一来源；x- 扩展键，协议透传）────────────────────────────────────
CATEGORY_KEY = "x-category"
DISPLAY_NAME_KEY = "x-display_name"

CATEGORY_BEHAVIOR = "本体行为"
CATEGORY_FUNCTION = "本体函数"
CATEGORY_QUERY = "本体查询"
CATEGORY_COMMON = "公共函数"
# 消费端兜底值（无标记 = 外部工具）；发布端不使用
CATEGORY_EXTERNAL = "其他MCP工具"

# ─── 本体上下文块与系统参数 ────────────────────────────────────────────────────
SCOPE_KEY = "scope"
# 系统参数（非业务输入，执行前一律剥离）：本体上下文块 + 路由用 ontology_id
SYSTEM_PARAMS = frozenset({SCOPE_KEY, "ontology_id"})


def require_ontology_id(value, label: str):
    """ontology_id 是调用契约的必填项（MCP schema 的 required 与 REST 入口同一口径）。

    缺失或空串一律报错，**不按发布时记录的本体回退**：调用方必须显式声明在操作哪个本体——
    跨本体的行为/函数同名时（工具名不带本体前缀），回退会静默路由到错误本体。
    """
    if value is None or value == "":
        raise ValueError(f"{label} 缺少 ontology_id")
    return value


def require_ontology_match(declared_owner, requested_owner, label: str, owner_label: str = ""):
    """归属一致性（契约 ④）：工具**发布时声明的归属本体**必须等于调用方指定的路由本体。

    ``declared_owner`` 是发布期从本体数据取的权威快照（本体执行的 ``scope.const.ontology_id`` /
    行为条目的 ``ontology_id``）；``requested_owner`` 是调用方传入的顶层 ``ontology_id``；
    ``owner_label`` 是发布方归属的可读描述（``owner_label()`` 的产物），只用于报错文案。
    工具名是裸名（不带本体前缀），两者不等而放行 = 同名工具被挂到另一个本体上执行
    （行为侧跨本体重名可构造：executor 按 ``(ontology_id, 行为名)`` 直接查，绕过发布期去重）。

    - ``declared_owner`` 缺失（``None``/空串）→ **放行**：发布方未声明归属（老数据 / 设计期 REST
      入口缓存未命中），不误伤；
    - 数值按整数比较，兼容 ``1`` / ``"1"`` / ``1.0`` 三种表示。
    """
    if declared_owner is None or declared_owner == "":
        return requested_owner
    if declared_owner == requested_owner:
        return requested_owner
    try:
        if int(declared_owner) == int(requested_owner):
            return requested_owner
    except (TypeError, ValueError):
        pass
    where = owner_label or f"ontology_id={declared_owner}"
    raise ValueError(
        f"{label} 归属校验失败：该工具属于{where}，但调用方指定的是 ontology_id={requested_owner}；"
        f"同名工具不得跨本体调用——若确实要操作 ontology_id={requested_owner}，请改用属于该本体的工具。"
    )


def owner_label(item: dict | None) -> str:
    """发布方归属的可读描述（本体中文名 + id + 场景）——``require_ontology_match`` 的报错文案用。

    报错的主要读者是调用方 LLM：只给 id 它无法判断"是不是我这轮理解错了"，给出中文名与场景后
    调用方/LLM 可直接定位并自纠。
    """
    if not item or not item.get("ontology_name"):
        return ""
    scenario = item.get("scenario_name")
    scenario_part = f"，场景「{scenario}」" if scenario else ""
    return f"本体「{item['ontology_name']}」(ontology_id={item.get('ontology_id')}{scenario_part})"


def strip_system_params(arguments: dict | None) -> dict:
    """剥离系统参数（scope 上下文块 + ontology_id），只留业务参数。

    三类发布端共用同一实现：本体函数/行为（执行前剥）、公共函数（防御性剥——
    其 schema 本就没有这些键，避免外部调用方多传后污染函数 params）。
    """
    return {k: v for k, v in (arguments or {}).items() if k not in SYSTEM_PARAMS}


# ─── 行为就绪判据（契约 ⑥；发布面剔除与规划面拒绝的同一把尺）──────────────────────

def is_engine_ready(engine: dict | None) -> bool:
    """单条数据引擎是否**可用**（映射已完成、真能调到下游）。

    判据 = ① ``engine_type`` 缺省或 ``MCP``（缺省即 MCP；其余类型已删除，executor 会显式报错）；
    ② ``target.server_url`` 与 ``target.tool_name`` 都非空白。与 agent 侧 visibility-guard 的收编
    口径同源：缺 target 的引擎既不接管下游原始工具，也不该让行为工具出现在清单里。
    """
    if not isinstance(engine, dict):
        return False
    et = engine.get("engine_type")
    if et and et != "MCP":
        return False
    target = engine.get("target") or {}
    return bool(str(target.get("server_url") or "").strip()
                and str(target.get("tool_name") or "").strip())


def ready_behavior_names(data: dict) -> set[str]:
    """本体数据 → **就绪行为名**集合（可发布为工具的行为）。

    就绪 = 存在 ``behavior_name`` 匹配的可用引擎（见 ``is_engine_ready``）。未就绪行为不发布：
    工具清单是对 LLM 的可调用承诺，未实现即违约（契约 ⑥）。
    """
    ready: set[str] = set()
    for engine in (data or {}).get("data_engines") or []:
        if not is_engine_ready(engine):
            continue
        name = engine.get("behavior_name")
        if name:
            ready.add(str(name))
    return ready


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


def with_category(input_schema: dict, category: str, display_name: str = "") -> dict:
    """注入分类标记（``x-category`` / ``x-display_name``）——工具分类的唯一来源。"""
    marked = dict(input_schema or {})
    marked[CATEGORY_KEY] = category
    if display_name:
        marked[DISPLAY_NAME_KEY] = display_name
    return marked


def build_query_schema(extra_properties: dict | None = None, *,
                       requires_ontology: bool = True) -> dict:
    """本体查询工具 inputSchema：``ontology_id``（必填）+ 可选过滤参数。

    全局花名册（listScenarios / listOntologies）传 ``requires_ontology=False``——
    它们不针对某个本体，故无此参数。
    """
    props: dict = {}
    required: list[str] = []
    if requires_ontology:
        props["ontology_id"] = {"type": "integer", "description": "本体 ID"}
        required.append("ontology_id")
    props.update(extra_properties or {})
    return {"type": "object", "properties": props, "required": required}


def with_ontology_context(input_schema: dict, fn: dict, category: str) -> dict:
    """本体执行类工具（本体行为 / 本体函数）：注入本体上下文块 ``scope`` + 分类标记。

    scope 块置参数之前、**只含上下文键**（``name`` + 场景/本体真实值，全 const），用途：
    - 父 Agent 经 ``listPlannableFunctions`` 了解归属、填子任务 scenario/ontology 字段；
    - 子 Agent 挂载期据 ``scope.name`` 做挂载过滤 / disable 闸 / 展示回溯；
    执行前由 ``strip_system_params`` 剥离（非输入参数）。
    """
    ctx: dict = {"name": {"type": "string", "const": fn.get("name") or ""}}
    for k, t in (("ontology_id", "integer"), ("scenario_id", "integer"),
                 ("scenario_name", "string"), ("ontology_name", "string")):
        v = fn.get(k)
        if v is not None:
            ctx[k] = {"type": t, "const": v}
    props: dict = {
        SCOPE_KEY: {
            "type": "object",
            "description": "本工具所属场景/本体上下文（规划时填子任务对应字段；非输入参数，执行时自动剥离）",
            "properties": ctx,
        },
    }
    props.update((input_schema or {}).get("properties", {}))
    merged = {"type": "object", "properties": props,
              "required": (input_schema or {}).get("required", [])}
    return with_category(merged, category, fn.get("display_name") or "")
