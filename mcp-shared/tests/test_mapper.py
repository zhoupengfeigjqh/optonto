"""映射翻译测试：平铺换名、嵌套数组（[*] 路径）、容器自动补齐、白名单语义。

运行：cd mcp-shared && python -m pytest tests -q
（与其它模块同约定：tests/ 目录 + sys.path 注入模块根）

覆盖口径（2026-09-30 容器补齐）：
- 输入向（本体路径 → 目标路径）原地换名不改结构，未映射字段**透传**（非白名单）；
- 输出向（目标路径 → 本体名）白名单，未映射字段丢弃；
- 容器路径自动补齐：只声明叶子/元素行时，祖先容器（`data[*].lines → result[*].items`）
  一并换名——否则容器名会停在目标侧名字（`items`），静默破坏本体契约（`lines`）；
- 数组元素为标量时，容器行是唯一有效的换名手段（元素行本身不参与任何 key 改写）。
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from mapper import _complete_mapping, _translate_input, _translate_output  # noqa: E402


# ─── 平铺（路径的特例）─────────────────────────────────────────────────────────

def test_平铺输入换名():
    assert _translate_input({"原材料名称": "钢"}, {"原材料名称": "rawMaterialName"}) == {"rawMaterialName": "钢"}


def test_输入未映射字段原样透传():
    # 输入向非白名单：下游可能还需要除本体参数以外的字段（既有口径，勿改）
    assert _translate_input({"a": 1, "b": 2}, {"a": "x"}) == {"x": 1, "b": 2}


def test_输出换名并白名单丢弃():
    assert _translate_output({"rawMaterialId": "RM-1", "extra": "丢"}, {"材料编号": "rawMaterialId"}) == {"材料编号": "RM-1"}


def test_输出映射为空时原样返回():
    data = {"a": 1, "b": [{"c": 2}]}
    assert _translate_output(data, {}) is data


def test_空串映射值不参与白名单_该本体键不出现在结果中():
    # 空串 = 本体属性在目标无来源（存量例：CreatePurchaseRecord 的 data.leadTime）：
    # 不产生目标路径 → 结果里没有该键（缺键，非 null）
    assert _translate_output({"x": 1}, {"a": "x", "b": ""}) == {"a": 1}


# ─── 嵌套数组：容器与叶子都声明 ────────────────────────────────────────────────

def test_数组对象_容器与叶子都声明_输入():
    params = {"order": {"lines": [{"prod": "P1", "qty": 2}]}}
    mapping = {
        "order.lines": "order.items",
        "order.lines[*].prod": "order.items[*].prod_name",
        "order.lines[*].qty": "order.items[*].quantity",
    }
    assert _translate_input(params, mapping) == {"order": {"items": [{"prod_name": "P1", "quantity": 2}]}}


def test_数组对象_容器与叶子都声明_输出():
    data = {"code": 0, "result": [{"orderNo": "A", "items": [{"prod_name": "P1"}]}]}
    mapping = {
        "code": "code",
        "data": "result",
        "data[*].orderId": "result[*].orderNo",
        "data[*].lines": "result[*].items",
        "data[*].lines[*].prod": "result[*].items[*].prod_name",
    }
    assert _translate_output(data, mapping) == {
        "code": 0, "data": [{"orderId": "A", "lines": [{"prod": "P1"}]}]}


def test_三层嵌套数组_输出():
    mapping = {
        "data": "result",
        "data[*].lines": "result[*].items",
        "data[*].lines[*].parts": "result[*].items[*].subs",
        "data[*].lines[*].parts[*].name": "result[*].items[*].subs[*].x",
    }
    assert _translate_output({"result": [{"items": [{"subs": [{"x": 1}]}]}]}, mapping) == {
        "data": [{"lines": [{"parts": [{"name": 1}]}]}]}


# ─── 嵌套数组：只声明叶子（容器由补齐兜住）───────────────────────────────────────

def test_只声明叶子_输出时容器自动补齐():
    # 修复前：容器名停在目标侧 `items`，本体契约 `lines` 被静默破坏
    mapping = {"data": "result", "data[*].lines[*].prod": "result[*].items[*].prod_name"}
    assert _translate_output({"result": [{"items": [{"prod_name": "P1"}]}]}, mapping) == {
        "data": [{"lines": [{"prod": "P1"}]}]}


def test_只声明叶子_输入时容器自动补齐():
    assert _translate_input({"order": {"lines": [{"prod": "P1"}]}},
                            {"order.lines[*].prod": "order.items[*].prod_name"}) == {
        "order": {"items": [{"prod_name": "P1"}]}}


def test_补齐不扩大白名单覆盖():
    # 只声明叶子：响应里的未映射字段仍必须被丢弃
    mapping = {"data[*].lines[*].prod": "result[*].items[*].prod_name"}
    assert _translate_output(
        {"result": [{"items": [{"prod_name": "P1", "secret": "S"}]}], "extra": 1}, mapping) == {
        "data": [{"lines": [{"prod": "P1"}]}]}


def test_显式容器声明优先于自动补齐():
    mapping = {"data[*].lines": "result[*].rows", "data[*].lines[*].prod": "result[*].items[*].prod_name"}
    assert _complete_mapping(mapping)["data[*].lines"] == "result[*].rows"


# ─── 标量数组（元素行本身不改名，容器行是唯一换名手段）───────────────────────────

def test_标量数组_容器与元素都声明_输出():
    mapping = {"data": "result", "data[*].tags": "result[*].labels", "data[*].tags[*]": "result[*].labels[*]"}
    assert _translate_output({"result": [{"labels": ["x", "y"]}]}, mapping) == {
        "data": [{"tags": ["x", "y"]}]}


def test_标量数组_只声明元素行时容器自动补齐_输出():
    # 修复前：容器名停在 `labels`
    mapping = {"data": "result", "data[*].tags[*]": "result[*].labels[*]"}
    assert _translate_output({"result": [{"labels": ["x", "y"]}]}, mapping) == {
        "data": [{"tags": ["x", "y"]}]}


def test_标量数组_只声明元素行时容器自动补齐_输入():
    assert _translate_input({"tags": ["x"]}, {"tags[*]": "labels[*]"}) == {"labels": ["x"]}


def test_二维标量数组_容器换名():
    assert _translate_input({"matrix": [[1, 2], [3]]}, {"matrix": "grid"}) == {"grid": [[1, 2], [3]]}


# ─── 边界与现状（不改行为，仅锁定）─────────────────────────────────────────────

def test_空数组保持为空数组():
    assert _translate_output({"result": []}, {"data": "result"}) == {"data": []}


def test_裸数组响应根会全量滤空_由执行器层告警():
    # 映射目标路径以具体根键开头（result[*].x），而响应根是裸数组 → 无从匹配，全部丢弃。
    # 这是配置与真实响应不一致，mapper 不做猜测（executor._call_engine_mcp 记警告）。
    assert _translate_output([{"rawMaterialId": "RM-1"}],
                             {"data": "result", "data[*].rawMaterialId": "result[*].rawMaterialId"}) == [{}]


def test_中间层未声明时其内部字段仍可换名():
    # 只声明最深一层的叶子：中间容器 name 无法从叶子反推 → 保持原名（补齐只到容器名一级）
    mapping = {"data[*].lines[*].prod": "result[*].items[*].prod_name"}
    assert _complete_mapping(mapping)["data[*].lines"] == "result[*].items"


# ─── _complete_mapping 单元 ────────────────────────────────────────────────────

def test_补齐至根():
    completed = _complete_mapping({"data[*].lines[*].prod": "result[*].items[*].prod_name"})
    assert completed == {
        "data[*].lines[*].prod": "result[*].items[*].prod_name",
        "data[*].lines[*]": "result[*].items[*]",
        "data[*].lines": "result[*].items",
        "data[*]": "result[*]",
        "data": "result",
    }


def test_补齐对平铺映射无副作用():
    assert _complete_mapping({"a": "x", "b": "y"}) == {"a": "x", "b": "y"}


def test_补齐跳过空值并容忍空映射():
    assert _complete_mapping({"a.b": "", "c": "z"}) == {"a.b": "", "c": "z"}
    assert _complete_mapping({}) == {}
    assert _complete_mapping(None) == {}
