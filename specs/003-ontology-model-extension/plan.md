# 实施计划：本体模型扩展（关系类型 / 生命周期状态 / 术语集 / 函数类型 / 行为状态跃迁 / 规则结构增强）

**特性分支**: `003-ontology-model-extension` · **对应规范**: [spec.md](./spec.md) · **日期**: 2026-09-28

## 摘要

在现有本体模型上做**向后兼容的增量扩展**，分 6 批推进：先做纯字段扩展（P1），再做生命周期状态与行为跃迁（P2，含
`related_concepts` → `concept`、`related_behaviors` → `behavior` 两处「数组 → 标量」的契约收缩），随后为规则结构升级
做前置重构（`RuleTable.tsx` 拆分），最后依次实现规则「实体自身」操作数与「与/或/非」嵌套树。
对外接口路径不变，新增字段一律可选且有默认值，存量数组在读时无损迁移。

## 技术上下文

- **权威模型**：`core-backend/schemas/__init__.py`（Pydantic v2）；落盘为 YAML（`ontology.yaml` / `securities.yaml` / `data_engines.yaml`）
- **后端分层（002 收口）**：`routers/`（接口）→ `services/`（业务，0 fastapi 依赖）→ `repositories/`（数据访问，唯一文件 I/O 出口）；领域异常 `errors.py`
- **统一错误契约**：`main.py` 注册 4 个处理器 —— `HTTPException` / `DomainError` → 各自 code，`RequestValidationError` → **422**，兜底 `Exception` → 500；错误体恒为 `{code,message,detail}`
- **前端**：Next.js + antd；表格组件在 `frontend/src/components/Design/`；规则编辑器已拆为 `RuleTable.tsx` + `rule/RuleEditors.tsx` + `rule/rule-operands.ts`
- **agent 面**：`agent-backend/src/services/ontology-gateway.ts` 从 YAML 投影运行期元信息（只透传固定字段）；`subtask-runner.ts` 把旧条件树序列化喂 LLM
- **MCP 面**：`data-engine-mcp/facade.py`、`ontology-mcp/server.py`、`mcp-shared/schema_compile.py`（`related_concepts(data, names: list[str])` 签名不变，函数侧继续传数组）
- **测试**：后端 `pytest`（`core-backend/tests`、`data-engine-mcp/tests`、`business-mcp/tests`）；前端 `vitest` + 覆盖率门槛 80%

## 宪法检查（Constitution Check）

| 章程条款 | 本计划如何满足 |
|---|---|
| II 后端分层 | 跨字段强耦合校验放业务层（新增 `services/validators.py`），路由层只做参数接收与调用；不新增文件 I/O |
| III 测试 | 每个新字段配「落盘↔回读↔非法值」往返用例；配旧格式迁移用例；前端配各表格字段渲染用例；每批走容器内端到端 |
| VI 数据一致性 | 统一错误体；400（强耦合）与 422（参数校验）边界明确、不混用；对外路径不变 |
| VI 契约一致 | 向后兼容：新字段可选 + 默认值；历史版本快照必须可加载；5 份模型副本逐项对齐 |
| 技术治理 | 值域类校验统一走 Pydantic validator（静默归一），强耦合类走领域异常，避免错误契约分裂 |
| 500 行约束 | `RuleTable.tsx`（471 行）先拆分再改动；`prompts.py`（650 行）超限问题单独裁决 |

## 实施策略

### 批次 A：纯字段扩展（用户故事 1，P1）

无依赖、可独立交付。

1. 权威模型 `schemas/__init__.py`：`RelationItem.relation_type`、`ConceptItem.terms`、`FunctionItem.type`（各带 validator：值域过滤 / 去重去空）。
2. 模板 `.data/templates/onto_template.yaml` 同步三处字段。
3. 前端：`api/design.ts` 三处接口；`RelationTable.tsx`（多选，symmetric 与 asymmetric 前端互斥提示）、`ConceptTable.tsx`（术语集，与实例标签相邻）、`FunctionTable.tsx`（单选；公共函数行显示 `-`）。
4. 提示词 `prompts.py`：阶段 2A 增术语集、阶段 3 增关系类型、阶段 5A 函数类型改为落盘英文码并统一措辞【指标计算】。

