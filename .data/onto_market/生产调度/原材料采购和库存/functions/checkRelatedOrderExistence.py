def run(params: dict) -> dict:
    """
    校验采购单的关联客户订单：未填写时通过；填写时必须存在于客户订单集合。
    规则判断函数（前置规则 I04）：data.pass=False 表示判断不通过，系统将拒绝主行为。

    注意：客户订单数据需由外部提供（场景内客户订单所属本体的查询行为）；
    本本体暂无客户订单查询行为，未取到数据时不做阻断（pass=True），仅在 reason 中明确说明校验未执行。

    Params:
        relatedOrderId: str，采购单填写的关联客户订单编号（可为空）
        customerOrderSet: list，客户订单集合，每条记录包含 customerOrderId

    Returns:
        dict: {success: True, data: {pass: bool, reason: str}}
        判断不通过必须用 data.pass=False 表达，禁止 raise
    """
    related_order_id = params.get("relatedOrderId")
    customer_order_set = params.get("customerOrderSet") or []
    if not related_order_id:
        return {"success": True, "data": {"pass": True, "reason": "未关联客户订单，校验通过"}, "error": None}
    ids = [c.get("customerOrderId") for c in customer_order_set if isinstance(c, dict)]
    if not ids:
        return {"success": True, "data": {"pass": True, "reason": "未取到客户订单数据，关联订单 %s 的存在性校验未执行（本本体暂无客户订单查询行为，需由客户订单所属本体提供数据）" % related_order_id}, "error": None}
    if related_order_id in ids:
        return {"success": True, "data": {"pass": True, "reason": "关联订单 %s 存在于客户订单中" % related_order_id}, "error": None}
    return {"success": True, "data": {"pass": False, "reason": "关联订单 %s 不存在于客户订单中，该采购单创建无效，请中止" % related_order_id}, "error": None}
