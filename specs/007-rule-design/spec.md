# 功能规范：规则设计（rules[].rule_design）

**特性分支**: `007-rule-design`

**创建日期**: 2026-10-31

**状态**: 已实现（2026-10-31；验收记录见 [tasks.md](./tasks.md)，静态原型见 [prototype.html](./prototype.html)）

**输入**: 用户 2026-10-31 决策回合——
① 采用**表单弹窗**设计规则，不采用 `rules/generate`，并要求删除其冗余代码；
② `rule_design` **只做设计期表达**，暂不提供给 agent 消费；
③ 运算符覆盖**全部类型**；
④ 条件中的函数**只允许从该规则的 `related_functions` 中选择**。

## 用户场景与测试 *（必填）*

### 用户故事 1 - 在弹窗里完成条件组合设计（优先级：P1）

作为本体设计者，我希望在「本体明细 → 规则」表格的「规则设计」列点笔头，弹出一个表单弹窗，
在里面用 AND/OR 把多个关联函数的判断条件组合成一段可读的规则逻辑，这样规则的“为什么成立/不成立”
不再只是自由文本描述。

**优先级理由**：这是本次唯一的功能新增；`rule_design` 落盘结构一旦定形，后续执行侧才谈得上消费。

**独立验证**：编辑器里「规则设计」列未设计的行显示「未设计 + 笔头」，点击后弹窗可增删条件组、切换 AND/OR，
保存后该列变为「2组 · 3条件」，重新打开弹窗内容完整回显。

**验收场景**：

1. **Given** 规则 `V01_UnitConsistency_Purchase` 的 `related_functions = [checkRawMaterialUnit]`，
   **When** 添加一组、组内 AND 两条条件（`pass` 等于 `true`、`reason` 包含 `单位`）并填写两段结果说明后保存，
   **Then** `ontology.yaml` 该规则下出现 `rule_design`，组与条件顺序、运算符、取值与界面一致。
2. **Given** 已有设计，**When** 把组间切换为 OR、删除第二条条件，**Then** 保存后 `combine: or` 且只剩一条条件。
3. **Given** 设计未保存时关闭弹窗，**Then** 表格不改动（弹窗内所有改动只写行内草稿，仍需点行尾 ✓ 落盘）。
4. **Given** 弹窗内某组一条条件都没有，**When** 点「保存设计」，**Then** 拦截并提示「条件组 N 为空」。

---

### 用户故事 2 - 函数与返回字段只能来自关联函数（优先级：P1）

作为本体设计者，我希望条件里的函数下拉只列出该规则的关联函数，选完函数后字段下拉只列出**该函数自己声明的返回结构**
（可下钻嵌套字段），这样设计与“规则必须挂函数”的既有闸门不会脱节。

**优先级理由**：与口径 B（函数留痕/真阻断）直接相关，选到未挂载的函数等于设计了一段永不生效的逻辑。

**独立验证**：`related_functions` 为空时弹窗显示空态引导；改 `related_functions` 后重开弹窗，被移除的函数在条件里标红。

**验收场景**：

1. **Given** 规则未选任何关联函数，**When** 点笔头，**Then** 弹窗显示「请先在表格选择关联函数」，添加条件按钮禁用。
2. **Given** 关联函数为 `[checkRawMaterialUnit, sumRawNotArrivalQty]`，**When** 打开函数下拉，**Then** 只有这两项；
   选择 `sumRawNotArrivalQty` 后字段下拉出现 `sumNotArrivalQty`（number），选中后运算符只出现数值类。
3. **Given** 字段 `items`（array，`items.properties` 含 `rawMaterialName`），**When** 下钻到 `items[].rawMaterialName`，
   **Then** 落盘 `field: items[].rawMaterialName`。
4. **Given** 规则保存后有人把 `checkRawMaterialUnit` 从 `related_functions` 移除，**When** 再次打开弹窗/保存该规则，
   **Then** 该条件标红「函数已不在关联函数中」，保存被拦截。

---

### 用户故事 3 - 结果说明 30 字以内（优先级：P1）

