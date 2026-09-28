"""数据访问层文件原语测试（章程 III：覆盖正常–异常–边界）。

运行：
    python -m pytest core-backend/tests/test_fs_store.py -q
    cd core-backend && python -m unittest tests.test_fs_store -v
"""

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from repositories import fs_store  # noqa: E402


class FsStoreTest(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)

    def tearDown(self):
        self._tmp.cleanup()

    # ─── 文本 ────────────────────────────────────────────────────────────

    def test_read_text_roundtrip(self):
        p = self.root / "a" / "b.txt"
        fs_store.write_text(p, "内容\n第二行")
        self.assertEqual(fs_store.read_text(p), "内容\n第二行")

    def test_write_text_creates_parent_dirs(self):
        p = self.root / "deep" / "nested" / "c.txt"
        fs_store.write_text(p, "x")
        self.assertTrue(p.exists())

    def test_read_text_missing_raises_by_default(self):
        """未给默认值时缺失应显式抛错，避免调用方误以为读到了空内容。"""
        with self.assertRaises(FileNotFoundError):
            fs_store.read_text(self.root / "nope.txt")

    def test_read_text_missing_returns_default(self):
        self.assertEqual(fs_store.read_text(self.root / "nope.txt", default=""), "")

    def test_read_text_if_exists(self):
        self.assertIsNone(fs_store.read_text_if_exists(self.root / "nope.txt"))
        p = self.root / "d.txt"
        fs_store.write_text(p, "ok")
        self.assertEqual(fs_store.read_text_if_exists(p), "ok")

    # ─── 原子性 ──────────────────────────────────────────────────────────

    def test_atomic_write_leaves_no_tmp_file(self):
        p = self.root / "atomic.txt"
        fs_store.write_text(p, "v1")
        fs_store.write_text(p, "v2")
        self.assertEqual(fs_store.read_text(p), "v2")
        leftovers = [f.name for f in self.root.iterdir() if f.name.endswith(".tmp")]
        self.assertEqual(leftovers, [])

    # ─── JSON ────────────────────────────────────────────────────────────

    def test_json_roundtrip_keeps_chinese(self):
        p = self.root / "m.json"
        fs_store.write_json(p, {"名称": "高强度钢板", "数量": 35})
        self.assertIn("高强度钢板", p.read_text(encoding="utf-8"))
        self.assertEqual(fs_store.read_json(p), {"名称": "高强度钢板", "数量": 35})

    def test_read_json_fallbacks(self):
        """缺失 / 空文件 / 内容损坏，统一按「视作缺失」返回默认值。"""
        self.assertEqual(fs_store.read_json(self.root / "nope.json", default={}), {})
        empty = self.root / "empty.json"
        empty.write_text("", encoding="utf-8")
        self.assertEqual(fs_store.read_json(empty, default={}), {})
        broken = self.root / "broken.json"
        broken.write_text("{ not json", encoding="utf-8")
        self.assertIsNone(fs_store.read_json(broken))
        self.assertEqual(fs_store.read_json(broken, default=[]), [])

    # ─── YAML ────────────────────────────────────────────────────────────

    def test_yaml_roundtrip(self):
        p = self.root / "o.yaml"
        data = {"metadata": {"name": "测试本体"}, "concepts": [{"name": "原材料"}]}
        fs_store.write_yaml(p, data)
        self.assertEqual(fs_store.read_yaml(p), data)

    def test_read_yaml_fallbacks(self):
        self.assertIsNone(fs_store.read_yaml(self.root / "nope.yaml"))
        self.assertEqual(fs_store.read_yaml(self.root / "nope.yaml", default={}), {})
        broken = self.root / "broken.yaml"
        broken.write_text("a: [1, 2", encoding="utf-8")
        self.assertIsNone(fs_store.read_yaml(broken))

    # ─── 删除与目录 ──────────────────────────────────────────────────────

    def test_delete_file(self):
        p = self.root / "x.txt"
        fs_store.write_text(p, "x")
        self.assertTrue(fs_store.delete_file(p))
        self.assertFalse(fs_store.delete_file(p))

    def test_delete_tree(self):
        d = self.root / "dir" / "sub"
        fs_store.write_text(d / "f.txt", "x")
        self.assertTrue(fs_store.delete_tree(self.root / "dir"))
        self.assertFalse((self.root / "dir").exists())
        self.assertFalse(fs_store.delete_tree(self.root / "dir"))

    def test_list_dir_missing_returns_empty(self):
        self.assertEqual(fs_store.list_dir(self.root / "nope"), [])
        fs_store.write_text(self.root / "d" / "f.txt", "x")
        self.assertEqual(len(fs_store.list_dir(self.root / "d")), 1)

    def test_ensure_dir_nested(self):
        p = fs_store.ensure_dir(self.root / "a" / "b" / "c")
        self.assertTrue(p.is_dir())
        # 幂等
        self.assertTrue(fs_store.ensure_dir(p).is_dir())

    def test_exists(self):
        self.assertFalse(fs_store.exists(self.root / "nope"))
        fs_store.write_text(self.root / "y.txt", "y")
        self.assertTrue(fs_store.exists(self.root / "y.txt"))


if __name__ == "__main__":
    unittest.main()
