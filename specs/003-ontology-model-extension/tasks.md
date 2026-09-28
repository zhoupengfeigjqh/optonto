# 任务清单：本体模型扩展（关系类型 / 生命周期状态 / 术语集 / 函数类型 / 行为状态跃迁 / 规则结构增强）

**特性分支**: `003-ontology-model-extension` · **规范**: [spec.md](./spec.md) · **计划**: [plan.md](./plan.md)

> 说明：本特性在**现有代码上增量扩展**，新字段一律可选且有默认值，对外接口路径不变。
> 决策依据：用户答复 D1–D8 / P1–P3（见 [spec.md](./spec.md) 假设）。
> 校验归属铁律：**值域类 → Pydantic validator（静默归一，不报错）；跨字段强耦合 → 业务层 `InvalidInputError` → 400**。
> （不可放 Pydantic：请求体校验失败经 `main.py:115` 返回 422，会造成 400/422 契约分裂）

## 阶段 1：纯字段扩展（用户故事 1，P1）待开始

### 关系类型

- [ ] T101 `core-backend/schemas/__init__.py`：`RelationItem` 新增 `relation_type: list[str]`（默认 `[]`）；
  validator 过滤 `{asymmetric, symmetric, transitive, functional, inverse_functional}` 之外的值
- [ ] T102 `.data/templates/onto_template.yaml` relations 段（现 L29-37）新增 `relation_type`
- [ ] T103 `frontend/src/api/design.ts:51-60`：`Relation` 接口加 `relation_type?: string[]`
- [ ] T104 `frontend/src/components/Design/RelationTable.tsx`：新增「关系类型」列（多选下拉；
  symmetric 与 asymmetric 前端互斥提示），列宽与既有列平衡
- [ ] T105 `core-backend/prompts.py` 阶段 3（现 L95）：每条关系需提供项增加「关系类型（可多选）」

### 概念术语集

- [ ] T106 `schemas/__init__.py`：`ConceptItem` 新增 `terms: list[str]`（默认 `[]`）；
  validator 去重 / 去空串 / 去首尾空白
- [ ] T107 `.data/templates/onto_template.yaml` concepts 段（现 L9-28）在 `display_name` / `instance_label` 邻位加 `terms`
- [ ] T108 `frontend/src/api/design.ts:26-32`：`Concept` 加 `terms?: string[]`
- [ ] T109 `frontend/src/components/Design/ConceptTable.tsx`：新增「术语集」列 + 编辑（与实例标签相邻），展示为 Tag 列表
- [ ] T110 `prompts.py` 阶段 2A（现 L71）：概念每项增加「术语集（该概念的其他表述，可多个）」

### 函数类型

- [ ] T111 `schemas/__init__.py`：`FunctionItem` 新增 `type: str`（默认 `""`）；
  validator 将 5 值域（`TRANSFORMATION` / `CALCULATION` / `DERIVATION` / `VALIDATION` / `MODEL`）外的值归一为 `""`
- [ ] T112 `.data/templates/onto_template.yaml` functions 段（现 L38-89）新增 `type`
- [ ] T113 `frontend/src/api/design.ts:76-84`：`Function` 加 `type?: string`
- [ ] T114 `frontend/src/components/Design/FunctionTable.tsx`：新增「函数类型」列（单选下拉；公共函数行显示 `-`）
- [ ] T115 `prompts.py:159` 阶段 5A：函数 5 类从「自然语言分类」改为「必须落盘 `type` 英文码」，
  且措辞统一为【指标计算】CALCULATION

### 测试与验收

- [ ] T116 后端用例：三字段「落盘↔回读」往返；非法关系类型 / 函数类型被丢弃且**保存仍成功**（不阻断）
- [ ] T117 前端用例：三表格新增字段的渲染与编辑
- [ ] T118 端到端：临时本体 → 填三字段 → 回读 → 检查落盘 YAML 结构 → 清理

