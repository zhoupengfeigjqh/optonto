# 功能规范：规则设计智能生成（rule_design 的 AI 草稿）

**特性分支**: `008-rule-design-generate`

**创建日期**: 2026-10-31

**状态**: 已实现（2026-10-31；验收见 [tasks.md](./tasks.md)）

**输入**: 用户 2026-10-31 决策回合——
① 生成条件组合 + 两段结果说明；
② 上下文**必须包含该规则的全部 `related_functions`**（不允许只选部分函数）；
③ 已有设计时**覆盖 + 二次确认**；
④ 注意语义统一、功能高内聚低耦合。

## 与已退役 `rules/generate` 的区别（防误读）

| | 旧 `POST /rules/generate`（已删，spec 007） | 本特性 `POST /rules/design/generate` |
| :-- | :-- | :-- |
| 输入 | 规则名/描述/行为 | 规则描述 + **全部关联函数**（含返回结构） |
| 输出 | `related_functions`（**选哪些函数**） | `rule_design`（**怎么组合这些函数**） |
| 落盘 | 前端把结果写入行内草稿 | 只返回草稿，仍由人工确认后行尾 ✓ 落盘 |
| 前置 | 函数未定 | 函数已由人工选定，LLM 不得引入其它函数 |

**不复用旧提示词、不复用旧端点**；两者不是同一件事。

## 用户场景与测试 *（必填）*

### 用户故事 1 - 一键生成条件草稿（优先级：P1）

作为本体设计者，我在「规则设计」弹窗里点「智能生成」，系统读取这条规则的描述与**全部关联函数**，
产出一套 AND/OR 条件组合与两段结果说明，填进表单供我逐条修改，而不是从零拼条件。

**独立验证**：`related_functions = [checkRawMaterialUnit, sumRawNotArrivalQty]`、描述完整时点击生成，
表单出现「1 组 · 2 条件」且字段都落在两个函数声明的返回字段内；保存后 `rule_design` 与表单一致。

**验收场景**：

1. **Given** 弹窗无已有设计，**When** 点「智能生成」，**Then** 不弹确认，直接生成并填入表单。
2. **Given** 描述过短（<15 字），**When** 点「智能生成」，**Then** 仍可生成，但提示「描述较简单，建议补充判断依据后再生成」。
3. **Given** 生成成功且带 warnings（如某函数没有可设计字段被跳过），**Then** 表单已填入，且提示已忽略的条数/原因。
4. **Given** 生成中，**When** 点「保存设计」，**Then** 被禁用（避免半成品落盘）。

---

### 用户故事 2 - 覆盖前必须二次确认（优先级：P1）

**独立验证**：已有设计时点生成 → 弹确认「将覆盖当前设计」→ 取消则表单不变、不发请求；确认则生成并覆盖。

**验收场景**：

1. **Given** 已有 2 组设计，**When** 点生成并取消确认，**Then** 表单仍是原 2 组，且未发生网络请求。
2. **Given** 确认覆盖，**When** 生成失败，**Then** 原设计**保持不变**（不得清空后失败）。

---

### 用户故事 3 - 生成结果必定可保存或明确失败（优先级：P1）

作为平台维护者，我希望 LLM 的越界输出（幻觉函数、悬空字段、运算符错配、超限组数）在服务端被修边，
最坏情况是明确报错，而不是把脏设计塞回表单让保存 400。

**独立验证**：构造 LLM 输出含 1 条不存在的函数条件 → 返回 200、该条件被丢弃、`warnings` 记录原因、
`dropped_conditions=1`，其余条件保留并可保存。

**验收场景**：

1. **Given** LLM 返回非 JSON，**Then** 400「生成结果格式异常，请重试」。
2. **Given** 所有条件都被丢弃，**Then** 400「未能生成可用条件，请补充规则描述后重试」。
3. **Given** 组数 7 组、每组 8 条，**Then** 截断到 5 组 × 5 条并记 warnings。
4. **Given** 文案 42 字，**Then** 截到 30 字并记 warning。

---

### 用户故事 4 - 零副作用（优先级：P2）

生成端点**只读**：不写 `ontology.yaml`、不写版本目录、不改任何草稿；同一请求重复调用不产生数据变化。

**独立验证**：连续两次生成后，`GET /rules` 返回的规则与生成前逐字节一致。

## 需求 *（必填）*

### FR-001 接口契约

`POST /api/ontologies/{ontology_id}/rules/design/generate`

```jsonc
// 请求（字段名与 rules[] 语义一致，便于前后端对齐）
{
  "rule_name": "V01_UnitConsistency_Purchase",
  "title": "采购-原料存在且单位一致",
  "description": "创建采购单时，原材料ID必须存在，且单位与原材料定义一致。",
  "position": "前置",
  "behavior": "CreatePurchaseRecord",
  "related_functions": ["checkRawMaterialUnit", "sumRawNotArrivalQty"]   // 必须是该规则全部关联函数
}

// 响应 200
{
  "rule_design": { "combine": "and", "groups": [...], "pass_message": "...", "fail_message": "..." },
  "warnings": ["函数 getCurrentDate 未声明返回结构，已跳过"],
  "dropped_conditions": 1,
  "model": "deepseek-chat",
  "elapsed_ms": 1820
}
```

- `related_functions` 为空 → 400「请先选择关联函数」；含不存在函数 → 400（复用 `validate_related_functions`）。
- 请求不落盘；响应中的 `rule_design` 已通过 `validate_rule_design` 同口径校验。

### FR-002 上下文组装（唯一实现：`services/rule_design_generate.py::build_function_context`）

必须包含**全部** `related_functions`，每个函数给出：

