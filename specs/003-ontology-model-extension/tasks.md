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
- **规划期类型透传（记录，未改）**：`MountableToolInfo`（`listPlannableFunctions` 输出）不含函数 `type`；父 Agent 需经 `listOntoFunctions`（返回函数完整定义含 `type`）获知类型，链路可达但不直接。
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

### MCP 调用契约收紧：ontology_id 必填 + 工具名去前缀（2026-10-01）

两条口径变更（用户拍板），全部落在 MCP 服务侧；agent 侧只做配合调整。

**1）本体函数与行为的 `ontology_id` 一律必填，未传即报错（不兜底）**

- 新增共享校验 `mcp-shared/schema_compile.require_ontology_id(value, label)` —— **单一实现**，ontology-mcp 与 data-engine-mcp 共用（不再各自持有一份副本，避免漂移）。
- `ontology-mcp`：本体函数 MCP 路径（原已是硬报错）改用共享函数；REST `/execute-function` 从「缺 id 时 `int(None)` → 500」改为 **400 + 明确文案**。
- `data-engine-mcp`：行为 MCP 路径去掉 `oid = arguments.get("ontology_id") or entry.get(...)` 兜底 → **缺即报错**；REST `/call-behavior`、`/call-engine` 同样返回 400。
- MCP 协议路径另有 SDK 层 `jsonschema.validate`（`required` 已含 `ontology_id`）先拦一道，两处口径一致。

**2）本体函数名与行为名都不带本体前缀**

- `data-engine-mcp/facade`：删除 `onto{ontology_id}__` 前缀命名 → **工具名 = 行为裸名**（等于本体函数口径，本体归属由调用参数决定）。
- 跨本体重名在工具名维度无法共存（且 `entries` 字典会互相覆盖 → 静默路由到错误本体）：现**保留先出现者 + 记 ERROR 日志**，由设计侧改名解决（实测当前 4 本体 33 行为无重名）。
- agent 侧配合：删除 `tool-catalog.bareBehaviorName`（不再需要剥前缀）及其 2 处调用（disable 闸匹配、执行记录展示回溯），改用工具名（即行为名）；`scope.name` 保持为挂载过滤 / disable 闸 / 展示回溯的统一匹配键。

**测试**：新增 `mcp-shared/tests/test_schema_compile.py`（3 例）、`data-engine-mcp/tests/test_facade.py`（5 例：裸名、重名保留先出现者、schema 含 scope+required、MCP 缺 id 报错、REST 缺 id 400）；agent 侧重写 2 条、删除 1 条只对「前缀场景」成立的用例（含"调用方所传 ontology_id 被本run值覆盖"这条强化断言）。全套：mcp-shared **37 passed**、data-engine-mcp **14 passed**、agent **306 passed**。

### MCP 服务入参规定 + call_tool 注册缺陷修复（2026-10-01）

**规定（用户拍板，全部经 MCP 协议口实测）**

| 工具类别 | `ontology_id` | 实测结果 |
|---|---|---|
| 本体函数 | **必填** | 缺 → `Input validation error: 'ontology_id' is a required property`；带 → 正常（判断函数返回 `{success, data:{pass, reason}}`） |
| 本体行为 | **必填**（不兜底） | 缺 → 同上；带 → 正常（映射输出正确） |
| listOnto\*（6 个） | **必填** | 缺 → 同上；带 → 正常 |
| listScenarios / listOntologies | 无该参数（全局花名册，设计如此） | 不传即正常 |
| 公共函数 | **不传**（schema 里没有） | 不传 → 正常；多传系统键 → 不报错，但按代码未剥离（多余键会进函数 params；现 7 个公共函数均不读未知键） |

实现：`mcp-shared/schema_compile.require_ontology_id` **单一实现**，ontology-mcp / data-engine-mcp 共用；MCP 协议口另有 SDK 层 `jsonschema.validate`（`required` 已含 id）先拦。

**scope 处理链（复核）**：发布端 `with_ontology_context` 写入 const 块 → 父 Agent `listPlannableFunctions` 读出（填子任务 scenario·ontology；分类与中文名随后改由顶层 `x-category`/`x-display_name` 承载，见下节） → 子 Agent 挂载时**整块删除** → 服务端执行前再剥（`strip_system_params`）。协议级实测：**不传=正常；传「与 const 完全一致」的值=正常且被剥；传「不一致」的值=协议层 jsonschema 直接拒**（`'本体行为' was expected`）——即 scope 只可省略或原样回传，不可乱填。

**修复：`@server.call_tool()` 误挂在辅助函数上（历史缺陷，HEAD 即如此）**

`ontology-mcp/server.py` 的装饰器落在辅助函数 `_rule_behavior` 上，`handle_call_tool` **从未注册** → 本服务全部工具（listOnto\* / 本体函数 / 公共函数）经 MCP 调用一律返回
`_rule_behavior() takes 1 positional argument but 2 were given`。影响面：父 Agent 的本体浏览工具、子 Agent 的本体函数/公共函数调用（含规则判断函数）全部不可用；行为工具在 data-engine-mcp 侧不受影响（其装饰器位置正确）。修复 = 装饰器移回 `handle_call_tool`。

**测试**：新增 `ontology-mcp/tests/test_server.py`（3 例，含「按协议层双参调用处理器」回归断言——函数对象同一性不可用，SDK 注册的是内层闭包）、`data-engine-mcp/tests/test_server.py`（同口径 3 例）。`ontology-mcp/tests/` 此前**不存在**：该服务此前零测试，正是本缺陷长期无守卫的原因。全套：mcp-shared **37**、ontology-mcp **3**、data-engine-mcp **17**、agent **306**。

