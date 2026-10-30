"""params → MCP Tool inputSchema 编译器 + 工具发布契约（本模块是**唯一权威**）。

2026-10-01 收口：core 侧的同源副本 `services/params_schema.py` 及其两个消费端点
（`/api/ontologies/functions/all`、`/api/ontologies/behaviors/all`）已删除——运行面自发布后
core 不再需要聚合编译，留着就是"同一语义两处实现"（且 core 版 `behaviors/all` 还带着已废弃的
`onto{ontology_id}__` 前缀消歧命名，与契约 §⑤ 直接冲突）。概念以 plain dict 访问
（运行面 data_store 不依赖 pydantic）。确定性编译：同输入恒同输出，无 LLM 参与。

── 工具发布契约（消费端 agent-backend/src/agent/tool-catalog.ts 按此实现）──────────

**① 分类标记（单一来源：JSON Schema 扩展键，协议透传、不进 properties）**
- ``x-category``：工具类别（五类之一，见下表）；**不再使用 scope 内的 category**（同一语义只允许一种表达）
- ``x-title``：工具中文名在**平台内的投影键**（2026-10-30 反转方向）——权威值是**工具级 ``title``**
  （发布快照 ``tools[].title`` / 查询工具 label / 公共函数 manifest ``title``，最终源自本体
  ``functions/behaviors[].title``），容器启动时由 ``mcp_app.titled_tool_kwargs()`` **唯一一处**把它投影成
  ``inputSchema["x-title"]``。本模块**不再**编译该键：编译产物只带 ``x-category``，避免同一中文名两个写入点。

**①b 参数节点**：三个键各承一义，编译产物与源数据同形，**不设取值兜底**——
``title`` = 中文名（``properties[k].title``）、``description`` = 补充说明、``example`` = 示例值。
中文字段唯一来源是源数据的 ``title``；``description`` 不再兼作中文名。
**唯一例外**是编译器注入的系统参数 ``ontology_id``（本体执行类 + 本体查询类）：它在源数据里不存在，
没有可搬运的中文名，故由编译器自带 ``title: 本体ID``——这不是"兜底"，而是该参数的声明本身
（2026-10-30 补齐，此前注入块只有 ``description``，前端/LLM 只能看到英文键名）。

| x-category | 归位 | 性质 |
|---|---|---|
| 本体行为 | 本体内 | 执行：外部系统集成（走映射翻译 + 下游 MCP） |
| 本体函数 | 本体内 | 执行：本地沙箱（可作判断函数，返回统一信封） |
| 本体查询 | 本体内/全局 | 元数据查询（父 Agent 专用；不进子任务可规划清单） |
| 公共函数 | 全局 | 执行：本地沙箱 |
| （其他MCP工具） | 外部 | 消费端兜底值：**无标记**的工具，发布端不使用该值 |

**② 本体上下文（``x-ontology-scope``）**：仅「本体执行类」（本体行为/本体函数）携带——
表示"该工具是某本体的执行入口"。它是**发布时固化的工具元数据，不是参数**：放在 schema
顶层扩展键（不进 ``properties``，故 LLM / 客户端不会把它当参数，也填不了），只含本体身份
（``ontology_id`` / ``scenario_id`` / ``scenario_name`` / ``ontology_name``）。
工具名即行为/函数裸名，故不再重复存 ``name``。

**③ 参数契约**

本体行为 / 本体函数**已无平台固定发布面**：两个执行底座都零工具（8006 自 2026-10-04、
8005 自 2026-10-19 起 ``transport=none``，``_list_tools`` 恒空）。本体执行类工具的唯一工具面是
**自建发布**（绑定单一本体），故下表只剩这一种形态：

| 类别 | ``ontology_id`` | ``x-ontology-scope`` | 执行前剥离 |
|---|---|---|---|
| 本体行为 / 本体函数（**自建发布**：发布绑定单一本体） | **必填**——LLM 必须填写当前操作的本体；底座校验其与发布声明一致 | 有（发布时固化） | 剥 ``params`` 内的系统参数（防御性） |
| 本体查询：``listOnto*`` | **必填** | 无 | 无需（无系统参数） |
| 本体查询：``listScenarios`` / ``listOntologies`` | 无（全局花名册，不针对某本体） | 无 | — |
| 公共函数 | 无 | 无 | 剥（防御性：schema 本就没有这些键） |
| 其他 MCP 工具 | 无 | 无 | 原样透传 |

**④ 归属一致性（执行期，两道闸）**

1. **发布声明闸**（``require_scope_match``）：调用方传入的 ``ontology_id`` 必须等于发布时写入的
   ``x-ontology-scope.ontology_id``（自建发布容器转发时原样带上）。不等即拒——这是"LLM 把工具
   挂到别的本体上"的最直接信号，报错文案含双方 id 与本体的中文名/场景，供调用方自纠。
2. **数据归属闸**（``require_ontology_match``）：调用方 ``ontology_id`` 还必须等于 ``.data`` 中该
   函数/行为的**真实归属**。它防的是伪造 scope 绕过路由（同名工具不得跨本体执行），并在没有
   scope 的入口（设计期 REST 调用）单独兜底。

两道闸都不能省：前者校验"发布声明 == 调用意图"，后者校验"调用意图 == 数据事实"。

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
TITLE_KEY = "x-title"

CATEGORY_BEHAVIOR = "本体行为"
CATEGORY_FUNCTION = "本体函数"
CATEGORY_QUERY = "本体查询"
CATEGORY_COMMON = "公共函数"
# 消费端兜底值（无标记 = 外部工具）；发布端不使用
CATEGORY_EXTERNAL = "其他MCP工具"

# ─── 本体上下文与系统参数 ──────────────────────────────────────────────────────
ONTOLOGY_ID_KEY = "ontology_id"
# 本体上下文：工具级**元数据**（发布时固化），放 schema 顶层扩展键、不进 properties——
# 因而 LLM/客户端看不到、也填不了（它不是输入参数）。
SCOPE_KEY = "x-ontology-scope"
# 系统参数（非业务输入，执行前一律剥离）：只有路由键 ontology_id
SYSTEM_PARAMS = frozenset({ONTOLOGY_ID_KEY})


def _same_owner_id(a, b) -> bool:
    """归属 id 等价判定：兼容 ``1`` / ``"1"`` / ``1.0`` 三种表示。"""
    if a == b:
        return True
    if a is None or b is None or a == "" or b == "":
        return False
    try:
        return int(a) == int(b)
    except (TypeError, ValueError):
        return False


def require_ontology_id(value, label: str):
    """ontology_id 是**执行入口与 MCP 工具面**的必填项（路由键：``load_ontology_data_by_id``
    靠它定位本体数据）。

    自建发布把它声明为必填参数，由调用方（LLM）填写；缺失或空串一律报错，**不按发布时记录的
    本体回退**：转发方必须显式声明在操作哪个本体——跨本体的行为/函数同名时（工具名不带本体
    前缀），回退会静默路由到错误本体。
    """
    if value is None or value == "":
        raise ValueError(f"{label} 缺少 ontology_id")
    return value


def require_scope_match(scope, requested_owner, label: str):
    """发布声明闸（契约 ④-1）：``scope.ontology_id`` 必须等于调用方传入的 ``ontology_id``。

    ``scope`` 是自建发布时写入工具 schema 的本体上下文（容器转发时原样带上）。它声明的是
    "这套工具属于哪个本体"；调用方传入的 ``ontology_id`` 表达的是"我这次要操作哪个本体"。
    两者不等 = 工具被挂到了别的本体上，必须中止——继续执行只会把 A 本体的行为作用到 B 本体。

    报错读者是调用方 LLM：给出双方 id + 本体中文名/场景 + 怎么改，才能让它自纠。

    ``scope`` 缺失（设计期 REST 调用不经自建发布）→ 不校验，由数据归属闸单独兜底。
    """
    declared = scope.get(ONTOLOGY_ID_KEY) if isinstance(scope, dict) else None
    if declared is None or declared == "":
        return requested_owner
    if _same_owner_id(declared, requested_owner):
        return requested_owner
    where = owner_label(scope) or f"ontology_id={declared}"
    raise ValueError(
        f"{label} 本体不一致：发布时声明属于{where}，调用方传入的 ontology_id={requested_owner}。"
        f"工具不能跨本体调用——请传入 ontology_id={declared}（该工具所属本体），"
        f"或改用属于 ontology_id={requested_owner} 的本体工具。"
    )


def require_ontology_match(declared_owner, requested_owner, label: str, owner_label: str = ""):
    """数据归属闸（契约 ④-2）：``.data`` 中该函数/行为的真实归属必须等于调用方指定本体。

    ``declared_owner`` 是本体的**数据事实**（函数/行为索引里的 ``ontology_id``）；
    ``requested_owner`` 是调用方传入的 ``ontology_id``；``owner_label`` 只用于报错文案。
    工具名是裸名（不带本体前缀），两者不等而放行 = 同名工具被挂到另一个本体上执行
    （executor 按 ``(ontology_id, 名称)`` 直接查，绕过发布期去重）。

    - ``declared_owner`` 缺失（``None``/空串）→ **放行**：索引未命中（数据目录不可见等），不误伤；
    - 数值按整数比较（``1`` / ``"1"`` / ``1.0`` 等价）。
    """
    if declared_owner is None or declared_owner == "":
        return requested_owner
    if _same_owner_id(declared_owner, requested_owner):
        return requested_owner
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
    """剥离系统参数（``ontology_id`` 路由键），只留业务参数。

    三类发布端共用同一实现：本体函数/行为（执行前剥）、公共函数（防御性剥——
    其 schema 本就没有这个键，避免外部调用方多传后污染函数 params）。
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

    # 三键各承一义，与源数据同形：title=中文名、description=补充说明、example=示例值。
    # 中文名只认 title——不再从 description 兜底（同一语义只允许一个来源）。
    label = spec.get("title")
    if isinstance(label, str) and label:
        schema["title"] = label
    note = spec.get("description")
    if isinstance(note, str) and note:
        schema["description"] = note
    example = spec.get("example")
    if example is not None and str(example) != "":
        schema["example"] = example

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


