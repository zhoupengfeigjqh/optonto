def run(params: dict) -> dict:
    """日期加减指定天数"""
    from datetime import datetime, timedelta
    d = datetime.strptime(params["date"], "%Y-%m-%d")
    result = d + timedelta(days=params["days"])
    return {"result": {"date": result.strftime("%Y-%m-%d")}}
