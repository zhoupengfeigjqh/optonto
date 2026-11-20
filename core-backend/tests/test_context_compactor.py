"""需求对话上下文压缩（滚动摘要）的契约测试。

覆盖：token 估算与截断、轮次切分（空 assistant / 报错占位）、双触发规则（>70 轮 / ≥200K）、
保留窗口与触底保护、视图组装与单条截断、保真校验、digest 合并（已否决只增不减）、
压缩成功/失败/重试三条路径，以及清空对话时摘要与要素清单连带清理。

stdlib unittest 零依赖：
    python -m unittest tests.test_context_compactor -v
"""

import asyncio
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from repositories import fs_store  # noqa: E402
from services import context_compactor as cc  # noqa: E402
from services import thread_store  # noqa: E402


def make_thread(rounds: int, content: str = "测试消息") -> dict:
    """构造 rounds 轮对话（user/assistant 成对）。"""
    messages = []
    for _ in range(rounds):
        messages.append({"role": "user", "content": content, "timestamp": ""})
        messages.append({"role": "assistant", "content": content, "timestamp": ""})
    return {
        "id": "t-compact",
        "title": "测试对话",
        "scenario_name": "场景",
        "ontology_name": "本体",
        "messages": messages,
        "updated_at": "",
    }


class EstimateTokensTest(unittest.TestCase):
    def test_empty(self):
        self.assertEqual(cc.estimate_tokens(""), 0)
        self.assertEqual(cc.estimate_tokens(None), 0)

    def test_chinese_one_char_one_token(self):
        self.assertEqual(cc.estimate_tokens("订单创建"), 4)

    def test_ascii_four_chars_one_token(self):
        self.assertEqual(cc.estimate_tokens("abcdefgh"), 2)

    def test_truncate_keeps_prefix_and_budget(self):
        text = "订单" * 100
        cut = cc.truncate_to_tokens(text, 50)
        self.assertLessEqual(cc.estimate_tokens(cut), 50)
        self.assertTrue(text.startswith(cut))

    def test_truncate_noop_when_within_budget(self):
        self.assertEqual(cc.truncate_to_tokens("短句", 100), "短句")


class RoundSplitTest(unittest.TestCase):
    def test_basic_pairs(self):
        thread = make_thread(3)
        self.assertEqual(cc.round_count(thread["messages"]), 3)

    def test_empty_assistant_and_error_placeholder(self):
        messages = [
            {"role": "user", "content": "第一问"},
            {"role": "assistant", "content": "  "},
            {"role": "user", "content": "第二问"},
            {"role": "assistant", "content": "\n\n[调用出错: timeout]"},
            {"role": "user", "content": "第三问"},
            {"role": "assistant", "content": "第三答"},
        ]
        self.assertEqual(cc.round_count(messages), 3)
        self.assertTrue(cc.is_error_message(messages[3]))
        self.assertFalse(cc.is_usable_message(messages[1]))

    def test_start_offset(self):
        messages = make_thread(4)["messages"]
        self.assertEqual(cc.round_count(messages, 4), 2)


class PlanCompactionTest(unittest.TestCase):
    def test_no_trigger_when_short(self):
        self.assertIsNone(cc.plan_compaction(make_thread(30)))

    def test_no_trigger_at_exact_70_rounds(self):
        # 规则是「超过 70 轮」，70 轮本身不触发
        self.assertIsNone(cc.plan_compaction(make_thread(70)))

    def test_round_trigger_keeps_last_40(self):
        plan = cc.plan_compaction(make_thread(71))
        self.assertIsNotNone(plan)
        self.assertEqual(plan["reason"], "rounds")
        self.assertEqual(plan["keep_rounds"], 40)
        self.assertEqual(plan["compress_rounds"], 31)
        self.assertEqual(plan["covered_from"], 0)

    def test_round_trigger_boundary_is_round_start(self):
        thread = make_thread(71)
        plan = cc.plan_compaction(thread)
        # covered_to 必须落在某一轮的 user 消息上（轮首），否则会切碎一轮
        self.assertEqual(thread["messages"][plan["covered_to"]]["role"], "user")

    def test_token_trigger_computes_by_tokens(self):
        # 每轮 ~10k tokens：45 轮即远超 200K，但轮数不足 70
        thread = make_thread(45, content="订" * 5000)
        plan = cc.plan_compaction(thread)
        self.assertIsNotNone(plan)
        self.assertEqual(plan["reason"], "tokens")
        self.assertLess(plan["keep_rounds"], 40)
        self.assertGreaterEqual(plan["keep_rounds"], cc.CONTEXT_MIN_KEEP_ROUNDS)
        self.assertLess(plan["tokens_after"], plan["tokens_before"])

    def test_token_trigger_respects_min_keep_rounds(self):
        thread = make_thread(30, content="订" * 7000)
        plan = cc.plan_compaction(thread)
        self.assertIsNotNone(plan)
        self.assertEqual(plan["keep_rounds"], cc.CONTEXT_MIN_KEEP_ROUNDS)

    def test_no_plan_when_too_few_rounds(self):
        thread = make_thread(5, content="订" * 20000)
        self.assertIsNone(cc.plan_compaction(thread))

    def test_respects_covered_until(self):
        # 已归档 20 条消息（10 轮），剩余 81 轮 > 70 → 仍触发，且归档起点从 20 开始
        thread = make_thread(91)
        thread["context"] = {"covered_until": 20, "summary": "旧摘要"}
        plan = cc.plan_compaction(thread)
        self.assertIsNotNone(plan)
        self.assertEqual(plan["covered_from"], 20)

    def test_no_trigger_when_remaining_rounds_below_threshold(self):
        # 71 轮但已归档 10 轮 → 剩余 61 轮，未达 70 轮且 token 未超
        thread = make_thread(71)
        thread["context"] = {"covered_until": 20, "summary": "旧摘要"}
        self.assertIsNone(cc.plan_compaction(thread))


