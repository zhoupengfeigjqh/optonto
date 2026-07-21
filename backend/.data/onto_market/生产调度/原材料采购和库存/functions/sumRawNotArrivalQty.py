def sumRawNotArrivalQty(filter_raw_material_name, current_date, purchase_record_set):
    from datetime import datetime
    total_not_arrival = 0
    current_date_obj = datetime.strptime(current_date, "%Y-%m-%d")
    for record in purchase_record_set:
        if record.get("rawMaterialName") == filter_raw_material_name:
            arrival_time_str = record.get("arrivalTime", "")
            if arrival_time_str:
                arrival_time_obj = datetime.strptime(arrival_time_str, "%Y-%m-%d")
                if arrival_time_obj >= current_date_obj:
                    total_not_arrival += record.get("arrivalQuantity", 0)
    return {"result": {"rawMaterialName": filter_raw_material_name, "sumNotArrivalQty": total_not_arrival}}