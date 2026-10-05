"""API for skill management — CRUD + LLM generation.

分层（章程 II）：本模块为接口层；文件读写一律经数据访问层 ``repositories.fs_store``。
"""

import json
import logging
import re
from pathlib import Path

from fastapi import APIRouter, Body, HTTPException

from errors import DomainError

from config import DATA_DIR
from dependencies import get_ontology_names
from repositories.metadata import get_scenario_by_name
from repositories import fs_store
from services import load_ontology_data, _get_ontology_dir
from llm_utils import load_env, llm_text

router = APIRouter(prefix="/api/ontologies/{ontology_id}/skills", tags=["技能"])
logger = logging.getLogger(__name__)

load_env()


SKILL_TEMPLATE_PATH = DATA_DIR / "templates/skill_template.md"


def _skills_dir(sc_name: str, on_name: str) -> Path:
    return _get_ontology_dir(sc_name, on_name) / "skills"


def _skill_dir(sc_name: str, on_name: str, skill_name: str) -> Path:
    return _skills_dir(sc_name, on_name) / skill_name


def _skill_md_path(sc_name: str, on_name: str, skill_name: str) -> Path:
    return _skill_dir(sc_name, on_name, skill_name) / "SKILL.md"


# ─── SKILL.md frontmatter（技能描述的**单一来源**）─────────────────────────────
# 技能描述只存在于 SKILL.md 头部 frontmatter（agent 侧 SkillLoader 亦从此读取）。
# 2026-10-01：删除技能级 meta.json —— 此前 description 两处表达，且 `PUT .../meta` 只改
# meta.json，对 agent 完全不生效（agent 读 frontmatter）。现在读写都收敛到 frontmatter。

def _skill_frontmatter_block(content: str) -> str | None:
    """取 SKILL.md 头部 frontmatter 的**原文块**（不含包裹的 ---）；非 frontmatter 头返回 None。"""
    if not content.startswith("---\n"):
        return None
    end = content.find("\n---", 4)
    if end < 0:
        return None
    return content[4:end]


def _skill_description(content: str) -> str:
    """从 SKILL.md frontmatter 取 description（缺失/解析失败 → 空串）。"""
    block = _skill_frontmatter_block(content)
    if block is None:
        return ""
    fm = fs_store.parse_yaml(block, default={})
    return str(fm.get("description") or "") if isinstance(fm, dict) else ""


def _with_skill_description(content: str, description: str) -> str | None:
    """把 description 写回 SKILL.md 的 frontmatter：**只重写头部块，正文与其他字段原样保留**。

    frontmatter 不合法（非 `---` 包裹 / 解析不出映射）→ 返回 None，由调用方报 400（不静默改写）。
    `name` 等既有字段保持原值（技能名创建后固定）。
    """
    block = _skill_frontmatter_block(content)
    if block is None:
        return None
    fm = fs_store.parse_yaml(block, default={})
    if not isinstance(fm, dict) or not fm:
        return None
    fm["description"] = description
    body = content[content.find("\n---", 4) + 4:]
    return "---\n" + fs_store.dump_yaml(fm) + "---" + body


def _skill_entry(skill_dir: Path) -> dict:
    """技能目录 → 列表条目（**纯函数**，供 list_skills 与测试共用）。

    description 取自 SKILL.md frontmatter；格式校验沿用"头部 300 字符"口径
    （与 `_validate_generated_skill` 的 name/description 要求一致）。
    """
    md_path = skill_dir / "SKILL.md"
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
        "name": skill_dir.name, "has_skill": has_md, "format_ok": format_ok,
        "format_error": format_error,
        "description": _skill_description(content) if has_md else "",
        "updated_at": md_path.stat().st_mtime if has_md else skill_dir.stat().st_mtime,
    }


# ─── List Skills ───────────────────────────────────────────────────────────

@router.get("")
async def list_skills(ontology_id: int):
    """技能列表：description 取自 SKILL.md frontmatter（不再读技能级 meta.json）。"""
    sc_name, on_name = await get_ontology_names(ontology_id)
    skills_dir = _skills_dir(sc_name, on_name)
    if not fs_store.exists(skills_dir):
        return []
    return [_skill_entry(d) for d in sorted(fs_store.list_dir(skills_dir)) if d.is_dir()]


# ─── Get Skill Content ─────────────────────────────────────────────────────

