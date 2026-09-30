"""本体 YAML 生成提示词（自 prompts.py 拆分而来，spec 003 T603）。"""

# ─── 本体生成提示词 ───────────────────────────────────────────────────────
# 用于 "智能生成本体" 功能，将需求文档转为 ontology.yaml

ONTOLOGY_GENERATE_SYSTEM_PROMPT = "你是一个本体建模专家，只输出YAML，不输出其他内容。"

ONTOLOGY_GENERATE_PROMPT_TEMPLATE = """你是一个本体建模专家。请根据以下需求分析文档和YAML模板，生成完整的ontology.yaml文件。

要求：
1. 严格遵循模板的YAML结构和字段顺序
2. 概念名name使用英文（首字母大写），display_name使用中文
3. 属性类型只能为：string / number / integer / boolean / object / array 六选一；枚举值通过 constraint.enum 表达，不得把 enum 当作 type 使用
4. 基数只能为：1:N / N:1 / N:M / '1:1'
5. 行为操作类型（op_type）只能为：command（命令，写操作/增删改）/ query（查询，只读），二选一
6. 规则不设类型字段：`rule_type` 已移除，禁止输出
7. **模板与字段纪律**：严格以模板的结构、字段名与字段顺序为准——模板中的示例值必须**替换**为本体真实内容（模板是骨架，不是成品）；不得增删字段、不得改动字段名或顺序、不得添加注释；`params` 项的说明字段按模板固定：**行为用 `description`、函数用 `display_name`**，不得互换
8. 确保YAML格式正确，可以被yaml.safe_load解析
9. 不得虚构补全：需求文档未涉及的概念/属性/关系/行为/函数/规则/流程，一律不要生成
10.模板中未出现的字段一律不得输出（如行为不得带 method 等已移除字段）；所有取值必须落在上文各条给出的值域内
11.metadata固定为以下7个字段，**顺序不得调整**，且每个字段的值**原样引用**下方【来源信息】中给出的值，禁止改写、禁止留空：
   source_file（来源需求文件）｜source_thread（来源会话名称）｜created_at（创建日期）｜scenario_name（场景名）｜scenario_id（场景ID）｜ontology_name（本体名）｜ontology_id（本体ID）
   **禁止输出 name 字段，也禁止新增任何其他字段**
12.每条关系必须填写关联概念属性source_attr/target_attr：必须是源概念和目标概念中真实存在的属性英文名，且两端属性类型一致；以「源概念.属性英文名 = 目标概念.属性英文名」的对应关系填写（source_attr填源端属性，target_attr填目标端属性）
13.**属性约束统一写在 `constraint` 对象内**（键固定为 unique / required / enum / pattern / min / max，只写有意义的键，不要写空值）：unique（是否唯一）/ required（是否非空）为布尔——**必须写在 `constraint` 内，不得写在属性层级上**；enum 为取值受限的固定集合（字符串数组）；pattern 为匹配模式（正则，仅 string 类型）；min/max 为取值范围（仅 number/integer 类型，可只填其一）。无任何约束时**整块 `constraint` 省略**（不得写成 `constraint: ''`）；没有明确依据时不要臆造约束
14.**空节一律省略**：concepts / relations / functions / behaviors / rules / processes / securities / data_engines 中，凡是没有内容的节，直接整节删除，**禁止输出 `key: []` 这类空列表**
15.**本次允许输出的一级目录（硬约束，最高优先级）**：{allowed_sections}
   只允许输出上述目录（metadata 恒含在内）；**除此之外的一级目录一律禁止输出**，也不得输出其空列表。
   若某项写「不限」，则按需求文档实际涉及的内容自行判断。
16.**概念生命周期状态**：有生命周期的概念必须包含且只包含一个 status 属性——英文名固定为 `status`，类型固定为 `string`，状态全集填在 `constraint.enum`，并设 `constraint.required: true`；无生命周期的静态主数据概念可不含 status。禁止为凑合规而编造状态，禁止把状态写成 0/1、英文码或含「等」的开放表述。
17.**关系类型**：`relation_type` 只能从 asymmetric / symmetric / transitive / functional / inverse_functional 中多选（可只填一个、可留空），不得自造取值；且必须与基数自洽（`N:1`→functional、`1:N`→inverse_functional、`1:1`→两者都有、`N:M`→留空）；symmetric 与 asymmetric 不得同选；无把握时留空。
18.**函数类型**：函数的 `type` 只能为 TRANSFORMATION（格式转换）/ CALCULATION（指标计算）/ DERIVATION（属性派生）/ VALIDATION（逻辑验证）/ MODEL（机器学习模型，非训练），五选一。
19.**行为**：关联概念为单一值（字段 `concept`，禁止数组）；command 行为必须填写 `from_status` / `to_status`，取值必须来自其关联概念 status 属性的 `constraint.enum`（创建类行为 `from_status` 留空）；query 行为两者留空。
20.**规则**：绑定行为为单一值（字段 `behavior`，禁止数组）；规则的约束逻辑由 `related_functions`（关联函数列表）承载——只能引用本本体 `functions` 段已声明的函数名（或公共函数名）；其中**本体函数且 `type=VALIDATION` 者为判断函数**：其代码必须返回统一信封并在 data 内携带 `{{"pass": bool, "reason": str}}`（运行期规则闸据此真阻断主行为）；CALCULATION 等其他类型承担取数/计算；没有合适函数时留空数组。**禁止输出任何已废弃的历史字段**（旧条件树、独立裁决函数字段等一律不得生成；模板未定义的字段一律不得输出）；`data_supplements` 填规则判断需额外拉取的 query 行为名（可留空，前端按关联函数声明关联的概念自动推导）。
21.**概念术语集与实例标签**：概念可填 `terms`（术语集数组，该概念的其他表述，可为空，建议每概念 0-5 个）——只能填需求文档中实际出现过的其他说法，不得臆造或改写生成；概念还可填 `instance_label`（实例标签，可选，用于实例视图的节点标签）——取值**必须是该概念已定义属性的英文名**，无合适属性则留空，不得编造不存在的属性名。

【来源信息】
来源需求文件（source_file）：{source_file}
来源会话名称（source_thread）：{source_thread}
创建日期（created_at）：{created_at}
场景名（scenario_name）：{scenario_name}
场景ID（scenario_id）：{scenario_id}
本体名（ontology_name）：{ontology_name}
本体ID（ontology_id）：{ontology_id}

【YAML模板（已按本次勾选的一级目录裁剪，只加载下列内容）】
{template_content}

【需求分析文档】
{markdown_content}

【分段生成约束（重要）】
需求文档可能只描述了本体的某一部分（例如只讨论"行为"）。请只生成文档中**实际涉及**的顶层列表节（concepts、relations、behaviors、functions、rules、processes、securities、data_engines），其余节若文档未涉及，则**直接整节省略，不得输出空列表 `key: []`**，**不得虚构补全**。已涉及字段的内部约束仍按上方要求执行。metadata 节恒需输出（按上文第11条填写，字段固定7项）。

请输出ontology.yaml："""