## 阶段 2：生命周期状态 + 行为跃迁（用户故事 2，P2）待开始

### 权威模型

- [ ] T201 `schemas/__init__.py`：`BehaviorItem.related_concepts: list[str]` → `concept: str`（默认 `""`）；
  加 `model_validator(mode='before')` 兼容旧数组（取唯一元素，无损迁移）
- [ ] T202 `schemas/__init__.py`：`BehaviorItem` 新增 `from_status: str = ""`、`to_status: str = ""`
- [ ] T203 `schemas/__init__.py`：`RuleItem.related_behaviors: list[str]` → `behavior: str`（默认 `""`）；
      加 `model_validator(mode='before')` 兼容旧数组（取唯一元素；含多元素时取首个并记 warning，实测不存在）

### 业务层校验（新增）

- [ ] T204 `core-backend/services/validators.py`（新建）：
  - `validate_status_attribute(attributes)`：至多一个 `name == 'status'`；若存在则 `type == 'string'` 且 `constraint.enum` 非空
  - `validate_behavior_status(behavior, concepts)`：`concept` 必须命中某概念；`from/to` 非空时须落在该概念 `status` 属性的 `constraint.enum` 内
  - `validate_self_requires_behavior(rule, behaviors)`：`rule_detail`（含嵌套树）中出现 `type: self` 操作数时，
      规则的 `behavior` 必须非空且命中该本体行为
  - 三者失败一律抛 `errors.InvalidInputError`（→ 400 统一错误体）
- [ ] T205 路由接入：`routers/concepts.py`（PUT `/…/attributes`）、`routers/behaviors.py`（POST/PUT）、
  `routers/rules.py`（POST/PUT）

### 行为侧消费点适配（`related_concepts` → `concept`，共 14 处）

- [ ] T206 `routers/concepts.py:75-78`：删除概念时把引用它的行为的 `concept` 清空（原为从数组移除）
- [ ] T207 `routers/ontologies.py:88`：`_related_concepts(data, [b.concept] if b.concept else [])`
      （行为 params 的 inputSchema 约束回溯；`_related_concepts` 签名不变）
- [ ] T208 `routers/rules.py:96`：`[c for c in data.concepts if c.name == beh.concept]`
- [ ] T209 `agent-backend/src/services/ontology-gateway.ts:116`：
      `resolveConcepts(data, behavior?.concept ? [behavior.concept] : [])`
- [ ] T210 `data-engine-mcp/facade.py:36`：改传 `[b.get("concept")]`（`mcp-shared/schema_compile.py:143` 签名保持 `list[str]`）
- [ ] T211 `agent-backend/scripts/e2e-prerule-trace-gate.py:62`：多概念 fixture 改单概念

### 规则侧消费点适配（`related_behaviors` → `behavior`）

- [ ] T211a `core-backend/routers/rules.py:84,92`：`generate_rule` 改读标量 `body.get("behavior", "")`
      （原 `related_behaviors = body.get("related_behaviors", [])` 与 `for bname in related_behaviors` 循环 → 单值）
- [ ] T211b `frontend/src/api/design.ts:143`：`Rule.related_behaviors: string[]` → `behavior: string`
- [ ] T211c `frontend/src/components/Design/RuleTable.tsx`（L54 / L72 / L94 / L95 / L102 / L161 / L311 / L336 /
      L358 / L375 / L432 / L452 / L461，共 13 处）：关联行为改单选 + 字段引用适配
- [ ] T211d `frontend/src/components/View/OntologyGraph.tsx:140-141`：`forEach` → 单值判断
- [ ] T211e `agent-backend/src/types.ts:119`：`RuleDetail.related_behaviors: string[]` → `behavior: string`
- [ ] T211f `agent-backend/src/services/ontology-gateway.ts:96,104,107`：投影与前置/后置规则筛选改标量比较
- [ ] T211g `ontology-mcp/server.py:249,256`：`b.get("name") in (r.get("related_behaviors") or [])`
      → `r.get("behavior") == b.get("name")`，注释同步
