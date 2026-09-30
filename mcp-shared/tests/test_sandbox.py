"""函数沙箱测试：统一返回信封的出口归一化 + run_function_code 执行语义。

运行：cd mcp-shared && python -m pytest tests -q
（与其它模块同约定：tests/ 目录 + sys.path 注入模块根）

覆盖口径（2026-09-30 函数返回结构统一）：
- 新式（带 bool success）原样放行；
- 旧式 {"result": ...} 读时兼容拆包；多顶层键整包入 data；
- 裸返回 / 漏包 整包入 data（宽松兜底）；
- 系统级异常一律上抛（不吞成业务失败），供 MCP 层置 isError 走报错预算。
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sandbox import _normalize_output, run_function_code  # noqa: E402


# ─── _normalize_output：出口归一化 ─────────────────────────────────────────────

def test_新式信封原样放行():
    ret = {"success": True, "data": {"pass": True, "reason": "ok"}, "error": None}
    assert _normalize_output(ret) is ret


def test_新式业务失败信封原样放行():
    ret = {"success": False, "data": None, "error": {"code": "EMPTY_DATA", "message": "数据为空"}}
    assert _normalize_output(ret) is ret


def test_旧式单键result拆包进data():
    assert _normalize_output({"result": {"sum": 3}}) == {"success": True, "data": {"sum": 3}, "error": None}


def test_旧式result值为标量同样拆包():
    assert _normalize_output({"result": 42}) == {"success": True, "data": 42, "error": None}


def test_旧式多顶层键整包入data不丢信息(capsys):
    out = _normalize_output({"result": [{"a": 1}], "count": 1})
    assert out == {"success": True, "data": {"result": [{"a": 1}], "count": 1}, "error": None}
    assert "旧式多顶层键" in capsys.readouterr().err


def test_裸返回整包入data(capsys):
    assert _normalize_output([1, 2]) == {"success": True, "data": [1, 2], "error": None}
    assert _normalize_output("plain") == {"success": True, "data": "plain", "error": None}
    assert _normalize_output(None) == {"success": True, "data": None, "error": None}
    assert "未按信封约定" in capsys.readouterr().err


def test_success非布尔不当作新式():
    # success 非 bool（如字符串）不算新式信封 → 按裸返回兜底，避免半信封蒙混过关
    out = _normalize_output({"success": "true", "data": 1})
    assert out == {"success": True, "data": {"success": "true", "data": 1}, "error": None}


# ─── run_function_code：执行语义 ───────────────────────────────────────────────

def test_执行新式代码():
    # 新式信封「原样放行」——不补 error 键（函数自己给的形状就是契约）
    code = 'def run(params: dict) -> dict:\n    return {"success": True, "data": {"x": params["x"] + 1}}\n'
    assert run_function_code(code, {"x": 1}) == {"success": True, "data": {"x": 2}}


def test_执行旧式代码自动兼容():
    code = 'def run(params: dict) -> dict:\n    return {"result": {"pass": False, "message": "不一致"}}\n'
    assert run_function_code(code, {}) == {"success": True, "data": {"pass": False, "message": "不一致"}, "error": None}


def test_未定义run抛ValueError():
    with pytest.raises(ValueError):
        run_function_code("x = 1\n", {})


def test_函数内异常原样上抛():
    code = 'def run(params: dict) -> dict:\n    raise KeyError("boom")\n'
    with pytest.raises(KeyError):
        run_function_code(code, {})


def test_规则裁决不通过不算异常():
    # 业务性「不通过」必须是成功执行的裁决（success=True + data.pass=False），不得用 raise 表达
    code = ('def run(params: dict) -> dict:\n'
            '    return {"success": True, "data": {"pass": False, "reason": "库存不足"}, "error": None}\n')
    out = run_function_code(code, {})
    assert out["success"] is True
    assert out["data"]["pass"] is False
    assert out["data"]["reason"] == "库存不足"
