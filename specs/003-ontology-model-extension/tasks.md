# 任务清单：本体模型扩展（关系类型 / 生命周期状态 / 术语集 / 函数类型 / 行为状态跃迁 / 规则结构增强）

**特性分支**: `003-ontology-model-extension` · **规范**: [spec.md](./spec.md) · **计划**: [plan.md](./plan.md)

> 说明：本特性在**现有代码上增量扩展**，新字段一律可选且有默认值，对外接口路径不变。
> 决策依据：用户答复 D1–D8 / P1–P3（见 [spec.md](./spec.md) 假设）。
> 校验归属铁律：**值域类 → Pydantic validator（静默归一，不报错）；跨字段强耦合 → 业务层 `InvalidInputError` → 400**。
> （不可放 Pydantic：请求体校验失败经 `main.py:115` 返回 422，会造成 400/422 契约分裂）

## 阶段 1：纯字段扩展（用户故事 1，P1）待开始

### 关系类型

- [x] T101 `core-backend/schemas/__init__.py`：`RelationItem` 新增 `relation_type: list[str]`（默认 `[]`）；
  validator 过滤 `{asymmetric, symmetric, transitive, functional, inverse_functional}` 之外的值
- [x] T102 `.data/templates/onto_template.yaml` relations 段（现 L29-37）新增 `relation_type`
- [x] T103 `frontend/src/api/design.ts:51-60`：`Relation` 接口加 `relation_type?: string[]`
- [x] T104 `frontend/src/components/Design/RelationTable.tsx`：新增「关系类型」列（多选下拉；
  symmetric 与 asymmetric 前端互斥提示），列宽与既有列平衡
- [x] T105 `core-backend/prompts.py` 阶段 3（现 L95）：每条关系需提供项增加「关系类型（可多选）」

### 概念术语集

- [x] T106 `schemas/__init__.py`：`ConceptItem` 新增 `terms: list[str]`（默认 `[]`）；
  validator 去重 / 去空串 / 去首尾空白
- [x] T107 `.data/templates/onto_template.yaml` concepts 段（现 L9-28）在 `display_name` / `instance_label` 邻位加 `terms`
- [x] T108 `frontend/src/api/design.ts:26-32`：`Concept` 加 `terms?: string[]`
- [x] T109 `frontend/src/components/Design/ConceptTable.tsx`：新增「术语集」列 + 编辑（与实例标签相邻），展示为 Tag 列表
- [x] T110 `prompts.py` 阶段 2A（现 L71）：概念每项增加「术语集（该概念的其他表述，可多个）」

### 函数类型

- [x] T111 `schemas/__init__.py`：`FunctionItem` 新增 `type: str`（默认 `""`）；
  validator 将 5 值域（`TRANSFORMATION` / `CALCULATION` / `DERIVATION` / `VALIDATION` / `MODEL`）外的值归一为 `""`
- [x] T112 `.data/templates/onto_template.yaml` functions 段（现 L38-89）新增 `type`
- [x] T113 `frontend/src/api/design.ts:76-84`：`Function` 加 `type?: string`
- [x] T114 `frontend/src/components/Design/FunctionTable.tsx`：新增「函数类型」列（单选下拉；公共函数行显示 `-`）
- [x] T115 `prompts.py:159` 阶段 5A：函数 5 类从「自然语言分类」改为「必须落盘 `type` 英文码」，
  且措辞统一为【指标计算】CALCULATION

### 测试与验收

- [x] T116 后端用例：三字段「落盘↔回读」往返；非法关系类型 / 函数类型被丢弃且**保存仍成功**（不阻断）
- [x] T117 前端用例：三表格新增字段的渲染与编辑
- [x] T118 端到端：临时本体 → 填三字段 → 回读 → 检查落盘 YAML 结构 → 清理

## 阶段 2：生命周期状态 + 行为跃迁（用户故事 2，P2）待开始

### 权威模型

- [x] T201 `schemas/__init__.py`：`BehaviorItem.related_concepts: list[str]` → `concept: str`（默认 `""`）；
  加 `model_validator(mode='before')` 兼容旧数组（取唯一元素，无损迁移）
- [x] T202 `schemas/__init__.py`：`BehaviorItem` 新增 `from_status: str = ""`、`to_status: str = ""`
- [x] T203 `schemas/__init__.py`：`RuleItem.related_behaviors: list[str]` → `behavior: str`（默认 `""`）；
      加 `model_validator(mode='before')` 兼容旧数组（取唯一元素；含多元素时取首个并记 warning，实测不存在）

### 业务层校验（新增）

- [x] T204 `core-backend/services/validators.py`（新建）：
  - `validate_status_attribute(attributes)`：至多一个 `name == 'status'`；若存在则 `type == 'string'` 且 `constraint.enum` 非空
  - `validate_behavior_status(behavior, concepts)`：`concept` 必须命中某概念；`from/to` 非空时须落在该概念 `status` 属性的 `constraint.enum` 内
  - `validate_self_requires_behavior(rule, behaviors)`：旧条件树（含嵌套树）中出现 `type: self` 操作数时，
      规则的 `behavior` 必须非空且命中该本体行为
  - 三者失败一律抛 `errors.InvalidInputError`（→ 400 统一错误体）
- [x] T205 路由接入：`routers/concepts.py`（PUT `/…/attributes`）、`routers/behaviors.py`（POST/PUT）、
  `routers/rules.py`（POST/PUT）

### 行为侧消费点适配（`related_concepts` → `concept`，共 14 处）

- [x] T206 `routers/concepts.py:75-78`：删除概念时把引用它的行为的 `concept` 清空（原为从数组移除）
- [x] T207 `routers/ontologies.py:88`：`_related_concepts(data, [b.concept] if b.concept else [])`
      （行为 params 的 inputSchema 约束回溯；`_related_concepts` 签名不变）
- [x] T208 `routers/rules.py:96`：`[c for c in data.concepts if c.name == beh.concept]`
- [x] T209 `agent-backend/src/services/ontology-gateway.ts:116`：
      `resolveConcepts(data, behavior?.concept ? [behavior.concept] : [])`
- [x] T210 `data-engine-mcp/facade.py:36`：改传 `[b.get("concept")]`（`mcp-shared/schema_compile.py:143` 签名保持 `list[str]`）
- [x] T211 `agent-backend/scripts/e2e-prerule-trace-gate.py:62`：多概念 fixture 改单概念

### 规则侧消费点适配（`related_behaviors` → `behavior`）

- [x] T211a `core-backend/routers/rules.py:84,92`：`generate_rule` 改读标量 `body.get("behavior", "")`
      （原 `related_behaviors = body.get("related_behaviors", [])` 与 `for bname in related_behaviors` 循环 → 单值）
- [x] T211b `frontend/src/api/design.ts:143`：`Rule.related_behaviors: string[]` → `behavior: string`
- [x] T211c `frontend/src/components/Design/RuleTable.tsx`（L54 / L72 / L94 / L95 / L102 / L161 / L311 / L336 /
      L358 / L375 / L432 / L452 / L461，共 13 处）：关联行为改单选 + 字段引用适配
