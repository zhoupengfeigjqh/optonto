# -*- coding: utf-8 -*-
"""聚合类公共函数的计算正确性测试（max / min / average / median / std / lastRecord）。

锁死四件事：
1. 计算口径：中位数偶数条取中间两数平均；标准差为**样本标准差**（ddof=1，与 aggregateData 一致）；
2. 取值口径：非数值项（空值/文本/bool）忽略，数值字符串参与计算；
3. 失败口径：数据为空 / 属性不存在 / 无有效数值 / 样本不足 / 无有效日期 → success=false + 错误码；
4. lastRecord：按 dateField 取日期最大的一条，记录内的日期原样返回，不猜字段名。

运行：cd common-function-mcp && python -m pytest tests -q
"""
import sys
from pathlib import Path

import pytest

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(_REPO_ROOT / "mcp-shared"))

from function_runner import run_function_code  # noqa: E402

_COMMON_DIR = _REPO_ROOT / ".data" / "common_functions"

_RECORDS = [
    {"amount": 10, "date": "2026-01-05"},
    {"amount": "20.5", "date": "2026-03-01"},
    {"amount": None, "date": "2026-02-01"},
    {"amount": True, "date": "not-a-date"},
    {"amount": 30},
]


def _run(name: str, params: dict) -> dict:
    code_path = _COMMON_DIR / f"{name}.py"
    if not code_path.exists():
        pytest.skip(f"{code_path} 不可见时不适用")
    return run_function_code(code_path.read_text(encoding="utf-8"), params)


@pytest.mark.parametrize(
    "name,expected",
    [("max", 30.0), ("min", 10.0), ("average", 60.5 / 3), ("median", 20.5)],
)
def test_数值聚合口径(name, expected):
    """10 / 20.5 / 30（None 与 bool 被忽略）→ 极值、平均值、中位数"""
    out = _run(name, {"data": _RECORDS, "field": "amount"})
    assert out["success"] is True, out
    assert out["data"]["value"] == pytest.approx(expected)
    assert out["data"]["count"] == 3


def test_中位数偶数条取中间两数平均():
    out = _run("median", {"data": [{"a": 1}, {"a": 2}, {"a": 3}, {"a": 4}], "field": "a"})
    assert out["data"]["value"] == pytest.approx(2.5)


def test_标准差为样本标准差():
    """ddof=1：[10, 20, 30] → 10.0（总体标准差为 8.16…，口径不可混）"""
    out = _run("std", {"data": [{"a": 10}, {"a": 20}, {"a": 30}], "field": "a"})
    assert out["success"] is True, out
    assert out["data"]["value"] == pytest.approx(10.0)
    assert out["data"]["count"] == 3


def test_标准差样本不足判业务失败():
    out = _run("std", {"data": [{"a": 1}], "field": "a"})
    assert out["success"] is False
    assert out["error"]["code"] == "INSUFFICIENT_DATA"


@pytest.mark.parametrize("name", ["max", "min", "average", "median", "std"])
def test_数据为空判业务失败(name):
    out = _run(name, {"data": [], "field": "amount"})
    assert out["success"] is False
    assert out["error"]["code"] == "EMPTY_DATA"


@pytest.mark.parametrize("name", ["max", "min", "average", "median", "std"])
def test_属性不存在判业务失败(name):
    out = _run(name, {"data": [{"other": 1}], "field": "amount"})
    assert out["success"] is False
    assert out["error"]["code"] == "FIELD_NOT_FOUND"


@pytest.mark.parametrize("name", ["max", "min", "average", "median", "std"])
def test_无有效数值判业务失败(name):
    out = _run(name, {"data": [{"amount": "abc"}, {"amount": None}], "field": "amount"})
    assert out["success"] is False
    assert out["error"]["code"] == "NO_NUMERIC_VALUES"


@pytest.mark.parametrize("name", ["max", "min", "average", "median", "std"])
def test_缺属性名判业务失败(name):
    out = _run(name, {"data": [{"amount": 1}]})
    assert out["success"] is False
    assert out["error"]["code"] == "FIELD_REQUIRED"


def test_最新记录取日期最大的一条():
    out = _run("lastRecord", {"data": _RECORDS, "dateField": "date"})
    assert out["success"] is True, out
    assert out["data"]["record"] == {"amount": "20.5", "date": "2026-03-01"}
    assert out["data"]["date"] == "2026-03-01T00:00:00"


def test_最新记录识别ISO时间与时区():
    """带 Z 的时间折算 UTC 后比较：3-01T10:00Z > 3-01T00:00，两者都小于 4-01"""
    data = [
        {"id": 1, "d": "2026-03-01"},
        {"id": 2, "d": "2026-03-01T10:00:00Z"},
        {"id": 3, "d": "2026-04-01"},
    ]
    out = _run("lastRecord", {"data": data, "dateField": "d"})
    assert out["data"]["record"]["id"] == 3

    out = _run("lastRecord", {"data": data[:2], "dateField": "d"})
    assert out["data"]["record"]["id"] == 2


def test_最新记录无有效日期判业务失败():
    out = _run("lastRecord", {"data": [{"d": "不是日期"}], "dateField": "d"})
    assert out["success"] is False
    assert out["error"]["code"] == "NO_VALID_DATE"


def test_最新记录缺日期属性名判业务失败():
    out = _run("lastRecord", {"data": [{"d": "2026-01-01"}]})
    assert out["success"] is False
    assert out["error"]["code"] == "FIELD_REQUIRED"