### MCP 工具发布契约统一（2026-10-01）

按「分类处理 + 语义统一」重构工具契约：**单一权威**落 `mcp-shared/schema_compile.py`，**消费实现**落 `agent-backend/src/agent/tool-catalog.ts`，新增契约文档 `docs/contracts/mcp-tools.md`。

**1）分类标记单一来源**：`x-category`（五类：本体行为 / 本体函数 / **本体查询（新增）** / 公共函数 / 消费端兜底"其他MCP工具"）+ `x-display_name`（发布方权威中文名）。废弃旧形态——分类曾同时写在 `scope.category`（本体工具）与 `x-category`（公共函数），同一语义两种表达。

**2）scope 语义收敛为「本体上下文块」**：仅本体执行类（行为/函数）携带，只含 `name` + `ontology_id`/`scenario_id`/`scenario_name`/`ontology_name`（全 const），**不再含分类标记**。

**3）发布原语统一**（`with_category` / `build_query_schema` / `with_ontology_context` / `strip_system_params`）：
- ontology-mcp：公共函数、本体函数、8 个查询工具（改表驱动 `_QUERY_TOOL_SPECS`，替代约 90 行手写 schema）全部走同一套构造；
- data-engine-mcp：行为走 `with_ontology_context(..., CATEGORY_BEHAVIOR)`，执行前剥离改用共享 `strip_system_params`；
- `FUNCTION_SCOPE_KEYS` → `SYSTEM_PARAMS = {scope, ontology_id}`（语义纠正：行为也用）。

**4）参数契约统一**：本体执行类与 `listOnto*` 的 `ontology_id` 必填——`require_ontology_id` 单一实现，查询分支统一走 `_ontology_of`（替代裸 `arguments["ontology_id"]`）；公共函数执行前防御性剥离系统键。

**5）消费端语义边界收紧**：本体查询类**不挂子 Agent、不进子任务可规划清单**；父 Agent 查询工具改由分类标记推导（`isQueryTool`），删除硬编码名单 `PARENT_ONTOLOGY_QUERY_TOOLS`；`PARENT_TOOL_LABELS` 降级为纯展示映射（文案与发布端 `x-display_name` 一致）。

**6）协议不变式快速失败**（`assertToolProtocol`，在 `discoverTools` 边界）：①带 scope 块的必须是本体执行类（旧版形态否则会**丢本体锁定**）②本体执行类必须带 scope 块 → 违反即抛错，不静默降级。

**测试**：mcp-shared **46**（+9）、ontology-mcp **9**（+6）、data-engine-mcp **17**（+3）、agent **308**、core **75**（不变）。**协议级实测**（真实 MCP 客户端）：标记齐备、`scope.category` 无残留、参数矩阵逐条符合、9 条调用用例全部符合预期（缺 id 一律拒；带与 const 一致的 scope 通过且被剥；公共函数无系统参数；查询工具带 id 正常）。镜像：ontology-mcp / data-engine-mcp / business-mcp / agent-backend 已重建；五服务健康检查 200。

### 本体版本可见性对齐：`listOntologies` 透出 `deployed_version`（2026-10-01）

**问题（检查发现）**：`deployed_version` 只存在于 core 侧——`repositories/metadata.list_all_ontologies()`
在返回时**读时附加**该字段（`_deployed_version_of` 现读 `ontology.yaml` 的 metadata），而 **MCP 侧的同名函数
`mcp-shared/loaders.list_all_ontologies()` 只补了 `scenario_name`/`ontology_name`**。后果：前端设计器拿得到版本，
但 `ontology-mcp` 的 `listOntologies` 返回给父 Agent / 外部 agent 的清单**没有版本号**——同一函数名两处口径不一。

**修法（方案 A：对齐 core，不落盘）**：新增 `loaders.deployed_version_of(scenario, ontology)`，语义与
core `_deployed_version_of` 一致（读时派生；**不写进 meta.json**，避免"部署状态"出现第二事实源），
`list_all_ontologies()` 每条附带 `deployed_version`。两处工程决策：

1. **复用 `load_ontology_data` 的 mtime 缓存**（而非像 core 那样每次重新 `read_yaml`）：
   `list_all_ontologies` 经 `get_ontology_names` 落在**函数/行为每次调用的路由前置热路径**上，
   按 core 写法会让每次调用重新解析全部 `ontology.yaml`（单份 29KB）；
2. **损坏降级为空串且不外抛**（core `fs_store.read_yaml` 同口径）：否则一个坏 yaml 会连清单与路由一起打挂
   ——新增的这条读路径不能把既有热路径的容错面变差。

**测试**：新增 `mcp-shared/tests/test_loaders.py`（6 例：版本随清单透出、未部署/无 metadata/空值为空串、
**yaml 损坏按无版本降级且清单与 `get_ontology_names` 均不受影响**、重新部署后版本即时刷新（mtime 缓存不串味）、
多本体各取自己的版本、缺 `scenario_id` 的 meta 仍被跳过）。全套：mcp-shared **52**、ontology-mcp **9**、
data-engine-mcp **17**、business-mcp **4**。镜像：ontology-mcp / data-engine-mcp / business-mcp 已重建（共用 `mcp-shared`）。
文档：`docs/contracts/mcp-tools.md` §7 补 `listOntologies` 返回值口径；`ontology-mcp` 的 `listOntologies` 工具描述同步。

