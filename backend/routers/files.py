"""File browser API for editing YAML files."""

from fastapi import APIRouter, HTTPException

from dependencies import get_ontology_names
from schemas import YamlFileOut
from services import read_yaml_raw, write_yaml_raw, list_ontology_yaml_files

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
        raise HTTPException(status_code=404, detail="文件不存在")
    return YamlFileOut(path=f"{sc_name}/{on_name}/{filename}", content=content)


@router.put("/content")
async def save_file_content(ontology_id: int, data: YamlFileOut):
    """Write raw YAML content to file and sync to backend state."""
    sc_name, on_name = await get_ontology_names(ontology_id)
    write_yaml_raw(sc_name, on_name, data.content)
    return {"message": "文件已保存"}
