"""data_store 测试：本体身份四元组与本体名的**唯一读取来源 = ontology.yaml.metadata**。

运行：cd mcp-shared && python -m pytest tests -q
（与其它模块同约定：tests/ 目录 + sys.path 注入模块根）

口径（2026-10-01 统一读取模式）：
- ``scenario_name`` / ``scenario_id`` / ``ontology_name`` / ``ontology_id`` 与本体名 ``name``
  一律取自 ``<本体>/ontology.yaml`` 的 ``metadata``；**不用目录名或 meta.json 兜底**；
- meta.json 只提供非身份字段（description / creator / 时间戳）与"本体存在"的注册判据；
- metadata 缺失 / 四元组不全 / 与目录名不一致 → 该本体**跳过**（不静默兜底），
  且不得影响其他本体与路由；
- ``deployed_version`` 同通道读取；版本变化（重新部署）必须立刻反映（mtime 缓存不得串味）。
"""
import json
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import data_store  # noqa: E402


@pytest.fixture
def market(tmp_path, monkeypatch):
    """隔离的 .data/onto_market：路径与缓存在 import 期冻结，须 monkeypatch 模块属性。"""
    root = tmp_path / "onto_market"
    root.mkdir(parents=True)
    monkeypatch.setattr(data_store, "ONTO_MARKET_DIR", root)
    monkeypatch.setattr(data_store, "DATA_DIR", tmp_path)
    monkeypatch.setattr(data_store, "_ontology_cache", {})
    return root


