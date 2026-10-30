# 功能规范：中文名字段统一 `display_name` → `title`（全栈硬切）

**特性分支**: `006-display-name-to-title`

**创建日期**: 2026-10-29

**状态**: 草案（待评审，未开始实现）

**输入**: 用户 2026-10-29 决策回合——「方案 A，硬切，不写兼容」；范围＝①本体明细中所有 `display_name` 替换为 `title`；②前后端全部功能组件同步修改、语义一致；③本体文件、模板文件等存量材料一并改写。硬约束：语义正确，不得错误替换。

**追加决策（2026-10-29 第二回合）**：行为参数也统一为 `title`，`description` 降级为可选的补充说明 —— 见 FR-016 与 §10 D-2。

**修订记录（2026-10-30）**：关闭「已知遗留 1」。编译器注入的系统参数 `ontology_id`（本体执行类
`params_to_input_schema` + 本体查询类 `build_query_schema`）补 `title: 本体ID` —— 它不在源数据 `params` 中，
没有任何可搬运的中文名，故中文名由编译器**声明**（不是 `description` 兜底）；用户定义参数仍严格"无 `title`
就不产出 `title`"。改动落点：`mcp-shared/tool_contract.py`（模块 docstring ①b + 两处注入块）、
`mcp-shared/tests/test_tool_contract.py`（3 例）、`specs/contracts/mcp-tools.md` §2/§9.1。
已发布工具需**重新发布**才带新 schema（发布即快照）。

**修订记录（2026-10-30 第二回合）**：中文名**投影到 MCP 协议字段 `Tool.title`**（对应 FastMCP 的
`@mcp.tool(title=...)`）。范围与边界：三处发布端（自建发布门面、本体查询、公共函数）在构造 `Tool` 时带
`title`；唯一注入点 `mcp-shared/mcp_app.py::titled_tool_kwargs()`（SDK 无该字段时降级为不产出）。
**平台自身不消费**该字段（用户决策）：agent 仍读 `inputSchema["x-title"]`、前端仍用
`name`/`description`——它是"对外部 MCP 客户端可见的显示名"，不是平台内部的另一个取数来源。

**修订记录（2026-10-30 第三回合，方向反转）**：`Tool.title` 从"派生"升为**权威值**，`x-title` 降为它的
**运行期投影**——快照改为 `tools[] = { name, title, description, inputSchema }`（不存 `x-title`）；
`with_category` / `with_ontology_scope` 不再产出 `x-title`；容器启动时由 `titled_tool_kwargs()` **唯一一处**
写 `Tool(title=…)` 与 `inputSchema["x-title"]`（空值两者都不产出；SDK 不支持 `title` 时只丢协议字段，
`x-title` 照旧）。`publishes.json` 已一次性迁移（5 条工具 `x-title` → `title`）。平台侧消费点不变（仍读 `x-title`）。

**修订记录（2026-10-30 第四回合，元数据同位）**：`category` 与 `ontologyScope` 同样从 `inputSchema`
提升为**工具级字段**（快照 `tools[] = { name, title, category, ontologyScope, description, inputSchema }`），
由同一个写入点 `mcp_app.tool_kwargs()` 在容器启动时投影成 `x-category` / `x-ontology-scope`。
协议层**没有**对应字段（`Tool.annotations` 只有中文名 + 四个行为提示），故这两个键仍以扩展键表达，
**不迁 `Tool._meta`**（迁了要改 agent 的两处功能性消费点与 `assertToolProtocol` 守卫，收益仅是协议面整洁）。
`publishes.json` 第二批迁移完成（5 条工具）。消费端零改动。

**存量数据补录（2026-10-30）**：本体明细中 33 个行为的 **61 个行为参数**此前无 `title`（行为本身与返回结构
中文名均已齐全），已按语义补齐：优先沿用「参数名 = 概念属性名」的属性 `title`（`原材料编号` / `到位数量` /
`采购单号` 等），无同名属性者按该本体概念的中文属性名与行为描述定名（`订单批次号` / `排产场景` /
`轮询间隔（分钟）` / `工艺路径编号` 等）。落盘仅 3 个本体工作副本（`原材料采购和库存` 21、`订单排程` 25、
`货品BOM及工艺` 15），纯新增行、无删除。

