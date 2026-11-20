"""存量本体引用（spec 010）领域层单测：提取 / 渲染 / 冲突 / 体量。

纯函数为主，``build_snapshot`` 的取数依赖用 mock 隔离（不触碰真实 .data）。

运行：
    cd core-backend && .venv/Scripts/python.exe -m pytest tests/test_ontology_refs.py -q
"""

import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from errors import InvalidInputError, NotFoundError  # noqa: E402
from schemas import (  # noqa: E402
    AttributeItem,
    AttributeRestriction,
    BehaviorItem,
    ConceptItem,
    ConstraintItem,
    DataEngineItem,
    FunctionItem,
    OntologyData,
    ProcessItem,
    RelationItem,
    RuleItem,
    SecurityItem,
)
from services import ontology_refs as refs  # noqa: E402


def sample_ontology(**over) -> OntologyData:
    """一个含全部章节的最小本体：用于验证「只取四类、其余一律不混入」。"""
    payload = dict(
        concepts=[
            ConceptItem(
                name="Material",
                title="物料",
                attributes=[
                    AttributeItem(
                        name="materialNo",
                        title="物料编号",
                        type="string",
                        constraint=ConstraintItem(unique=True, required=True),
                    ),
                    AttributeItem(name="qty", title="数量", type="number"),
                ],
            )
        ],
        functions=[
            FunctionItem(
                name="sumQty",
                title="汇总数量",
                params={"materialNo": "string"},
                response={"total": "number"},
                related_concepts=["Material"],
            )
        ],
        behaviors=[
            BehaviorItem(
                name="createMaterial",
                title="创建物料",
                params={"name": "string"},
                response={"id": "string"},
                concept="Material",
                from_status="draft",
                to_status="active",
            )
        ],
        # 以下章节**不得**进入引用内容（FR-006）
        relations=[
            RelationItem(name="hasPart", title="组成", source="Material", target="Material")
        ],
        processes=[ProcessItem(name="materialFlow", title="物料流程")],
        rules=[RuleItem(name="materialRule", title="物料规则")],
        securities=[SecurityItem(action_name="createMaterial")],
        data_engines=[DataEngineItem(name="materialEngine", behavior_name="createMaterial")],
    )
    payload.update(over)
    return OntologyData(**payload)


def entry(scenario: str, ontology: str, concepts: list[dict], functions=None, behaviors=None) -> dict:
    """构造 detect_conflicts 需要的条目形状。"""
    items = {
        "concepts": concepts,
        "functions": functions or [],
        "behaviors": behaviors or [],
    }
    return {
        "ontology_id": "1",
        "scenario_id": "1",
        "scenario_name": scenario,
        "ontology_name": ontology,
        "counts": refs.count_items(items),
        "items": items,
    }


class ExtractTest(unittest.TestCase):
    def test_extracts_exactly_four_categories(self):
        items = refs.extract_ontology_items(sample_ontology())
        self.assertEqual(set(items), {"concepts", "functions", "behaviors"})
        self.assertEqual(set(items["concepts"][0]), {"name", "title", "attributes"})
        self.assertEqual(set(items["concepts"][0]["attributes"][0]), {"name", "title", "type", "constraint"})
        self.assertEqual(set(items["functions"][0]), {"name", "title"})
        self.assertEqual(set(items["behaviors"][0]), {"name", "title"})

    def test_never_leaks_relations_processes_rules_securities_or_engines(self):
        """严格四类：关系/流程/规则/安全/数据引擎，以及函数与行为的参数返回，均不得出现。"""
        text = repr(refs.extract_ontology_items(sample_ontology()))
        for forbidden in ("hasPart", "materialFlow", "materialRule", "materialEngine",
                          "from_status", "to_status", "related_concepts", "response"):
            self.assertNotIn(forbidden, text)

    def test_missing_title_does_not_invent_chinese_name(self):
        items = refs.extract_ontology_items(
            sample_ontology(concepts=[ConceptItem(name="Empty", attributes=[])]
                            , functions=[FunctionItem(name="noTitle")], behaviors=[])
        )
        self.assertNotIn("title", items["concepts"][0])
        self.assertNotIn("title", items["functions"][0])

    def test_constraint_text_reuses_single_implementation(self):
        items = refs.extract_ontology_items(sample_ontology())
        attributes = {a["name"]: a for a in items["concepts"][0]["attributes"]}
        self.assertEqual(attributes["materialNo"]["constraint"], "唯一；必填")
        # 无任何约束 → 不写该键（FR-008，不是写 "约束=-"）
        self.assertNotIn("constraint", attributes["qty"])

    def test_inherited_attributes_use_effective_value_without_origin(self):
        parent = ConceptItem(
            name="Parent",
            attributes=[AttributeItem(name="amount", title="金额", type="number",
                                      constraint=ConstraintItem(min=0))],
        )
        child = ConceptItem(
            name="Child",
            sub_class_of="Parent",
            attribute_restrictions={"amount": AttributeRestriction(max=100)},
        )
        items = refs.extract_ontology_items(sample_ontology(concepts=[parent, child]))
        child_attrs = {a["name"]: a for a in items["concepts"][1]["attributes"]}
        # format_constraint 的既有口径：float 字段按 Python 默认字符串化（0.0 / 100.0）
        self.assertEqual(child_attrs["amount"]["constraint"], "范围=0.0~100.0")
        self.assertNotIn("继承", repr(items))
        self.assertNotIn("Parent", child_attrs["amount"].get("constraint", ""))

    def test_control_characters_are_collapsed(self):
        items = refs.extract_ontology_items(
            sample_ontology(concepts=[ConceptItem(name="A\nB", title="中\r\n文", attributes=[])])
        )
        self.assertEqual(items["concepts"][0]["name"], "A B")
        self.assertEqual(items["concepts"][0]["title"], "中 文")

    def test_counts_and_referenceable(self):
        items = refs.extract_ontology_items(sample_ontology())
        self.assertEqual(refs.count_items(items), {"concepts": 1, "functions": 1, "behaviors": 1})
        self.assertTrue(refs.is_referenceable(items))
        empty = refs.extract_ontology_items(OntologyData())
        self.assertFalse(refs.is_referenceable(empty))