- [x] T211d `frontend/src/components/View/OntologyGraph.tsx:140-141`：`forEach` → 单值判断
- [x] T211e `agent-backend/src/types.ts:119`：`RuleDetail.related_behaviors: string[]` → `behavior: string`
- [x] T211f `agent-backend/src/services/ontology-gateway.ts:96,104,107`：投影与前置/后置规则筛选改标量比较
- [x] T211g `ontology-mcp/server.py:249,256`：`b.get("name") in (r.get("related_behaviors") or [])`
      → `r.get("behavior") == b.get("name")`，注释同步
- [x] T211h `agent-backend/src/agent/execution-policy.test.ts`（5 处）与 `subtask-runner.test.ts`（6 处）：
      测试 fixture 的 `related_behaviors: [...]` 改标量

### 前端

- [x] T212 `frontend/src/api/design.ts:116-124`：`Behavior.related_concepts: string[]` → `concept: string`；
      新增 `from_status?: string`、`to_status?: string`
- [x] T213 `frontend/src/components/Design/BehaviorTable.tsx`（L36 / L49 / L69 / L104 / L109 / L119）：
      关联概念改单选；新增「源状态 / 目标状态」两个下拉（选项 = 所选概念的 `status` 属性 `constraint.enum`；
      所选概念无 status 属性时禁用并提示）
- [x] T214 标量适配：`frontend/src/components/Design/RuleTable.tsx:69,:162`、
      `frontend/src/components/View/InstanceGraph.tsx:92`、`frontend/src/components/View/OntologyGraph.tsx:116`
- [x] T215 `frontend/src/components/Design/ConceptTable.tsx`：属性弹窗中对 `name == 'status'` 的属性给出
      「生命周期状态」标记与「枚举值必填」提示（不阻断保存）

### 模板与提示词

- [x] T216 `.data/templates/onto_template.yaml`：behaviors 段（现 L90-195）`related_concepts` 改 `concept`、
      新增 `from_status` / `to_status`；rules 段（现 L196-205）`related_behaviors` 改 `behavior`
- [x] T217 `prompts.py`：阶段 2B 要求 4（现 L84）改为「概念必须有一个 `name=status` 的属性，`type=string`，
      枚举值通过 `constraint.enum` 表达」；阶段 4 要求 3（现 L121）补「行为只关联一个概念（`concept`）」，
      并新增「command 行为须声明 from_status/to_status（取自该概念 status 枚举）」

### 测试与验收

- [x] T218 后端用例：status 属性非法（非 string / 枚举为空）→ 400；from/to 越界 → 400；from/to 为空 → 通过；
      旧 `related_concepts:[x]` 与旧 `related_behaviors:[x]` 均无损迁移；规则使用 `self` 但未绑定行为 → 400
- [x] T219 前端用例：`BehaviorTable` 单选 + 状态下拉（含「所选概念无 status 属性」分支）
- [x] T220 端到端：**新建**含 `status` 枚举的临时本体 → 配 Cancel/Receive 跃迁 → 越界 400 →
      存量本体回归加载 → 清理

## 阶段 3：`RuleTable.tsx` 前置重构（纯重构，行为不变）待开始

- [x] T301 先补测：条件构建（`buildStorageConditions`）、`data_supplements` 自动推导、候选收窄的纯逻辑用例
- [x] T302 抽出条件构建 / 推导 / 候选收窄逻辑到独立模块（`frontend/src/components/Design/rule/`），
      主表只留渲染与状态
- [x] T303 回归：前端测试全绿、覆盖率门槛不降、`RuleTable.tsx` ≤ 500 行（为阶段 4/5 留余量）

## 阶段 4：规则「实体自身」（用户故事 3，P3）待开始

- [x] T401 `.data/templates/rule_template/validation/compare_rule.json` 与
      `.../inference/inference_rule.json`：操作数 `type` enum 加 `self`（左右均加）；
      `allOf` 增约束（`self` → `attribute` 必填、`concept` 不需要）
- [x] T402 `frontend/src/components/Design/rule/rule-operands.ts:148-158`：
      `OPERAND_TYPE_OPTIONS_LEFT/RIGHT` 加「实体自身」；新增「按主体概念解析属性候选」的纯函数
- [x] T403 `frontend/src/components/Design/rule/RuleEditors.tsx:10-49`：`OperandEditor` 支持 `self`（只显示属性下拉）
- [x] T404 `RuleTable.tsx`：候选收窄支持 `self`（规则 → 唯一关联行为 → 主体概念）
- [x] T405 `prompts.py:592-597`：`RULE_GENERATE_PROMPT` 操作数说明加 `self`
      （语义：所属行为的唯一主体概念的实例）
- [x] T406 用例：`self` 往返一致；模板 enum 与前端选项逐项一致
- [x] T407 端到端：规则配 `self.status == '待入库'` 往返

## 阶段 5：规则「与/或/非」嵌套（用户故事 4，P4）待开始

- [x] T501 规则模板 ×2：改递归 Schema（`children` 自引用；`not` 的 `children` 加 `maxItems: 1`）
- [x] T502 `rule-operands.ts:124-144`：`storageToEditing` 递归 + 旧扁平 → 树迁移
- [x] T503 `RuleEditors.tsx:54-93`：递归组合节点编辑器（切换 and/or/not、增删子节点、嵌套缩进；
      `not` 限 1 子节点）
- [x] T504 `RuleTable.tsx`：`buildStorageConditions`、`collectRuleRefs`、`data_supplements` 推导、
      候选收窄四处适配树
- [x] T505 `agent-backend/src/agent/subtask-runner.ts:342-380`：旧条件树序列化改缩进（保留层级）
- [x] T506 `prompts.py:599-606`：示例改树形 + 与/或/非说明
- [x] T507 `frontend/src/components/Design/rule/rule-operands.test.ts` 重写：
      树遍历 / 旧格式迁移 / `not` 单子节点 / 三层嵌套
- [x] T508 端到端：老扁平规则打开为树 → 保存为树 → 回读一致；运行期投喂 LLM 的文本层级可读

## 阶段 6：跨切面收口 待开始

- [x] T601 5 份副本字段清单逐项核对：`core-backend/schemas/__init__.py`（权威）/ `frontend/src/api/design.ts` /
      `agent-backend/src/types.ts` / `.data/templates/onto_template.yaml` / `core-backend/prompts.py`
      - `agent-backend/src/types.ts:119` 本轮**需要**变更（`RuleDetail.related_behaviors: string[]` → `behavior: string`，
        对应 T211e）；其余新字段（`terms` / `relation_type` / 函数 `type` / 状态属性 / `from_status` / `to_status`）
        因 `ontology-gateway` 未投影，本轮无需透传到 agent 侧（若将来要让 agent 消费术语集，需另行扩展 gateway）
- [x] T602 历史版本快照加载回归：`ontology_versions/v1.0` 与 `v1.1`
      （`GET /api/ontologies/{id}/deploy/version-preview?version=v1.0`），确认新字段未破坏 `read_yaml_strict`
- [x] T603 `prompts.py` 行数处置：现 650 行，已超 002 的 FR-010/SC-006「后端源文件 ≤500 行」阈值，
      本轮同步提示词会继续增长 → 拆 `prompts/` 包 或 明确豁免（需裁决）
