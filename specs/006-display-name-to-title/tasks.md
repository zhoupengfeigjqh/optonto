# 任务清单：中文名字段统一 `display_name` → `title`（全栈硬切）

**特性分支**: `006-display-name-to-title` · **对应规范**: [spec.md](./spec.md) · **对应计划**: [plan.md](./plan.md)

**状态**: 待执行（全部未开始）

> 执行纪律：每个批次结束时 `grep display_name` 只允许在**尚未改造的批次**内命中；全部完成后必须为 0（白名单见 FR-014）。

## 批次 A：契约文档（先行）

- [x] T001 `specs/contracts/ontology-yaml.md`：字段表全量 `display_name` → `title`；重写「`params` 说明字段口径」段（函数 `title` / 行为 `description`；编译器读取 `title or description`）
- [x] T002 `specs/contracts/mcp-tools.md`：`x-display_name` → `x-title`；新增「参数中文名 = JSON Schema `title`」口径段

## 批次 B：core 模型与派生

- [x] T003 `core-backend/schemas/__init__.py`：`AttributeItem` / `ConceptItem` / `InheritedAttributeItem` / `RelationItem` / `ConceptRelationItem` / `FunctionItem` / `BehaviorItem` / `RuleItem` / `ProcessItem` / `SecurityItem` / `DataEngineItem` 的 `display_name` → `title`（声明位置不动，保持 YAML 输出顺序）
- [x] T004 `core-backend/services/__init__.py`：`_sync_securities_roster` 写 `sec.title = b.title or b.name`；相关注释同步
- [x] T005 `core-backend/services/concept_relations.py`：SubClassOf 派生行 `title=sub_class_display(...)`（派生文案规则不变）
- [x] T006 `core-backend/services/ontology_summary.py`：摘要文本标签与取值改 `title`
- [x] T007 `core-backend/services/mcp_publish_registry.py`：`_description()` 取 `item.get("title")`；`with_ontology_scope(..., item.get("title", ""))`
- [x] T008 `core-backend/routers/rules.py`：入参 `rule_display_name` → `rule_title`；LLM 上下文与公共函数清单取值改 `title`
- [x] T009 `core-backend/prompts/ontology_generate.py`：字段口径 5 处改 `title`
- [x] T010 `core-backend/prompts/analysis.py`：字段口径 15 处改 `title`
- [x] T011 `core-backend/prompts/rule_generate.py`：占位符 `rule_display_name` → `rule_title`

## 批次 C：工具契约编译器

- [x] T012 `mcp-shared/tool_contract.py`：`DISPLAY_NAME_KEY` → `TITLE_KEY` = `x-title`
- [x] T013 `mcp-shared/tool_contract.py`：`param_spec_to_schema` 写 `schema.title`，取值链 `spec.title or spec.description`；`description` 只留 `示例: x`
- [x] T014 `mcp-shared/tool_contract.py`：`with_category` / `with_ontology_scope` 形参 `display_name` → `title`；模块 docstring 契约表同步
- [x] T015 `core-backend/services/mcp_contract_bridge.py`：核对导出面（常量未导出则仅注释同步，不新增导出）

## 批次 D：MCP 服务

- [x] T016 `ontology-query-mcp/server.py`：8 个查询工具 description 中列举的字段名改 `title`
- [x] T017 `ontology-query-mcp/server.py`：`_filter_list` 搜索键（3 处）与行为附加 `rules[]` 子结构改 `title`
- [x] T018 `common-function-mcp/server.py`：`with_category(..., entry.get("title", ""))`
- [x] T019 `data-engine-executor/behavior_index.py`：索引元数据 `display_name` → `title`

## 批次 E：agent 运行时

