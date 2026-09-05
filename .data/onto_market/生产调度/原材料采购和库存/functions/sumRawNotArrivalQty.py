def run(params: dict) -> dict:
    """
    根据传入的数据包指定的原材料，过滤掉到位时间小于当前时间的部分，对剩余部分的到位数arrivalQuantity求和

    Params:
        filterRawMaterialName: str，原材料名称
        currentDate: str，日期，格式为YYYY-MM-DD
        purchaseRecordSet: list，采购记录列表，每条记录包含rawMaterialName, arrivalTime, arrivalQuantity

    Returns:
        dict: 返回包含原材料名称和未到货总数量的字典
    """
    import datetime
    filter_raw_material_name = params.get("filterRawMaterialName")
    current_date_str = params.get("currentDate")
    purchase_record_set = params.get("purchaseRecordSet") or []
    total_not_arrival = 0
    current_date = datetime.datetime.strptime(current_date_str, "%Y-%m-%d")
    for record in purchase_record_set:
        if record["rawMaterialName"] == filter_raw_material_name:
            arrival_time = datetime.datetime.strptime(record["arrivalTime"], "%Y-%m-%d")
            if arrival_time >= current_date:
                total_not_arrival += record["arrivalQuantity"]
    return {"result": {"rawMaterialName": filter_raw_material_name, "sumNotArrivalQty": total_not_arrival}}