- [x] T604 全量回归：`pytest`（core + data-engine + business-mcp）+ `vitest --coverage`（门槛不降）+
      `tsc --noEmit` + `compileall`
- [x] T605 容器重建 + 全链路端到端（core → data-engine-mcp → business-mcp → Java）+ 临时数据清理

## 验收记录（2026-09-28 实施完成）

### 测试结果

| 范围 | 命令 | 结果 |
|---|---|---|
| core-backend | `python -m pytest core-backend/tests -q` | **75 passed**（原 30 + 新增 45） |
| Python 全量 | `pytest core-backend/tests data-engine-mcp/tests business-mcp/tests` | **80 passed** |
| 前端 | `npx vitest run` | **351 passed / 21 files**（原 318 → +33） |
| agent-backend | `npm test` | 291 passed / 3 failed（**3 项为既有失败**，见下） |
| 双端契约镜像 | `ontology-gateway.test.ts` + `test_ontology_files_contract.py` | 14 + 5 新增用例全绿 |
| 类型/编译 | `tsc --noEmit` / `python -m compileall` | 通过 |

> **既有失败声明**：`agent-backend/src/agent/orchestrator.test.ts` 的「言行不一闸」3 项失败。
> 已用 `git stash push -- src` 还原本次全部改动后复跑，**同样 3 failed / 21 passed**，确认与 spec 003 无关，未做改动（避免动既有失败文件）。

### 端到端验收（容器内，隔离临时本体）

`python scripts/e2e-spec003-model-extension.py` → **38 通过 / 0 失败**，覆盖：

- 术语集去重去空；`status` 属性非 string / 枚举为空 / 多个 status → **400**
- 关系类型多选落盘（非法值 `bogus`/`42` 被丢弃）
- 函数类型英文码落盘、非法值归一空串
- 行为合法跃迁创建成功；目标状态越界 / 关联概念不存在 / 声明状态无概念 → **400**
- 规则「行为标量 + 实体自身 + 条件树」创建成功且往返无损；用 `self` 未绑定行为 / 绑定不存在行为 → **400**
- 落盘 `ontology.yaml` 结构：概念段含 `terms`、关系段含 `relation_type`、函数段含 `type`、
  行为段为标量 `concept` 且含 `from_status/to_status`、规则段为标量 `behavior` 且条件为 `children` 树；
  **函数段仍保留 `related_concepts` 数组**（本轮未收缩）
- 存量数据回归：旧 `related_concepts`/`related_behaviors` 数组读时无损迁移为标量；历史快照 `v1.0` 可加载
- 临时数据完整清理（场景/本体/目录均还原为 1 场景 4 本体）

### 服务重建与全链路

重建并重启：`core-backend` / `agent-backend` / `data-engine-mcp` / `ontology-mcp` / `frontend`（均含本次改动）。

| 检查 | 结果 |
|---|---|
| `8001/health`、`/api/{scenarios,ontologies}`、`/api/ontologies/1/{behaviors,rules}` | 200 |
| nginx `:81/`、`:81/api/scenarios` | 200 |
| agent-backend `:8003/health` | 200 |
| 行为链路 `core → data-engine-mcp → business-mcp → Java` | 200，返回真实物料数据 |
| 函数链路 `core → ontology-mcp 沙箱` | 200，`{"sumNotArrivalQty":100}` |

### 实施中的偏差与修正（如实记录）

1. **T211 前提有误**：原任务把 `agent-backend/scripts/e2e-prerule-trace-gate.py:62` 的
   `related_concepts: ['PurchaseRecord','RawMaterial']` 当作**行为** fixture；实际是**函数**的关联概念
   （函数本轮保持数组），故**无需改动**，任务已按实际情况勾选。
2. **新增一处既有缺陷修复**（T206 顺带）：`routers/concepts.py` 删除概念时对 `RuleItem` 访问
   不存在的 `related_concepts` 字段会抛 `AttributeError` → 500；改为按标量语义清空行为的 `concept`
   与状态跃迁，并移除规则侧的无用清理。
3. **T603 采用「拆分」而非「豁免」**：`core-backend/prompts.py` 由 664 行拆为 `prompts/` 包
   （`analysis` 381 / `data_engine` 81 / `ontology_generate` 55 / `rule_generate` 53 /
   `function_code` 49 / `skill_generate` 38 / `__init__.py` 63），19 个常量经 `__init__.py` 再导出，
   `from config import X` 与 `from prompts import X` 用法不变（已实测再导出长度一致）。
4. **契约文档同步**（仓库硬规矩）：`docs/contracts/ontology-yaml.md` 新增 §6「字段契约与旧格式迁移」
   （8 个读写字段表 + 5 条迁移规则 + 3 条写时校验 + M1-M5 用例表），并同步双端契约测试。

### 验收后修正（2026-09-29）

**函数类型展示口径漂移**：下拉选中后（编辑态）显示「中文 (英文码)」，退出编辑后（展示态）却只显示英文码
`TRANSFORMATION` —— 原因是列渲染直接输出存储值、未做「代码 → 中文」的反向映射。

- 新增 `frontend/src/components/Design/function-type-labels.ts`：`FUNCTION_TYPE_LABELS`（英文码 → 中文）、
  `FUNCTION_TYPE_OPTIONS`（label = 中文 + 英文码）、`functionTypeLabel(code)`（展示态查表，空值 `-`、
  未知码回退原值不吞信息）。**下拉 label 与展示标签同源**，从结构上消除再次漂移。
- `FunctionTable.tsx` 删除本地选项常量，展示态改用 `functionTypeLabel`（公共函数仍显示 `-`）。
- 新增 `function-type-labels.test.ts`（5 例：码表对应、选项 value/label、展示态、空值/未知码、全量反查）。
- 回归：`tsc --noEmit` 通过；`npm run test:coverage` → **356 passed / 22 files**，
  覆盖率 **96.72 / 88.7 / 84.06 / 96.72**（门槛 80%）；前端镜像已重建（`:81` 200）。

> 注：`BehaviorTable` 的「操作类型」仍是编辑态 `command（命令）`、展示态 `command`（既有行为，未纳入本次改动）；
> 如需一并中文化需另行确认。

### 提示词优化（2026-09-29）

按用户要求，为「概念生命周期状态 / 关系类型 / 概念术语集」补充**选择准则**（原先只是字段登记式的一句话）：

- `prompts/analysis.py`
  - 阶段2B 要求4：由「每个概念必须有 status」改为**条件式**（有生命周期必有；静态主数据可无并说明理由），补：状态用业务名词、互斥完备、禁 `0/1`·英文码·「等」、必须指出**初始状态**、是 from/to 唯一来源 —— **修掉了与实现（FR-005 不强制）的口径冲突**；
  - 阶段4 要求3a 补「不得新造状态」+ 新增要求3b 状态机完备性自检；
  - 阶段3 新增要求5/6/7：5 类型判据、与基数自洽（`N:1`→functional 等）、symmetric/asymmetric 互斥、无把握留空；
  - 阶段2A 要求4 扩充术语集质量边界（0-5 个、不同义反复、不编缩写、用途=口语对齐）；
  - 阶段8 补 status 条件式口径与术语集空值写法，关键要求加两项一致性检查；顺带修正「第8条」→「第7条」笔误。
