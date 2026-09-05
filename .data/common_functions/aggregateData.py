"""公共函数：聚合统计。对 JSON 数组进行数值聚合计算。

注意：import 与 helper 必须定义在 run() 内部——core 端 exec 执行时 globals/locals 分离，
模块级 import 的符号对函数体不可见。
"""


def run(params: dict) -> dict:
    """对JSON数组进行数值聚合统计

    支持的聚合函数: sum, avg, mean, count, count_distinct, min, max, std, var, median, mode
    """
    import pandas as pd
    import numpy as np
    from datetime import datetime, date

    def convert_to_json_serializable(obj):
        """将各种Python对象转换为JSON可序列化的格式"""
        if obj is None:
            return None
        if isinstance(obj, (str, int, float, bool)):
            return obj
        if isinstance(obj, (datetime, date)):
            return obj.isoformat()
        if isinstance(obj, (np.int64, np.int32, np.int16, np.int8)):
            return int(obj)
        if isinstance(obj, (np.float64, np.float32, np.float16)):
            return float(obj) if not np.isnan(obj) else None
        if isinstance(obj, np.bool_):
            return bool(obj)
        if isinstance(obj, pd.Timestamp):
            return obj.isoformat()
        if isinstance(obj, pd.Timedelta):
            return obj.total_seconds()
        if isinstance(obj, (pd.Series, pd.DataFrame)):
            return obj.to_dict()
        if isinstance(obj, dict):
            return {key: convert_to_json_serializable(value) for key, value in obj.items()}
        if isinstance(obj, (list, tuple)):
            return [convert_to_json_serializable(item) for item in obj]
        if isinstance(obj, (set, frozenset)):
            return list(obj)
        if isinstance(obj, (np.ndarray,)):
            return obj.tolist()
        return str(obj)

    try:
        data = params.get("data") or []
        aggregations = params.get("aggregations") or []

        if not data:
            return {"error": "数据为空", "code": 400}

        df = pd.DataFrame(data)
        if df.empty:
            return {"error": "数据为空", "code": 400}

        result = {}

        for agg in aggregations:
            field = agg.get("field")
            functions = agg.get("functions", [])
            alias = agg.get("alias")

            if field not in df.columns:
                return {"error": f"字段 '{field}' 不存在", "code": 400}

            col = df[field]
            is_numeric = pd.api.types.is_numeric_dtype(col)

            for func in functions:
                func_name = func.lower()
                key = alias if alias else f"{field}_{func_name}"

                try:
                    if func_name == "sum":
                        result[key] = float(col.sum()) if is_numeric else None
                    elif func_name in ["avg", "mean"]:
                        result[key] = float(col.mean()) if is_numeric else None
                    elif func_name == "count":
                        result[key] = int(col.count())
                    elif func_name == "count_distinct":
                        result[key] = int(col.nunique())
                    elif func_name == "min":
                        val = col.min() if not col.empty else None
                        result[key] = convert_to_json_serializable(val)
                    elif func_name == "max":
                        val = col.max() if not col.empty else None
                        result[key] = convert_to_json_serializable(val)
                    elif func_name == "std":
                        result[key] = float(col.std()) if is_numeric and len(col) > 1 else None
                    elif func_name == "var":
                        result[key] = float(col.var()) if is_numeric and len(col) > 1 else None
                    elif func_name == "median":
                        result[key] = float(col.median()) if is_numeric else None
                    elif func_name == "mode":
                        mode_val = col.mode()
                        result[key] = convert_to_json_serializable(
                            mode_val.iloc[0] if not mode_val.empty else None
                        )
                    else:
                        return {"error": f"不支持的聚合函数: {func}", "code": 400}
                except Exception:
                    result[key] = None

        result = convert_to_json_serializable(result)
        return {"result": result}

    except Exception as e:
        return {"error": str(e), "code": 500}
