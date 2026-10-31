"""spec 008 规则设计智能生成的契约测试。

覆盖：上下文组装（含全部关联函数）、修边（越界函数/悬空字段/运算符错配/取值校正/上限截断/文案截断）、
LLM 异常分支（无 Key、非 JSON、超时、系统异常、无有效条件）与「只读不落盘」。

    python -m unittest tests.test_rule_design_generate -v
"""

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from errors import InternalError, InvalidInputError  # noqa: E402
from schemas import FunctionItem, OntologyData, RuleItem  # noqa: E402
from services.rule_design_generate import (  # noqa: E402
    build_function_context,
    generate_rule_design,
    repair_generated_design,
)

UNIT_RESPONSE = {
    "pass": {"type": "boolean", "title": "判断结果"},
    "reason": {"type": "string", "title": "判断说明"},
}
QTY_RESPONSE = {
    "sumNotArrivalQty": {"type": "number", "title": "未到位总量"},
    "items": {
        "type": "array",
        "title": "明细",
        "items": {"type": "object", "properties": {"arrivalQuantity": {"type": "number"}}},
    },
}


def _data() -> OntologyData:
    return OntologyData(functions=[
        FunctionItem(name="checkUnit", title="校验采购原材料单位一致性", type="VALIDATION",
                     description="单位一致返回 pass", response=UNIT_RESPONSE, related_concepts=["rawMaterial"]),
        FunctionItem(name="sumQty", title="原材料未到位数", type="CALCULATION",
                     description="统计未到位数量", response=QTY_RESPONSE),
        FunctionItem(name="otherFn", title="无关函数", type="CALCULATION", response=UNIT_RESPONSE),
    ])


def _rule(related=None) -> RuleItem:
    return RuleItem(
        name="V01_UnitConsistency",
        title="采购-原料存在且单位一致",
        description="创建采购单时，原材料ID必须存在，且单位与原材料定义一致。",
        position="前置",
        behavior="CreatePurchaseRecord",
        related_functions=related if related is not None else ["checkUnit", "sumQty"],
    )


def _cond(**over):
    base = {"function": "checkUnit", "field": "pass", "operator": "eq", "values": ["true"]}
    base.update(over)
    return base


def _payload(**over):
    base = {
        "combine": "and",
        "groups": [{"combine": "and", "conditions": [_cond()]}],
        "pass_message": "原材料存在且单位一致",
        "fail_message": "原材料不存在或单位不一致",
    }
    base.update(over)
    return base


class TestFunctionContext(unittest.TestCase):
    """上下文必须包含全部关联函数，且只给可设计字段与可用运算符"""

    def test_包含全部关联函数且不含未关联函数(self) -> None:
        with patch("services.rule_design_generate.read_common_functions", return_value=[]):
            info, warnings = build_function_context(_rule(), _data())
        self.assertIn("checkUnit", info)
        self.assertIn("sumQty", info)
        self.assertNotIn("otherFn", info)
        self.assertEqual(warnings, [])

    def test_字段与运算符清单(self) -> None:
        with patch("services.rule_design_generate.read_common_functions", return_value=[]):
            info, _ = build_function_context(_rule(), _data())
        self.assertIn("pass | boolean", info)
        self.assertIn("items[].arrivalQuantity", info)
        # boolean 字段不应出现数值运算符
        boolean_line = next(line for line in info.splitlines() if "pass | boolean" in line)
        self.assertIn("eq", boolean_line)
        self.assertNotIn("gt", boolean_line)

    def test_未声明返回结构的函数给出提示(self) -> None:
        data = OntologyData(functions=[FunctionItem(name="checkUnit", type="VALIDATION", response={})])
        with patch("services.rule_design_generate.read_common_functions", return_value=[]):
            info, warnings = build_function_context(_rule(["checkUnit"]), data)
        self.assertIn("未声明返回结构", info)
        self.assertTrue(any("未声明返回结构" in w for w in warnings))

    def test_函数不存在给出提示(self) -> None:
        with patch("services.rule_design_generate.read_common_functions", return_value=[]):
            _, warnings = build_function_context(_rule(["ghost"]), _data())
        self.assertTrue(any("不存在" in w for w in warnings))


