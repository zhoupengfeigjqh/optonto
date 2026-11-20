"""存量本体引用（spec 010）端点契约测试。

覆盖三个端点：``GET /api/ontology-refs/candidates``、``POST /api/ontology-refs/precheck``、
``POST /api/threads``（带 ``ontology_refs``），以及清空 / 删除 / 快照不漂移两条语义。

数据全部 mock（``services.load_ontology_data`` / ``services.thread_store.resolve_ids`` /
``services.ontology_registry.list_all_ontologies``），线程目录指向临时目录，
不触碰真实 ``.data``。

运行：
    cd core-backend && .venv/Scripts/python.exe -m pytest tests/test_thread_ontology_refs.py -q
"""

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402

from main import app  # noqa: E402
from schemas import AttributeItem, BehaviorItem, ConceptItem, ConstraintItem, FunctionItem, OntologyData  # noqa: E402
from services import ontology_refs as refs  # noqa: E402
from services import thread_store  # noqa: E402


def ontology(*, amount_type: str = "number", amount_constraint=None) -> OntologyData:
    return OntologyData(
        concepts=[
            ConceptItem(
                name="Order",
                title="订单",
                attributes=[
                    AttributeItem(
                        name="orderNo",
                        title="订单号",
                        type="string",
                        constraint=ConstraintItem(unique=True, required=True),
                    ),
                    AttributeItem(name="amount", title="金额", type=amount_type, constraint=amount_constraint),
                ],
            )
        ],
        functions=[FunctionItem(name="sumAmount", title="汇总金额")],
        behaviors=[BehaviorItem(name="createOrder", title="创建订单")],
    )


class ThreadOntologyRefsEndpointTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app, raise_server_exceptions=False)

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)

        self.ontologies = {
            ("订单场景", "订单排程"): ontology(),          # 当前对话所属本体
            ("订单场景", "货品BOM"): ontology(),           # 可引用
            ("库存场景", "库存模型"): ontology(amount_type="string"),  # 与货品BOM 冲突
            ("订单场景", "空本体"): OntologyData(),
            ("订单场景", "坏本体"): ontology(),            # 解析失败用
        }

        def fake_load(sc, on):
            if on == "坏本体":
                raise ValueError("yaml 损坏")
            return self.ontologies[(sc, on)]

        def fake_resolve(sc, on):
            return ("1", "2") if (sc, on) in self.ontologies else (None, None)

        def fake_registry():
            return [
                {"ontology_id": "12", "scenario_id": "3", "scenario_name": "订单场景",
                 "ontology_name": "货品BOM", "description": "BOM 与工艺", "deployed_version": "v1.2"},
                {"ontology_id": "13", "scenario_id": "3", "scenario_name": "订单场景",
                 "ontology_name": "空本体", "description": "", "deployed_version": ""},
                {"ontology_id": "14", "scenario_id": "3", "scenario_name": "订单场景",
                 "ontology_name": "坏本体", "description": "", "deployed_version": ""},
                {"ontology_id": "15", "scenario_id": "3", "scenario_name": "订单场景",
                 "ontology_name": "订单排程", "description": "当前本体", "deployed_version": "v1.0"},
            ]

        self.patches = [
            mock.patch("services.load_ontology_data", side_effect=fake_load),
            mock.patch("services.thread_store.resolve_ids", side_effect=fake_resolve),
            mock.patch("services.thread_store.DEMAND_THREADS_DIR", self.root),
            mock.patch("services.ontology_registry.list_all_ontologies", side_effect=fake_registry),
        ]
        for patcher in self.patches:
            patcher.start()
            self.addCleanup(patcher.stop)

    # ─── 工具 ──────────────────────────────────────────────────────────────

    def create(self, refs_input=None, **over):
        body = {
            "title": "新对话",
            "scenario_name": over.get("scenario_name", "订单场景"),
            "ontology_name": over.get("ontology_name", "订单排程"),
            "version": "v1.0",
        }
        if refs_input is not None:
            body["ontology_refs"] = refs_input
        return self.client.post("/api/threads", json=body)

    def stored(self, thread_id: str) -> dict:
        path = self.root / thread_id / ".data.json"
        return json.loads(path.read_text(encoding="utf-8"))

    # ─── 候选清单 ──────────────────────────────────────────────────────────

    def test_candidates_mark_unreferenceable_and_skip_broken(self):
        resp = self.client.get("/api/ontology-refs/candidates")
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body["max_count"], refs.ONTOLOGY_REF_MAX_COUNT)
        by_name = {c["ontology_name"]: c for c in body["candidates"]}
        self.assertTrue(by_name["货品BOM"]["referenceable"])
        self.assertIsNone(by_name["货品BOM"]["skip_reason"])
        self.assertFalse(by_name["空本体"]["referenceable"])
        self.assertEqual(by_name["空本体"]["skip_reason"], "暂无可提取内容")
        self.assertNotIn("坏本体", by_name)  # 单个解析失败 → 跳过，不拖垮端点
        self.assertEqual(by_name["货品BOM"]["counts"], {"concepts": 1, "functions": 1, "behaviors": 1})
        # 顺序沿用注册表返回（updated_at 降序）
        self.assertEqual([c["ontology_name"] for c in body["candidates"]],
                         ["货品BOM", "空本体", "订单排程"])

    def test_candidates_exclude_current_ontology(self):
        resp = self.client.get(
            "/api/ontology-refs/candidates",
            params={"exclude_scenario": "订单场景", "exclude_ontology": "订单排程"},
        )
        names = [c["ontology_name"] for c in resp.json()["candidates"]]
        self.assertNotIn("订单排程", names)

    def test_candidates_exclude_ignored_when_half_given(self):
        resp = self.client.get("/api/ontology-refs/candidates", params={"exclude_scenario": "订单场景"})
        names = [c["ontology_name"] for c in resp.json()["candidates"]]
        self.assertIn("订单排程", names)

    # ─── 预检 ──────────────────────────────────────────────────────────────

    def test_precheck_ok_returns_only_contracted_fields(self):
        resp = self.client.post("/api/ontology-refs/precheck",
                                json={"refs": [{"scenario_name": "订单场景", "ontology_name": "货品BOM"}]})
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(set(body), {"allowed", "max_tokens", "token_estimate", "conflicts", "reason"})
        self.assertTrue(body["allowed"])
        self.assertIsNone(body["reason"])
        self.assertEqual(body["conflicts"], [])

    def test_precheck_reports_conflict(self):
        resp = self.client.post("/api/ontology-refs/precheck", json={"refs": [
            {"scenario_name": "订单场景", "ontology_name": "货品BOM"},
            {"scenario_name": "库存场景", "ontology_name": "库存模型"},
        ]})
        body = resp.json()
        self.assertTrue(body["allowed"])  # 冲突不阻断，只要求确认
        self.assertEqual(len(body["conflicts"]), 1)
        self.assertEqual(body["conflicts"][0]["name"], "Order")
        self.assertIn("amount：number ≠ string", body["conflicts"][0]["differences"])

    def test_precheck_missing_ontology_is_404(self):
        resp = self.client.post("/api/ontology-refs/precheck",
                                json={"refs": [{"scenario_name": "订单场景", "ontology_name": "不存在"}]})
        self.assertEqual(resp.status_code, 404)

    def test_precheck_malformed_refs_is_400(self):
        resp = self.client.post("/api/ontology-refs/precheck", json={"refs": "not-a-list"})
        self.assertEqual(resp.status_code, 400)

    def test_precheck_token_limit(self):
        with mock.patch.object(refs, "ONTOLOGY_REF_MAX_TOKENS", 5):
            resp = self.client.post("/api/ontology-refs/precheck",
                                    json={"refs": [{"scenario_name": "订单场景", "ontology_name": "货品BOM"}]})
        body = resp.json()
        self.assertFalse(body["allowed"])
        self.assertIn("超过上限 5", body["reason"])

    # ─── 创建 ──────────────────────────────────────────────────────────────

    def test_create_with_refs_persists_snapshot(self):
        resp = self.create([{"scenario_name": "订单场景", "ontology_name": "货品BOM"}])
        self.assertEqual(resp.status_code, 201, resp.text)
        thread = resp.json()
        snapshot = thread["ontology_refs"]
        self.assertIn("snapshot_at", snapshot)
        self.assertEqual(snapshot["token_estimate"], refs.estimate_tokens(snapshot["prompt_text"]))
        self.assertIn("=== 存量本体参考（既有约定，硬约束）===", snapshot["prompt_text"])
        entry = snapshot["refs"][0]
        self.assertEqual(entry["ontology_id"], "2")
        self.assertEqual(entry["scenario_name"], "订单场景")
        self.assertEqual(len(entry["items"]["concepts"]), 1)
        self.assertEqual(entry["items"]["concepts"][0]["attributes"][0]["constraint"], "唯一；必填")
        # 落盘一致
        self.assertEqual(self.stored(thread["id"])["ontology_refs"]["prompt_text"], snapshot["prompt_text"])

    def test_create_without_refs_has_no_key(self):
        resp = self.create()
        self.assertEqual(resp.status_code, 201)
        data = self.stored(resp.json()["id"])
        self.assertNotIn("ontology_refs", data)

    def test_create_deduplicates_refs(self):
        resp = self.create([
            {"scenario_name": "订单场景", "ontology_name": "货品BOM"},
            {"scenario_name": "订单场景", "ontology_name": "货品BOM"},
        ])
        self.assertEqual(len(resp.json()["ontology_refs"]["refs"]), 1)

    def test_create_self_reference_is_400(self):
        resp = self.create([{"scenario_name": "订单场景", "ontology_name": "订单排程"}])
        self.assertEqual(resp.status_code, 400)
        self.assertIn("不能引用当前对话所属的本体", resp.json()["message"])
        self.assertEqual(list(self.root.iterdir()), [])

    def test_create_over_token_limit_is_400_without_leftover_dir(self):
        with mock.patch.object(refs, "ONTOLOGY_REF_MAX_TOKENS", 5):
            resp = self.create([{"scenario_name": "订单场景", "ontology_name": "货品BOM"}])
        self.assertEqual(resp.status_code, 400)
        self.assertIn("超过上限 5", resp.json()["message"])
        self.assertEqual(list(self.root.iterdir()), [])

    def test_create_malformed_refs_is_400(self):
        for bad in ("not-a-list", [{"scenario_name": "订单场景"}], [{"ontology_name": "货品BOM"}]):
            resp = self.create(bad)
            self.assertEqual(resp.status_code, 400, f"{bad} should be rejected")

    # ─── 读取视图 ──────────────────────────────────────────────────────────

    def test_detail_returns_snapshot_but_list_does_not(self):
        thread_id = self.create([{"scenario_name": "订单场景", "ontology_name": "货品BOM"}]).json()["id"]
        detail = self.client.get(f"/api/threads/{thread_id}").json()
        self.assertIn("prompt_text", detail["ontology_refs"])
        listed = self.client.get("/api/threads").json()
        self.assertEqual(len(listed), 1)
        self.assertNotIn("ontology_refs", listed[0])

    def test_snapshot_does_not_drift_when_source_changes(self):
        thread_id = self.create([{"scenario_name": "订单场景", "ontology_name": "货品BOM"}]).json()["id"]
        before = self.client.get(f"/api/threads/{thread_id}").json()["ontology_refs"]
        # 源本体被改 + 被删
        self.ontologies[("订单场景", "货品BOM")] = OntologyData()
        self.ontologies.pop(("订单场景", "货品BOM"), None)
        after = self.client.get(f"/api/threads/{thread_id}").json()["ontology_refs"]
        self.assertEqual(before["prompt_text"], after["prompt_text"])
        self.assertEqual(before["snapshot_at"], after["snapshot_at"])

    def test_clear_keeps_refs_and_delete_removes(self):
        thread_id = self.create([{"scenario_name": "订单场景", "ontology_name": "货品BOM"}]).json()["id"]
        self.assertEqual(self.client.post(f"/api/threads/{thread_id}/clear").status_code, 200)
        detail = self.client.get(f"/api/threads/{thread_id}").json()
        self.assertIn("ontology_refs", detail)
        self.assertEqual(detail["messages"], [])
        self.assertEqual(self.client.delete(f"/api/threads/{thread_id}").status_code, 200)
        self.assertFalse((self.root / thread_id).exists())


if __name__ == "__main__":
    unittest.main()
