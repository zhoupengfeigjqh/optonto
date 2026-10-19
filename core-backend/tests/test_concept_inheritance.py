"""spec 005 概念继承（subClassOf）与属性收窄的契约测试。

覆盖：
- 落盘字段规范化（sub_class_of / attribute_restrictions）；
- 单级 / 多级继承、同名继承优先、收窄合成（enum 交集 / min-max 收窄 / pattern 覆盖）；
- 写时校验：父概念存在性、自引用、环、枚举只删不增、范围不超父、模式任意；
- 级联：父删除清引用、父改名改引用、同名自有属性剔除、孤儿收窄剪枝；
- 有效属性口径：继承 status 参与行为状态校验、继承属性可作关系端点。

stdlib unittest 零依赖：
    python -m unittest tests.test_concept_inheritance -v
"""

import sys
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from errors import InvalidInputError  # noqa: E402
from schemas import (  # noqa: E402
    AttributeItem,
    AttributeRestriction,
    ConceptItem,
    ConceptView,
    OntologyData,
    RelationItem,
)
from services.inheritance import (  # noqa: E402
    clear_parent_references,
    effective_map,
    inherited_of,
    normalized_restrictions,
    prune_restrictions,
    rename_parent_references,
    strip_conflicting_attributes,
)
from services.validators import (  # noqa: E402
    status_enum_of,
    validate_relation,
    validate_restrictions,
    validate_sub_class_of,
)


def attr(name: str, type_: str = "string", **constraint) -> AttributeItem:
    return AttributeItem(name=name, type=type_, constraint=constraint or None)


def base_concepts() -> list[ConceptItem]:
    return [
        ConceptItem(
            name="单据",
            attributes=[
                attr("status", "string", enum=["草稿", "审批中", "已通过", "已驳回"]),
                attr("amount", "number", min=0, max=100000),
                attr("memo", "string", pattern="^[A-Z]{2}$"),
            ],
        ),
        ConceptItem(
            name="采购单",
            sub_class_of="单据",
            attributes=[attr("order_no", "string")],
            attribute_restrictions={
                "status": {"enum": ["草稿", "审批中"]},
                "amount": {"max": 10000},
            },
        ),
    ]


class TestModelNormalize(unittest.TestCase):
    """字段规范化（值域类静默归一，不阻断保存）"""

    def test_空缺省为None(self) -> None:
        self.assertIsNone(ConceptItem(name="C").sub_class_of)
        self.assertIsNone(ConceptItem(name="C", sub_class_of="  ").sub_class_of)

    def test_camelCase别名兼容(self) -> None:
        self.assertEqual(ConceptItem(name="C", subClassOf="Base").sub_class_of, "Base")

    def test_空收窄丢弃(self) -> None:
        c = ConceptItem(name="C", attribute_restrictions={"a": {}, "b": {"enum": ["x"]}})
        self.assertEqual(set(c.attribute_restrictions), {"b"})

    def test_收窄落盘形态(self) -> None:
        c = ConceptItem(name="C", attribute_restrictions={"amount": {"min": 1, "max": 2}})
        self.assertEqual(c.attribute_restrictions["amount"].min, 1)

    def test_读视图接受已规范化的收窄实例(self) -> None:
        view = ConceptView(
            name="C",
            sub_class_of="Base",
            attribute_restrictions={"status": AttributeRestriction(enum=["a"])},
        )
        self.assertEqual(view.attribute_restrictions["status"].enum, ["a"])

    def test_空枚举视为无收窄(self) -> None:
        c = ConceptItem(name="C", attribute_restrictions={"status": {"enum": []}})
        self.assertEqual(c.attribute_restrictions, {})