### 批次 B：生命周期状态 + 行为跃迁（用户故事 2，P2）

1. 权威模型：`BehaviorItem.concept: str` 与 `RuleItem.behavior: str`（二者均用 `model_validator(mode='before')` 兼容旧数组、取唯一元素）、`BehaviorItem.from_status` / `to_status: str`（默认空串）。
2. 新增 `core-backend/services/validators.py`：
   - `validate_status_attribute(attributes)`：至多一个 `name == 'status'`；若存在则 `type == 'string'` 且 `constraint.enum` 非空；
   - `validate_behavior_status(behavior, concepts)`：`concept` 必须命中某概念；`from/to` 非空时必须落在该概念 `status` 属性的 `constraint.enum` 内；
   - `validate_self_requires_behavior(rule, behaviors)`：旧条件树（含嵌套树）中出现 `type: self` 操作数时，规则的 `behavior` 必须非空且命中该本体行为。
   三者失败一律抛 `errors.InvalidInputError`（→ 400 统一错误体）。
3. 路由接入：`routers/concepts.py`（PUT `/…/attributes`）、`routers/behaviors.py`（POST/PUT）、`routers/rules.py`（POST/PUT）。
4. 消费点适配（两处数组 → 标量）：
   - **行为侧** `related_concepts` → `concept`：`routers/concepts.py`（级联清空）、`routers/ontologies.py`（行为 inputSchema 约束回溯）、`routers/rules.py:96`（生成规则时收集概念）、`agent-backend/src/services/ontology-gateway.ts:116`、`data-engine-mcp/facade.py:36`
   - **规则侧** `related_behaviors` → `behavior`：`routers/rules.py:84,92`、`agent-backend/src/services/ontology-gateway.ts:96,104,107`、`agent-backend/src/types.ts:119`、`ontology-mcp/server.py:256`、`frontend/src/components/View/OntologyGraph.tsx:140-141`、agent 测试 fixture 11 处
5. 前端：`api/design.ts`（`Behavior.concept` 与 `Rule.behavior` 两处改标量）；`BehaviorTable.tsx`（关联概念改单选；新增源/目标状态下拉，选项取自所选概念的 `status` 枚举，无该属性时禁用并提示）；`RuleTable.tsx`（关联行为改单选 + 13 处字段引用适配）与 `View/InstanceGraph.tsx`、`View/OntologyGraph.tsx` 的标量适配。
6. 测试脚本与提示词：`agent-backend/scripts/e2e-prerule-trace-gate.py` 的多概念 fixture 改单概念；`prompts.py` 阶段 2B 要求 4 改写、阶段 4 增 from/to 与「关联概念唯一」。

### 批次 C：`RuleTable.tsx` 前置重构（纯重构，行为不变）

`RuleTable.tsx` 现 471 行，批次 D/E 必然超限，故先拆分：

1. 先补测（条件构建、`data_supplements` 自动推导、候选收窄的纯逻辑）。
2. 抽出条件构建/推导/候选收窄逻辑到独立模块，主表只留渲染与状态。
3. 回归：前端测试全绿、覆盖率门槛不降、行数 ≤ 500。

### 批次 D：规则「实体自身」（用户故事 3，P3）

1. 模板 ×2：操作数 `type` enum 加 `self`（左右均加）；`allOf` 增约束（`self` → `attribute` 必填、无需 `concept`）。
2. `rule-operands.ts`：选项加「实体自身」；新增「按主体概念解析属性候选」的纯函数。
3. `RuleEditors.tsx`：`OperandEditor` 支持 `self`（只显示属性下拉）。
4. `RuleTable.tsx`：候选收窄支持 `self`（规则 → 唯一关联行为 → 主体概念）。
5. 提示词：`RULE_GENERATE_PROMPT` 操作数说明加 `self`。
6. 校验接入：`validate_self_requires_behavior`（批次 B 已建）在此接入并补测（未绑定行为的规则使用 `self` → 400）。

