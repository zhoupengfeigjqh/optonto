"""公共函数：分组汇总。按字段分组聚合，支持 having 过滤、排序、Top-N。

注意：import 与 helper 必须定义在 run() 内部——core 端 exec 执行时 globals/locals 分离，
模块级 import 的符号对函数体不可见。
"""


def run(params: dict) -> dict:
    """按字段分组后进行聚合统计计算"""
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
        group_by = params.get("group_by") or []
        aggregations = params.get("aggregations") or []
        having = params.get("having")
        order_by = params.get("order_by")
        top_n = params.get("top_n")

        if not data:
            return {"result": [], "count": 0}

        df = pd.DataFrame(data)
        if df.empty:
            return {"result": [], "count": 0}

        # 检查分组字段
        for field in group_by:
            if field not in df.columns:
                return {"error": f"分组字段 '{field}' 不存在", "code": 400}

        # 构建聚合字典
        agg_dict = {}
        for agg in aggregations:
            field = agg.get("field")
            functions = agg.get("functions", [])
            alias = agg.get("alias")

            if field not in df.columns:
                return {"error": f"聚合字段 '{field}' 不存在", "code": 400}

            for func in functions:
                func_name = func.lower()
                key = alias if alias else f"{field}_{func_name}"

                if func_name == "sum":
                    agg_dict[key] = (field, "sum")
                elif func_name in ["avg", "mean"]:
                    agg_dict[key] = (field, "mean")
                elif func_name == "count":
                    agg_dict[key] = (field, "count")
                elif func_name == "count_distinct":
                    agg_dict[key] = (field, "nunique")
                elif func_name == "min":
                    agg_dict[key] = (field, "min")
                elif func_name == "max":
                    agg_dict[key] = (field, "max")
                elif func_name == "std":
                    agg_dict[key] = (field, "std")
                elif func_name == "var":
                    agg_dict[key] = (field, "var")
                elif func_name == "median":
                    agg_dict[key] = (field, "median")
                else:
                    return {"error": f"不支持的聚合函数: {func}", "code": 400}

        # 执行分组聚合
        grouped = df.groupby(group_by)
        result_df = grouped.agg(**agg_dict).reset_index()

        # having过滤
        if having:
            mask = None
            for cond in having:
                field = cond.get("field")
                operator = cond.get("operator", "eq")
                value = cond.get("value")

                if field not in result_df.columns:
                    continue

                col = result_df[field]
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
                elif operator == "is_null":
                    cond_mask = col.isna()
                elif operator == "is_not_null":
                    cond_mask = col.notna()
                else:
                    continue

                if mask is None:
                    mask = cond_mask
                else:
                    mask = mask & cond_mask

            if mask is not None:
                result_df = result_df[mask]

        # 排序
        if order_by:
            sort_cols = []
            ascending = []
            for order in order_by:
                field = order.get("field")
                direction = order.get("direction", "asc")
                if field in result_df.columns:
                    sort_cols.append(field)
                    ascending.append(direction == "asc")
            if sort_cols:
                result_df = result_df.sort_values(by=sort_cols, ascending=ascending)

        # Top-N
        if top_n and top_n > 0:
            result_df = result_df.head(top_n)

        # 清理结果
        result = clean_result(result_df)
        return {"result": result, "count": len(result)}

    except Exception as e:
        return {"error": str(e), "code": 500}
