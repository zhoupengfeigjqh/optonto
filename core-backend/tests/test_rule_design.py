"""spec 007 规则设计（rules[].rule_design）的契约测试。

覆盖：模型值域归一与空设计不落盘、返回字段路径解析（本体函数扁平映射 / 公共函数 JSON Schema 包裹）、
保存期强校验（函数限关联函数、字段声明、运算符与取值个数、5 组 / 5 条上限、30 字文案）、落盘往返。

stdlib unittest 零依赖：
    python -m unittest tests.test_rule_design -v
"""

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import services  # noqa: E402
from errors import InvalidInputError  # noqa: E402
from schemas import FunctionItem, OntologyData, RuleItem  # noqa: E402
from services.rule_design import (  # noqa: E402
    field_paths, resolve_field, response_properties,
)
from services.validators import validate_rule_design  # noqa: E402

# 本体函数形态：response 直接是属性映射
UNIT_RESPONSE = {
    "pass": {"type": "boolean", "title": "判断结果"},
    "reason": {"type": "string", "title": "判断说明"},
    "amount": {"type": "number", "title": "金额"},
    "detail": {
        "type": "object",
        "title": "明细",
        "properties": {"qty": {"type": "number", "title": "数量"}},
    },
    "items": {
        "type": "array",
        "title": "条目",
        "items": {
            "type": "object",
            "properties": {"qty": {"type": "number", "title": "数量"}},
        },
    },
}

# 公共函数形态：JSON Schema 包裹
COMMON_RESPONSE = {
    "type": "object",
    "properties": {"date": {"type": "string", "title": "当前日期"}},
}


def _data() -> OntologyData:
    return OntologyData(functions=[FunctionItem(name="checkUnit", response=UNIT_RESPONSE, type="VALIDATION")])


def _rule(rule_design=None, related_functions=None) -> RuleItem:
    return RuleItem(
        name="V01",
        behavior="CreatePurchaseRecord",
        related_functions=["checkUnit"] if related_functions is None else related_functions,
        rule_design=rule_design,
    )


def _cond(**over) -> dict:
    base = {"function": "checkUnit", "field": "pass", "operator": "eq", "values": ["true"]}
    base.update(over)
    return base


def _design(groups=None, combine="and", pass_message="允许创建", fail_message="拒绝创建") -> dict:
    return {
        "combine": combine,
        "groups": groups if groups is not None else [{"combine": "and", "conditions": [_cond()]}],
        "pass_message": pass_message,
        "fail_message": fail_message,
    }


def _validate(rule: RuleItem, data: OntologyData | None = None) -> None:
    """隔离公共函数清单（不依赖 .data/common_functions 的真实内容）。"""
    with patch("services.validators.read_common_functions", return_value=[]):
        validate_rule_design(rule, data or _data())


class TestModel(unittest.TestCase):
    """模型层：值域归一 + 空设计不落盘（Pydantic 静默，不抛错）"""

    def test_完整设计往返(self) -> None:
        r = _rule(_design())
        dumped = r.model_dump(exclude_none=True)["rule_design"]
        self.assertEqual(dumped["combine"], "and")
        cond = dumped["groups"][0]["conditions"][0]
        self.assertEqual(cond, {
            "function": "checkUnit", "field": "pass", "operator": "eq", "values": ["true"],
        })

    def test_空设计归一为None且不落盘(self) -> None:
        r = _rule({})
        self.assertIsNone(r.rule_design)
        self.assertNotIn("rule_design", r.model_dump(exclude_none=True))

    def test_仅空组不落盘(self) -> None:
        r = _rule(_design(groups=[{"combine": "and", "conditions": []}], pass_message="", fail_message=""))
        self.assertIsNone(r.rule_design)

    def test_有文案无组时保留_由业务层拦截(self) -> None:
        r = _rule(_design(groups=[], pass_message="允许", fail_message="拒绝"))
        self.assertIsNotNone(r.rule_design)
        with self.assertRaises(InvalidInputError):
            _validate(r)

    def test_有内容时剔除空组(self) -> None:
        r = _rule(_design(groups=[
            {"combine": "and", "conditions": []},
            {"combine": "or", "conditions": [_cond()]},
        ]))
        self.assertEqual(len(r.rule_design.groups), 1)
        self.assertEqual(r.rule_design.groups[0].combine, "or")

    def test_组合方式非法归一为空串(self) -> None:
        r = _rule(_design(combine="XOR"))
        self.assertEqual(r.rule_design.combine, "")
        with self.assertRaises(InvalidInputError):
            _validate(r)

    def test_组合方式大小写归一(self) -> None:
        self.assertEqual(_rule(_design(combine="OR")).rule_design.combine, "or")

    def test_运算符非法归一为空串(self) -> None:
        r = _rule(_design(groups=[{"combine": "and", "conditions": [_cond(operator="~=")]}]))
        self.assertEqual(r.rule_design.groups[0].conditions[0].operator, "")

    def test_values标量归一为字符串数组(self) -> None:
        r = _rule(_design(groups=[{"combine": "and", "conditions": [_cond(values="true")]}]))
        self.assertEqual(r.rule_design.groups[0].conditions[0].values, ["true"])
        r2 = _rule(_design(groups=[{"combine": "and", "conditions": [_cond(values=[3, None])]}]))
        self.assertEqual(r2.rule_design.groups[0].conditions[0].values, ["3"])

    def test_字符串形态设计视为无设计(self) -> None:
        self.assertIsNone(RuleItem(name="R", rule_design="旧条件树文本").rule_design)