class TestEffective(unittest.TestCase):
    """有效属性合成"""

    def test_单级继承与收窄(self) -> None:
        concepts = base_concepts()
        eff = effective_map(concepts)["采购单"]
        by_name = {a.name: a for a in eff}

        self.assertEqual([a.name for a in eff], ["order_no", "status", "amount", "memo"])
        self.assertEqual(by_name["status"].attribute.constraint.enum, ["草稿", "审批中"])
        self.assertEqual(by_name["status"].inherited_from, "单据")
        self.assertTrue(by_name["status"].restricted)
        self.assertEqual(by_name["amount"].attribute.constraint.min, 0)
        self.assertEqual(by_name["amount"].attribute.constraint.max, 10000)
        self.assertEqual(by_name["order_no"].inherited_from, "采购单")

    def test_多级传递与逐层收窄(self) -> None:
        concepts = base_concepts()
        concepts.append(
            ConceptItem(
                name="紧急采购单",
                sub_class_of="采购单",
                attribute_restrictions={"amount": {"max": 2000}, "status": {"enum": ["审批中"]}},
            )
        )
        eff = {a.name: a for a in effective_map(concepts)["紧急采购单"]}
        self.assertEqual(eff["amount"].attribute.constraint.max, 2000)
        self.assertEqual(eff["status"].attribute.constraint.enum, ["审批中"])
        # 继承源头仍是实际声明该属性的概念
        self.assertEqual(eff["amount"].inherited_from, "单据")

    def test_父枚举收窄后子自动跟随(self) -> None:
        concepts = base_concepts()
        parent = concepts[0]
        parent.attributes[0].constraint.enum = ["草稿", "审批中"]
        eff = {a.name: a for a in effective_map(concepts)["采购单"]}
        self.assertEqual(eff["status"].attribute.constraint.enum, ["草稿", "审批中"])

    def test_同名继承优先(self) -> None:
        concepts = base_concepts()
        # 子概念遗留了与父同名的自有声明 → 按口径 3 继承优先
        concepts[1].attributes.append(attr("status", "number", min=1, max=9))
        eff = {a.name: a for a in effective_map(concepts)["采购单"]}
        self.assertEqual(eff["status"].attribute.type, "string")
        self.assertEqual(eff["status"].attribute.constraint.enum, ["草稿", "审批中"])

    def test_悬空父概念不抛错(self) -> None:
        concepts = [ConceptItem(name="孤儿", sub_class_of="不存在", attributes=[attr("x")])]
        self.assertEqual([a.name for a in effective_map(concepts)["孤儿"]], ["x"])

    def test_环截断不抛错(self) -> None:
        concepts = [
            ConceptItem(name="A", sub_class_of="B", attributes=[attr("a")]),
            ConceptItem(name="B", sub_class_of="A", attributes=[attr("b")]),
        ]
        eff = effective_map(concepts)
        # 环被截断：不会无限递归（合成顺序受遍历起点影响，只断言不崩且属性不丢）
        self.assertIn("a", {a.name for a in eff["A"]})
        self.assertIn("b", {a.name for a in eff["A"]})
        self.assertIn("b", {a.name for a in eff["B"]})

    def test_inherited_of只返回继承项(self) -> None:
        inherited = inherited_of(base_concepts())["采购单"]
        self.assertEqual({a.name for a in inherited}, {"status", "amount", "memo"})


class TestNormalizedRestrictions(unittest.TestCase):
    """读侧自愈：父概念后续收窄后，子概念存量收窄自动交集/钳制"""

    def test_父枚举收窄后子收窄自动交集(self) -> None:
        concepts = base_concepts()
        concepts[0].attributes[0].constraint.enum = ["草稿"]
        concepts[1].attribute_restrictions["status"] = {"enum": ["草稿", "审批中"]}
        # 交集后只剩父的 "草稿" → 与父等价，收窄退化为“完全继承”并被丢弃
        self.assertNotIn("status", normalized_restrictions(concepts)["采购单"])
        eff = {a.name: a for a in effective_map(concepts)["采购单"]}
        self.assertEqual(eff["status"].attribute.constraint.enum, ["草稿"])

    def test_越界范围钳制后等价于完全继承(self) -> None:
        concepts = base_concepts()
        concepts[1].attribute_restrictions = {"amount": {"max": 999999}}
        # 钳到父上界 100000 = 父定义，收窄无意义 → 丢弃
        self.assertNotIn("amount", normalized_restrictions(concepts)["采购单"])

    def test_完全失效的收窄被丢弃(self) -> None:
        concepts = base_concepts()
        concepts[1].attribute_restrictions = {"status": {"enum": ["已通过"]}}
        concepts[0].attributes[0].constraint.enum = ["草稿", "审批中"]
        self.assertNotIn("status", normalized_restrictions(concepts)["采购单"])

    def test_非继承属性收窄被丢弃(self) -> None:
        concepts = base_concepts()
        concepts[1].attribute_restrictions["ghost"] = {"pattern": "x"}
        self.assertNotIn("ghost", normalized_restrictions(concepts)["采购单"])

    def test_显式清除父模式保留为空串(self) -> None:
        concepts = base_concepts()
        concepts[1].attribute_restrictions = {"memo": {"pattern": ""}}
        self.assertEqual(normalized_restrictions(concepts)["采购单"]["memo"].pattern, "")
        eff = {a.name: a for a in effective_map(concepts)["采购单"]}
        self.assertIsNone(eff["memo"].attribute.constraint)


