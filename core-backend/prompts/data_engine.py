"""数据引擎（智能映射 / 智能对齐 / 目标接口解析）提示词（自 prompts.py 拆分而来，spec 003 T603）。"""

# ─── 数据引擎 — 智能映射提示词 ──────────────────────────────────────────────────

MAPPING_ANALYSIS_SYSTEM_PROMPT = "你是一个字段映射专家。只输出JSON，不输出其他内容。"

MAPPING_ANALYSIS_PROMPT = """将目标系统API接口输入输出字段，与本体字段进行智能匹配。

【输入参数映射】
- 本体字段: {onto_input_fields}
- 目标字段: {target_input_fields}

【输出结构映射】
- 本体字段: {onto_output_fields}
- 目标字段: {target_output_fields}

【任务】
1. 本体字段固定，根据字段名称的语义相似度，为每个本体字段匹配最合适的目标字段
2. 匹配完成后，分析存在的问题（无匹配目标字段、类型不匹配、必填与可选不匹配等）

【匹配规则】
- 绝不修改任何字段名称，只输出匹配关系
- 没找到与本体字段语义相似的目标字段时，目标字段留空
- 优先匹配具有相同嵌套结构的字段。例如带 [*] 的字段表示数组元素内部字段，优先匹配同样带 [*] 或语义对应的目标字段
- **数组容器行与其元素行必须一起给出**：输出 `data[*].lines[*].prod` → `result[*].items[*].prod_name` 时，
  必须同时输出容器映射 `data[*].lines` → `result[*].items`（逐层容器都要有）；
  数组元素为标量时（如 `data[*].tags[*]`），容器映射 `data[*].tags` → `result[*].labels` 是唯一有效的换名手段
  ——元素行本身不参与任何字段名改写。缺任意一层容器，该层字段名就会停留在目标系统的名字上。
- 分析一下1）本体无法映射的字段，2）类别不匹配的字段（如本体为string，但目标api为number），3）目标API输入参数必填（required为true）但本体缺失的字段，加色提示！。将分析结果结构化输出，不要混杂不利于查看！

严格按以下JSON格式输出，不要任何解释：
{{"input_mapping": {{"本体参数字段": "目标参数字段"}}, "output_mapping": {{"本体返回字段": "目标返回字段"}}, "status": "ok"或"warning"或"error", "message": "分析结论", "issues": ["问题描述"]}}"""


# ─── 数据引擎 — 智能对齐提示词 ──────────────────────────────────────────────────

ALIGNMENT_SYSTEM_PROMPT = "你是数据结构的对齐专家。仅输出JSON，不附带任何解释。"

ALIGNMENT_PROMPT = """修改本体行为输入输出的数据结构，使之与目标系统API接口的数据结构对齐，千万不得修改其中的字段名和类型。

【本体行为输入输出】
- 输入: {ontology_params}
- 输出: {ontology_response}

【目标接口输入输出】
- 输入: {target_params}
- 输出: {target_response}

【对齐原则】
1. 本体行为输入输出的字段名和类型不增、不减、不改。
2. 仅调整嵌套层级、分组方式等结构布局，使其与目标接口的组织形式一致。
3. 目标接口独有的字段不添加，本体接口独有的字段不删除。

输出格式（仅JSON）：
{{"params": {{...}}, "response": {{...}}}}"""


# ─── 数据引擎 — 目标接口智能解析提示词 ──────────────────────────────────────────────────

TARGET_PARSE_SYSTEM_PROMPT = "你是一个API接口文档解析专家。只输出JSON，不输出其他内容。"

TARGET_PARSE_PROMPT = """根据用户提供的目标系统API接口文档片段，解析接口名称、地址、请求方法、数据源名称、输入和输出等内容。

【标准参考模板】（参考模板的参数和返回结构，按此结构解析目标接口）
输入参数: {template_params}
返回结构: {template_response}

【解析规则（严格遵守）】
1. 请参考标准模板中的例子进行解析，要学会举一反三，灵活运用
2. 参数中的type 只能是: string / number / boolean / enum / array / object
3. 如果文档没有明确类型，根据示例值推断（数字→number，true/false→boolean，对象→object，列表→array）
4. 如果文档没有示例值，根据描述和类型生成一个合理的中文示例值
5. 对于required字段，如果文档中没有明确标注，则默认选填（false）
6. 从文档中提取接口名称（api_name）、数据源名称（data_source_name）、接口地址（url）和请求方法（method，GET/POST/PATCH/DELETE四选一），找不到则为空字符串
7. 不要做任何额外的增减操作，也不要输出任何解释或注释。

【用户提供的参数文档】
{params_content}

【用户提供的返回结构文档】
{response_content}

严格按以下JSON格式输出：
{{"api_name": "接口名称或空字符串", "data_source_name": "数据源名称或空字符串", "url": "接口地址或空字符串", "method": "GET/POST/PATCH/DELETE或空字符串", "params": {{...}}, "response": {{...}}}}"""