def params_to_input_schema(params: dict, concepts=None, *,
                          require_ontology_id: bool) -> tuple[dict, list[str]]:
    """params dict → (完整 MCP Tool inputSchema, 约束冲突警告列表)。

    ``require_ontology_id`` **必须显式指定**（不设默认值：漏写会在调用点立刻报错，而不是
    悄悄落回某个历史口径）：

    - ``True``：**自建发布**（本体执行类唯一工具面）——``ontology_id`` 是**必填参数**，由
      调用方（LLM）填写；底座用发布时固化的 ``x-ontology-scope`` 校验它是否一致（契约 ④-1）；
    - ``False``：完全不出现（无本体归属的执行类工具）。

    concepts 传入时按「参数名 = 属性名」回溯合并属性约束。
    """
    attr_map, conflicts = build_attr_constraint_map(concepts)
    props: dict = {}
    required: list[str] = []
    if require_ontology_id:
        props[ONTOLOGY_ID_KEY] = {
            "type": "integer",
            "title": "本体ID",
            "description": "本体 ID（必填）：本工具所属本体；请填写当前操作的本体 ID，"
                           "执行底座会校验其与工具发布声明是否一致",
        }
        required.append(ONTOLOGY_ID_KEY)
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


def behavior_concept_names(behavior: dict) -> list[str]:
    """行为关联概念（唯一）：新格式为标量 ``concept``；旧数据 ``related_concepts`` 数组读时兼容。

    约束回溯需要概念列表，故统一收敛到列表形态。data-engine-mcp 内部有一份等价实现
    （未随本次改动迁移，见其模块 docstring）；本函数是 core 动态发布面使用的权威口径。
    """
    concept = behavior.get("concept")
    if concept:
        return [concept]
    legacy = behavior.get("related_concepts")
    return list(legacy) if isinstance(legacy, list) else []


