"""Thread/conversation management API — stored per-ontology under onto_market."""

import json
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException

from config import ONTO_MARKET_DIR
from services import load_ontology_data

router = APIRouter(prefix="/api/threads", tags=["对话管理"])


def _all_thread_dirs() -> list[Path]:
    """Scan all onto_market/*/*/threads/ directories and return (thread_dir, scenario, ontology) tuples."""
    results: list[tuple[Path, str, str]] = []
    if not ONTO_MARKET_DIR.exists():
        return results
    for scenario_dir in sorted(ONTO_MARKET_DIR.iterdir()):
        if not scenario_dir.is_dir():
            continue
        for ontology_dir in sorted(scenario_dir.iterdir()):
            if not ontology_dir.is_dir():
                continue
            threads_dir = ontology_dir / "threads"
            if not threads_dir.exists():
                continue
            for thread_dir in sorted(threads_dir.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
                if thread_dir.is_dir():
                    results.append((thread_dir, scenario_dir.name, ontology_dir.name))
    return results


def _thread_dir(scenario_name: str, ontology_name: str, thread_id: str) -> Path:
    """Get the directory for a specific thread under its ontology."""
    return ONTO_MARKET_DIR / scenario_name / ontology_name / "threads" / thread_id


def _thread_path(scenario_name: str, ontology_name: str, thread_id: str) -> Path:
    return _thread_dir(scenario_name, ontology_name, thread_id) / ".data.json"


def _find_thread(thread_id: str) -> tuple[Path, str, str]:
    """Find a thread directory by ID across all ontologies. Returns (thread_dir, scenario, ontology)."""
    for scenario_dir in ONTO_MARKET_DIR.iterdir():
        if not scenario_dir.is_dir():
            continue
        for ontology_dir in scenario_dir.iterdir():
            if not ontology_dir.is_dir():
                continue
            tdir = ontology_dir / "threads" / thread_id
            if tdir.exists():
                return tdir, scenario_dir.name, ontology_dir.name
    raise HTTPException(status_code=404, detail="对话不存在")


def _load_thread(thread_id: str) -> tuple[dict, str, str]:
    """Load thread data. Returns (data, scenario_name, ontology_name)."""
    tdir, sc, onto = _find_thread(thread_id)
    path = tdir / ".data.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="对话不存在")
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f), sc, onto


def _save_thread(data: dict) -> None:
    """Save thread data. Requires scenario_name and ontology_name in data."""
    sc = data.get("scenario_name", "")
    onto = data.get("ontology_name", "")
    if not sc or not onto:
        raise HTTPException(status_code=400, detail="缺少场景或本体名称")
    dir_path = _thread_dir(sc, onto, data["id"])
    dir_path.mkdir(parents=True, exist_ok=True)
    path = dir_path / ".data.json"
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def _get_thread_dir_from_data(thread_id: str, data: dict) -> Path:
    """Get thread directory from loaded data."""
    sc = data.get("scenario_name", "")
    onto = data.get("ontology_name", "")
    if sc and onto:
        return _thread_dir(sc, onto, thread_id)
    # fallback: find by scanning
    tdir, _, _ = _find_thread(thread_id)
    return tdir


# ─── API Endpoints ─────────────────────────────────────────────────────────────


@router.get("")
async def list_threads(scenario: str = "", ontology: str = ""):
    """List all threads, optionally filtered by scenario/ontology."""
    threads = []
    for tdir, sc_name, onto_name in _all_thread_dirs():
        if scenario and sc_name != scenario:
            continue
        if ontology and onto_name != ontology:
            continue
        data_path = tdir / ".data.json"
        if not data_path.exists():
            continue
        try:
            with open(data_path, "r", encoding="utf-8") as fp:
                data = json.load(fp)
            threads.append({
                "id": data["id"],
                "title": data.get("title", ""),
                "status": data.get("status", "exploring"),
                "created_at": data.get("created_at", ""),
                "updated_at": data.get("updated_at", ""),
                "scenario_name": sc_name,
                "ontology_name": onto_name,
            })
        except (json.JSONDecodeError, KeyError):
            continue
    threads.sort(key=lambda t: t["updated_at"], reverse=True)
    return threads


