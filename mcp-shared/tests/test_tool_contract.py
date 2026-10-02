"""schema 编译 + 发布契约测试（mcp-shared/tool_contract.py 的工具契约部分）。

运行：cd mcp-shared && python -m pytest tests -q

口径（2026-10-01 工具发布契约统一）：
- 分类标记单一来源 = JSON Schema 扩展键 x-category / x-display_name（不再放 scope 内）；
- 本体上下文块 scope 仅「本体执行类」（本体行为/本体函数）携带，只含上下文键；
- ontology_id 在调用契约里必填（本体执行类与 listOnto*），缺失即报错、不做兜底；
- 系统参数（scope + ontology_id）执行前统一剥离，三类发布端共用 strip_system_params。
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from tool_contract import (  # noqa: E402
    CATEGORY_BEHAVIOR, CATEGORY_COMMON, CATEGORY_QUERY, CATEGORY_KEY, DISPLAY_NAME_KEY,
    SCOPE_KEY, SYSTEM_PARAMS, build_query_schema, is_engine_ready, owner_label,
    ready_behavior_names, require_ontology_id, require_ontology_match, strip_system_params,
    with_category, with_ontology_context,
)


# ─── require_ontology_id：调用契约必填 ─────────────────────────────────────────

def test_缺失ontology_id报错():
    with pytest.raises(ValueError, match="行为 QueryA 缺少 ontology_id"):
        require_ontology_id(None, "行为 QueryA")


def test_空串ontology_id报错():
    with pytest.raises(ValueError, match="函数 checkX 缺少 ontology_id"):
        require_ontology_id("", "函数 checkX")


def test_传入ontology_id原样返回():
    assert require_ontology_id(1, "行为 QueryA") == 1
    assert require_ontology_id("2", "行为 QueryA") == "2"  # 类型规整不在本函数职责内


# ─── 系统参数剥离（三类发布端共用）─────────────────────────────────────────────

def test_剥离系统参数只留业务参数():
    args = {"scope": {"name": "X"}, "ontology_id": 1, "rawMaterialId": "RM-1", "qty": 2}
    assert strip_system_params(args) == {"rawMaterialId": "RM-1", "qty": 2}


def test_剥离容忍空入参():
    assert strip_system_params(None) == {}
    assert strip_system_params({}) == {}


def test_系统参数集合定义():
    assert SYSTEM_PARAMS == {SCOPE_KEY, "ontology_id"}


# ─── 分类标记（单一来源）───────────────────────────────────────────────────────

def test_分类标记注入():
    marked = with_category({"type": "object", "properties": {}}, CATEGORY_COMMON, "当前日期")
    assert marked[CATEGORY_KEY] == CATEGORY_COMMON
    assert marked[DISPLAY_NAME_KEY] == "当前日期"
    assert marked["properties"] == {}  # 参数面不被污染


def test_分类标记无中文名时只注入类别():
    marked = with_category({"type": "object"}, CATEGORY_QUERY)
    assert marked[CATEGORY_KEY] == CATEGORY_QUERY
    assert DISPLAY_NAME_KEY not in marked


# ─── 查询工具 schema ──────────────────────────────────────────────────────────

def test_查询工具schema_ontology_id必填():
    schema = build_query_schema({"keyword": {"type": "string"}})
    assert schema["required"] == ["ontology_id"]
    assert list(schema["properties"]) == ["ontology_id", "keyword"]


def test_全局花名册无ontology_id():
    schema = build_query_schema({"keyword": {"type": "string"}}, requires_ontology=False)
    assert schema["required"] == []
    assert "ontology_id" not in schema["properties"]


# ─── 本体执行类：scope 上下文块 + 分类标记 ─────────────────────────────────────

def test_本体执行类_上下文块与标记齐备且scope不含分类标记():
    fn = {"name": "calcSafetyStock", "display_name": "计算安全库存",
          "ontology_id": 1, "scenario_id": 1, "scenario_name": "生产调度", "ontology_name": "原材料采购和库存"}
    schema = with_ontology_context(
        {"type": "object", "properties": {"currentStock": {"type": "number"}}, "required": ["ontology_id"]},
        fn, CATEGORY_BEHAVIOR)
    assert schema[CATEGORY_KEY] == CATEGORY_BEHAVIOR
    assert schema[DISPLAY_NAME_KEY] == "计算安全库存"
    ctx = schema["properties"][SCOPE_KEY]["properties"]
    assert set(ctx) == {"name", "ontology_id", "scenario_id", "scenario_name", "ontology_name"}
    assert ctx["name"]["const"] == "calcSafetyStock"
    assert "category" not in ctx and DISPLAY_NAME_KEY not in ctx  # 同类语义只有一种表达
    assert schema["required"] == ["ontology_id"]


def test_本体执行类_缺失场景本体值时上下文键条件性缺席():
    schema = with_ontology_context({"type": "object", "properties": {}}, {"name": "f1"}, CATEGORY_BEHAVIOR)
    assert list(schema["properties"][SCOPE_KEY]["properties"]) == ["name"]


# ─── 归属一致性（契约 ④）：发布方声明的归属 == 调用方指定的路由本体 ────────────────

def test_归属一致时原样返回():
    assert require_ontology_match(1, 1, "函数 checkX") == 1
    # 数值表示差异（"1" / 1.0）按整数比较 —— 不能因表示不同而误拒合法调用
    assert require_ontology_match(1, "1", "函数 checkX") == "1"
    assert require_ontology_match("1", 1, "函数 checkX") == 1
    assert require_ontology_match(1, 1.0, "函数 checkX") == 1.0


def test_归属不一致报错且文案含双方id与中文名():
    where = owner_label({"ontology_id": 2, "ontology_name": "订单排程", "scenario_name": "生产调度"})
    with pytest.raises(ValueError) as ei:
        require_ontology_match(2, 1, "行为 CreatePurchaseRecord", where)
    msg = str(ei.value)
    assert "归属校验失败" in msg
    assert "本体「订单排程」" in msg          # 报错的可读性：给 LLM 中文名，便于自纠
    assert "ontology_id=2" in msg and "ontology_id=1" in msg


def test_归属声明缺失时放行():
    # 发布方未声明归属（老数据 / 设计期 REST 入口缓存未命中）→ 不误伤
    assert require_ontology_match(None, 7, "函数 checkX") == 7
    assert require_ontology_match("", 7, "函数 checkX") == 7


def test_owner_label_格式化():
    assert owner_label(None) == ""
    assert owner_label({}) == ""                                     # 无本体名 → 空串（报错回落 id）
    assert owner_label({"ontology_id": 3, "ontology_name": "货品BOM及工艺"}) \
        == "本体「货品BOM及工艺」(ontology_id=3)"
    assert owner_label({"ontology_id": 1, "ontology_name": "原材料采购和库存", "scenario_name": "生产调度"}) \
        == "本体「原材料采购和库存」(ontology_id=1，场景「生产调度」)"


# ─── 就绪发布（契约 ⑥）：只有已映射（真能执行）的行为才发布为工具 ────────────────────

def _engine(behavior: str, *, url: str = "http://downstream/mcp", tool: str = "t", **over) -> dict:
    return {"name": f"E_{behavior}", "behavior_name": behavior,
            "target": {"server_url": url, "tool_name": tool}, **over}


def test_引擎可用判据_缺省即MCP且target齐备():
    assert is_engine_ready(_engine("B1")) is True
    assert is_engine_ready(_engine("B1", engine_type="MCP")) is True   # 显式标 MCP 同样就绪


def test_引擎不可用的各种情形():
    assert is_engine_ready(None) is False
    assert is_engine_ready("不是字典") is False
    assert is_engine_ready(_engine("B1", engine_type="SQL")) is False   # 已删除类型（executor 会报错）
    assert is_engine_ready(_engine("B1", tool="")) is False             # 半成品映射：缺 tool_name
    assert is_engine_ready(_engine("B1", url="   ")) is False           # 空白 url 等同未配


def test_就绪行为名_只含有可用引擎的行为():
    data = {"behaviors": [{"name": "B1"}, {"name": "B2"}, {"name": "B3"}],
            "data_engines": [_engine("B1"), _engine("B3", tool="")]}
    assert ready_behavior_names(data) == {"B1"}      # B2 未映射、B3 引擎不可用 → 均未就绪
    assert ready_behavior_names({}) == set()
    assert ready_behavior_names({"data_engines": [None, "x", {}]}) == set()   # 脏数据不炸