def with_category(input_schema: dict, category: str) -> dict:
    """注入分类标记 ``x-category``——工具分类的唯一来源。

    **不再写 ``x-title``**（2026-10-30）：中文名的权威值是工具级 ``title``，私有键由
    ``mcp_app.titled_tool_kwargs()`` 在构造 ``Tool`` 时统一投影，编译侧只管类别。
    """
    marked = dict(input_schema or {})
    marked[CATEGORY_KEY] = category
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
        props["ontology_id"] = {"type": "integer", "title": "本体ID", "description": "本体 ID"}
        required.append("ontology_id")
    props.update(extra_properties or {})
    return {"type": "object", "properties": props, "required": required}


def with_ontology_scope(input_schema: dict, scope: dict, category: str) -> dict:
    """本体执行类工具（本体行为 / 本体函数）：写入本体上下文 ``x-ontology-scope`` + 分类标记。

    ``scope`` 是**发布时固化的本体身份**（``ontology_id`` / ``scenario_id`` /
    ``scenario_name`` / ``ontology_name``，缺省键自动省略）。它放在 schema 顶层扩展键而非
    ``properties``：
    - 不是输入参数——LLM/客户端无法看到、也不会填写（要求 2）；
    - 平台内部据它做归属判定：父 Agent 过滤可规划集、子 Agent 挂载、执行底座校验
      ``ontology_id`` 是否一致（契约 ④-1）；
    - 消费侧用 ``strip_ontology_scope`` 在交给 LLM 前剥掉（元数据不进参数面）。
    """
    marked = dict(input_schema or {})
    marked[SCOPE_KEY] = {k: v for k, v in (scope or {}).items() if v is not None}
    return with_category(marked, category)


def strip_ontology_scope(input_schema: dict | None) -> dict:
    """剥离工具级本体元数据（``x-ontology-scope``）——只给平台内部用，不进 LLM 参数面。"""
    out = dict(input_schema or {})
    out.pop(SCOPE_KEY, None)
    required = out.get("required")
    if isinstance(required, list):
        out["required"] = [k for k in required if k != SCOPE_KEY]
    return out