@router.get("/{skill_name}/content")
async def get_skill_content(ontology_id: int, skill_name: str):
    sc_name, on_name = await get_ontology_names(ontology_id)
    md_path = _skill_md_path(sc_name, on_name, skill_name)
    if not fs_store.exists(md_path):
        raise HTTPException(status_code=404, detail="技能文件不存在")
    return {"content": fs_store.read_text(md_path), "skill_name": skill_name}


# ─── Save Skill Content ────────────────────────────────────────────────────

@router.put("/{skill_name}/content")
async def save_skill_content(ontology_id: int, skill_name: str, body: dict):
    sc_name, on_name = await get_ontology_names(ontology_id)
    fs_store.write_text(_skill_md_path(sc_name, on_name, skill_name), body.get("content", ""))
    return {"message": "技能文件已保存"}


# ─── Delete Skill ───────────────────────────────────────────────────────────

@router.delete("/{skill_name}")
async def delete_skill(ontology_id: int, skill_name: str):
    sc_name, on_name = await get_ontology_names(ontology_id)
    sdir = _skill_dir(sc_name, on_name, skill_name)
    if not fs_store.exists(sdir):
        raise HTTPException(status_code=404, detail="技能不存在")
    fs_store.delete_tree(sdir)
    return {"message": "技能已删除"}


# ─── Update Skill Description ────────────────────────────────────────────────

@router.put("/{skill_name}/meta")
async def update_skill_meta(ontology_id: int, skill_name: str, body: dict):
    """更新技能描述（**单一来源 = SKILL.md frontmatter**；技能名创建后固定）。

    只重写头部 frontmatter 的 description，正文与其他字段原样保留。
    因此这次修改**对 agent 立即生效**——agent 的 SkillLoader 读的就是 frontmatter
    （此前写 meta.json，agent 侧永远看不到改动）。
    """
    sc_name, on_name = await get_ontology_names(ontology_id)
    md_path = _skill_md_path(sc_name, on_name, skill_name)
    if not fs_store.exists(md_path):
        raise HTTPException(status_code=404, detail="技能不存在")

    content = fs_store.read_text(md_path) or ""
    updated = _with_skill_description(content, str(body.get("description", "") or ""))
    if updated is None:
        raise HTTPException(status_code=400, detail="SKILL.md 头部 frontmatter 不合法，无法更新描述")
    fs_store.write_text(md_path, updated)
    return {"message": "技能已更新"}


# ─── Generate Skill ─────────────────────────────────────────────────────────

def _fmt_constraint(c) -> str:
    """属性约束压缩为一段可读文本（与 SKILL.md 属性表"约束"列同口径）；无约束返回 '-'。"""
    if c is None:
        return "-"
    parts = []
    if c.unique:
        parts.append("唯一")
    if c.required:
        parts.append("必填")
    if c.enum:
        parts.append(f"枚举=[{', '.join(str(v) for v in c.enum)}]")
    if c.pattern:
        parts.append(f"模式={c.pattern}")
    if c.min is not None or c.max is not None:
        lo = str(c.min) if c.min is not None else "-∞"
        hi = str(c.max) if c.max is not None else "+∞"
        parts.append(f"范围={lo}~{hi}")
    return "；".join(parts) if parts else "-"


# 关系类型中文标签（与前端 RelationTable.RELATION_TYPE_OPTIONS 同口径；空则不输出，不给 LLM 噪音）
_RELATION_TYPE_LABELS = {
    "asymmetric": "非对称", "symmetric": "对称", "transitive": "传递",
    "functional": "函数性", "inverse_functional": "反函数性",
}


def _build_ontology_summary(data) -> str:
    lines = []
    lines.append(f"概念（{len(data.concepts)}个）:")
    for c in data.concepts:
        lines.append(f"  - {c.name}（{c.display_name or ''}）: {c.description or ''}")
        for a in (c.attributes or []):
            lines.append(f"    属性: {a.name} ({a.type}) 展示名={a.display_name or '-'} 约束={_fmt_constraint(a.constraint)}")
    lines.append(f"\n关系（{len(data.relations)}个）:")
    for r in data.relations:
        link = f", 关联: {r.source}.{r.source_attr} = {r.target}.{r.target_attr}" if r.source_attr and r.target_attr else ""
        # relation_type（2026-10-02 起纳入摘要）：此前缺失导致重生成 skill 时类型信息丢失
        rtypes = "、".join(_RELATION_TYPE_LABELS.get(t, t) for t in (r.relation_type or []))
        type_txt = f", 类型: {rtypes}" if rtypes else ""
        lines.append(f"  - {r.name}（{r.display_name or ''}）: {r.source} -> {r.target} ({r.cardinality}{link}{type_txt}) {r.description or ''}")
    lines.append(f"\n行为（{len(data.behaviors)}个）:")
    for b in data.behaviors:
        lines.append(f"  - {b.name}（{b.display_name or ''}）: {b.description or ''}")
        lines.append(f"    params: {json.dumps(b.params, ensure_ascii=False, default=str)}")
        lines.append(f"    response: {json.dumps(b.response, ensure_ascii=False, default=str)}")
    lines.append(f"\n流程（{len(data.processes)}个）:")
    for p in data.processes:
        lines.append(f"  - {p.name}（{p.display_name or ''}）: {p.goal or ''}")
        for step in (p.steps or []):
            lines.append(f"    step: {step.current_action}（{step.description or ''}）衔接={step.connection_type}")
    # 函数/规则/安全管控不进摘要：技能模板已不含这些章节，喂给生成 LLM 只会浪费 token 并诱使补章节
    return "\n".join(lines)