### 批次 E：规则「与/或/非」嵌套（用户故事 4，P4）

1. 模板 ×2：改递归 Schema（`children` 自引用；`not` 的 `children` 加 `maxItems: 1`）。
2. `rule-operands.ts`：`storageToEditing` 递归 + 旧扁平 → 树迁移。
3. `RuleEditors.tsx`：递归组合节点编辑器（切逻辑、增删子节点、嵌套缩进；`not` 限 1 子节点）。
4. `RuleTable.tsx`：`buildStorageConditions`、`collectRuleRefs`、`data_supplements` 推导、候选收窄四处适配树。
5. 运行期：`subtask-runner.ts` 的旧条件树序列化改缩进输出（层级可读）。
6. 提示词：`RULE_GENERATE_PROMPT` 示例改树形 + 与/或/非说明。
7. 测试：`rule-operands.test.ts` 重写（树遍历 / 旧格式迁移 / `not` 单子节点 / 三层嵌套）。

### 批次 F：跨切面收口

1. 5 份副本字段清单逐项核对（`agent-backend/src/types.ts:119` 本轮**需要**变更：`RuleDetail.related_behaviors` → `behavior: string`；其余新字段 gateway 未投影，无需透传到 agent 侧）。
2. 历史版本快照（`ontology_versions/v1.0|v1.1`）加载回归。
3. `prompts.py`（现 650 行，已超 002 的 FR-010/SC-006 阈值）行数处置：拆 `prompts/` 包或明确豁免。
4. 全量回归（pytest + vitest + tsc + compileall + 覆盖率门槛）+ 容器重建 + 全链路端到端 + 临时数据清理。

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| 契约收缩（`related_concepts`、`related_behaviors` → 标量）遗漏消费点 | 已完整枚举：行为侧 14 处消费点、规则侧 11 个文件 30+ 处（见 tasks 阶段 2）；每处改动后跑对应回归 |
| 存量数据无状态机基础（6 概念中 5 个无 status 属性，唯一者枚举为空） | 校验仅在「显式声明 from/to」时生效；验收用**新建临时本体**，不用存量本体 |
| 历史版本快照加载失败 | 新字段一律可选 + 默认值；阶段 6 专项回归 v1.0/v1.1 |
| 规则树改造 5 处联动遗漏 | 按 tasks 逐项勾；先跑模板 Schema 与前端单测，再做端到端 |
| 嵌套树喂 LLM 可读性下降 | 序列化改缩进（FR-023）并纳入端到端验收 |
| `RuleTable.tsx` 超 500 行 | 批次 C 先拆分再改动 |
| 强耦合校验误落 Pydantic 导致 422/400 契约分裂 | 统一放业务层（`InvalidInputError` → 400）；spec 假设中已固化该边界 |
| P1 解读偏差（status 属性 vs 属性字段） | 已写入 spec 假设并标注「需复核」；开工前一句话确认即可纠偏 |

## 验收方式

- **后端**：`python -m pytest core-backend/tests data-engine-mcp/tests business-mcp/tests -q` 全绿；`python -m compileall core-backend`
- **前端**：`npx vitest run --coverage` 全绿且门槛 80% 不降；`npx tsc --noEmit`
- **容器内端到端**（覆盖 A–E 全部验收场景）：
  - 批次 A：建临时本体 → 填关系类型/术语集/函数类型 → 回读一致 → 落盘 YAML 结构正确 → 清理
  - 批次 B：**新建**含 `status` 枚举的临时本体 → 配 Cancel/Receive 跃迁 → 越界返回 400 →
    规则绑定行为标量往返与旧数组无损迁移 → 存量本体回归加载 → 清理
  - 批次 D/E：规则 `self` 往返；老扁平规则打开为树 → 保存为树 → 回读；运行期投喂 LLM 的文本层级可读
- **历史版本快照**：`GET /api/ontologies/{id}/deploy/version-preview?version=v1.0` 正常返回
- **行数约束**：后端与前端源文件中 > 500 行的数量为 0
