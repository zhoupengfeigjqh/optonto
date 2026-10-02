# MCP 工具发布契约

> **单一权威实现**：`mcp-shared/tool_contract.py`（模块 docstring + 常量 + 发布原语）。
> **消费实现**：`agent-backend/src/agent/tool-catalog.ts`（分类读取、协议不变式校验）。
> 任一改动都必须两端 + 本文档同步。

## 1. 服务分工

| 服务 | 端口 | 发布什么 | 执行方式 |
|---|---|---|---|
| `optonto-ontology-mcp` | 8002 | 本体函数、公共函数、本体查询（`list*` 8 个） | 本地沙箱（函数）/ 直读 `.data`（查询） |
| `optonto-data-engine-mcp` | 8005 | 本体行为（工具名 = 行为名） | 输入映射 → 下游 MCP → 输出映射 |
| `optonto-business-mcp` | 8004 | 业务系统适配工具（外部形态，**无本平台标记**） | 直连业务系统 |

三个服务共用 `mcp-shared/`（构建期库，各镜像 `COPY` 一份；改一行需三个镜像同批重建）。

## 2. 分类标记（单一来源）

载体是 **JSON Schema 顶层扩展键**（协议透传，不进入 `properties`，因而不污染参数面）：

- `x-category`：工具类别，取下表五值之一
- `x-display_name`：发布方权威中文名

| `x-category` | 归位 | 性质 | 发布端 |
|---|---|---|---|
| `本体行为` | 本体内 | 执行：外部系统集成（走映射 + 下游 MCP） | `data-engine-mcp/behavior_tools.py` |
| `本体函数` | 本体内 | 执行：本地沙箱（可作判断函数，返回统一信封） | `ontology-mcp/server.py` |
| `本体查询` | 本体内 / 全局 | 元数据查询（**父 Agent 专用**） | `ontology-mcp/server.py`（表驱动） |
| `公共函数` | 全局 | 执行：本地沙箱 | `ontology-mcp/server.py` |
| （`其他MCP工具`） | 外部 | **消费端兜底值**：无任何标记的工具（第三方/外部 MCP），发布端不使用 | — |

> 历史形态（已废弃）：分类曾放在 `scope.category`（本体工具）与 `x-category`（公共函数）两处——
> 同一语义两种表达，已统一到 `x-category`。

## 3. 本体上下文块 `scope`

**仅「本体执行类」（`本体行为` / `本体函数`）携带**，表示"该工具是某本体的执行入口，调用时必须锁定到该本体"。

- 只含上下文键（全 `const` 真值）：`name`（裸名）+ `ontology_id` / `scenario_id` / `scenario_name` / `ontology_name`（元数据缺失时该键缺席）
- **不含**分类标记（不与 §2 重复表达）
- 非输入参数，处理链：

| 阶段 | 处理 |
|---|---|
| 发布 | `with_ontology_context()` 写入（置于参数之前） |
| 父 Agent | `listPlannableFunctions` 读出 → 填子任务 `scenario` / `ontology` 字段、展示归属 |
| 子 Agent 挂载 | 整个 `scope` 块从可见 schema **删除**（LLM 看不到、不填） |
| 执行前 | `strip_system_params()` 再剥一次（防御性） |

实测三种传法：**不传 = 正常；传与 `const` 完全一致的值 = 正常且被剥；传不一致的值 = 协议层 `jsonschema` 直接拒**（`'本体行为' was expected`）。即 scope 只可省略或原样回传。

## 4. 参数契约矩阵

| 类别 | `ontology_id` | `scope` | 执行前剥离 | 备注 |
|---|---|---|---|---|
| 本体行为 / 本体函数 | **必填**（schema.required + `require_ontology_id` 双保险） | 有 | 剥 `scope` + `ontology_id` | 本体归属唯一依据 = `ontology_id` |
| 本体查询 `listOnto*`（6 个） | **必填** | 无 | 无需 | 父 Agent 专用 |
| 本体查询 `listScenarios` / `listOntologies` | 无（全局花名册，不针对某本体） | 无 | — | 同上 |
| 公共函数 | 无 | 无 | 剥（防御性） | 全局工具 |
| 其他 MCP 工具 | 无 | 无 | 原样透传 | 发布方自定 |