class TestValidation(unittest.TestCase):
    """写时强校验（400 口径）"""

    def _data(self) -> OntologyData:
        return OntologyData(concepts=base_concepts())

    def test_父概念不存在(self) -> None:
        data = self._data()
        with self.assertRaises(InvalidInputError):
            validate_sub_class_of(ConceptItem(name="X", sub_class_of="不存在"), data)

    def test_自引用(self) -> None:
        data = self._data()
        with self.assertRaises(InvalidInputError):
            validate_sub_class_of(ConceptItem(name="单据", sub_class_of="单据"), data)

    def test_成环(self) -> None:
        data = self._data()
        # 单据 → 采购单 会形成 2 节点环
        with self.assertRaises(InvalidInputError):
            validate_sub_class_of(ConceptItem(name="单据", sub_class_of="采购单"), data)

    def test_收窄只能作用于继承属性(self) -> None:
        data = self._data()
        item = ConceptItem(name="采购单", sub_class_of="单据", attribute_restrictions={"order_no": {"enum": ["a"]}})
        with self.assertRaises(InvalidInputError):
            validate_restrictions(item, data)

    def test_枚举只能删不能增(self) -> None:
        data = self._data()
        item = ConceptItem(name="采购单", sub_class_of="单据", attribute_restrictions={"status": {"enum": ["草稿", "新增值"]}})
        with self.assertRaises(InvalidInputError):
            validate_restrictions(item, data)

    def test_枚举子集合规(self) -> None:
        data = self._data()
        item = ConceptItem(name="采购单", sub_class_of="单据", attribute_restrictions={"status": {"enum": ["草稿"]}})
        validate_restrictions(item, data)

    def test_范围不能超父(self) -> None:
        data = self._data()
        item = ConceptItem(name="采购单", sub_class_of="单据", attribute_restrictions={"amount": {"max": 200000}})
        with self.assertRaises(InvalidInputError):
            validate_restrictions(item, data)

    def test_范围收窄合规(self) -> None:
        data = self._data()
        item = ConceptItem(name="采购单", sub_class_of="单据", attribute_restrictions={"amount": {"min": 10, "max": 99}})
        validate_restrictions(item, data)

    def test_模式可任意调整(self) -> None:
        data = self._data()
        item = ConceptItem(name="采购单", sub_class_of="单据", attribute_restrictions={"memo": {"pattern": ".+"}})
        validate_restrictions(item, data)

    def test_模式必须是合法正则(self) -> None:
        data = self._data()
        item = ConceptItem(name="采购单", sub_class_of="单据", attribute_restrictions={"memo": {"pattern": "(["}})
        with self.assertRaises(InvalidInputError):
            validate_restrictions(item, data)

    def test_无父概念不能声明收窄(self) -> None:
        data = self._data()
        item = ConceptItem(name="采购单", attribute_restrictions={"status": {"enum": ["草稿"]}})
        with self.assertRaises(InvalidInputError):
            validate_restrictions(item, data)