**版本归档同批补齐（2026-10-30，用户确认）**：历史快照不再豁免——`ontology_versions/v1.0` 的 8 个行为
21 个参数按**同一映射**补 title（`v1.1` 早已齐全，0 处改动）。至此全部本体文件（工作副本 3 + 归档 2）
行为参数 `title` 缺失数均为 0；归档同样纯新增行、无删除。

---

## 0. 背景与目标

平台内"中文名"这一语义目前有 **4 种并行形态**：

| 形态 | 出现位置 | 现状问题 |
|---|---|---|
| `display_name`（snake） | 本体 YAML / 公共函数清单 / securities 快照 / agent 读 YAML 的中间结构 | 与前端 `ColumnType.title`、MCP 协议字段同名不同义，易混 |
| `description` | `behaviors[].params[]` 用它承担"参数中文名" | 与 `functions[].params[]` 的 `display_name` 口径相反（本次一并统一到 `title`，见 FR-016） |
| `x-display_name` | 工具 inputSchema 顶层扩展键 | 非标准、无规范语义 |
| `displayName` / `displayLabel` | agent SSE 与工具目录 DTO | 与持久化层命名脱节 |

**目标**：`title` 成为"中文名"的**唯一**字段名，`display_name` 在代码与数据中彻底消失。

**非目标**：不改变任何实体/参数的业务语义与取值；不引入别名、不做读时兼容、不做双写（见 §5）。

---

## 1. 命名分层（先钉死"哪些叫 title"）

| # | 层 | 现名 | 新名 | 备注 |
|---|---|---|---|---|
| L1 | 本体 YAML 持久化 | `display_name` | `title` | 概念 / 属性 / 关系 / 概念关系 / 函数 / 行为 / 规则 / 流程 / data_engines / securities |
| L2 | 参数与返回字段声明 | `display_name` | `title` | `functions[].params[*]`、`.response[*]`、`data_engines[].target.params/response`（含 `items.properties` 深层） |
| L3 | 公共函数清单 | `display_name` | `title` | 顶层（工具中文名）+ `inputSchema.properties[*]`（参数中文名） |
| L4 | 规则生成 API 请求体 | `rule_display_name` | `rule_title` | 仅 `POST /rules/generate`；同时改提示词占位符 |
| L5 | 工具级中文名 | `x-display_name` → ~~`x-title`~~ → **工具级 `title`** | 2026-10-30 第三回合：协议字段 `Tool.title` / 快照 `tools[].title` 为权威值，`x-title` 降为运行期投影（平台内消费它） |
| L6 | 编译产物（参数级） | 拼进 `description` 字符串 | `schema.properties[k].title` | 见 FR-002 |
| L7 | agent 读 YAML 中间结构（snake） | `display_name` | `title` | `ConceptInfo` / `ConceptInfo.attributes` / `BehaviorMeta` / `FunctionMeta` / `SubTaskPlan` |
| L8 | agent / 前端 DTO（camel） | `displayName` | `title` | `MountableToolInfo` / `FunctionInfo` / `ExecutionEntry` |
| L9 | 执行记录 DTO 的纯中文标签 | `displayLabel` | **并入 `title`** | 同一语义（中文名）不得有两个字段：`title` 统一为**纯中文名**，「中文（英文）」组合串改为前端按 `title` + `name` 拼接，不再作为字段下发 |
| L10 | **保留** | `x-category` / `category` / `displayName` 之外的 `label` | 不变 | 与"中文名"无关 |

> L1–L8 全部改名；L9/L10 保留并在评审中重点确认，避免"为了统一而错误合并两种不同语义"。

---

## 2. 用户场景与测试 *（必填）*

### 用户故事 1 - 设计者看到的字段名一致（优先级：P1）

作为本体设计者，我在概念、属性、关系、函数、行为、规则、流程、安全、数据引擎九类表单里，中文名输入项的字段一律是 `title`，
导出的 `ontology.yaml` / `securities.yaml` / `data_engines.yaml` / `functions.json` 里也只有 `title`，不再出现 `display_name`。

**优先级理由**：这是整个需求的字面目标；不做则后续所有层无锚点。

**独立验证**：在任一表格新增/编辑一条记录并保存，检查落盘 YAML 的键名为 `title`；`grep display_name .data` 零命中。

**验收场景**：

