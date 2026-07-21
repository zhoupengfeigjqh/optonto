import datetime

def sumRawNotArrivalQty(filterRawMaterialName: str, currentDate: str, purchaseRecordSet: list) -> dict:
    """
    根据传入的数据包指定的原材料，过滤掉到位时间小于当前时间的部分，对剩余部分的到位数arrivalQuantity求和

    Args:
        filterRawMaterialName: str，原材料名称
        currentDate: str，日期，格式为YYYY-MM-DD
        purchaseRecordSet: list，采购记录列表，每条记录包含rawMaterialName, arrivalTime, arrivalQuantity

    Returns:
        dict: 返回包含原材料名称和未到货总数量的字典
    """
    total_not_arrival = 0
    current_date = datetime.datetime.strptime(currentDate, "%Y-%m-%d")
    for record in purchaseRecordSet:
        if record["rawMaterialName"] == filterRawMaterialName:
            arrival_time = datetime.datetime.strptime(record["arrivalTime"], "%Y-%m-%d")
            if arrival_time >= current_date:
                total_not_arrival += record["arrivalQuantity"]
    return {"result": {"rawMaterialName": filterRawMaterialName, "sumNotArrivalQty": total_not_arrival}}