作为本体设计者，我希望分别填写「条件成立」与「条件不成立」的结果说明，各不超过 30 字。

**独立验证**：输入框实时显示 `n/30`，到 30 字无法继续输入；后端超长返回 400 而不是 422。

**验收场景**：

1. **Given** 已填 30 字，**When** 继续输入，**Then** 无法再输入（前端硬截断）。
2. **Given** 绕过前端、请求体带 31 字，**When** 保存规则，**Then** 返回 400 且提示字段与字数。

---

### 用户故事 4 - 运行期零影响（优先级：P2）

作为平台维护者，我希望 `rule_design` 只是设计期数据：agent 侧规则闸、MCP 编译、部署都不读它，
这样这次改动不会改变任何一次对话的执行行为。

**独立验证**：新增字段后，`agent-backend` 全量单测不变绿/变红；`mcp-shared` 编译产物无差异；
部署合并后的 yaml 中 `rule_design` 原样保留（按一级节 `rules` 整条搬运）。

**验收场景**：

1. **Given** 规则带 `rule_design`，**When** 部署到版本目录并回读，**Then** 该字段内容不变。
2. **Given** 规则带 `rule_design`，**When** 发起一次真实对话，**Then** 规则闸只按 `related_functions` 判定，行为与改前一致。

---

### 用户故事 5 - 退役 rules/generate（优先级：P2）

作为平台维护者，我希望删除「AI 选择关联函数」这条链路（端点、提示词、前端按钮、API 封装），
因为规则设计已改为人工表单，保留它会形成两条互相矛盾的入口。

**独立验证**：`POST /api/ontologies/{id}/rules/generate` 返回 **405**（路径仅剩 PUT/DELETE 的 `/{rule_name}`，不再有该 POST 端点）；前端规则表「关联函数」列不再出现机器人按钮；
全仓 `RULE_GENERATE` / `rules/generate` / `generateRule` 命中数为 0（历史规格文档除外）。

**验收场景**：

1. **Given** 已删除，**When** 调用 `POST .../rules/generate`，**Then** 405（Method Not Allowed）。
2. **Given** 已删除，**When** 在规则表编辑规则，**Then** 关联函数仍可多选，仅少了 AI 建议按钮。
3. **Given** 已删除，**When** 跑 core-backend 测试与前端 lint/单测，**Then** 无因缺失符号而失败的用例。

---

## 需求 *（必填）*

### FR-001 数据结构（`ontology.yaml` → `rules[].rule_design`）

```yaml
rule_design:
  combine: and                  # 组间组合：and | or（缺省 = and）
  groups:
  - combine: and                # 组内组合：and | or（缺省 = and）
    conditions:
    - function: checkRawMaterialUnit   # 必须 ∈ 本规则 related_functions
      field: pass                      # 相对统一信封 data 的路径，支持嵌套
      operator: eq                     # 见 FR-002
      values: ["true"]                 # 字符串数组；按运算符决定 0/1/2/多 个
  pass_message: 原材料存在且单位一致，允许创建采购单      # ≤30 字
  fail_message: 原材料不存在或单位不一致，拒绝创建采购单  # ≤30 字
```

- `rule_design` 整体可缺省；**空对象 / 空组一律归一为 `None`，不落盘**（口径同 `ConstraintItem`：全缺省不落盘）。
- `values` 是字符串数组而非标量：`empty` / `not_empty` 为 `[]`，`between` 恰 2 项，`in` / `not_in` ≥1 项，
  其余恰 1 项。类型解释（`"true"` → boolean、`"3"` → number）留给展示与将来可能的消费侧，落盘保持字符串，
  避免 yaml 里 `true` / `"true"` 两种形态并存。
- 新增/删除/改名规则结构不变：`rule_design` 属于该规则条目，随条目整体搬运。

### FR-002 运算符全集与类型矩阵

