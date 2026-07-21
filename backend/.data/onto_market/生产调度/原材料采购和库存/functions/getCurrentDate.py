import datetime

def getCurrentDate():
    """
    获取当前日期信息

    Args:
        无参数

    Returns:
        dict: 返回包含当前日期的字典
    """
    current_date = datetime.date.today().strftime("%Y-%m-%d")
    return {"result": {"date": current_date}}