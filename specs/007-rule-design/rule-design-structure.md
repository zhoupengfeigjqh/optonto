# 规则设计（`rule_design`）结构说明

> 适用范围：`ontology.yaml → rules[].rule_design`
> 定位：规则的**设计期条件表达**，把该规则关联函数的判断组合成一段可读逻辑。
> 运行期（agent 规则闸 / MCP 编译 / 部署合并）**不消费**该字段——闸门只认 `related_functions` 与 `type=VALIDATION` 的函数。

## 1. 数据结构

固定三层，字段名落盘为 snake_case。

| 层级 | 结构 | 字段 | 说明 |
| :-- | :-- | :-- | :-- |
| 根 | `RuleDesign` | `combine` / `groups[]` / `pass_message` / `fail_message` | 一段规则逻辑 = 组间组合 + 若干条件组 + 两段判定文案 |
| 中 | `RuleConditionGroup` | `combine` / `conditions[]` | 组内组合 + 条件列表（至少 1 条） |
| 叶 | `RuleCondition` | `function` / `field` / `operator` / `values[]` | 单条判断：某函数返回字段 与 字面值 的比较 |

```yaml
rules:
- name: V01_UnitConsistency_Purchase
  behavior: CreatePurchaseRecord              # 绑定行为唯一（标量）
  position: 前置                              # 介入位置：前置 / 后置
  related_functions: [checkRawMaterialUnit]    # 条件函数的唯一可选范围
  rule_design:
    combine: and                               # 组间组合：and | or
    groups:                                    # 1..5 组
    - combine: and                             # 组内组合：and | or
      conditions:                              # 每组 1..5 条
      - function: checkRawMaterialUnit
        field: pass                            # 相对统一信封 data 的路径
        operator: eq
        values: ["true"]                       # 字符串数组
    pass_message: 原材料存在且单位一致，允许创建采购单
    fail_message: 原材料不存在或单位不一致，拒绝创建采购单
```

等价 JSON：

```json
{
  "combine": "and",
  "groups": [
    {
      "combine": "and",
      "conditions": [
        { "function": "checkRawMaterialUnit", "field": "pass", "operator": "eq", "values": ["true"] }
      ]
    }
  ],
  "pass_message": "原材料存在且单位一致，允许创建采购单",
  "fail_message": "原材料不存在或单位不一致，拒绝创建采购单"
}
```

## 2. 树逻辑（布尔语义）

结构是**固定的两层「组间 + 组内」AND/OR 结构**，不是通用表达式树：

```
RuleDesign            combine = 组间连接符
├── group[0]          combine = 组内连接符
│   ├── condition[0]
│   └── condition[1]
└── group[1]
    └── condition[0]
```

等价布尔式（表达式摘要口径，即 Tooltip 中显示的形态）：

\[
D = \bigoplus_{i=1}^{m} \left( \bigoplus_{j=1}^{n_i} c_{ij} \right),\qquad \oplus \in \{\land, \lor\}
\]

例如「组间 OR + 组 1 内 AND 两条 + 组 2 内单条」显示为 `(A AND B) OR (C)`。

结构约定：

- **只有两层**：根 `combine` 连接组，组 `combine` 连接条件；**无 NOT，无括号嵌套，无条件引用条件**。
- **优先级由结构决定**：组内先算、组间后算；同一层只有一个连接符，不存在 `and`/`or` 混用优先级问题。
- **右侧只能是字面值**：`values` 不接受另一个函数字段或常量引用。
- **无三层嵌套能力**：存储结构预留了将来把 `conditions` 换成 `children` 的演进空间，当前不实现。
- **复杂度有界**：≤5 组 × 每组 ≤5 条（合计 ≤25 条）。

## 3. 符号逐项含义

### 3.1 根级 `RuleDesign`

| 键 | 类型 | 取值 / 缺省 | 含义 |
| :-- | :-- | :-- | :-- |
| `combine` | string | `and`（缺省）\| `or` | 组间组合方式：组与组之间用 AND 还是 OR |
| `groups` | array | 1..5 组 | 条件组列表 |
| `pass_message` | string | ≤30 字（码点） | 条件整体**成立**时的判定结论（业务结论，非"条件成立"套话） |
| `fail_message` | string | ≤30 字（码点） | 条件整体**不成立**时的判定结论 |

### 3.2 组级 `RuleConditionGroup`

