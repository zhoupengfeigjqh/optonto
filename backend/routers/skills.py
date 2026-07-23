"""API for skill management — CRUD + LLM generation."""

import json
import os
from pathlib import Path

from fastapi import APIRouter, HTTPException

from dependencies import get_ontology_names
from metadata import get_scenario_by_name
from services import load_ontology_data, _get_ontology_dir

router = APIRouter(prefix="/api/ontologies/{ontology_id}/skills", tags=["技能"])

try:
    from dotenv import load_dotenv
    env_path = Path(__file__).resolve().parent.parent.parent / "config" / ".env"
    if env_path.exists():
        load_dotenv(env_path)
except ImportError:
    pass

try:
    from langchain_openai import ChatOpenAI
except ImportError:
    ChatOpenAI = None


def _build_llm():
    if ChatOpenAI is None:
        return None
    api_key = os.environ.get("LLM_API_KEY") or os.environ.get("DEEPSEEK_API_KEY") or ""
    api_url = os.environ.get("LLM_API_URL", "https://api.deepseek.com")
    model = os.environ.get("LLM_MODEL", "deepseek-chat")
    if not api_key:
        return None
    return ChatOpenAI(
        model=model, openai_api_key=api_key, openai_api_base=api_url,
        temperature=0.3, streaming=False,
    )


SKILL_TEMPLATE_PATH = Path(__file__).resolve().parent.parent.parent / "backend" / ".data" / "skill_template.md"


def _skills_dir(sc_name: str, on_name: str) -> Path:
    return _get_ontology_dir(sc_name, on_name) / "skills"


def _skill_dir(sc_name: str, on_name: str, skill_name: str) -> Path:
    return _skills_dir(sc_name, on_name) / skill_name


def _skill_md_path(sc_name: str, on_name: str, skill_name: str) -> Path:
    return _skill_dir(sc_name, on_name, skill_name) / "SKILL.md"


# ─── List Skills ───────────────────────────────────────────────────────────

@router.get("")
async def list_skills(ontology_id: int):
    sc_name, on_name = await get_ontology_names(ontology_id)
    skills_dir = _skills_dir(sc_name, on_name)
    if not skills_dir.exists():
        return []
    items = []
    for d in sorted(skills_dir.iterdir()):
        if not d.is_dir():
            continue
        md_path = d / "SKILL.md"
        format_ok = False
        if md_path.exists():
            head = md_path.read_text(encoding="utf-8")[:300]
            import re
            has_name_en = bool(re.search(r"\nname: [a-zA-Z]", head))
            has_desc = "\ndescription:" in head
            format_ok = head.startswith("---\n") and has_name_en and has_desc
        desc = ""
        meta_path = d / "meta.json"
        if meta_path.exists():
            try:
                with open(meta_path, encoding="utf-8") as mf:
                    desc = json.load(mf).get("description", "")
            except:
                pass
        format_error = ""
        if md_path.exists() and not format_ok:
            if not head.startswith("---\n"):
                format_error = "文件头部缺少 ---"
            elif not has_name_en:
                format_error = "name 必须为英文"
            elif not has_desc:
                format_error = "缺少 description"
        items.append({
            "name": d.name, "has_skill": md_path.exists(), "format_ok": format_ok,
            "format_error": format_error,
            "description": desc,
            "updated_at": md_path.stat().st_mtime if md_path.exists() else d.stat().st_mtime,
        })
    return items


# ─── Get Skill Content ─────────────────────────────────────────────────────

@router.get("/{skill_name}/content")
async def get_skill_content(ontology_id: int, skill_name: str):
    sc_name, on_name = await get_ontology_names(ontology_id)
    md_path = _skill_md_path(sc_name, on_name, skill_name)
    if not md_path.exists():
        raise HTTPException(status_code=404, detail="技能文件不存在")
    content = md_path.read_text(encoding="utf-8")
    return {"content": content, "skill_name": skill_name}


# ─── Save Skill Content ────────────────────────────────────────────────────

@router.put("/{skill_name}/content")
async def save_skill_content(ontology_id: int, skill_name: str, body: dict):
    sc_name, on_name = await get_ontology_names(ontology_id)
    sdir = _skill_dir(sc_name, on_name, skill_name)
    sdir.mkdir(parents=True, exist_ok=True)
    (_skill_dir(sc_name, on_name, skill_name) / "SKILL.md").write_text(body.get("content", ""), encoding="utf-8")
    return {"message": "技能文件已保存"}


# ─── Delete Skill ───────────────────────────────────────────────────────────

@router.delete("/{skill_name}")
async def delete_skill(ontology_id: int, skill_name: str):
    sc_name, on_name = await get_ontology_names(ontology_id)
    sdir = _skill_dir(sc_name, on_name, skill_name)
    if not sdir.exists():
        raise HTTPException(status_code=404, detail="技能不存在")
    import shutil
    shutil.rmtree(sdir)
    return {"message": "技能已删除"}


# ─── Update Skill Meta ───────────────────────────────────────────────────────

