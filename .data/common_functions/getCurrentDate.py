def run(params: dict) -> dict:
    """获取当前日期"""
    from datetime import date
    return {"result": {"date": str(date.today())}}