| 键 | 类型 | 取值 / 缺省 | 含义 |
| :-- | :-- | :-- | :-- |
| `combine` | string | `and`（缺省）\| `or` | 组内组合方式：组内各条件之间用 AND 还是 OR |
| `conditions` | array | 1..5 条 | 该组的条件列表 |

### 3.3 条件级 `RuleCondition`

| 键 | 类型 | 含义与约束 |
| :-- | :-- | :-- |
| `function` | string | 关联函数名。必须 ∈ 该规则 `related_functions`，且存在于「本体函数 ∪ 公共函数」 |
| `field` | string | 该函数 `response` 中声明的字段路径，**相对统一信封 `{success, data, error}` 的 `data`**（不含信封层） |
| `operator` | string | 运算符码，见 §4；不在全集内视为非法 |
| `values` | `string[]` | 字面值数组，个数由运算符决定；**内容允许空白**（空串是合法取值） |

## 4. 运算符全集与类型矩阵

| 码 | 文案 | 取值个数 | 适用字段类型 | 语义 |
| :-- | :-- | :-: | :-- | :-- |
| `eq` | 等于 | 1 | 全部 | 相等 |
| `ne` | 不等于 | 1 | 全部 | 不等 |
| `gt` | 大于 | 1 | `number` / `integer` | 数值大于 |
| `gte` | 大于等于 | 1 | `number` / `integer` | 数值 ≥ |
| `lt` | 小于 | 1 | `number` / `integer` | 数值小于 |
| `lte` | 小于等于 | 1 | `number` / `integer` | 数值 ≤ |
| `between` | 介于 | 2 | `number` / `integer` | 闭区间，**含两端**；`values[0]` 为下界、`values[1]` 为上界 |
| `contains` | 包含 | 1 | `string` / `array` | 字符串子串 / 数组成员 |
| `not_contains` | 不包含 | 1 | `string` / `array` | 上者取反 |
| `starts_with` | 开头是 | 1 | `string` | 前缀 |
| `ends_with` | 结尾是 | 1 | `string` | 后缀 |
| `matches` | 匹配正则 | 1 | `string` | 正则匹配；**设计期不校验正则合法性** |
| `in` | 属于 | ≥1 | `string` / `number` / `integer` | 值的集合成员 |
| `not_in` | 不属于 | ≥1 | `string` / `number` / `integer` | 上者取反 |
| `empty` | 为空 | 0 | 全部 | `values` 必须为 `[]` |
| `not_empty` | 非空 | 0 | 全部 | `values` 必须为 `[]` |

取值个数口径：

- `0`：无取值（`empty` / `not_empty`）；
- `1`：恰好 1 个；
- `2`：恰好 2 个（仅 `between`）；
- `-1`：至少 1 个（`in` / `not_in`）。

类型口径：

- 字段类型取该函数 `response` 中该字段声明的 `type`；
- **字段未声明 `type` → 不限制运算符**（全集可选，按字符串处理）；
- 未列入矩阵的运算符（`eq` / `ne` / `empty` / `not_empty`）不限类型。

## 5. 字段路径 `field`

### 5.1 语法

```
path    := segment ('.' segment)*
segment := name ['[]']
```

| 形态 | 含义 |
| :-- | :-- |
| `pass` | 顶层字段 |
| `detail.qty` | 嵌套对象字段 |
| `items[].qty` | 数组元素层字段（`[]` 表示"该层元素"） |
| `items` | 数组容器本身，也是合法字段（配 `contains` / `empty` 等使用） |

多层数组按同一规则叠加，如 `a[].b[].c`。

### 5.2 返回结构两种形态

| 函数来源 | `response` 形态 | 解析方式 |
| :-- | :-- | :-- |
| 本体函数 | 直接是属性映射 `{pass: {type: boolean, title: 判断结果}}` | 视为顶层 `properties` |
| 公共函数 | JSON Schema `{type: "object", properties: {...}}` | 先解包 `properties` |

派生规则（决定哪些路径可选）：

1. 节点含 `properties` → 继续下钻，路径追加 `.字段名`；
2. 节点 `type=array` 且含 `items.properties` → 路径**先追加 `[]`**，再下钻其属性；
3. 其余为叶子；
4. 数组容器节点本身也计入可选字段（前端标记为分组，仅影响缩进展示）。

字段可选项附带信息：`path`（落盘值）、`label`（`title`，缺省回退字段名）、`type`（声明类型，可能为空）、可用运算符（按上表过滤）。