1. **Given** 新建概念并填中文名，**When** 保存，**Then** `ontology.yaml` 中该概念仅有 `title` 键，无 `display_name`。
2. **Given** 概念的属性行填中文名，**When** 保存，**Then** 属性项同为 `title`。
3. **Given** 函数参数 JSON 中写 `title`，**When** 保存并重新打开，**Then** 中文名原样回显（不被丢弃）。
4. **Given** 行为的参数 JSON 中写 `title`（与函数参数同口径），**When** 保存并重新打开，**Then** 中文名原样回显；`description` 仅作为补充说明保留，不再承担中文名。

---

### 用户故事 2 - LLM 能结构化读到工具与参数中文名（优先级：P1）

作为平台维护者，我希望发布的 MCP 工具里，工具中文名在**工具级 `title`**（协议字段，平台内由 `x-title` 投影可见），
参数中文名在 `inputSchema.properties[k].title`，这样外部 MCP 客户端与平台自身都能稳定识别，而不需要从 `description` 字符串里猜。

**独立验证**：调用自建发布的工具清单接口，断言 `tools[].title` 存在且等于本体 item 的 `title`、容器 `tools/list` 同时回出 `title` 与投影 `inputSchema["x-title"]`、每个参数节点有 `title`，且 `description` 头部的中文名拼接口径不变（`中文名：说明`）。

**验收场景**：

1. **Given** 本体函数 `sumRawNotArrivalQty`（参数 `filterRawMaterialName.title=原材料名称`），**When** 发布为工具，**Then** 该参数 schema 为 `{type:string, title:'原材料名称', description:'示例: 高强度钢板'}`。
2. **Given** 本体行为已就绪，**When** 发布，**Then** 快照 `tools[].title` = 行为 `title`（中文名），容器启动后 `Tool.title` 与 `inputSchema["x-title"]` 同值，`x-category` 不变、`inputSchema` 内无 `x-title` 快照残留。
3. **Given** 公共函数清单中某参数有 `title`，**When** 通过 8007 服务列出工具，**Then** 该 `title` 原样透传，未被剥离。

---

### 用户故事 3 - 运行期展示链路中文名不断（优先级：P1）

作为使用对话的用户，我在规划确认弹窗、执行记录、子任务标题里看到的中文名与设计面一致，
因为 agent 读 YAML 与 DTO 传输的字段都叫 `title`。

**独立验证**：一次「查询 + 计算」双步对话，规划弹窗、执行记录侧栏、子任务组标题三处中文名均非空且与本体定义一致。

**验收场景**：

1. **Given** 行为 `title=查询原材料采购单信息`，**When** 规划出该行为子任务，**Then** `plan.subtasks[].title` 为该中文名。
2. **Given** 执行完成，**When** 查看执行记录，**Then** 条目 `title` 为「中文（英文）」格式、`displayLabel` 为纯中文（字段名保持不变）。
3. **Given** 函数工具来自公共函数清单，**When** 调度为函数子任务，**Then** 目录 `FunctionInfo.title` 取到公共函数顶层 `title`。

---

### 用户故事 4 - 存量材料一次性迁移且可验证（优先级：P2）

作为平台维护者，我要一次性把 `.data` 下全部本体文件、版本存档、模板、技能文档、发布快照、公共函数清单改写成 `title`，
并有迁移脚本与校验脚本，保证上线后没有任何文件还在用旧键。

**独立验证**：迁移脚本执行后用校验脚本检查：所有 YAML/JSON 可解析、键集合无 `display_name`、实体的 `title` 非空数量与迁移前 `display_name` 非空数量一致。

**验收场景**：

1. **Given** 迁移前 `原材料采购和库存/ontology.yaml` 有 156 处 `display_name`，**When** 执行迁移，**Then** 校验脚本报告 `display_name=0`、`title` 数量与迁移前非空数一致、文件可被 core 正常加载。
2. **Given** `ontology_versions/v1.0|v1.1` 存档，**When** 迁移，**Then** 存档同样改写（本 spec 采用**全量改写**，不保留历史键名，见 §10 D-6）。
3. **Given** `mcp_publishes/publishes.json` 内有存量 `x-display_name`，**When** 迁移并重发布，**Then** agent 目录条目 `title` 非空。

---

## 3. 需求 *（必填）*

### 功能需求