- [x] T020 `agent-backend/src/types.ts`：`ConceptInfo` / `ConceptInfo.attributes` / `BehaviorMeta` / `FunctionMeta` / `SubTaskPlan` 字段改 `title`
- [x] T021 `src/services/ontology-gateway.ts`：`resolveConcepts`（概念与属性）、`getBehaviorMeta`（含 `unavailable` 兜底分支）、`getFunctionInfo`（本体 + 公共函数）
- [x] T022 `src/services/common-functions.ts`：`schemaToDeclaredParams` **新增保留 `v.title`**；`getCommonFunctionInfo` 取 `title`
- [x] T023 `src/agent/tool-catalog.ts`：`DISPLAY_NAME_KEY` → `TITLE_KEY`；`MountableToolInfo.displayName` → `title`；`toMountableToolInfo` 读 `raw[TITLE_KEY]`
- [x] T024 `src/agent/function-catalog.ts`：`FunctionInfo.displayName` → `title`；文件兜底分支取 `f.title`
- [x] T025 `src/agent/execution-policy.ts`：`SubtaskInfoPort.behaviorDisplayName/functionDisplayName` → `behaviorTitle/functionTitle`；`meta.title`
- [x] T026 `src/agent/security-policy.ts`：注释与类型说明同步
- [x] T027 `src/agent/subtask-runner.ts`：展示名取值与事件字段改 `title`
- [x] T028 `src/agent/plan-presentation.ts`：`SubTaskPlan` 填充改 `title`
- [x] T029 `src/agent/planning-phase.ts` / `event-channel.ts` / `orchestrator.ts` / `agent-factory.ts` / `param-contract.ts`：目录与展示名取值改 `title`
- [x] T030 `agent-backend/scripts/*`（`e2e-confirm-policy.py` / `e2e-function-subtasks.py` / `e2e-prerule-trace-gate.py` / `e2e-retry-onto-fn.py` / `probe-mcp-catalog.py` / `verify-supplement-render.ts` / `verify-harness-fixes.ts` / `verify-related-functions.ts`）：断言与打印改 `title` / `x-title`

## 批次 F：前端

- [x] T031 `frontend/src/api/design.ts`：`Attribute` / `Concept` / `Relation` / `ConceptRelation` / `Function` / `Behavior` / `Rule` / `Process` / `Security` 字段改 `title`
- [x] T032 `frontend/src/api/data-engines.ts`：`DataEngine` 及 `TargetApiConfig` 字段改 `title`
- [x] T033 `Design/ConceptTable.tsx` / `ConceptAttributeModal.tsx` / `ConceptRelationTable.tsx` / `ObjectRelationTable.tsx`：`dataIndex` / `renderCell(field)` / `editData` / 保存体改 `title`
- [x] T034 `Design/FunctionTable.tsx` / `BehaviorTable.tsx`：同上；**`BehaviorTable` 编辑态归一化必须保留 `title`**（现只搬 4 键，改后不得丢）
- [x] T035 `Design/RuleTable.tsx`：`title` 字段 + 生成请求体 `rule_title`；`Design/rule/function-label.ts` 取 `fn?.title`
- [x] T036 `Design/ProcessTable.tsx` / `SecurityTable.tsx` / `DataEngineTable.tsx`：字段改 `title`；`getParamDisplay` 改读 `params[k].title`
- [x] T037 `Design/MCPPublish.tsx`：函数/行为选项 label 取 `title`
- [x] T038 `Design/data-engine/data-engine-helpers.ts` / `ConnectTestModal` 相关：字段改 `title`
- [x] T039 `View/OntologyGraph.tsx` / `View/InstanceGraph.tsx` / `View/instance-graph-model.ts`：节点标签与属性名取 `title`
- [x] T040 `Design/agent/*`（`sse-events.ts` / `use-agent-stream.ts` / `SubtaskBlock.tsx` / `MessageList.tsx` / `PlanConfirmModal.tsx` / `plan-editing.ts` / `execution-log.ts` / `chat-types.ts` / `EntryCard.tsx`）：`displayName` → `title`；**`displayLabel` 保持不变**
- [x] T041 前端测试夹具与断言同步（含 `DeployedVersionBadge.test.tsx` 的 YAML 夹具、`RelationTable.test.tsx`、`ConnectTestModal.test.tsx`、`PlanConfirmModal.test.tsx`、`AgentConversation.test.tsx`、`execution-log.test.ts`、`instance-graph-model.test.ts`、`function-label.test.ts`、`DataEngineTable.test.tsx`）

## 批次 G：存量材料迁移（必须先于代码上线）