- `prompts/ontology_generate.py`：第16/17/21 条与实现口径对齐（条件式 status、关系类型与基数自洽+互斥、术语不臆造）。
- `prompts/rule_generate.py`：新增要求5——status 字面值必须来自该概念 `constraint.enum` 已有取值，状态判断优先用 `self`。
- `prompts/skill_generate.py` + `.data/templates/skill_template.md`：术语集进 SKILL.md（概念详情表格加「术语集」列），补上术语集的运行期出口。

验证：`ANALYSIS_SYSTEM_PROMPT` 12840→14035 字符；10 项新口径逐项核验通过；core-backend 已重建（health 200）。

### 规则操作数命名统一（2026-09-29）

按用户要求，将规则条件树操作数下拉的显示名统一为「实例自身 / 关联实例 / 关联实例集 / 字面值 / 字面值集 / 函数」对偶体系：原「实体自身」→「实例自身」、「实例」→「关联实例」、in/not in 右侧的「实例集」→「关联实例集」（纯显示层改名，`value` 枚举值不变）：

- `frontend/src/components/Design/rule/rule-operands.ts`：`OPERAND_TYPE_OPTIONS_LEFT`（实例自身/关联实例/函数）与 `OPERAND_TYPE_OPTIONS_RIGHT`（实例自身/关联实例/关联实例集/字面值/字面值集/函数）按用户给的顺序重排。
- `rule-logic.ts` / `RuleEditors.tsx` / `RuleTable.tsx`：错误提示与注释同步。
- 模板 `.data/templates/rule_template/{validation/inference}/rule_*.json`：left/right `type` 的 `description` 同步对偶化、重排；**enum 值未变**（left 仍 `self/instance/function`，right 仍 `self/instance/instanceSet/value/valueSet/function`）。
- `core-backend/prompts/rule_generate.py` + `services/validators.py` + `routers/rules.py` + `schemas/__init__.py` + `docs/contracts/ontology-yaml.md` + `scripts/e2e-spec003-model-extension.py`：提示词、报错文案、契约文档、e2e 打印同步。

**关键决策**：`instanceSet`（in/not in 右侧的「关联实例集」）**保留不删**。用户列 right 时未点名它，但它是 `SET_OPERAND_TYPES` 之一，模板与前端校验矩阵强制「in/not in 右侧必须是集合类型」，且存量兼容逻辑（旧 `concept`/`set` → `instance`/`instanceSet`）依赖它；删掉会削弱「x in 某概念实例集合」表达能力并破坏存量数据渲染，故以「关联实例集」对偶呈现，self/instance/value/valueSet/function 语义不变。

验证：前端 `npx vitest run` → **356 passed / 22 files**；后端 `pytest` → **75 passed**；两模板 JSON 合法且 enum 不变；代码内「实体自身」「裸实例集」残留清零（specs/ 历史文档保留原术语）；core-backend 已重建。

### 规则函数化 + 函数统一返回信封（2026-09-30）

用户拍板：**规则裁决逻辑全部函数化**（`check_functions` 取代条件树），并统一函数返回结构（`success/data/error` 信封）。键名/兜底/裁决字段按推荐口径执行；行为（facade）与外部 MCP 工具不动。

**P1 函数统一信封**：
- `mcp-shared/sandbox.py`：`_normalize_output` 出口归一——新式（带 bool `success`）放行；旧式 `{"result":…}` 拆包；裸返回整包作 data（stderr 告警）。core 已不直接跑沙箱，归一仅此一处。
- 存量函数代码 9 个全部改写：6 个简单函数 + `checkRawMaterialUnit`（规则函数，`message`→`reason`）+ `aggregateData`/`filterData`/`groupReduce`（原第三种失败形态 `{"error":…,"code":…}` 统一为 `success=false+error`，未预期异常改上抛走 isError）；`filterData/groupReduce` 返回改 `data.items/count`。
- `functions.json`/`ontology.yaml` 的 `response` 平铺为 **data 内容描述**；ontology-mcp 两处工具 description 统一附加信封说明（`_ENVELOPE_NOTE`）。
- `prompts/function_code.py`：新信封约定 + 业务失败/未预期异常/裁决函数（pass/reason、禁 raise）三条款。

**P2 规则函数化**：
- core：`RuleItem.check_functions`（与旧条件树同为遗留字段，读时兼容）；`validate_check_functions`（函数必须存在于本体∪公共函数，否则 400）；`/rules/generate` 改为 LLM 从可用函数清单**选择**裁决函数（幻觉名兜底过滤）；`routers/rule_templates.py` 接口与 `.data/templates/rule_template/` 条件树模板退役。
- agent-backend：`RuleGate` 加 `verdicts` 裁决台账 + `RuleGateInfo.verdictRequired`（裁决函数须有裁决结论，普通关联函数留痕即满足——修掉「跑了但非信封仍放行」的 fail-closed 缺口）；`parseRuleVerdict` 解析信封；**闸 2.5**：前置裁决 `pass=false` → 拒绝主行为（文案带 reason，重试无效）；缺 pass → 留痕缺失拦截（fail-closed）；投喂改造：新式列裁决函数，遗留规则降级为描述文本（**不再投条件树 JSON**）。
- 前端：`RuleTable` 条件树编辑器退役 → 「裁决函数」多选 + AI 选择按钮；遗留规则展示「遗留条件树」标注，经 UI 保存自然升级；`design.ts` 契约同步。
- 存量迁移：V01 绑定 `checkRawMaterialUnit`（条件树删除，完成迁移样板）；其余 6 条保留旧条件树字段读时兼容。
- 契约文档 `ontology-yaml.md` 新增 §7「统一返回信封与规则裁决函数」。

**验证**：沙箱归一化 14/14；agent-backend 规则相关 77/77（新增闸 2.5 三态用例）；pytest 全量 **85 passed**；前端 `tsc` 通过；容器构建曾因 `parseRuleVerdict` 一处 TS 类型错误失败（vitest esbuild 不查类型），修复后 5 镜像重建成功；健康检查 8001/8003/:81 全 200，端到端 `POST /execute-common-function` 返回 `{"success":true,"data":{"date":"2026-09-30"},"error":null}` 证实信封在运行环境生效。

### 规则口径 B：关联函数 + 类型即角色真阻断（2026-09-30，取代上节的 check_functions）

用户拍板**口径 B**：不再保留独立的「裁决函数」字段——**角色由函数类型承载**，并需要**真阻断**。

- **模型简化**：规则删 `check_functions`（读时自动并入 `related_functions`）与 `rule_type`（删除，UI 不再展示）；旧条件树字段继续遗留读时兼容。规则约束逻辑 = `related_functions`（**本体函数 ∪ 公共函数**）。
- **判断函数 = 本体函数且 `type=VALIDATION`**（无新字段）：返回统一信封 `data.pass/reason`；
  **其他关联函数**（CALCULATION 等本体函数 / 公共函数）执行过即留痕。