class TestCascade(unittest.TestCase):
    """级联与自愈（路由层调用的纯函数）"""

    def test_父删除清子引用与收窄(self) -> None:
        concepts = base_concepts()
        affected = clear_parent_references(concepts, "单据")
        self.assertEqual(affected, ["采购单"])
        child = concepts[1]
        self.assertIsNone(child.sub_class_of)
        self.assertEqual(child.attribute_restrictions, {})

    def test_父改名级联子引用(self) -> None:
        concepts = base_concepts()
        affected = rename_parent_references(concepts, "单据", "业务单据")
        self.assertEqual(affected, ["采购单"])
        self.assertEqual(concepts[1].sub_class_of, "业务单据")

    def test_同名自有属性剔除(self) -> None:
        concepts = base_concepts()
        child = concepts[1]
        child.attributes.append(attr("status", "number"))
        removed = strip_conflicting_attributes(child, concepts)
        self.assertEqual(removed, ["status"])
        self.assertNotIn("status", [a.name for a in child.attributes])

    def test_孤儿收窄剪枝(self) -> None:
        concepts = base_concepts()
        child = concepts[1]
        child.attribute_restrictions["order_no"] = {"enum": ["x"]}
        dropped = prune_restrictions(child, concepts)
        self.assertEqual(dropped, ["order_no"])
        self.assertNotIn("order_no", child.attribute_restrictions)


class TestEffectiveConsumers(unittest.TestCase):
    """下游读侧必须看到继承属性"""

    def test_继承status参与行为状态校验(self) -> None:
        data = OntologyData(concepts=base_concepts())
        self.assertEqual(status_enum_of(data, "采购单"), ["草稿", "审批中"])

    def test_继承属性可作关系端点(self) -> None:
        data = OntologyData(concepts=base_concepts())
        validate_relation(
            RelationItem(name="r", source="采购单", target="单据",
                         source_attr="amount", target_attr="amount"),
            data,
        )

    def test_不存在属性仍拒绝(self) -> None:
        data = OntologyData(concepts=base_concepts())
        with self.assertRaises(InvalidInputError):
            validate_relation(
                RelationItem(name="r", source="采购单", target="单据",
                             source_attr="ghost", target_attr="amount"),
                data,
            )


class TestConceptViewApi(unittest.TestCase):
    """路由层读取/写入视图（直接调用 async handler，隔离 HTTP 层）"""

    def _patch(self):
        from routers import concepts as concepts_router

        data = OntologyData(concepts=base_concepts())

        async def fake_names(_ontology_id):
            return ("S", "O")

        return concepts_router, data, mock.patch.object(concepts_router, "get_ontology_names", fake_names)

    def test_列表返回继承视图且收窄已规范化(self) -> None:
        import asyncio

        router, data, names_patch = self._patch()
        with names_patch, mock.patch.object(router, "load_ontology_data", lambda *_: data):
            views = asyncio.run(router.list_concepts(1))
        child = next(v for v in views if v.name == "采购单")
        self.assertEqual([a.name for a in child.inherited_attributes], ["status", "amount", "memo"])
        self.assertEqual(child.inherited_attributes[0].inherited_from, "单据")
        self.assertEqual(child.attribute_restrictions["status"].enum, ["草稿", "审批中"])

    def test_属性接口接受对象载荷并校验收窄(self) -> None:
        import asyncio

        router, data, names_patch = self._patch()
        payload = {
            "attributes": [{"name": "order_no", "type": "string"}],
            "attribute_restrictions": {"status": {"enum": ["草稿"]}},
        }
        with names_patch, \
                mock.patch.object(router, "load_ontology_data", lambda *_: data), \
                mock.patch.object(router, "save_ontology_data", lambda *_: None):
            attrs = asyncio.run(router.update_attributes(1, "采购单", payload))
        self.assertEqual([a.name for a in attrs], ["order_no"])
        concept = next(c for c in data.concepts if c.name == "采购单")
        self.assertEqual(concept.attribute_restrictions["status"].enum, ["草稿"])

    def test_属性接口拒绝越界收窄(self) -> None:
        import asyncio

        router, data, names_patch = self._patch()
        payload = {"attributes": [], "attribute_restrictions": {"status": {"enum": ["草稿", "新增"]}}}
        with names_patch, mock.patch.object(router, "load_ontology_data", lambda *_: data):
            with self.assertRaises(InvalidInputError):
                asyncio.run(router.update_attributes(1, "采购单", payload))


if __name__ == "__main__":
    unittest.main()
