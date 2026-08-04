"""Shared dependencies for routers — file-based metadata layer."""

from fastapi import HTTPException

from metadata import get_ontology_name_by_id


async def get_ontology_names(ontology_id: int):
    """Resolve ontology_id to (scenario_name, ontology_name) via file metadata."""
    result = get_ontology_name_by_id(ontology_id)
    if not result:
        raise HTTPException(status_code=404, detail="本体不存在")
    return result