- **FR-001（持久化字段）**：`ConceptItem` / `AttributeItem` / `InheritedAttributeItem` / `RelationItem` / `ConceptRelationItem` / `FunctionItem` / `BehaviorItem` / `RuleItem` / `ProcessItem` / `SecurityItem` / `DataEngineItem` 的中文字段一律改名为 `title`，默认值仍为空串。**不保留 `display_name` 别名、不加 `model_validator` 兼容分支**。
- **FR-002（参数中文名编译位置）**：`mcp-shared/tool_contract.param_spec_to_schema` 的中文名取值改为 `spec.title`，产物写 **`schema.title`**；`description` 只承载 `示例: x`（无示例时省略）。
  **兜底链保持 `spec.title or spec.description`**——兜底只服务外部 MCP 工具与历史快照；本体侧（函数与行为）参数一律写 `title`（见 FR-016）。
- **FR-003（工具级中文名）**：`x-display_name` → `x-title` → **工具级 `title`**（2026-10-30 第三回合反转）。
  权威值 = 快照 `tools[].title`（源自本体 `functions/behaviors[].title`）/ 查询工具 label / 公共函数 manifest `title`；
  `with_category(schema, category)` 与 `with_ontology_scope(schema, scope, category)` **不再接收也不产出** `title` / `x-title`；
  `x-title` 由 `mcp_app.titled_tool_kwargs()` 在容器启动时投影（常量 `TITLE_KEY` 保留为投影键）。
  **禁止**把工具中文名写入 `inputSchema.title`（那是 JSON Schema 描述 schema 自身的键）。
- **FR-004（快照与派生）**：`securities.yaml` 的 `display_name` → `title`，`_sync_securities_roster` 写 `sec.title = b.title or b.name`；`concept_relations` 的 SubClassOf 派生字段同步改名，派生文案规则不变。
- **FR-005（规则生成请求体）**：`rule_display_name` → `rule_title`（前端 `RuleTable` 请求体 + `routers/rules.py` 取值 + `prompts/rule_generate.py` 占位符三处同改）。
- **FR-006（agent 读 YAML 层）**：`ontology-gateway`（`resolveConcepts` / `getBehaviorMeta` / `getFunctionInfo`）、`security-policy`、`execution-policy`、`param-contract`、`subtask-runner`、`plan-presentation`、`event-channel`、`planning-phase`、`orchestrator`、`agent-factory`、`function-catalog` 全部改读 `title`；`types.ts` 的 `ConceptInfo` / `BehaviorMeta` / `FunctionMeta` / `SubTaskPlan` 字段改名。
- **FR-007（DTO camelCase）**：`MountableToolInfo.displayName` → `title`、`FunctionInfo.displayName` → `title`；`SubtaskInfoPort.behaviorDisplayName/functionDisplayName` → `behaviorTitle/functionTitle`。
  `ExecutionEntry` 原先的 `title`（=「中文（英文）」组合串）与 `displayLabel`（=纯中文名）**合并为单一 `title`（纯中文名）**，组合串在渲染层拼（`EntryCard`），`SubtaskChatItem` / `LogEntry` 同步删除 `displayLabel`。
