"""公共函数：筛选过滤。按条件数组过滤 JSON 记录集，支持 AND/OR 组合。

注意：import 与 helper 必须定义在 run() 内部——core 端 exec 执行时 globals/locals 分离，
模块级 import 的符号对函数体不可见。
"""


def run(params: dict) -> dict:
    """根据条件过滤JSON数组数据

    支持的操作符: eq, ne, gt, gte, lt, lte, in, not_in, contains,
                 not_contains, starts_with, ends_with, is_null, is_not_null, regex
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

    def clean_result(df):
        """清理DataFrame为JSON可序列化格式"""
        df_clean = df.replace({np.nan: None, pd.NA: None, np.inf: None, -np.inf: None})
        records = df_clean.to_dict(orient='records')
        return convert_to_json_serializable(records)

    try:
        data = params.get("data") or []
        conditions = params.get("conditions") or []
        logic = params.get("logic", "AND")

        if not data:
            return {"result": [], "count": 0}

        df = pd.DataFrame(data)
        if df.empty:
            return {"result": [], "count": 0}

        mask = None

        for cond in conditions:
            field = cond.get("field")
            operator = cond.get("operator", "eq")
            value = cond.get("value")

            if field not in df.columns:
                if operator == "is_null":
                    cond_mask = pd.Series([True] * len(df), index=df.index)
                elif operator == "is_not_null":
                    cond_mask = pd.Series([False] * len(df), index=df.index)
                else:
                    cond_mask = pd.Series([False] * len(df), index=df.index)
            else:
                col = df[field]

                if operator == "eq":
                    cond_mask = col == value
                elif operator == "ne":
                    cond_mask = col != value
                elif operator == "gt":
                    cond_mask = col > value
                elif operator == "gte":
                    cond_mask = col >= value
                elif operator == "lt":
                    cond_mask = col < value
                elif operator == "lte":
                    cond_mask = col <= value
                elif operator == "in":
                    cond_mask = col.isin(value) if isinstance(value, list) else col == value
                elif operator == "not_in":
                    cond_mask = ~col.isin(value) if isinstance(value, list) else col != value
                elif operator == "contains":
                    cond_mask = col.astype(str).str.contains(str(value), na=False)
                elif operator == "not_contains":
                    cond_mask = ~col.astype(str).str.contains(str(value), na=False)
                elif operator == "starts_with":
                    cond_mask = col.astype(str).str.startswith(str(value), na=False)
                elif operator == "ends_with":
                    cond_mask = col.astype(str).str.endswith(str(value), na=False)
                elif operator == "is_null":
                    cond_mask = col.isna()
                elif operator == "is_not_null":
                    cond_mask = col.notna()
                elif operator == "regex":
                    cond_mask = col.astype(str).str.contains(value, regex=True, na=False)
                else:
                    return {"error": f"不支持的运算符: {operator}", "code": 400}

            if isinstance(cond_mask, pd.Series):
                cond_mask = cond_mask.fillna(False)

            if mask is None:
                mask = cond_mask
            elif logic == "AND":
                mask = mask & cond_mask
            else:
                mask = mask | cond_mask

        if mask is None:
            result = data
        else:
            result_df = df[mask]
            result = clean_result(result_df)

        return {"result": result, "count": len(result)}

    except Exception as e:
        return {"error": str(e), "code": 500}