1. `name / title / type / description / related_concepts`；
2. **可设计字段清单**：由 `services/rule_design.py::designable_fields(response)` 派生，
   每行 `path (type) 中文名 → 可用运算符码`；未声明 `response` 的函数明确标注「无可用返回字段，跳过」；
3. 不发送函数的完整 `params` JSON Schema（降噪、控 token），仅在描述缺失时补 `title`。

同时给出规则侧上下文：`rule_name / title / description / position / binding behavior`，
`description` 为空时提示「描述缺失」并在响应 `warnings` 中说明生成依据不足。

### FR-003 输出契约与修边（`repair_generated_design`）

LLM 输出形状：

```json
{ "combine": "and",
  "groups": [ { "combine": "and",
                "conditions": [ { "function": "f", "field": "pass", "operator": "eq", "values": ["true"] } ] } ],
  "pass_message": "...", "fail_message": "..." }
```

修边顺序（每步都记 `warnings`、计入 `dropped_conditions`）：

| # | 检查 | 处理 |
| :-: | :-- | :-- |
| 1 | `groups` 不是数组 | 直接判失败（400） |
| 2 | 条件 `function` ∉ `related_functions` | 丢弃该条件 |
| 3 | `field` 无法在函数 `response` 解析 | 丢弃该条件 |
| 4 | `operator` 非法 / 不适配字段类型 | 替换为该类型首个可用运算符（值按新运算符重置） |
| 5 | `values` 个数不符 | 按 arity 裁剪/补齐（缺省值：boolean `true`、number/integer `0`、其余空串） |
| 6 | 组为空 | 丢弃该组 |
| 7 | 组数 > 5 / 每组 > 5 | 截断 |
| 8 | `combine` 非法 | 归一为 `and` |
| 9 | 文案 > 30 字 | 按码点截断 |
| 10 | 修边后无任何条件 | 失败（400），**不返回空设计** |

最终用 `validate_rule_design`（构造临时 `RuleItem`，不落盘）再校验一次，不通过视为内部矛盾 → 500。

### FR-004 提示词（`prompts/rule_design_generate.py`）

- 系统提示：**只输出 JSON**，禁止解释/代码围栏；运算符只能用给定码；
- 用户模板：规则上下文 + 函数与字段清单 + 输出形状 + 硬约束（5 组 × 5 条、文案 ≤30 字、字段必须来自清单、
  函数只能来自清单、`pass`/`reason` 语义）；
- 明确要求「每个函数至少评估一次，与规则意图无关的可以不用，但**不得引入清单外的函数或字段**」；
- 明确「`rule_design` 仅作设计期说明，不代表运行期执行逻辑」，避免模型编造执行效果。

### FR-005 前端交互（`Design/rule` 内聚）

| 文件 | 职责 |
| :-- | :-- |
| `api/design.ts` | `RuleDesignGeneratePayload` / `RuleDesignGenerateResult` / `generateRuleDesign` |
| `rule/use-rule-design-generate.ts`（新） | loading 状态 + 调用封装的**唯一**入口；组件不直接碰 API |
| `rule/RuleDesignModal.tsx` | 「智能生成」按钮、覆盖二次确认、生成中禁用保存、warnings 提示 |

- 按钮仅当 `functions.length > 0` 时可用；生成中 `loading`。
- 覆盖判定：当前 `design.groups` 存在且至少一条条件 → `Modal.confirm`「将覆盖当前设计」。
- 失败时**保留原设计**并 `message.error`。
- 生成成功后先 `normalizeDesign` 再填入表单，保证与手工编辑同构。
- 弹窗新增 props：`ontologyId`、`ruleDescription`（取编辑态 `editData.description`）。

### FR-006 性能、超时与可观测

- 生成属 LLM 端点，**登记豁免**：目标 P95 ≤ 20s，服务端 `asyncio.wait_for(... , 60)` 超时，
  前端无自动重试（用户手动重试），超时文案「生成超时（60s），请重试」。
- 结构化日志字段：`rule_name`、`functions`（数量）、`model`、`elapsed_ms`、`dropped_conditions`、
  `warning_count`、失败原因；**不记录规则描述全文**。
- 其余 CRUD 端点维持 P95 ≤ 500ms 口径不变。

### FR-007 不落盘、不越界

- 端点只 `load_ontology_data`，绝不调用 `save_ontology_data` / 版本写入。
- 不引入新依赖（LangChain 通道复用 `llm_utils.llm_json`）。

## 边界与不做

- 不做流式输出（一次性 JSON，30s 内完成）；不做多轮会话式修正（重新生成即整段覆盖）。
- 不做「部分函数」选择：上下文固定为全部 `related_functions`（用户决策 ②）。
- 不自动保存：生成物只是草稿，仍需行尾 ✓ 落盘。
- 不做生成结果缓存（同规则重复生成不命中缓存）。
- 不写运行期逻辑：`rule_design` 依旧不被 agent 消费。

## 成功标准

1. 点击「智能生成」后，表单出现结构合法的条件组合 + 两段 ≤30 字说明，且全部字段/运算符/函数均通过后端校验。
2. 上下文含全部关联函数（单测断言：缺失任一函数即失败）。
3. 越界输出被修边且 `warnings` 可解释；无有效条件时明确 400，绝不返回空设计。
4. 已有设计时必弹二次确认；取消不发请求；失败不清空原设计。
5. 生成端点零副作用（连续调用后规则数据不变）。
6. 单测覆盖率 ≥80%，core / 前端全量门禁与 lint 全绿。

## 修订记录

| 日期 | 变更 |
| :-- | :-- |
| 2026-10-31 | 初稿并实现：上下文含全部关联函数、覆盖 + 二次确认、服务端修边、LLM 端点性能口径豁免 |
