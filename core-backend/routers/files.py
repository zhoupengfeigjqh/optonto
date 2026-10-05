"""本体 YAML 文件浏览 / 原文编辑 API。

分层（章程 II）：本模块为接口层；YAML 原文读写经业务层 ``services``（本体领域存储出口），
**不直连 repositories**（mtime 等文件属性也由服务层给出）。
"""

from fastapi import APIRouter

from errors import NotFoundError

from dependencies import get_ontology_names
from schemas import YamlFileOut
from services import (
    list_ontology_yaml_files,
    ontology_yaml_updated_at,
    read_yaml_raw,
    write_yaml_raw,
)

router = APIRouter(prefix="/api/ontologies/{ontology_id}/files", tags=["文件"])


@router.get("")
async def list_files(ontology_id: int):
    """List all YAML files in the ontology directory."""
    sc_name, on_name = await get_ontology_names(ontology_id)
    return list_ontology_yaml_files(sc_name, on_name)


@router.get("/content", response_model=YamlFileOut)
async def get_file_content(ontology_id: int, filename: str = "ontology.yaml"):
    """Read a YAML file's raw content."""
    sc_name, on_name = await get_ontology_names(ontology_id)
    content = read_yaml_raw(sc_name, on_name)
    if content is None:
        raise NotFoundError("文件不存在")
    return YamlFileOut(
        path=f"{sc_name}/{on_name}/{filename}",
        content=content,
        updated_at=ontology_yaml_updated_at(sc_name, on_name),
    )


@router.put("/content")
async def save_file_content(ontology_id: int, data: YamlFileOut):
    """Write raw YAML content to file and sync to backend state."""
    sc_name, on_name = await get_ontology_names(ontology_id)
    write_yaml_raw(sc_name, on_name, data.content)
    return {"message": "文件已保存"}
