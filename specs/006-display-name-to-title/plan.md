# 实施计划：中文名字段统一 `display_name` → `title`（全栈硬切）

**特性分支**: `006-display-name-to-title` · **对应规范**: [spec.md](./spec.md) · **日期**: 2026-10-29

## 摘要

把"中文名"收敛为唯一字段名 `title`，全栈硬切、零兼容：core（Pydantic 模型 + 派生/快照）→ 工具契约编译器（`schema.title` / `x-title`）→ MCP 服务（查询/公共函数/数据引擎）→ agent 运行时（读 YAML + DTO）→ 前端（类型 + 设计面 12 组件 + 视图 + 会话）→ 存量材料（`.data` 17 个文件、模板、技能文档、发布快照）。

核心取舍：**字段名对齐，但中文名的取数链不退化**——参数编译保留 `title or description` 兜底（只服务外部 MCP 工具），工具级扩展键改 `x-title` 而非 `inputSchema.title`；行为参数与函数参数统一用 `title`（FR-016）。

改造是**原子性**的：代码、数据、已发布工具三者必须同批上线；回滚只能整体回滚。

## 技术上下文

- **权威模型**：`core-backend/schemas/__init__.py`（Pydantic v2，11 个模型含 `display_name`）
- **契约编译器（唯一权威）**：`mcp-shared/tool_contract.py`，被 core（`services/mcp_contract_bridge.py` 注入路径）与多个 MCP 服务共用
- **后端分层**：`routers/*`（接口）→ `services/*`（派生/快照/摘要）→ `repositories/*`；契约编译器在业务层外置共享
- **运行面**：`agent-backend/src/services/ontology-gateway.ts`（读 YAML）、`agent/tool-catalog.ts`（工具目录）、`agent/function-catalog.ts`（函数目录）
- **前端**：`api/design.ts` / `api/data-engines.ts`（类型）、`components/Design/*`（设计面）、`components/View/*`（图）、`components/Design/agent/*`（会话）
- **数据**：文件存储（`.data`），无数据库迁移
- **测试**：core `unittest`、agent `vitest`、frontend `vitest`（co-located）

## 宪法检查（Constitution Check）

| 章程条款 | 本计划如何满足 |
|---|---|
| I 前端组件化与代码质量 | 不改组件边界与命名；仅字段改名（`dataIndex` / `renderCell(field)` / `editData`）；列头文案「中文名称」保留，避免把 UI 文案与字段名混为一谈 |
| II 后端分层 | 字段改名只触及模型/服务/路由三层内部实现，不新增跨层依赖；编译逻辑仍唯一在 `mcp-shared`，**不在 core 复写** |
| III 测试强制覆盖 | FR-015：所有断言改口径、不删用例；前端每个受影响组件均已有测试文件，改动后必须回绿；agent 侧新增 `title` 断言覆盖 `schemaToDeclaredParams` 的 `title` 保留 |
| IV 无障碍与交互体验 | 无交互变更，不改键盘/焦点行为；表单标签文案不变 |
| V 性能标准 | 无新增渲染/IO；迁移为离线一次性脚本 |
| VI 数据一致性与接口契约 | ①单一表达：改名后 `display_name` 必须彻底消失（残留门禁）；②契约两侧同改：`specs/contracts/*` 先改，core 与 agent 同步；③快照（`securities.yaml`）由后端派生刷新，不手写 |
| 技术治理（禁止重复实现） | 编译仍只在 `mcp-shared/tool_contract.py`；agent 侧只消费，不新增第二套 |
| 开发工作流（中文文档 / Spec Kit / 合并门禁） | 本 spec-plan-tasks 全中文；合并前 core+agent+frontend 测试、类型检查、契约一致性、残留门禁全部通过 |
| 测试组织 | 不新建 `tests/` 平行树；core 既有 `tests/` 为项目现状，本次不调整 |
| 500 行约束 | 无文件因本改动显著增长 |

## 关键设计决策