## 6. 取值 `values`

- **落盘恒为字符串数组**：`"true"` / `"3"` 不转成 boolean / number，避免 YAML 中 `true` 与 `"true"` 并存。
- 类型解释留给展示或消费侧：目标类型由字段声明 `type` 决定，而非值的外形。
- 个数由运算符决定（见 §4）；后端只校验**个数**，不校验内容，空串合法。
- 前端保存前按运算符裁剪/补齐取值（多余值丢弃、缺失补空），并去文案首尾空白。
- 新增条件的默认值：

| 字段类型 | 默认运算符 | 默认取值 |
| :-- | :-- | :-- |
| `boolean` | `eq` | `["true"]` |
| `number` / `integer` | `eq` | `["0"]` |
| `string` / 未声明类型 | `eq` | `[""]` |
| `between` | — | `["0", "0"]` |
| `empty` / `not_empty` | — | `[]` |

## 7. 上限与文案

| 项 | 约束 |
| :-- | :-- |
| 条件组数 | ≤ 5 |
| 每组条件数 | ≤ 5 |
| `pass_message` / `fail_message` | ≤ 30 字，按**码点**计数（与 Python `len` 同口径），超出硬截断/拦截 |
| 文案内容 | 可以是空串；不参与求值，只作判定说明 |

## 8. 归一化与校验口径

### 8.1 读时归一（Pydantic，静默，不报错）

| 字段 | 非法值处理 |
| :-- | :-- |
| `combine`（根 / 组） | 非 `and` / `or` → 归一为空串 `""`；读侧按 `and` 处理 |
| `operator` | 不在运算符全集 → 归一为空串 `""` |
| `values` | 非数组 → 单值包裹为数组；元素统一转字符串 |
| 空条件组 | 保存时被静默剔除（不落空组） |
| 整段空设计 | 无组且无文案（或 `{}` / 字符串形态）→ `None`，不落盘 |

### 8.2 写时强校验（业务层，返回 400）

按顺序校验：

| # | 校验项 | 失败后果 |
| :-: | :-- | :-- |
| 1 | 至少 1 个条件组 | 400「规则设计没有任何条件组」 |
| 2 | 组数 ≤ 5 | 400 |
| 3 | 根 `combine` 合法（非空） | 400 |
| 4 | 每组至少 1 条条件、条数 ≤ 5、组 `combine` 合法 | 400 |
| 5 | 条件 `function` ∈ 该规则 `related_functions` | 400 |
| 6 | `function` 存在于「本体函数 ∪ 公共函数」 | 400 |
| 7 | `field` 可在该函数 `response` 中逐层解析 | 400 |
| 8 | `operator` 合法且适配字段类型（字段无类型时跳过类型检查） | 400 |
| 9 | `values` 个数匹配运算符要求 | 400 |
| 10 | 两段文案 ≤ 30 字 | 400（不用 Pydantic `max_length`，避免 422） |

校验错误定位口径：后端用「第 N 组第 M 条」，前端用 `g{i}`（组级）/ `g{i}c{j}`（条件级）。

### 8.3 空设计 / 边界口径

| 输入 | 结果 |
| :-- | :-- |
| 字段缺省 / `null` | 视为未设计 |
| `{}` | 归一为 `None`，不落盘 |
| 只有空组（组内无条件） | 空组剔除；若无组且无文案 → `None` |
| 有文案但无任何组 | **保留**，写侧 400（不静默丢文案） |
| 函数被从 `related_functions` 移除 | 既有条件成悬空引用，前端标红、保存被拦截 |

## 9. 常量汇总

| 常量 | 值 |
| :-- | :-- |
| 条件组上限 | 5 |
| 每组条件上限 | 5 |
| 文案长度上限 | 30 码点 |
| 连接符合集 | `and` / `or` |
| 运算符全集 | `eq` `ne` `gt` `gte` `lt` `lte` `between` `contains` `not_contains` `starts_with` `ends_with` `matches` `in` `not_in` `empty` `not_empty` |

---

**权威来源**：`core-backend/schemas/__init__.py`（模型与运算符矩阵）、`core-backend/services/rule_design.py`（字段派生）、`core-backend/services/validators.py::validate_rule_design`（写侧校验）、`frontend/src/components/Design/rule/rule-design.ts`（前端同口径实现）、`specs/contracts/ontology-yaml.md`「规则设计」节。
