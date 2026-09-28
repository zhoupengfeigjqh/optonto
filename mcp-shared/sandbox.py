"""函数沙箱：exec + 受限 globals + run(params) 统一入口（迁自 core-backend services）。

本体函数与公共函数同一约定：def run(params: dict) -> dict，整包传参；
run() 自带 {"result": ...} 包装，执行结果原样返回（不再包一层）。

注意：__import__ 有意保留——现有函数代码依赖它（如 run() 内部 `from datetime import ...`、
import pandas/numpy）。这是"可信插件执行"，不是安全沙箱；保存期由 core 的
_validate_function_code 做静态校验（设计期职责，不随迁）。
"""


def build_restricted_globals() -> dict:
    """Restricted globals for exec'ing user function code (ontology + common).

    白名单含常用异常类型与 set/frozenset：函数代码需要 try/except Exception 兜错误契约、
    以及 isinstance(obj, (set, frozenset)) 类型判断（filterData/aggregateData/groupReduce 用到）。
    """
    import datetime as _datetime
    import json as _json
    import math as _math
    import re as _re
    return {
        "datetime": _datetime, "json": _json, "math": _math, "re": _re,
        "__builtins__": {
            "abs": abs, "all": all, "any": any, "bool": bool, "dict": dict,
            "enumerate": enumerate, "float": float, "int": int, "isinstance": isinstance,
            "len": len, "list": list, "max": max, "min": min, "range": range,
            "round": round, "sorted": sorted, "str": str, "sum": sum, "tuple": tuple,
            "set": set, "frozenset": frozenset,
            "Exception": Exception, "ValueError": ValueError, "TypeError": TypeError,
            "KeyError": KeyError, "IndexError": IndexError,
            "type": type, "zip": zip, "map": map, "filter": filter, "reversed": reversed,
            "True": True, "False": False, "None": None,
            "__import__": __import__, "print": print,
        },
    }


def run_function_code(code: str, params: dict):
    """exec 函数代码并调用 run(params)。未定义 run 抛 ValueError，执行异常原样上抛。"""
    local_vars: dict = {}
    exec(code, build_restricted_globals(), local_vars)
    func = local_vars.get("run")
    if func is None:
        raise ValueError("未找到函数 run，函数须以 def run(params: dict) 定义（统一入口约定）")
    return func(params)