- **真阻断（闸 2.5）**：前置规则主行为工具调用前核查判断函数——`pass=false` → 拒绝主行为（文案带 reason，重试无效，真实业务系统零调用）；**缺 `pass` → fail-closed 拒绝**（拦住"判断函数写漏 pass"）；未执行 → 引导补跑。后置规则收尾核查 + 有界 nudge。
- **数据补充**：按判断函数声明的 `related_concepts` 推导对应概念的 query 行为（自动填充，可手工增减）。
- **落地**：core（`RuleItem` + 迁移 validator + `validate_related_functions` + `/generate` 改选关联函数 + 4 处提示词）；agent-backend（`RuleDetail.judge_functions` 由 gateway 解析、`FunctionMeta.type`、`RuleGateInfo.judgeFunctions`、闸 2.5、投喂标注「判断函数」）；前端（RuleTable 删「规则类型」「裁决函数」列，关联函数列标注判断函数，数据补充自动推导）；存量 V01 迁移为 `related_functions: [checkRawMaterialUnit]`；契约文档 §6/§7 同步。
- **验证**：core `pytest` 85 passed；agent-backend `tsc` 干净 + 规则相关 91/91（含判断函数三态用例：pass=false 拒绝 / pass=true 放行 / 缺 pass fail-closed）；前端 `tsc` 通过；`RuleItem` 读时迁移实测（仅 check → 并入、合并去重、字段已移除）。

**口径 B 收尾（同日巡检补全）**：
- **测试补强**（原改动只有闸单测）：`ontology-gateway.test.ts` 新增 M6（旧 `check_functions` 读时并入）+ J1/J2/J3（判断函数解析：VALIDATION 型入 judge_functions、CALCULATION/公共函数不入、`getFunctionInfo` 返回本体 type）；`subtask-runner.test.ts` 新增投喂用例（关联函数标注「（判断函数）」+ 硬闸文案）。agent-backend 规则相关 **96/96**。
- **文档/模板遗漏修复**：`.data/templates/onto_template.yaml` 规则段仍留 `check_functions`/`rule_type`、`analysis.py` 阶段8「规则总表」仍含「规则类型」列——均已按口径 B 修正。
- **存量数据巡检清理**：三个本体（原材料采购和库存 / 订单排程 / 货品BOM及工艺）文件内残留的 `rule_type`（25 行）与 `check_functions`（5 行）全部清理；其中 **I02 的 `check_functions: [getCurrentDate, filterData]` 按读时兼容口径合并进 `related_functions`**（两者均为公共函数 → 不进 judge_functions，属纯留痕规则）。历史版本 `ontology_versions/v1.0|v1.1` 保持只读不动。
- 素材核对：`skill_generate.py` 明确「严禁自行添加函数、规则章节」→ SKILL.md 不含规则内容，无需变更；`spec.md` 为用户故事 3/4 的历史快照，按惯例不改写（演进记录在本节）。

**整体复查（2026-09-30，围绕函数/规则链路）**：
- **发现并修复一处真实破坏**：函数试调展示未适配统一信封——`FunctionTable.tsx` 仍取 `result.result`（新信封无 `result` 字段 → 显示 undefined）。
  修复：`executeFunction` 返回类型改信封；试调结果改为读整个信封（成功显 `data`、失败显 `error.message`，兼容请求层字符串错误）；
  `core-backend/routers/functions.py` / `common_functions.py` 的「run() 自带 `{"result": …}` 包装」过时注释同步。
  实测 `POST /api/ontologies/1/functions/sumRawNotArrivalQty/execute` → `{"success":true,"data":{…},"error":null}` ✓
- **术语统一**：agent 侧注释层残留的「裁决」全部改为「判断」（execution-policy / agent-factory / subtask-runner / gateway 及其测试；代码标识符 `RuleVerdict`/`verdicts`/`parseRuleVerdict` 保留）。
- **配置期提示缺口（记录，未改）**：用户若把**公共函数**配进规则的 `related_functions` 并期望它阻断——公共函数无 `type`、不进 `judge_functions`，实际只留痕无阻断；
  前端下拉已用「（判断函数）」标注本体 VALIDATION 型，但未对"误把公共函数当判断"给出显式告警。属可选增强。
- **死代码（记录，未清）**：`RuleEditors.tsx`（条件树编辑器）与 `rule-operands.ts` 的编辑器侧函数已无引用；`rule-logic.ts` 的推导函数仍在用（存量旧条件树的概念引用仍参与 `data_supplements` 推导），故整块保留，标注为待清理技术债。
- **规划期类型透传（记录，未改）**：`MountableToolInfo`（`listAllMcpFunctions` 输出）不含函数 `type`；父 Agent 需经 `listOntoFunctions`（返回函数完整定义含 `type`）获知类型，链路可达但不直接。
- 复核结论：core（模型/校验/路由/提示词）、agent（网关解析/策略/闸/投喂）、前端（表格/契约）、数据（本体/模板/函数代码）、文档（契约）五处口径一致；三侧测试全绿（core 85 / agent 规则相关 96、全量仅既有 orchestrator 3 例失败 / 前端 356）。

### 规则函数补充：4 条 command 规则的判断/推导函数（2026-09-30）

为绑定 command 行为的存量规则补齐函数（口径 B：`related_functions` + 本体 VALIDATION 型即判断函数）：

| 规则 | 新建函数 | 类型 | 设计要点 |
|---|---|---|---|
| V03_ArrivalTimeValidity（前置） | `checkArrivalTimeValidity` | VALIDATION | 到位时间须晚于采购发生日；**`CreatePurchaseRecord` 输入无 `purchaseTime`**（它是响应字段），故以当前日期为基准——`related_functions` 并联公共函数 `getCurrentDate` 供参；规则描述同步修正 |
| V05_SupplierExistence（前置） | `checkSupplierExistence` | VALIDATION | 供应商须存在于主数据；`data_supplements` 补 `[QuerySuppliers]`（主数据来源） |
| I04_RelatedOrderValidation（前置） | `checkRelatedOrderExistence` | VALIDATION | 未填→通过；填写→须存在于客户订单集。**本本体无客户订单查询行为**（客户订单属「订单排程」本体）→ 未取到数据时**不阻断**（pass=True + reason 说明「存在性校验未执行」），避免不可修复的误拒 |
| I03_PurchasePurposeInference（后置） | `inferPurchasePurpose` | **CALCULATION** | 未关联→补充库存 / 否则→生产订单备料；**不返回 pass**（不参与阻断），符合后置推理语义 |

- **未纳入**：I01（安全库存预警，绑 query 行为 `QueryInventory`）、I02（到位超期，绑 `QueryPurchaseRecords`，已有 `getCurrentDate`/`filterData` 留痕）——本次范围限 command 行为规则。
- **验证**：函数语义 **14/14**（含 fail-closed：V05 无主数据不通过、V03 缺参/格式非法不通过；边界：I04 非空但无数据不阻断并留痕理由）；core API 读取为本体 **6 个函数**（新增 3×VALIDATION + 1×CALCULATION）+ 四条规则绑定齐全；运行环境 ontology-mcp **热加载实测**（`.data` volume，无需重建）：
  `checkSupplierExistence(杜撰公司)` → `{"success":true,"data":{"pass":false,"reason":"…不存在于供应商主数据，不得杜撰"}}`；
  `inferPurchasePurpose('')` → `{"success":true,"data":{"purchasePurpose":"补充库存",…}}`。