class TestRepair(unittest.TestCase):
    """修边：越界丢弃、错配替换、超限截断，绝不返回脏设计"""

    def _repair(self, raw, rule=None):
        with patch("services.rule_design_generate.read_common_functions", return_value=[]):
            return repair_generated_design(raw, rule or _rule(), _data())

    def test_合法输出原样保留(self) -> None:
        design, warnings, dropped = self._repair(_payload())
        self.assertIsNotNone(design)
        self.assertEqual(design.groups[0].conditions[0].field, "pass")
        self.assertEqual(design.pass_message, "原材料存在且单位一致")
        self.assertEqual(dropped, 0)
        self.assertEqual([w for w in warnings if "校正" in w], [])

    def test_函数越界被丢弃(self) -> None:
        design, warnings, dropped = self._repair(_payload(groups=[{
            "combine": "and",
            "conditions": [_cond(), _cond(function="otherFn")],
        }]))
        self.assertIsNotNone(design)
        self.assertEqual(len(design.groups[0].conditions), 1)
        self.assertEqual(dropped, 1)
        self.assertTrue(any("不在该规则的关联函数中" in w for w in warnings))

    def test_字段悬空被丢弃(self) -> None:
        design, warnings, dropped = self._repair(_payload(groups=[{
            "combine": "and",
            "conditions": [_cond(field="ghost")],
        }]))
        self.assertIsNone(design)
        self.assertEqual(dropped, 1)
        self.assertTrue(any("未声明返回字段" in w for w in warnings))

    def test_运算符错配被替换(self) -> None:
        design, warnings, _ = self._repair(_payload(groups=[{
            "combine": "and",
            "conditions": [_cond(field="reason", operator="gt", values=["1"])],
        }]))
        # string 字段不支持 gt，替换为该类型首个运算符 eq
        self.assertEqual(design.groups[0].conditions[0].operator, "eq")
        self.assertTrue(any("不支持运算符" in w for w in warnings))

    def test_取值个数被校正(self) -> None:
        design, warnings, _ = self._repair(_payload(groups=[{
            "combine": "and",
            "conditions": [_cond(values=["true", "false"])],
        }]))
        self.assertEqual(design.groups[0].conditions[0].values, ["true"])
        self.assertTrue(any("取值个数" in w for w in warnings))

    def test_数组字段与嵌套路径可用(self) -> None:
        design, _, _ = self._repair(_payload(groups=[{
            "combine": "or",
            "conditions": [_cond(function="sumQty", field="items[].arrivalQuantity",
                                 operator="gte", values=["10"])],
        }]))
        self.assertEqual(design.groups[0].conditions[0].field, "items[].arrivalQuantity")
        self.assertEqual(design.groups[0].combine, "or")

    def test_组数与每组条数上限(self) -> None:
        conditions = [_cond() for _ in range(8)]
        raw = _payload(groups=[{"combine": "and", "conditions": conditions} for _ in range(7)])
        design, warnings, _ = self._repair(raw)
        self.assertEqual(len(design.groups), 5)
        self.assertEqual(len(design.groups[0].conditions), 5)
        self.assertTrue(any("条件组超过" in w for w in warnings))
        self.assertTrue(any("超过 5 条" in w for w in warnings))

    def test_组内条件全丢则丢组(self) -> None:
        raw = _payload(groups=[
            {"combine": "and", "conditions": [_cond(function="otherFn")]},
            {"combine": "or", "conditions": [_cond()]},
        ])
        design, _, dropped = self._repair(raw)
        self.assertEqual(len(design.groups), 1)
        self.assertEqual(design.groups[0].combine, "or")
        self.assertEqual(dropped, 1)

    def test_全部无效返回_None(self) -> None:
        raw = _payload(groups=[{"combine": "and", "conditions": [_cond(function="otherFn")]}])
        design, _, dropped = self._repair(raw)
        self.assertIsNone(design)
        self.assertEqual(dropped, 1)

    def test_组合方式非法归一(self) -> None:
        raw = _payload(combine="XOR", groups=[{"combine": "nor", "conditions": [_cond()]}])
        design, warnings, _ = self._repair(raw)
        self.assertEqual(design.combine, "and")
        self.assertEqual(design.groups[0].combine, "and")
        self.assertTrue(any("组间组合方式非法" in w for w in warnings))
        self.assertTrue(any("组内组合方式非法" in w for w in warnings))

    def test_文案截断到30字(self) -> None:
        raw = _payload(pass_message="允" * 42)
        design, warnings, _ = self._repair(raw)
        self.assertEqual(len(design.pass_message), 30)
        self.assertTrue(any("已截断" in w for w in warnings))

    def test_文案缺失不臆造(self) -> None:
        raw = _payload(pass_message="", fail_message="")
        design, warnings, _ = self._repair(raw)
        self.assertEqual(design.pass_message, "")
        self.assertTrue(any("结果说明缺失" in w for w in warnings))

    def test_非对象与缺组(self) -> None:
        design, warnings, _ = self._repair(["not", "a", "dict"])
        self.assertIsNone(design)
        self.assertTrue(warnings)
        design2, warnings2, _ = self._repair({"combine": "and"})
        self.assertIsNone(design2)
        self.assertTrue(any("缺少条件组" in w for w in warnings2))


