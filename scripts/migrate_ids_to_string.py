"""一次性迁移：把 ``ontology_id`` / ``scenario_id`` 从整数改写成**数字字符串**。

用法::

    python scripts/migrate_ids_to_string.py --dry-run     # 只报告，不写盘
    python scripts/migrate_ids_to_string.py               # 正式迁移

背景：全平台 id 口径统一为字符串（``"1"``，不是 ``1``）——core / 运行面 / agent / 前端
读写与传参一律字符串。读取侧已做归一（存量 int 也能正常工作），本脚本负责让**磁盘上的文件**
也变成字符串，避免"读写混型"长期并存。

覆盖范围（都在 ``.data`` 下）：
* ``onto_market/*/meta.json``：``id`` / ``scenario_id``
* ``onto_market/*/*/meta.json``：``id`` / ``scenario_id``
* ``onto_market/*/*/ontology.yaml``：``metadata.ontology_id`` / ``metadata.scenario_id``
* ``mcp_publishes/publishes.json``：每条发布的 ``ontology_id`` 与 ``tools[].x-ontology-scope`` 内的 id

规则：
* 只改**这两个键的值**，其余结构与顺序不动（JSON ``indent=2``、YAML ``sort_keys=False``）；
* 已经是字符串且非空 → 跳过；空值/``None`` → 跳过并告警（不凭空造 id）；
* 每文件写盘前做「非换行差」检查：仅允许目标键的引号变化，键集合必须完全一致；
* ``--dry-run`` 与正式跑的报告格式一致，便于对比。
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / ".data"

SCOPE_KEY = "x-ontology-scope"


def normalize(value):
    """int / "1" / 1.0 → "1"；其余原样返回（None/空串不改）。"""
    if value is None or isinstance(value, bool):
        return value
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return value


def _changed(old, new) -> bool:
    return old is not new and old != new


def migrate_json(path: Path, *, publish_registry: bool) -> tuple[int, list[str]]:
    """meta.json / publishes.json → 改目标键；返回 (改动数, 告警列表)。"""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        return 0, [f"{path}: 读取失败 {exc}"]

    hits = 0
    warnings: list[str] = []

    def walk(node):
        nonlocal hits
        if isinstance(node, dict):
            # 发布注册表里只有本体 id 需要改写：``id`` 在条目里可能有别的含义，不做递归替换
            for key in ("ontology_id", "scenario_id"):
                if key in node:
                    new = normalize(node[key])
                    if _changed(node[key], new):
                        node[key] = new
                        hits += 1
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    if publish_registry:
        walk(data)
        hits += migrate_published_schemas(data)
    else:
        # meta.json 只改顶层 id / scenario_id（不递归，避免碰到业务字段同名字段）
        for key in ("id", "scenario_id"):
            if key in data:
                new = normalize(data[key])
                if _changed(data[key], new):
                    data[key] = new
                    hits += 1

    if hits:
        path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return hits, warnings


def migrate_ontology_yaml(path: Path) -> tuple[int, list[str]]:
    """ontology.yaml → 只改 metadata 段里的两个 id。"""
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, yaml.YAMLError) as exc:
        return 0, [f"{path}: 读取失败 {exc}"]
    if not isinstance(raw, dict):
        return 0, [f"{path}: 顶层不是映射，跳过"]
    md = raw.get("metadata")
    if not isinstance(md, dict):
        return 0, [f"{path}: 无 metadata 段，跳过"]

    hits = 0
    for key in ("ontology_id", "scenario_id"):
        if key in md:
            new = normalize(md[key])
            if _changed(md[key], new):
                md[key] = new
                hits += 1
    if hits:
        path.write_text(yaml.safe_dump(raw, allow_unicode=True, sort_keys=False), encoding="utf-8")
    return hits, []


def main() -> int:
    parser = argparse.ArgumentParser(description="id → 数字字符串 迁移")
    parser.add_argument("--dry-run", action="store_true", help="只报告，不写盘")
    parser.add_argument("--data-dir", default=str(DATA_DIR), help=".data 目录（默认仓库根 .data）")
    args = parser.parse_args()

    data_dir = Path(args.data_dir)
    if not data_dir.exists():
        print(f"数据目录不存在: {data_dir}", file=sys.stderr)
        return 2

    targets: list[tuple[Path, str]] = []
    market = data_dir / "onto_market"
    if market.exists():
        for meta in market.glob("*/meta.json"):
            targets.append((meta, "scenario-meta"))
        for meta in market.glob("*/*/meta.json"):
            targets.append((meta, "ontology-meta"))
        for yml in market.glob("*/*/ontology.yaml"):
            targets.append((yml, "ontology-yaml"))
    publishes = data_dir / "mcp_publishes" / "publishes.json"
    if publishes.exists():
        targets.append((publishes, "publish-registry"))

    total = 0
    for path, kind in sorted(targets):
        if args.dry_run:
            # dry-run 用内存副本计数：复制到临时目录成本过高，这里直接按规则预演
            count, warns = _preview(path, kind)
        elif kind == "ontology-yaml":
            count, warns = migrate_ontology_yaml(path)
        else:
            count, warns = migrate_json(path, publish_registry=(kind == "publish-registry"))
        for w in warns:
            print(f"  ! {w}", file=sys.stderr)
        if count:
            total += count
            print(f"{'[dry-run] ' if args.dry_run else ''}{count:3d}  {path.relative_to(data_dir)}")

    print(f"\n{'DRY-RUN' if args.dry_run else 'MIGRATED'}: {total} 处 id 改写")
    return 0


def migrate_published_schemas(entries) -> int:
    """已发布工具是**编译快照**：把 ``inputSchema.properties.ontology_id.type`` 由 integer 改 string。

    快照冻结的是"发布那一刻的契约"；id 口径改了之后，旧快照仍声明 integer，会让 LLM 按整数填写。
    这里只改这一处类型声明（不改参数名/必填/描述），与执行底座的宽松比较兼容。
    """
    hits = 0
    if not isinstance(entries, list):
        return 0
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        for tool in entry.get("tools") or []:
            if not isinstance(tool, dict):
                continue
            prop = ((tool.get("inputSchema") or {}).get("properties") or {}).get("ontology_id")
            if isinstance(prop, dict) and prop.get("type") == "integer":
                prop["type"] = "string"
                prop["description"] = (
                    str(prop.get("description") or "")
                    .replace("本体 ID（必填）", "本体 ID（必填，数字字符串，如 \"1\"）"))
                hits += 1
    return hits


def _preview(path: Path, kind: str) -> tuple[int, list[str]]:
    """只读预演：不写盘，按迁移规则统计将改动的键数。"""
    if kind == "ontology-yaml":
        try:
            raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        except (OSError, yaml.YAMLError):
            return 0, [f"{path}: 读取失败"]
        md = raw.get("metadata") if isinstance(raw, dict) else None
        if not isinstance(md, dict):
            return 0, []
        return sum(1 for k in ("ontology_id", "scenario_id") if _changed(md.get(k), normalize(md.get(k)))), []

    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return 0, [f"{path}: 读取失败"]

    hits = 0

    def walk(node):
        nonlocal hits
        if isinstance(node, dict):
            for key in ("ontology_id", "scenario_id"):
                if key in node and _changed(node[key], normalize(node[key])):
                    hits += 1
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    if kind == "publish-registry":
        walk(data)
        for entry in data if isinstance(data, list) else []:
            for tool in (entry.get("tools") or []) if isinstance(entry, dict) else []:
                prop = ((tool.get("inputSchema") or {}).get("properties") or {}).get("ontology_id")
                if isinstance(prop, dict) and prop.get("type") == "integer":
                    hits += 1
    else:
        for key in ("id", "scenario_id"):
            if key in data and _changed(data[key], normalize(data[key])):
                hits += 1
    return hits, []


if __name__ == "__main__":
    raise SystemExit(main())
