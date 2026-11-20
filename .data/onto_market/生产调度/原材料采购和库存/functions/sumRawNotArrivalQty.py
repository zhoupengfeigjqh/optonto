def run(params: dict) -> dict:
    """
    计算指定原材料在指定日期之后（含当日）尚未到位的计划到位数量总和。

    应用场景：采购计划跟踪、物料齐套分析、缺料预警等。根据原材料名称筛选采购记录，
    过滤掉到位时间早于当前日期的记录（即已到期部分），对剩余记录的计划到位数量求和，
    得到该原材料的未到位总量。

    Params:
        filterRawMaterialName: str，要筛选的原材料名称，必填
        currentDate: str，当前日期（格式 YYYY-MM-DD），用于与到位时间比较，必填
        purchaseRecordSet: list，采购记录列表，每条记录为字典，包含 rawMaterialName（原材料名称）、
            arrivalTime（到位时间，格式 YYYY-MM-DD）、arrivalQuantity（计划的到位数量），必填

    Returns:
        dict: 统一信封结构，成功时 data 为 {"rawMaterialName": str, "sumNotArrivalQty": number}
    """
    import datetime

    filter_raw_material_name = params["filterRawMaterialName"]
    current_date = params["currentDate"]
    purchase_record_set = params["purchaseRecordSet"]

    if not isinstance(filter_raw_material_name, str) or not filter_raw_material_name:
        return {"success": False, "data": None, "error": {"code": "INVALID_PARAM", "message": "原材料名称不能为空"}}
    if not isinstance(purchase_record_set, list):
        return {"success": False, "data": None, "error": {"code": "INVALID_PARAM", "message": "采购记录集必须为列表"}}

    try:
        current_dt = datetime.datetime.strptime(current_date, "%Y-%m-%d")
    except (ValueError, TypeError):
        return {"success": False, "data": None, "error": {"code": "INVALID_DATE", "message": "日期格式不合法，应为 YYYY-MM-DD"}}

    total_not_arrival = 0
    for record in purchase_record_set:
        if record.get("rawMaterialName") != filter_raw_material_name:
            continue
        arrival_time = record.get("arrivalTime")
        try:
            arrival_dt = datetime.datetime.strptime(arrival_time, "%Y-%m-%d")
        except (ValueError, TypeError):
            return {"success": False, "data": None, "error": {"code": "INVALID_DATE", "message": "到位时间格式不合法：%s" % arrival_time}}
        if arrival_dt >= current_dt:
            total_not_arrival += record.get("arrivalQuantity", 0)

    return {
        "success": True,
        "data": {"rawMaterialName": filter_raw_material_name, "sumNotArrivalQty": total_not_arrival},
        "error": None,
    }