**未采纳（方案 B，保持单一事实源）**：把 `deployed_version` 写进 `meta.json`——会引入第二写入点与漂移风险
（`ontology_versions/{v}/ontology.yaml` 复制时会带旧值）；如需"任何读 meta.json 的地方都直接可见"再另议。

### 本体身份读取口径统一：唯一来源 = ontology.yaml.metadata（2026-10-01）

**问题（检查发现）**：本体身份四元组存在**三处不同来源**——`meta.json` 提供 `id` / `scenario_id`（core 与 agent），
**目录名**提供 `scenario_name` / `ontology_name`（core、mcp-shared、agent 各自拼），而 `ontology.yaml.metadata`
里那四元组**没有任何读取方**（只被 `save_ontology_data` 写入、被部署合并刷新）。同名语义三种读法，
改名后必然漂移（`metadata` 要等下次保存/部署才刷新）。

**统一后的口径**：`ontology.yaml.metadata` 是身份四元组与本体名 `name` 的**唯一读取来源**，
三端同一语义、同一实现口径，**不用目录名或 meta.json 兜底**：

| 端 | 读取实现 | 不可信时的姿态 |
|---|---|---|
| core | `repositories/metadata.read_ontology_identity` / `list_all_ontologies` | 跳过 + 告警（`logger.warning`） |
| mcp-shared（ontology-mcp / data-engine-mcp / business-mcp） | `loaders.ontology_identity` / `_ontology_metadata`（mtime 缓存） | 跳过 + stderr 告警 |
| agent | `SkillLoader.resolveOntologyContext`（经新的 `resolveOntologyContext` → `resolveOntologyYamlPath`） | 返回 null（新建对话 400 指出条目） |

**不可信判定**（三端一致）：`metadata` 缺失 / 四元组任一为空 / **与所在目录名不一致**。
目录名仍用于拼物理路径，因此二者必须一致（不一致=数据被外部篡改，走改名接口修）。

**写侧保证 metadata 恒新**（本次补齐的两处缺口）：
1. **改名回刷**：`repositories.metadata.refresh_identity_metadata`（只 patch 身份四键，保留 `source_file` /
   `shard_hash` 等历史字段）——本体改名（`routers/ontologies.py` PUT）与**场景改名**
   （`routers/scenarios.py` PUT，按目录物理枚举 `list_ontology_dir_names` 逐个回刷，避免"读身份→刷身份"自锁）后调用；
2. **部署回刷**：`routers/deploy.py` 复制版本存档后调用（存档文件的 metadata 可能是改名前的旧值）。
   新建本体无需额外处理——`routers/ontologies.py` 创建时已 `save_ontology_data` 落 metadata。

**meta.json 职责收窄**：只负责注册（id 分配 / 创建登记 / 存在性判据）与非身份字段
（description / creator / 时间戳）；`list_scenarios`（场景花名册）仍读场景级 meta.json——场景没有 ontology.yaml，
且不属于"本体身份"读取。

**测试**：新增 `core-backend/tests/test_metadata_identity.py`（8 例）、`agent-backend/src/services/skill-loader.test.ts`
（5 例，该函数此前**无测试**）、重写 `mcp-shared/tests/test_loaders.py`（9 例，覆盖"身份取自 metadata 而非
meta.json/目录名"、"缺失/不全/不一致/损坏 → 跳过且不影响其他本体与路由"、"回刷保留历史字段"）。
全套：core **83**、mcp-shared **55**、ontology-mcp **9**、data-engine-mcp **17**、business-mcp **4**、agent **313**。

**E2E 实测**（镜像重建后）：`/tools` 的 scope.const 五键正确；`listOntologies` 四元组 + `deployed_version` 正确；
本体函数调用成功（证明 `get_ontology_names` 走 metadata 且路径解析正确）；行为调用（core→data-engine-mcp）200；
agent 新建对话（走 `resolveOntologyContext`）正例成功并可删、负例（不存在本体名）**400**。

**文档**：`docs/contracts/ontology-yaml.md` 新增 §1「本体身份（metadata）—— 唯一读取来源」；
`docs/contracts/mcp-tools.md` §7 补身份来源口径；`repositories/metadata.py` 模块 docstring 说明职责边界。

**补记（自查发现的实现不一致）**：清单行的 `id` 键原样来自 meta.json（只有 `ontology_id` 被 metadata 覆盖），
而下游（`ontology-mcp` 生成 scope、`get_ontology_names` 路由、core `functions/all` 聚合）读的是 `id` ——
等于"路由用的 id 仍来自 meta.json"，且同一行里 `id` 与 `ontology_id` 可能不一致。已改为
`row["id"] = ident["ontology_id"]`（core 与 mcp-shared 两侧），并加断言锁定（两侧 id 故意不同值时以 yaml 为准）。
**注意 id 的分配权仍在 core 注册表**（扫描 max+1），yaml 是其读取镜像，`refresh_identity_metadata` 以注册表回填。

### 身份读取全链路审计（2026-10-01，承接上一节统一改造）

按要求"从头到尾检查一遍、消除冗余、保持功能正确与语义一致"，对全仓做了穷尽扫描（core / agent / mcp-shared / 三个 MCP 服务 / frontend / scripts），逐条判定并收口：

**1）漏网的读取路径（本次修掉）**

