"""spec 003 本体模型扩展的契约测试。

覆盖：枚举值域静默归一、概念术语集、生命周期状态属性、行为状态跃迁、
两处「数组 → 标量」契约收缩的读时迁移、规则关联函数（判断函数）。

stdlib unittest 零依赖：
    python -m unittest tests.test_model_extension -v
"""

import sys
import tempfile
import unittest
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import services  # noqa: E402
from errors import InvalidInputError  # noqa: E402
from schemas import (  # noqa: E402
    AttributeItem, BehaviorItem, ConceptItem, FunctionItem, OntologyData, RelationItem, RuleItem,
)
from services.validators import (  # noqa: E402
    status_enum_of, validate_behavior_status, validate_status_attribute,
)


class TestRelationType(unittest.TestCase):
    """关系类型：5 值多选，值域外静默丢弃（不阻断保存）"""

    def test_多选保留(self) -> None:
        r = RelationItem(name="r", source="A", target="B", relation_type=["symmetric", "transitive"])
        self.assertEqual(r.relation_type, ["symmetric", "transitive"])

    def test_非法值丢弃且不报错(self) -> None:
        r = RelationItem(name="r", source="A", target="B", relation_type=["symmetric", "bogus", 123])
        self.assertEqual(r.relation_type, ["symmetric"])

    def test_去重保序(self) -> None:
        r = RelationItem(name="r", source="A", target="B", relation_type=["transitive", "transitive", "functional"])
        self.assertEqual(r.relation_type, ["transitive", "functional"])

    def test_字符串单值兼容(self) -> None:
        r = RelationItem(name="r", source="A", target="B", relation_type="functional")
        self.assertEqual(r.relation_type, ["functional"])

    def test_缺省为空列表(self) -> None:
        r = RelationItem(name="r", source="A", target="B")
        self.assertEqual(r.relation_type, [])

    def test_与基数并存(self) -> None:
        r = RelationItem(name="r", source="A", target="B", cardinality="N:1", relation_type=["functional"])
        self.assertEqual(r.cardinality, "N:1")
        self.assertEqual(r.relation_type, ["functional"])


class TestConceptTerms(unittest.TestCase):
    """概念术语集：去重、去空、去首尾空白"""

    def test_规范化(self) -> None:
        c = ConceptItem(name="C", terms=[" 采购单 ", "", "采购订单", "采购单", "PO"])
        self.assertEqual(c.terms, ["采购单", "采购订单", "PO"])

    def test_缺省为空列表(self) -> None:
        self.assertEqual(ConceptItem(name="C").terms, [])

    def test_字符串单值兼容(self) -> None:
        self.assertEqual(ConceptItem(name="C", terms="采购单").terms, ["采购单"])


class TestFunctionType(unittest.TestCase):
    """函数类型：英文码 5 值，值域外归一为空串"""

    def test_合法值保留(self) -> None:
        for t in ("TRANSFORMATION", "CALCULATION", "DERIVATION", "VALIDATION", "MODEL"):
            self.assertEqual(FunctionItem(name="f", type=t).type, t)

    def test_非法值归一空串(self) -> None:
        self.assertEqual(FunctionItem(name="f", type="格式转换").type, "")
        self.assertEqual(FunctionItem(name="f").type, "")


class TestScalarMigration(unittest.TestCase):
    """数组 → 标量契约收缩的读时迁移（存量数据实测恒为单元素）"""

    def test_行为关联概念数组迁移(self) -> None:
        b = BehaviorItem(**{"name": "B", "related_concepts": ["PurchaseRecord"]})
        self.assertEqual(b.concept, "PurchaseRecord")

    def test_行为关联概念多元素取首个(self) -> None:
        b = BehaviorItem(**{"name": "B", "related_concepts": ["A", "B"]})
        self.assertEqual(b.concept, "A")

    def test_行为关联概念空数组迁移为空串(self) -> None:
        self.assertEqual(BehaviorItem(**{"name": "B", "related_concepts": []}).concept, "")

    def test_行为新字段优先(self) -> None:
        b = BehaviorItem(**{"name": "B", "concept": "New", "related_concepts": ["Old"]})
        self.assertEqual(b.concept, "New")

    def test_规则绑定行为数组迁移(self) -> None:
        r = RuleItem(**{"name": "R", "related_behaviors": ["CancelPurchaseRecord"]})
        self.assertEqual(r.behavior, "CancelPurchaseRecord")
        self.assertEqual(r.related_functions, [])

    def test_规则关联函数保持数组(self) -> None:
        r = RuleItem(**{"name": "R", "behavior": "B", "related_functions": ["f1", "f2"]})
        self.assertEqual(r.related_functions, ["f1", "f2"])

    def test_存量yaml文件加载无损迁移(self) -> None:
        """真实旧格式 YAML（数组字段）经数据访问层加载后迁移为标量，且不影响其它字段。"""
        with tempfile.TemporaryDirectory() as tmp:
            onto_dir = Path(tmp) / "SC" / "ON"
            onto_dir.mkdir(parents=True)
            (onto_dir / "ontology.yaml").write_text(yaml.safe_dump({
                "behaviors": [{"name": "B1", "related_concepts": ["C1"], "op_type": "command"}],
                "rules": [{"name": "R1", "related_behaviors": ["B1"], "related_functions": ["f1"]}],
            }, allow_unicode=True), encoding="utf-8")
            orig = services.ONTO_MARKET_DIR
            services.ONTO_MARKET_DIR = Path(tmp)
            self.addCleanup(setattr, services, "ONTO_MARKET_DIR", orig)

            data = services._load_ontology_data_uncached("SC", "ON")
            self.assertEqual(data.behaviors[0].concept, "C1")
            self.assertEqual(data.rules[0].behavior, "B1")
            self.assertEqual(data.rules[0].related_functions, ["f1"])


