# 契约：规则设计智能生成（spec 008）

`POST /api/ontologies/{ontology_id}/rules/design/generate`

**定位**：用 LLM 基于「规则描述 + 该规则的**全部**关联函数」产出一份 `rule_design` 草稿。
**只读端点**：不写 `ontology.yaml`、不写版本目录；草稿由人工在弹窗确认后随规则保存。
**与已退役的 `POST /rules/generate` 无关**：后者是从全量函数里「选函数」，本端点是在已选函数上「组合条件」。

## 请求

```jsonc
{
  "rule_name": "V01_UnitConsistency_Purchase",
  "title": "采购-原料存在且单位一致",
  "description": "创建采购单时，原材料ID必须存在，且单位与原材料定义一致。",
  "position": "前置",
  "behavior": "CreatePurchaseRecord",
  "related_functions": ["checkRawMaterialUnit", "sumRawNotArrivalQty"]
}
```

| 字段 | 必填 | 说明 |
| :-- | :-: | :-- |
| `rule_name` | 否 | 仅作上下文；空则后端用 `__preview__` 占位（不落盘，无副作用） |
| `title` / `description` / `position` / `behavior` | 否 | 与 `rules[]` 同语义；`description` 是生成的主要依据 |
| `related_functions` | **是** | 该规则的全部关联函数；空 → 400；含不存在函数 → 400（同 `validate_related_functions` 口径） |

## 响应 200

```jsonc
{
  "rule_design": {
    "combine": "and",
    "groups": [{ "combine": "and", "conditions": [
      { "function": "checkRawMaterialUnit", "field": "pass", "operator": "eq", "values": ["true"] }
    ] }],
    "pass_message": "原材料存在且单位一致",
    "fail_message": "原材料不存在或单位不一致"
  },
  "warnings": ["函数 getCurrentDate 未声明返回结构，已跳过（不能作为判断依据）"],
  "dropped_conditions": 1,
  "model": "deepseek-chat",
  "elapsed_ms": 1820
}
```

`rule_design` 已通过与保存路径**完全相同**的校验（`validate_rule_design`），因此：
- `function` ∈ 请求的 `related_functions`；
- `field` 能在该函数 `response` 中解析；
- `operator` 合法且适配字段类型；
- `values` 个数符合运算符要求；
- 5 组 × 5 条、文案 ≤30 字（超出会被截断并记入 `warnings`）。

## 错误码

| 状态 | 场景 | 文案 |
| :-: | :-- | :-- |
| 400 | `related_functions` 为空 | `请先选择关联函数` |
| 400 | 含不存在的函数 | `关联函数不存在: X`（继承既有校验） |
| 400 | LLM 返回非 JSON | `生成结果格式异常，请重试` |
| 400 | 生成结果无任何有效条件 | `未能生成可用条件，请补充规则描述后重试` |
| 400 | 生成超时（>60s） | `生成超时（60s），请重试` |
| 400 | 修边后仍无法通过保存校验（不应发生） | `生成结果未通过校验：<原因>` |
| 500 | 未配置 LLM API Key | `未配置 LLM API Key，无法智能生成` |
| 500 | LLM 调用异常 | `生成失败: <原始错误>` |
| 404 | 本体不存在 | 继承既有依赖注入 |

## 修边口径（服务端确定性处理，逐条记 `warnings`）

| # | 情况 | 处理 |
| :-: | :-- | :-- |
| 1 | 条件函数 ∉ `related_functions` | 丢弃该条件（计入 `dropped_conditions`） |
| 2 | `field` 无法解析 | 丢弃该条件 |
| 3 | 运算符缺失/非法/不适配类型 | 替换为该字段类型首个可用运算符 |
| 4 | `values` 个数不符 | 按 arity 裁剪/补齐（boolean `true`、number `0`、其余空串） |
| 5 | 组内条件全被丢弃 | 丢弃该组 |
| 6 | 组数 > 5 / 每组 > 5 | 截断 |
| 7 | `combine` 非法 | 归一为 `and` |
| 8 | 文案 > 30 字 | 按码点截断 |

## 性能与可观测

- LLM 端点，**登记豁免** CRUD 的 P95 ≤500ms：目标 P95 ≤20s，硬超时 60s（`asyncio.wait_for`），前端不自动重试。
- 结构化日志：`rule_design.generated rule=<name> functions=<n> model=<m> elapsed_ms=<ms> dropped=<n> warnings=<n>`；
  **不记录规则描述全文**。

## 测试镜像

- `core-backend/tests/test_rule_design_generate.py`（25 例）：上下文含全部函数、各修边分支、LLM 异常分支、零副作用。
- `frontend/src/components/Design/rule/RuleDesignModal.test.tsx`：生成上下文 payload、写入表单、覆盖确认、失败保留、生成中禁用保存。
