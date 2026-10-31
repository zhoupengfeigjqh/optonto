def run(params: dict) -> dict:
    """
    校验采购单的到位时间（arrivalTime）是否晚于采购发生日（当前日期）。

    本函数服务于前置规则 V03：采购单的到位时间必须严格晚于采购发生日，
    即到位时间必须是在采购发生日之后的一个日期。若到位时间早于或等于
    采购发生日，则判断不通过，系统将拒绝主行为。

    Params:
        arrivalTime: str，到位时间，格式为 YYYY-MM-DD，例如 "2023-11-10"
        currentDate: str，采购发生日（当前日期），格式为 YYYY-MM-DD，例如 "2023-10-27"

    Returns:
        dict: {"success": True, "data": {"pass": bool, "reason": str}, "error": None}
    """
    import datetime

    arrival_time = params["arrivalTime"]
    current_date = params["currentDate"]

    try:
        arrival_dt = datetime.datetime.strptime(arrival_time, "%Y-%m-%d")
        current_dt = datetime.datetime.strptime(current_date, "%Y-%m-%d")
    except (ValueError, TypeError) as e:
        return {
            "success": False,
            "data": None,
            "error": {
                "code": "INVALID_DATE_FORMAT",
                "message": f"日期格式不合法，应为 YYYY-MM-DD：{e}",
            },
        }

    if arrival_dt > current_dt:
        return {
            "success": True,
            "data": {
                "pass": True,
                "reason": f"到位时间 {arrival_time} 晚于采购发生日 {current_date}，校验通过",
            },
            "error": None,
        }
    else:
        return {
            "success": True,
            "data": {
                "pass": False,
                "reason": f"到位时间 {arrival_time} 未晚于采购发生日 {current_date}，校验不通过",
            },
            "error": None,
        }