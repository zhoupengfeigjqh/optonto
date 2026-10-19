# MCP 工具发布契约

> **单一权威实现**：`mcp-shared/tool_contract.py`（模块 docstring + 常量 + 发布原语）。
> **消费实现**：`agent-backend/src/agent/tool-catalog.ts`（分类读取、协议不变式校验）。
> 任一改动都必须两端 + 本文档同步。

## 1. 服务分工

| 服务 | 容器 / 端口 | 对外发布工具 | 职责（一句话） |
|---|---|---|---|
| **本体查询 MCP 服务**（固定） | `optonto-ontology-query-mcp` / 8002 | ✅ 内置对外工具面之一 | 回答「本体里有什么」：`list*` 八件套（含 6 个 `listOnto*`），只读无副作用 |
| **公共函数 MCP 服务**（固定） | `optonto-common-function-mcp` / 8007 | ✅ 7 个公共函数工具 | 平台级通用算力（日期/过滤/聚合/分组）：**无本体归属、跨场景共享、纯计算**；**发布 + 执行一体**（本服务内直接 exec，不转发） |
| **本体函数执行服务**（固定） | `optonto-ontology-function-executor` / 8006（仅内网） | ❌ 零工具（`transport=none`） | **仅本体函数**执行的唯一实现（`/execute-function`：ontology_id 必填 + 归属一致性校验） |
| **数据引擎执行服务**（固定） | `optonto-data-engine-executor` / 8005（仅内网） | ❌ 零工具（`transport=none`，2026-10-19 起） | **本体行为**执行的唯一实现（`/call-behavior`）+ 引擎直调（`/call-engine`）；映射翻译 → 下游 MCP |
| **业务系统 MCP**（固定） | `optonto-business-mcp` / 8004 | ✅ 外部形态（无平台标记） | 业务侧集成边缘：直连业务系统；**与其他固定服务同权，可启停**（2026-10-04 用户决策）。⚠️ **须在「MCP 配置」标记 `business_data: true`**——否则其原始写接口会以「其他MCP工具」身份进 Agent 目录，可被规划成零确认的函数子任务（见下） |
| **自建发布**（动态实例） | `optonto-mcp-publish-*` / 宿主 8020-8099（容器内 8100） | ✅ 只发布勾选项（带令牌） | **对外提供执行能力的唯一出口**：按本体切片发布函数或行为，只转发不执行 |

**⚠️ 「无平台标记」工具的 Agent 准入（2026-10-05，agent 环节合规审查 C1）**：
分类标记 `x-category` 是消费端归类的**唯一依据**，无标记者按排除法兜底归为「其他MCP工具」。
该类工具**不享受** `scope` 本体锁定、`isWrite`/`securities` 安全管控与 `disable` 权限闸——
故其可被父 Agent 规划为**函数子任务**，而函数子任务走 `callFunctionTool` 直连路径，
**不经过子 Agent 的 `guardExecution` 包装**（安全确认 / disable 闸 / 规则闸 / 报错预算四道闸全缺席）。

因此：**承载真实业务接口的服务必须声明 `business_data: true`**，其无标记原始工具一律不进 Agent 目录
（闸位 `agent-factory.discoverTools`，判定 `mcp-config-store.isBusinessDataServer`），
业务接口须经 `data_engines` 映射发布为**本体行为**才是唯一合法入口。
带 `x-category` 的平台自身工具（本体行为 / 本体函数 / 公共函数）不受此闸影响——
否则会误伤自建发布（本体行为/本体函数的唯一工具面）。数据引擎执行服务已零工具化，
不再直接产出工具，故该闸与它无关。

**语义铁律**（2026-10-04 统一）：

