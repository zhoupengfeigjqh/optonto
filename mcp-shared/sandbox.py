"""函数沙箱：exec + 受限 globals + run(params) 统一入口（迁自 core-backend services）。

本体函数与公共函数同一约定：def run(params: dict) -> dict，整包传参。

统一返回信封（2026-09-30 函数返回结构统一）：
    {"success": bool, "data": any, "error": {"code": str, "message": str} | None}
- success=执行成败（函数是否正确跑完）；业务失败（参数不合法等）返回 success=False + error，
  系统级崩溃（未预期异常）原样上抛 → 由 MCP 层置 isError，走报错预算/重试通道。
- 类型为 VALIDATION（逻辑验证）的函数额外在 data 内携带 {pass: bool, reason: str}：「不通过」是成功执行的失败判定，
  禁止用 raise 表达。
- 出口统一经 _normalize_output 归一：写时新约定、读时兼容旧式 {"result": ...} 与漏包裸返回。

注意：__import__ 有意保留——现有函数代码依赖它（如 run() 内部 `from datetime import ...`、
import pandas/numpy）。这是"可信插件执行"，不是安全沙箱；保存期由 core 的
_validate_function_code 做静态校验（设计期职责，不随迁）。
"""
import sys


def _normalize_output(ret):
    """返回值归一化为统一信封（读时兼容，写时新约定）：

    - 新式：dict 且 success 为 bool → 原样放行
    - 旧式：dict 且带 result 键 → 拆包（仅 result 单键时 data 取其值；
      多顶层键整包保留进 data，不丢信息）
    - 裸返回（漏包/非 dict）→ 整包作 data（宽松兜底 + stderr 告警）
    """
    if isinstance(ret, dict) and isinstance(ret.get("success"), bool):
        return ret
    if isinstance(ret, dict) and "result" in ret:
        extra = {k: v for k, v in ret.items() if k != "result"}
        if not extra:
            return {"success": True, "data": ret["result"], "error": None}
        print(
            f"[sandbox] 函数返回旧式多顶层键 {sorted(ret.keys())}，已整包归入 data（建议改写为统一信封约定）",
            file=sys.stderr,
        )
        return {"success": True, "data": ret, "error": None}
    print("[sandbox] 函数返回未按信封约定（缺 success），已宽松归入 data", file=sys.stderr)
    return {"success": True, "data": ret, "error": None}


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
    """exec 函数代码并调用 run(params)。未定义 run 抛 ValueError，执行异常原样上抛。

    返回值经 _normalize_output 归一为统一信封（见模块 docstring）。
    """
    local_vars: dict = {}
    exec(code, build_restricted_globals(), local_vars)
    func = local_vars.get("run")
    if func is None:
        raise ValueError("未找到函数 run，函数须以 def run(params: dict) 定义（统一入口约定）")
    return _normalize_output(func(params))
