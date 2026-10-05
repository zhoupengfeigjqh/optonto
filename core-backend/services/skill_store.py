"""技能（skills/<技能名>/SKILL.md）存储层 —— 该领域**唯一**的文件读写出口。

分层（章程 II）：``routers.skills`` 一律经本模块，不直连 ``repositories``。

关键约定（2026-10-01 起）：技能描述**唯一来源 = SKILL.md 的 frontmatter**（agent 侧
SkillLoader 亦从此读取）。技能级 meta.json 已删除——它曾造成"UI 改描述对 agent 不生效"。
"""

import re
from pathlib import Path
from typing import Optional

from config import DATA_DIR
from errors import InternalError, NotFoundError
from repositories import fs_store
from services import get_ontology_dir

SKILL_TEMPLATE_PATH = DATA_DIR / "templates/skill_template.md"

SKILL_MD_NAME = "SKILL.md"


# ─── 路径 ───────────────────────────────────────────────────────────────────────

def skills_dir(scenario_name: str, ontology_name: str) -> Path:
    return get_ontology_dir(scenario_name, ontology_name) / "skills"


def skill_dir(scenario_name: str, ontology_name: str, skill_name: str) -> Path:
    return skills_dir(scenario_name, ontology_name) / skill_name


def skill_md_path(scenario_name: str, ontology_name: str, skill_name: str) -> Path:
    return skill_dir(scenario_name, ontology_name, skill_name) / SKILL_MD_NAME


# ─── frontmatter（技能描述的单一来源）───────────────────────────────────────────

def frontmatter_block(content: str) -> Optional[str]:
    """取 SKILL.md 头部 frontmatter 的**原文块**（不含包裹的 ---）；非 frontmatter 头返回 None。"""
    if not content.startswith("---\n"):
        return None
    end = content.find("\n---", 4)
    if end < 0:
        return None
    return content[4:end]


def description_of(content: str) -> str:
    """从 SKILL.md frontmatter 取 description（缺失/解析失败 → 空串）。"""
    block = frontmatter_block(content)
    if block is None:
        return ""
    fm = fs_store.parse_yaml(block, default={})
    return str(fm.get("description") or "") if isinstance(fm, dict) else ""


def with_description(content: str, description: str) -> Optional[str]:
    """把 description 写回 SKILL.md 的 frontmatter：**只重写头部块，正文与其他字段原样保留**。

    frontmatter 不合法（非 `---` 包裹 / 解析不出映射）→ 返回 None，由调用方报 400（不静默改写）。
    `name` 等既有字段保持原值（技能名创建后固定）。
    """
    block = frontmatter_block(content)
    if block is None:
        return None
    fm = fs_store.parse_yaml(block, default={})
    if not isinstance(fm, dict) or not fm:
        return None
    fm["description"] = description
    body = content[content.find("\n---", 4) + 4:]
    return "---\n" + fs_store.dump_yaml(fm) + "---" + body


# ─── 读 ─────────────────────────────────────────────────────────────────────────

def skill_entry(skill_dir_path: Path) -> dict:
    """技能目录 → 列表条目（description 取自 frontmatter；头部 300 字符做格式校验）。"""
    md_path = skill_dir_path / SKILL_MD_NAME
    has_md = fs_store.exists(md_path)
    content = fs_store.read_text(md_path) if has_md else ""
    head = content[:300]
    has_name_en = bool(re.search(r"\nname: [a-zA-Z]", head))
    has_desc = "\ndescription:" in head
    format_ok = bool(has_md and head.startswith("---\n") and has_name_en and has_desc)
    format_error = ""
    if has_md and not format_ok:
        if not head.startswith("---\n"):
            format_error = "文件头部缺少 ---"
        elif not has_name_en:
            format_error = "name 必须为英文"
        elif not has_desc:
            format_error = "缺少 description"
    return {
        "name": skill_dir_path.name, "has_skill": has_md, "format_ok": format_ok,
        "format_error": format_error,
        "description": description_of(content) if has_md else "",
        "updated_at": md_path.stat().st_mtime if has_md else skill_dir_path.stat().st_mtime,
    }


def list_skills(scenario_name: str, ontology_name: str) -> list[dict]:
    """技能列表（目录不存在 → 空列表）。"""
    sdir = skills_dir(scenario_name, ontology_name)
    if not fs_store.exists(sdir):
        return []
    return [skill_entry(d) for d in sorted(fs_store.list_dir(sdir)) if d.is_dir()]


def read_skill_md(scenario_name: str, ontology_name: str, skill_name: str) -> str:
    """读取 SKILL.md（不存在 → 404）。"""
    md_path = skill_md_path(scenario_name, ontology_name, skill_name)
    if not fs_store.exists(md_path):
        raise NotFoundError("技能文件不存在")
    return fs_store.read_text(md_path)


def read_skill_template() -> str:
    """读取技能模板（缺失 → 500）。"""
    if not fs_store.exists(SKILL_TEMPLATE_PATH):
        raise InternalError("技能模板文件不存在")
    return fs_store.read_text(SKILL_TEMPLATE_PATH)


# ─── 写 ─────────────────────────────────────────────────────────────────────────

def write_skill_md(scenario_name: str, ontology_name: str, skill_name: str, content: str) -> None:
    """写入 SKILL.md（目录自动创建，同名覆盖）。"""
    path = skill_md_path(scenario_name, ontology_name, skill_name)
    fs_store.ensure_dir(path.parent)
    fs_store.write_text(path, content)


def rewrite_description(scenario_name: str, ontology_name: str, skill_name: str, description: str) -> bool:
    """改写 SKILL.md frontmatter 的 description；frontmatter 非法 → False（调用方报 400）。"""
    md_path = skill_md_path(scenario_name, ontology_name, skill_name)
    if not fs_store.exists(md_path):
        raise NotFoundError("技能文件不存在")
    content = fs_store.read_text(md_path) or ""
    updated = with_description(content, description)
    if updated is None:
        return False
    fs_store.write_text(md_path, updated)
    return True


def delete_skill(scenario_name: str, ontology_name: str, skill_name: str) -> None:
    """删除技能目录（不存在 → 404）。"""
    sdir = skill_dir(scenario_name, ontology_name, skill_name)
    if not fs_store.exists(sdir):
        raise NotFoundError("技能不存在")
    fs_store.delete_tree(sdir)


def validate_generated_skill(content: str) -> str:
    """LLM 生成结果硬校验。返回错误信息；空字符串 = 通过。

    要求：① 头部必须是 YAML frontmatter（``---`` 包裹）；② 必须含 name（英文）与 description；
    ③ 正文不得有额外 frontmatter 块或对话性残留（如「好的/以下是/我将…」开头）。
    """
    if not content.startswith("---\n"):
        return "文件头部缺少 --- frontmatter"
    fm_end = content.find("\n---", 4)
    if fm_end < 0:
        return "frontmatter 缺少结束标记 ---"
    fm = content[4:fm_end]
    if not re.search(r"^\s*name:\s*[a-zA-Z]", fm, re.M):
        return "frontmatter 缺少 name 字段（必须为英文）"
    if not re.search(r"^\s*description:\s*\S", fm, re.M):
        return "frontmatter 缺少 description 字段"
    body = content[fm_end + 4:].lstrip()
    if body.startswith("---"):
        return "正文包含多余的 frontmatter 块（应只有头部一个）"
    if re.match(r"^(好的|好的，|好的,|以下是|作为一名|我将|我来|好的，我)", body):
        return "正文包含对话性开头内容（应直接从 Markdown 内容开始）"
    return ""
