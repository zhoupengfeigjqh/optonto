"""API for DB schema file upload and retrieval."""

from pathlib import Path

from fastapi import APIRouter, HTTPException, UploadFile, File

from dependencies import get_ontology_names
from services import _get_ontology_dir

router = APIRouter(prefix="/api/ontologies/{ontology_id}/db-schema", tags=["DB Schema"])


def _schema_path(sc_name: str, on_name: str) -> Path:
    dir_path = _get_ontology_dir(sc_name, on_name) / "db_schema"
    dir_path.mkdir(parents=True, exist_ok=True)
    return dir_path / "db_schema.md"


@router.get("")
async def get_db_schema(ontology_id: int):
    """Read the db_schema.md content."""
    sc_name, on_name = await get_ontology_names(ontology_id)
    path = _schema_path(sc_name, on_name)
    if not path.exists():
        return {"content": "", "exists": False}
    content = path.read_text(encoding="utf-8")
    return {"content": content, "exists": True}


@router.post("")
async def upload_db_schema(ontology_id: int, file: UploadFile = File(...)):
    """Upload a markdown file as db_schema.md (overwrites existing)."""
    sc_name, on_name = await get_ontology_names(ontology_id)
    if not file.filename or not file.filename.lower().endswith(".md"):
        raise HTTPException(status_code=400, detail="仅接受 .md 格式文件")
    content = await file.read()
    path = _schema_path(sc_name, on_name)
    path.write_bytes(content)
    return {"message": "Schema 已上传", "filename": "db_schema.md"}
