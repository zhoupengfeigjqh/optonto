"""CRUD API for concepts within an ontology."""

from fastapi import APIRouter, HTTPException

from dependencies import get_ontology_names
from schemas import ConceptItem, AttributeItem
from services import load_ontology_data, save_ontology_data

router = APIRouter(prefix="/api/ontologies/{ontology_id}/concepts", tags=["概念"])


@router.get("")
async def list_concepts(ontology_id: int):
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)
    return data.concepts


@router.put("/{concept_name}/attributes")
async def update_attributes(ontology_id: int, concept_name: str, attributes: list[dict]):
    """Update the attribute list of a concept."""
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)

    concept = next((c for c in data.concepts if c.name == concept_name), None)
    if not concept:
        raise HTTPException(status_code=404, detail="概念不存在")

    concept.attributes = [AttributeItem(**a) for a in attributes]
    save_ontology_data(sc_name, on_name, data)
    return concept.attributes


@router.put("/{concept_name}")
async def update_concept(ontology_id: int, concept_name: str, item: ConceptItem):
    """Update a concept."""
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)

    idx = next((i for i, c in enumerate(data.concepts) if c.name == concept_name), -1)
    if idx == -1:
        raise HTTPException(status_code=404, detail="概念不存在")

    if item.name != concept_name and any(c.name == item.name for c in data.concepts):
        raise HTTPException(status_code=400, detail="概念名称已存在")

    data.concepts[idx] = item
    save_ontology_data(sc_name, on_name, data)
    return item


@router.post("", status_code=201)
async def create_concept(ontology_id: int, item: ConceptItem):
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)

    if any(c.name == item.name for c in data.concepts):
        raise HTTPException(status_code=400, detail="概念名称已存在")

    data.concepts.append(item)
    save_ontology_data(sc_name, on_name, data)
    return item


@router.delete("/{concept_name}")
async def delete_concept(ontology_id: int, concept_name: str):
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)

    idx = next((i for i, c in enumerate(data.concepts) if c.name == concept_name), -1)
    if idx == -1:
        raise HTTPException(status_code=404, detail="概念不存在")

    data.concepts.pop(idx)

    # Remove from relations that reference this concept
    data.relations = [
        r for r in data.relations
        if r.source != concept_name and r.target != concept_name
    ]
    # Remove from related_concepts in behaviors and rules
    for b in data.behaviors:
        if concept_name in b.related_concepts:
            b.related_concepts.remove(concept_name)
    for r in data.rules:
        if concept_name in r.related_concepts:
            r.related_concepts.remove(concept_name)

    save_ontology_data(sc_name, on_name, data)
    return {"message": "概念已删除"}