- [x] T042 新增 `scripts/migrate_display_name_to_title.py`：YAML/JSON 解析式迁移（**禁止文本正则**），`x-display_name` → `x-title` 单独规则，`--dry-run` 报告
- [x] T043 迁移 `.data` 下 5 个 `ontology.yaml`（含 `ontology_versions/v1.0|v1.1`）
- [x] T044 迁移 `.data` 下 4 个 `securities.yaml` 与 2 个 `data_engines.yaml`
- [x] T045 迁移 `.data/common_functions/functions.json`（顶层 + `inputSchema.properties[*]`）与 `.data/mcp_publishes/publishes.json`
- [x] T046 迁移 `.data/templates/onto_template.yaml`（含说明性示例值逐项人工复核）
- [x] T047 迁移 `.data/templates/skill_template.md` 与 `.data/onto_market/**/skills/*/SKILL.md`（整词替换后 71 处人工复核）
- [x] T048 新增 `scripts/check_no_display_name.py`：全量残留扫描 + 迁移前后「非空中文名键路径→值」集合比对（必须完全相等）
- [ ] T049 迁移后重新发布受影响 MCP 工具 / 重启发布容器，确认 `x-title` 生效（**待部署环境执行**：本机无运行中的发布容器，`publishes.json` 快照已迁移）
- [x] T050 `.data` 备份与回滚快照：41 个 `.data` 文件由 git 跟踪，迁移前 HEAD 即回滚快照（`git checkout -- .data` 可整体还原）

## 批次 G+：行为参数口径统一（FR-016，2026-10-29 追加）

- [x] T058 新增 `scripts/migrate_behavior_param_title.py`：`behaviors[].params` 与 `response` 的 `description` 原位改写为 `title`（嵌套 `properties` / `items.properties` 同规则），空说明移除，冲突中止
- [x] T059 迁移 `.data` 六份文件（模板 11 处中文名 + 105 处空 description 清理），模板键序人工复核为 `type → title → required → example`
- [x] T060 `mcp-shared/tool_contract.py` 注释、`specs/contracts/ontology-yaml.md` §6、`prompts/ontology_generate.py` 要求 7、`prompts/analysis.py` 要求 5/6 样例统一为 `title`
- [x] T061 `.data/templates/skill_template.md` 行为参数示例改 `title`（"供应商名称，模糊匹配"拆为 `title` + `description`）
- [x] T062 前端 `BehaviorTable`：编辑态归一化写 `title`（不再产 `description: ''` 噪音）、参数与返回结构 tooltip 展示 `中文名`

## 批次 E+：DTO 同语义字段收口（2026-10-29 复审追加）

- [x] T063 agent `ExecutionEntry`：删除 `displayLabel`，`title` 改为**纯中文名**（行为/函数 title，空则回退子任务描述）；「中文（英文）」组合串改由前端渲染层拼
- [x] T064 同步 `event-channel.entryDisplay` 签名、`planning-phase`（3 处）、`subtask-runner`（4 处）、`orchestrator.test`、`subtask-runner.test`
- [x] T065 前端 `chat-types` / `execution-log` / `use-agent-stream` / `SubtaskBlock` / `EntryCard` 删除 `displayLabel`，`EntryCard` 渲染时拼 `title（name）`
- [x] T066 残留门禁升级：`check_no_display_name.py` 的 token 规则增加 `displayLabel` / `display_label`

## 批次 I：参数中文名取数口径收口（2026-10-29 复审追加）

> 背景：FR-016 落地后参数中文名由 `description` 迁到 `title`，但取数点未全部跟上——
> 仍按旧口径「`description` 优先」取中文名的地方，迁移后本体参数无 `description`，实际回退成英文 key。

- [x] T067 `Frontend/Design/FunctionTable.tsx`：参数/返回结构 tooltip 补 `title`（`中文名:`），`description` 降为 `说明:`
- [x] T068 `agent/param-contract.ts` `renderParamStructure`：`description || title` → `title || description`（与 `mcp-shared/tool_contract.param_spec_to_schema` 同序）
- [x] T069 `agent/subtask-runner.ts` `buildSecurityContent`、`Frontend/Design/agent/security-confirm-content.ts` `buildConfirmRows`、`Frontend/Design/agent/PlanConfirmModal.tsx` 参数行标签：改 `title || description || key`
- [x] T070 测试补 `title` 优先级用例：`param-contract.test.ts`（结构 sketch）、`security-confirm-content.test.ts`（参数行中文名）

## 批次 J：参数节点三键分义 + 兜底链全删（2026-10-30，复审硬切）

> 用户拍板：**不保留兼容、不保留冗余**。参数节点三个键各承一义，任何一端都不再从 `description` 兜底取中文名。

