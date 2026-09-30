def run(params: dict) -> dict:
    """
    校验采购单填写的供应商名称存在于供应商主数据（不得杜撰供应商）。
    规则判断函数（前置规则 V05）：data.pass=False 表示判断不通过，系统将拒绝主行为。

    Params:
        supplierName: str，采购单提供的供应商名称
        supplierSet: list，供应商主数据列表（由 QuerySuppliers 查询行为取得），每条记录包含 supplierName

    Returns:
        dict: {success: True, data: {pass: bool, reason: str}}
        判断不通过必须用 data.pass=False 表达，禁止 raise
    """
    supplier_name = params.get("supplierName")
    supplier_set = params.get("supplierSet") or []
    if not supplier_name:
        return {"success": True, "data": {"pass": False, "reason": "未提供供应商名称，无法校验供应商存在性"}, "error": None}
    names = [s.get("supplierName") for s in supplier_set if isinstance(s, dict)]
    if not names:
        return {"success": True, "data": {"pass": False, "reason": "未取到供应商主数据，无法校验供应商 %s 是否存在（请先查询供应商）" % supplier_name}, "error": None}
    if supplier_name in names:
        return {"success": True, "data": {"pass": True, "reason": "供应商 %s 存在于供应商主数据" % supplier_name}, "error": None}
    return {"success": True, "data": {"pass": False, "reason": "供应商 %s 不存在于供应商主数据，不得杜撰" % supplier_name}, "error": None}
