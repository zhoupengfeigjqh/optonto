# -*- coding: utf-8 -*-
"""公共函数全量冒烟：manifest 里每一个公共函数都必须"跑得起来"。

为什么单独一个文件（与 test_aggregate_functions 的分工）：
- test_aggregate_functions 锁**计算口径**（中位数/样本标准差/非数值项忽略…），只覆盖少数函数；
- 本文件锁**可执行性**：任何公共函数（含未来新增的）在 .data 里存在代码文件、
  import 的第三方库在 requirements 中已声明且镜像里真装了、能以 sample 参数跑出 success=true。
  典型事故："aggregateData 执行失败: No module named 'pandas'" —— 计算逻辑没错，环境缺库。

约定：新增公共函数必须同步在 _SAMPLE_PARAMS 补一条样例参数，否则本测试会直接报"未覆盖"，
不允许用"跳过"掩盖（覆盖度缺口比失败更需要被看见）。

运行：cd common-function-mcp && python -m pytest tests -q
"""
import json
import sys
from pathlib import Path

import pytest

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(_REPO_ROOT / "mcp-shared"))

from function_runner import run_function_code  # noqa: E402

_COMMON_DIR = _REPO_ROOT / ".data" / "common_functions"
_MANIFEST = _COMMON_DIR / "functions.json"

_ROWS = [
    {"region": "A", "amount": 10, "date": "2026-01-05"},
    {"region": "A", "amount": 20, "date": "2026-03-01"},
    {"region": "B", "amount": 5, "date": "2026-02-01"},
]

_SAMPLE_PARAMS = {
    "getCurrentDate": {},
    "dateAdd": {"date": "2026-08-01", "days": 7},
    "dateDiff": {"startDate": "2026-08-01", "endDate": "2026-08-10"},
    "getWeekday": {"date": "2026-08-17"},
    "filterData": {"data": _ROWS, "conditions": [{"field": "amount", "operator": "gt", "value": 5}]},
    "aggregateData": {"data": _ROWS, "aggregations": [
        {"field": "amount", "functions": ["sum", "avg", "count", "count_distinct", "min", "max", "std", "var", "median", "mode"]}]},
    "groupReduce": {
        "data": _ROWS, "group_by": ["region"],
        "aggregations": [{"field": "amount", "functions": ["sum", "count", "avg"]}],
        "having": [{"field": "amount_sum", "operator": "gte", "value": 5}],
        "order_by": [{"field": "amount_sum", "direction": "desc"}],
        "top_n": 2,
    },
    "max": {"data": _ROWS, "field": "amount"},
    "min": {"data": _ROWS, "field": "amount"},
    "average": {"data": _ROWS, "field": "amount"},
    "median": {"data": _ROWS, "field": "amount"},
    "std": {"data": _ROWS, "field": "amount"},
    "lastRecord": {"data": _ROWS, "dateField": "date"},
}


def _manifest_names() -> list[str]:
    if not _MANIFEST.exists():
        return []
    return [e["name"] for e in json.loads(_MANIFEST.read_text(encoding="utf-8")) if e.get("name")]


def _needs_manifest():
    if not _MANIFEST.exists():
        pytest.skip(".data 中无公共函数 manifest（DATA_DIR 不可见时不适用）")


def test_冒烟样例覆盖manifest全部公共函数():
    """新增公共函数未补样例 → 失败（防"新函数从未被任何测试跑过"）。"""
    _needs_manifest()
    missing = sorted(set(_manifest_names()) - set(_SAMPLE_PARAMS))
    assert not missing, "以下公共函数缺少冒烟样例参数，请补到 _SAMPLE_PARAMS: %s" % missing


@pytest.mark.parametrize("name", sorted(_SAMPLE_PARAMS))
def test_每个公共函数都能跑通(name):
    """与线上同一条执行路径（受限 globals + exec + run(params)），断言 success=true。"""
    _needs_manifest()
    code_path = _COMMON_DIR / f"{name}.py"
    assert code_path.exists(), "公共函数代码文件缺失: %s" % code_path
    out = run_function_code(code_path.read_text(encoding="utf-8"), _SAMPLE_PARAMS[name])
    assert out["success"] is True, "%s 执行失败: %s" % (name, out.get("error"))
    assert out["data"] is not None, name
