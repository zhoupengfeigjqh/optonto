# 功能规范：本体模型扩展（关系类型 / 生命周期状态 / 术语集 / 函数类型 / 行为状态跃迁 / 规则结构增强）

**特性分支**: `003-ontology-model-extension`

**创建日期**: 2026-09-28

**状态**: 草稿

**输入**: 用户提出的 8 项本体模型扩展需求，及决策回合答复（D1–D8 / P1–P3）

## 用户场景与测试 *（必填）*

### 用户故事 1 - 本体语义表达更完整（关系类型 / 概念术语集 / 函数类型）（优先级：P1）

作为本体设计者，我希望关系的附加特征（对称/传递/函数性等）、概念的其他表述（术语集）、函数的业务分类都能登记进本体，
这样这些语义不再只存在于文档和提示词里，而是可被平台与 LLM 稳定读取。

**优先级理由**：三项均为纯字段扩展，无结构变更、无跨模块联动风险，可独立交付。

**独立验证**：建/改关系、概念、函数时填写新字段，保存后回读一致，落盘 YAML 含新字段。

**验收场景**：

1. **Given** 一条关系，**When** 勾选「对称 + 传递」，**Then** 保存并回读得到两个类型值；**When** 提交集合外的类型值，**Then** 该值被丢弃、保存仍然成功（不阻断）。
2. **Given** 一个概念，**When** 填写术语集 `["采购单","采购订单","PO"]`，**Then** 保存回读一致；提交含重复项/空串/首尾空白的术语集，**Then** 自动去重去空。
3. **Given** 一个本体函数，**When** 选择类型 `VALIDATION`，**Then** 保存回读一致；公共函数行的类型列显示 `-`。

---

### 用户故事 2 - 概念的生命周期状态与行为的状态跃迁（优先级：P2）

作为本体设计者，我希望概念有一个 `status` 属性（string，枚举即生命周期状态），写入行为能声明「从哪个状态跃迁到哪个状态」，
且二者强耦合——这样"取消采购单""入库"这类行为的语义不再只是一句描述，而是可校验的状态机跃迁。

**优先级理由**：涉及跨字段强耦合校验与既有契约收缩（行为关联概念改标量），影响面大于 P1，但价值高。

**独立验证**：为概念配置 `status` 属性（`type=string`、`constraint.enum` 非空），再为 command 行为声明 from/to；越界时返回 400。

**验收场景**：

1. **Given** 概念 `PurchaseRecord` 含 `status` 属性（string，枚举 `待入库/已入库/已取消`），**When** 为 `CancelPurchaseRecord` 配置 `from_status=待入库`、`to_status=已取消`，**Then** 保存成功、回读一致。
2. **Given** 同上，**When** 配置 `to_status=不存在的状态`，**Then** 返回 400 且错误体为统一结构 `{code,message,detail}`。
3. **Given** 某概念没有 `status` 属性，**When** 为其行为配置 from/to，**Then** 返回 400。
4. **Given** 存量行为（未声明 from/to），**When** 读取与保存，**Then** 跳过状态校验、照常工作（兼容）。
5. **Given** 存量数据 `related_concepts: [PurchaseRecord]`，**When** 加载，**Then** 无损迁移为标量 `concept: PurchaseRecord`。

---

### 用户故事 3 - 规则可用「实体自身」表达（优先级：P3）

作为规则设计者，我希望条件左侧能直接引用"被操作对象自身的属性"，不必重复选择概念，
这样规则对本体的引用更自然，也不容易选错概念。

**优先级理由**：依赖 P2 的「行为唯一主体概念」落地，故排在 P2 之后。

**独立验证**：规则条件左侧可选「实体自身」并从中选属性；保存回读一致。

**验收场景**：

1. **Given** 一条规则关联行为 `CancelPurchaseRecord`（主体概念 `PurchaseRecord`），**When** 左侧选「实体自身」+ 属性 `status`，**Then** 落盘为 `{"type":"self","attribute":"status"}` 并回读一致。
2. **Given** 一条未绑定行为的规则，**When** 其 `rule_detail` 使用「实体自身」并保存，**Then** 返回 400（`self` 无从确定指代）；**When** 先绑定行为再保存，**Then** 成功。

---

### 用户故事 4 - 规则条件支持与/或/非任意嵌套（优先级：P4）

