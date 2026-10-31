"""本体身份读取契约（core 端）：**唯一来源 = ontology.yaml 的 metadata**（2026-10-01 统一）。

口径（与 mcp-shared/tests/test_loaders.py、agent 侧 skill-loader 测试同源）：
- ``scenario_name`` / ``scenario_id`` / ``ontology_name`` / ``ontology_id`` 与本体名 ``name``
  一律取自 ``<本体>/ontology.yaml`` 的 ``metadata``；
- meta.json 只贡献非身份字段（description / creator / 时间戳）与"本体存在"的注册判据；
- metadata 缺失 / 四元组不全 / 与目录名不一致 → 该本体**跳过**（不兜底推导）；
- 改名（场景/本体）与部署后必须回刷 metadata（``refresh_identity_metadata``），否则读取侧会跳过。

stdlib unittest 零依赖（core-backend 未接 pytest）：
    python -m unittest tests.test_metadata_identity -v
"""
import json
import sys
import tempfile
import unittest
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from repositories import metadata  # noqa: E402


class IdentityCase(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.root = Path(self._tmp.name)
        # metadata 模块级 ONTO_MARKET_DIR 指向临时目录（测试后还原）
        self._orig = metadata.ONTO_MARKET_DIR
        metadata.ONTO_MARKET_DIR = self.root
        self.addCleanup(setattr, metadata, "ONTO_MARKET_DIR", self._orig)

    # ─── 构造工具 ────────────────────────────────────────────────────────────
    def write_scenario(self, scenario: str, sid: int = 1) -> None:
        d = self.root / scenario
        d.mkdir(parents=True, exist_ok=True)
        (d / "meta.json").write_text(json.dumps(
            {"id": sid, "name": scenario, "description": "",
             "created_at": "2026-01-01", "updated_at": "2026-01-01"}, ensure_ascii=False),
            encoding="utf-8")

    def write_ontology(self, scenario: str, ontology: str, *, oid: int = 1, sid: int = 1,
                       md: dict | None = None, meta: dict | None = None,
                       yaml_text: str | None = None, with_meta: bool = True) -> Path:
        d = self.root / scenario / ontology
        d.mkdir(parents=True, exist_ok=True)
        if with_meta:
            base_meta = {"id": oid, "scenario_id": sid, "name": ontology, "description": "",
                         "created_at": "2026-01-01", "updated_at": "2026-01-01"}
            base_meta.update(meta or {})
            (d / "meta.json").write_text(json.dumps(base_meta, ensure_ascii=False), encoding="utf-8")
        if yaml_text is not None:
            (d / "ontology.yaml").write_text(yaml_text, encoding="utf-8")
        else:
            md_doc = {"scenario_name": scenario, "scenario_id": sid,
                      "ontology_name": ontology, "ontology_id": oid, "deployed_version": "v1.0"}
            md_doc.update(md or {})
            (d / "ontology.yaml").write_text(
                yaml.safe_dump({"metadata": md_doc}, allow_unicode=True, sort_keys=False),
                encoding="utf-8")
        return d

    def read_md(self, scenario: str, ontology: str) -> dict:
        raw = (self.root / scenario / ontology / "ontology.yaml").read_text(encoding="utf-8")
        return (yaml.safe_load(raw) or {}).get("metadata") or {}

    # ─── 身份读取 ────────────────────────────────────────────────────────────
    def test_身份与本体名取自_metadata_而非_meta_json(self) -> None:
        # meta.json 的 name / scenario_id 与 metadata 故意写成不同值：输出必须以 metadata 为准
        self.write_ontology("生产调度", "甲", oid=1, sid=7,
                            meta={"name": "旧名字", "scenario_id": 999},
                            md={"ontology_id": 42})
        rows = metadata.list_all_ontologies()
        self.assertEqual(len(rows), 1)
        r = rows[0]
        self.assertEqual((r["id"], r["ontology_id"]), (42, 42))   # id 键同样只认 metadata
        self.assertEqual(r["scenario_id"], 7)
        self.assertEqual((r["scenario_name"], r["ontology_name"]), ("生产调度", "甲"))
        self.assertEqual(r["name"], "甲")                  # 本体名同样只认 metadata
        self.assertEqual(r["deployed_version"], "v1.0")    # 版本同通道

    def test_metadata_不可信时跳过该本体(self) -> None:
        self.write_ontology("s", "ok", oid=1)
        self.write_ontology("s", "bad_id", oid=2, md={"ontology_id": None})
        self.write_ontology("s", "mismatch", oid=3, md={"ontology_name": "别的"})
        self.write_ontology("s", "no_md", oid=4, yaml_text="behaviors: []\n")
        d = self.write_ontology("s", "no_yaml", oid=5)
        (d / "ontology.yaml").unlink()
        self.assertEqual([r["ontology_name"] for r in metadata.list_all_ontologies()], ["ok"])

    def test_缺_meta_json_的本体不进清单(self) -> None:
        # meta.json 是"本体存在"的注册判据（身份来源是 yaml，两者职责分离）
        self.write_ontology("s", "a", oid=1, with_meta=False)
        self.assertEqual(metadata.list_all_ontologies(), [])

    def test_按场景过滤仍走统一身份(self) -> None:
        self.write_ontology("场景甲", "一本", oid=1, sid=1)
        self.write_ontology("场景乙", "二本", oid=2, sid=2)
        got = [o["ontology_name"] for o in metadata.list_ontologies_by_scenario("场景甲")]
        self.assertEqual(got, ["一本"])

    # ─── 身份回刷（改名/部署）─────────────────────────────────────────────────
    def test_回刷身份_metadata(self) -> None:
        # 目录已按新名/新场景就位，但 metadata 还是旧值（模拟改名后未刷新的状态）
        self.write_scenario("新场景", sid=3)
        self.write_ontology("新场景", "新名", oid=9,
                            md={"scenario_name": "旧场景", "scenario_id": 3,
                                "ontology_name": "旧名", "ontology_id": 9})
        self.assertEqual(metadata.list_all_ontologies(), [])      # 不可信 → 跳过
        self.assertTrue(metadata.refresh_identity_metadata("新场景", "新名"))
        md_now = self.read_md("新场景", "新名")
        self.assertEqual(
            {k: md_now.get(k) for k in ("scenario_name", "scenario_id", "ontology_name", "ontology_id")},
            {"scenario_name": "新场景", "scenario_id": 3,
             "ontology_name": "新名", "ontology_id": 9})
        rows = metadata.list_all_ontologies()                     # 回刷后立即可见
        self.assertEqual([r["ontology_name"] for r in rows], ["新名"])

    def test_回刷保留_metadata_其他字段(self) -> None:
        # 只 patch 身份四键：source_file / shard_hash 等历史字段不得被抹掉
        self.write_scenario("s", sid=1)
        self.write_ontology("s", "a", oid=1, yaml_text=(
            "metadata:\n  source_file: 需求.md\n  shard_hash: abc123\n"
            "  scenario_name: s\n  scenario_id: 1\n  ontology_name: a\n  ontology_id: 1\n"))
        metadata.refresh_identity_metadata("s", "a")
        md = self.read_md("s", "a")
        self.assertEqual(md["source_file"], "需求.md")
        self.assertEqual(md["shard_hash"], "abc123")

    def test_回刷缺文件返回_False(self) -> None:
        self.assertFalse(metadata.refresh_identity_metadata("s", "不存在"))

    # ─── 目录物理枚举（改名回刷用，不读身份）──────────────────────────────────
    def test_按目录物理枚举本体名(self) -> None:
        self.write_ontology("s", "b", oid=2)
        self.write_ontology("s", "a", oid=1)
        self.assertEqual(metadata.list_ontology_dir_names("s"), ["a", "b"])
        self.assertEqual(metadata.list_ontology_dir_names("不存在"), [])

    # ─── 身份出口（依赖注入 / 按名取身份 / 注册表 id）────────────────────────────
    def test_依赖注入口_get_ontology_name_by_id_只认_yaml(self) -> None:
        # meta.json 注册 id=1，yaml 身份 id=42 → 只有 42 能解析（所有按本体操作的路由共用此出口）
        self.write_ontology("生产调度", "甲", oid=1, md={"ontology_id": 42})
        self.assertEqual(metadata.get_ontology_name_by_id(42), ("生产调度", "甲"))
        self.assertIsNone(metadata.get_ontology_name_by_id(1))

    def test_依赖注入口对不可信身份等同不存在(self) -> None:
        self.write_ontology("s", "bad", oid=1, md={"ontology_name": "别的"})
        self.assertIsNone(metadata.get_ontology_name_by_id(1))

    def test_按名取身份(self) -> None:
        self.write_ontology("s", "a", oid=7, sid=3)
        self.assertEqual(metadata.ontology_identity_by_name("s", "a"),
                         {"scenario_name": "s", "scenario_id": 3,
                          "ontology_name": "a", "ontology_id": 7})
        self.assertIsNone(metadata.ontology_identity_by_name("s", "不存在"))   # 无 yaml
        self.write_ontology("s", "bad", oid=8, md={"ontology_id": None})
        self.assertIsNone(metadata.ontology_identity_by_name("s", "bad"))      # 四元组不全

    def test_物理定位容忍_id_双写不一致(self) -> None:
        # 物理定位（改名/删除用）按 yaml id 命中；也容忍注册表 id（保证不可信时仍可修复）
        self.write_ontology("s", "a", oid=1, md={"ontology_id": 42})
        self.assertEqual(metadata.get_ontology_by_id(42)[1:], ("s", "a"))
        self.assertEqual(metadata.get_ontology_by_id(1)[1:], ("s", "a"))
        self.assertIsNone(metadata.get_ontology_by_id(999))

    def test_注册表_id_取值收口(self) -> None:
        self.write_scenario("s", sid=5)
        self.write_ontology("s", "a", oid=9)
        self.assertEqual(metadata.registry_ids("s", "a"), (5, 9))     # 名字取目录/入参，id 取注册表
        self.assertEqual(metadata.registry_ids("s", "不存在"), (5, None))

    # ─── metadata 段缓存（切页签性能：只缓存 metadata 段，文件改动必须失效）────────────
    def test_metadata_段缓存按文件指纹失效(self) -> None:
        d = self.write_ontology("s", "a", oid=7)
        first = metadata._read_ontology_yaml_metadata(d)
        self.assertEqual(first["ontology_id"], 7)
        # 文件未改动 → 命中缓存（同一对象，不再解析整份 YAML）
        self.assertIs(metadata._read_ontology_yaml_metadata(d), first)
        # 改写文件 → (mtime_ns, size) 变化 → 重新解析
        (d / "ontology.yaml").write_text(yaml.safe_dump(
            {"metadata": {"scenario_name": "s", "scenario_id": 1, "ontology_name": "a",
                          "ontology_id": 8, "deployed_version": "v2.0-final"}},
            allow_unicode=True, sort_keys=False), encoding="utf-8")
        self.assertEqual(metadata._read_ontology_yaml_metadata(d)["ontology_id"], 8)

    def test_metadata_文件缺失返回空字典(self) -> None:
        d = self.write_ontology("s", "a", oid=7)
        self.assertEqual(metadata._read_ontology_yaml_metadata(d)["ontology_id"], 7)
        (d / "ontology.yaml").unlink()
        self.assertEqual(metadata._read_ontology_yaml_metadata(d), {})


if __name__ == "__main__":
    unittest.main()