- **FR-008（前端类型与 API）**：`frontend/src/api/design.ts`（Attribute / Concept / Relation / ConceptRelation / Function / Behavior / Rule / Process / Security）、`api/data-engines.ts`（DataEngine 及其 target 结构）字段改名；所有消费点同步。
- **FR-009（前端设计面 12 个组件）**：`ConceptTable`、`ConceptAttributeModal`、`ConceptRelationTable`、`ObjectRelationTable`、`FunctionTable`、`BehaviorTable`、`RuleTable`、`ProcessTable`、`SecurityTable`、`DataEngineTable`、`MCPPublish`、`DeployedVersionBadge` 的 `dataIndex` / `renderCell(field)` / 编辑态 `editData` / 保存体字段全部改名。**表格列头文案「中文名称」保留**（那是 UI 文案，不是字段名）。
- **FR-010（前端视图与 agent 会话）**：`OntologyGraph` / `InstanceGraph` / `instance-graph-model`、`agent/*`（`sse-events`、`use-agent-stream`、`SubtaskBlock`、`MessageList`、`PlanConfirmModal`、`plan-editing`、`execution-log`、`chat-types`、`EntryCard`）同步读 `title`。
- **FR-011（LLM 可见文本）**：`ontology-query-mcp/server.py` 的 8 个查询工具 **description 文案里列举的字段名**（"返回 name、display_name…"）与 `_filter_list` 搜索键改 `title`；`services/ontology_summary.py` 的摘要标签；`routers/rules.py` 拼给 LLM 的上下文；`.data/templates/skill_template.md` 与实际 `SKILL.md`；三份生成提示词（`ontology_generate` / `analysis` / `rule_generate`）中的字段口径。
- **FR-012（存量材料迁移）**：`.data` 下 17 个文件一次性改写（清单见附录 A），另含 `specs/contracts/*.md` 契约文档与 `specs/003/tasks.md` 口径记录。
- **FR-013（零兼容）**：代码库中 **MUST NOT** 保留任何 `display_name` 读取、回退、别名、迁移分支或 `getattr(obj, 'display_name', ...)` 兜底；**MUST NOT** 双写。
- **FR-014（残留门禁）**：新增校验脚本 `scripts/check_no_display_name.py`，对 `core-backend` / `agent-backend/src` / `frontend/src` / `mcp-shared` / `*-mcp` / `*-executor` / `.data` / `scripts` 做全量扫描，`display_name` 命中数 MUST 为 0（白名单仅限 `specs/003/tasks.md` 的历史记录与 `specs/006/spec.md` 本身）。
- **FR-015（测试同步）**：所有断言 `display_name` 的用例改为 `title`（core pytest、agent vitest、frontend vitest、E2E 脚本）；MUST NOT 删除用例，只改断言口径。
- **FR-016（行为参数口径统一，2026-10-29 追加）**：`behaviors[].params[*]` 与 `behaviors[].response[*]` 的中文字段由 `description` 改为 **`title`**；`description` 降级为可选的补充说明、空值不落盘。覆盖：
  ① `.data` 存量迁移（非空 `description` 原位改写为 `title`，空描述移除；嵌套 `properties` / `items.properties` 同规则）；
  ② `.data/templates/onto_template.yaml` 与 `skill_template.md`；
  ③ 生成提示词（`ontology_generate` 要求 7、`analysis` 要求 5/6 的样例）；
  ④ 契约 `specs/contracts/ontology-yaml.md`；
  ⑤ 前端 `BehaviorTable` 编辑态归一化写 `title`、参数/返回结构 tooltip 展示 `title`。
  迁移 MUST 逐条守恒（非空中文名值不得改变），冲突（同项已有不同 `title`）MUST 中止而非猜测。

---

## 4. 关键实体（字段映射）

| 实体 | 字段（改后） |
|---|---|
| Concept | `name / title / description / terms / instance_label / sub_class_of / attributes / attribute_restrictions` |
| Attribute | `name / type / title / description / example / constraint` |
| Relation / ConceptRelation | `name / title / source / target / …` |
| Function | `name / title / description / related_concepts / params / response / code_file / type` |
| Behavior | `name / title / description / op_type / params / response / concept / from_status / to_status` |
| Rule | `name / title / description / behavior / related_functions / position / data_supplements` |
| Process | `name / title / goal / description / steps` |
| Security | `action_name / title / op_type / scope / confirm / confirm_content` |
| DataEngine | `name / title / behavior_name / target / input_mapping / output_mapping` |
| 参数声明（函数侧） | `type / title / description / example / required / items / properties` |
| 参数声明（行为侧，2026-10-29 起同函数侧） | `type / title / description / example / required / items / properties` |

---

## 5. 硬切的具体约束（方案 A 的代价，必须写清）

1. **不做任何兼容**：不加 `title` 与 `display_name` 的互转校验器、不保留回退读取。
2. **静默失效是主要风险**：Pydantic v2 默认忽略未知键，旧文件里的 `display_name` 不会被报错，只会让中文名变成空串。因此**文件迁移必须先于代码上线**，或与代码同批上线（同一次部署内完成）。
3. **必须同版本一起上线**：`core-backend`、`agent-backend`、`frontend`、`mcp-shared`（被 core 与多个 MCP 服务共用）、`ontology-query-mcp`、`common-function-mcp`、`data-engine-executor`。任一侧滞后即出现"字段对不上"。
4. **已发布工具必须重发**：`.data/mcp_publishes/publishes.json` 与运行中的发布容器固化的是旧键 `x-display_name`，需迁移文件 + 重新发布/重启容器，否则中文名丢失（不报错）。
5. **agent 运行环境用户目录**（`agent-backend/.opt-agent/users/{uid}/`）内的本体副本不在仓库中，需在部署时按"整体覆盖"语义重新下发，否则该用户侧中文名为空。

