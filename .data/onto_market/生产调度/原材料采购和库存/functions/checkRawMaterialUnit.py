def run(params: dict) -> dict:
    """
    校验采购单的原材料ID是否存在于原材料主数据，且计量单位与主数据定义一致（前置规则 V01）。

    应用场景：采购单提交/审批前的前置校验，确保采购的原材料已在主数据中登记，
    且采购单填写的计量单位与主数据定义的单位一致，避免后续入库、结算环节单位错配。

    Params:
        rawMaterialId: str，采购单中的原材料ID，必填
        unit: str，采购单中的计量单位，必填
        rawMaterialSet: list，原材料主数据集，每条记录为字典，包含 rawMaterialId、unit，必填

    Returns:
        dict: {"success": True, "data": {"pass": bool, "reason": str}, "error": None}
    """
    raw_material_id = params["rawMaterialId"]
    unit = params["unit"]
    raw_material_set = params["rawMaterialSet"]

    if not isinstance(raw_material_id, str) or not raw_material_id.strip():
        return {
            "success": False,
            "data": None,
            "error": {"code": "INVALID_RAW_MATERIAL_ID", "message": "原材料ID不能为空"},
        }
    if not isinstance(unit, str) or not unit.strip():
        return {
            "success": False,
            "data": None,
            "error": {"code": "INVALID_UNIT", "message": "计量单位不能为空"},
        }
    if not isinstance(raw_material_set, list):
        return {
            "success": False,
            "data": None,
            "error": {"code": "INVALID_RAW_MATERIAL_SET", "message": "原材料主数据集必须为列表"},
        }

    target = None
    for item in raw_material_set:
        if isinstance(item, dict) and item.get("rawMaterialId") == raw_material_id:
            target = item
            break

    if target is None:
        return {
            "success": True,
            "data": {
                "pass": False,
                "reason": "原材料ID {} 不存在于原材料主数据中".format(raw_material_id),
            },
            "error": None,
        }

    master_unit = target.get("unit")
    if master_unit != unit:
        return {
            "success": True,
            "data": {
                "pass": False,
                "reason": "计量单位不一致：采购单为 {}，原材料主数据定义为 {}".format(unit, master_unit),
            },
            "error": None,
        }

    return {
        "success": True,
        "data": {
            "pass": True,
            "reason": "原材料ID {} 存在且计量单位 {} 与主数据一致".format(raw_material_id, unit),
        },
        "error": None,
    }