作为规则设计者，我希望条件能用「与/或/非」组合并任意嵌套（如 `(A 且 B) 或 非(C)`），
这样复杂业务判断不必被拆成多条规则、或退化成一句自然语言描述。

**优先级理由**：结构破坏性变更，模板 Schema、前端编辑器、提示词、运行期序列化四处联动，风险最高，故最后做。

**独立验证**：老扁平规则打开后呈现为树、可加嵌套组与「非」、保存后回读一致。

**验收场景**：

1. **Given** 旧格式规则 `{if:{logic:'and', conditions:[…]}}`，**When** 打开设计器，**Then** 呈现为一个 `and` 组含 N 个叶子；保存后落盘为 `{if:{logic:'and', children:[…]}}`。
2. **Given** 编辑器，**When** 新增「非」组，**Then** `not` 组只允许 1 个子节点，尝试添加第 2 个被阻止。
3. **Given** 嵌套 3 层的条件树，**When** 保存并回读，**Then** 结构与层级完全一致。
4. **Given** 一条含嵌套的规则，**When** 运行期投喂给 LLM，**Then** 文本保留层级缩进（非单行压缩 JSON）。

---

### 边界情况

- **存量数据**：6 个概念中 5 个无 `status` 属性；唯一具备者（`CustomerOrder.status`）`type` 为 `enum` 且 `constraint.enum` 为空。本特性 MUST NOT 因此拒绝加载或拒绝编辑。
- **历史版本快照**：`.data/onto_market/*/*/ontology_versions/v1.0|v1.1` 不含任何新字段，必须仍可加载（加载经 `repositories.fs_store.read_yaml_strict`，内容损坏即抛错）。
- **契约收缩**：`related_concepts` → `concept`、`related_behaviors` → `behavior`，两处均由数组改标量。已实测全部存量数据（4 个本体 + `v1.0`/`v1.1` 历史版本）中行为的关联概念与规则的关联行为**均为单元素**，迁移无损；若旧数组含多个元素（实测不存在），迁移取首个并记录警告，不报错（保持读时兼容口径）。
- **校验边界**：值域类非法值静默归一（不阻断）；跨字段强耦合类报 400（统一错误体）。Pydantic 校验失败会走既有 `RequestValidationError` 处理器返回 **422**，故强耦合校验不得落在 Pydantic validator。
- **500 行约束**：`frontend/src/components/Design/RuleTable.tsx` 现 471 行，规则结构改动必然超限，必须先拆分。

## 需求 *（必填）*

### 功能需求

**A. 关系类型**

- **FR-001**: 关系 MUST 支持 `relation_type` 字段（多选），取值来自固定集合 `{asymmetric, symmetric, transitive, functional, inverse_functional}`；集合外的值 MUST 被丢弃且 MUST NOT 阻断保存。
- **FR-002**: `relation_type` MUST 与既有 `cardinality` 并存；本特性 MUST NOT 引入二者的一致性校验或推理语义（仅登记）。

**B. 概念生命周期状态**

- **FR-003**: 概念 MUST 支持名为 `status` 的生命周期属性：其 `type` 恒为 `string`，状态枚举值 MUST 存放于该属性既有的 `constraint.enum`。
- **FR-004**: 保存概念属性时，若存在 `status` 属性，则其 `type` MUST 为 `string` 且 `constraint.enum` MUST 非空；否则 MUST 返回 400（统一错误体）。
- **FR-005**: 本特性 MUST NOT 强制「每个概念都必须存在 status 属性」（存量 6 概念中 5 个无该属性，硬约束会使既有概念无法编辑）；前端 MAY 提示但不阻断保存。

**C. 行为状态跃迁**

- **FR-006**: 行为 MUST 支持 `from_status` / `to_status` 字段（字符串，缺省空串 = 未声明）。
- **FR-007**: 保存行为时，若 `from_status` 或 `to_status` 非空，则其关联概念 MUST 存在合法 `status` 属性（FR-004 口径），且该属性的 `constraint.enum` MUST 覆盖所声明的值；否则 MUST 返回 400。
- **FR-008**: `from_status` 与 `to_status` 均为空时 MUST 跳过 FR-007 校验。
- **FR-009**: 行为关联概念 MUST 收缩为单一概念：`BehaviorItem.related_concepts: list[str]` 改为标量 `concept: str`；旧数据 `related_concepts: [x]` MUST 在读时无损迁移（取唯一元素）；标量缺省为空串。
- **FR-010**: 既有级联清理语义 MUST 按新字段保持一致（删除概念时清空引用它的行为的 `concept`；行为改名的数据引擎联动不变）。

