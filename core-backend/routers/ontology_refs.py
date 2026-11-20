"""存量本体引用 API（spec 010）—— 候选清单与创建前预检。

分层（章程 II）：本模块只做参数接收与响应组装；
提取 / 渲染 / 冲突 / 体量的唯一实现在 ``services.ontology_refs``，
取数一律经 services（不 import ``repositories``）。
"""

from fastapi import APIRouter

from services import ontology_refs

router = APIRouter(prefix="/api/ontology-refs", tags=["本体引用"])

# 预检响应对外只暴露这五个字段（契约 contracts/ontology-refs.md A.2）
_PRECHECK_FIELDS = ("allowed", "max_tokens", "token_estimate", "conflicts", "reason")


@router.get("/candidates")
async def list_candidates(exclude_scenario: str = "", exclude_ontology: str = ""):
    """可引用的存量本体清单（含 `referenceable` 与置灰原因）。

    ``exclude_*`` 用于排除当前对话所属本体（避免自我引用）；二者仅给其一时忽略。
    """
    return ontology_refs.list_candidates(exclude_scenario, exclude_ontology)


@router.post("/precheck")
async def precheck(body: dict):
    """创建前预检：冲突清单 + 体量估算。**纯计算，不落盘。**"""
    result = ontology_refs.build_snapshot(body.get("refs"))
    return {key: result[key] for key in _PRECHECK_FIELDS}
