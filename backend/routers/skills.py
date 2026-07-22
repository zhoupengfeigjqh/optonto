"""API for skill management — CRUD + LLM generation."""

import json
import os
from pathlib import Path

from fastapi import APIRouter, HTTPException

from dependencies import get_ontology_names
from services import load_ontology_data, _get_ontology_dir

router = APIRouter(prefix="/api/ontologies/{ontology_id}/skills", tags=["技能"])


# ─── LLM setup ────────────────────────────────────────────────────────────

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
        model=model,
        openai_api_key=api_key,
        openai_api_base=api_url,
        temperature=0.3,
        streaming=False,
    )


SKILL_TEMPLATE_PATH = Path(__file__).resolve().parent.parent.parent / "backend" / ".data" / "skill_template.md"
DATA_DIR = Path(__file__).resolve().parent.parent.parent / "backend" / ".data"


def _skills_dir(sc_name: str, on_name: str) -> Path:
    return _get_ontology_dir(sc_name, on_name) / "skills"


def _skill_dir(sc_name: str, on_name: str, skill_name: str) -> Path:
    return _skills_dir(sc_name, on_name) / skill_name


def _skill_md_path(sc_name: str, on_name: str, skill_name: str) -> Path:
    return _skill_dir(sc_name, on_name, skill_name) / "SKILL.md"


# ─── List Skills ───────────────────────────────────────────────────────────

@router.get("")
async def list_skills(ontology_id: int):
    """List all skills for this ontology."""
    sc_name, on_name = await get_ontology_names(ontology_id)
    skills_dir = _skills_dir(sc_name, on_name)
    if not skills_dir.exists():
        return []
    items = []
    for d in sorted(skills_dir.iterdir()):
        if not d.is_dir():
            continue
        md_path = d / "SKILL.md"
        items.append({
            "name": d.name,
            "has_skill": md_path.exists(),
            "updated_at": md_path.stat().st_mtime if md_path.exists() else d.stat().st_mtime,
        })
    return items


# ─── Get Skill Content ─────────────────────────────────────────────────────

@router.get("/{skill_name}/content")
async def get_skill_content(ontology_id: int, skill_name: str):
    """Read SKILL.md content for a skill."""
    sc_name, on_name = await get_ontology_names(ontology_id)
    md_path = _skill_md_path(sc_name, on_name, skill_name)
    if not md_path.exists():
        raise HTTPException(status_code=404, detail="技能文件不存在")
    content = md_path.read_text(encoding="utf-8")
    return {"content": content, "skill_name": skill_name}


# ─── Save Skill Content ────────────────────────────────────────────────────

@router.put("/{skill_name}/content")
async def save_skill_content(ontology_id: int, skill_name: str, body: dict):
    """Save SKILL.md content."""
    sc_name, on_name = await get_ontology_names(ontology_id)
    sdir = _skill_dir(sc_name, on_name, skill_name)
    sdir.mkdir(parents=True, exist_ok=True)
    md_path = sdir / "SKILL.md"
    md_path.write_text(body.get("content", ""), encoding="utf-8")
    return {"message": "技能文件已保存"}


# ─── Delete Skill ───────────────────────────────────────────────────────────

@router.delete("/{skill_name}")
async def delete_skill(ontology_id: int, skill_name: str):
    """Delete a skill directory."""
    sc_name, on_name = await get_ontology_names(ontology_id)
    sdir = _skill_dir(sc_name, on_name, skill_name)
    if not sdir.exists():
        raise HTTPException(status_code=404, detail="技能不存在")
    import shutil
    shutil.rmtree(sdir)
    return {"message": "技能已删除"}


# ─── Generate Skill ─────────────────────────────────────────────────────────

@router.post("/{skill_name}/generate")
async def generate_skill(ontology_id: int, skill_name: str, body: dict = {}):
    """Use LLM to generate SKILL.md from ontology data + template."""
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)

    # Read template
    if not SKILL_TEMPLATE_PATH.exists():
        raise HTTPException(status_code=500, detail="技能模板文件不存在")
    skill_template = SKILL_TEMPLATE_PATH.read_text(encoding="utf-8")

    # Serialize ontology YAML data
    from schemas import OntologyData
    ontology_yaml_lines = []
    # Build a readable summary of the ontology
    ontology_yaml_lines.append(f"概念（{len(data.concepts)}个）:")
    for c in data.concepts:
        attr_str = ", ".join(f"{a.name} ({a.type})" for a in (c.attributes or []))
        ontology_yaml_lines.append(f"  - {c.name}（{c.display_name or ''}）: {attr_str}")

    ontology_yaml_lines.append(f"\n关系（{len(data.relations)}个）:")
    for r in data.relations:
        ontology_yaml_lines.append(f"  - {r.name}: {r.source} → {r.target} ({r.cardinality})")

    ontology_yaml_lines.append(f"\n行为（{len(data.behaviors)}个）:")
    for b in data.behaviors:
        ontology_yaml_lines.append(f"  - {b.name}（{b.display_name or ''}）: {b.description or ''}")
        ontology_yaml_lines.append(f"    params: {json.dumps(b.params, ensure_ascii=False, default=str)}")
        ontology_yaml_lines.append(f"    response: {json.dumps(b.response, ensure_ascii=False, default=str)}")

    ontology_yaml_lines.append(f"\n函数（{len(data.functions)}个）:")
    for f in data.functions:
        ontology_yaml_lines.append(f"  - {f.name}（{f.display_name or ''}）: {f.description or ''}")
        ontology_yaml_lines.append(f"    params: {json.dumps(f.params, ensure_ascii=False, default=str)}")
        ontology_yaml_lines.append(f"    response: {json.dumps(f.response, ensure_ascii=False, default=str)}")

    ontology_yaml_lines.append(f"\n规则（{len(data.rules)}个）:")
    for r in data.rules:
        ontology_yaml_lines.append(f"  - {r.name}（{r.display_name or ''}）: {r.description or ''} type={r.rule_type} pos={r.position}")
        if r.rule_detail:
            ontology_yaml_lines.append(f"    rule_detail: {json.dumps(r.rule_detail, ensure_ascii=False, default=str)}")

    ontology_yaml_lines.append(f"\n安全管控（{len(data.securities)}个）:")
    for s in data.securities:
        ontology_yaml_lines.append(f"  - {s.action_name}: {s.audit_node} - {s.audit_content}")

    ontology_yaml = "\n".join(ontology_yaml_lines)

    llm = _build_llm()
    if llm is None:
        raise HTTPException(status_code=400, detail="未配置 LLM API Key")

    from langchain_core.messages import HumanMessage, SystemMessage
    from config import SKILL_GENERATE_SYSTEM_PROMPT, SKILL_GENERATE_PROMPT

    sdir = _skill_dir(sc_name, on_name, skill_name)
    sdir.mkdir(parents=True, exist_ok=True)

    prompt = SKILL_GENERATE_PROMPT.format(
        ontology_name=f"{sc_name}/{on_name}",
        ontology_yaml=ontology_yaml,
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

        # Save SKILL.md
        md_path = sdir / "SKILL.md"
        md_path.write_text(content, encoding="utf-8")

        return {
            "message": "技能已生成",
            "skill_name": skill_name,
            "content": content,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"技能生成失败: {str(e)}")