- [x] T071 `mcp-shared/tool_contract.py` `param_spec_to_schema`：`title` 只从 `spec.title` 取（删 `or spec.description` 兜底）；`description` 原样透传为补充说明；`example` 写入 `properties[k].example`（不再塞进 `description: 示例: x`）
- [x] T072 同步 `mcp-shared/tests/test_tool_contract.py`：三键同形用例 + 「中文名不从 description 兜底」用例（替代原兜底用例）
- [x] T073 `agent/services/ontology-gateway.ts` `getFunctionInfo`、`agent/services/common-functions.ts` `getCommonFunctionInfo`：`title: fn.title || fn.description` → `title: fn.title || ''`（原兜底会把「计算逻辑」当中文名）
- [x] T074 `agent/event-channel.ts` `entryDisplay`：`title` 只取 label，**不再回退子任务描述**（消除标题行与副行同句重复）
- [x] T075 `agent/param-contract.ts` `renderParamStructure`、`agent/subtask-runner.ts` `buildSecurityContent`、前端 `security-confirm-content.ts` / `PlanConfirmModal.tsx`：中文名只认 `title`，去掉 `|| description` 兜底
- [x] T076 契约文档同步：`specs/contracts/ontology-yaml.md` §6 参数口径表、`specs/contracts/mcp-tools.md` 参数节点段

## 批次 K：`concept_relations[].title` 语义判定与落盘收口（2026-10-30）

- [x] T077 **判定：不另设字段名**。该字段同为"该实体的中文名"，只是概念关系本身是断言，名字天然是句式（`采购订单与采购单等价` / `子概念 是一种 父概念`）；改名只会给"中文名"制造第二个名字
- [x] T078 SubClassOf 锚点的 `title` / `description` 是读时派生值（`derived_sub_class_rows` 恒覆盖），落盘永不回读 → `_compact_concept_relations` 对 SubClassOf 行**无条件剔除**这两个键；`.data/templates/onto_template.yaml` 同步删除该行的 `title` / `description` 示例值；补 2 例测试（非空也剔除 / 等价互斥保留）

## 批次 L：安全管控 title 快照语义收口（2026-10-30）

- [x] T079 `core/services/__init__.py` `_sync_securities_roster`：`sec.title = b.title or b.name` → `sec.title = b.title`（原写法会把**英文 name 写进中文名字段**并落盘；现无中文名就留空，前端显示 `-`）；补 2 例测试（有 title 刷新 / 无 title 留空串）

## 批次 M：注入参数 `ontology_id` 补中文名（2026-10-30，用户拍板）

> 关闭「已知遗留 1」：此前注入块只有 `description`，前端参数表与 LLM 面只能看到英文键名 `ontology_id`。

- [x] T080 `mcp-shared/tool_contract.py`：`params_to_input_schema` 注入块与 `build_query_schema` 各补 `"title": "本体ID"`；模块 docstring ①b 声明"注入参数是唯一例外"（不是兜底）
- [x] T081 `mcp-shared/tests/test_tool_contract.py`：`test_必填形态_...` / `test_查询工具schema_ontology_id必填` 增断言，新增 `test_注入参数ontology_id自带中文名`（同时守住业务参数无 `title` 仍不产出）
- [x] T082 契约同步：`specs/contracts/mcp-tools.md` §2 参数节点段（例外说明）、§9.1（`ontology_id` 带 `title`）

## 批次 N：中文名投影到协议 `Tool.title`（2026-10-30，对外可见）

> 用户决策：只对外，**平台自身不消费**（agent 仍读 `inputSchema["x-title"]`）。

- [x] T083 `mcp-shared/mcp_app.py`：唯一注入点 `titled_tool_kwargs()`（**先定 title 再投影 x-title**；空值两者都不产出；SDK 不支持 title 时只丢协议字段），`/tools` 自检口回显 `title`
- [x] T084 三处发布端接入：`mcp-publish/server.py`（取快照 `tools[].title`）、`ontology-query-mcp/server.py`（取查询工具 label）、`common-function-mcp/server.py`（取 manifest `title`）
- [x] T085 测试：mcp-shared 91 passed（+5，含降级与 `/tools` 回显）、发布门面 27 passed（+2，含无中文名不产出 title）、本体查询 15 passed（+1）、公共函数 13 passed（+1）
- [x] T086 契约同步：`specs/contracts/mcp-tools.md` §2「工具级显示名（协议 `Tool.title`）」——投影来源、注入点唯一、平台不消费