class BuildViewTest(unittest.TestCase):
    def test_filters_empty_and_error(self):
        thread = make_thread(2)
        thread["messages"].insert(1, {"role": "assistant", "content": ""})
        thread["messages"].append({"role": "assistant", "content": "[调用出错: x]"})
        view, summary = cc.build_view(thread)
        self.assertEqual(summary, "")
        self.assertTrue(all(str(m["content"]).strip() for m in view))
        self.assertFalse(any(str(m["content"]).startswith("[调用出错") for m in view))

    def test_starts_from_covered_until(self):
        thread = make_thread(3)
        thread["context"] = {"covered_until": 4, "summary": "【概念】订单"}
        view, summary = cc.build_view(thread)
        self.assertEqual(len(view), 2)
        self.assertEqual(summary, "【概念】订单")

    def test_single_oversized_message_truncated(self):
        thread = make_thread(1, content="订" * (cc.CONTEXT_SINGLE_MSG_MAX_TOKENS + 5000))
        view, _ = cc.build_view(thread)
        self.assertLess(len(view[0]["content"]), len(thread["messages"][0]["content"]))
        self.assertTrue(view[0]["content"].endswith("完整内容见对话记录）"))


class BusinessInfoTest(unittest.TestCase):
    def test_first_user_message(self):
        thread = make_thread(2)
        thread["messages"][0]["content"] = "我们是做供应链的"
        self.assertEqual(cc.first_business_info(thread["messages"]), "我们是做供应链的")

    def test_empty_when_no_user(self):
        self.assertEqual(cc.first_business_info([{"role": "assistant", "content": "x"}]), "")


class VerifySummaryTest(unittest.TestCase):
    def test_pass_when_all_kept(self):
        source = "用户：账期必须 30 天，单据名「采购订单」"
        summary = "账期必须 30 天，涉及「采购订单」"
        self.assertEqual(cc.verify_summary(summary, source), [])

    def test_catch_missing_number(self):
        self.assertIn("30", cc.verify_summary("账期若干天", "账期 30 天"))

    def test_catch_missing_quoted_term(self):
        self.assertIn("采购订单", cc.verify_summary("涉及单据", "单据名「采购订单」"))

    def test_catch_weakened_constraint(self):
        self.assertIn("必须", cc.verify_summary("账期 30 天", "账期必须 30 天"))


