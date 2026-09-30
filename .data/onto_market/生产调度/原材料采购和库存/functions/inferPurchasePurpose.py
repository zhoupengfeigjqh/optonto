def run(params: dict) -> dict:
    """
    根据关联客户订单推导采购目的：未关联客户订单 → 补充库存；否则 → 生产订单备料。
    规则推导函数（后置规则 I03，type=CALCULATION：只产出结论、不参与主行为阻断）。

    Params:
        relatedOrderId: str，采购单填写的关联客户订单编号（可为空）

    Returns:
        dict: {success: True, data: {purchasePurpose: str, reason: str}}
    """
    related_order_id = params.get("relatedOrderId")
    if not related_order_id:
        return {"success": True, "data": {"purchasePurpose": "补充库存", "reason": "该采购单未关联具体客户订单，采购目的视为补充库存"}, "error": None}
    return {"success": True, "data": {"purchasePurpose": "生产订单备料", "reason": "该采购单关联客户订单 %s，采购目的视为生产订单备料" % related_order_id}, "error": None}
