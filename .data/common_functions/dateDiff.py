def run(params: dict) -> dict:
    """计算两个日期相差天数"""
    from datetime import datetime
    start = datetime.strptime(params["startDate"], "%Y-%m-%d")
    end = datetime.strptime(params["endDate"], "%Y-%m-%d")
    return {"success": True, "data": {"days": (end - start).days}, "error": None}
