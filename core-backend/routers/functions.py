"""本体函数 CRUD 与代码管理 API。

代码文件存放于 ``onto_market/{scenario}/{ontology}/functions/{函数名}.py``；
统一入口约定（2026-09-05 起，与公共函数一致）：``def run(params: dict) -> dict``；
保存/生成写盘前经 ``services.validators.validate_function_code`` 静态校验。

分层（章程 II）：本模块为接口层，只做参数接收与响应组装；
函数代码读写经 ``services.function_store``，注册表查询经 ``services.ontology_registry``。
"""

import json

from fastapi import APIRouter

from errors import ConflictError, DomainError, InternalError, InvalidInputError, NotFoundError

from dependencies import get_ontology_names
from schemas import FunctionItem
from services import function_store, load_ontology_data, ontology_registry, save_ontology_data
from services.entity_crud import ensure_unique, find_index
from services.function_catalog import common_function_names
from services.validators import validate_function_code, validate_function_concepts
from llm_utils import load_env, llm_text

router = APIRouter(prefix="/api/ontologies/{ontology_id}/functions", tags=["函数"])


load_env()


# ─── 函数名全局唯一 ─────────────────────────────────────────────────────────────
# 本体函数注册为一等 MCP 工具后，工具名 = 函数名（与公共函数并列暴露给 LLM）。
# 因此函数名必须跨本体唯一，且不得与公共函数重名，否则 MCP 工具名冲突。
# 公共函数名清单口径唯一实现在 services/function_catalog（本处不再各自读一遍 json）。


def _ensure_global_unique(name: str, sc_name: str, on_name: str) -> None:
    """函数名跨本体 + 对公共函数 全局唯一校验（当前本体内的查重由 ensure_unique 负责）。"""
    if name in common_function_names():
        raise ConflictError(f"函数名「{name}」与公共函数重名，请更换函数名")
    for onto in ontology_registry.list_all_ontologies():
        sc = onto.get("scenario_name")
        on = onto.get("ontology_name")
        if not sc or not on:
            continue
        if sc == sc_name and on == on_name:
            continue  # 当前本体内查重由 ensure_unique 负责
        try:
            data = load_ontology_data(sc, on)
        except Exception:
            continue
        if any(fn.name == name for fn in data.functions):
            raise ConflictError(f"函数名「{name}」已存在于本体「{on}」（函数名需全局唯一）")


# ─── CRUD ─────────────────────────────────────────────────────────────────

@router.get("")
async def list_functions(ontology_id: int):
    sc_name, on_name = await get_ontology_names(ontology_id)
    return load_ontology_data(sc_name, on_name).functions


@router.post("", status_code=201)
async def create_function(ontology_id: int, item: FunctionItem):
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)

    ensure_unique(data.functions, item.name, "函数")
    _ensure_global_unique(item.name, sc_name, on_name)
    # 强耦合校验：关联概念必须存在（约束回溯的数据源）
    validate_function_concepts(item, data)

    data.functions.append(item)
    save_ontology_data(sc_name, on_name, data)
    return item


@router.put("/{function_name}")
async def update_function(ontology_id: int, function_name: str, item: FunctionItem):
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)

    idx = find_index(data.functions, function_name, "函数")
    ensure_unique(data.functions, item.name, "函数", exclude_name=function_name)
    _ensure_global_unique(item.name, sc_name, on_name)
    validate_function_concepts(item, data)

    data.functions[idx] = item
    save_ontology_data(sc_name, on_name, data)
    return item


@router.delete("/{function_name}")
async def delete_function(ontology_id: int, function_name: str):
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)

    idx = find_index(data.functions, function_name, "函数")

    # 连带删除代码文件（幂等）
    function_store.delete_code(sc_name, on_name, function_name)

    data.functions.pop(idx)
    save_ontology_data(sc_name, on_name, data)
    return {"message": "函数已删除"}


# ─── Code Read/Write ──────────────────────────────────────────────────────

@router.get("/{function_name}/code")
async def get_function_code(ontology_id: int, function_name: str):
    """读取函数代码（含是否存在）。"""
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)

    fn = next((g for g in data.functions if g.name == function_name), None)
    if fn is None:
        raise NotFoundError("函数不存在")

    content, exists = function_store.read_code(sc_name, on_name, function_name)
    return {"content": content, "exists": exists, "code_file": fn.code_file}


@router.put("/{function_name}/code")
async def save_function_code(ontology_id: int, function_name: str, body: dict):
    """保存函数代码并同步 code_file 引用（入口静态校验不通过则不落盘）。"""
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)

    idx = next((i for i, g in enumerate(data.functions) if g.name == function_name), -1)
    if idx == -1:
        raise NotFoundError("函数不存在")

    code = body.get("code", "")
    err = validate_function_code(code)
    if err:
        raise InvalidInputError(f"函数代码校验未通过: {err}")
    function_store.write_code(sc_name, on_name, function_name, code)

    # Update code_file reference in YAML
    data.functions[idx].code_file = f"functions/{function_name}.py"
    save_ontology_data(sc_name, on_name, data)

    return {"message": "代码已保存", "code_file": data.functions[idx].code_file}


# ─── Generate Code ─────────────────────────────────────────────────────────

@router.post("/{function_name}/generate-code")
async def generate_function_code(ontology_id: int, function_name: str):
    """用 LLM 生成 Python 代码并落盘（生成物过同一道入口校验，不合格不落地）。"""
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)

    fn = next((g for g in data.functions if g.name == function_name), None)
    if fn is None:
        raise NotFoundError("函数不存在")

    from config import FUNCTION_CODE_SYSTEM_PROMPT, FUNCTION_CODE_PROMPT

    prompt = FUNCTION_CODE_PROMPT.format(
        name=fn.name,
        description=fn.description or "（无描述）",
        params=json.dumps(fn.params, ensure_ascii=False, indent=2),
        response=json.dumps(fn.response, ensure_ascii=False, indent=2),
    )

    try:
        code, _ = await llm_text(FUNCTION_CODE_SYSTEM_PROMPT, prompt, 0.3)
        if code is None:
            raise InvalidInputError("未配置 LLM API Key，无法智能生成代码")

        # 提示词已要求 run 形态，此处兜底硬校验
        err = validate_function_code(code)
        if err:
            raise InternalError(f"生成的代码未通过入口校验: {err}")

        function_store.write_code(sc_name, on_name, function_name, code)

        # Update code_file reference in YAML
        data.functions[data.functions.index(fn)].code_file = f"functions/{function_name}.py"
        save_ontology_data(sc_name, on_name, data)

        return {"code": code, "code_file": f"functions/{function_name}.py"}
    except DomainError:
        raise
    except Exception as e:
        raise InternalError(f"代码生成失败: {str(e)}")


# ─── Execute Code ──────────────────────────────────────────────────────────

@router.post("/{function_name}/execute")
async def execute_function(ontology_id: int, function_name: str, body: dict):
    """执行函数代码 —— 降级转发本体函数执行服务（core 执行归零）。

    统一入口约定（与公共函数一致）：def run(params: dict) -> dict，整包传参；
    返回值已由执行器出口归一为统一信封 {"success", "data", "error"}（读时兼容旧式 {"result": ...}），透传返回。
    """
    from services.runtime_forward import ONTOLOGY_FUNCTION_EXECUTOR_URL, forward_call
    return await forward_call(
        ONTOLOGY_FUNCTION_EXECUTOR_URL, "/execute-function",
        {"ontology_id": ontology_id, "function_name": function_name, "params": body.get("params", {})},
        "ontology-mcp",
    )