- **发布 = 对外声明 MCP 工具**。只有「本体查询 MCP 服务」「公共函数 MCP 服务」「业务系统 MCP」与「自建发布」干这件事。
- **执行 = 真正跑起来**。「本体函数执行服务」「数据引擎执行服务」是**不对外**的执行底座；「公共函数 MCP 服务」既是发布面也是执行面（纯计算、发布与执行同容器，见 §1 语义铁律）
  （两个执行底座都**零工具**：`transport=none`，连 `/mcp`、`/sse` 都不挂，外部误连直接 404；
  对 Agent 提供可执行能力的唯一工具面是自建发布）。
- **自建发布只做门面 + 转发**：零挂载、不读 `.data`、不含执行实现，故执行语义全局只有一份。

**固定服务共五个**（本体查询 / 公共函数 / 本体函数执行 / 数据引擎执行 / 业务系统），与自建发布共用 `mcp-shared/`（构建期库，各镜像 `COPY` 一份；改一行需同批重建）。
自建发布运行期**不读 `.data`**：工具清单由 core 编译成配置经环境变量注入。

**依赖方向（单向）**：自建发布 → 执行服务 → 业务系统 MCP。执行服务不知道自建发布的存在。
对应地，执行服务停机时自建发布会不可用（错误文案指名依赖服务），这是保留「单一执行来源」的代价。
## 2. 分类标记（单一来源）

载体是 **JSON Schema 顶层扩展键**（协议透传，不进入 `properties`，因而不污染参数面）：

- `x-category`：工具类别，取下表五值之一
- `x-display_name`：发布方权威中文名

| `x-category` | 归位 | 性质 | 发布端 |
|---|---|---|---|
| `本体行为` | 本体内 | 执行：外部系统集成（走映射 + 下游 MCP） | **core 动态发布面**（自建发布-行为）；数据引擎执行服务已零工具（2026-10-19） |
| `本体函数` | 本体内 | 执行：本地沙箱（可作判断函数，返回统一信封） | **core 动态发布面**（自建发布-函数）；固定服务不再发布（2026-10-04 瘦身） |
| `本体查询` | 本体内 / 全局 | 元数据查询（**父 Agent 专用**） | `ontology-query-mcp/server.py`（表驱动） |
| `公共函数` | 无（平台级能力，无本体归属） | 执行：纯计算本地沙箱（无副作用约定） | `common-function-mcp/server.py`（manifest 的 `inputSchema` **透传**，零编译） |
| （`其他MCP工具`） | 外部 | **消费端兜底值**：无任何标记的工具（第三方/外部 MCP），发布端不使用 | — |

> 历史形态（已废弃）：分类曾放在 `scope.category`（本体工具）与 `x-category`（公共函数）两处——
> 同一语义两种表达，已统一到 `x-category`。

## 3. 本体上下文 `x-ontology-scope`

**仅「本体执行类」（`本体行为` / `本体函数`）携带**，表示"该工具属于某本体"。

- **载位**：schema 顶层扩展键（与 `x-category` 同级），**不进 `properties`**——对 LLM / 客户端而言
  它不是参数，看不到也填不了（要求 2）；
- **内容**：只含本体身份——`ontology_id` / `scenario_id` / `scenario_name` / `ontology_name`
  （元数据缺失时该键缺席）；**不含** `name`（工具名即行为/函数裸名，重复存储只会产生第二个真相）
  与分类标记（不与 §2 重复表达）；
- **生成**：发布时由 `with_ontology_scope()` 按本体 `ontology.yaml` 的 `metadata` 写入，发布即冻结；
- 处理链：

| 阶段 | 处理 |
|---|---|
| 发布 | `with_ontology_scope()` 写入 schema 顶层（不进 `properties`） |
| 自建发布门面 | 按被调工具取元数据，随转发载荷 `scope` 带给执行底座（门面不做判断） |
| 父 / 子 Agent | 发现期 `readOntologyScope` 提升为工具字段 `ontologyScope`；交给 LLM 的 schema 由 `stripOntologyScope` 剥掉 |
| 执行底座 | 校验 `scope.ontology_id` == 调用方传入的 `ontology_id`（契约 ④-1） |

