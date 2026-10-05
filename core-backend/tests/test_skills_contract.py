"""技能（SKILL.md）契约测试：描述**单一来源 = frontmatter**（2026-10-01 删除技能级 meta.json）。

口径：
- description 只存在于 `SKILL.md` 头部 frontmatter（agent 侧 `SkillLoader` 同源读取）；
- 列表（`GET .../skills`）与编辑描述（`PUT .../meta`）都读写 frontmatter；
- **历史上存在过的技能级 meta.json 不再被读取**（本文件有用例锁定）；
- frontmatter 不合法：列表报 `format_error`、编辑描述报 400（不静默改写）。

2026-10-05：技能文件的读写实现由 `routers.skills` 下沉到业务层 `services.skill_store`
（章程 II 分层：接口层不直连数据访问层），故本文件改为直接测业务层实现——**契约语义不变**。

stdlib unittest 零依赖：
    python -m unittest tests.test_skills_contract -v
"""
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services import skill_store  # noqa: E402


MD_OK = """---
name: raw-material-inventory
description: 原始描述
---

# 技能正文
内容一二三
"""


class SkillContractCase(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.dir = Path(self._tmp.name)
        self.md = self.dir / "SKILL.md"

    # ─── 列表条目（GET .../skills 的实现）──────────────────────────────────
    def test_描述取自frontmatter(self) -> None:
        self.md.write_text(MD_OK, encoding="utf-8")
        e = skill_store.skill_entry(self.dir)
        self.assertEqual(e["description"], "原始描述")
        self.assertTrue(e["has_skill"])
        self.assertTrue(e["format_ok"])
        self.assertEqual(e["format_error"], "")
        self.assertEqual(e["name"], self.dir.name)

    def test_遗留技能级meta_json不再被读取(self) -> None:
        # 锁定"删除技能级 meta.json"：目录里即使还残留旧 meta.json，描述也只认 frontmatter
        self.md.write_text(MD_OK, encoding="utf-8")
        (self.dir / "meta.json").write_text(
            json.dumps({"name": "old", "description": "旧描述"}, ensure_ascii=False), encoding="utf-8")
        self.assertEqual(skill_store.skill_entry(self.dir)["description"], "原始描述")

    def test_无SKILL_md的目录(self) -> None:
        e = skill_store.skill_entry(self.dir)
        self.assertFalse(e["has_skill"])
        self.assertFalse(e["format_ok"])
        self.assertEqual(e["description"], "")
        self.assertEqual(e["format_error"], "")

    def test_格式错误文案(self) -> None:
        cases = {
            "# 没有 frontmatter\n正文\n": "文件头部缺少 ---",
            "---\nname: 中文名\ndescription: x\n---\n正文\n": "name 必须为英文",
            "---\nname: abc\n---\n正文\n": "缺少 description",
        }
        for text, expect in cases.items():
            with self.subTest(expect=expect):
                self.md.write_text(text, encoding="utf-8")
                e = skill_store.skill_entry(self.dir)
                self.assertFalse(e["format_ok"])
                self.assertEqual(e["format_error"], expect)

    def test_描述为空或缺失时返回空串(self) -> None:
        self.assertEqual(skill_store.description_of("---\nname: abc\n---\n正文\n"), "")
        self.assertEqual(skill_store.description_of("# 无 frontmatter\n"), "")

    # ─── 改写描述（PUT .../meta 的实现）────────────────────────────────────
    def test_改写描述只动frontmatter(self) -> None:
        out = skill_store.with_description(MD_OK, "新描述")
        self.assertIsNotNone(out)
        self.assertEqual(skill_store.description_of(out), "新描述")
        self.assertIn("name: raw-material-inventory", out)      # 其他字段原样保留
        self.assertIn("# 技能正文", out)                          # 正文原样保留
        self.assertTrue(out.endswith("内容一二三\n"))

    def test_描述含特殊字符可往返(self) -> None:
        tricky = "采购: 库存/入库 与 '单引号' 和 \"双引号\""
        out = skill_store.with_description(MD_OK, tricky)
        self.assertEqual(skill_store.description_of(out), tricky)

    def test_非法frontmatter返回None(self) -> None:
        self.assertIsNone(skill_store.with_description("# 无 frontmatter\n", "x"))
        self.assertIsNone(skill_store.with_description("---\nname: a\n", "x"))   # 缺结束标记
        self.assertIsNone(skill_store.with_description("---\n\n---\n正文\n", "x"))  # 头部为空映射

    def test_编辑后列表与agent读到同一份描述(self) -> None:
        # 模拟 PUT .../meta 落盘 → 列表刷新；agent 的 SkillLoader 读同一 frontmatter（同源）
        self.md.write_text(skill_store.with_description(MD_OK, "编辑后的描述"), encoding="utf-8")
        content = self.md.read_text(encoding="utf-8")
        self.assertEqual(skill_store.skill_entry(self.dir)["description"], "编辑后的描述")
        self.assertEqual(skill_store.description_of(content), "编辑后的描述")


if __name__ == "__main__":
    unittest.main()