---

## 6. 风险与缓解

| # | 风险 | 影响 | 缓解 |
|---|---|---|---|
| R1 | 漏改一处 → 静默丢中文名 | 无报错、无测试失败 | FR-014 全量残留扫描 + §7 迁移校验 + E2E 中文名断言 |
| R2 | 数据字段 `title` 与 antd `ColumnType.title` / `Modal.title` / `Tooltip.title` 混淆 | 代码评审与后续维护歧义；误把列头文案当字段 | 约定：列定义形如 `{ title: '中文名称', dataIndex: 'title' }`，评审重点核对；组件 prop 语义不变 |
| R3 | `x-title` 协议键改名导致发布端/消费端错配 | 中文名丢失（非致命） | 同版本部署 + `assertToolProtocol` 已能拦截更严重的 scope 错配；发布容器重发 |
| R4 | 行为参数 `description` → `title` 的迁移把真正的"说明文字"误当中文名搬走 | 语义错位 | 迁移前勘察：全部 162 条行为参数中仅 7 条非空，值均为中文名（模板示例），零冲突；迁移脚本对"已有不同 title"直接中止 |
| R4b | 迁移时 `title` 追加到 dict 末尾导致 YAML 键序错乱 | 模板可读性下降 | 脚本改为**原位改写**（`title` 落在原 `description` 位置）；模板已人工复核键序（`type → title → required → example`）|
| R5 | 存档目录改写破坏"存档=当时形态"语义 | 版本对比失真 | §10 D-6 决策：本次**一并改写**（用户要求存量材料统一） |
| R6 | 前端 `renderCell(v, r, 'display_name')` 第三参为字段名字符串，漏改会静默取不到值 | 单元格空白 | 逐组件核对 + 单测覆盖「编辑态字段回显」 |
| R7 | `data_engines.yaml` 的 `display_name` 无运行期消费者（mapper 不读） | 改了不影响运行，但不改留下半新半旧 | 纳入迁移清单，一次性改完 |

---

## 7. 验收标准 *（必填）*

- **SC-001**：`grep -rn "display_name"` 在代码与 `.data` 中命中为 0（白名单见 FR-014）。
- **SC-002**：core `pytest` 全绿、agent `vitest` 全绿、frontend `vitest` 全绿；`tsc --noEmit` 通过。
- **SC-003**：迁移校验脚本对 17 个存量文件输出：可解析、`display_name=0`、`title` 非空计数与迁移前 `display_name` 非空计数逐文件相等。
- **SC-004**：端到端——设计面保存一条概念/函数/行为 → 落盘为 `title` → 发布为工具（`x-title` + 参数 `title`）→ agent 规划弹窗/执行记录中文名正确。
- **SC-005**：`ontology-query-mcp` 8 个查询工具返回体中中文字段名为 `title`，工具 description 文案与之一致。
- **SC-006**：`.data` 内 `behaviors[].params` 与 `behaviors[].response` **不含** `description` 承载的中文名（空说明不落盘）；迁移报告显示非空中文名 11 处逐条守恒；行为工具编译产物每个参数节点有 `title`。

---

## 8. 边界与不做

- **不做读时兼容、不做双写、不保留旧键**（用户已定方案 A）。
- **不改**参数节点上 `description` 的"补充说明"语义（只放说明文字，不再承担中文名）；空说明不落盘。
- **不保留** `displayLabel`（已并入 `title`，见 L9）；「中文（英文）」这类**拼接串**只允许出现在渲染层，不得作为字段下发或落盘。
- **不改** `x-category`、`x-ontology-scope`、`ontology_id` 等非"中文名"的键。
- **不把工具中文名写进 `inputSchema.title`**（避免与 JSON Schema 关键字语义冲突）。
- **不重构**与改名无关的逻辑；不改 UI 文案「中文名称」「展示名称」等中文标签。
- 不做数据库迁移（平台为文件存储）。

---

## 9. 实施顺序（供 plan 展开）