**D. 概念术语集**

- **FR-011**: 概念 MUST 支持 `terms: list[str]`（术语集：该概念的其他表述），位置与 `instance_label` 平级（模型、表格、编辑弹窗三处均相邻）。
- **FR-012**: `terms` MUST 去重、去空串、去首尾空白。
- **FR-013**: `terms` 为登记字段；本特性 MUST NOT 引入术语跨概念唯一性校验。

**E. 函数类型**

- **FR-014**: 本体函数 MUST 支持 `type` 字段，取值 MUST 为英文码之一：`TRANSFORMATION`（格式转换）/ `CALCULATION`（指标计算）/ `DERIVATION`（属性派生）/ `VALIDATION`（逻辑验证）/ `MODEL`（机器学习模型，非训练）；集合外的值 MUST 归一为空串。
- **FR-015**: 缺省值 MUST 为空串（不推断）；公共函数（`.data/common_functions/functions.json`）MUST NOT 被本特性覆盖。
- **FR-016**: 提示词 MUST 同步：函数 5 类从「自然语言分类」改为「必须落盘 `type` 英文码」，且措辞统一为【指标计算】CALCULATION。

**F. 规则操作数「实体自身」**

- **FR-017**: 规则操作数 MUST 支持 `type: self`，语义为「规则所绑定行为的唯一主体概念的那个实例」；`self` MUST 仍指定 `attribute`（属性候选来自主体概念），MUST NOT 需要指定 `concept`。若 `rule_detail` 中出现 `self` 操作数，则规则 MUST 已绑定行为（`behavior` 非空且命中该本体的行为），否则 MUST 返回 400。
- **FR-018**: 规则绑定行为 MUST 收缩为单一行为：`RuleItem.related_behaviors: list[str]` 改为标量 `behavior: str`；旧数据 `related_behaviors: [x]` MUST 在读时无损迁移（取唯一元素）；标量缺省为空串（允许规则暂不绑定行为）。

**G. 规则条件与/或/非嵌套**

- **FR-019**: `rule_detail` 的条件结构 MUST 支持递归组合节点：`{logic: 'and'|'or'|'not', children: [叶子 | 组合节点]}`；叶子 MUST 保持 `{left, operator, right}` 三段式。
- **FR-020**: `not` 组合节点 MUST 只允许 1 个 child。
- **FR-021**: 旧扁平结构 `{logic, conditions:[叶子…]}` MUST 在读时（编辑器加载 / 运行期消费）无损迁移为 `{logic, children:[…]}`；保存 MUST 统一写新结构。
- **FR-022**: 规则模板 JSON（`validation/compare_rule.json`、`inference/inference_rule.json`）MUST 改为递归 Schema。
- **FR-023**: 运行期投喂 LLM 的 `rule_detail` 序列化 MUST 保留层级（缩进输出），MUST NOT 压缩为单行。

**H. 契约同步与兼容**

- **FR-024**: 模型 MUST 在以下 5 处保持一致：`core-backend/schemas/__init__.py`（权威源）、`frontend/src/api/design.ts`、`agent-backend/src/types.ts`、`.data/templates/onto_template.yaml`、`core-backend/prompts.py`。
- **FR-025**: 所有新增字段 MUST 可选且有默认值；`.data/onto_market/*/*/ontology_versions/` 下的历史快照 MUST 仍可加载。
- **FR-026**: 值域类校验 MUST 静默归一（Pydantic validator，不报错）；跨字段强耦合校验 MUST 在业务层抛出领域异常，由全局处理器映射为 400 统一错误体。
- **FR-027**: 后端源文件与前端组件源文件 MUST ≤ 500 行（章程硬约束）；`RuleTable.tsx` 的超限风险 MUST 以「先拆分、后改动」处理。

### 关键实体

- **关系（`RelationItem`）**：新增 `relation_type: list[str]`。
- **概念（`ConceptItem`）**：新增 `terms: list[str]`；其属性列表中 `name == "status"` 的属性承担生命周期状态语义（`type=string` + `constraint.enum`）。
- **行为（`BehaviorItem`）**：新增 `from_status` / `to_status`；`related_concepts: list[str]` → `concept: str`。
- **函数（`FunctionItem`）**：新增 `type: str`（英文码 5 值）。
- **规则（`RuleItem`）**：`rule_detail` 条件结构升级为递归树；操作数新增 `self` 类型；`related_behaviors: list[str]` → `behavior: str`。