- **后续可选**：若要让 I04 真正做存在性阻断，需在场景内补「客户订单查询行为」（跨本体取数能力，当前 `data_supplements` 仅支持本体内行为）。

### 规则条件树清理 + 关联函数展示口径统一（2026-09-30）

**1）关联函数展示口径统一为 `中文名-类型`**（原为角色描述文案「公共函数：仅提供数据，不拦执行 / 判断函数：不通过则拒绝执行」等，用户判定不直观）：

- 公共函数 → `当前日期-公共`；本体函数 → `校验采购原材料单位一致性-逻辑验证`（类型取展示态中文，见 `function-type-labels.ts`）；本体未标注类型 → `-未分类`。
- 口径抽为纯模块 `frontend/src/components/Design/rule/function-label.ts`，下拉与已选展示共用（消除两处文案漂移可能）；补单测 `function-label.test.ts`（6 例）并纳入 vitest 覆盖率清单。
- 同时修掉一个**真实缺陷**：`RuleTable` 组装候选函数时公共函数只加了 `type: ''` 而**漏了 `_source: 'common'`**，导致公共函数恒落兜底分支、标签判定失效（`FunctionTable.tsx` 一直是两者都加）。

**2）旧条件树字段全量退役**——规则的约束逻辑已统一由 `related_functions` 承载（口径 B），条件树成为无消费者的死结构：

- **前端**：删 `rule/RuleEditors.tsx`（无任何引用）、`rule/rule-operands.ts`（+测试）；`rule-logic.ts` 精简为仅 `deriveDataSupplements`（改为按关联函数声明的关联概念推导，不再读条件树）；`RuleTable.tsx` 去掉旧条件树读写及随之失效的 `concepts`/`relations` 状态；`api/design.ts` 的 `Rule` 去掉该字段。
- **core-backend**：`schemas.RuleItem` 移除旧条件树字段；`validators.py` 删 `iter_operands`/`rule_uses_self`/`validate_self_requires_behavior` 及 `Iterator` 导入；`routers/rules.py` 去掉该校验；`prompts/ontology_generate.py`、`prompts/rule_generate.py` 文案同步。
- **agent-backend**：`types.RuleDetail` 移除旧条件树字段；`ontology-gateway` 不再读取（投喂早已改走 `related_functions`/`judge_functions`）；`execution-policy` 注释同步。
- **文档/脚本**：`docs/contracts/ontology-yaml.md`（字段表 / 迁移规则 / 写时校验 / 运行期口径）、`docs/Optonto项目框架评估.md`、`scripts/e2e-spec003-model-extension.py`（规则段改关联函数口径 + 新增「规则段无遗留条件树」检查）同步。
- **存量数据**：活跃本体（`.data/onto_market/生产调度/原材料采购和库存/ontology.yaml`）**已无**旧条件树字段，无需迁移；仅 `ontology_versions/v1.0` 历史快照保留（不改写历史）。

**验证**：core `pytest` **67 passed**（较 75 少 8 条 = 删除的 `TestRuleSelf`）；前端分块回归 **17 files / 198 tests 全通过**（含新增 `function-label` 6 例、重写 `rule-logic` 4 例）；剩余 5 个大体积用例文件当时超出命令通道超时窗口（已在下方「收尾修正」中以独占进程补齐）；agent-backend 3 条失败位于 `orchestrator.test.ts`「言行不一闸」（已在「收尾修正」中对齐修复）。

### 收尾修正（2026-09-30）

**1）agent-backend 陈旧用例对齐（原 3 条失败）**：`orchestrator.test.ts` 的「言行不一闸」3 条用例仍写着旧设计（**nudge 一次自救**），而实现在 `4b4dd84`（2026-09-28「新增约束」）已改为**命中即拦截、不重试**（`orchestrator.ts:306-316`，连注释都已同步改写）。按**当前实现**重写这 3 条用例（命中即拦截 + 拦截留痕 / 诚实直答放行 / 真提交正常进入执行链），保留「虚假声明原文不进正文」「不进入执行链」等安全断言。**运行期行为未做任何改动**。

**2）版本存档与当前版本同步**：部署本体 `metadata.deployed_version = v1.0`，而 `ontology_versions/v1.0/`（= 当前版本自己的存档目录）仍停在旧形态（`related_behaviors` + `rule_type` + 旧条件树），与部署文件不一致（177+/237-）。按「当前版本 = v1.0」口径，将部署的三个 yaml 复制回该存档目录——`deploy` 流程本身在切换版本时也会把当前部署备份到该目录，语义一致。
- 结果：存档与部署**逐字节一致**（`git diff --no-index` 空）；全部版本存档中旧条件树字段清零。
- 端到端：`GET /api/ontologies/1/deploy/version-preview?version=v1.0` → `from_version_dir=True`、7 条规则、字段 `name/description/behavior/related_functions/display_name/position/data_supplements`。
- `v1.1` 存档保持原样（非当前版本，且本就无旧条件树字段）。

**3）全量回归（最终）**：前端 `npx vitest run` **22 files / 303 tests 全通过**（80.04s，含此前未能复跑的 5 个大用例文件）；agent-backend **307/307 通过**；core `pytest` 67 passed；`tsc --noEmit`（agent-backend）通过；core 重启后 `/health` 200、nginx `/` 200、规则接口无旧条件树字段。

### 整体审计与修正（2026-09-30，语义统一 / 冗余 / 功能）

**A. 提示词自相矛盾（语义冲突）**
`core-backend/prompts/analysis.py` 阶段5B「要求4：函数的返回结构」示例仍是**旧信封**（顶层 `success` + `result` + `message`），与同段「要求5」及 `function_code.py` 的新信封（`data` / `reason`）直接冲突 → 改为 `success`/`data`/`error` 三段式、`message`→`reason`、补 `error` 段示例；并把该段 `{{…}}` 双花括号改为单花括号（该提示词经 `str.replace` 注入、**不经 `.format()`**，双括号会原样渲染给模型）。

**B. 数据补充推导口径（表述对齐实现）**
实现（`deriveDataSupplements`）按**全部关联函数**声明的 `related_concepts` 推导，文案却写作「按**判断函数**关联的概念」→ 6 处统一为「按关联函数声明关联的概念」：`RuleTable.tsx`（tooltip + 说明）、`schemas.RuleItem`（docstring + 字段描述）、`ontology_generate.py`、`analysis.py` 要求3、`docs/contracts/ontology-yaml.md`。

**C. 裁决台账采集范围收窄（语义精度）**
`agent-factory.ts` 的裁决解析名单由「全部关联函数」收窄为 `judgeFunctions`：非判断函数即使返回同名 `pass` 字段也不进裁决台账，与「口径 B：类型即角色」严格一致（闸 2.5 与 `missingRuleFunctions` 本就只读判断函数，**运行期行为不变**，仅消除噪音）。

