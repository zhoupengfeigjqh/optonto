"""自建发布（动态 MCP 容器）业务层契约测试：校验口径 + 容器规格收口。

工具清单编译（依赖真实本体数据与 metadata 注册表）由 test_mcp_publish_compile.py 覆盖。

stdlib unittest 零依赖（core-backend 未接 pytest）：
    cd core-backend && python -m unittest tests.test_mcp_publish -v
"""
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from errors import ConflictError, InvalidInputError, NotFoundError  # noqa: E402
from services import mcp_publish_registry as store  # noqa: E402


def _entry(**over):
    base = {
        "name": "order-svc",
        "kind": store.KIND_ONTOLOGY_FUNCTION,
        "ontology_id": 1,
        "items": ["f1"],
        "host_port": 8020,
        "transport": store.TRANSPORT_STREAMABLE,
        "container_name": "optonto-mcp-publish-order-abc123",
        "token": "tok-123",
        "tools": [{"name": "f1", "description": "d", "inputSchema": {"type": "object", "properties": {}}}],
    }
    base.update(over)
    return base


class ValidateNameCase(unittest.TestCase):
    def test_valid_name_returned_as_is(self):
        self.assertEqual(store.validate_name("order-svc_1", []), "order-svc_1")

    def test_invalid_charset_rejected(self):
        for bad in ("", "  ", "-leading", "has space", "a" * 33, "bad/slash"):
            with self.subTest(bad=bad), self.assertRaises(InvalidInputError):
                store.validate_name(bad, [])

    def test_conflict_with_static_service_rejected(self):
        with self.assertRaises(InvalidInputError):
            store.validate_name("optonto-nginx", [])

    def test_duplicated_name_conflicts(self):
        with self.assertRaises(ConflictError):
            store.validate_name("svc", [{"name": "svc"}])


class ValidatePortCase(unittest.TestCase):
    def test_port_in_range_ok(self):
        self.assertEqual(store.validate_host_port(8020, []), 8020)
        self.assertEqual(store.validate_host_port(8099, []), 8099)

    def test_out_of_range_and_reserved_rejected(self):
        for bad in (79, 8100, 0, -1):
            with self.subTest(bad=bad), self.assertRaises(InvalidInputError):
                store.validate_host_port(bad, [])
        for reserved in (81, 8001, 8002, 8005, 8080):
            with self.subTest(port=reserved), self.assertRaises(InvalidInputError):
                store.validate_host_port(reserved, [])

    def test_non_numeric_port_rejected(self):
        with self.assertRaises(InvalidInputError):
            store.validate_host_port("abc", [])

    def test_port_taken_by_other_publish_conflicts(self):
        with self.assertRaises(ConflictError):
            store.validate_host_port(8021, [{"name": "other", "host_port": 8021}])


class ValidateMiscCase(unittest.TestCase):
    def test_transport_enum(self):
        self.assertEqual(store.validate_transport("sse"), "sse")
        self.assertEqual(store.validate_transport("streamable"), "streamable")
        with self.assertRaises(InvalidInputError):
            store.validate_transport("websocket")

    def test_kind_enum(self):
        self.assertEqual(store.validate_kind("ontology_function"), "ontology_function")
        self.assertEqual(store.validate_kind("behavior"), "behavior")
        with self.assertRaises(InvalidInputError):
            store.validate_kind("sql")

    def test_items_non_empty_and_unique(self):
        self.assertEqual(store.validate_items(["a", " b "]), ["a", "b"])
        for bad in ([], None, "abc", ["a", "a"]):
            with self.subTest(bad=bad), self.assertRaises(InvalidInputError):
                store.validate_items(bad)


