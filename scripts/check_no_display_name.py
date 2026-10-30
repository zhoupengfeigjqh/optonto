"""残留门禁：确认 ``display_name`` 已彻底消失（spec 006 · FR-014）。

用法::

    python scripts/check_no_display_name.py

判据：

* **代码面**：``core-backend`` / ``agent-backend`` / ``frontend`` / 各 MCP 服务 / ``mcp-shared`` / ``scripts``
  的源码与文档中不得出现 token ``display_name`` / ``displayName`` / ``DISPLAY_NAME``。
* **数据面**：``.data`` 的 YAML / JSON 按**结构**检查键名（字符串值里出现该词是合法的——
  例如对话记录里用户讨论过字段名，改写它会篡改历史，不属于字段）。
* **Markdown 材料**：``.data`` 下 ``*.md`` 按 token 检查（技能文档是字段说明文本）。

白名单仅限：spec 的历史记录、本 spec 目录、迁移与门禁脚本自身。
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]

TOKEN_RE = re.compile(r"display_name|displayName|DISPLAY_NAME|displayLabel|display_label")

CODE_DIRS = [
    "core-backend",
    "agent-backend/src",
    "agent-backend/scripts",
    "frontend/src",
    "mcp-shared",
    "ontology-query-mcp",
    "common-function-mcp",
    "data-engine-executor",
    "scripts",
]
CODE_SUFFIXES = {".py", ".ts", ".tsx", ".js", ".jsx", ".vue", ".md"}

DATA_DIR = ".data"
DATA_STRUCT_SUFFIXES = {".yaml", ".yml", ".json"}
BAD_KEYS = {"display_name", "x-display_name"}

WHITELIST = {
    "specs/003-ontology-model-extension/tasks.md",   # 历史记录：如实记载当时的字段口径
    "scripts/migrate_display_name_to_title.py",      # 迁移脚本必须认识旧键
    "scripts/check_no_display_name.py",              # 门禁脚本自身
}
WHITELIST_PREFIXES = (
    "specs/006-display-name-to-title/",              # 本 spec（必须能描述被改掉的键）
)


def _is_whitelisted(rel: str) -> bool:
    return rel in WHITELIST or any(rel.startswith(p) for p in WHITELIST_PREFIXES)


def _skip_dir(path: Path) -> bool:
    parts = set(path.parts)
    return bool(parts & {"node_modules", "dist", "build", "__pycache__", ".git", ".opt-agent"})


def scan_code() -> list[str]:
    problems: list[str] = []
    for base in CODE_DIRS:
        root = ROOT / base
        if not root.exists():
            continue
        for path in root.rglob("*"):
            if not path.is_file() or path.suffix.lower() not in CODE_SUFFIXES or _skip_dir(path):
                continue
            rel = path.relative_to(ROOT).as_posix()
            if _is_whitelisted(rel):
                continue
            for lineno, line in enumerate(path.read_text(encoding="utf-8", errors="ignore").splitlines(), 1):
                if TOKEN_RE.search(line):
                    problems.append(f"{rel}:{lineno}: {line.strip()[:120]}")
    return problems


def _walk_keys(node, path="", out=None):
    if out is None:
        out = []
    if isinstance(node, dict):
        for key, value in node.items():
            if key in BAD_KEYS:
                out.append(f"{path}/{key}")
            _walk_keys(value, f"{path}/{key}", out)
    elif isinstance(node, list):
        for idx, value in enumerate(node):
            _walk_keys(value, f"{path}[{idx}]", out)
    return out


def scan_data() -> list[str]:
    problems: list[str] = []
    root = ROOT / DATA_DIR
    if not root.exists():
        return problems
    for path in root.rglob("*"):
        if not path.is_file() or _skip_dir(path):
            continue
        suffix = path.suffix.lower()
        rel = path.relative_to(ROOT).as_posix()
        raw = path.read_text(encoding="utf-8", errors="ignore")
        if suffix in DATA_STRUCT_SUFFIXES:
            try:
                doc = json.loads(raw) if suffix == ".json" else yaml.safe_load(raw)
            except Exception as exc:  # 解析失败本身也是问题
                problems.append(f"{rel}: 解析失败 {exc}")
                continue
            for key_path in _walk_keys(doc):
                problems.append(f"{rel}: 残留键 {key_path}")
        elif suffix == ".md":
            for lineno, line in enumerate(raw.splitlines(), 1):
                if TOKEN_RE.search(line):
                    problems.append(f"{rel}:{lineno}: {line.strip()[:120]}")
    return problems


def main() -> int:
    code = scan_code()
    data = scan_data()
    problems = code + data
    if problems:
        print(f"FAIL：发现 {len(problems)} 处残留\n")
        for item in problems[:200]:
            print(f"  - {item}")
        if len(problems) > 200:
            print(f"  ... 其余 {len(problems) - 200} 处省略")
        return 1
    print("OK：display_name / displayName / DISPLAY_NAME / displayLabel 全量零命中（数据面按结构检查键名）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