**为什么不再是参数**：scope 是"工具的归属声明"，不是"调用方的输入"。放进 `properties` 会诱导 LLM
填写（还得用 `const + required` 双重约束去防误传）；挪到元数据后，参数面只剩业务参数 + 必填
`ontology_id`，归属校验只做一次。

## 4. 参数契约矩阵

| 类别 | `ontology_id` | `x-ontology-scope` | 执行前剥离 | 备注 |
|---|---|---|---|---|
| 本体行为 / 本体函数（自建发布，唯一工具面） | **必填**（LLM 填写当前操作的本体；底座校验与发布声明一致） | 有（元数据，非参数） | 剥 `params` 内系统参数（防御性） | 发布绑定单一本体；LLM 填错 → 底座 400 |
| 本体查询 `listOnto*`（6 个） | **必填** | 无 | 无需 | 父 Agent 专用 |
| 本体查询 `listScenarios` / `listOntologies` | 无（全局花名册，不针对某本体） | 无 | — | 同上 |
| 公共函数 | 无 | 无 | 剥（防御性） | 全局工具 |
| 其他 MCP 工具 | 无 | 无 | 原样透传 | 发布方自定 |

- 系统参数集合：`SYSTEM_PARAMS = {ontology_id}`（`mcp-shared/tool_contract.py`），各发布端共用同一个
  `strip_system_params()`；`scope` 是 body 级元数据，从不属于参数面。
  **执行入口同口径**（2026-10-01 收口）：本体函数执行服务 8006 `/execute-function`、公共函数 MCP 服务 8007
  `/execute-common-function`、数据引擎执行服务 8005 `/call-behavior` 执行前一律剥离；**引擎入口 `/call-engine` 有意不剥**——
  引擎 params 是用户自定义字段（`SYSTEM_PARAMS` 只属本体执行类），剥了会误删真名为 `ontology_id` 的引擎参数。
- 执行底座 REST 入口（8006 `/execute-function`、8005 `/call-behavior`）的 `ontology_id` 是**路由键**，
  缺失一律报错（`require_ontology_id`）、**不做按发布记录回退**（否则跨本体同名工具会静默路由到错误本体）。
- **归属一致性（契约 ④，两道闸，2026-10-19 收口）**：本体执行类在路由前依次校验
  1. **发布声明闸** `require_scope_match(scope.ontology_id, ontology_id)`：`scope` 来自自建发布的工具元数据
     （容器转发时带上），`ontology_id` 是调用方（LLM）填的值。不等 = 工具被挂到了别的本体上 → 中止；
     这是要求 3 的直接落点。
  2. **数据归属闸** `require_ontology_match(.data 归属, ontology_id)`：调用意图必须等于数据事实。
     防伪造 `scope` 绕过路由（同名工具不得跨本体执行），并在**没有 scope 的入口**
     （设计期 REST 直调）单独兜底。
  - 报错文案含**双方 id 与本体的中文名/场景**（`owner_label()`）：主要读者是调用方 LLM，给中文名才能判断
    "是不是我把工具挂到了别的本体上"并自纠；scope 闸还会给出"请传入 ontology_id=N"的修复方向；
  - 声明**缺失**（老数据 / 设计期 REST 入口缓存未命中）→ 该闸**放行**，不误伤；
    数值按整数比较（`1` / `"1"` / `1.0` 等价）；
  - 门面**不做判断**：校验逻辑只在执行底座一处，避免"门面一套、底座一套"的双实现漂移。

## 5. 命名

- 本体执行类与公共函数：**工具名 = 裸名**（行为名 / 函数名），不带本体前缀。
- 跨本体重名（同名行为/函数分布在多个本体）：工具名维度无法共存且后端字典会互相覆盖 → **发布端记 ERROR 并保留先出现者**，由设计侧改名解决（不做前缀消歧）。
- 本体查询：固定动词名（`listScenarios` / `listOnto*`）。

## 6. 协议不变式（消费端快速失败）

