"""需求线程 API（本体需求链路）—— 对话记录与需求文档。

分层（章程 II）：本模块为接口层，只做参数接收与响应组装；
所有文件读写与领域规则经业务层 ``services.thread_store``（该领域唯一存储出口），
**不直连 repositories**，也不再从其他 router 借私有函数。
"""

from fastapi import APIRouter, Body

from services import thread_store

router = APIRouter(prefix="/api/threads", tags=["对话管理"])


@router.get("/ontology-template/sections")
async def list_ontology_template_sections():
    """返回本体模板的一级目录名，供「本体生成」勾选模板加载范围。

    动态解析而非前端硬编码：模板增删节时前端选项自动同步。
    """
    return {"sections": thread_store.template_sections()}


@router.get("")
async def list_threads(scenario: str = "", ontology: str = ""):
    """列出线程（可按场景/本体过滤）。"""
    return thread_store.list_threads(scenario, ontology)


@router.post("", status_code=201)
async def create_thread(body: dict):
    """在指定本体下新建对话线程。"""
    return thread_store.create_thread(
        title=body.get("title", "新对话"),
        scenario_name=body.get("scenario_name", ""),
        ontology_name=body.get("ontology_name", ""),
        version=body.get("version", ""),
    )


@router.get("/{thread_id}")
async def get_thread(thread_id: str, scenario: str = "", ontology: str = ""):
    """线程详情（含全部消息）；给定场景/本体时校验归属。"""
    return thread_store.get_thread(thread_id, scenario, ontology)


@router.delete("/{thread_id}")
async def delete_thread(thread_id: str):
    """删除线程目录及其全部内容。"""
    thread_store.delete_thread_dir(thread_id)
    return {"message": "对话已删除"}


@router.put("/{thread_id}")
async def update_thread(thread_id: str, body: dict = Body(default={})):
    """更新线程标题或状态。"""
    return thread_store.update_thread(
        thread_id,
        title=body.get("title") if body.get("title") is not None else None,
        status=body.get("status") if body.get("status") is not None else None,
    )


@router.get("/requirements/list")
async def list_requirements(scenario: str = "", ontology: str = ""):
    """跨线程扫描需求文档；``has_ontology`` 为实时推导（同名 yaml 或 metadata.source_file 命中）。"""
    return thread_store.list_requirements(scenario, ontology)


@router.get("/{thread_id}/requirements/{filename}")
async def get_requirement_file(thread_id: str, filename: str, scenario: str = "", ontology: str = ""):
    """读取需求文档内容。"""
    return thread_store.get_requirement_file(thread_id, filename)


@router.put("/{thread_id}/requirements/{filename}")
async def save_requirement_file(thread_id: str, filename: str, body: dict):
    """保存/覆盖需求文档。"""
    thread_store.save_requirement_file(thread_id, filename, body.get("content", ""))
    return {"message": "文件已保存"}


@router.delete("/{thread_id}/requirements/{filename}")
async def delete_requirement_file(thread_id: str, filename: str):
    """删除需求文档及其生成的同名本体分片 yaml（若存在）。"""
    thread_store.delete_requirement_file(thread_id, filename)
    return {"message": "文件已删除"}
