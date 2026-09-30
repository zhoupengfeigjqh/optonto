"""智能映射落盘前清洗测试（services/mapping_sanitize.py）。

覆盖：清单内的正常条目保留、键/值不在清单中的条目剔除并回报、
空串值（本体属性在目标无来源）恒保留、两条保守兜底（清单缺失不校验 / 全不匹配不清空）。

运行：cd core-backend && python -m pytest tests/test_mapping_sanitize.py -q
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services.mapping_sanitize import sanitize_mapping  # noqa: E402

ONTO = ["data", "data[*].unit", "data[*].lines", "data[*].lines[*].prod"]
TARGET = ["result", "result[*].unit", "result[*].items", "result[*].items[*].prod_name"]


class SanitizeMappingTest(unittest.TestCase):
    def test_清单内的条目全部保留且无问题(self):
        mapping = {"data": "result", "data[*].lines[*].prod": "result[*].items[*].prod_name"}
        kept, issues = sanitize_mapping(mapping, ONTO, TARGET)
        self.assertEqual(kept, mapping)
        self.assertEqual(issues, [])

    def test_本体侧键不存在时剔除并回报(self):
        kept, issues = sanitize_mapping({"data": "result", "data.leadTimeX": "result[*].unit"}, ONTO, TARGET)
        self.assertEqual(kept, {"data": "result"})
        self.assertEqual(len(issues), 1)
        self.assertIn("data.leadTimeX", issues[0])

    def test_目标侧值不存在时剔除并回报(self):
        kept, issues = sanitize_mapping({"data": "result", "data[*].unit": "result[*].unitX"}, ONTO, TARGET)
        self.assertEqual(kept, {"data": "result"})
        self.assertIn("result[*].unitX", issues[0])

    def test_部分剔除时只回报被剔除项(self):
        kept, issues = sanitize_mapping(
            {"data": "result", "data[*].unit": "result[*].unit", "x.y": "result[*].unit"}, ONTO, TARGET)
        self.assertEqual(kept, {"data": "result", "data[*].unit": "result[*].unit"})
        self.assertEqual(len(issues), 1)
        self.assertIn("已剔除 1 条", issues[0])

    def test_空串值不参与目标侧校验(self):
        # 本体属性在目标无来源：显式空串声明必须保留
        kept, issues = sanitize_mapping({"data[*].unit": ""}, ONTO, TARGET)
        self.assertEqual(kept, {"data[*].unit": ""})
        self.assertEqual(issues, [])

    def test_清单缺失时不校验(self):
        mapping = {"随便": "什么"}
        self.assertEqual(sanitize_mapping(mapping, [], TARGET), (mapping, []))
        self.assertEqual(sanitize_mapping(mapping, ONTO, []), (mapping, []))
        self.assertEqual(sanitize_mapping(mapping, None, None), (mapping, []))

    def test_全不匹配时不清空只回报(self):
        # 保守兜底：宁可留下可疑映射并告警，也不静默清空用户配置
        mapping = {"a": "b", "c": "d"}
        kept, issues = sanitize_mapping(mapping, ONTO, TARGET)
        self.assertEqual(kept, mapping)
        self.assertEqual(len(issues), 1)
        self.assertIn("完全不符", issues[0])

    def test_空映射原样返回(self):
        self.assertEqual(sanitize_mapping({}, ONTO, TARGET), ({}, []))
        self.assertEqual(sanitize_mapping(None, ONTO, TARGET), ({}, []))


if __name__ == "__main__":
    unittest.main()
