"""CRUD API for events within an ontology."""

from fastapi import APIRouter, HTTPException

from dependencies import get_ontology_names
from schemas import EventItem
from services import load_ontology_data, save_ontology_data
from services.entity_crud import ensure_unique, find_index

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

    ensure_unique(data.events, item.name, "事件")

    data.events.append(item)
    save_ontology_data(sc_name, on_name, data)
    return item


@router.put("/{event_name}")
async def update_event(ontology_id: int, event_name: str, item: EventItem):
    """Update an event."""
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)

    idx = find_index(data.events, event_name, "事件")
    ensure_unique(data.events, item.name, "事件", exclude_name=event_name)

    data.events[idx] = item
    save_ontology_data(sc_name, on_name, data)
    return item


@router.delete("/{event_name}")
async def delete_event(ontology_id: int, event_name: str):
    sc_name, on_name = await get_ontology_names(ontology_id)
    data = load_ontology_data(sc_name, on_name)

    idx = find_index(data.events, event_name, "事件")

    data.events.pop(idx)
    save_ontology_data(sc_name, on_name, data)
    return {"message": "事件已删除"}
