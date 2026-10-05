"""技能管理 API —— CRUD + LLM 生成。

分层（章程 II）：本模块为接口层，只做参数接收、编排与响应组装；
技能文件的读写经业务层 ``services.skill_store``（该领域唯一存储出口），
本体摘要经 ``services.ontology_summary``（纯函数），注册表查询经 ``services.ontology_registry``。
"""

import logging
import re

from fastapi import APIRouter, Body

from errors import DomainError, InternalError, InvalidInputError
from dependencies import get_ontology_names
from services import load_ontology_data, ontology_registry, ontology_summary, skill_store
from llm_utils import load_env, llm_text

router = APIRouter(prefix="/api/ontologies/{ontology_id}/skills", tags=["技能"])
logger = logging.getLogger(__name__)

load_env()


# ─── List Skills ───────────────────────────────────────────────────────────

@router.get("")
async def list_skills(ontology_id: int):
    """技能列表：description 取自 SKILL.md frontmatter（不再读技能级 meta.json）。"""
    sc_name, on_name = await get_ontology_names(ontology_id)
    return skill_store.list_skills(sc_name, on_name)


# ─── Get Skill Content ─────────────────────────────────────────────────────

@router.get("/{skill_name}/content")
async def get_skill_content(ontology_id: int, skill_name: str):
    sc_name, on_name = await get_ontology_names(ontology_id)
    return {"content": skill_store.read_skill_md(sc_name, on_name, skill_name), "skill_name": skill_name}


# ─── Save Skill Content ────────────────────────────────────────────────────

@router.put("/{skill_name}/content")
async def save_skill_content(ontology_id: int, skill_name: str, body: dict):
    sc_name, on_name = await get_ontology_names(ontology_id)
    skill_store.write_skill_md(sc_name, on_name, skill_name, body.get("content", ""))
    return {"message": "技能文件已保存"}


# ─── Delete Skill ───────────────────────────────────────────────────────────

@router.delete("/{skill_name}")
async def delete_skill(ontology_id: int, skill_name: str):
    sc_name, on_name = await get_ontology_names(ontology_id)
    skill_store.delete_skill(sc_name, on_name, skill_name)
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
    ok = skill_store.rewrite_description(
        sc_name, on_name, skill_name, str(body.get("description", "") or ""))
    if not ok:
        raise InvalidInputError("SKILL.md 头部 frontmatter 不合法，无法更新描述")
    return {"message": "技能已更新"}


# ─── Generate Skill ─────────────────────────────────────────────────────────

@router.post("/{skill_name}/generate")
async def generate_skill(ontology_id: int, skill_name: str, body: dict = Body(default={})):
    if not re.match(r"^[a-z0-9]([a-z0-9-]*[a-z0-9])?$", skill_name) or len(skill_name) > 64:
        raise InvalidInputError("技能名称必须为小写字母/数字/连字符，1-64字符")
    if "claude" in skill_name.lower() or "anthropic" in skill_name.lower():
        raise InvalidInputError("技能名称包含保留字")

    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)
    description = str(body.get("description", "") or "")

    skill_template = skill_store.read_skill_template()
    ontology_yaml = ontology_summary.build(data)

    from config import SKILL_GENERATE_SYSTEM_PROMPT, SKILL_GENERATE_PROMPT

    scenario = ontology_registry.scenario_by_name(sc_name)
    scenario_id = scenario.get("id", "") if scenario else ""

    prompt = SKILL_GENERATE_PROMPT.format(
        ontology_name=on_name,
        ontology_id=str(ontology_id),
        scenario_name=sc_name,
        scenario_id=str(scenario_id),
        ontology_yaml=ontology_yaml,
        skill_template=skill_template,
        skill_name=skill_name,
    )

    try:
        content, _ = await llm_text(SKILL_GENERATE_SYSTEM_PROMPT, prompt, 0.3)
        if content is None:
            raise InvalidInputError("未配置 LLM API Key")

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
        check_error = skill_store.validate_generated_skill(content)
        if check_error:
            logger.warning("技能 %s 生成结果校验失败: %s", skill_name, check_error)
            raise InvalidInputError(f"生成结果不符合模板要求：{check_error}，请重新生成")

        # 描述单一来源 = SKILL.md frontmatter：用户填了"技能简介"就用它覆盖模型写的 description
        if description.strip():
            content = skill_store.with_description(content, description.strip()) or content

        skill_store.write_skill_md(sc_name, on_name, skill_name, content)

        return {"message": "技能已生成", "skill_name": skill_name, "content": content}
    except DomainError:
        raise
    except Exception as e:
        raise InternalError(f"技能生成失败: {str(e)}")