## 批次 O：方向反转——工具级 `title` 为权威，`x-title` 降为运行期投影（2026-10-30）

> 用户拍板：快照只存协议同名字段 `title`；`x-title` 由容器启动时投影，供平台自身消费。平台仍**不消费** `Tool.title`。

- [x] T087 `mcp-shared/tool_contract.py`：`with_category(schema, category)` / `with_ontology_scope(schema, scope, category)` 去掉 title 形参与 `x-title` 写入；模块 docstring ①声明"编译侧不产出该键"
- [x] T088 `core-backend/services/mcp_publish_registry.py`：快照条目改为 `{name, title, description, inputSchema}`，`title` 取 `item["title"]`
- [x] T089 `mcp-shared/mcp_app.py`：`tool_title_field()` → `titled_tool_kwargs(schema, title)`（title 为空连投影一起清掉；SDK 降级只丢协议字段）
- [x] T090 三处发布端改用 `titled_tool_kwargs`；`mcp-publish` 读快照 `tools[].title`
- [x] T091 存量迁移：`publishes.json` 5 条工具 `inputSchema["x-title"]` → `tools[].title`（备份于 change 记录，幂等脚本）
- [x] T092 测试：mcp-shared 92 passed、发布门面 27、本体查询 15、公共函数 13、core 发布编译/发布面 34 OK
- [x] T093 契约同步：`mcp-tools.md` §2/§9.4、`ontology-yaml.md` 工具级中文名段落

## 批次 P：`category` / `ontologyScope` 同位提升（2026-10-30）

> 与批次 O 同一套形态：工具级字段为权威，`x-` 扩展键为启动时投影。协议无对应字段，故不迁 `_meta`。

- [x] T094 `core-backend/services/mcp_publish_registry.py`：快照条目补 `category` / `ontologyScope`，`inputSchema` 只剩参数
- [x] T095 `mcp-shared/mcp_app.py`：`titled_tool_kwargs` → `tool_kwargs(schema, *, title, category, scope)`，一次投影三个 `x-` 键（空值清残影）
- [x] T096 三处发布端改用它；`mcp-publish/server.py` 的 `_parse_config` / `_TOOL_SCOPES` 改读工具级 `ontologyScope`（旧形态配置启动即报错并提示重建）
- [x] T097 `publishes.json` 第二批迁移：`x-category` → `category`、`x-ontology-scope` → `ontologyScope`（5 条工具）
- [x] T098 测试：mcp-shared 94 passed、发布门面 27、本体查询 15、公共函数 13、core 发布编译/发布面 34 OK
- [x] T099 契约同步：`mcp-tools.md` §2（三键均为投影）/§3（载位改工具级）/§9.4（快照字段）

## 批次 H：回归与验收

- [x] T051 core `pytest` / `unittest` 全量通过（含 `tests/test_concept_relations.py` 断言改 `title`）
- [x] T052 agent `vitest` 全量通过（26 个受影响文件）
- [x] T053 frontend `vitest` 全量通过（29 个受影响文件）
- [x] T054 `tsc --noEmit`（agent-backend / frontend）与 `eslint`（改动文件）通过
- [x] T055 残留门禁：`python scripts/check_no_display_name.py` 输出 0 命中
- [ ] T056 端到端：设计面保存概念/函数/行为 → 落盘 `title` → 发布工具（`x-title` + 参数 `title`）→ agent 规划弹窗 / 执行记录 / 子任务标题中文名正确
  （**级联编译链路已离线验证**：真实本体编译出 `properties.*.title` 与 `x-title`，嵌套数组项 3/3 带 title；浏览器内全链路待联调时复核）
- [x] T057 填写下方验收记录表

## 依赖与顺序

```
A(契约) → B(core) → C(编译器) → D(MCP服务) → E(agent) → F(前端)
                                          ↘ G(存量迁移) → H(回归)
```

- **G 必须在代码上线前完成**（Pydantic 忽略未知键 → 旧数据只会静默丢中文名，不会报错）。
- E 与 F 可在 D 完成后并行，但 F 依赖 E 的 DTO 字段名定稿。
- H 必须等 A~G 全部完成后执行。