class TestFieldPaths(unittest.TestCase):
    """返回字段路径：两种 response 形态同解，支持嵌套与数组层"""

    def test_本体函数扁平映射(self) -> None:
        self.assertIn("pass", field_paths(UNIT_RESPONSE))
        self.assertIn("reason", field_paths(UNIT_RESPONSE))

    def test_公共函数schema包裹(self) -> None:
        self.assertEqual(response_properties(COMMON_RESPONSE), COMMON_RESPONSE["properties"])
        self.assertEqual(field_paths(COMMON_RESPONSE), ["date"])

    def test_嵌套对象与数组层路径(self) -> None:
        paths = field_paths(UNIT_RESPONSE)
        self.assertIn("detail", paths)
        self.assertIn("detail.qty", paths)
        self.assertIn("items", paths)
        self.assertIn("items[].qty", paths)

    def test_非字典返回结构降级为空(self) -> None:
        self.assertEqual(response_properties(None), {})
        self.assertEqual(field_paths("oops"), [])
        self.assertIsNone(resolve_field(UNIT_RESPONSE, ""))

    def test_解析嵌套与数组路径(self) -> None:
        self.assertEqual(resolve_field(UNIT_RESPONSE, "detail.qty")["type"], "number")
        self.assertEqual(resolve_field(UNIT_RESPONSE, "items[].qty")["type"], "number")
        self.assertIsNone(resolve_field(UNIT_RESPONSE, "items[].ghost"))
        self.assertIsNone(resolve_field(UNIT_RESPONSE, "detail.ghost"))
        self.assertIsNone(resolve_field(UNIT_RESPONSE, "detail[].qty"))


