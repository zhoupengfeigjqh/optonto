def sumRawNotArrivalQty(params: dict) -> dict:
    filter_raw_material_name = params.get("filterRawMaterialName")
    current_date = params.get("currentDate")
    purchase_record_set = params.get("purchaseRecordSet", [])
    
    total_not_arrival = 0
    for record in purchase_record_set:
        if record.get("rawMaterialName") == filter_raw_material_name and record.get("arrivalTime", "") > current_date:
            total_not_arrival += record.get("arrivalQuantity", 0)
    
    return {
        "result": {
            "rawMaterialName": filter_raw_material_name,
            "sumNotArrivalQty": total_not_arrival
        }
    }