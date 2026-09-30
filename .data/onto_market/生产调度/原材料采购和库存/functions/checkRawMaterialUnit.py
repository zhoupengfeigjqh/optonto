def run(params: dict) -> dict:
    """
    校验采购单参数：rawMaterialId 必须存在于原材料主数据，且 unit 与该原材料定义单位一致。
    规则裁决函数（前置规则 V01）：data.pass=False 表示裁决不通过，系统将拒绝主行为。

    Params:
        rawMaterialId: str，采购单提供的原材料ID
        unit: str，采购单提供的计量单位
        rawMaterialSet: list，原材料主数据列表，每条记录包含 rawMaterialId 与 unit

    Returns:
        dict: {success: True, data: {pass: bool, reason: str}}
        注意：裁决不通过必须用 data.pass=False 表达，禁止 raise（raise 属系统故障，走重试通道）
    """
    raw_material_id = params.get("rawMaterialId")
    unit = params.get("unit")
    raw_material_set = params.get("rawMaterialSet") or []
    matched = [r for r in raw_material_set if isinstance(r, dict) and r.get("rawMaterialId") == raw_material_id]
    if not matched:
        return {"success": True, "data": {"pass": False, "reason": "原材料ID %s 不存在于原材料主数据" % raw_material_id}, "error": None}
    defined_unit = matched[0].get("unit")
    if unit != defined_unit:
        return {"success": True, "data": {"pass": False, "reason": "单位不一致：采购单为 %s，原材料定义为 %s" % (unit, defined_unit)}, "error": None}
    return {"success": True, "data": {"pass": True, "reason": "原材料存在且单位一致"}, "error": None}
