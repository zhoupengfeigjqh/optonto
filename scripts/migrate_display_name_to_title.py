"""一次性迁移：中文名字段 ``display_name`` → ``title``（spec 006，硬切，无兼容）。

用法::

    python scripts/migrate_display_name_to_title.py --dry-run     # 只报告，不写盘
    python scripts/migrate_display_name_to_title.py               # 正式迁移

规则（见 specs/006-display-name-to-title/spec.md 附录 C）：

* **YAML / JSON**：解析结构 → 递归改键 → 用平台同一口径重新序列化
  （YAML ``safe_dump(allow_unicode=True, sort_keys=False)``、JSON ``indent=2, ensure_ascii=False``）。
  **禁止文本正则替换**：正则会把 ``x-display_name`` 之外的说明文字、字符串值一起改掉。
* **Markdown**（``SKILL.md`` / 模板）：按整词 token 替换（说明性文档，非结构化数据），替换后计数校验。
* 每个文件写盘前做「非空中文名 键路径 → 值」集合比对：迁移前后必须完全相等，
  不等即中止（这是"不能错误替换"的机器判据）。
* 同一 dict 内同时存在 ``display_name`` 与 ``title`` 视为冲突，脚本直接报错退出。
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / ".data"

OLD, NEW = "display_name", "title"
OLD_X, NEW_X = "x-display_name", "x-title"

YAML_SUFFIXES = {".yaml", ".yml"}
JSON_SUFFIXES = {".json"}
MD_SUFFIXES = {".md"}


class MigrationError(Exception):
    """迁移中止（数据结构冲突 / 集合比对不等）。"""


def _is_title_key(key: str) -> bool:
    return key in (OLD, OLD_X, NEW, NEW_X)


def rename_keys(node, hits: dict) -> object:
    """递归把 ``display_name`` / ``x-display_name`` 改名为 title 系键。"""
    if isinstance(node, dict):
        if OLD in node and NEW in node:
            raise MigrationError(f"同一节点同时存在 {OLD} 与 {NEW}：{list(node)[:6]}")
        if OLD_X in node and NEW_X in node:
            raise MigrationError(f"同一节点同时存在 {OLD_X} 与 {NEW_X}：{list(node)[:6]}")
        out = {}
        for key, value in node.items():
            new_key = NEW_X if key == OLD_X else (NEW if key == OLD else key)
            if new_key != key:
                hits[new_key] = hits.get(new_key, 0) + 1
            out[new_key] = rename_keys(value, hits)
        return out
    if isinstance(node, list):
        return [rename_keys(item, hits) for item in node]
    return node


def collect_titles(node, path=()) -> set:
    """收集「非空中文名」的 (归一化键路径, 值) 集合；键名归一为 ``*`` 以便前后比对。"""
    found: set = set()
    if isinstance(node, dict):
        for key, value in node.items():
            norm = "*" if _is_title_key(key) else key
            child = path + (norm,)
            if _is_title_key(key) and isinstance(value, str) and value.strip():
                found.add((child, value))
            else:
                found |= collect_titles(value, child)
    elif isinstance(node, list):
        for idx, value in enumerate(node):
            found |= collect_titles(value, path + (idx,))
    return found


def _read(path: Path) -> str:
    with open(path, "r", encoding="utf-8", newline="") as fh:
        return fh.read()


def _write(path: Path, text: str) -> None:
    # newline="\n"：避免 Windows 把 LF 翻成 CRLF 制造整库行尾噪音
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)


def migrate_structured(path: Path, apply: bool) -> tuple[int, str]:
    """YAML / JSON：解析式迁移。返回 (改名处数, 状态描述)。"""
    raw = _read(path)
    is_json = path.suffix.lower() in JSON_SUFFIXES
    if is_json:
        doc = json.loads(raw) if raw.strip() else None
    else:
        doc = yaml.safe_load(raw) if raw.strip() else None
    if doc is None:
        return 0, "空文件，跳过"

    hits: dict = {}
    new_doc = rename_keys(doc, hits)
    total = sum(hits.values())
    if total == 0:
        return 0, "无命中"

    before = collect_titles(doc)
    after = collect_titles(new_doc)
    if before != after:
        only_before = sorted(before - after)[:5]
        only_after = sorted(after - before)[:5]
        raise MigrationError(
            f"集合比对不等（{path.relative_to(ROOT)}）：迁移前独有={only_before} 迁移后独有={only_after}")

    if apply:
        if is_json:
            text = json.dumps(new_doc, ensure_ascii=False, indent=2)
        else:
            text = yaml.safe_dump(new_doc, allow_unicode=True, sort_keys=False)
        _write(path, text)
    return total, f"rename {total}（校验 {len(before)} 条非空中文名一致）"


def migrate_markdown(path: Path, apply: bool) -> tuple[int, str]:
    """Markdown：整词 token 替换（前后计数必须一致）。"""
    raw = _read(path)
    count_x = len(re.findall(r"\bx-display_name\b", raw))
    count_plain = len(re.findall(r"(?<!x-)\bdisplay_name\b", raw))
    if count_x == 0 and count_plain == 0:
        return 0, "无命中"
    text = re.sub(r"\bx-display_name\b", NEW_X, raw)
    text = re.sub(r"(?<!x-)\bdisplay_name\b", NEW, text)
    if len(re.findall(r"\btitle\b", text)) != len(re.findall(r"\btitle\b", raw)) + count_x + count_plain:
        # x-title 也计入 title，故只校验总数守恒
        raise MigrationError(f"替换计数不守恒：{path.relative_to(ROOT)}")
    if apply:
        _write(path, text)
    return count_x + count_plain, f"token 替换 {count_x + count_plain}"


def iter_targets() -> list[Path]:
    out = []
    for path in sorted(DATA_DIR.rglob("*")):
        if not path.is_file():
            continue
        suffix = path.suffix.lower()
        if suffix in YAML_SUFFIXES or suffix in JSON_SUFFIXES or suffix in MD_SUFFIXES:
            out.append(path)
    return out


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="display_name -> title 一次性迁移")
    parser.add_argument("--dry-run", action="store_true", help="只报告，不写盘")
    args = parser.parse_args(argv)
    apply = not args.dry_run

    total = 0
    touched = 0
    for path in iter_targets():
        if path.suffix.lower() in MD_SUFFIXES:
            count, note = migrate_markdown(path, apply)
        else:
            count, note = migrate_structured(path, apply)
        if count:
            touched += 1
            total += count
            print(f"[{'DRY' if not apply else 'OK '}] {path.relative_to(ROOT)}  {note}")
    print(f"\n文件 {touched} 个，改名 {total} 处，模式={'dry-run' if not apply else 'apply'}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except MigrationError as exc:
        print(f"中止：{exc}", file=sys.stderr)
        sys.exit(1)