def _validate_generated_skill(content: str) -> str:
    """生成结果硬校验。返回错误信息；空字符串 = 通过。
    要求：① 头部必须是 YAML frontmatter（--- 包裹）；② 必须含 name（英文）和 description；
    ③ 正文不得有额外 frontmatter 块或对话性残留（如"好的/以下是/我将…"开头）。
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


@router.post("/{skill_name}/generate")
async def generate_skill(ontology_id: int, skill_name: str, body: dict = Body(default={})):
    if not re.match(r"^[a-z0-9]([a-z0-9-]*[a-z0-9])?$", skill_name) or len(skill_name) > 64:
        raise HTTPException(status_code=400, detail="技能名称必须为小写字母/数字/连字符，1-64字符")
    if "claude" in skill_name.lower() or "anthropic" in skill_name.lower():
        raise HTTPException(status_code=400, detail="技能名称包含保留字")
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)
    description = str(body.get("description", "") or "")

    if not fs_store.exists(SKILL_TEMPLATE_PATH):
        raise HTTPException(status_code=500, detail="技能模板文件不存在")
    skill_template = fs_store.read_text(SKILL_TEMPLATE_PATH)
    ontology_summary = _build_ontology_summary(data)

    from config import SKILL_GENERATE_SYSTEM_PROMPT, SKILL_GENERATE_PROMPT

    scenario = get_scenario_by_name(sc_name)
    scenario_id = scenario.get("id", "") if scenario else ""

    prompt = SKILL_GENERATE_PROMPT.format(
        ontology_name=on_name,
        ontology_id=str(ontology_id),
        scenario_name=sc_name,
        scenario_id=str(scenario_id),
        ontology_yaml=ontology_summary,
        skill_template=skill_template,
        skill_name=skill_name,
    )

    try:
        content, _ = await llm_text(SKILL_GENERATE_SYSTEM_PROMPT, prompt, 0.3)
        if content is None:
            raise HTTPException(status_code=400, detail="未配置 LLM API Key")

        # Strip leading conversational text only if content doesn't start with --- (YAML frontmatter)
        if not content.startswith("---"):
            first_hr = content.find("\n---\n")
            if first_hr > 0 and content[:first_hr].count('\n') < 5:
                content = content[first_hr + 1:].strip()
            else:
                first_h1 = content.find("\n# ")
                if first_h1 > 0 and content[:first_h1].count('\n') < 5 and not content.startswith("#"):
                    content = content[first_h1 + 1:].strip()

        # 硬校验：frontmatter 必须含 name/description，正文无多余内容。不合格则不落盘，报错让前端重试。
        check_error = _validate_generated_skill(content)
        if check_error:
            logger.warning("技能 %s 生成结果校验失败: %s", skill_name, check_error)
            raise HTTPException(status_code=400, detail=f"生成结果不符合模板要求：{check_error}，请重新生成")

        # 描述单一来源 = SKILL.md frontmatter：用户填了"技能简介"就用它覆盖模型写的 description
        #（此前只写进 meta.json：既不进 prompt 也不进 SKILL.md，agent 完全看不到；且列表读 meta.json、
        # agent 读 frontmatter，两处可能不一致）
        if description.strip():
            content = _with_skill_description(content, description.strip()) or content

        sdir = _skill_dir(sc_name, on_name, skill_name)
        fs_store.write_text(sdir / "SKILL.md", content)

        return {"message": "技能已生成", "skill_name": skill_name, "content": content}
    except (HTTPException, DomainError):
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"技能生成失败: {str(e)}")