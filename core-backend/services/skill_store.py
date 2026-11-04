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
from repositories.metadata import normalize_id
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


def _rebuild_frontmatter(content: str, fm: dict) -> str:
    """用给定映射重建头部，正文逐字保留（`---` 收尾与正文原样衔接）。"""
    body = content[content.find("\n---", 4) + 4:]
    return "---\n" + fs_store.dump_yaml(fm) + "---" + body


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
    return _rebuild_frontmatter(content, fm)


def stamp_metadata(content: str, meta: Optional[dict]) -> Optional[str]:
    """把本体/场景四元组写入 frontmatter 的 ``metadata`` 段（保存时由服务端确定性注入）。

    口径（与 ``ontology.yaml.metadata``、agent 侧 SkillLoader.resolveOntologyContext 同名同序）：
    ``ontology_id`` / ``ontology_name`` / ``scenario_id`` / ``scenario_name``。

    - **整体覆盖**：已有 ``metadata``（含模型抄错的本体 id）一律丢弃，以落盘时刻的上下文为准；
      因此本函数幂等，重复保存不会产生嵌套或重复块。
    - **放在头部末尾**：``skill_entry`` 只扫头部窗口找 name/description，避免把 description 挤出窗口。
    - 值为 ``None`` / ``""`` 的键**直接省略**，绝不写 ``null``（回读会变成字符串 "null"）。
    - frontmatter 不合法（非 `---` 包裹 / 解析不出映射）→ 返回 None，由调用方决定（不静默篡改）。
    """
    if not meta:
        return content
    block = frontmatter_block(content)
    if block is None:
        return None
    fm = fs_store.parse_yaml(block, default={})
    if not isinstance(fm, dict) or not fm:
        return None
    fm.pop("metadata", None)                                  # 先删再插 = 恒在头部末尾
    values = {}
    for key, value in meta.items():
        if value is None or value == "":
            continue
        # id 一律落成**数字字符串**（"1"）：调用方传 int 也在此归一，文件里不出现裸数字
        values[key] = normalize_id(value) if key in ("ontology_id", "scenario_id") else value
        if values[key] is None:
            values.pop(key)
    if not values:
        return content
    fm["metadata"] = values
    return _rebuild_frontmatter(content, fm)


# ─── 读 ─────────────────────────────────────────────────────────────────────────

def skill_entry(skill_dir_path: Path) -> dict:
    """技能目录 → 列表条目（description 取自 frontmatter；头部窗口做格式校验）。

    窗口 600 字符：头部除 name/description 外还有 metadata 段（本体四元组），
    窗口过窄会把 description 挤出去导致误报「缺少 description」。
    """
    md_path = skill_dir_path / SKILL_MD_NAME
    has_md = fs_store.exists(md_path)
    content = fs_store.read_text(md_path) if has_md else ""
    head = content[:600]
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

def write_skill_md(
    scenario_name: str, ontology_name: str, skill_name: str, content: str,
    meta: Optional[dict] = None,
) -> None:
    """写入 SKILL.md（目录自动创建，同名覆盖）。

    ``meta`` = 本体/场景四元组，落盘前由 :func:`stamp_metadata` 注入头部 ``metadata`` 段。
    头部不合法时（如用户在编辑器里删掉了 ``---``）→ **不注入、原样落盘**，
    由列表的 ``format_error`` 暴露问题，不阻断保存。
    """
    if meta:
        content = stamp_metadata(content, meta) or content
    path = skill_md_path(scenario_name, ontology_name, skill_name)
    fs_store.ensure_dir(path.parent)
    fs_store.write_text(path, content)


def rewrite_description(
    scenario_name: str, ontology_name: str, skill_name: str, description: str,
    meta: Optional[dict] = None,
) -> bool:
    """改写 SKILL.md frontmatter 的 description；frontmatter 非法 → False（调用方报 400）。"""
    md_path = skill_md_path(scenario_name, ontology_name, skill_name)
    if not fs_store.exists(md_path):
        raise NotFoundError("技能文件不存在")
    content = fs_store.read_text(md_path) or ""
    updated = with_description(content, description)
    if updated is None:
        return False
    if meta:
        updated = stamp_metadata(updated, meta) or updated
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