1. **参数中文名落点**：`param_spec_to_schema` 产出 `schema.title = label`，`description` 只留 `示例: x`；取值链 `spec.title or spec.description`（兜底面向外部 MCP 工具，本体侧函数与行为参数一律写 `title`）。
2. **工具级中文名**：`x-display_name` → `x-title`，常量 `DISPLAY_NAME_KEY` → `TITLE_KEY`；**禁止**写 `inputSchema.title`（与 JSON Schema 关键字语义冲突）。
3. **DTO 命名**：`displayName` → `title`；`ExecutionEntry.title`（原「中文（英文）」组合串）与 `displayLabel`（纯中文名）**合并为 `title` = 纯中文名**，组合串在 `EntryCard` 渲染时拼；`SubtaskInfoPort.behaviorDisplayName/functionDisplayName` → `behaviorTitle/functionTitle`。
4. **零兼容**：不加别名、不加 `model_validator` 迁移、不双写、不留 `getattr(..., 'display_name')` 兜底。
5. **数据先行**：迁移脚本必须在代码上线前跑完（Pydantic 对未知键静默忽略，旧文件不会报错、只会丢中文名）。

## 实施策略

### 批次 A：契约文档先行（P1）

1. `specs/contracts/ontology-yaml.md`：字段表全量改名；重写「`params` 说明字段口径」段（函数 `title` / 行为 `description`，编译器读取 `title or description`）。
2. `specs/contracts/mcp-tools.md`：`x-display_name` → `x-title`；补充"参数中文名 = JSON Schema `title`"的口径。

### 批次 B：core 模型与派生（P1）

3. `schemas/__init__.py`：11 个模型的 `display_name` → `title`（含 `InheritedAttributeItem` 继承与 `ConceptView`），字段声明位置不动（保持 YAML 输出顺序）。
4. `services/__init__.py`：`_sync_securities_roster` 写 `sec.title = b.title or b.name`；注释同步。
5. `services/concept_relations.py`：SubClassOf 派生行 `title=sub_class_display(...)`，派生文案不变。
6. `services/ontology_summary.py`：摘要文本标签与取值改 `title`。
7. `services/mcp_publish_registry.py`：`_description()` 取 `item.get("title")`；`with_ontology_scope(..., item.get("title", ""))`。
8. `routers/rules.py`：入参 `rule_title`、拼给 LLM 的上下文改 `title`、公共函数清单取 `cf.get("title")`。
9. `prompts/ontology_generate.py` / `analysis.py` / `rule_generate.py`：字段口径与占位符（`rule_title`）同步。

### 批次 C：工具契约编译器（P1）

10. `mcp-shared/tool_contract.py`：`TITLE_KEY` 常量、`param_spec_to_schema` 写 `title`、`with_category` / `with_ontology_scope` 形参改名、模块 docstring 契约表更新。
11. 确认 `services/mcp_contract_bridge.py` 的导出面无需新增（不含该常量）；如引用则同步。

### 批次 D：MCP 服务（P1）

12. `ontology-query-mcp/server.py`：8 个工具 description 中列举的字段名、`_filter_list` 搜索键、行为附加的 `rules[]` 子结构（`title`）。
13. `common-function-mcp/server.py`：`with_category(..., entry.get("title", ""))`。
14. `data-engine-executor/behavior_index.py`：索引元数据 `title`。

### 批次 E：agent 运行时（P1）

15. `src/types.ts`：`ConceptInfo` / `ConceptInfo.attributes` / `BehaviorMeta` / `FunctionMeta` / `SubTaskPlan`。
16. `services/ontology-gateway.ts`：`resolveConcepts` / `getBehaviorMeta`（含 `unavailable` 兜底分支）/ `getFunctionInfo`。
17. `services/common-functions.ts`：`schemaToDeclaredParams` **新增保留 `v.title`**（当前会丢弃）；`getCommonFunctionInfo` 改取 `title`。
18. `agent/tool-catalog.ts`：`TITLE_KEY`、`MountableToolInfo.title`、`toMountableToolInfo`。
19. `agent/function-catalog.ts`：`FunctionInfo.title`；文件兜底分支取 `f.title`。
20. `agent/execution-policy.ts`：`SubtaskInfoPort.behaviorTitle/functionTitle`、`meta.title`；`security-policy.ts` 注释。
21. `agent/subtask-runner.ts` / `plan-presentation.ts` / `planning-phase.ts` / `event-channel.ts` / `orchestrator.ts` / `agent-factory.ts` / `param-contract.ts`：展示名与目录字段改 `title`。
22. `scripts/*.py|ts`（8 个 E2E/自检脚本）断言改 `title`。