## 验收记录

| 检查 | 结果 |
| :-- | :-- |
| core 全量测试 | ✅ **223 passed**（`core-backend` pytest） |
| agent 全量测试 | ✅ **454 passed / 32 files** |
| frontend 全量测试 | ✅ **547 passed / 45 files** |
| `tsc --noEmit` / `eslint` | ✅ agent `typecheck:all` 零错误；frontend `tsc --noEmit` 零错误；`eslint src` **0 error**（450 条既有 `no-explicit-any` warning） |
| 残留门禁（`display_name` = 0） | ✅ `scripts/check_no_display_name.py` 通过：代码面 token 零命中；`.data` 结构键零命中（`.data/threads/**/.data.json` 内 11 处为**对话正文**，属历史文本不改） |
| 迁移集合比对（24 文件） | ✅ 改名 **1391 处**，逐文件「非空中文名键路径→值」集合完全相等 |
| 端到端中文名链路 | ⏳ 级联编译已离线验证（`properties.*.title` + 嵌套 items title + `x-title`）；浏览器联调待执行 |
| 发布工具 `x-title` / 参数 `title` | ⏳ 编译产物已验证；运行中的发布容器需在部署时重发（T049） |
| 行为参数口径统一（FR-016） | ✅ 6 文件迁移：中文名 11 处原位转 `title`、空 `description` 清理 105 处；模板键序复核；core 223 / mcp-shared 85 / agent 454 / frontend 547 全绿 |
| DTO 同语义收口（T063-T066） | ✅ `displayLabel` 全量删除并并入 `title`（纯中文名），组合串改渲染层拼；agent 454 / frontend 547 复跑全绿；门禁新增 `displayLabel` 规则后仍零命中 |
| 参数中文名取数口径收口（T067-T070） | ✅ 4 处「`description` 优先」改为「`title` 优先」（FunctionTable / param-contract / subtask-runner / security-confirm-content / PlanConfirmModal）；agent 32 files、frontend Design 38 files 全绿；两侧 `tsc --noEmit` 零错误 |
| 参数节点三键分义、兜底链全删（T071-T076） | ✅ 编译产物 `title`/`description`/`example` 三键各承一义（离线验证含 `items.properties` 深层）；6 处 `title \|\| description` 兜底全部删除；回归 core 223 / mcp-shared 85 / agent 32 files / frontend 45 files 全绿；两侧 `tsc --noEmit` 零错误；残留门禁仍零命中 |
| 注入参数 `ontology_id` 补中文名（T080-T082） | ✅ 两处注入块各带 `title: 本体ID`（本体执行类 + 本体查询类）；mcp-shared **86 passed**（新增 1 例）、core 发布编译 33 OK（含新增断言）、本体查询服务 14 passed、发布门面 25 passed；业务参数"无 `title` 不产出"的分义未被侵蚀 |

### 迁移明细（24 文件 / 1391 处）

- 本体与存档：`原材料采购和库存`（156 / v1.0 156 / v1.1 173）、`订单排程`（106）、`货品BOM及工艺`（56）
- 数据引擎：两份 `data_engines.yaml` 各 97（含 `target.params/response` 深层）
- 安全快照：`securities.yaml` ×4（8 / 9 / 8 / 11）与订单排程 14
- 公共函数清单 `functions.json`（31）、发布快照 `publishes.json`（14，含 `x-display_name` → `x-title`）
- 模板：`onto_template.yaml`（25）、`skill_template.md`（5 token）
- 技能文档：`raw-material-inventory/SKILL.md`（71 token）
- 需求线程产物：`.data/threads/demand/**` 6 个 YAML（3 / 27 / 34 / 48 / 100 / 9 / 131）

### 已知遗留（不在本次范围）

1. ~~**注入参数 `ontology_id` 无中文名**~~ → **已于 2026-10-30 关闭**（批次 M / T080-T082）：编译器注入块自带 `title: 本体ID`；已发布工具需重发才带新 schema。
2. **编译器兜底链 `title or description` 保留**：本体侧已全部写 `title`，兜底仅服务外部 MCP 工具（其 schema 由第三方定义）。
3. `.history/**`、`.claude/settings.json`、`frontend/fe-test-result.json` 内的旧键名属历史备份/审批记录/测试产物，不参与门禁。