`agent-backend/src/agent/tool-catalog.ts::assertToolProtocol`，在工具发现边界调用：

1. **带本体上下文 `x-ontology-scope` 的工具必须是本体执行类**——
   否则该元数据无人消费，继续按"外部工具"处理会**丢掉本体归属**；
2. **本体执行类必须带本体上下文**——否则拿不到 `ontology_id`，挂载过滤与执行校验都无从谈起。

违反任一条 → **抛错**（不静默降级）。发布端与 agent 必须同版本部署。

## 7. 消费侧行为（摘要）

- **父 Agent** 挂载全部 `本体查询` 类工具（按 `x-category` 判定，不再硬编码名单）；执行记录展示名取自 `PARENT_TOOL_LABELS`（与发布端 `x-display_name` 同文案）。
- **子 Agent** 只挂执行类：本体行为按工具名（即行为裸名）匹配合法行为集合，本体函数 / 公共函数 / 外部工具按工具名匹配 `legalCalls.functions`；**本体查询类一律不挂**。
- **可规划清单**（`listPlannableFunctions`）剔除本体行为与本体查询：只列可下放的函数/外部工具。
- **行为可规划判据 = 实际挂载目录**（2026-10-19）：`FunctionCatalogView.behaviorNames()` 从本次会话真实发现的
  行为工具取集合，`validateBehaviorNames` 以它为准（不做文件兜底）。因此"映射完成但未发布"不再等于可规划——
  规划闸以 `notPublished` 单独报错，nudge 指向「MCP发布 → 自建发布」。
- `本体行为` / `本体函数` 调用的 `ontology_id` **由调用方（LLM）填写并原样透传**：agent 不注入、不覆盖
  （覆盖会掩盖填错的本体，使契约 ④ 的校验形同虚设）。唯一的补齐点是**函数子任务**：计划期未填时
  `callFunctionTool` 用子任务本体补上；已填则保留，错值由底座拒。
- **本体身份四元组（`scenario_name` / `scenario_id` / `ontology_name` / `ontology_id`）的唯一来源 =
  `ontology.yaml` 的 `metadata`**（与 core、agent 同口径）：`x-ontology-scope` 的值、`listOntologies` 的返回、
  发布端的本体过滤全部由此派生；`meta.json` 仅作创建期注册与非身份字段，不再作为身份读取来源。
  口径与写入侧回刷规则见 `specs/contracts/ontology-yaml.md` §1「本体身份」。
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

- **发布端**（core 动态发布面 `mcp_publish_registry.compile_tools`）：未就绪行为**直接拒发**
  （建了才发现用不了）。自建发布是 2026-10-19 后行为工具的唯一出口；数据引擎执行服务零工具，
  只在 `/call-behavior` 调用期用 `behavior_index` 做归属校验与"未就绪"报错区分。
- **调用端**：调用未就绪行为 → 专用报错 `行为 X 尚未就绪：未完成数据引擎映射，未发布为工具（本体「Y」）`，
  与「未知工具」严格分开——错误也要指向病根，不能把"设计没做完"报成"工具名写错了"。
- **规划端**（`agent-backend`）：可规划集 = **本次会话实际发现的行为工具**（`FunctionCatalogView.behaviorNames`，
  即"能不能挂上"），`OntologyGateway.getReadyBehaviorNames` 只用于区分原因。规划闸
  `validateBehaviorNames` 把 `missing`（本体未声明）/ `notReady`（已声明未就绪）/ `notPublished`
  （已就绪但无挂载点）三者分开报，nudge 分别指向"改名 / 补映射 / 去自建发布"。
  同源是硬要求：只改发布面会造出"能规划、挂不上"（工具不在清单里，子 Agent 只能以"工具不存在"含糊失败）。
- **四处同源**（发布 / 调用 / 规划 / 查询）：`listOntoBehaviors` 查询工具按「**已就绪 ∩ 已发布**」列出
  （`mcp-shared/publish_registry.published_behavior_names`）——否则父 Agent 会先规划一个注定挂不上的行为、
  被驳回一次再改。注册表是期望态（容器停了仍算已发布），硬闸仍在规划端的实际目录。
