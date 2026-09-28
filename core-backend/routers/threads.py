"""Thread/conversation management API — stored per-ontology under onto_market.

分层（章程 II）：本模块为接口层，只做参数校验、编排与响应组装；
所有文件读写一律经数据访问层 ``repositories.fs_store``，不得直接 open/Path.write_text/shutil。
"""

import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Body, HTTPException

from config import DATA_DIR, DEMAND_THREADS_DIR
from repositories.metadata import get_scenario_by_name, list_ontologies_by_scenario
from repositories import fs_store
from services import split_yaml_top_sections

router = APIRouter(prefix="/api/threads", tags=["对话管理"])


@router.get("/ontology-template/sections")
async def list_ontology_template_sections():
    """返回 .data/onto_template.yaml 的一级目录名，供「本体生成」勾选模板加载范围。

    动态解析而非前端硬编码：模板增删节时前端选项自动同步。
    """
    tp = DATA_DIR / "templates/onto_template.yaml"
    if not fs_store.exists(tp):
        raise HTTPException(status_code=500, detail="本体模板文件不存在")
    return {"sections": [key for key, _ in split_yaml_top_sections(fs_store.read_text(tp))]}


def _all_thread_dirs(scenario: str = "", ontology: str = "") -> list[tuple[Path, str, str]]:
    """Scan data/threads/demand/ for threads. If scenario+ontology given, filter by thread json fields."""
    results: list[tuple[Path, str, str]] = []
    if not fs_store.exists(DEMAND_THREADS_DIR):
        return results

    dirs = [d for d in fs_store.list_dir(DEMAND_THREADS_DIR) if d.is_dir()]
    for thread_dir in sorted(dirs, key=lambda p: p.stat().st_mtime, reverse=True):
        data = fs_store.read_json(thread_dir / ".data.json")
        if data is None:
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
    path = tdir / ".data.json"
    if not fs_store.exists(path):
        raise HTTPException(status_code=404, detail="对话不存在")
    # 文件存在却解析不出内容 = 数据损坏，与「不存在」区分开，避免用 404 掩盖故障
    data = fs_store.read_json(path)
    if not isinstance(data, dict):
        raise HTTPException(status_code=500, detail="对话数据损坏")
    return tdir, data.get("scenario_name", ""), data.get("ontology_name", "")


def _load_thread(thread_id: str) -> tuple[dict, str, str]:
    """Load thread data. Returns (data, scenario_name, ontology_name)."""
    tdir, sc, onto = _find_thread(thread_id)
    data = fs_store.read_json(tdir / ".data.json")
    if not isinstance(data, dict):
        raise HTTPException(status_code=500, detail="对话数据损坏")
    return data, sc, onto


def _save_thread(data: dict) -> None:
    """Save thread data. Requires scenario_name and ontology_name in data."""
    sc = data.get("scenario_name", "")
    onto = data.get("ontology_name", "")
    if not sc or not onto:
        raise HTTPException(status_code=400, detail="缺少场景或本体名称")
    fs_store.write_json(_thread_path(data["id"]), data)


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
        data = fs_store.read_json(tdir / ".data.json")
        if data is None:
            continue
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
            "version": data.get("version", ""),
            "created_at": data.get("created_at", ""),
            "updated_at": data.get("updated_at", ""),
            "scenario_name": sc_name,
            "scenario_id": scenario_id,
            "ontology_name": onto_name,
            "ontology_id": ontology_id,
        })
    threads.sort(key=lambda t: t["updated_at"], reverse=True)
    return threads