| 位置 | 原状 | 现状 |
|---|---|---|
| `dependencies.get_ontology_names`（**30+ 路由共用**） | `get_ontology_name_by_id` → `get_ontology_by_id` → **meta.json + 目录名** | 改为从 yaml 清单解析（`get_ontology_name_by_id` 重写）；不可信身份等同"不存在"（404），与清单同口径 |
| `routers/threads._resolve_ids`（线程/对话记录 id） | `get_scenario_by_name` + `list_ontologies_by_scenario` 按名匹配 | 改走 `ontology_identity_by_name`（yaml） |
| `routers/chat.py` 生成本体时的 metadata 落盘 | 注释与取值口径写的是 meta.json | 经 `_resolve_ids` → yaml 身份；注释同步 |
| 清单行的 `id` 键 | 来自 meta.json（只有 `ontology_id` 被 metadata 覆盖）→ **路由 id 与身份 id 可能不一致** | `row["id"] = ident["ontology_id"]`（core 与 mcp-shared 两侧），断言锁定 |
| `services.save_ontology_version` | 与 `save_ontology_data` **各写一份相同的 10 行 id 查找逻辑** | 双双收口到新 `_stamp_identity_metadata`（写侧唯一实现） |
| `deploy._finalize_metadata` | 自己查 scenario/ontology id | 经 `registry_ids`（唯一"注册表取 id"实现） |

**2）保留项（各有正当职责，已在文档写明）**

- `list_scenarios`（core 与 mcp-shared）读场景级 meta.json：场景**没有** ontology.yaml，且不属"本体身份"；
- `get_ontology_by_id`（物理定位，改名/删除用）：优先按 yaml 身份 id 命中，**再回退注册表 id**——回退是刻意的，
  保证身份不可信时仍能通过接口改名/删除修复（否则只能手工改文件）。返回的**目录名**只用于拼路径；
- `ontology_fingerprint` 仍纳入 meta.json：它是"本体存在"的注册判据与目录改名触发点（docstring 已说明）；
- ~~技能级 `skills/<技能名>/meta.json`：技能元信息，与本体系身份无关（其 description 双源问题仍在待办）。~~
  → **已删除**，见下节「技能描述单一来源」（读写都收敛到 SKILL.md frontmatter）。

**3）注释/文档同步**：`agent types.ts`（3 处）、`chat-session.ts`、`core chat.py`（2 处）、`threads.py`、
`mcp-shared/__init__.py`、`loaders.py` 章节标题与指纹说明、`repositories/__init__.py`。

**4）契约文档**：`docs/contracts/ontology-yaml.md` 新增"**读取出口（唯一）**"与"**写入侧**"两张表，
明确禁止在其他地方另开读取路径。

**测试**：core **88**（+5：依赖注入口只认 yaml／不可信即不存在／按名取身份／物理定位容忍双写／`registry_ids`）、
mcp-shared **55**、ontology-mcp **9**、data-engine-mcp **17**、business-mcp **4**、agent **313**。

**E2E（5 镜像重建后）**：core 10 条按本体操作的路由（清单/聚合/行为/函数/概念/规则/数据引擎/技能/部署）全 200，
不存在 id → **404**；MCP `listOntologies`（`id == ontology_id`）、函数调用、行为调用（200）正常；
agent 新建对话正例成功可删、不存在本体 → **400**；六端口健康全 200。

### 技能描述单一来源：删除技能级 meta.json（2026-10-01）

**问题**：技能 `description` 有两处表达（`skills/<技能名>/meta.json` 与 `SKILL.md` frontmatter），且**读的人不同**——
core 列表读 meta.json、agent 的 `SkillLoader` 读 frontmatter。后果：① UI「编辑描述」（`PUT .../skills/{name}/meta`）
只改 meta.json，**对 agent 完全不生效**（父 Agent prompt 里仍是旧描述）；② 新增技能时用户填的「技能简介」只写进 meta.json，
**既不进生成 prompt 也不进 SKILL.md**，等于静默丢弃。

**改法**：技能描述**唯一来源 = `SKILL.md` 的 frontmatter**，技能级 meta.json 取消。

| 位置 | 原状 | 现状 |
| :-- | :-- | :-- |
| `GET .../skills`（列表） | 读 `meta.json.description` | 读 frontmatter（`_skill_description`） |
| `PUT .../skills/{name}/meta`（编辑描述） | 写 `meta.json` | **改写 frontmatter 的 description**（只重写头部块，正文与其他字段原样保留）→ 对 agent 立即生效 |
| `POST .../{name}/generate` | 同时写 `meta.json` + `SKILL.md` | 只写 `SKILL.md`；用户填的简介非空则**覆盖写入 frontmatter**（此前完全不生效） |
| 存量数据 | — | 删除 `.data/.../skills/raw-material-inventory/meta.json`（已无读取方；列表改读 frontmatter，值不变） |

**实现细节**：新增 `_skill_frontmatter_block` / `_skill_description` / `_with_skill_description` / `_skill_entry`（纯函数，便于测试）；
序列化统一走新原语 `fs_store.dump_yaml`（与 `write_yaml` 同一格式口径，避免调用方各自 `yaml.safe_dump`）；
`re` 收敛为模块级导入（此前 4 处函数内重复导入）。**API 契约不变**（路径与响应字段不变）→ 前端零改动。