@router.put("/{skill_name}/meta")
async def update_skill_meta(ontology_id: int, skill_name: str, body: dict):
    """Update skill name and/or description."""
    sc_name, on_name = await get_ontology_names(ontology_id)
    sdir = _skill_dir(sc_name, on_name, skill_name)
    if not sdir.exists():
        raise HTTPException(status_code=404, detail="技能不存在")

    new_name = body.get("name", skill_name)
    new_desc = body.get("description", "")

    # Update meta.json
    meta_path = sdir / "meta.json"
    meta = {"name": new_name, "description": new_desc}
    if meta_path.exists():
        try:
            with open(meta_path, encoding="utf-8") as f:
                existing = json.load(f)
                existing.update(meta)
                meta = existing
        except:
            pass
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    # Rename directory if name changed
    if new_name != skill_name:
        new_dir = _skill_dir(sc_name, on_name, new_name)
        if new_dir.exists():
            raise HTTPException(status_code=400, detail="技能名称已存在")
        sdir.rename(new_dir)

    return {"message": "技能已更新"}


# ─── Generate Skill ─────────────────────────────────────────────────────────

def _build_ontology_summary(data) -> str:
    lines = []
    lines.append(f"概念（{len(data.concepts)}个）:")
    for c in data.concepts:
        attr_str = ", ".join(f"{a.name} ({a.type})" for a in (c.attributes or []))
        lines.append(f"  - {c.name}（{c.display_name or ''}）: {attr_str}")
    lines.append(f"\n关系（{len(data.relations)}个）:")
    for r in data.relations:
        lines.append(f"  - {r.name}: {r.source} -> {r.target} ({r.cardinality})")
    lines.append(f"\n行为（{len(data.behaviors)}个）:")
    for b in data.behaviors:
        lines.append(f"  - {b.name}（{b.display_name or ''}）: {b.description or ''}")
        lines.append(f"    params: {json.dumps(b.params, ensure_ascii=False, default=str)}")
        lines.append(f"    response: {json.dumps(b.response, ensure_ascii=False, default=str)}")
    lines.append(f"\n函数（{len(data.functions)}个）:")
    for f in data.functions:
        lines.append(f"  - {f.name}（{f.display_name or ''}）: {f.description or ''}")
        lines.append(f"    params: {json.dumps(f.params, ensure_ascii=False, default=str)}")
        lines.append(f"    response: {json.dumps(f.response, ensure_ascii=False, default=str)}")
    lines.append(f"\n规则（{len(data.rules)}个）:")
    for r in data.rules:
        lines.append(f"  - {r.name}（{r.display_name or ''}）: {r.description or ''} type={r.rule_type} pos={r.position}")
        if r.rule_detail:
            lines.append(f"    rule_detail: {json.dumps(r.rule_detail, ensure_ascii=False, default=str)}")
    lines.append(f"\n流程（{len(data.processes)}个）:")
    for p in data.processes:
        lines.append(f"  - {p.name}（{p.display_name or ''}）: {p.goal or ''}")
        for step in (p.steps or []):
            lines.append(f"    step: {step.current_action}（{step.description or ''}）衔接={step.connection_type}")
    lines.append(f"\n安全管控（{len(data.securities)}个）:")
    for s in data.securities:
        lines.append(f"  - {s.action_name}: {s.audit_node} - {s.audit_content}")
    return "\n".join(lines)


@router.post("/{skill_name}/generate")
async def generate_skill(ontology_id: int, skill_name: str, body: dict = {}):
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)
    description = body.get("description", "")

    if not SKILL_TEMPLATE_PATH.exists():
        raise HTTPException(status_code=500, detail="技能模板文件不存在")
    skill_template = SKILL_TEMPLATE_PATH.read_text(encoding="utf-8")
    ontology_summary = _build_ontology_summary(data)

    llm = _build_llm()
    if llm is None:
        raise HTTPException(status_code=400, detail="未配置 LLM API Key")

    from langchain_core.messages import HumanMessage, SystemMessage
    from config import SKILL_GENERATE_SYSTEM_PROMPT, SKILL_GENERATE_PROMPT

    scenario = get_scenario_by_name(sc_name)
    scenario_id = scenario.get("id", "") if scenario else ""

    prompt = SKILL_GENERATE_PROMPT.format(
        onto_name=on_name,
        onto_id=str(ontology_id),
        scenario_name=sc_name,
        scenario_id=str(scenario_id),
        ontology_yaml=ontology_summary,
        skill_template=skill_template,
    )

    try:
        response = await llm.ainvoke([
            SystemMessage(content=SKILL_GENERATE_SYSTEM_PROMPT),
            HumanMessage(content=prompt),
        ])
        content = response.content.strip()
        if content.startswith("```"):
            content = content.split("\n", 1)[1] if "\n" in content else content[3:]
            if content.startswith("markdown"):
                content = content[8:].strip()
            content = content.rsplit("```", 1)[0].strip()

        first_hr = content.find("\n---\n")
        if first_hr > 0 and content[:first_hr].count('\n') < 5:
            content = content[first_hr + 1:].strip()
        elif not content.startswith("---"):
            first_h1 = content.find("\n# ")
            if first_h1 > 0 and content[:first_h1].count('\n') < 5 and not content.startswith("#"):
                content = content[first_h1 + 1:].strip()

        sdir = _skill_dir(sc_name, on_name, skill_name)
        sdir.mkdir(parents=True, exist_ok=True)

        meta_path = sdir / "meta.json"
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump({"name": skill_name, "description": description}, f, ensure_ascii=False, indent=2)

        md_path = sdir / "SKILL.md"
        md_path.write_text(content, encoding="utf-8")

        return {"message": "技能已生成", "skill_name": skill_name, "content": content}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"技能生成失败: {str(e)}")
