"""CRUD API for events within an ontology."""

from fastapi import APIRouter, HTTPException

from dependencies import get_ontology_names
from schemas import EventItem
from services import load_ontology_data, save_ontology_data

router = APIRouter(prefix="/api/ontologies/{ontology_id}/events", tags=["事件"])


@router.get("")
async def list_events(ontology_id: int):
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)
    return data.events


@router.post("", status_code=201)
async def create_event(ontology_id: int, item: EventItem):
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)

    if any(e.name == item.name for e in data.events):
        raise HTTPException(status_code=400, detail="事件名称已存在")

    data.events.append(item)
    save_ontology_data(sc_name, on_name, data)
    return item


@router.put("/{event_name}")
async def update_event(ontology_id: int, event_name: str, item: EventItem):
    """Update an event."""
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)

    idx = next((i for i, e in enumerate(data.events) if e.name == event_name), -1)
    if idx == -1:
        raise HTTPException(status_code=404, detail="事件不存在")

    if item.name != event_name and any(e.name == item.name for e in data.events):
        raise HTTPException(status_code=400, detail="事件名称已存在")

    data.events[idx] = item
    save_ontology_data(sc_name, on_name, data)
    return item


@router.delete("/{event_name}")
async def delete_event(ontology_id: int, event_name: str):
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)

    idx = next((i for i, e in enumerate(data.events) if e.name == event_name), -1)
    if idx == -1:
        raise HTTPException(status_code=404, detail="事件不存在")

    data.events.pop(idx)
    save_ontology_data(sc_name, on_name, data)
    return {"message": "事件已删除"}