1. 契约先行：`specs/contracts/ontology-yaml.md`、`specs/contracts/mcp-tools.md`。
2. core 模型层（`schemas`）+ 派生/快照层（`services`）。
3. 发布编译层（`mcp-shared` + `mcp_publish_registry`）。
4. 执行/查询 MCP（`ontology-query-mcp`、`data-engine-executor`、`common-function-mcp`）。
5. agent 运行时与 DTO。
6. 前端类型 + 设计面 + 视图 + agent 会话。
7. 存量材料迁移脚本 + 迁移 + 残留校验脚本。
8. 全量回归与端到端验收。

---

## 10. 待评审确认项（本 spec 已按推荐值写入 FR，否决则需回改）

| # | 事项 | 本 spec 的默认取值 |
|---|---|---|
| D-1 | 参数中文名在 `inputSchema` 的落点 | **写 `schema.title`**（FR-002），`description` 只留说明与示例 |
| D-2 | 行为 `params[].description` 是否一并改 `title` | **已纳入**（2026-10-29 用户追加决策）：行为参数与函数参数统一用 `title`，`description` 降级为可选补充说明（FR-016） |
| D-3 | 工具级扩展键 | `x-title`（FR-003），需重发布 |
| D-4 | camelCase `displayName` / `displayLabel` | 一并收口为 `title`（FR-007）：`title` = 纯中文名，组合串由渲染层拼 |
| D-5 | `ontology_versions` 存档 | **一并改写**（用户要求存量材料统一） |
| D-6 | 公共函数清单 `inputSchema.properties[*].display_name` | 改 `title`；`schemaToDeclaredParams` 必须保留 `title`（当前会丢弃） |

---

## 附录 A：存量材料迁移清单（17 个文件，约 1037 处）

| 文件 | 处数 | 备注 |
|---|---|---|
| `.data/onto_market/生产调度/原材料采购和库存/ontology.yaml` | 156 | 含嵌套 `items.properties` 深层 |
| `.data/onto_market/生产调度/原材料采购和库存/ontology_versions/v1.0/ontology.yaml` | 156 | 存档，按 D-5 改写 |
| `.data/onto_market/生产调度/原材料采购和库存/ontology_versions/v1.1/ontology.yaml` | 173 | 同上 |
| `.data/onto_market/生产调度/订单排程/ontology.yaml` | 106 | |
| `.data/onto_market/生产调度/货品BOM及工艺/ontology.yaml` | 56 | |
| `.data/onto_market/生产调度/原材料采购和库存/data_engines.yaml` | 97 | 含 target.params/response 深层 |
| `.data/onto_market/生产调度/原材料采购和库存/ontology_versions/v1.0/data_engines.yaml` | 97 | |
| `.data/common_functions/functions.json` | 31 | 顶层 + properties |
| `.data/templates/onto_template.yaml` | 25 | 生成链路权威骨架 |
| `.data/onto_market/生产调度/订单排程/securities.yaml` | 14 | 快照，迁移后建议触发一次保存刷新 |
| `.data/mcp_publishes/publishes.json` | 14 | 含 `x-display_name` |
| `.data/onto_market/生产调度/货品BOM及工艺/securities.yaml` | 11 | |
| `.data/onto_market/生产调度/原材料采购和库存/ontology_versions/v1.1/securities.yaml` | 9 | |
| `.data/onto_market/生产调度/原材料采购和库存/securities.yaml` | 8 | |
| `.data/onto_market/生产调度/原材料采购和库存/ontology_versions/v1.0/securities.yaml` | 8 | |
| `.data/onto_market/生产调度/原材料采购和库存/skills/raw-material-inventory/SKILL.md` | 71 | LLM 上下文材料 |
| `.data/templates/skill_template.md` | 5 | |

---

## 附录 B：代码改动清单（约 89 个文件）

