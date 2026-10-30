"""一次性迁移：行为参数的中文名字段 ``description`` → ``title``（spec 006 · D-2）。

背景：本体函数参数一直用 ``title`` 表示中文名，行为参数却用 ``description`` 承担同一语义。
本次把行为参数也统一到 ``title``，``description`` 降级为可选的"补充说明"字段。

用法::

    python scripts/migrate_behavior_param_title.py --dry-run
    python scripts/migrate_behavior_param_title.py

规则：

* 只动 ``behaviors[].params`` 及其嵌套 ``properties`` / ``items.properties``，
  **不触碰** 行为自身的 ``description``（行为描述）、``response``、函数参数、概念属性等。
* 非空 ``description`` → 同值写入 ``title`` 并移除 ``description``（值必须逐条守恒）。
* 空 ``description`` 直接移除（无信息量，字段名换掉后留空串只是噪音）。
* 若同一参数项已有非空 ``title`` 且与 ``description`` 不同 → 报错中止（不允许猜测）。
* YAML 用平台同一口径重新序列化（``safe_dump(allow_unicode=True, sort_keys=False)``）。
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / ".data"


class MigrationError(Exception):
    """迁移中止。"""


def _migrate_params(params: dict, path: str, moved: list, dropped: list) -> None:
    if not isinstance(params, dict):
        return
    for key, spec in params.items():
        if not isinstance(spec, dict):
            continue
        where = f"{path}.{key}"
        if "description" in spec:
            desc = spec.get("description")
            title = spec.get("title")
            text = "" if desc is None else str(desc)
            if text.strip() and title not in (None, "") and str(title) != text:
                raise MigrationError(f"{where} 已有 title={title!r} 与 description={text!r} 冲突")
            # 原位改写：title 必须落在原 description 的位置，避免追加到 dict 末尾导致 YAML 键序错乱
            rebuilt = {}
            for k, v in spec.items():
                if k == "description":
                    if text.strip():
                        rebuilt["title"] = text
                    continue
                rebuilt[k] = v
            if text.strip():
                moved.append((where, text))
            else:
                dropped.append(where)
            params[key] = rebuilt
            spec = rebuilt
        props = spec.get("properties")
        if isinstance(props, dict):
            _migrate_params(props, where, moved, dropped)
        items = spec.get("items")
        if isinstance(items, dict) and isinstance(items.get("properties"), dict):
            _migrate_params(items["properties"], f"{where}[]", moved, dropped)


def migrate_file(path: Path, apply: bool) -> tuple[list, list]:
    raw = path.read_text(encoding="utf-8")
    if not raw.strip():
        return [], []
    doc = yaml.safe_load(raw)
    if not isinstance(doc, dict):
        return [], []
    behaviors = doc.get("behaviors")
    if not isinstance(behaviors, list) or not behaviors:
        return [], []

    moved: list = []
    dropped: list = []
    for behavior in behaviors:
        if not isinstance(behavior, dict):
            continue
        name = behavior.get("name") or "?"
        _migrate_params(behavior.get("params") or {}, f"{name}.params", moved, dropped)

    if not moved and not dropped:
        return [], []

    if apply:
        text = yaml.safe_dump(doc, allow_unicode=True, sort_keys=False)
        # newline="\n"：避免 Windows 把 LF 翻成 CRLF 制造整库行尾噪音
        with open(path, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(text)
    return moved, dropped


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="行为参数 description -> title 一次性迁移")
    parser.add_argument("--dry-run", action="store_true", help="只报告，不写盘")
    args = parser.parse_args(argv)
    apply = not args.dry_run

    total_moved = 0
    total_dropped = 0
    touched = 0
    for path in sorted(DATA_DIR.rglob("*.yaml")):
        if not path.is_file():
            continue
        moved, dropped = migrate_file(path, apply)
        if not moved and not dropped:
            continue
        touched += 1
        total_moved += len(moved)
        total_dropped += len(dropped)
        rel = path.relative_to(ROOT)
        print(f"[{'DRY' if not apply else 'OK '}] {rel}  中文名迁移 {len(moved)} / 空 description 清理 {len(dropped)}")
        if args.dry_run:
            for where, text in moved:
                print(f"      {where} = {text}")
    print(f"\n文件 {touched} 个，中文名迁移 {total_moved} 处，空 description 清理 {total_dropped} 处，"
          f"模式={'dry-run' if not apply else 'apply'}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except MigrationError as exc:
        print(f"中止：{exc}", file=sys.stderr)
        sys.exit(1)