- **设计期花名册不受影响**：core `/api/ontologies/{id}/data` 与设计器 UI **仍列全部行为**
  （未就绪只是"不可规划/不可调用"，不是"不存在"）。

## 9. 自建发布（动态 MCP 容器，2026-10-04）

用户在「MCP发布 → 数据引擎」页按**当前本体**勾选函数或行为 → core 编译工具清单并起一个
`optonto-mcp-publish` 镜像的容器（容器名 `optonto-mcp-publish-<slug>-<rand>`，宿主端口 8020-8099，容器内固定 8100）。

### 9.1 参数契约（本体执行类唯一形态）

自建发布**绑定单一本体**，工具面如下：

- `ontology_id`：**必填参数**，由调用方（LLM）填写当前操作的本体；门面原样转发，底座用发布声明校验
  （填错即 400，且报错给出"应填哪个 id"）；
- `x-ontology-scope`：发布时固化的本体身份元数据（默认值取本体 `metadata`），**不进 `properties`**，
  故 LLM 看不到、也填不了；门面转发时把它作为 `scope` 带给底座；
- `x-category`：取真实归位（`本体函数` / `本体行为`），agent 侧零适配即可挂载。

容器配置（`PUBLISH_CONFIG_JSON`）**不含 `ontology_id`**：归属只在工具的 `x-ontology-scope` 里存一份；
启动时校验"每个工具都有本体上下文且全服务只有一个 `ontology_id`"，缺失或混杂即拒绝启动。

### 9.2 传输模式

| 服务 | 平台传输模式 | 实际端点 | 客户端配置 `type` |
|---|---|---|---|
| 本体查询 MCP（8002） | `streamable` | `/mcp` 单端点 | `http` |
| 公共函数 MCP（8007） | `streamable` | `/mcp` 单端点 | `http` |
| 业务系统 MCP（8004） | `streamable` | `/mcp` 单端点 | `http` |
| 数据引擎执行服务（8005，仅内网） | `none` | **不挂协议端点**（零工具，只有 `/call-behavior`、`/call-engine`） | — |
| 本体函数执行服务（8006，仅内网） | `none` | **不挂协议端点**（零工具，只有 `/execute-function`） | — |
| 自建发布（动态容器） | 发布时可选 `sse` / `streamable` | `/sse` + `/messages/` 或 `/mcp` | `sse` / `http` |

**同一件事的三个名字**（2026-10-05 查官方文档后定稿，三者不得互相混用）：

| 层 | 取值 | 出处 |
|---|---|---|
| 平台内部枚举 | `streamable` / `sse` / `none` | `catalog.ts::FixedTransport`、`mcp_publish_registry.TRANSPORTS` |
| UI 展示名 | `streamable-http` / `sse` / 无协议端点 | **MCP 规范里的传输名**（`catalog.ts::TRANSPORT_LABEL`）；`http-streamable` 是词序反了的自造词，已废 |
| 客户端配置 `type` | `http` / `sse` | `catalog.ts::CLIENT_TYPE`（`streamable → http`）、core `client_config` |

- `type` 是 **MCP 客户端**用来区分连接方式的字段，合法取值 `http` / `sse` / `stdio`（本地进程）：
  VS Code 的枚举就是这三个（`http` 优先、不支持再回退 SSE）；Claude Code 以 `http` 为规范传输
  `streamable-http` 的取值并接受 `streamable-http` 作为别名——**两边都认 `http`，故取 `http`**。
  此前片段里写死的 `"type": "url"` 是**自造值**（谁都不要），2026-10-05 修正。
- **必须带 `type`**：Claude Code 对「有 `url` 但无 `type`」的条目按 stdio 处理并**跳过报错**
  （`add "type": "http" …`）——我们生成的片段始终带 `type`，故不受影响（手工新增时也要填）。