class MergeDigestTest(unittest.TestCase):
    def test_by_name_update_keeps_order(self):
        old = {"concepts": [{"name": "订单", "note": "旧"}]}
        new = {"concepts": [{"name": "订单", "note": "新"}, {"name": "订单行"}]}
        merged = cc.merge_digest(old, new)
        self.assertEqual([c["name"] for c in merged["concepts"]], ["订单", "订单行"])
        self.assertEqual(merged["concepts"][0]["note"], "新")

    def test_rejected_never_removed(self):
        old = {"rejected": [{"name": "方案A", "note": "成本高"}]}
        merged = cc.merge_digest(old, {"rejected": []})
        self.assertEqual(len(merged["rejected"]), 1)

    def test_rejected_dedup_and_append(self):
        old = {"rejected": [{"name": "方案A", "note": "成本高"}]}
        merged = cc.merge_digest(old, {"rejected": [{"name": "方案A", "note": "x"}, {"name": "方案B"}]})
        self.assertEqual([r["name"] for r in merged["rejected"]], ["方案A", "方案B"])

    def test_open_questions_replaced_when_new_present(self):
        old = {"open_questions": [{"name": "旧问题"}]}
        merged = cc.merge_digest(old, {"open_questions": [{"name": "新问题"}]})
        self.assertEqual([q["name"] for q in merged["open_questions"]], ["新问题"])
        kept = cc.merge_digest(old, {})
        self.assertEqual([q["name"] for q in kept["open_questions"]], ["旧问题"])

    def test_all_keys_defaulted(self):
        merged = cc.merge_digest(None, None)
        for key in ("concepts", "rules", "rejected", "open_questions"):
            self.assertEqual(merged[key], [])


class CompressThreadTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self._patch = patch.object(thread_store, "DEMAND_THREADS_DIR", Path(self._tmp.name))
        self._patch.start()
        self.thread = make_thread(71)
        self.plan = cc.plan_compaction(self.thread)
        self.assertTrue(self.plan)
        self.before_len = len(self.thread["messages"])

    def tearDown(self):
        self._patch.stop()
        self._tmp.cleanup()

    def _run(self, mock_llm):
        with patch.object(cc, "llm_json", mock_llm):
            return asyncio.run(cc.compress_thread(self.thread["id"], self.thread, self.plan))

    def test_success_writes_context_and_keeps_messages(self):
        payload = {
            "summary": "【业务对象与概念】订单\n【规则与约束】无\n【已否决方案】无",
            "digest": {
                "concepts": [{"name": "订单", "note": "销售单据"}],
                "rejected": [{"name": "方案A", "note": "成本过高"}],
            },
        }
        result = self._run(AsyncMock(return_value=(payload, "raw")))

        self.assertTrue(result["ok"])
        self.assertEqual(self.thread["context"]["covered_until"], self.plan["covered_to"])
        self.assertEqual(self.thread["context"]["archived_rounds"], 31)
        self.assertEqual(self.thread["digest"]["concepts"][0]["name"], "订单")
        self.assertEqual(self.thread["digest"]["rejected"][0]["name"], "方案A")
        # 红线：messages 一个字都不能少
        self.assertEqual(len(self.thread["messages"]), self.before_len)
        # 落盘成功
        saved = fs_store.read_json(Path(self._tmp.name) / self.thread["id"] / ".data.json")
        self.assertEqual(saved["context"]["covered_until"], self.plan["covered_to"])

    def test_failure_does_not_advance_covered_until(self):
        result = self._run(AsyncMock(return_value=(None, None)))
        self.assertFalse(result["ok"])
        self.assertNotIn("context", self.thread)
        self.assertEqual(len(self.thread["messages"]), self.before_len)

    def test_retry_when_summary_loses_numbers(self):
        self.thread["messages"][0]["content"] = "账期必须 30 天"
        bad = {"summary": "账期若干天", "digest": {}}
        good = {"summary": "账期必须 30 天", "digest": {}}
        mock = AsyncMock(side_effect=[(bad, ""), (good, "")])
        result = self._run(mock)

        self.assertTrue(result["ok"])
        self.assertEqual(mock.await_count, 2)
        self.assertIn("30", self.thread["context"]["summary"])

    def test_empty_llm_payload_returns_failure(self):
        result = self._run(AsyncMock(return_value=({"summary": ""}, "")))
        self.assertFalse(result["ok"])


class ClearMessagesTest(unittest.TestCase):
    def test_clear_also_drops_context_and_digest(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(thread_store, "DEMAND_THREADS_DIR", Path(tmp)):
            data = {
                "id": "t-clear",
                "title": "x",
                "scenario_name": "场景",
                "ontology_name": "本体",
                "messages": [{"role": "user", "content": "hi"}],
                "context": {"summary": "旧摘要", "covered_until": 1},
                "digest": {"concepts": [{"name": "订单"}]},
            }
            fs_store.write_json(Path(tmp) / "t-clear" / ".data.json", data)

            thread_store.clear_messages("t-clear")

            saved = fs_store.read_json(Path(tmp) / "t-clear" / ".data.json")
            self.assertEqual(saved["messages"], [])
            self.assertNotIn("context", saved)
            self.assertNotIn("digest", saved)


if __name__ == "__main__":
    unittest.main()