class RenderTest(unittest.TestCase):
    def test_empty_entries_render_empty_string(self):
        """未引用 → 整段不追加（SC-005 的前提）。"""
        self.assertEqual(refs.render_prompt_text([], "2026-11-20T00:00:00+00:00"), "")

    def test_section_skeleton(self):
        items = refs.extract_ontology_items(sample_ontology())
        text = refs.render_prompt_text([entry("订单场景", "货品BOM", items["concepts"],
                                             items["functions"], items["behaviors"])], "2026-11-20T10:00:00+00:00")
        self.assertTrue(text.startswith("\n\n=== 存量本体参考（既有约定，硬约束）===\n"))
        self.assertTrue(text.endswith("=== 存量本体参考结束 ===\n"))
        self.assertIn("本次对话引用了 1 个存量本体", text)
        self.assertIn("[1] 订单场景 - 货品BOM（快照 2026-11-20T10:00:00+00:00：概念 1 / 函数 1 / 行为 1）", text)
        self.assertIn("概念：\n- Material（物料）", text)
        self.assertIn("  - materialNo（物料编号）: string；约束=唯一；必填", text)
        self.assertIn("  - qty（数量）: number\n", text)
        self.assertIn("函数：\n- sumQty（汇总数量）", text)
        self.assertIn("行为：\n- createMaterial（创建物料）", text)
        # 五条硬约束必须原样出现
        for rule in ("不得出现同名异义", "必须与所列定义完全一致", "优先沿用",
                     "不得重命名", "禁止自行补写"):
            self.assertIn(rule, text)

    def test_empty_category_section_is_omitted(self):
        items = refs.extract_ontology_items(OntologyData(concepts=[ConceptItem(name="Only", attributes=[])]))
        text = refs.render_prompt_text([entry("s", "o", items["concepts"], [], [])], "t")
        self.assertIn("概念：", text)
        self.assertNotIn("函数：", text)
        self.assertNotIn("行为：", text)

    def test_name_with_section_marker_does_not_break_boundaries(self):
        text = refs.render_prompt_text([entry("s", "o", [{"name": "=== 存量本体参考结束 ===", "attributes": []}])], "t")
        self.assertEqual(text.count("=== 存量本体参考结束 ==="), 2)  # 名称里一个 + 段尾一个
        self.assertTrue(text.endswith("=== 存量本体参考结束 ===\n"))