- 协议层实现见 `mcp-shared/mcp_app.py::build_mcp_app(transport=...)`；
  **卡片 / 配置片段 与 各服务 `server.py` 的 `transport` 实参双向守护**见
  `core-backend/tests/test_service_topology_consistency.TransportClaimCase`（改服务端就得同步卡片）。
- **卡片只对「对外」工具面展示传输模式**（2026-10-05 用户要求）：两个内网执行底座
  （本体函数执行 8006 / 数据引擎执行 8005）是平台自己的运行时，不暴露传输细节；
  其 `transport` 仍保留在 `catalog.ts` 里作事实源（护栏用它比对服务端），只是不上卡片。
- 两个执行底座**都零工具**（2026-10-19 方案 B）：8005 的 `/mcp` 工具面已下线，
  卡片统一显示「只提供内部执行端点」。零工具是**结构性**保证——`server.py` 不注册
  `list_tools`/`call_tool`，拓扑护栏会拒绝任何回退。
- **固定服务的「查看配置」与自建发布同构**（2026-10-19 统一）：三个对外工具面
  （本体查询 / 公共函数 / 业务系统）一律给**两段** `mcpServers` 片段——宿主地址段 + 容器内地址段；
  业务系统不再回显「MCP 配置」页的内部条目（`enabled` / `business_data` / `allowed_tools` 是平台
  管理语义，任何客户端都不认）。两个零工具底座**不出片段**（无处可连），只给内网端点说明。
  事实源收在 `frontend/src/components/Design/mcp-publish/catalog.ts` 的
  `clientKey` / `endpoint` / `internalEndpoint` / `transport`，护栏
  `test_service_topology_consistency.FixedSnippetCase` 双向守护。

### 9.3 鉴权

自建发布**必须带令牌**：`AUTH_TOKEN` 注入容器，`/mcp`、`/sse`、`/messages`、`/tools` 全部校验
请求头 `X-MCP-Token`（也接受 `Authorization: Bearer`）；`/health` 与 `/.well-known/*` 放行
（探活与客户端鉴权发现必须在无令牌时可达）。固定服务不带令牌（内网 + 既成事实，未改变）。

**令牌怎么进「MCP 配置」**（2026-10-05 补全——此前只有「粘进去即可用」的承诺，没有录入入口）：

| 场景 | 用哪段地址 | 怎么配 |
|---|---|---|
| 平台外 AI 客户端（Claude / Cursor 等） | **宿主地址** `http://<主机>:8020-8099/mcp` | 「MCP发布 → 查看配置」复制第一段，粘进该客户端的 MCP 配置 |
| **本平台 Agent**（agent-backend 自身在容器内） | **容器内地址** `http://<容器名>:8100/mcp` | 复制**第二段**，到「MCP 配置」页点**「粘贴配置」**导入 |

- `client-config` 接口同时给出 `mcpServers`（宿主地址）与 `internal_mcpServers`（容器内地址），
  两段都把令牌写在 `headers` 里，故都可直接粘贴导入；
- 「MCP 配置」页：新增/编辑行有**「请求头」**（JSON，如 `{"X-MCP-Token":"…"}`），
  列表只显示**掩码** + 「已带令牌」标记，明文令牌不出现在列表；
- 「选择工具」探针**必须带该条目的 headers**（不带令牌的探针必然 401——此前探针不传 headers，
  带令牌的自建发布永远测不通）；
- 两段地址指向**同一个容器**：`localhost` 在 Agent 容器里指向它自己，故平台内部挂载只能走
  容器名 + 容器内端口；宿主地址只对平台外的客户端有效。
- **固定服务同一口径**（2026-10-19）：本体查询（8002）/ 公共函数（8007）/ 业务系统（8004）的
  「查看配置」也给两段——第一段 `http://<主机>:<端口>/mcp` 给外部客户端，第二段
  `http://<容器名>:<端口>/mcp` 给本平台 Agent（粘进「MCP 配置」页）。固定服务不带令牌，
  故片段通常没有 `headers`；仅当该条目录入了请求头时才并入（不整条回显配置条目）。

