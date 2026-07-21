def sumRawNotArrivalQty(params: dict) -> dict:
    from datetime import datetime, date
    now = datetime.now().date()
    total = 0
    raw_material_name = ""
    for item in params.get("purchaseRecordSet", []):
        arrival_time_str = item.get("arrivalTime", "")
        if arrival_time_str:
            arrival_time = datetime.strptime(arrival_time_str, "%Y-%m-%d").date()
            if arrival_time >= now:
                total += item.get("arrivalQuantity", 0)
                raw_material_name = item.get("rawMaterialName", "")
    return {"rawMaterialName": raw_material_name, "sumNotArrivalQty": total}