| 码 | 文案 | 取值个数 | 适用字段类型 |
| :-- | :-- | :-: | :-- |
| `eq` | 等于 | 1 | 全部 |
| `ne` | 不等于 | 1 | 全部 |
| `gt` / `gte` | 大于 / 大于等于 | 1 | number, integer |
| `lt` / `lte` | 小于 / 小于等于 | 1 | number, integer |
| `between` | 介于（含两端） | 2 | number, integer |
| `contains` / `not_contains` | 包含 / 不包含 | 1 | string, array |
| `starts_with` / `ends_with` | 开头是 / 结尾是 | 1 | string |
| `matches` | 匹配正则 | 1 | string |
| `in` / `not_in` | 属于 / 不属于 | ≥1 | string, number, integer |
| `empty` / `not_empty` | 为空 / 非空 | 0 | 全部 |

- 字段类型取该函数 `response` 声明里的 `type`；**未声明类型 → 不限制**（全集可选，按字符串输入）。
- `matches` 的正则合法性只在**前端**做提示（不拦截保存）：正则引擎差异属消费侧问题，设计期不制造假失败。

### FR-003 前端交互（表格列 + 弹窗）

**表格列**（`RuleTable.tsx`，新增「规则设计」列，宽约 110）：

| 状态 | 展示 | 行为 |
| :-- | :-- | :-- |
| 未设计 | 灰字「未设计」+ 铅笔 | 点击铅笔 → 进入该行编辑态并打开弹窗 |
| 已设计 | `{组数}组 · {条件数}条件`，悬停 Tooltip 显示表达式摘要 | 同上（覆盖已有设计） |
| 行内编辑中 | 同上，铅笔仍可点 | 弹窗改动只写 `editData.rule_design`，行尾 ✓ 统一落盘 |

**弹窗**（`rule/RuleDesignModal.tsx`，antd `Modal`，宽 ~860，深色）自上而下：

1. 规则名 / 绑定行为 / 介入位置（只读）；
2. 关联函数 chips（只读，提示「需增减请回到表格修改关联函数」）；
3. 条件组合：组间 AND/OR 分段按钮 → 条件组卡片列表（组内 AND/OR + 条件行 + 添加条件 + 删除组）→ 添加条件组；
4. 条件行：函数下拉（**仅 `related_functions`**，label 复用 `functionLabel` 的「中文名-类型」，判断函数加标记）
   → 字段级联下拉（该函数 `response` 树，中文名 + 路径）→ 运算符下拉（按字段类型过滤）→ 取值控件
   （boolean 用 true/false 下拉；number 用数字输入；`between` 两个输入；`in`/`not_in` 多值输入；`empty` 系列显示「无需取值」）；
5. 判断结果：条件成立 / 条件不成立两输入，按**码点**截断到 30 字 + `n/30` 计数；
6. 底部：取消 / 保存设计（前端校验通过才回传）。

**新增条件的默认值**（用户 2026-10-31 决策：要合理类型默认值，避免空白条件）：

| 字段类型 | 默认运算符 | 默认取值 |
| :-- | :-- | :-- |
| boolean | `eq` | `true` |
| number / integer | `eq` | `0` |
| string（含未声明类型） | `eq` | 空白（`""`，合法取值，后端不拦） |
| 空值类运算符（`empty` / `not_empty`） | — | 无取值 |
| `between` | — | 两个 `0` |

**数量上限**（用户 2026-10-31 决策）：最多 **5** 个条件组、每组最多 **5** 条条件；
到上限后「添加条件组 / 添加条件」按钮禁用并给 Tooltip，后端同口径 400（防 API 直调）。

**空态与悬空**：

- `related_functions` 为空 → 弹窗展示空态引导，「添加条件组」禁用；
- 条件引用的函数已不在 `related_functions` → 该行标红「函数已不在关联函数中」，保存被拦截；
- 函数 `response` 未声明任何字段 → 字段下拉空态「该函数未声明返回结构」，该条件不可保存。

**实现拆分（章程 II：单文件 ≤500 行、同职责唯一来源）**：