### 9.4 发布即冻结

`tools` 是**发布时编译的快照**（含约束）。改了本体函数/行为的参数后需重新发布
（删除再创建）才会反映到已发布容器——刻意不做热加载，避免"容器内实际注册的清单"与
"页面看到的清单"不一致，工具清单的可信度是发布面的核心承诺。

**查看工具走快照、不探测容器**（2026-10-19）：自建发布卡片上的「查看工具」由
`GET /api/mcp/published/{name}/tools` 读注册表条目（`name` / `kind` / `ontology_name` / `tools`），
停机或容器缺失时照样可看；条目不存在返回 404，**不得**以 `200 + tools: []` 冒充（"找不到"
被显示成"0 个工具"会让用户误以为发布仍然有效）。卡片与弹窗都须标注「发布时快照」。

### 9.5 安全边界（docker.sock 等价宿主机 root）

- 镜像白名单：只允许 `optonto-mcp-publish`；调用方不能传镜像、命令、挂载；
- **零挂载**：配置与令牌全走环境变量，容器内无 `.data`、无宿主路径；
- 降权：`cap_drop=ALL` + `no-new-privileges:true` + `mem_limit=512m`；
- 网络固定 `optonto-net`；服务名/容器名/端口段全部收口（`mcp_publish_registry.py` 常量）；
- 端口段 8020-8099 预留给自建发布，与固定服务端口（81/3307/3000/8000-8007/8080）分离；
- 行为**未就绪**（未完成数据引擎映射）直接拒发（契约 ⑥）；
- 先起容器、后就绪探测（`/health` 200）、再落注册表；起不来回滚容器、不留脏记录，
  并把容器日志尾部回传给用户。

### 9.6 依赖关系

自建发布**不自带执行实现**，转发到执行底座：函数 → 本体函数执行服务（8006 /execute-function），
行为 → 数据引擎执行服务（8005 /call-behavior）。因此对应执行服务停机时自建发布会
不可用（错误文案会指名依赖服务），这是刻意保留的单一执行路径。

## 10. 术语表：本体函数 vs 公共函数（勿混用）

两者都是"用户写的 Python 函数、本地 exec、返回统一信封 {success, data, error}"，但**语义边界完全不同**：

| 维度 | **本体函数** | **公共函数** |
|---|---|---|
| 归属 | 某个**本体**：``ontology_id`` 必填，执行前做**归属一致性校验**（契约 ④——函数名是裸名，跨本体会误路由） | **平台**：无 ``ontology_id``、**不做**归属校验 |
| 声明位置 | 本体 ``ontology.yaml`` 的 ``functions[].params`` | ``.data/common_functions/functions.json``（manifest） |
| 参数声明格式 | ``params`` 需**编译**（类型映射 + 按「参数名=属性名」回溯概念属性约束 + 必填非空） | manifest 的 ``inputSchema`` **已是 JSON Schema → 透传，零编译** |
| 唯一性 | **全局唯一**（跨本体 + 跨公共函数，由 core 拦截重名） | manifest 内唯一 |
| 工具 schema | `ontology_id` **必填** + 本体元数据 ``x-ontology-scope`` | **不带** ``scope``、**不带** ``ontology_id`` |
| 发布面 | 由**自建发布**按本体切片对外（`kind=ontology_function`） | **公共函数 MCP 服务**直接对外发布（全平台共享，无需切片） |
| 执行面 | 本体函数执行服务（8006，内网，零工具） | **同一个服务内**（8007，发布 + 执行一体） |
| agent 侧分类 | 本体执行类（元数据只给平台内部、LLM 不可见；``ontology_id`` 原样透传、底座校验） | 非本体执行类（``isOntologyExec`` 为 false → 零适配） |
| 能否作规则判断函数 | 可（``type=VALIDATION`` → 进 ``judge_functions`` → 进裁决闸） | 不可（无 type，只留痕不阻断） |
| 复用范围 | 仅本本体 | **跨本体 / 跨场景共享** |