**D. 陈旧夹具/脚本修正**
- `agent-backend/scripts/e2e-prerule-trace-gate.py`：夹具仍返回旧信封 + `message`（新闸读 `data.pass` → 恒 fail-closed），说明仍是「闸2 留痕」→ 夹具改统一信封 + `reason`、`response` 声明改 `pass/reason`、说明改「闸2.5 裁决核查 + 闸2 留痕」。
- `scripts/e2e-spec003-model-extension.py`：VALIDATION 夹具的 `response` 由 `{"result": …}` 改为 `pass/reason`（`response` 声明描述的是 `data` 内容）。

**E. 冗余清理**
- 删除 `.data/templates/rule_template/`（条件树模板退役后只剩 `validation/`、`inference/` 两个空目录）。
- 复核未发现其它死代码：旧条件树/`rule_type`/`check_functions`/`实体自身` 在活跃代码中均已清零（仅存于读时兼容分支与 specs 历史）；`judge_functions` 仅存在于 agent 运行期派生、不入盘。

**F. 测试补齐**
新增 `mcp-shared/tests/test_sandbox.py`（12 例）：信封归一化（新式放行 / 旧式 `result` 拆包 / 多顶层键整包 / 裸返回兜底 / `success` 非布尔不冒认成新式）+ `run_function_code`（未定义 `run` 抛错 / 函数内异常上抛 / 裁决「不通过」不算异常）。

**验证**：mcp-shared **12** / core **67** / agent **307** / frontend **22 files · 303 tests** 全通过；`tsc --noEmit`（agent）通过；镜像重建后健康检查与规则接口正常。

### 需求讨论 / 本体构建提示词审计（2026-09-30）

**A. 与已退役模型冲突（会直接误导 LLM / Agent）**
- `prompts/ontology_generate.py`（本体构建主提示词）：要求5「行为方法只能为 GET/POST/PATCH/DELETE」——行为早已是 `op_type: command/query`，HTTP method 属数据引擎域 → 改为 op_type 值域；要求6「规则类型只能为 计算/验证/推理规则」——`rule_type` 字段已移除 → 改为「规则不设类型字段，禁止输出 `rule_type`」。
- `.data/templates/skill_template.md` + `prompts/skill_generate.py`：仍教「调用 `executeOntoBehavior` 执行行为」——**该分发器已彻底退役**（行为 facade 化，工具名即行为名）→ 改 facade 口径；行为类型 `操作行为/查询行为` → `command（命令）/ query（查询）`；行为参数示例 `display_name` → `description`（行为参数的标准字段）。
- **存量技能文件** `.data/onto_market/生产调度/原材料采购和库存/skills/raw-material-inventory/SKILL.md`：9 处 `executeOntoBehavior` + 9 处类型中文口径 → 同步修正（该文件被 `load_skill` 实时加载，错误信息会直接进父 Agent 上下文）。
- `docs/Optonto项目框架评估.md`：两处 `executeOntoBehavior` → facade 口径。

**B. 提示词内部矛盾 / 冗余**
- `prompts/ontology_generate.py` 要求7「参考模板，只输出 YAML 内容，**不要任何新增或修改**」与要求14/16 及末段「按勾选裁剪、空节省略、示例值替换」直接冲突 → 改为「严格以模板的结构 / 字段名 / 顺序为准，模板示例值必须替换为真实内容」；要求9/10 与要求7 重复 → 改写为两条独立约束（不得虚构补全；模板未定义的字段不得输出）。
- `prompts/analysis.py`：全局原则编号重复（两个「5.」）→ 修正为 5/6；阶段4「要去4」错别字 → 「要求4」；阶段8 第7条「必含1项检查」与正文「以上**两项**互不依赖」数目矛盾 → 统一为「以上检查项与下方《关键要求》中的两项」。

**C. 复核为「非问题」**
- `mcp-shared/schema_compile.param_spec_to_schema` 对参数说明取 `display_name or description`——行为参数（`description`）与函数参数（`display_name`）**两种写法编译器都兼容**，非缺陷。
- 阶段4 行为返回结构示例 `{code, data}` 与存量行为 `response` 一致；阶段5B 函数 params 示例 `display_name` 与存量函数一致。

**D. 未修（待决策的观察项）**
1. `securities` / `data_engines` 在 `chat.py::_FILTERABLE_SECTIONS` 与生成提示词里被列为可裁剪一级目录，但**模板文件没有这两节** → 前端「本体生成」勾选列表（取自模板顶层键）永远不含它们；而阶段4 又要求用户提供「目标数据源接口信息」。即：这两类信息在需求讨论中被收集，却既无汇总节、也无生成通道。
2. 行为 params 展示字段用 `description`、函数 params 用 `display_name`——同一份 yaml 两套约定（编译器已兼容，统一需动模型与前端）。

**验证**：`prompts` 包可导入、`ONTOLOGY_GENERATE_PROMPT_TEMPLATE.format(...)` 占位符完整；core `pytest` **67 passed**；core-backend 镜像重建 + 健康检查通过。

### 本体提示词「与输出结构一致性」字段级审计（2026-09-30）

把提示词声称的输出结构逐字段与 **模板 / 数据模型 / 契约文档 / 存量数据** 对齐，修正 5 处结构级错位：

**A. 模板结构性错误（会直接导致生成结果丢字段）**
1. `concepts[].attributes[]` 示例把 `required: true` 写在**属性层级**——模型无该字段（Pydantic 静默忽略）→ 非空约束会丢。改为在 `constraint` 内演示真实结构（`unique`/`required`/`pattern` 一组 + 独立 `enum` 一组 + `min`/`max` 一组），并删掉 `constraint: ''`（字符串约束会被校验器直接丢弃）。
2. `behaviors[].params` 项的说明字段原为 `display_name`——**行为参数的约定字段是 `description`**（前端 `BehaviorTable` 归一化即用 `description`，存量数据亦然）→ 模板两个行为示例共 11 处改为 `description`；`functions[].params` 仍用 `display_name`（两者本就不通用）。
3. `rules[]` 段**缺 `data_supplements`**——分析阶段6B/阶段8 都在收集它，`RuleItem` 与前端均有该字段 → 模板补齐。

**B. 模型有、链路缺的字段**
4. `concepts[].instance_label`（实例标签）：`ConceptItem` 有、前端概念表格可编辑、实例视图 `instance-graph-model` 直接消费，且**存量本体 6 个概念都在用**（如 `instance_label: rawMaterialName`）——但模板与提示词从未提及 → 生成链路必丢。已在模板（按 schema 顺序置于 `display_name` 与 `terms` 之间）、`ontology_generate` 要求21（术语集与实例标签）、`analysis` 阶段2A 与阶段8 第1条（概念总表列名 + 空值填 `-` 口径）补齐。

**C. 提示词缺字段落盘口径**
5. `ontology_generate` 原要求13 只讲 `min/max` → 扩写为**完整的属性约束结构要求**：约束统一写在 `constraint` 对象内（`unique`/`required`/`enum`/`pattern`/`min`/`max`，只写有意义的键），**顶层不得写 `required`**，无约束时整块省略（不得写 `constraint: ''`）；要求7 补「行为用 `description`、函数用 `display_name`，不得互换」。

