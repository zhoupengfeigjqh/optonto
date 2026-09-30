def run(params: dict) -> dict:
    """获取当前日期"""
    from datetime import date
    return {"success": True, "data": {"date": str(date.today())}, "error": None}