| 文件 | 内容 |
| :-- | :-- |
| `frontend/src/components/Design/rule/rule-design.ts`（新） | 类型、`OPERATOR_META`、类型矩阵、`flattenResponseFields`（兼容扁平映射与 JSON Schema 包裹两种 response）、`designSummary`、`validateDesign`、空对象归一 |
| `frontend/src/components/Design/rule/rule-design.test.ts`（新） | 纯函数单测 |
| `frontend/src/components/Design/rule/RuleDesignModal.tsx`（新） | 弹窗 UI，只做渲染与本地状态 |
| `frontend/src/components/Design/rule/RuleDesignModal.test.tsx`（新） | 组件交互测试 |
| `frontend/src/components/Design/RuleTable.tsx`（改） | 新增列、`editData.rule_design`、铅笔→开弹窗、保存体带字段、删 AI 按钮 |
| `frontend/src/api/design.ts`（改） | `Rule` 加 `rule_design?: RuleDesign`；删 `generateRule` |

### FR-004 后端模型与落盘

- `core-backend/schemas/__init__.py` 新增 `RuleConditionItem` / `RuleDesignItem`；`RuleItem.rule_design: RuleDesignItem | None = None`。
- 值域类归一（Pydantic validator，静默）：`combine` 非 `and`/`or` → `""`（读侧按 `and`）；
  `operator` 不在全集 → `""`；`values` 非列表 → 单值包裹。
- **全缺省归一**：`groups` 为空 / 每条条件都空 / 整段无内容 → `None`，配合 `model_dump(exclude_none=True)` 不落盘。
- 保存路径 `save_ontology_data` / `save_ontology_version` 无需改动；部署合并（`_MERGE_SECTIONS` 含 `rules`）自动保留。

### FR-005 保存期校验（业务层 → 400）

全部放 `core-backend/services/validators.py::validate_rule_design`，由 `routers/rules.py` 的 create/update 调用：

| 校验 | 报错（400） |
| :-- | :-- |
| 条件函数 ∈ 本规则 `related_functions` | `规则设计中的函数 X 不在该规则的关联函数中` |
| 并集上函数仍须存在于 本体函数 ∪ 公共函数 | `规则设计中的函数不存在: X` |
| `field` 能在该函数 `response` 中逐层解析 | `函数 X 未声明返回字段: a.b.c` |
| `operator` 合法且适配字段类型 | `函数 X 字段 a 不支持运算符 gt` |
| `values` 个数符合运算符要求 | `运算符 between 需要 2 个取值` |
| 组至少 1 条条件 / 至少 1 组 | `规则设计第 N 组没有条件` / `规则设计没有任何条件组` |
| `pass_message` / `fail_message` ≤30 字 | `结果说明超过 30 字` |

> 长度校验**不得**写成 Pydantic `max_length`（会变 422，破坏项目 400/422 契约铁律）。
> 纯计算部分（路径解析、矩阵判断）下沉到 `core-backend/services/rule_design.py` 以便单测。

### FR-006 `rules/generate` 退役清单（删除，不留兼容）

| 端 | 位置 | 动作 |
| :-- | :-- | :-- |
| core | `routers/rules.py` | 删 `generate_rule` 端点及其专属 import（`json`、`DomainError`/`InternalError`、`load_env`/`llm_json`、`effective_map`、`read_common_functions`）；保留 `available_function_names` |
| core | `prompts/rule_generate.py` | 整文件删除 |
| core | `prompts/__init__.py` | 删 import 与 `__all__` 中 `RULE_GENERATE_SYSTEM_PROMPT` / `RULE_GENERATE_PROMPT` |
| core | `config.py` | 删上述两常量的导入 |
| frontend | `api/design.ts` | 删 `generateRule` |
| frontend | `Design/RuleTable.tsx` | 删 `handleGenerateFunctions`、`genLoading`、`RobotOutlined`（若无其他使用）、关联函数列中的 AI 按钮及其 Tooltip 包裹 |
| 测试 | `core-backend/tests` / `frontend/src` | 现状 0 引用，无需改；删除后须全量回归确认 |

历史规格（`specs/003`、`specs/006`）中的记录**保留不改**（事实记录，不追溯）。

### FR-007 契约与规格回写（章程 I）