**D. 契约文档同步**
- `docs/contracts/ontology-yaml.md` §6 字段表补 `concepts[].instance_label`、`concepts[].attributes[].constraint`、`rules[].data_supplements` 三行，并新增「`params` 说明字段口径」段（行为 `description` / 函数 `display_name`；读取以 `display_name or description` 兜底，但**写入**须按各自口径）；顺手修正过时用例数（40 → 32）。

**复核为「非问题」**：目标侧 `data_engines.yaml` 的 `response.result` 与本体侧 `behaviors[].response.data` 是**两层**（`mcp-shared/mapper._translate_output` 按映射改名，已验证）。

**验证**：模板 YAML 解析通过 + 字段形态逐项核对（concept_keys 含 `instance_label`、属性键无顶层 `required`、行为参数为 `description`、函数参数为 `display_name`、规则含 `data_supplements`）；core `pytest` **67 passed**（`test_model_extension` 32 例）；容器内实测 5 项新要求全部生效；`/health` 200；core-backend 已重建。

### 映射功能复核与嵌套数组修复（2026-09-30）

**检查方法**：探针脚本实跑 `mcp-shared/mapper` 的嵌套数组各形态（容器+叶子 / 仅叶子 / 标量数组 / 三层嵌套 / 裸数组根 / 映射值碰撞 / 空数组），取事实后修复；再用真实 8 条引擎映射做改动前后对比。

**结论：嵌套数组翻译本身正确**——容器与叶子都声明时两个方向均无损（含三层嵌套实测）；存量 8 条引擎映射改动前后输出**逐条一致，0 条差异**。

**修复的静默失效（4 处）**：

1. **容器未声明时只换一半名**（`mapper._complete_mapping`）：只声明叶子/元素行时，祖先容器名停留在目标侧名字（`items`/`labels`），本体契约（`lines`/`tags`）被静默破坏。现按「去尾段 → 去尾 `[*]`」递归补齐祖先容器映射，显式声明优先；补齐只新增「已声明路径的祖先」，**白名单覆盖集合不变**（暴露面不变）。
   标量数组尤其关键：元素行本身不参与任何 key 改写，容器行是唯一换名手段（`data[*].tags[*] → result[*].labels[*]` 现自动导出 `data[*].tags → result[*].labels`）。
2. **输出映射全未命中时告警**（`executor._has_content` + `_call_engine_mcp`）：响应根结构与 `target.response` 声明不一致（如裸数组根 vs 声明 `result[*].x`）时白名单把响应整体滤空，原先只表现为 `[{}]`。现记 warning（行为不变）。
3. **映射值重复告警**（`executor._check_mapping_duplicates`）：两个源字段指向同一目标字段时后者覆盖前者（输入丢参数 / 输出丢字段），原先无任何提示。现记 warning。
4. **智能映射落盘前清洗**（`services/mapping_sanitize.sanitize_mapping`）：LLM 产出的键/值若不在字段清单内，UI 不可见（弹窗按本体字段逐行渲染，键不在清单即无行可显示）、运行期不命中，属静默垃圾。现落盘前剔除并把剔除项并入 `issues`（`status` ok → warning）；两条保守兜底——清单缺失不校验、全不匹配不清空（只回报）。

**测试**：新增 `mcp-shared/tests/test_mapper.py`（21 例，该模块此前**零覆盖**）、`core-backend/tests/test_mapping_sanitize.py`（8 例）、`data-engine-mcp/tests/test_engine_mcp.py` +3 例（两处告警）。全套：mcp-shared **34 passed**、data-engine-mcp **9 passed**、core **75 passed**（原 67 + 8）。

**提示词**：`prompts/data_engine.py` 的 `MAPPING_ANALYSIS_PROMPT` 去掉重复行，新增「数组容器行与其元素行必须一起给出」要求（含嵌套示例与标量数组说明）。

**已知不改并已用测试锁定**：裸数组响应根不作为可配置形态（mapper 假设对象根，改成猜测会引入歧义，仅告警）；`_translate_input` 未映射参数透传（非白名单，既有口径）；空串映射值 ⇒ 输出**缺键**（非 null，存量例 `CreatePurchaseRecord.data.leadTime`）。

### 旧条件树字段引用清零（2026-09-30）

「已删字段的说明性提及」一并清除：全仓（代码 / 提示词 / 模型串 / 测试夹具 / 契约文档 / e2e 脚本 / specs / `.data`）不再出现该字段名。

- **提示词**：`ontology_generate.py` 要求20 改为「禁止输出任何已废弃的历史字段…模板未定义的字段一律不得输出」——原要求10 的通用兜底保留，**防复活强度不减**；`rule_generate.py` 模块串同步。
- **模型/前端/文档**：`schemas.RuleItem` 文档串改「旧条件树字段已退役」；`frontend/rule/rule-logic.ts` 注释同步；`docs/contracts/ontology-yaml.md` 迁移清单第 6 条同步。
- **测试夹具**：`test_model_extension.TestBackwardCompatibleSnapshot` 改用中性未知键 `legacy_unknown_key`——语义（未知字段被静默忽略、旧快照仍可加载）不变。
- **e2e 脚本**：原「断言无该字段」改为**规则字段白名单断言**（`set(rule) ⊆ 白名单`，比逐字段断言更严）+ 结构断言（`children:` / `logic:` 均不得出现）——不再依赖该字段名，且能拦住任何形态的条件树复活。
- **存量数据**：`.data/threads/demand/<uuid>/原材料采购与库存_全体.yaml`（需求线程的历史附件）整块删除 7 处条件树（7 条规则各一处）；删前后逐节比对：concepts/relations/functions/behaviors **完全一致**、rules 条目数不变、仅该键消失，且 YAML 仍可解析。
- **specs 三份**（spec / plan / tasks）共 27 处引用改为「旧条件树（字段）」中性表述，变更记录可读性保留。

**验证**：全仓该字段名命中 **0**（含 `.data` 文件系统级扫描；`.git` 历史未改写）；core `pytest` **75 passed**、前端规则目录 **10 passed**；core / frontend 已重建，**5 个容器内产物命中均为 0**（core / frontend / agent / data-engine-mcp / ontology-mcp）；core `/health` 200、nginx 200。

### 遗留（明确未做，与 spec 的 Out of Scope 一致）

- 函数返回类型 `return_type`、权限按角色（用户 D2/D7 决定不做）
- 关系类型与 `cardinality` 的一致性校验、关系类型的推理语义（系统无推理引擎）
- 存量 `type: enum` 属性规范化（`CustomerOrder.status` / `orderType`）
- `.data/onto_market` 下存量本体未做批量数据迁移——**依赖读时兼容**，经 UI 保存时自然升级为新格式

## 明确不做（避免误勾）

- 函数返回类型 `return_type`（用户 D7 决定不做）
- 权限按角色 / `SecurityItem.scope` 相关改造（用户 D2 决定不做）
- 关系类型与 `cardinality` 的一致性校验、关系类型的推理语义
- 存量 `type: enum` 属性的规范化（`CustomerOrder.status` / `orderType`）