**测试**：新增 `core-backend/tests/test_skills_contract.py`（9 例：描述取自 frontmatter、**遗留 meta.json 不再被读取**、
无 SKILL.md、三类 `format_error` 文案、改写只动 frontmatter、特殊字符往返、非法 frontmatter 返回 None、编辑后列表与 agent 同源）。
core **97 passed**（+9）。

**未改动**：agent 侧 `SkillLoader`（本就只读 frontmatter——正因如此，本次改动才让两端真正同源）。

### MCP 服务端：归属一致性校验（`scope.const.ontology_id` == 顶层 `ontology_id`，2026-10-01）

**问题**：本体执行类工具名是**裸名**（不带本体前缀），服务端此前**只信调用方传入的顶层 `ontology_id`**——
`scope.const.ontology_id`（发布方声明归属）被 `strip_system_params` **只剥不读**、无任何约束力。后果分两类：

- **本体行为**：跨本体重名**可构造**（无全局唯一约束，只有本体内 `ensure_unique` + facade 发布期"记 ERROR + 保留先出现者"）
  → `executor` 按 `(ontology_id, 行为名)` 直接查 yaml，**显式传另一个本体 id 即绕过发布期去重，静默执行那个本体的同名行为**（真写错数据）；
- **本体函数**：函数名设计期**全局唯一**（`_ensure_global_unique`），跨本体重名基本撞不上 → 不会静默执行，但报错是
  `函数 X 不存在于本体 ontology_id=B`（**误导**：真实原因是"X 属于 A，但你指定了 B"），不利于 LLM 纠错。

**触发场景（平台内真实存在）**：父 Agent 把 B 本体的函数/行为写进了 A 本体的子任务——
`createChildAgent` 的挂载过滤**只按名字匹配 `legalCalls`**（本体行为按 `scope.name`、本体函数按工具名），**不按本体过滤**；
本体锁定靠执行时**强制注入子任务的 `context.ontology_id`**（`scopeToOntology`）。两者来源不同 ⇒ 错配可达。

**改法（本轮只做服务端；agent 侧未改）**：

| 位置 | 改动 |
| :-- | :-- |
| `mcp-shared/schema_compile.py` | 新增契约原语 `require_ontology_match()`（归属一致性）+ `owner_label()`（中文报错文案）；docstring 增「④ 归属一致性」 |
| `data-engine-mcp/server.py` | 行为执行前校验：MCP 分支 + REST `/call-behavior`（`entry["ontology_id"]` 即发布期权威归属） |
| `ontology-mcp/server.py` | 新增 `_FUNCTION_CACHE["owners"]`（工具名 → 归属 id + 场景/本体名）；发布循环补**跨本体重名 keep-first + ERROR**（与 facade 同口径，保证 owners 唯一、校验不误拒）；函数执行前校验：MCP 分支 + REST `/execute-function` |

**语义**：`scope.const.ontology_id` 从"建议值"升级为**硬约束**；`declared` 缺失（老数据 / REST 入口缓存未命中）→ 放行不误伤；
数值按整数比较（`1` / `"1"` / `1.0` 等价）；报错文案含**双方 id + 本体中文名/场景**，供调用方（含 LLM）自纠。

**测试**：mcp-shared **59 passed**（+4：三种数值表示 / 不一致报错含双方 id 与中文名 / 声明缺失放行 / `owner_label` 格式）；
data-engine-mcp **22 passed**（+5，桩数据驱动：跨本体重名被拒且**不触达 executor** / 归属一致落到执行器 / 报错文案含真实归属 /
REST 400 / 条目必带 `ontology_id`）；ontology-mcp **13 passed**（+4：归属表与对外 `scope.const` 自锁 / 不一致被拒且**不执行代码** /
一致时放行 / REST 400）；core **97 passed**（未改，无牵连）。

**契约文档**：`docs/contracts/mcp-tools.md` §4 补「归属一致性」条目（四入口同口径 / 放行条件 / 数值等价 / schema 零变化）。

**未做（留待需要时）**：agent 侧**挂载期**校验（`createChildAgent` 比对 `tool.scope.ontology_id` 与 `context.ontology_id`）——
服务端校验是**执行期兜底**（发现晚、但覆盖外部调用方），挂载期才是"抓 LLM 规划错配"的最佳位置（规划回合内即可自纠）。

### MCP 服务端审计：语义收口与冗余删除（2026-10-01）

**范围**：`mcp-shared` / `ontology-mcp` / `data-engine-mcp` / `business-mcp` 全量代码 + core 侧 MCP 相关残留。
**方法**：逐文件通读 + pyflakes（F 类）静态扫描 + 全仓消费方检索 + 现有测试回归。

**1）删除跨服务重复实现（同一语义两处表达）**

| 删除物 | 为什么 |
| :-- | :-- |
| `core-backend/services/params_schema.py`（141 行） | 与 `mcp-shared/schema_compile.py` 编译段逐字重复（仅 pydantic / plain dict 之差异），其 docstring 自述"逐字对应"——两份实现必然漂移 |
| `GET /api/ontologies/functions/all`、`GET /api/ontologies/behaviors/all` | 唯二消费该编译器的端点；**全仓无消费方**（前端走 MCP 服务 `/tools`、agent 直连 MCP、脚本与测试均不调）；`behaviors/all` 还带着已废弃的 `onto{ontology_id}__` 前缀消歧命名，与契约 §⑤"裸名 + 保留先出现者 + **不做前缀消歧**"**直接冲突**（facade 已于 2026-10-01 删除该前缀逻辑） |