class TestValidation(unittest.TestCase):
    """保存期强校验：全部 400，不做执行级校验"""

    def test_合法设计通过(self) -> None:
        _validate(_rule(_design()))

    def test_未设计放行(self) -> None:
        _validate(_rule(None))

    def test_函数不在关联函数中(self) -> None:
        rule = _rule(_design(groups=[{"combine": "and", "conditions": [_cond(function="sumRaw")]}]),
                     related_functions=["checkUnit"])
        with self.assertRaises(InvalidInputError) as ctx:
            _validate(rule)
        self.assertIn("不在该规则的关联函数中", str(ctx.exception))

    def test_函数不存在(self) -> None:
        rule = _rule(_design(groups=[{"combine": "and", "conditions": [_cond(function="ghostFn")]}]),
                     related_functions=["ghostFn"])
        with self.assertRaises(InvalidInputError) as ctx:
            _validate(rule)
        self.assertIn("函数不存在", str(ctx.exception))

    def test_字段未声明(self) -> None:
        with self.assertRaises(InvalidInputError) as ctx:
            _validate(_rule(_design(groups=[{"combine": "and", "conditions": [_cond(field="ghost")]}])))
        self.assertIn("未声明返回字段", str(ctx.exception))

    def test_运算符不适配字段类型(self) -> None:
        # amount 是 number，contains 只适用 string/array
        with self.assertRaises(InvalidInputError) as ctx:
            _validate(_rule(_design(groups=[{"combine": "and", "conditions": [
                _cond(field="amount", operator="contains", values=["1"])]}])))
        self.assertIn("不支持运算符", str(ctx.exception))

    def test_缺省类型不限运算符(self) -> None:
        rule = _rule(_design(groups=[{"combine": "and", "conditions": [
            _cond(field="reason", operator="gt", values=["1"])]}]))
        data = OntologyData(functions=[FunctionItem(
            name="checkUnit", response={"reason": {"title": "说明"}}, type="VALIDATION")])
        _validate(rule, data)

    def test_取值个数精确(self) -> None:
        with self.assertRaises(InvalidInputError) as ctx:
            _validate(_rule(_design(groups=[{"combine": "and", "conditions": [
                _cond(values=["true", "false"])]}])))
        self.assertIn("需要 1 个取值", str(ctx.exception))

    def test_介于需要两个取值(self) -> None:
        with self.assertRaises(InvalidInputError):
            _validate(_rule(_design(groups=[{"combine": "and", "conditions": [
                _cond(field="amount", operator="between", values=["1"])]}])))
        _validate(_rule(_design(groups=[{"combine": "and", "conditions": [
            _cond(field="amount", operator="between", values=["1", "9"])]}])))

    def test_空值运算符不接受取值(self) -> None:
        with self.assertRaises(InvalidInputError) as ctx:
            _validate(_rule(_design(groups=[{"combine": "and", "conditions": [
                _cond(operator="empty", values=["x"])]}])))
        self.assertIn("不接受取值", str(ctx.exception))

    def test_属于至少一个取值(self) -> None:
        with self.assertRaises(InvalidInputError):
            _validate(_rule(_design(groups=[{"combine": "and", "conditions": [
                _cond(field="reason", operator="in", values=[])]}])))
        _validate(_rule(_design(groups=[{"combine": "and", "conditions": [
            _cond(field="reason", operator="in", values=["a", "b"])]}])))

    def test_空白取值合法(self) -> None:
        """string 默认值为空白字符（前端 defaultCondition 口径），后端不得拦。"""
        _validate(_rule(_design(groups=[{"combine": "and", "conditions": [
            _cond(field="reason", operator="eq", values=[""])]}])))

    def test_组数上限(self) -> None:
        groups = [{"combine": "and", "conditions": [_cond()]} for _ in range(6)]
        with self.assertRaises(InvalidInputError) as ctx:
            _validate(_rule(_design(groups=groups)))
        self.assertIn("最多 5 个条件组", str(ctx.exception))

    def test_每组条数上限(self) -> None:
        conditions = [_cond() for _ in range(6)]
        with self.assertRaises(InvalidInputError) as ctx:
            _validate(_rule(_design(groups=[{"combine": "and", "conditions": conditions}])))
        self.assertIn("最多 5 条条件", str(ctx.exception))

    def test_空条件组(self) -> None:
        rule = _rule(_design())
        rule.rule_design.groups.append(type(rule.rule_design.groups[0])(combine="and", conditions=[]))
        with self.assertRaises(InvalidInputError) as ctx:
            _validate(rule)
        self.assertIn("没有条件", str(ctx.exception))

    def test_组内组合方式非法(self) -> None:
        rule = _rule(_design())
        rule.rule_design.groups[0].combine = ""
        with self.assertRaises(InvalidInputError) as ctx:
            _validate(rule)
        self.assertIn("组内组合方式非法", str(ctx.exception))

    def test_结果说明超30字(self) -> None:
        with self.assertRaises(InvalidInputError) as ctx:
            _validate(_rule(_design(pass_message="允" * 31)))
        self.assertIn("不能超过 30 字", str(ctx.exception))

    def test_结果说明恰好30字(self) -> None:
        _validate(_rule(_design(pass_message="允" * 30, fail_message="拒" * 30)))

    def test_公共函数可作为关联函数(self) -> None:
        rule = _rule(
            _design(groups=[{"combine": "and", "conditions": [
                _cond(function="getCurrentDate", field="date", operator="not_empty", values=[])]}]),
            related_functions=["getCurrentDate"],
        )
        data = OntologyData()
        with patch("services.validators.read_common_functions",
                   return_value=[{"name": "getCurrentDate", "response": COMMON_RESPONSE}]):
            validate_rule_design(rule, data)


class TestPersist(unittest.TestCase):
    """落盘：有设计写结构，无设计不写键"""

    def _roundtrip(self, rule: RuleItem) -> dict:
        with tempfile.TemporaryDirectory() as tmp:
            orig = services.ONTO_MARKET_DIR
            services.ONTO_MARKET_DIR = Path(tmp)
            self.addCleanup(setattr, services, "ONTO_MARKET_DIR", orig)
            data = OntologyData(rules=[rule])
            services.save_ontology_data("SC", "ON", data)
            raw = (Path(tmp) / "SC" / "ON" / "ontology.yaml").read_text(encoding="utf-8")
            return yaml.safe_load(raw)

    def test_有设计时原样落盘(self) -> None:
        doc = self._roundtrip(_rule(_design(groups=[
            {"combine": "and", "conditions": [_cond()]},
            {"combine": "or", "conditions": [
                _cond(field="amount", operator="between", values=["1", "9"])]},
        ])))
        design = doc["rules"][0]["rule_design"]
        self.assertEqual(design["combine"], "and")
        self.assertEqual(len(design["groups"]), 2)
        self.assertEqual(design["groups"][1]["combine"], "or")
        self.assertEqual(design["groups"][1]["conditions"][0]["values"], ["1", "9"])
        self.assertEqual(design["pass_message"], "允许创建")

    def test_无设计不落键(self) -> None:
        doc = self._roundtrip(_rule(None))
        self.assertNotIn("rule_design", doc["rules"][0])


if __name__ == "__main__":
    unittest.main()