### 明确不做（Out of Scope）

- **函数返回类型**（`return_type`）：与既有 `response` 返回结构职责重叠（信封 vs 载荷边界不清），本特性不做。
- **权限按角色**：系统当前无用户表、无角色模型、无鉴权与用户身份来源，本特性不做。
- **关系类型与 `cardinality` 的一致性校验**、关系类型的推理/校验语义（系统无推理引擎消费关系）。
- **存量 `type: enum` 属性的规范化**（`CustomerOrder.status` / `orderType`）。

## 成功标准 *（必填）*

### 可衡量结果

- **SC-001**: 关系类型多选落盘→回读一致；非法值被丢弃且保存成功（0 例因非法关系类型导致保存失败）。
- **SC-002**: `status` 属性 `type != string` 或 `constraint.enum` 为空时保存返回 400；合法时保存成功且回读一致。
- **SC-003**: `from_status`/`to_status` 越界返回 400；为空时保存成功；存量行为不受影响。
- **SC-004**: 行为关联概念为标量；旧 `related_concepts: [x]` 数据无损加载（迁移后值一致，0 例丢失）。
- **SC-005**: 术语集落盘→回读一致；重复/空串/首尾空白被清理。
- **SC-006**: 函数类型落盘→回读一致；非法值归一为空串。
- **SC-007**: 规则 `self` 操作数往返一致；未绑定行为的规则使用 `self` 返回 400；旧 `related_behaviors: [x]` 无损迁移为 `behavior: x`。
- **SC-008**: 旧扁平 `rule_detail` 打开为树、保存为树、回读一致；`not` 节点恰好 1 个子节点；三层嵌套往返无损。
- **SC-009**: `.data/onto_market/*/*/ontology_versions/v1.0|v1.1` 与新模板均可加载（0 例加载失败）。
- **SC-010**: 5 份模型副本字段清单逐项一致（0 处缺失）。
- **SC-011**: 后端 pytest 全绿；前端 vitest 全绿且覆盖率门槛（80%）不降；`tsc --noEmit` 与 `compileall` 通过。
- **SC-012**: 后端源文件与前端组件源文件中行数 > 500 的数量为 0。

## 假设

- **P1 解读（需复核）**：需求 2 / D5 的「属性加 status 字段，string 枚举型」按「概念的属性列表中必须有一个 `name=status`、`type=string`、`constraint.enum` 非空的属性；不在 `AttributeItem` 上新增布尔标记字段」实现。若实际意图是「`AttributeItem` 新增 `status` 字段用于存枚举值数组」，则 FR-003 / FR-004 与前端表单需重做。
- **校验强度取舍**：FR-005 选择「不强制每概念必有 status 属性」，理由是存量 6 概念中 5 个无该属性，强制会使既有概念的属性编辑全部失败。若要求强制，需同时提供存量数据迁移方案。
- **P2 形态**：`related_behaviors` 改标量 `behavior`（与行为的 `concept` 命名对称）。消费点已完整枚举：`schemas/__init__.py:95`、`routers/rules.py:84,92`、`frontend/src/api/design.ts:143`、`RuleTable.tsx` 13 处、`View/OntologyGraph.tsx:140-141`、`agent-backend/src/types.ts:119`、`agent-backend/src/services/ontology-gateway.ts:96,104,107`、`ontology-mcp/server.py:256`、模板与 11 处 agent 测试 fixture。存量数据全部单元素（已实测 4 个本体 + 2 个历史版本），迁移无损。
- **校验归属**：值域类走 Pydantic validator（静默归一）；跨字段强耦合走业务层 `errors.InvalidInputError` → 400。Pydantic 校验失败经 `main.py:115` 的 `RequestValidationError` 处理器返回 **422**，因此强耦合校验 MUST NOT 放在 Pydantic validator 中，否则错误契约分裂。
- **无推理引擎**：系统当前没有任何规则求值器或关系推理器；`rule_detail` 在运行期仅被序列化为文本投喂 LLM（`agent-backend/src/agent/subtask-runner.ts:342-380`），关系类型仅作元数据登记。本特性不改变这一点。
- **本特性为向后兼容的增量扩展**，不涉及存储引擎替换（`.data` 文件型存储不变）。
