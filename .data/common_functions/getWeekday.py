def run(params: dict) -> dict:
    """返回日期是星期几（1=周一，7=周日）"""
    from datetime import datetime
    d = datetime.strptime(params["date"], "%Y-%m-%d")
    weekday = d.weekday() + 1  # Monday=0 → 1, Sunday=6 → 7
    names = {1: "周一", 2: "周二", 3: "周三", 4: "周四", 5: "周五", 6: "周六", 7: "周日"}
    return {"result": {"weekday": weekday, "name": names[weekday]}}
