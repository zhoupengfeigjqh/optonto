def sumRawNotArrivalQty(filter_raw_material_name:str, current_date:str, purchase_record_set:list):
    """
    计算指定原材料在指定日期之后未到货的总数量

    Args:
        filter_raw_material_name: str，要筛选的原材料名称
        current_date: str，当前日期，用于比较到货时间
        purchase_record_set: list，采购记录列表，每条记录为字典，包含 rawMaterialName, arrivalTime, arrivalQuantity

    Returns:
        dict: 返回包含原材料名称和未到货总数量的字典
    """
    from datetime import datetime
    total_not_arrival = 0
    current_date_obj = datetime.strptime(current_date, "%Y-%m-%d")
    for record in purchase_record_set:
        if record["rawMaterialName"] == filter_raw_material_name:
            arrival_time_obj = datetime.strptime(record["arrivalTime"], "%Y-%m-%d")
            if arrival_time_obj > current_date_obj:
                total_not_arrival += record["arrivalQuantity"]
    return {"result": {"rawMaterialName": filter_raw_material_name, "sumNotArrivalQty": total_not_arrival}}