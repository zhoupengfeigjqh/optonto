"""自建发布的工具清单编译契约（真实 .data 驱动）。

核心断言：
- ``ontology_id`` 走 const 形态：以 const 出现但**不进 required**（调用方无需传，
  容器转发时注入绑定本体）——这是自建发布与平台固定发布面的唯一形态差异；
- ``scope`` 上下文块照旧注入（agent 侧挂载过滤依赖它），分类标记取真实归位；
- 行为未就绪（未完成数据引擎映射）拒发（契约 ⑥：清单里有、调用必失败就是违约）；
- 勾选项不存在报 404 语义（NotFoundError）。

运行：cd core-backend && python -m unittest tests.test_mcp_publish_compile -v
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from errors import InvalidInputError, NotFoundError  # noqa: E402
from repositories import metadata  # noqa: E402
from services import mcp_publish_registry as store  # noqa: E402
from services.mcp_contract_bridge import CATEGORY_BEHAVIOR, CATEGORY_FUNCTION  # noqa: E402


def _ontologies():
    """列出 .data 中真实存在的本体 (ontology_id, ontology_name, data_dict)。"""
    from services import load_ontology_data
    out = []
    for item in metadata.list_all_ontologies():
        oid = item.get("id")
        located = metadata.get_ontology_name_by_id(oid) if oid is not None else None
        if not located:
            continue
        out.append((oid, located[1], load_ontology_data(*located).model_dump()))
    return out


class FunctionCompileCase(unittest.TestCase):
    def setUp(self):
        self.picked = None
        for oid, on_name, data in _ontologies():
            for fn in data.get("functions") or []:
                if (fn or {}).get("name"):
                    self.picked = (oid, on_name, fn["name"])
                    return
        if not self.picked:
            self.skipTest(".data 中无可用本体函数")

    def test_const_ontology_id_not_required(self):
        oid, _, fname = self.picked
        _, tools = store.compile_tools(oid, store.KIND_ONTOLOGY_FUNCTION, [fname])
        schema = tools[0]["inputSchema"]
        self.assertEqual(schema["properties"]["ontology_id"]["const"], oid)
        self.assertNotIn("ontology_id", schema["required"])

    def test_scope_block_and_category_present(self):
        oid, on_name, fname = self.picked
        _, tools = store.compile_tools(oid, store.KIND_ONTOLOGY_FUNCTION, [fname])
        schema = tools[0]["inputSchema"]
        self.assertEqual(schema["x-category"], CATEGORY_FUNCTION)
        ctx = schema["properties"]["scope"]["properties"]
        self.assertEqual(ctx["name"]["const"], fname)
        self.assertEqual(ctx["ontology_id"]["const"], oid)
        self.assertEqual(ctx["ontology_name"]["const"], on_name)
        # 2026-10-05：旧的 x-publish-service 标记已删除（写而不读的死数据，消费端只看 x-category）
        self.assertNotIn("x-publish-service", schema)

    def test_required_only_contains_business_params(self):
        oid, _, fname = self.picked
        _, tools = store.compile_tools(oid, store.KIND_ONTOLOGY_FUNCTION, [fname])
        schema = tools[0]["inputSchema"]
        self.assertNotIn("scope", schema["required"])
        for key in schema["required"]:
            self.assertNotEqual(key, "ontology_id")

    def test_unknown_item_raises_not_found(self):
        oid, _, _ = self.picked
        with self.assertRaises(NotFoundError):
            store.compile_tools(oid, store.KIND_ONTOLOGY_FUNCTION, ["__不存在的函数__"])


class BehaviorCompileCase(unittest.TestCase):
    def _ready_behavior(self):
        from services.mcp_contract_bridge import ready_behavior_names
        for oid, on_name, data in _ontologies():
            ready = ready_behavior_names(data)
            for b in data.get("behaviors") or []:
                if (b or {}).get("name") in ready:
                    return oid, on_name, b["name"]
        return None

    def test_ready_behavior_compiles_with_behavior_category(self):
        picked = self._ready_behavior()
        if not picked:
            self.skipTest(".data 中无就绪行为（未完成数据引擎映射）")
        oid, on_name, bname = picked
        ontology_name, tools = store.compile_tools(oid, store.KIND_BEHAVIOR, [bname])
        self.assertEqual(ontology_name, on_name)
        schema = tools[0]["inputSchema"]
        self.assertEqual(schema["x-category"], CATEGORY_BEHAVIOR)
        self.assertEqual(schema["properties"]["scope"]["properties"]["name"]["const"], bname)
        self.assertNotIn("ontology_id", schema["required"])

    def test_unready_behavior_rejected(self):
        """契约 ⑥：未就绪行为不发布（否则清单承诺了必失败的调用）。"""
        from services.mcp_contract_bridge import ready_behavior_names
        target = None
        for oid, on_name, data in _ontologies():
            ready = ready_behavior_names(data)
            for b in data.get("behaviors") or []:
                name = (b or {}).get("name")
                if name and name not in ready:
                    target = (oid, name)
                    break
            if target:
                break
        if not target:
            self.skipTest(".data 中没有未就绪行为（全部已映射）")
        with self.assertRaises(InvalidInputError):
            store.compile_tools(target[0], store.KIND_BEHAVIOR, [target[1]])


class BuildEntryCase(unittest.TestCase):
    def test_build_entry_end_to_end_with_temp_registry(self):
        import tempfile
        picked = None
        for oid, on_name, data in _ontologies():
            for fn in data.get("functions") or []:
                if (fn or {}).get("name"):
                    picked = (oid, fn["name"])
                    break
            if picked:
                break
        if not picked:
            self.skipTest(".data 中无可用本体函数")
        with tempfile.TemporaryDirectory() as tmp:
            origin = store.REGISTRY_FILE
            store.REGISTRY_FILE = Path(tmp) / "publishes.json"
            try:
                entry = store.build_entry(ontology_id=picked[0], name="svc-e2e",
                                          kind=store.KIND_ONTOLOGY_FUNCTION, items=[picked[1]],
                                          host_port=8055, transport=store.TRANSPORT_SSE)
            finally:
                store.REGISTRY_FILE = origin
        self.assertEqual(entry["name"], "svc-e2e")
        self.assertEqual(entry["host_port"], 8055)
        self.assertEqual(entry["transport"], "sse")
        self.assertEqual(entry["items"], [picked[1]])
        self.assertTrue(entry["container_name"].startswith(store.CONTAINER_PREFIX))
        self.assertGreaterEqual(len(entry["token"]), 16)


if __name__ == "__main__":
    unittest.main()