删除后 `schema_compile.py` 成为编译契约的**唯一实现**（docstring 同步声明）；core"执行归零、消灭双路径"（架构文档 §十一）由此补齐。

**2）统一入口口径：REST 与 MCP 同剥系统参数**

审计发现：MCP 入口三处都 `strip_system_params`，而 REST 入口三处**都没剥**（`/execute-function`、`/execute-common-function`、`/call-behavior`）——同一服务两条入口两种语义。已统一（REST 补剥）。
**`/call-engine` 有意不剥**并加注释：引擎 params 是用户自定义字段，剥了会误删真名为 `scope` / `ontology_id` 的引擎参数。

**3）统一「查不到」返回形态**

`ontology-mcp` 查询工具此前有三种空表达：关键词无匹配 → `{"message","results":[]}`；概念不存在 → `{"error":true,"message"}`；概念无关联关系 → `[]`。统一为 `_not_found(message)` 单一形态（未加过滤的空集合仍原样返回列表——区分"集合为空"与"过滤无匹配/目标不存在"）。

**4）让"记冲突警告"真正落地**

`params_to_input_schema` 返回的约束冲突（同名属性约束不一致、已取先扫到的）在两个发布端**算出来即被丢弃**（`_conflicts`），违反其自身 docstring 的"记冲突警告"。现两侧均 `logger.warning` 留痕（`ontology-mcp` 函数工具、`data-engine-mcp` 行为工具）。

**5）删除死代码**

- `ontology-mcp`：`_ontology_or_error`（`_load_ontology_or_error` 的薄包装，仅一处调用）→ 内联；
- `core-backend/routers/deploy.py`：5 个死导入（`Optional` / `save_ontology_data` / `split_yaml_top_sections` / `_get_ontology_dir` / `_find_thread`）；
- `core-backend/routers/processes.py`：`HTTPException` 死导入；
- **pyflakes 复扫：MCP 四目录 F 类告警 0**（core 余下 `routers/__init__.py` 的 F401 是 barrel 再导出的误报——main.py 从 `routers` 导入；`chat.py` / `rules.py` 的 F541 为风格项，非冗余）。

**未改（有意保留）**：三处旧数据读时兼容（`ontology-mcp._rule_behavior` / `facade._behavior_concept_names` / agent `ontology-gateway`）——针对**不同字段**且删掉会破坏存量 yaml；`business-mcp` 的强制 `outputSchema` 契约（外部形态，架构文档 §九）；三服务内部层次（协议层 / 业务层 / 数据层）与单文件行数（最大 316 行 < 500，章程 FR-010 ✓）。

**测试**：core **97** / mcp-shared **59** / ontology-mcp **16**（+3）/ data-engine-mcp **24**（+2）全绿；新增用例锁定 REST 剥离口径、引擎入口有意不剥、「查不到」统一形态。

### MCP 命名语义对齐：模块/常量/变量更名（2026-10-02）

**动机**：名字必须说它真正在做的事；同一东西不允许两个名字。判据三条 —— ①名字与语义不符 ②同一物多名字 ③名字过泛/半覆盖。

**A 档｜名字与语义不符（会误导）**

| 原名 | 新名 | 为什么 |
| :-- | :-- | :-- |
| `mcp-shared/sandbox.py` | `mcp-shared/function_runner.py` | 模块**自己**写着"这是可信插件执行、**不是安全沙箱**"，名字却承诺隔离 → 读代码/做安全审计会误判边界 |
| `loaders.ontology_fingerprint()` | `data_store.ontology_market_fingerprint()` | 无参、实为"全体本体文件的变更指纹"，名字让人以为要传某个本体 |
| `ontology-mcp._FIXED_TOOLS` | `_QUERY_TOOLS` | 该类别的权威名是「本体查询」（`CATEGORY_QUERY`/`_QUERY_TOOL_SPECS`），"fixed" 零信息量 |
| `_COMMON_CACHE["mtime"]` vs `_FUNCTION_CACHE["fingerprint"]` | 统一 `fingerprint` | 同一语义（缓存失效指纹）两个字段名 |
| `_get_common_tools()` | `_load_common_tools()` | 与 `_load_function_tools()` 同角色，动词统一 |
| `require_ontology_match(declared, requested, …, declared_label)` + `owner_label()` | 参数 → `declared_owner` / `requested_owner` / `owner_label` | 同一物两个名字；前两参点明"归属方" |

**B 档｜名字过泛/半覆盖（文件更名）**

| 原名 | 新名 | 为什么 |
| :-- | :-- | :-- |
| `mcp-shared/schema_compile.py` | `tool_contract.py` | 内容 = 发布/调用**契约**（分类、scope、系统参数、归属一致性）+ 编译器；而它是"契约唯一权威"，旧名只说后半 |
| `data-engine-mcp/facade.py` | `behavior_tools.py` | `facade` 是设计模式名、无领域含义；实际职责 = 把本体行为发布成一等 MCP 工具 |
| `mcp-shared/loaders.py` | `data_store.py` | "loaders"（加载什么？）→ 运行面唯一数据源读取层 |
| `mcp-shared/mcp_base.py` | `mcp_app.py` | 含糊 → 协议骨架 app 工厂（`build_mcp_app`） |

**C 档｜局部命名**

`g → fn`（ontology-mcp 函数查找，与发布循环统一）｜ `de → engine`（executor 14 处，与 `engine_name`/`execute_engine` 统一）｜ `sc_name, on_name`（未使用）→ `_sc, _on`｜ `_entry → entry`（data-engine REST 与 MCP 入口统一）｜ `e/b → entry/behavior`（behavior_tools）｜测试桩 `_patch_loaders → _stub_data_store`。