- 系统参数集合：`SYSTEM_PARAMS = {scope, ontology_id}`（`mcp-shared/tool_contract.py`），三类发布端共用同一个 `strip_system_params()`。
  **四个入口同口径**（2026-10-01 收口）：ontology-mcp / data-engine-mcp 的 MCP 入口与 REST 入口（`/execute-function`、
  `/execute-common-function`、`/call-behavior`）执行前一律剥离；**数据引擎入口 `/call-engine` 有意不剥**——
  引擎 params 是用户自定义字段（`SYSTEM_PARAMS` 只属本体执行类），剥了会误删真名为 `scope` / `ontology_id` 的引擎参数。
- `ontology_id` 缺失一律报错、**不做按发布记录回退**（否则跨本体同名工具会静默路由到错误本体）。
- 协议层另有一道 SDK `jsonschema.validate`（`required` 已含 `ontology_id`），故缺 id 的英文文案来自 SDK、中文文案来自 `require_ontology_id`（REST 入口与绕过校验时）。
- **归属一致性（契约 ④，2026-10-01 起）**：本体执行类在路由前校验「**发布方声明的归属**」（本体执行的
  `scope.const.ontology_id` / 行为条目的 `ontology_id`）== 「**调用方传入的**顶层 `ontology_id`」，不等即拒：
  `require_ontology_match()`（`mcp-shared/tool_contract.py`），**四个入口同口径**（ontology-mcp / data-engine-mcp
  各有 MCP 与 REST 两条）。
  - 这是上一条"必填"的下一句：**必填且必须填对**。工具名是裸名，两者不等而放行 = 同名工具被挂到别的本体上执行
    ——行为侧可构造（§5 跨本体重名），会**静默执行另一个本体的同名行为**；
  - 报错文案含**双方 id 与本体的中文名/场景**（`owner_label()`）：主要读者是调用方 LLM，给中文名才能判断
    "是不是我把工具挂到了别的本体上"并自纠；
  - 声明**缺失**（老数据 / 设计期 REST 入口缓存未命中）→ **放行**，不误伤；数值按整数比较（`1` / `"1"` / `1.0` 等价）；
  - **不改任何 schema**：`/tools` 输出与改动前逐字节一致（实测），仅执行期多一道校验。

## 5. 命名

- 本体执行类与公共函数：**工具名 = 裸名**（行为名 / 函数名），不带本体前缀。
- 跨本体重名（同名行为/函数分布在多个本体）：工具名维度无法共存且后端字典会互相覆盖 → **发布端记 ERROR 并保留先出现者**，由设计侧改名解决（不做前缀消歧）。
- 本体查询：固定动词名（`listScenarios` / `listOnto*`）。

## 6. 协议不变式（消费端快速失败）

`agent-backend/src/agent/tool-catalog.ts::assertToolProtocol`，在工具发现边界调用：

1. **带 `scope` 块的工具必须是本体执行类**——否则是旧版发布形态，继续按"外部工具"处理会**丢掉本体锁定**；
2. **本体执行类必须带 `scope` 块**——否则拿不到 `scope.name` / `ontology_id`，挂载过滤与锁定都无从谈起。

违反任一条 → **抛错**（不静默降级）。发布端与 agent 必须同版本部署。

## 7. 消费侧行为（摘要）