| 层 | 文件 |
|---|---|
| core 模型/服务 | `schemas/__init__.py`、`services/__init__.py`、`services/concept_relations.py`、`services/ontology_summary.py`、`services/mcp_publish_registry.py`、`routers/rules.py` |
| core 提示词 | `prompts/ontology_generate.py`、`prompts/analysis.py`、`prompts/rule_generate.py` |
| core 测试 | `tests/test_concept_relations.py` |
| 工具契约 | `mcp-shared/tool_contract.py`、`mcp-shared/tests/test_tool_contract.py` |
| MCP 服务 | `ontology-query-mcp/server.py`(+test)、`common-function-mcp/server.py`(+test)、`data-engine-executor/behavior_index.py`(+test) |
| agent 运行时 | `agent-backend/src/types.ts`、`services/ontology-gateway.ts`(+test)、`services/common-functions.ts`(+test)、`agent/tool-catalog.ts`、`agent/subtask-runner.ts`(+test)、`agent/security-policy.ts`(+test)、`agent/execution-policy.ts`(+test)、`agent/function-catalog.ts`(+test)、`agent/plan-presentation.ts`、`agent/param-contract.ts`、`agent/planning-phase.ts`、`agent/event-channel.ts`、`agent/orchestrator.ts`(+test)、`agent/agent-factory.ts`(+test / test-harness / business-data.test)、`agent/wave-executor.test.ts`、`agent/plan-gate.test.ts`、`routes/threads-skills.endpoints.test.ts` |
| agent 脚本 | `scripts/e2e-confirm-policy.py`、`e2e-function-subtasks.py`、`e2e-prerule-trace-gate.py`、`e2e-retry-onto-fn.py`、`probe-mcp-catalog.py`、`verify-supplement-render.ts`、`verify-harness-fixes.ts`、`verify-related-functions.ts` |
| 前端类型/API | `api/design.ts`、`api/data-engines.ts` |
| 前端设计面 | `ConceptTable.tsx`、`ConceptAttributeModal.tsx`、`ConceptRelationTable.tsx`、`ObjectRelationTable.tsx`、`FunctionTable.tsx`、`BehaviorTable.tsx`、`RuleTable.tsx`、`rule/function-label.ts`(+test)、`ProcessTable.tsx`、`SecurityTable.tsx`、`DataEngineTable.tsx`(+test)、`data-engine/data-engine-helpers.ts`、`data-engine/ConnectTestModal.test.tsx`、`MCPPublish.tsx` |
| 前端视图 | `View/OntologyGraph.tsx`、`View/InstanceGraph.tsx`、`View/instance-graph-model.ts`(+test) |
| 前端 agent 会话 | `agent/sse-events.ts`、`agent/use-agent-stream.ts`(+test)、`agent/SubtaskBlock.tsx`、`agent/MessageList.tsx`(+test)、`agent/PlanConfirmModal.tsx`(+test)、`agent/plan-editing.ts`、`agent/execution-log.ts`(+test)、`agent/chat-types.ts`、`agent/EntryCard.tsx`、`agent/ExecutionLogDrawer.test.tsx`、`agent/AgentConversation.test.tsx` |
| 前端其他 | `components/DeployedVersionBadge.test.tsx`、`components/Design/RelationTable.test.tsx` |
| 项目脚本 | `scripts/migrate_securities_file.py`、`scripts/test_mcp_tools.py`、`scripts/e2e-spec003-model-extension.py`、新增 `scripts/check_no_display_name.py` |
| 契约文档 | `specs/contracts/ontology-yaml.md`、`specs/contracts/mcp-tools.md`、`specs/003-ontology-model-extension/tasks.md`、`specs/005-concept-subclassof/spec.md`、`specs/001-frontend-test-quality/spec.md` |

---

## 附录 C：迁移脚本要求（硬切必备）

1. 输入：仓库根 `.data`；输出：原地改写 + 生成迁移报告（逐文件 处数 / 解析状态）。
2. 必须走 **YAML/JSON 解析 → 键改名 → 重新序列化**，**禁止**文本正则替换（会误改 `x-display_name` 之外的注释、SKILL.md 正文、以及 `display_name` 作为普通字符串值的场景）。
3. `x-display_name` → `x-title` 单独处理（属扩展键，规则同 L5）。
4. `ontology.yaml` / `securities.yaml` / `data_engines.yaml` / `functions.json` / `publishes.json` / 两个模板分别适配（模板含说明性示例值，逐项人工复核）。
5. `SKILL.md` 为 Markdown，按"字段名 token"精确替换（`display_name` 整词），替换后人工复核 71 处上下文。
6. 校验：迁移前后对每个文件求「`display_name` 非空值的键路径 → 值」集合，迁移后按 `title` 重算，**集合必须完全相等**（这是"不能错误替换"的机器判据）。
