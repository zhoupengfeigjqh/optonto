"""概念关系（类级公理）契约测试。

覆盖：类型归一、SubClassOf 由概念设计派生、锚点合并/剪枝、概念级联、
对称关系去重、祖先-后代矛盾、关联概念属性选填校验。

stdlib unittest 零依赖：
    python -m unittest tests.test_concept_relations -v
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import services  # noqa: E402
from errors import InvalidInputError  # noqa: E402
from schemas import AttributeItem, ConceptItem, ConceptRelationItem, OntologyData  # noqa: E402
from services import concept_relations as cr  # noqa: E402
from services.validators import validate_concept_relation  # noqa: E402


def _data() -> OntologyData:
    return OntologyData(
        concepts=[
            ConceptItem(
                name="Document", title="单据",
                attributes=[AttributeItem(name="docNo", type="string")],
            ),
            ConceptItem(
                name="PurchaseOrder", title="采购单", sub_class_of="Document",
                attributes=[AttributeItem(name="poId", type="string")],
            ),
            ConceptItem(
                name="SalesOrder", title="销售单", sub_class_of="Document",
                attributes=[AttributeItem(name="soId", type="number")],
            ),
            ConceptItem(
                name="DraftOrder", title="草稿订单",
                attributes=[AttributeItem(name="docNo", type="string")],
            ),
        ]
    )


class TestConceptRelationType(unittest.TestCase):
    """类型归一：兼容大小写/蛇形，值域外归一为空串（业务层拦截）"""

    def test_规范值保留(self) -> None:
        for t in ("SubClassOf", "EquivalentClass", "DisjointWith"):
            self.assertEqual(ConceptRelationItem(name="r", relation_type=t).relation_type, t)

    def test_蛇形与大小写归一(self) -> None:
        cases = {
            "sub_class_of": "SubClassOf",
            "subclass": "SubClassOf",
            "equivalent_class": "EquivalentClass",
            "EQUIVALENTCLASS": "EquivalentClass",
            "disjoint_with": "DisjointWith",
        }
        for raw, expected in cases.items():
            self.assertEqual(ConceptRelationItem(name="r", relation_type=raw).relation_type, expected)

    def test_非法值归一空串(self) -> None:
        self.assertEqual(ConceptRelationItem(name="r", relation_type="关联").relation_type, "")
        self.assertEqual(ConceptRelationItem(name="r").relation_type, "")


class TestSubClassDerivation(unittest.TestCase):
    """SubClassOf 行由 concepts[].sub_class_of 派生（唯一权威）"""

    def test_按父子关系派生行(self) -> None:
        rows = cr.derived_sub_class_rows(_data())
        self.assertEqual([(r.source, r.target) for r in rows], [("PurchaseOrder", "Document"), ("SalesOrder", "Document")])
        first = rows[0]
        self.assertEqual(first.name, "PurchaseOrderSubClassOfDocument")
        self.assertEqual(first.title, "采购单 是一种 单据")
        self.assertEqual(first.relation_type, "SubClassOf")
        self.assertEqual(first.source_attr, "")
        self.assertIn("自动同步", first.description)

    def test_锚点合并关联概念属性(self) -> None:
        data = _data()
        data.concept_relations.append(ConceptRelationItem(
            name="PurchaseOrderSubClassOfDocument", relation_type="SubClassOf",
            source="PurchaseOrder", target="Document",
            source_attr="poId", target_attr="docNo",
        ))
        rows = cr.derived_sub_class_rows(data)
        self.assertEqual(rows[0].source_attr, "poId")
        self.assertEqual(rows[0].target_attr, "docNo")
        # 视图中不重复出现（派生行已带锚点）
        self.assertEqual(len(cr.hydrate(data)), 2)

    def test_父概念清空后锚点被剪枝(self) -> None:
        data = _data()
        data.concept_relations.append(ConceptRelationItem(
            name="PurchaseOrderSubClassOfDocument", relation_type="SubClassOf",
            source="PurchaseOrder", target="Document",
        ))
        data.concepts[1].sub_class_of = None
        self.assertEqual(cr.prune_stale_sub_class_links(data), 1)
        self.assertEqual(data.concept_relations, [])

    def test_写入与清空锚点(self) -> None:
        data = _data()
        cr.upsert_sub_class_link(data, "PurchaseOrder", "Document", "poId", "docNo")
        self.assertEqual(len(data.concept_relations), 1)
        cr.upsert_sub_class_link(data, "PurchaseOrder", "Document", "", "")
        # upsert 保留空锚点，由路由在两端为空时改调 remove
        self.assertEqual(data.concept_relations[0].source_attr, "")
        cr.remove_sub_class_link(data, "PurchaseOrder", "Document")
        self.assertEqual(data.concept_relations, [])


class TestHydrate(unittest.TestCase):
    """视图：派生在前、等价/互斥在后；悬空条目不下发"""

    def test_顺序与悬空过滤(self) -> None:
        data = _data()
        data.concept_relations.extend([
            ConceptRelationItem(
                name="DraftOrderDisjointWithPurchaseOrder", relation_type="DisjointWith",
                source="DraftOrder", target="PurchaseOrder",
            ),
            ConceptRelationItem(
                name="GhostEquivalentClassDraftOrder", relation_type="EquivalentClass",
                source="Ghost", target="DraftOrder",
            ),
        ])
        rows = cr.hydrate(data)
        self.assertEqual([r.relation_type for r in rows], ["SubClassOf", "SubClassOf", "DisjointWith"])


class TestCascades(unittest.TestCase):
    """概念删除/改名级联"""

    def test_改名同步引用与派生名(self) -> None:
        data = _data()
        data.concept_relations.append(ConceptRelationItem(
            name="PurchaseOrderSubClassOfDocument", relation_type="SubClassOf",
            source="PurchaseOrder", target="Document", source_attr="poId", target_attr="docNo",
        ))
        cr.rename_concept_references(data, "PurchaseOrder", "Order")
        self.assertEqual(data.concept_relations[0].name, "OrderSubClassOfDocument")
        self.assertEqual(data.concept_relations[0].source, "Order")

    def test_删概念清理引用(self) -> None:
        data = _data()
        data.concept_relations.append(ConceptRelationItem(
            name="DraftOrderDisjointWithPurchaseOrder", relation_type="DisjointWith",
            source="DraftOrder", target="PurchaseOrder",
        ))
        cr.remove_concept_references(data, "PurchaseOrder")
        self.assertEqual(data.concept_relations, [])


class TestValidateConceptRelation(unittest.TestCase):
    """跨字段强耦合校验：端点/自环/祖先矛盾/对称去重/关联属性"""

    def test_合法等价关系通过(self) -> None:
        validate_concept_relation(
            ConceptRelationItem(
                name="DraftOrderEquivalentClassPurchaseOrder", relation_type="EquivalentClass",
                source="DraftOrder", target="PurchaseOrder",
            ),
            _data(),
        )

    def test_类型为空拒绝(self) -> None:
        with self.assertRaises(InvalidInputError):
            validate_concept_relation(
                ConceptRelationItem(name="r", relation_type="bogus", source="DraftOrder", target="PurchaseOrder"),
                _data(),
            )

    def test_端点不存在拒绝(self) -> None:
        with self.assertRaises(InvalidInputError):
            validate_concept_relation(
                ConceptRelationItem(name="r", relation_type="DisjointWith", source="Ghost", target="DraftOrder"),
                _data(),
            )

    def test_自环拒绝(self) -> None:
        with self.assertRaises(InvalidInputError):
            validate_concept_relation(
                ConceptRelationItem(name="r", relation_type="DisjointWith", source="DraftOrder", target="DraftOrder"),
                _data(),
            )

    def test_祖先后代互斥拒绝(self) -> None:
        with self.assertRaises(InvalidInputError):
            validate_concept_relation(
                ConceptRelationItem(
                    name="r", relation_type="DisjointWith", source="Document", target="PurchaseOrder",
                ),
                _data(),
            )

    def test_祖先后代等价拒绝(self) -> None:
        with self.assertRaises(InvalidInputError):
            validate_concept_relation(
                ConceptRelationItem(
                    name="r", relation_type="EquivalentClass", source="Document", target="PurchaseOrder",
                ),
                _data(),
            )

    def test_反向重复拒绝(self) -> None:
        data = _data()
        data.concept_relations.append(ConceptRelationItem(
            name="DraftOrderDisjointWithPurchaseOrder", relation_type="DisjointWith",
            source="DraftOrder", target="PurchaseOrder",
        ))
        with self.assertRaises(InvalidInputError):
            validate_concept_relation(
                ConceptRelationItem(
                    name="PurchaseOrderDisjointWithDraftOrder", relation_type="DisjointWith",
                    source="PurchaseOrder", target="DraftOrder",
                ),
                data,
            )

    def test_关联属性单端填写拒绝(self) -> None:
        with self.assertRaises(InvalidInputError):
            validate_concept_relation(
                ConceptRelationItem(
                    name="r", relation_type="DisjointWith", source="DraftOrder", target="PurchaseOrder",
                    source_attr="poId",
                ),
                _data(),
            )

    def test_关联属性不存在拒绝(self) -> None:
        with self.assertRaises(InvalidInputError):
            validate_concept_relation(
                ConceptRelationItem(
                    name="r", relation_type="DisjointWith", source="DraftOrder", target="PurchaseOrder",
                    source_attr="ghost", target_attr="poId",
                ),
                _data(),
            )

    def test_关联属性类型不一致拒绝(self) -> None:
        with self.assertRaises(InvalidInputError):
            validate_concept_relation(
                ConceptRelationItem(
                    name="r", relation_type="DisjointWith", source="PurchaseOrder", target="SalesOrder",
                    source_attr="poId", target_attr="soId",
                ),
                _data(),
            )

    def test_关联属性类型一致通过(self) -> None:
        validate_concept_relation(
            ConceptRelationItem(
                name="r", relation_type="DisjointWith", source="PurchaseOrder", target="DraftOrder",
                source_attr="poId", target_attr="docNo",
            ),
            _data(),
        )


class TestSaveCompaction(unittest.TestCase):
    """落盘时概念关系条目的空串字段被剔除（避免与派生值重复）"""

    def test_去掉空串字段(self) -> None:
        doc = {"concept_relations": [{"name": "r", "source_attr": "", "description": "", "relation_type": "SubClassOf"}]}
        services._compact_concept_relations(doc)
        self.assertEqual(doc["concept_relations"][0], {"name": "r", "relation_type": "SubClassOf"})

    def test_SubClassOf的派生标题与描述即使非空也不落盘(self) -> None:
        # title/description 由概念设计读时派生，落盘值永不回读 → 一律不写（写而不读即死数据）
        doc = {"concept_relations": [{
            "name": "r", "relation_type": "SubClassOf",
            "title": "子概念 是一种 父概念", "description": "由概念设计自动同步",
        }]}
        services._compact_concept_relations(doc)
        self.assertEqual(doc["concept_relations"][0], {"name": "r", "relation_type": "SubClassOf"})

    def test_等价互斥的标题保留(self) -> None:
        doc = {"concept_relations": [{
            "name": "r", "relation_type": "EquivalentClass",
            "title": "采购订单与采购单等价", "description": "同一业务对象的不同叫法",
        }]}
        services._compact_concept_relations(doc)
        self.assertEqual(doc["concept_relations"][0]["title"], "采购订单与采购单等价")
        self.assertEqual(doc["concept_relations"][0]["description"], "同一业务对象的不同叫法")


if __name__ == "__main__":
    unittest.main()
