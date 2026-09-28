"""统一错误响应契约测试（章程 VI：统一错误格式 + 稳定错误码）。

覆盖：
- 业务错误（HTTPException 404）→ 响应体 {code, message, detail} 且均为非空字符串
- 路径参数校验失败（422）→ detail 折叠为字符串（不再是 FastAPI 默认的数组，前端可读）
- 路由层错误（405 Method Not Allowed）→ 同样结构化

运行：
    python -m pytest core-backend/tests/test_error_contract.py -q
    cd core-backend && python -m unittest tests.test_error_contract -v
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi.testclient import TestClient  # noqa: E402

from main import app  # noqa: E402


class ErrorContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app, raise_server_exceptions=False)

    def _assert_structured(self, resp, expected_status: int) -> dict:
        """断言响应符合统一错误契约：code / message / detail 三字段齐备且可读。"""
        self.assertEqual(resp.status_code, expected_status)
        body = resp.json()
        self.assertEqual(body.get("code"), expected_status)
        for key in ("message", "detail"):
            self.assertIn(key, body)
            self.assertIsInstance(body[key], str)
            self.assertTrue(body[key], f"{key} 不得为空")
        return body

    def test_business_error_is_structured(self):
        """业务 404：HTTPException(detail=字符串) 应折叠为统一结构。"""
        body = self._assert_structured(self.client.get("/api/ontologies/99999999"), 404)
        self.assertEqual(body["message"], "本体不存在")

    def test_path_param_validation_error_message_is_string(self):
        """路径参数类型错误：detail 必须折叠为字符串，而非 FastAPI 默认的错误数组。"""
        body = self._assert_structured(self.client.get("/api/ontologies/not-an-int"), 422)
        self.assertIn("参数校验失败", body["message"])

    def test_method_not_allowed_is_structured(self):
        """路由层 405 也走统一结构（不返回 Starlette 默认裸响应）。"""
        self._assert_structured(self.client.post("/health"), 405)

    # ─── 领域异常 → HTTP 映射（章程 II：业务层不依赖传输层）─────────────────

    def test_entity_crud_raises_domain_errors(self):
        """业务层查重/定位抛领域异常，而非 fastapi.HTTPException（hermetic，不依赖数据）。"""
        from errors import ConflictError, NotFoundError
        from services.entity_crud import ensure_unique, find_index

        class _Item:
            def __init__(self, name: str):
                self.name = name

        items = [_Item("已存在")]
        with self.assertRaises(ConflictError) as ctx:
            ensure_unique(items, "已存在", "概念")
        self.assertEqual(ctx.exception.status_code, 400)
        with self.assertRaises(NotFoundError) as ctx2:
            find_index(items, "不存在", "概念")
        self.assertEqual(ctx2.exception.status_code, 404)

    def _first_ontology_id(self) -> int:
        """取一个真实本体 id；无数据时跳过（本机/CI 数据目录可能为空）。"""
        ontologies = self.client.get("/api/ontologies").json()
        if not ontologies:
            self.skipTest("无本体数据，跳过")
        return ontologies[0]["id"]

    def test_domain_conflict_maps_to_400(self):
        """业务层 ConflictError（重名）→ 400 + 统一错误体；且在任何写盘之前抛出。"""
        oid = self._first_ontology_id()
        concepts = self.client.get(f"/api/ontologies/{oid}/concepts").json()
        if not concepts:
            self.skipTest("该本体无概念，跳过")
        name = concepts[0]["name"]
        body = self._assert_structured(
            self.client.post(f"/api/ontologies/{oid}/concepts", json={"name": name}), 400
        )
        self.assertEqual(body["message"], "概念名称已存在")

    def test_domain_not_found_maps_to_404(self):
        """业务层 NotFoundError（定位失败）→ 404 + 统一错误体。"""
        oid = self._first_ontology_id()
        missing = "__e2e_nonexistent_concept__"
        body = self._assert_structured(
            self.client.put(f"/api/ontologies/{oid}/concepts/{missing}", json={"name": missing}), 404
        )
        self.assertEqual(body["message"], "概念不存在")


if __name__ == "__main__":
    unittest.main()