**为什么执行落点不同**（不是随意设计）：

- 公共函数是**对外发布的能力**，执行是纯内存计算、零外部依赖、零副作用 → 对外服务**自包含**
  （发布什么就能执行什么，MCP 调用零网络往返）
- 本体函数**有本体归属**，对外暴露需「按本体切片 + 令牌」（自建发布的职责），故其执行留在
  **不对外的底座**（本体函数执行服务，零工具），避免底座天然全开

**agent 必须恒定挂载公共函数 MCP（内置固定项，2026-10-05 口径）**：规则的 ``related_functions``
可引用公共函数，规则闸要求「关联函数执行过」才算满足，而 Agent 只能通过 MCP 工具调用函数——
若无人发布公共函数，引用它们的规则会被永久判缺口并阻断行为执行（2026-10-04 之前正是此状态）。

口径：公共函数 MCP 与本体查询 MCP 并列为**内置固定项**——恒存在、恒启用、恒全选（全部工具）、
不可编辑 / 停用 / 删除；``mcp-config-store.normalize`` 会复位任何篡改（删除条目、停用、
限 ``allowed_tools``、手改 URL 均被归位为常量形态）。**预置服务已清零**：数据引擎执行服务
2026-10-19 零工具化后不再有 MCP 地址，存量配置中的条目被 ``normalize`` 直接丢弃
（按 host:port 判定，含更名前容器名）。已由 ``mcp-config-store.test.ts`` 与
``agent-factory-dead-data-engine.test.ts`` 的防回归用例锁定。

## 11. 零工具执行底座（2026-10-19 方案 B）

**决定**：删除数据引擎执行服务（8005）的 MCP 工具面，与本体函数执行服务（8006）对称：
`transport=none`，不挂 `/mcp`、`/sse`，不注册 `list_tools`/`call_tool`。行为工具的唯一提供方
是**自建发布**（按本体切片 + 令牌 + 发布即冻结）。

**为什么**：工具面有两个提供方时，"谁能调用哪些行为"存在两套答案（全量内网挂载 vs 发布授权），
且同一行为会被两个服务同时发布、在 Agent 目录里产生同名工具。收敛为单一出口后，
"发布即授权"成为结构事实，而不是约定。

**影响面（同批改动，缺一即不一致）**：

| 层 | 改动 |
|---|---|
| 8005 | `server.py` 零工具化；`behavior_tools.py` → `behavior_index.py`（只保留归属校验/未就绪区分） |
| Agent 配置 | 不再预置条目；存量条目（当前/历史地址）由 `normalize` 丢弃；移除 `isDataEngineMcpUrl` 收编豁免 |
| 规划面 | 可规划集 = 实际挂载目录（`behaviorNames`），新增 `notPublished` 原因与 nudge |
| 查询面 | `listOntoBehaviors` 按「已就绪 ∩ 已发布」过滤（`mcp-shared/publish_registry`） |
| 前端/compose/护栏 | 卡片传输模式 `none`、删除注入环境变量、契约测试锁定「零工具不可回退」 |

**上线顺序**：agent-backend（配置迁移 + 规划判据）→ core/frontend（护栏/文案）→ 8005 切 `none`。
反向顺序会出现"Agent 仍预置 8005、端点已 404"的窗口期。

**前置校验（必跑）**：上线前确认每个本体「已就绪行为 ⊆ 已发布行为」。若有就绪但未发布的行为，
它上线后将不可规划——需先在自建发布补勾选。

**回滚**：还原 `server.py` 即恢复工具面；Agent 侧需手动补回 MCP 配置条目（或整提交回滚）。
决策记录见 `specs/2026-10-19-zero-tool-executor-decision.md`。