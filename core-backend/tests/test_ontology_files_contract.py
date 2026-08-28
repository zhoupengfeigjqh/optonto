"""本体文件契约测试（core 端）—— 镜像 docs/contracts/ontology-yaml.md 用例表（O1-O5 / T1-T7）。

与 agent-backend/src/services/ontology-gateway.test.ts 是同一组用例的双端镜像：
改读取规则必须先改契约文档，再同步两侧用例。

stdlib unittest 零依赖（core-backend 未接 pytest）：
    python -m unittest tests.test_ontology_files_contract -v
"""

import sys
import tempfile
import unittest
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import services  # noqa: E402
from schemas import BehaviorItem, DataEngineItem  # noqa: E402

SC = "SC"
ON = "ON"


def http_engine(behavior: str, method: str) -> dict:
    return {
        "name": f"e-{behavior}-{method}",
        "behavior_name": behavior,
        "engine_type": "HTTP",
        "target": {"method": method, "url": "http://x"},
    }


def sql_engine(behavior: str) -> dict:
    return {
        "name": f"e-{behavior}-sql",
        "behavior_name": behavior,
        "engine_type": "SQL",
        "target": {"method": "POST"},
        "sql": "select 1",
    }


class ContractCase(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.onto_dir = Path(self._tmp.name) / SC / ON
        self.onto_dir.mkdir(parents=True)
        # services 模块级 ONTO_MARKET_DIR 指向临时目录（测试后还原）
        self._orig = services.ONTO_MARKET_DIR
        services.ONTO_MARKET_DIR = Path(self._tmp.name)
        self.addCleanup(setattr, services, "ONTO_MARKET_DIR", self._orig)

    def write_ontology(self, behaviors: list, data_engines: list | None = None, securities: list | None = None) -> None:
        doc: dict = {"behaviors": behaviors}
        if data_engines is not None:
            doc["data_engines"] = data_engines
        if securities is not None:
            doc["securities"] = securities
        (self.onto_dir / "ontology.yaml").write_text(yaml.safe_dump(doc, allow_unicode=True), encoding="utf-8")

    def write_overlay(self, filename: str, key: str, items: list, wrap: bool) -> None:
        doc = {key: items} if wrap else items
        (self.onto_dir / filename).write_text(yaml.safe_dump(doc, allow_unicode=True), encoding="utf-8")

    def load(self):
        return services._load_ontology_data_uncached(SC, ON)

    def resolve(self, behavior: BehaviorItem, engines: list[DataEngineItem]) -> str:
        return services._resolve_op_type(behavior, engines)


class TestOverlay(ContractCase):
    """契约 §2 Overlay 回退"""

    def test_O1_独立文件覆盖旧段_engines(self) -> None:
        self.write_ontology([{"name": "B1"}], data_engines=[http_engine("B1", "GET")])
        self.write_overlay("data_engines.yaml", "data_engines", [http_engine("B1", "POST")], wrap=True)
        data = self.load()
        self.assertEqual(data.data_engines[0].target.method, "POST")

    def test_O2_独立文件缺失回退旧段(self) -> None:
        self.write_ontology([{"name": "B1"}], data_engines=[http_engine("B1", "POST")])
        data = self.load()
        self.assertEqual(len(data.data_engines), 1)
        self.assertEqual(data.data_engines[0].target.method, "POST")

    def test_O3_独立文件覆盖旧段_securities(self) -> None:
        self.write_ontology(
            [{"name": "B1"}],
            securities=[{"action_name": "B1", "scope": ["disable"], "confirm": True}],
        )
        self.write_overlay("securities.yaml", "securities",
                           [{"action_name": "B1", "scope": ["everyone"], "confirm": True}], wrap=True)
        data = self.load()
        self.assertEqual(data.securities[0].scope, ["everyone"])

    def test_O4_裸列表形态等价接受(self) -> None:
        self.write_ontology([{"name": "B1"}])
        self.write_overlay("data_engines.yaml", "data_engines", [http_engine("B1", "POST")], wrap=False)
        data = self.load()
        self.assertEqual(len(data.data_engines), 1)

    def test_O5_映射包裹形态等价接受(self) -> None:
        self.write_ontology([{"name": "B1"}])
        self.write_overlay("data_engines.yaml", "data_engines", [http_engine("B1", "POST")], wrap=True)
        data = self.load()
        self.assertEqual(len(data.data_engines), 1)


class TestOpType(ContractCase):
    """契约 §3 操作类型推导（_resolve_op_type）"""

    def engines(self, *ds: dict) -> list[DataEngineItem]:
        return [DataEngineItem(**d) for d in ds]

    def test_T1_显式command优先(self) -> None:
        b = BehaviorItem(name="B1", op_type="command")
        self.assertEqual(self.resolve(b, self.engines(sql_engine("B1"))), "command")

    def test_T2_显式query优先(self) -> None:
        b = BehaviorItem(name="B1", op_type="query")
        self.assertEqual(self.resolve(b, self.engines(http_engine("B1", "POST"))), "query")

    def test_T3_空op_type加HTTP_POST判command(self) -> None:
        b = BehaviorItem(name="B1")
        self.assertEqual(self.resolve(b, self.engines(http_engine("B1", "POST"))), "command")

    def test_T4_空op_type加HTTP_GET判query(self) -> None:
        b = BehaviorItem(name="B1")
        self.assertEqual(self.resolve(b, self.engines(http_engine("B1", "GET"))), "query")

    def test_T5_空op_type加SQL引擎判query(self) -> None:
        b = BehaviorItem(name="B1")
        self.assertEqual(self.resolve(b, self.engines(sql_engine("B1"))), "query")

    def test_T6_空op_type无引擎判query(self) -> None:
        b = BehaviorItem(name="B1")
        self.assertEqual(self.resolve(b, []), "query")

    def test_T7_method小写不敏感(self) -> None:
        b = BehaviorItem(name="B1")
        self.assertEqual(self.resolve(b, self.engines(http_engine("B1", "post"))), "command")


if __name__ == "__main__":
    unittest.main()
