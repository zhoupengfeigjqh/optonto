"""函数代码智能生成提示词（自 prompts.py 拆分而来，spec 003 T603）。"""

# ─── 函数代码 — 智能生成提示词 ──────────────────────────────────────────────────

FUNCTION_CODE_SYSTEM_PROMPT = "你是一个Python计算代码生成专家，只输出代码，不输出其他内容。"

FUNCTION_CODE_PROMPT = """根据以下函数定义生成 Python 计算代码。

函数名称：{name}
计算逻辑：{description}
输入参数：{params}
返回结构：{response}

【要求】
1. 只生成一个入口函数，签名固定为：def run(params: dict) -> dict:（与公共函数统一约定，函数名不要再用 {name}）
2. 在 run 函数体内取参：必填参数用 params['key']（缺参立即报错），可选参数才用 params.get('key', 默认值)；key 取输入参数的第一层键名，嵌套的不取，键名与输入参数中的 key 完全一致（可含驼峰），不得修改
3. 所有 import 必须写在 run 函数体内部（执行环境为受限 exec，模块级 import 对函数体不可见）
4. 涉及日期时，如最新日期，请用函数工具包，不要自己生成
5. 函数注释用 Params: 段逐条说明 params 字典的键（键名，类型：描述；不要写成 Args:——函数签名只有 params 一个参数）；并且重点描述一下函数功能和应用场景
6. 返回值必须使用统一信封结构（禁止旧的 {{"result": ...}} 包装）：
   - 成功：return {{"success": True, "data": <按返回结构组装的业务数据>, "error": None}}
   - 业务失败（参数不合法/数据不可用等可预期失败）：return {{"success": False, "data": None, "error": {{"code": "<语义码>", "message": "<失败原因>"}}}}
   - 未预期异常（代码缺陷/环境问题）：不要捕获吞掉，直接让其抛出——系统会把异常转为工具错误并走重试通道
   - 若本函数类型为 VALIDATION（逻辑验证）：data 内必须返回 {{"pass": bool, "reason": str}}——该型函数被规则引用时作为**判断函数**执行真阻断（前置规则 pass=False 或缺 pass 字段将拒绝主行为）；判断「不通过」用 data.pass=False 表达，严禁用 raise 表达（raise 属系统故障，会走重试通道而非判断拒绝）
7. 代码必须是可直接运行的 Python 3 代码
8. 只输出代码本身，不要任何解释或 markdown 标记

【示例】
def run(params: dict) -> dict:
    \"\"\"
    计算指定原材料在指定日期之后未到货的总数量

    Params:
        filterRawMaterialName: str，要筛选的原材料名称
        currentDate: str，当前日期，用于比较到货时间
        purchaseRecordSet: list，采购记录列表，每条记录为字典，包含 rawMaterialName, arrivalTime, arrivalQuantity

    Returns:
        dict: {{"success": True, "data": {{"rawMaterialName": ..., "sumNotArrivalQty": ...}}, "error": None}}
    \"\"\"
    import datetime
    # 必填参数用 params['key']：缺参立刻 KeyError 在现场炸；可选参数才用 params.get('key', 默认值)
    filter_raw_material_name = params["filterRawMaterialName"]
    current_date = params["currentDate"]
    purchase_record_set = params["purchaseRecordSet"]
    total_not_arrival = 0
    for record in purchase_record_set:
        if (
            record["rawMaterialName"] == filter_raw_material_name
            and datetime.datetime.strptime(record["arrivalTime"], "%Y-%m-%d") >= datetime.datetime.strptime(current_date, "%Y-%m-%d")
        ):
            total_not_arrival += record["arrivalQuantity"]
    return {{"success": True, "data": {{"rawMaterialName": filter_raw_material_name, "sumNotArrivalQty": total_not_arrival}}, "error": None}}"""