- **父 Agent** 挂载全部 `本体查询` 类工具（按 `x-category` 判定，不再硬编码名单）；执行记录展示名取自 `PARENT_TOOL_LABELS`（与发布端 `x-display_name` 同文案）。
- **子 Agent** 只挂执行类：本体行为按 `scope.name` 匹配合法行为集合，本体函数 / 公共函数 / 外部工具按工具名匹配 `legalCalls.functions`；**本体查询类一律不挂**。
- **可规划清单**（`listPlannableFunctions`）剔除本体行为与本体查询：只列可下放的函数/外部工具。
- `本体行为` / `本体函数` 调用的 `ontology_id` 由 harness **强制注入**（调用方所传值被覆盖）。
- **本体身份四元组（`scenario_name` / `scenario_id` / `ontology_name` / `ontology_id`）的唯一来源 =
  `ontology.yaml` 的 `metadata`**（与 core、agent 同口径）：scope 的 const 值、`listOntologies` 的返回、
  发布端的本体过滤全部由此派生；`meta.json` 仅作创建期注册与非身份字段，不再作为身份读取来源。
  口径与写入侧回刷规则见 `docs/contracts/ontology-yaml.md` §1「本体身份」。
- **`listOntologies` 返回值含 `deployed_version`**（当前已部署版本）：读时派生自部署产物 `ontology.yaml`
  的 `metadata`，与 core `repositories/metadata.list_all_ontologies` 同口径；**不写进 meta.json**
  （版本是"部署状态"，事实源在部署产物与 `ontology_versions/` 存档，避免同一语义两处表达）。
  缺失/未部署/文件损坏一律为空串，且不影响清单与路由（`mcp-shared/data_store.deployed_version_of`）。

## 8. 行为就绪发布（契约 ⑥，2026-10-02 起）

**行为只有在映射完成（真能执行）时才发布为工具**——工具清单即对 LLM 的可调用承诺，"清单里有、调用必失败"就是违约
（此前把未配映射的行为也照发：实测 33 个行为工具里 25 个一调就失败）。

就绪判据（`mcp-shared/tool_contract.py::is_engine_ready` / `ready_behavior_names`，**两侧同源，勿单边改动**）：

| 条件 | 说明 |
|---|---|
| `data_engines[]` 中存在 `behavior_name` 匹配的条目 | 映射已建立 |
| `engine_type` 缺省或 `MCP` | 缺省即 MCP；其余类型已删除（executor 会报错） |
| `target.server_url` 与 `target.tool_name` 均非空白 | 半成品映射不算就绪（与 visibility-guard 收编同口径） |

- **发布端**（`data-engine-mcp/behavior_tools.py::load_behavior_tools`）：未就绪行为**不进 `/tools`、不可路由**，
  按本体记一条 WARNING（列出名字）——设计器仍看得到它们（读 core API，不经 MCP）。
- **调用端**：调用未就绪行为 → 专用报错 `行为 X 尚未就绪：未完成数据引擎映射，未发布为工具（本体「Y」）`，
  与「未知工具」严格分开——错误也要指向病根，不能把"设计没做完"报成"工具名写错了"。
- **规划端**（`agent-backend`）：`OntologyGateway.getReadyBehaviorNames` 按同一判据给出可行集，规划闸
  `validateBehaviorNames` **只放行就绪行为**，并把 `missing`（本体未声明）与 `notReady`（已声明未就绪）分开报，
  nudge 文案给"改用该本体的就绪行为 / 如实告知用户该能力尚未配置"的出口。
  两侧同源是硬要求：只改发布面会造出"能规划、挂不上"（工具不在清单里，子 Agent 只能以"工具不存在"含糊失败）。
- **四处同源**（发布 / 调用 / 规划 / 查询）：`listOntoBehaviors` 查询工具**只列就绪行为**（工具描述已同步），
  未就绪者需在设计器完成映射后才会出现——否则父 Agent 会先规划一个注定挂不上的行为、被驳回一次再改。
- **设计期花名册不受影响**：core `/api/ontologies/{id}/data` 与设计器 UI **仍列全部行为**
  （未就绪只是"不可规划/不可调用"，不是"不存在"）。