**引用面同步（一处不漏）**：9 个文件 `git mv`（保留历史）；`data-engine-mcp/Dockerfile` 的 **COPY 路径**（不改会构建失败）；3 服务的 import 与调用点；4 套测试（含 import、桩目标、测试名）；`docker-compose.yml`/Dockerfile 注释；`core-backend/services/__init__.py` 注释；契约文档 2 份 + 架构文档 §一/§二/§三/§四（含架构图与目录树）；agent 侧 5 处**注释**里的模块路径；`skill_generate` 提示词去掉内部术语 `facade`（语义不变，更利于 LLM 理解）。

**有意保留（非漏改）**：`mcp-shared/__init__.py` 与各模块 docstring 里的"更名记录"（loaders→data_store 等）；架构文档 §十三/§十七/§十八的**历史阶段记录**。

**已继续收口（2026-10-02 同日，按用户要求）**：
- agent 侧 24 处 **"facade 化"历史术语 → "行为工具化"**（含 mock 描述与断言 `toContain('本体行为工具')` 同步）；
- `agent-backend/scripts/e2e-facade-behaviors.py` → **`e2e-behavior-tools.py`**（符合 `e2e-*` 命名惯例），`.claude/settings.json` 权限条目同步；E2E 线程标题 `facade-E2E` → `behavior-tools-E2E`。
- 结果：**全仓（排除历史 spec/架构阶段记录/更名记录）`facade` 出现 0 次**；agent 侧 dist 不含注释，故无需重建 agent 镜像。

**测试**：mcp-shared **59** / ontology-mcp **16** / data-engine-mcp **24** / business-mcp **4** / core **97** 全绿；pyflakes F 类告警 **0**。
（过程中测试探针抓到 1 处漏改 —— `test_behavior_tools.py` 里 bare `facade`，已修。）

### 行为就绪发布：未就绪的行为不发布为工具（2026-10-02）

**问题**：行为工具此前是**无条件发布**的——`behaviors[]` 里有 `name` 就进工具清单，从不检查有没有映射。
实测本仓数据：**发布 33 个行为工具，其中 25 个未绑定数据引擎**（「订单排程」14/14、「货品BOM及工艺」11/11 全部未映射，
「原材料采购和库存」8/8 已映射）——即 **76% 的已发布工具是"死承诺"**：LLM 会在清单里看到、规划它、调用它，
然后拿到 `该行为未绑定数据引擎` 并计入报错预算。且 MCP 路径上"设计未完成"与"执行失败"被抹平成同一信号
（都是 `isError`，只差一句中文前缀），调用方无法从反馈里判断"是环境/下游问题"还是"这个能力根本还没做"。

**改法**：**未就绪即不发布**（工具清单 = 对 LLM 的可调用承诺），三处同口径：

| 位置 | 原状 | 现状 |
|---|---|---|
| `mcp-shared/tool_contract.py` | 无"就绪"概念 | 新增契约 **⑥ 就绪发布** + `is_engine_ready` / `ready_behavior_names`（判据唯一权威） |
| 发布面 `data-engine-mcp/behavior_tools.py` | 全量发布 | 只发布就绪行为；未就绪者剔出 `/tools` 与路由，按本体记一条 WARNING；新增 `unready_behavior()` 供调用期报错 |
| 调用端 `data-engine-mcp/server.py` | 未就绪 → `未知工具` | 专用报错 `行为 X 尚未就绪：未完成数据引擎映射，未发布为工具（本体「Y」）`，与"未知工具"分开 |
| 规划面 `agent-backend`（gateway / plan-validation / plan-gate） | `validateBehaviorNames` 按**全量花名册**放行 | 新增 `getReadyBehaviorNames`（同一判据），规划闸**只放行就绪行为**；`missing`（未声明）与 `notReady`（已声明未就绪）分开报，nudge 给"改用就绪行为 / 如实告知用户该能力尚未配置"的出口 |

**就绪判据（两侧同源，勿单边改动）**：`data_engines[]` 中存在 `behavior_name` 匹配的条目 + `engine_type` 缺省或 `MCP`
+ `target.server_url` 与 `target.tool_name` 均非空白。后两条与 agent 侧 `visibility-guard` 的收编口径同源
——半成品映射（有引擎行、没配全 target）不算就绪：executor 对它也只会在调用期报配置错误。

**为什么规划面必须一起改**（本轮唯一超出"最小改动"的部分，但属必要）：行为名校验读的是 **core 本体数据**
（`gateway.getBehaviorNames`），挂载读的是 **MCP 已发布工具**——两者来源不同。只改发布面会造成
"**父 Agent 能合法规划、子 Agent 挂不上任何工具**"，子任务只能以"工具不存在 / 连续报错"含糊失败，
比改前的明确报错更糟；而本体 2/4 全部未映射，这是马上会撞上的真实路径。

**测试**：mcp-shared **62**（+3 就绪判据）/ data-engine-mcp **27**（+3 发布过滤与专用报错）/ ontology-mcp 16 / core 97 全绿；
agent-backend `tsc` 净 + vitest **320 passed（24 files）**（新增规划面 3 例 + 网关 4 例）；测试桩同步（端口新增必需方法，5 处 fake 补齐）。