def make_ontology(market: Path, scenario: str, ontology: str, *, oid: int = 1, sid: int = 1,
                  version: str | None = None, md_override: dict | None = None,
                  yaml_text: str | None = None, meta_extra: dict | None = None,
                  with_meta: bool = True) -> Path:
    """最小本体目录：meta.json（注册表，可选）+ ontology.yaml（身份唯一来源）。

    md_override 用于构造"身份异常"用例（缺键 / 与目录名不一致）；yaml_text 用于构造损坏 yaml。
    """
    base = market / scenario / ontology
    base.mkdir(parents=True, exist_ok=True)
    if with_meta:
        meta = {"id": oid, "scenario_id": sid, "name": ontology, "description": "",
                "created_at": "2026-01-01", "updated_at": "2026-01-01"}
        meta.update(meta_extra or {})
        (base / "meta.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    if yaml_text is not None:
        (base / "ontology.yaml").write_text(yaml_text, encoding="utf-8")
    else:
        md = {"scenario_name": scenario, "scenario_id": sid,
              "ontology_name": ontology, "ontology_id": oid}
        if version is not None:
            md["deployed_version"] = version
        md.update(md_override or {})
        (base / "ontology.yaml").write_text(
            "metadata:\n" + "".join(f"  {k}: {json.dumps(v, ensure_ascii=False)}\n" for k, v in md.items()),
            encoding="utf-8")
    return base


# ─── 身份读取：唯一来源 = ontology.yaml.metadata ─────────────────────────────────

def test_身份与本体名取自metadata而非目录或meta_json(market):
    # meta.json 的 name / scenario_id 与 metadata 故意写成不同值：输出必须以 metadata 为准
    make_ontology(market, "生产调度", "原材料采购和库存", oid=1, sid=7,
                  meta_extra={"name": "旧名字", "scenario_id": 999},
                  md_override={"ontology_id": 42})
    rows = data_store.list_all_ontologies()
    assert len(rows) == 1
    row = rows[0]
    assert row["id"] == 42                       # ← metadata.ontology_id（id 键也只认 metadata）
    assert row["ontology_id"] == 42
    assert row["scenario_id"] == 7               # ← metadata.scenario_id（不是 meta.json 的 999）
    assert row["scenario_name"] == "生产调度"      # ← metadata.scenario_name
    assert row["ontology_name"] == "原材料采购和库存"
    assert row["name"] == "原材料采购和库存"        # ← metadata.ontology_name（不是 meta.json 的"旧名字"）
    assert row["description"] == ""              # 非身份字段仍来自 meta.json（此处为空串）


def test_metadata缺失或不全时跳过该本体(market):
    make_ontology(market, "s", "ok", oid=1, version="v1.0")
    make_ontology(market, "s", "no_md_key", oid=2, md_override={"ontology_id": None})   # 四元组不全
    make_ontology(market, "s", "no_yaml", oid=3, yaml_text="behaviors: []\n")           # 无 metadata 段
    make_ontology(market, "s", "no_file", oid=4)                                        # 再手动删掉 yaml
    (market / "s" / "no_file" / "ontology.yaml").unlink()
    rows = data_store.list_all_ontologies()
    assert [r["ontology_name"] for r in rows] == ["ok"]   # 只有完整可信的那个


def test_metadata与目录名不一致时跳过(market):
    make_ontology(market, "s", "good", oid=1)
    make_ontology(market, "s", "tampered", oid=2,
                  md_override={"ontology_name": "别的名字"})   # 目录名与 metadata 名不符
    assert [r["ontology_name"] for r in data_store.list_all_ontologies()] == ["good"]


def test_yaml损坏按不可信跳过且不影响其他本体与路由(market):
    make_ontology(market, "s", "good", oid=1, version="v2.0")
    make_ontology(market, "s", "broken", oid=2, yaml_text="metadata: [unclosed\n")
    rows = data_store.list_all_ontologies()
    assert [r["id"] for r in rows] == [1]
    assert data_store.get_ontology_names(1) == ("s", "good")
    assert data_store.get_ontology_names(2) is None          # 不可信 → 路由也查不到（不误导）
    assert data_store.load_ontology_data_by_id(1)[2] == "good"


def test_缺meta_json的本体不进清单(market):
    # meta.json 是"本体存在"的注册判据；缺失则不出现（身份与注册判据各司其职）
    make_ontology(market, "s", "no_meta", oid=1, with_meta=False)
    assert data_store.list_all_ontologies() == []


# ─── deployed_version：同通道读取 ────────────────────────────────────────────────

def test_清单附带已部署版本(market):
    make_ontology(market, "s", "a", oid=1, version="v1.0")
    make_ontology(market, "s", "b", oid=2)          # 未部署
    versions = {r["ontology_name"]: r["deployed_version"] for r in data_store.list_all_ontologies()}
    assert versions == {"a": "v1.0", "b": ""}
    assert data_store.deployed_version_of("s", "a") == "v1.0"


def test_重新部署后版本即时刷新(market):
    base = make_ontology(market, "s", "a", oid=1, version="v1.0")
    assert data_store.deployed_version_of("s", "a") == "v1.0"
    md_line = '  deployed_version: "v1.1"\n'
    (base / "ontology.yaml").write_text("metadata:\n" + md_line, encoding="utf-8")
    # 显式推进 mtime，避免同时间戳写入命中缓存（测试确定性）
    path = base / "ontology.yaml"
    bumped = path.stat().st_mtime_ns + 1_000_000_000
    os.utime(path, ns=(bumped, bumped))
    assert data_store.deployed_version_of("s", "a") == "v1.1"


def test_多本体各自身份正确(market):
    make_ontology(market, "甲场景", "本体一", oid=11, sid=1, version="v1.0")
    make_ontology(market, "甲场景", "本体二", oid=12, sid=1)
    make_ontology(market, "乙场景", "本体三", oid=13, sid=2, version="v2.3")
    got = {(r["scenario_name"], r["ontology_name"]): (r["id"], r["scenario_id"], r["deployed_version"])
           for r in data_store.list_all_ontologies()}
    assert got[("甲场景", "本体一")] == (11, 1, "v1.0")
    assert got[("甲场景", "本体二")] == (12, 1, "")
    assert got[("乙场景", "本体三")] == (13, 2, "v2.3")


def test_identity辅助函数口径一致(market):
    make_ontology(market, "s", "a", oid=1, sid=5, version="v9")
    assert data_store.ontology_identity("s", "a") == {
        "scenario_name": "s", "scenario_id": 5, "ontology_name": "a", "ontology_id": 1}
    assert data_store.ontology_identity("s", "不存在") is None
