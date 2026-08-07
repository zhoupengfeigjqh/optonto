"""Thread/conversation management API — stored per-ontology under onto_market."""

import json
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Body, HTTPException

from config import DEMAND_THREADS_DIR, ONTO_MARKET_DIR
from metadata import get_scenario_by_name, list_ontologies_by_scenario
from services import load_ontology_data

router = APIRouter(prefix="/api/threads", tags=["对话管理"])


def _all_thread_dirs(scenario: str = "", ontology: str = "") -> list[tuple[Path, str, str]]:
    """Scan data/threads/demand/ for threads. If scenario+ontology given, filter by thread json fields."""
    results: list[tuple[Path, str, str]] = []
    if not DEMAND_THREADS_DIR.exists():
        return results

    for thread_dir in sorted(DEMAND_THREADS_DIR.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
        if not thread_dir.is_dir():
            continue
        data_path = thread_dir / ".data.json"
        if not data_path.exists():
            continue
        try:
            with open(data_path, "r", encoding="utf-8") as fp:
                data = json.load(fp)
        except (json.JSONDecodeError, KeyError):
            continue
        sc = data.get("scenario_name", "")
        onto = data.get("ontology_name", "")
        if scenario and sc != scenario:
            continue
        if ontology and onto != ontology:
            continue
        results.append((thread_dir, sc, onto))
    return results


def _thread_dir(thread_id: str) -> Path:
    """Get the directory for a demand thread (flat under data/threads/demand/)."""
    return DEMAND_THREADS_DIR / thread_id


def _thread_path(thread_id: str) -> Path:
    return _thread_dir(thread_id) / ".data.json"


def _find_thread(thread_id: str) -> tuple[Path, str, str]:
    """Find a demand thread by ID. Returns (thread_dir, scenario, ontology)."""
    tdir = _thread_dir(thread_id)
    if not tdir.exists():
        raise HTTPException(status_code=404, detail="对话不存在")
    path = tdir / ".data.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="对话不存在")
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return tdir, data.get("scenario_name", ""), data.get("ontology_name", "")


def _load_thread(thread_id: str) -> tuple[dict, str, str]:
    """Load thread data. Returns (data, scenario_name, ontology_name)."""
    tdir, sc, onto = _find_thread(thread_id)
    path = tdir / ".data.json"
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f), sc, onto


def _save_thread(data: dict) -> None:
    """Save thread data. Requires scenario_name and ontology_name in data."""
    sc = data.get("scenario_name", "")
    onto = data.get("ontology_name", "")
    if not sc or not onto:
        raise HTTPException(status_code=400, detail="缺少场景或本体名称")
    dir_path = _thread_dir(data["id"])
    dir_path.mkdir(parents=True, exist_ok=True)
    path = dir_path / ".data.json"
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def _resolve_ids(scenario_name: str, ontology_name: str) -> tuple[Optional[int], Optional[int]]:
    """Resolve scenario_id and ontology_id from meta.json. Returns (scenario_id, ontology_id), None when not found."""
    try:
        scenario = get_scenario_by_name(scenario_name)
        scenario_id = scenario.get("id") if scenario else None
        ontology_id = None
        if scenario_id is not None:
            for o in list_ontologies_by_scenario(scenario_name):
                if o.get("name") == ontology_name:
                    ontology_id = o.get("id")
                    break
        return scenario_id, ontology_id
    except Exception:
        return None, None


# ─── API Endpoints ─────────────────────────────────────────────────────────────