- `specs/contracts/ontology-yaml.md`：§字段契约新增 `rules[] rule_design` 行 + 一节「规则设计口径（2026-10-31）」，
  写明「设计期表达，运行期不消费」与非空落盘规则。
- 本 spec 的修订记录随实现回写（含日期）。

### FR-008 运行期与非目标侧（不改）

- `agent-backend`（`types.ts::RuleDetail`、`execution-policy.ts`）：不读 `rule_design`，不改。
  `RuleDetail` 可加一行**注释**说明该字段存在但运行期不消费，避免后人误加闸门。
- `mcp-shared` 编译、`ontology-query-mcp`、`data-engine-executor`：不涉及。
- `utils/yaml-segments.ts`：`rule_design` 属 `rules` 内部字段，无需改。

---

## 关键实体

| 实体 | 形态 | 说明 |
| :-- | :-- | :-- |
| `RuleDesign` | `{combine, groups[], pass_message, fail_message}` | 一段规则逻辑 = 组间组合 + 若干条件组 |
| `RuleConditionGroup` | `{combine, conditions[]}` | 组内组合 + 条件列表（至少 1 条） |
| `RuleCondition` | `{function, field, operator, values[]}` | 单条判断；`field` 相对统一信封 `data` |
| `FieldOption` | `{path, label, type}` | 由函数 `response` 派生的可选项（前端内存结构，不落盘） |

**返回结构两种形态的统一**（`flattenResponseFields` 的唯一职责）：

1. 本体函数：`response` 直接是属性映射 `{pass: {type: boolean, title: 判断结果}}`；
2. 公共函数：`response` 是 JSON Schema `{type: object, properties: {...}}` → 先解包 `properties`；
3. 递归规则：节点含 `properties` → 继续下钻；`type=array` 且 `items.properties` → 路径加 `[]` 后下钻；
   其余为叶子。

---

## 边界与不做

- **不做运行期求值**：agent 不解析 `rule_design`，不新增闸门，不参与 `data.pass` 判定（本期明确）。
- **不做 AI 生成**：删除 `rules/generate` 后不保留“AI 帮我写条件”入口；该能力已另立特性承接
  （`specs/008-rule-design-generate`：基于规则描述 + **全部**关联函数生成条件草稿，仍需人工确认）。
- **不做三层以上嵌套组合**：UI 固定两层（组间 / 组内）。存储结构预留演进空间（将来把 `conditions` 换成
  `children` 递归即可），本期不加。
- **不做条件项之间的跨函数常量比较**（右侧只能是字面值，不能是另一个函数的字段）。
- **不做存量数据回填**：既有规则 `rule_design` 一律为空，不批量生成。

---

## 成功标准

1. 弹窗可完成“组间 AND/OR + 组内 AND/OR + 条件项”的全流程，保存后 `ontology.yaml` 结构如 FR-001，
   重新打开回显一致（往返无损）。
2. 只允许选择 `related_functions` 内的函数；越界前端不可选、后端 400。
3. 运算符覆盖 FR-002 全集，且按字段类型过滤；`values` 个数与运算符匹配。
4. 结果说明 30 字限制前后端一致，超长返回 **400**（非 422）。
5. `rule_design` 为空时不落盘；有内容时部署/版本合并原样保留。
6. `rules/generate` 全链路（端点、提示词、前端按钮、API 封装）删除，全仓命中数 0（历史规格除外），
   且前端 lint + 全量单测、core pytest 全绿。
7. 新增/改动文件单测覆盖率 ≥80%；端点 P95 ≤500ms 不变（仅多一个字段序列化，无新增 IO、无 N+1）。

---

## 修订记录

| 日期 | 变更 |
| :-- | :-- |
| 2026-10-31 | 初稿：表单弹窗设计、只做设计期表达、运算符全集、函数限 `related_functions`；并入 `rules/generate` 退役要求 |
| 2026-10-31 | 评审确认并实现：新增条件默认值（true / 0 / 空白）、上限 5 组 × 5 条；删除 `rules/generate` 全链路；状态置为已实现 |