### 批次 F：前端（P1/P2）

23. `api/design.ts` / `api/data-engines.ts`：9 + 1 个接口类型字段改名。
24. 设计面 12 组件：`ConceptTable`、`ConceptAttributeModal`、`ConceptRelationTable`、`ObjectRelationTable`、`FunctionTable`、`BehaviorTable`、`RuleTable`、`ProcessTable`、`SecurityTable`、`DataEngineTable`（含 `getParamDisplay` 读 `params[k].title`）、`MCPPublish`（选项 label 取 `title`）、`DeployedVersionBadge`。
25. `BehaviorTable` 的编辑态归一化必须**保留 `title`**（现只搬 4 个键，改后不得丢）。
26. `rule/function-label.ts`：`fn?.title`。
27. 视图：`OntologyGraph` / `InstanceGraph` / `instance-graph-model`。
28. 会话：`sse-events` / `use-agent-stream` / `SubtaskBlock` / `MessageList` / `PlanConfirmModal` / `plan-editing` / `execution-log`（`ExecutionEntry.title`，`displayLabel` 保留）/ `chat-types` / `EntryCard`。
29. 测试夹具与断言同步（含 `DeployedVersionBadge.test.tsx` 的 YAML 夹具）。

### 批次 G：存量材料迁移（P1，必须先于上线）

30. 新增 `scripts/migrate_display_name_to_title.py`：解析式迁移（YAML/JSON），禁止文本正则；`x-display_name` 单独规则；输出逐文件报告；支持 `--dry-run`。
31. 迁移 `.data` 17 个文件（清单见 spec 附录 A）；`SKILL.md` 按整词 token 替换后人工复核。
32. 新增 `scripts/check_no_display_name.py`：全量残留扫描 + 迁移前后「非空中文名键路径→值」集合比对。
33. `publishes.json` 迁移后**重新发布**受影响工具（或重启发布容器）。

### 批次 H：回归与验收（P1）

34. core `pytest`/`unittest`、agent `vitest`、frontend `vitest` 全量；`tsc --noEmit`（agent/frontend）；`eslint` 改动文件。
35. 残留门禁（FR-014）通过；端到端：设计面保存 → 落盘 `title` → 发布（`x-title` + 参数 `title`）→ agent 规划/执行记录中文名正确。
36. `tasks.md` 填写验收记录。

## 上线顺序与回滚

**顺序（同一次变更窗口内）**：

1. 停写入/停服务（core、agent、前端静态资源、MCP 容器）
2. 备份 `.data`
3. 跑迁移脚本（`--dry-run` 通过后正式执行）+ 校验脚本
4. 部署新版本代码（core / agent / frontend / mcp-shared 关联服务 / query-mcp / common-function-mcp / data-engine-executor）
5. 重新发布受影响 MCP 工具、重启发布容器
6. 按第 35 项做端到端验证

**回滚**：硬切无兼容，**只能整体回滚**（旧代码 + `.data` 备份快照）。禁止"只回滚代码"或"只回滚数据"——两者必然错配。

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| 漏改一处 → 静默丢中文名 | 残留门禁（0 命中）+ 迁移集合比对 + 端到端中文名断言；分批提交便于二分定位 |
| 迁移脚本改坏数据 | 解析式迁移 + 备份 + `--dry-run` 报告 + 集合比对；`SKILL.md` 人工复核 |
| 前端 `title` 与 antd `title` prop 混淆 | 评审 checklist 单列一条：列定义 `{ title: '中文名称', dataIndex: 'title' }` 双 title 并存需核对语义 |
| `x-title` 与已发布容器错配 | 同窗口重发布；`assertToolProtocol` 保留拦截更严重的 scope 错配 |
| 行为参数口径统一（FR-016）迁移 | 开工前勘察 162 条行为参数（仅 7 条非空且均为中文名）→ 迁移只搬非空值、冲突即中止；模板键序人工复核 |
| agent 用户目录旧副本 | 部署时按"整体覆盖"语义重新下发 |

## 复杂度追踪

无章程违规项，无需豁免记录。
