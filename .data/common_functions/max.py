"""公共函数：最大值。对 JSON 记录数组中指定属性取最大值（单指标便捷封装）。

与 aggregateData 的分工：本函数只算一个指标的极值，无需构造 aggregations 数组；
需要一次算多个指标/多字段时用 aggregateData。

注意：import 与 helper 必须定义在 run() 内部——core 端 exec 执行时 globals/locals 分离，
模块级 import 的符号对函数体不可见。
"""


def run(params: dict) -> dict:
    """取指定属性的最大值（非数值项忽略）"""
    import math

    def to_number(value):
        """数值归一：数值/数值字符串 → float；bool、空值、非数值 → None"""
        if value is None or isinstance(value, bool):
            return None
        if isinstance(value, (int, float)):
            number = float(value)
        elif isinstance(value, str):
            text = value.strip()
            if not text:
                return None
            try:
                number = float(text)
            except ValueError:
                return None
        else:
            return None
        if math.isnan(number) or math.isinf(number):
            return None
        return number

    try:
        data = params.get("data") or []
        field = params.get("field")

        if not data:
            return {"success": False, "data": None, "error": {"code": "EMPTY_DATA", "message": "数据为空"}}
        if not field:
            return {"success": False, "data": None, "error": {"code": "FIELD_REQUIRED", "message": "缺少属性名 field"}}

        hit = False
        values = []
        for record in data:
            if not isinstance(record, dict) or field not in record:
                continue
            hit = True
            number = to_number(record[field])
            if number is not None:
                values.append(number)

        if not hit:
            return {"success": False, "data": None, "error": {"code": "FIELD_NOT_FOUND", "message": f"字段 '{field}' 不存在"}}
        if not values:
            return {"success": False, "data": None, "error": {"code": "NO_NUMERIC_VALUES", "message": f"字段 '{field}' 没有有效数值"}}

        return {"success": True, "data": {"value": max(values), "count": len(values)}, "error": None}

    except Exception:
        raise  # 未预期异常上抛 → MCP 层置 isError（报错预算/重试通道），不吞成业务失败