@router.post("", status_code=201)
async def create_thread(body: dict):
    """Create a new conversation thread within a specific ontology."""
    title = body.get("title", "新对话")
    scenario_name = body.get("scenario_name", "")
    ontology_name = body.get("ontology_name", "")
    version = body.get("version", "")
    if not version:
        raise HTTPException(status_code=400, detail="请提供版本号(version)")
    if not scenario_name or not ontology_name:
        raise HTTPException(status_code=400, detail="请提供场景名称(scenario_name)和本体名称(ontology_name)")

    now = datetime.now(timezone.utc).isoformat()
    scenario_id, ontology_id = _resolve_ids(scenario_name, ontology_name)
    thread = {
        "id": str(uuid.uuid4()),
        "title": title,
        "status": "exploring",
        "version": version,
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
    fs_store.delete_tree(tdir)
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


def _yaml_source_map(tdir: Path) -> dict[str, str]:
    """扫描线程目录内的 yaml，返回 {yaml 文件名（含扩展名）: metadata.source_file}。

    解析失败/无 metadata 时值为 ""，供 has_ontology 的 source_file 回退判定使用。
    """
    mapping: dict[str, str] = {}
    for y in fs_store.list_files(tdir, "*.yaml"):
        raw = fs_store.read_yaml(y)
        source_file = ""
        if isinstance(raw, dict):
            meta = raw.get("metadata")
            if isinstance(meta, dict):
                source_file = str(meta.get("source_file") or "")
        mapping[y.name] = source_file
    return mapping


def _match_ontology_yaml(tdir: Path, req_name: str, filename: str, source_map: dict[str, str]) -> str:
    """判定该需求 md 对应的本体 yaml 是否已生成，返回匹配的 yaml 文件名（无则空串）。

    两级判定：
    1. 同名优先：{req_name}.yaml 存在（本体生成接口的落盘规则）；
    2. source_file 回退：任一 yaml 的 metadata.source_file 指向本 md。
       覆盖 yaml 被改名/手工迁移、或导出时内容名变更导致文件名不再同名的场景。

    注意：两条都不中即视为未生成。若 md 被改名且旧 yaml 的 source_file 仍指向
    已不存在的旧 md 名，则该 yaml 成为孤儿，不会被任何行认领——此时应重新生成。
    """
    same_name = f"{req_name}.yaml"
    if fs_store.exists(tdir / same_name):
        return same_name
    for yaml_name, source_file in source_map.items():
        if source_file == filename:
            return yaml_name
    return ""


@router.get("/requirements/list")
async def list_requirements(scenario: str = "", ontology: str = ""):
    """Scan thread directories for .md files. Optionally filter by scenario/ontology.

    has_ontology 为实时推导（无持久化状态）：同名 yaml 存在、或 yaml 内
    metadata.source_file 指向该 md，两者之一命中即为已生成。
    """
    items = []
    for tdir, sc_name, onto_name in _all_thread_dirs(scenario, ontology):
        thread_id = tdir.name
        thread_data = fs_store.read_json(tdir / ".data.json")

        source_map = _yaml_source_map(tdir)

        for f in fs_store.list_files(tdir, "*.md"):
            stat = f.stat()
            filename = f.name
            req_name = filename[:-3]

            # 按最后一个 _ 拆分为 本体名_内容；无 _ 的旧文件回退为本体名=线程所属本体、内容=文件名
            if "_" in req_name:
                doc_onto, _, doc_content = req_name.rpartition("_")
            else:
                doc_onto, doc_content = onto_name, req_name

            # 已生成判定：同名 yaml 优先，否则回退 yaml 内 metadata.source_file
            matched_yaml = _match_ontology_yaml(tdir, req_name, filename, source_map)

            # 版本号取自 thread .data.json 的 version 字段（对话创建时录入）
            version = thread_data.get("version", "") if thread_data else ""

            items.append({
                "filename": filename,
                "req_name": req_name,
                "onto_name": doc_onto,
                "content_name": doc_content,
                "version": version,
                "thread_id": thread_id,
                "thread_title": thread_data.get("title", "") if thread_data else "",
                "created_at": datetime.fromtimestamp(stat.st_ctime, tz=timezone.utc).isoformat(),
                "updated_at": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
                "has_ontology": bool(matched_yaml),
                "ontology_file": matched_yaml,
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
    if not fs_store.exists(file_path):
        raise HTTPException(status_code=404, detail="文件不存在")
    return {"content": fs_store.read_text(file_path), "filename": filename, "thread_id": thread_id}


@router.put("/{thread_id}/requirements/{filename}")
async def save_requirement_file(thread_id: str, filename: str, body: dict):
    """Save/update a requirement markdown file."""
    tdir, _, _ = _find_thread(thread_id)
    fs_store.write_text(tdir / filename, body.get("content", ""))
    return {"message": "文件已保存"}


@router.delete("/{thread_id}/requirements/{filename}")
async def delete_requirement_file(thread_id: str, filename: str):
    """Delete a requirement markdown file and its sibling generated yaml (同名 {本体名}_{内容}.yaml).

    不再连带删除本体目录（原逻辑会按 source_file 删掉整个 onto_market 本体，过于危险，已移除）。
    """
    tdir, scenario_name, ontology_name = _find_thread(thread_id)
    file_path = tdir / filename
    if not fs_store.exists(file_path):
        raise HTTPException(status_code=404, detail="文件不存在")

    # 连带删除同目录下由该需求生成的 yaml（若存在）
    if filename.endswith(".md"):
        fs_store.delete_file(tdir / f"{filename[:-3]}.yaml")

    fs_store.delete_file(file_path)
    return {"message": "文件已删除"}