class TestGenerate(unittest.IsolatedAsyncioTestCase):
    """LLM 分支：正常/非 JSON/无 Key/超时/系统异常/无有效条件；且只读不落盘"""

    async def _run(self, llm, rule=None):
        with patch("services.rule_design_generate.read_common_functions", return_value=[]), \
                patch("services.rule_design_generate.llm_json", llm):
            return await generate_rule_design(rule or _rule(), _data())

    async def test_正常生成(self) -> None:
        captured = {}

        async def fake_llm(system, prompt, temperature=0.3):
            captured["prompt"] = prompt
            return _payload(), "text"

        result = await self._run(fake_llm)
        self.assertIn("rule_design", result)
        self.assertEqual(result["dropped_conditions"], 0)
        self.assertGreaterEqual(result["elapsed_ms"], 0)
        # 上下文必须带上全部关联函数
        self.assertIn("checkUnit", captured["prompt"])
        self.assertIn("sumQty", captured["prompt"])
        self.assertNotIn("otherFn", captured["prompt"])

    async def test_生成结果无需二次校验_字段来自清单(self) -> None:
        async def fake_llm(system, prompt, temperature=0.3):
            return _payload(groups=[{
                "combine": "and",
                "conditions": [_cond(function="sumQty", field="sumNotArrivalQty",
                                     operator="lt", values=["100"])],
            }]), "text"

        result = await self._run(fake_llm)
        condition = result["rule_design"].groups[0].conditions[0]
        self.assertEqual((condition.function, condition.field, condition.operator), ("sumQty", "sumNotArrivalQty", "lt"))

    async def test_非JSON返回400(self) -> None:
        async def fake_llm(system, prompt, temperature=0.3):
            return None, "这不是 JSON"

        with self.assertRaises(InvalidInputError) as ctx:
            await self._run(fake_llm)
        self.assertIn("格式异常", str(ctx.exception))

    async def test_未配置Key返回500(self) -> None:
        async def fake_llm(system, prompt, temperature=0.3):
            return None, None

        with self.assertRaises(InternalError) as ctx:
            await self._run(fake_llm)
        self.assertIn("LLM API Key", str(ctx.exception))

    async def test_超时(self) -> None:
        import asyncio

        async def fake_llm(system, prompt, temperature=0.3):
            raise asyncio.TimeoutError()

        with self.assertRaises(InvalidInputError) as ctx:
            await self._run(fake_llm)
        self.assertIn("超时", str(ctx.exception))

    async def test_系统异常包装为500(self) -> None:
        async def fake_llm(system, prompt, temperature=0.3):
            raise RuntimeError("network down")

        with self.assertRaises(InternalError) as ctx:
            await self._run(fake_llm)
        self.assertIn("生成失败", str(ctx.exception))

    async def test_无有效条件返回400(self) -> None:
        async def fake_llm(system, prompt, temperature=0.3):
            return _payload(groups=[{"combine": "and", "conditions": [_cond(function="otherFn")]}]), "text"

        with self.assertRaises(InvalidInputError) as ctx:
            await self._run(fake_llm)
        self.assertIn("未能生成可用条件", str(ctx.exception))

    async def test_只读不落盘(self) -> None:
        """把数据目录指到空临时目录：生成结束后目录仍为空 = 零副作用。"""
        import services as services_pkg
        import tempfile

        async def fake_llm(system, prompt, temperature=0.3):
            return _payload(), "text"

        with tempfile.TemporaryDirectory() as tmp:
            original = services_pkg.ONTO_MARKET_DIR
            services_pkg.ONTO_MARKET_DIR = Path(tmp)
            try:
                with patch("services.rule_design_generate.read_common_functions", return_value=[]), \
                        patch("services.rule_design_generate.llm_json", fake_llm):
                    await generate_rule_design(_rule(), _data())
                self.assertEqual(list(Path(tmp).iterdir()), [])
            finally:
                services_pkg.ONTO_MARKET_DIR = original


if __name__ == "__main__":
    unittest.main()
