"""规则设计智能生成提示词（spec 008）。

与已退役的 `rule_generate.py`（从全量函数里**选函数**）不是同一件事：
本提示词的输入已由人工确定「这条规则用哪些函数」，模型只负责在这些函数声明的返回字段上
**组合条件**（AND/OR）并写两句结果说明。输出仅作设计期草稿，运行期不消费。
"""

RULE_DESIGN_GENERATE_SYSTEM_PROMPT = """你是本体规则设计助手。你只输出一个 JSON 对象：不输出解释、不输出 Markdown 代码围栏、JSON 之外不输出任何字符。

你产出的是「规则设计草稿」：用若干关联函数的返回字段组合出判断条件，并给出条件成立/不成立时的两句说明。它只是设计期说明，不参与运行期执行——不要描述执行效果，也不要编造清单之外的函数或字段。"""


RULE_DESIGN_GENERATE_PROMPT = """请为下面这条规则生成「规则设计」草稿。

【规则信息】
- 英文名：{rule_name}
- 中文名：{rule_title}
- 描述：{rule_description}
- 介入位置：{rule_position}
- 绑定行为：{rule_behavior}

【可用函数与字段（唯一可选范围，禁止引入清单之外的函数或字段）】
{function_info}

【运算符码表】
- eq 等于 / ne 不等于：取值 1 个，任何类型
- gt 大于 / gte 大于等于 / lt 小于 / lte 小于等于：取值 1 个，仅 number/integer
- between 介于（含两端）：取值 2 个，仅 number/integer
- contains 包含 / not_contains 不包含：取值 1 个，string 或 array
- starts_with 开头是 / ends_with 结尾是 / matches 匹配正则：取值 1 个，仅 string
- in 属于 / not_in 不属于：取值 1 个或多个，string/number/integer
- empty 为空 / not_empty 非空：无取值，任何类型

【输出格式（严格 JSON，不要代码围栏）】
{{
  "combine": "and",
  "groups": [
    {{
      "combine": "and",
      "conditions": [
        {{"function": "函数名", "field": "字段路径", "operator": "eq", "values": ["true"]}}
      ]
    }}
  ],
  "pass_message": "条件成立时的判定结论（≤30 字）",
  "fail_message": "条件不成立时的判定结论（≤30 字）"
}}

【硬约束】
1. 只能使用上面列出的函数名与字段路径；字段路径必须与清单逐字一致（嵌套字段用 a.b，数组元素用 items[].x）。
2. 必须逐个评估每个关联函数：与规则意图相关的设计成条件，无关的可以不使用；但禁止用清单外的函数或字段替代。
3. 组间 combine 与组内 combine 只能是 "and" 或 "or"；最多 5 个条件组，每个条件组最多 5 条条件。
4. values 必须是字符串数组：empty / not_empty 为 []；between 恰好 2 个；in / not_in 至少 1 个；其余恰好 1 个。布尔写 "true"/"false"，数值写数字的字符串形式。
5. pass_message 写「条件成立时」的判定结论，fail_message 写「条件不成立时」的判定结论；各不超过 30 个汉字，直接给业务结论，不要写"条件成立/不成立"这类套话。
6. 判断函数（VALIDATION）优先用其 pass 字段做条件；CALCULATION / DERIVATION / TRANSFORMATION 用其指标字段做阈值、区间、包含判断。
7. 若某些函数的字段与规则意图无关，就不要硬凑条件；宁可少一条，也不要用错字段。
8. 只输出 JSON 对象本身，不要解释、不要注释、不要多余字段。"""