@router.get("")
async def list_threads(scenario: str = "", ontology: str = ""):
    """List all threads, optionally filtered by scenario/ontology."""
    threads = []
    for tdir, sc_name, onto_name in _all_thread_dirs(scenario, ontology):
        data_path = tdir / ".data.json"
        if not data_path.exists():
            continue
        try:
            with open(data_path, "r", encoding="utf-8") as fp:
                data = json.load(fp)
            scenario_id = data.get("scenario_id")
            ontology_id = data.get("ontology_id")
            if scenario_id is None or ontology_id is None:
                # 旧线程未落盘 id，按名称从 meta.json 解析兜底
                sid, oid = _resolve_ids(sc_name, onto_name)
                scenario_id = scenario_id if scenario_id is not None else sid
                ontology_id = ontology_id if ontology_id is not None else oid
            threads.append({
                "id": data["id"],
                "title": data.get("title", ""),
                "status": data.get("status", "exploring"),
                "created_at": data.get("created_at", ""),
                "updated_at": data.get("updated_at", ""),
                "scenario_name": sc_name,
                "scenario_id": scenario_id,
                "ontology_name": onto_name,
                "ontology_id": ontology_id,
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
    scenario_id, ontology_id = _resolve_ids(scenario_name, ontology_name)
    thread = {
        "id": str(uuid.uuid4()),
        "title": title,
        "status": "exploring",
        "created_at": now,
        "updated_at": now,
        "messages": [],
        "scenario_name": scenario_name,
        "scenario_id": scenario_id,
        "ontology_name": ontology_name,
        "ontology_id": ontology_id,
    }
    _save_thread(thread)
    return thread


@router.get("/{thread_id}")
async def get_thread(thread_id: str, scenario: str = "", ontology: str = ""):
    """Get a thread with all its messages. If scenario/ontology given, verify the thread belongs to them."""
    data, sc, onto = _load_thread(thread_id)
    if scenario and sc != scenario:
        raise HTTPException(status_code=404, detail="对话不存在")
    if ontology and onto != ontology:
        raise HTTPException(status_code=404, detail="对话不存在")
    data["scenario_name"] = sc
    data["ontology_name"] = onto
    if "scenario_id" not in data or "ontology_id" not in data:
        sid, oid = _resolve_ids(sc, onto)
        data["scenario_id"] = data.get("scenario_id", sid)
        data["ontology_id"] = data.get("ontology_id", oid)
    return data


@router.delete("/{thread_id}")
async def delete_thread(thread_id: str):
    """Delete a thread directory and all its contents."""
    tdir, _, _ = _find_thread(thread_id)
    shutil.rmtree(tdir)
    return {"message": "对话已删除"}


@router.put("/{thread_id}")
async def update_thread(thread_id: str, body: dict = Body(default={})):
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
async def list_requirements(scenario: str = "", ontology: str = ""):
    """Scan thread directories for .md files. Optionally filter by scenario/ontology."""
    # 同一本体可能对应多个线程目录，缓存 ontology 解析结果避免重复读盘
    ontology_cache: dict[tuple[str, str], str] = {}
    items = []
    for tdir, sc_name, onto_name in _all_thread_dirs(scenario, ontology):
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
            key = (sc_name, onto_name)
            if key not in ontology_cache:
                try:
                    onto_data = load_ontology_data(sc_name, onto_name)
                    ontology_cache[key] = onto_data.metadata.get("source_file", "") if onto_data.metadata else ""
                except Exception:
                    ontology_cache[key] = ""
            onto_source_file = ontology_cache[key] or None

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
async def get_requirement_file(thread_id: str, filename: str, scenario: str = "", ontology: str = ""):
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
    """Delete a requirement markdown file and its linked ontology if exists."""
    tdir, scenario_name, ontology_name = _find_thread(thread_id)
    file_path = tdir / filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="文件不存在")

    # 检查是否为已输出的本体，若是则一并删除本体目录
    onto_dir = ONTO_MARKET_DIR / scenario_name / ontology_name
    try:
        onto_data = load_ontology_data(scenario_name, ontology_name)
        if onto_data.metadata and onto_data.metadata.get("source_file") == filename:
            shutil.rmtree(onto_dir)
    except Exception:
        pass

    file_path.unlink()
    return {"message": "文件已删除"}
