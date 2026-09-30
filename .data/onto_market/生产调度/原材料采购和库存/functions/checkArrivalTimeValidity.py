def run(params: dict) -> dict:
    """
    校验采购单的到位时间必须晚于采购发生日（以当前日期为采购发生基准）。
    规则判断函数（前置规则 V03）：data.pass=False 表示判断不通过，系统将拒绝主行为。

    Params:
        arrivalTime: str，采购单提供的到位时间，格式 YYYY-MM-DD
        currentDate: str，当前日期（采购发生日），格式 YYYY-MM-DD，由公共函数 getCurrentDate 取得

    Returns:
        dict: {success: True, data: {pass: bool, reason: str}}
        判断不通过必须用 data.pass=False 表达，禁止 raise
    """
    import datetime
    arrival_time = params.get("arrivalTime")
    current_date = params.get("currentDate")
    if not arrival_time or not current_date:
        return {"success": True, "data": {"pass": False, "reason": "缺少到位时间或当前日期，无法校验到位时间合理性"}, "error": None}
    try:
        arr = datetime.datetime.strptime(str(arrival_time), "%Y-%m-%d")
        cur = datetime.datetime.strptime(str(current_date), "%Y-%m-%d")
    except ValueError:
        return {"success": True, "data": {"pass": False, "reason": "日期格式不合法（需 YYYY-MM-DD）：arrivalTime=%s, currentDate=%s" % (arrival_time, current_date)}, "error": None}
    if arr <= cur:
        return {"success": True, "data": {"pass": False, "reason": "到位时间 %s 必须晚于采购发生日 %s" % (arrival_time, current_date)}, "error": None}
    return {"success": True, "data": {"pass": True, "reason": "到位时间 %s 晚于采购发生日 %s" % (arrival_time, current_date)}, "error": None}