- [ ] T211h `agent-backend/src/agent/execution-policy.test.ts`（5 处）与 `subtask-runner.test.ts`（6 处）：
      测试 fixture 的 `related_behaviors: [...]` 改标量

### 前端

- [ ] T212 `frontend/src/api/design.ts:116-124`：`Behavior.related_concepts: string[]` → `concept: string`；
      新增 `from_status?: string`、`to_status?: string`
- [ ] T213 `frontend/src/components/Design/BehaviorTable.tsx`（L36 / L49 / L69 / L104 / L109 / L119）：
      关联概念改单选；新增「源状态 / 目标状态」两个下拉（选项 = 所选概念的 `status` 属性 `constraint.enum`；
      所选概念无 status 属性时禁用并提示）
- [ ] T214 标量适配：`frontend/src/components/Design/RuleTable.tsx:69,:162`、
      `frontend/src/components/View/InstanceGraph.tsx:92`、`frontend/src/components/View/OntologyGraph.tsx:116`
- [ ] T215 `frontend/src/components/Design/ConceptTable.tsx`：属性弹窗中对 `name == 'status'` 的属性给出
      「生命周期状态」标记与「枚举值必填」提示（不阻断保存）

### 模板与提示词

- [ ] T216 `.data/templates/onto_template.yaml`：behaviors 段（现 L90-195）`related_concepts` 改 `concept`、
      新增 `from_status` / `to_status`；rules 段（现 L196-205）`related_behaviors` 改 `behavior`
- [ ] T217 `prompts.py`：阶段 2B 要求 4（现 L84）改为「概念必须有一个 `name=status` 的属性，`type=string`，
      枚举值通过 `constraint.enum` 表达」；阶段 4 要求 3（现 L121）补「行为只关联一个概念（`concept`）」，
      并新增「command 行为须声明 from_status/to_status（取自该概念 status 枚举）」

### 测试与验收

- [ ] T218 后端用例：status 属性非法（非 string / 枚举为空）→ 400；from/to 越界 → 400；from/to 为空 → 通过；
      旧 `related_concepts:[x]` 与旧 `related_behaviors:[x]` 均无损迁移；规则使用 `self` 但未绑定行为 → 400
- [ ] T219 前端用例：`BehaviorTable` 单选 + 状态下拉（含「所选概念无 status 属性」分支）
- [ ] T220 端到端：**新建**含 `status` 枚举的临时本体 → 配 Cancel/Receive 跃迁 → 越界 400 →
      存量本体回归加载 → 清理

## 阶段 3：`RuleTable.tsx` 前置重构（纯重构，行为不变）待开始

- [ ] T301 先补测：条件构建（`buildStorageConditions`）、`data_supplements` 自动推导、候选收窄的纯逻辑用例
- [ ] T302 抽出条件构建 / 推导 / 候选收窄逻辑到独立模块（`frontend/src/components/Design/rule/`），
      主表只留渲染与状态
- [ ] T303 回归：前端测试全绿、覆盖率门槛不降、`RuleTable.tsx` ≤ 500 行（为阶段 4/5 留余量）

## 阶段 4：规则「实体自身」（用户故事 3，P3）待开始

- [ ] T401 `.data/templates/rule_template/validation/compare_rule.json` 与
      `.../inference/inference_rule.json`：操作数 `type` enum 加 `self`（左右均加）；
      `allOf` 增约束（`self` → `attribute` 必填、`concept` 不需要）
- [ ] T402 `frontend/src/components/Design/rule/rule-operands.ts:148-158`：
      `OPERAND_TYPE_OPTIONS_LEFT/RIGHT` 加「实体自身」；新增「按主体概念解析属性候选」的纯函数