**同日补做（用户要求）**：`listOntoBehaviors` 查询工具**改为只列就绪行为**——至此**四处同源**
（发布面剔除 / 调用端专用报错 / 规划闸拒绝 / 查询面不列），父 Agent 不再有机会"先规划未就绪行为、被驳回一次再改"，
省掉那一轮；工具描述同步写明"只列已就绪行为"。**core `/api/ontologies/{id}/data` 与设计器 UI 仍列全部行为**
（设计期花名册视角：未就绪只是"不可规划/不可调用"，不是"不存在"）。
ontology-mcp 测试 16 → **18**（+2：只列就绪 / 全未就绪时清单为空）。

**未改动（有意）**：本体函数侧无就绪概念（函数不依赖映射）。

### 父 Agent 工具改名：listAllMcpFunctions → listPlannableFunctions（2026-10-02）

**动机（用户提出改名，我给的判断）**：原名有三处不准，越用越误导——

1. `All` 是假的：它**按对话所选本体过滤**（实测：只选「订单排程」时本体函数 6 → **0** 条），不是全量；
2. `McpFunctions` 边界错：清单**含外部 MCP 工具**（不是"函数"）、**不含本体行为**（而行为正是 MCP 工具）、也不含本体查询（同为 MCP 工具）；
3. 提议的 `listAllAvailMcpFunctions` **未采用**：`Avail` 是缩写（与仓库刚做完的缩写清理 `facade→behavior_tools` / `sandbox→function_runner` 方向相反），
   且 `All`+`Avail` 语义打架；`Available` 一类词还容易被模型误解为"我可以调用"——实际它**只能规划**（写进子任务的 `function` / `related_functions`）。

**定名 `listPlannableFunctions`**：`Plannable` 精确表达"只规划、不执行"的定位；`Functions` 与子任务字段口径一致（`function` / `related_functions` 本就允许填函数或外部工具）。

**改动面（13 文件 / 37 处，纯改名、零语义变化）**：

| 类 | 文件 |
|---|---|
| 定义 | `agent-factory.ts`（工具名 + label + 私有方法 `createListAllMcpFunctionsTool` → `createListPlannableFunctionsTool` + 注释） |
| **LLM 提示词（必须同步，否则 LLM 按旧名调 → 工具不存在）** | `prompts.ts`（工具表 + 步骤 3）、`subtask-contract.ts`（`function` / `params` / `related_functions` 三处字段说明） |
| 注释与文档 | `orchestrator.ts`、`types.ts`、`agent-ports.ts`、`common-functions.ts`、`docs/contracts/mcp-tools.md`（§3/§7）、`mcp-shared/tool_contract.py` |
| 测试与脚本 | `agent-factory.test.ts`、`orchestrator.test.ts`、`scripts/probe-catalog.ts` |

**对外零影响**：它不是发布到 MCP 面的工具（外部消费方看不到），前端 / core 均不引用 → **不是契约变更**。
`mcp-shared/tool_contract.py` 只改了 docstring 的一处引用，**3 个 MCP 镜像无需重建**（镜像内副本仅该句注释不同，行为一致）；agent 镜像需重建（名字进 dist 与提示词）。

**验证**：全仓旧名残留 **0**；`tsc` 净 + vitest **320 passed（24 files）** 全绿。
**注意**：正在进行的旧对话，其历史里若出现过旧工具名，LLM 可能按旧名调一次（报错自纠，多一轮）——重建后建议开新对话验证。

### 存量本体数据一致性清理（2026-10-02）

按用户要求「冗余或不存在的删除、与当前本体设计保持一致」，对 `.data/onto_market` 四个本体做了全量审计 + 修复：

**审计脚本覆盖**（一次性临时脚本，未落盘）：metadata 身份四元组 vs 目录名、遗留字段（`rule_type`/`check_functions`/`related_behaviors`/条件树/字符串 `constraint`）、关系端点与端点属性悬空、
`relation_type` 值域与 symmetric/asymmetric 互斥、行为关联概念与 from/to 状态越界、`op_type` 值域、行为参数口径、
规则绑定行为/关联函数（本体∪公共 7 个）/data_supplements、函数 `type` 值域与代码文件双向对账、
引擎 `behavior_name` 与 `target.server_url/tool_name` 就绪判据、securities 花名册行为名。

**修复**：
- 订单排程 14 行为：`op_type: ''` 按语义补齐（Query* 4 条 → `query`；创建/更新/删除/排产/下发/撤回/轮询 10 条 → `command`）；
  22 处参数旧标量简写（`orderId: string` 等）→ 对象形态 `{type, description: ''}`；7 处对象参数补 `description: ''`。
- 货品BOM及工艺 11 行为：`op_type: ''` → 全部 `query`（均为 Query*）；17 处标量简写 → 对象形态；2 处补 `description: ''`。
- 原材料采购和库存 / 资源（人员和设备）：审计零问题（前者此前已完成规范化；后者为空骨架本体）。
- 删除 `functions/__pycache__/` 冗余产物；还原两个仅行尾变化的 `securities.yaml`（消除 diff 噪音）。

**说明**：标量简写参数若行为将来绑定引擎发布，`param_spec_to_schema` 会对字符串 spec 抛错——本次迁移消除了该 latent 缺陷；
`op_type` 补齐使写行为进入安全确认/串行调度口径（契约 §3），与「写行为必须显式 command」的设计一致。

**验证**：审计脚本复跑 **零问题**；core `pytest` **97 passed**；agent `ontology-gateway.test.ts` **22 passed**。

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