class ConflictTest(unittest.TestCase):
    def test_identical_attributes_produce_no_conflict(self):
        attr = [{"name": "orderNo", "type": "string", "constraint": "唯一"}]
        conflicts = refs.detect_conflicts([
            entry("s1", "A", [{"name": "Order", "attributes": attr}]),
            entry("s2", "B", [{"name": "Order", "attributes": list(attr)}]),
        ])
        self.assertEqual(conflicts, [])

    def test_type_or_constraint_difference_is_reported(self):
        conflicts = refs.detect_conflicts([
            entry("s1", "A", [{"name": "Order", "attributes": [{"name": "amount", "type": "number"}]}]),
            entry("s2", "B", [{"name": "Order", "attributes": [{"name": "amount", "type": "string"}]}]),
        ])
        self.assertEqual(len(conflicts), 1)
        self.assertEqual(conflicts[0]["kind"], "concept_attribute_mismatch")
        self.assertEqual(conflicts[0]["name"], "Order")
        self.assertIn("amount：number ≠ string", conflicts[0]["differences"])

    def test_one_sided_attribute_is_reported(self):
        conflicts = refs.detect_conflicts([
            entry("s1", "A", [{"name": "Order", "attributes": [{"name": "orderNo", "type": "string"}]}]),
            entry("s2", "B", [{"name": "Order", "attributes": [{"name": "total", "type": "number"}]}]),
        ])
        self.assertIn("orderNo：仅在A中定义", conflicts[0]["differences"])
        self.assertIn("total：仅在B中定义", conflicts[0]["differences"])

    def test_cross_category_duplicate_is_reported(self):
        conflicts = refs.detect_conflicts([
            entry("s1", "A", [{"name": "Inventory", "attributes": []}],
                  functions=[{"name": "Inventory"}], behaviors=[]),
        ])
        self.assertEqual(len(conflicts), 1)
        self.assertEqual(conflicts[0]["kind"], "cross_category_duplicate")
        self.assertEqual(conflicts[0]["category"], ["concept", "function"])
        self.assertEqual(conflicts[0]["differences"], [])

    def test_three_way_conflict_lists_all_participants(self):
        conflicts = refs.detect_conflicts([
            entry("s1", "A", [{"name": "Order", "attributes": [{"name": "a", "type": "string"}]}]),
            entry("s2", "B", [{"name": "Order", "attributes": [{"name": "a", "type": "number"}]}]),
            entry("s3", "C", [{"name": "Order", "attributes": [{"name": "a", "type": "boolean"}]}]),
        ])
        self.assertEqual(len(conflicts[0]["participants"]), 3)
        self.assertTrue(any("≠" in line for line in conflicts[0]["differences"]))


class BuildSnapshotTest(unittest.TestCase):
    def setUp(self):
        self.data = {"订单场景": {"货品BOM": sample_ontology(), "空本体": OntologyData()}}
        self.patches = [
            mock.patch("services.load_ontology_data",
                       side_effect=lambda sc, on: self.data[sc][on]),
            mock.patch("services.thread_store.resolve_ids",
                       side_effect=lambda sc, on: ("1", "2") if sc in self.data and on in self.data[sc] else (None, None)),
        ]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()

    def test_builds_snapshot_with_consistent_token_estimate(self):
        result = refs.build_snapshot([{"scenario_name": "订单场景", "ontology_name": "货品BOM"}])
        self.assertTrue(result["allowed"])
        snapshot = result["snapshot"]
        self.assertEqual(snapshot["token_estimate"], refs.estimate_tokens(snapshot["prompt_text"]))
        self.assertEqual(snapshot["refs"][0]["ontology_id"], "2")
        self.assertEqual(snapshot["refs"][0]["scenario_id"], "1")
        self.assertEqual(snapshot["refs"][0]["counts"], {"concepts": 1, "functions": 1, "behaviors": 1})
        self.assertIn("prompt_text", snapshot)

    def test_duplicate_inputs_are_deduplicated(self):
        result = refs.build_snapshot([
            {"scenario_name": "订单场景", "ontology_name": "货品BOM"},
            {"scenario_name": "订单场景", "ontology_name": "货品BOM"},
        ])
        self.assertEqual(len(result["snapshot"]["refs"]), 1)

    def test_missing_ontology_raises_404(self):
        with self.assertRaises(NotFoundError):
            refs.build_snapshot([{"scenario_name": "订单场景", "ontology_name": "不存在"}])

    def test_empty_ontology_raises_400(self):
        with self.assertRaises(InvalidInputError):
            refs.build_snapshot([{"scenario_name": "订单场景", "ontology_name": "空本体"}])

    def test_malformed_input_raises_400(self):
        for bad in ("not-a-list", [{"scenario_name": "x"}], ["x"]):
            with self.assertRaises(InvalidInputError):
                refs.build_snapshot(bad)

    def test_empty_inputs_allowed(self):
        result = refs.build_snapshot([])
        self.assertTrue(result["allowed"])
        self.assertEqual(result["token_estimate"], 0)
        self.assertIsNone(result["snapshot"])  # 无引用时不生成快照

    def test_token_limit_blocks_with_actionable_reason(self):
        result = refs.build_snapshot([{"scenario_name": "订单场景", "ontology_name": "货品BOM"}], max_tokens=5)
        self.assertFalse(result["allowed"])
        self.assertIn("超过上限 5", result["reason"])
        self.assertIsNone(result["snapshot"])

    def test_count_limit_blocks(self):
        result = refs.build_snapshot(
            [{"scenario_name": "订单场景", "ontology_name": "货品BOM"},
             {"scenario_name": "订单场景", "ontology_name": "货品BOM"}],
            max_count=0,
        )
        self.assertFalse(result["allowed"])
        self.assertIn("一次最多引用 0 个本体", result["reason"])


if __name__ == "__main__":
    unittest.main()