- [ ] T403 `frontend/src/components/Design/rule/RuleEditors.tsx:10-49`：`OperandEditor` 支持 `self`（只显示属性下拉）
- [ ] T404 `RuleTable.tsx`：候选收窄支持 `self`（规则 → 唯一关联行为 → 主体概念）
- [ ] T405 `prompts.py:592-597`：`RULE_GENERATE_PROMPT` 操作数说明加 `self`
      （语义：所属行为的唯一主体概念的实例）
- [ ] T406 用例：`self` 往返一致；模板 enum 与前端选项逐项一致
- [ ] T407 端到端：规则配 `self.status == '待入库'` 往返

## 阶段 5：规则「与/或/非」嵌套（用户故事 4，P4）待开始

- [ ] T501 规则模板 ×2：改递归 Schema（`children` 自引用；`not` 的 `children` 加 `maxItems: 1`）
- [ ] T502 `rule-operands.ts:124-144`：`storageToEditing` 递归 + 旧扁平 → 树迁移
- [ ] T503 `RuleEditors.tsx:54-93`：递归组合节点编辑器（切换 and/or/not、增删子节点、嵌套缩进；
      `not` 限 1 子节点）
- [ ] T504 `RuleTable.tsx`：`buildStorageConditions`、`collectRuleRefs`、`data_supplements` 推导、
      候选收窄四处适配树
- [ ] T505 `agent-backend/src/agent/subtask-runner.ts:342-380`：`rule_detail` 序列化改缩进（保留层级）
- [ ] T506 `prompts.py:599-606`：示例改树形 + 与/或/非说明
- [ ] T507 `frontend/src/components/Design/rule/rule-operands.test.ts` 重写：
      树遍历 / 旧格式迁移 / `not` 单子节点 / 三层嵌套
- [ ] T508 端到端：老扁平规则打开为树 → 保存为树 → 回读一致；运行期投喂 LLM 的文本层级可读

## 阶段 6：跨切面收口 待开始

- [ ] T601 5 份副本字段清单逐项核对：`core-backend/schemas/__init__.py`（权威）/ `frontend/src/api/design.ts` /
      `agent-backend/src/types.ts` / `.data/templates/onto_template.yaml` / `core-backend/prompts.py`
      - `agent-backend/src/types.ts:119` 本轮**需要**变更（`RuleDetail.related_behaviors: string[]` → `behavior: string`，
        对应 T211e）；其余新字段（`terms` / `relation_type` / 函数 `type` / 状态属性 / `from_status` / `to_status`）
        因 `ontology-gateway` 未投影，本轮无需透传到 agent 侧（若将来要让 agent 消费术语集，需另行扩展 gateway）
- [ ] T602 历史版本快照加载回归：`ontology_versions/v1.0` 与 `v1.1`
      （`GET /api/ontologies/{id}/deploy/version-preview?version=v1.0`），确认新字段未破坏 `read_yaml_strict`
- [ ] T603 `prompts.py` 行数处置：现 650 行，已超 002 的 FR-010/SC-006「后端源文件 ≤500 行」阈值，
      本轮同步提示词会继续增长 → 拆 `prompts/` 包 或 明确豁免（需裁决）
- [ ] T604 全量回归：`pytest`（core + data-engine + business-mcp）+ `vitest --coverage`（门槛不降）+
      `tsc --noEmit` + `compileall`
- [ ] T605 容器重建 + 全链路端到端（core → data-engine-mcp → business-mcp → Java）+ 临时数据清理

## 验收记录

（实施后填写）

## 明确不做（避免误勾）

- 函数返回类型 `return_type`（用户 D7 决定不做）
- 权限按角色 / `SecurityItem.scope` 相关改造（用户 D2 决定不做）
- 关系类型与 `cardinality` 的一致性校验、关系类型的推理语义
- 存量 `type: enum` 属性的规范化（`CustomerOrder.status` / `orderType`）