@router.post("", status_code=201)
async def create_thread(body: dict):
    """Create a new conversation thread within a specific ontology."""
    title = body.get("title", "新对话")
    scenario_name = body.get("scenario_name", "")
    ontology_name = body.get("ontology_name", "")
    """Create a new conversation thread within a specific ontology."""
    if not scenario_name or not ontology_name:
        raise HTTPException(status_code=400, detail="请提供场景名称(scenario_name)和本体名称(ontology_name)")

    now = datetime.now(timezone.utc).isoformat()
    thread = {
        "id": str(uuid.uuid4()),
        "title": title,
        "status": "exploring",
        "created_at": now,
        "updated_at": now,
        "messages": [],
        "scenario_name": scenario_name,
        "ontology_name": ontology_name,
    }
    _save_thread(thread)
    return thread


@router.get("/{thread_id}")
async def get_thread(thread_id: str):
    """Get a thread with all its messages."""
    data, sc, onto = _load_thread(thread_id)
    data["scenario_name"] = sc
    data["ontology_name"] = onto
    return data


@router.delete("/{thread_id}")
async def delete_thread(thread_id: str):
    """Delete a thread directory and all its contents."""
    tdir, _, _ = _find_thread(thread_id)
    shutil.rmtree(tdir)
    return {"message": "对话已删除"}


@router.put("/{thread_id}")
async def update_thread(thread_id: str, body: dict = {}):
    """Update thread title or status."""
    data, sc, onto = _load_thread(thread_id)
    if "title" in body and body["title"] is not None:
        data["title"] = body["title"]
    if "status" in body and body["status"] is not None:
        data["status"] = body["status"]
    data["updated_at"] = datetime.now(timezone.utc).isoformat()
    _save_thread(data)
    return data


# ─── Requirement files ─────────────────────────────────────────────────────────

@router.get("/requirements/list")
async def list_requirements():
    """Scan all thread directories for .md files and return their metadata."""
    items = []
    for tdir, sc_name, onto_name in _all_thread_dirs():
        thread_id = tdir.name
        thread_data = None
        data_path = tdir / ".data.json"
        if data_path.exists():
            try:
                with open(data_path, "r", encoding="utf-8") as f:
                    thread_data = json.load(f)
            except (json.JSONDecodeError, KeyError):
                continue

        # Check if this scenario/ontology has been generated from a requirement
        onto_source_file = None
        if sc_name and onto_name:
            try:
                onto_data = load_ontology_data(sc_name, onto_name)
                onto_source_file = onto_data.metadata.get("source_file", "") if onto_data.metadata else ""
            except Exception:
                pass

        for f in sorted(tdir.glob("*.md")):
            stat = f.stat()
            filename = f.name
            req_name = filename[:-3]
            items.append({
                "filename": filename,
                "req_name": req_name,
                "thread_id": thread_id,
                "thread_title": thread_data.get("title", "") if thread_data else "",
                "created_at": datetime.fromtimestamp(stat.st_ctime, tz=timezone.utc).isoformat(),
                "updated_at": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
                "has_ontology": onto_source_file == filename if onto_source_file else False,
                "scenario_name": sc_name,
                "ontology_name": onto_name,
            })
    items.sort(key=lambda i: i["updated_at"], reverse=True)
    return items


@router.get("/{thread_id}/requirements/{filename}")
async def get_requirement_file(thread_id: str, filename: str):
    """Read a requirement markdown file content."""
    tdir, _, _ = _find_thread(thread_id)
    file_path = tdir / filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="文件不存在")
    content = file_path.read_text(encoding="utf-8")
    return {"content": content, "filename": filename, "thread_id": thread_id}


@router.put("/{thread_id}/requirements/{filename}")
async def save_requirement_file(thread_id: str, filename: str, body: dict):
    """Save/update a requirement markdown file."""
    tdir, _, _ = _find_thread(thread_id)
    file_path = tdir / filename
    file_path.write_text(body.get("content", ""), encoding="utf-8")
    return {"message": "文件已保存"}


@router.delete("/{thread_id}/requirements/{filename}")
async def delete_requirement_file(thread_id: str, filename: str):
    """Delete a requirement markdown file."""
    tdir, _, _ = _find_thread(thread_id)
    file_path = tdir / filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="文件不存在")
    file_path.unlink()
    return {"message": "文件已删除"}