class TestStatusAttribute(unittest.TestCase):
    """生命周期状态属性：至多一个、必须 string、枚举非空"""

    def _attr(self, name: str, type_: str, enum: list | None) -> AttributeItem:
        c = {"unique": False, "required": False, "enum": enum or []}
        return AttributeItem(name=name, type=type_, constraint=c)

    def test_合法(self) -> None:
        validate_status_attribute([self._attr("status", "string", ["待入库", "已入库"])])

    def test_无status属性放行(self) -> None:
        validate_status_attribute([self._attr("name", "string", None)])

    def test_多个status属性报错(self) -> None:
        with self.assertRaises(InvalidInputError):
            validate_status_attribute([
                self._attr("status", "string", ["A"]),
                self._attr("status", "string", ["B"]),
            ])

    def test_类型非string报错(self) -> None:
        with self.assertRaises(InvalidInputError):
            validate_status_attribute([self._attr("status", "number", [1, 2])])

    def test_枚举为空报错(self) -> None:
        with self.assertRaises(InvalidInputError):
            validate_status_attribute([self._attr("status", "string", [])])


class TestBehaviorStatus(unittest.TestCase):
    """行为状态跃迁：from/to 必须落在关联概念 status 枚举内；为空时跳过"""

    def _data(self) -> OntologyData:
        return OntologyData(concepts=[ConceptItem(name="PurchaseRecord", attributes=[
            AttributeItem(name="status", type="string",
                          constraint={"unique": False, "required": False, "enum": ["待入库", "已入库", "已取消"]}),
        ])])

    def test_合法跃迁(self) -> None:
        data = self._data()
        validate_behavior_status(
            BehaviorItem(name="Cancel", op_type="command", concept="PurchaseRecord",
                         from_status="待入库", to_status="已取消"), data)

    def test_未声明状态跳过校验(self) -> None:
        # 未声明 from/to → 跳过状态校验（存量行为兼容，spec FR-008）
        validate_behavior_status(BehaviorItem(name="Create", op_type="command", concept="PurchaseRecord"), self._data())

    def test_目标状态越界报错(self) -> None:
        with self.assertRaises(InvalidInputError):
            validate_behavior_status(
                BehaviorItem(name="Cancel", op_type="command", concept="PurchaseRecord",
                             from_status="待入库", to_status="不存在的状态"), self._data())

    def test_源状态越界报错(self) -> None:
        with self.assertRaises(InvalidInputError):
            validate_behavior_status(
                BehaviorItem(name="Cancel", op_type="command", concept="PurchaseRecord",
                             from_status="草稿", to_status="已取消"), self._data())

    def test_关联概念不存在报错(self) -> None:
        with self.assertRaises(InvalidInputError):
            validate_behavior_status(BehaviorItem(name="B", concept="NotExists"), self._data())

    def test_概念无status属性时报错(self) -> None:
        data = OntologyData(concepts=[ConceptItem(name="Plain")])
        with self.assertRaises(InvalidInputError):
            validate_behavior_status(
                BehaviorItem(name="B", op_type="command", concept="Plain",
                             from_status="A", to_status="B"), data)

    def test_声明状态但无关联概念报错(self) -> None:
        with self.assertRaises(InvalidInputError):
            validate_behavior_status(BehaviorItem(name="B", from_status="A"), self._data())

    def test_status枚举读取(self) -> None:
        self.assertEqual(status_enum_of(self._data(), "PurchaseRecord"), ["待入库", "已入库", "已取消"])
        self.assertEqual(status_enum_of(self._data(), "NotExists"), [])


class TestBackwardCompatibleSnapshot(unittest.TestCase):
    """历史版本快照（无任何新字段）必须仍可加载"""

    def test_无新字段的本体可加载(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            onto_dir = Path(tmp) / "SC" / "ON"
            onto_dir.mkdir(parents=True)
            (onto_dir / "ontology.yaml").write_text(yaml.safe_dump({
                "metadata": {"scenario_name": "SC", "ontology_name": "ON"},
                "concepts": [{"name": "C1", "attributes": [{"name": "a", "type": "string"}]}],
                "relations": [{"name": "r1", "source": "C1", "target": "C1", "cardinality": "1:N"}],
                "functions": [{"name": "f1", "response": {}}],
                "behaviors": [{"name": "B1", "related_concepts": ["C1"]}],
                # rules 一并覆盖「历史遗留键」：旧快照里残留的未知字段必须被静默忽略、不得导致加载失败
                "rules": [{"name": "R1", "related_behaviors": ["B1"], "legacy_unknown_key": {"if": {"logic": "and", "conditions": []}}}],
            }, allow_unicode=True), encoding="utf-8")
            orig = services.ONTO_MARKET_DIR
            services.ONTO_MARKET_DIR = Path(tmp)
            self.addCleanup(setattr, services, "ONTO_MARKET_DIR", orig)

            data = services._load_ontology_data_uncached("SC", "ON")
            self.assertEqual(data.concepts[0].terms, [])
            self.assertEqual(data.relations[0].relation_type, [])
            self.assertEqual(data.functions[0].type, "")
            self.assertEqual(data.behaviors[0].concept, "C1")
            self.assertEqual(data.behaviors[0].from_status, "")
            self.assertEqual(data.rules[0].behavior, "B1")


if __name__ == "__main__":
    unittest.main()