class ContainerSpecCase(unittest.TestCase):
    """容器规格是安全边界：镜像/网络/挂载/降权全部收口，调用方无法越界。"""

    def test_spec_is_locked_down(self):
        kwargs = store.build_run_kwargs(_entry())
        self.assertEqual(kwargs["image"], store.IMAGE)
        self.assertEqual(kwargs["network"], store.NETWORK)
        # docker SDK 契约：ports 字典，键 = 容器内端口，值 = 宿主端口
        self.assertEqual(kwargs["ports"], {f"{store.CONTAINER_PORT}/tcp": 8020})
        self.assertEqual(kwargs["volumes"], {})
        self.assertEqual(kwargs["cap_drop"], ["ALL"])
        self.assertIn("no-new-privileges:true", kwargs["security_opt"])
        self.assertEqual(kwargs["restart_policy"]["Name"], "unless-stopped")
        self.assertTrue(kwargs["detach"])

    def test_env_carries_config_and_token_but_token_not_in_config(self):
        env = store.build_run_kwargs(_entry())["environment"]
        config = json.loads(env["PUBLISH_CONFIG_JSON"])
        self.assertEqual(config["name"], "order-svc")
        self.assertEqual(config["kind"], "ontology_function")
        self.assertEqual(config["ontology_id"], 1)
        self.assertNotIn("token", config)
        self.assertEqual(env["AUTH_TOKEN"], "tok-123")
        self.assertEqual(env["PORT"], str(store.CONTAINER_PORT))
        self.assertEqual(env["MCP_TRANSPORT"], "streamable")

    def test_function_publish_points_to_ontology_mcp(self):
        env = store.build_run_kwargs(_entry(kind=store.KIND_ONTOLOGY_FUNCTION))["environment"]
        self.assertEqual(env["ONTOLOGY_FUNCTION_EXECUTOR_URL"], "http://optonto-ontology-function-executor:8006")
        # 只注入该 kind 对应的那一个上游变量：多注入既无意义，又会让"注入名 ≠ 读取名"的漂移更难发现
        self.assertNotIn("DATA_ENGINE_EXECUTOR_URL", env)

    def test_behavior_publish_points_to_data_engine_mcp(self):
        """行为类必须注入 DATA_ENGINE_EXECUTOR_URL（门面按 kind 读这个名字）。

        回归：2026-10-04 之前 core 对两类都注入 ONTOLOGY_FUNCTION_EXECUTOR_URL，于是行为类容器里
        带着一个"名为本体函数执行器、实指数据引擎"的死变量，而门面真正读的
        DATA_ENGINE_EXECUTOR_URL 从未被注入——行为发布只是靠门面默认值巧合跑通。
        """
        env = store.build_run_kwargs(_entry(kind=store.KIND_BEHAVIOR))["environment"]
        self.assertEqual(env["DATA_ENGINE_EXECUTOR_URL"], "http://optonto-data-engine-executor:8005")
        self.assertNotIn("ONTOLOGY_FUNCTION_EXECUTOR_URL", env)

    def test_container_name_has_random_suffix(self):
        a = store.build_container_name("order-svc")
        b = store.build_container_name("order-svc")
        self.assertTrue(a.startswith(store.CONTAINER_PREFIX))
        self.assertNotEqual(a, b)

    def test_labels_traceable(self):
        labels = store.build_run_kwargs(_entry())["labels"]
        self.assertEqual(labels["optonto.published"], "1")
        self.assertEqual(labels["optonto.publish_name"], "order-svc")
        self.assertEqual(labels["optonto.ontology_id"], "1")


class PublicViewCase(unittest.TestCase):
    def test_view_exposes_token_and_runtime(self):
        view = store.public_view(_entry(), {"status": "running", "running": True})
        self.assertEqual(view["name"], "order-svc")
        self.assertEqual(view["token"], "tok-123")
        self.assertEqual(view["host_port"], 8020)
        self.assertEqual(view["transport"], "streamable")
        self.assertEqual(view["tool_count"], 1)
        self.assertTrue(view["running"])
        self.assertEqual(view["status"], "running")


class RegistryCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self._origin = store.REGISTRY_FILE
        store.REGISTRY_FILE = Path(self._tmp.name) / "publishes.json"

    def tearDown(self):
        store.REGISTRY_FILE = self._origin

    def test_save_get_delete(self):
        store.save_entry(_entry())
        self.assertEqual(store.get_entry("order-svc")["host_port"], 8020)
        store.delete_entry("order-svc")
        with self.assertRaises(NotFoundError):
            store.get_entry("order-svc")

    def test_delete_missing_raises_not_found(self):
        with self.assertRaises(NotFoundError):
            store.delete_entry("ghost")


if __name__ == "__main__":
    unittest.main()