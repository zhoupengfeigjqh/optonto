"""场景 / 本体元数据存储（meta.json）—— 数据访问层。

原位于仓库根 ``metadata.py``（历史位置），2026-09-28 归位至数据访问层：
只有本层可直接做文件 I/O（章程 II：接口层–业务层–数据访问层），
业务层与接口层经本模块读写。

替代早期 SQLite + SQLAlchemy 方案，数据以 ``onto_market/{场景}/{本体}/meta.json`` 存放。
id 由扫描现有 meta.json 取最大值 +1 生成（无中心计数器，不引入额外状态）。
"""

from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from config import ONTO_MARKET_DIR

from . import fs_store


# ─── Path helpers ──────────────────────────────────────────────────────────────

def _scenario_meta_path(scenario_name: str) -> Path:
    return ONTO_MARKET_DIR / scenario_name / "meta.json"


def _ontology_meta_path(scenario_name: str, ontology_name: str) -> Path:
    return ONTO_MARKET_DIR / scenario_name / ontology_name / "meta.json"


def _iter_dirs(path: Path) -> list[Path]:
    """列出子目录（跳过普通文件）；目录不存在返回空列表。"""
    return [d for d in fs_store.list_dir(path) if d.is_dir()]


def _read_meta(path: Path) -> Optional[dict]:
    """读取 meta.json；缺失、为空或损坏一律返回 None（调用方跳过该条目）。"""
    data = fs_store.read_json(path)
    return data if isinstance(data, dict) else None


# ─── ID generation (scan-based) ────────────────────────────────────────────────

def _next_scenario_id() -> int:
    max_id = 0
    for d in _iter_dirs(ONTO_MARKET_DIR):
        meta = _read_meta(d / "meta.json")
        if meta:
            max_id = max(max_id, meta.get("id", 0))
    return max_id + 1


def _next_ontology_id() -> int:
    max_id = 0
    for scenario_dir in _iter_dirs(ONTO_MARKET_DIR):
        for ontology_dir in _iter_dirs(scenario_dir):
            meta = _read_meta(ontology_dir / "meta.json")
            if meta:
                max_id = max(max_id, meta.get("id", 0))
    return max_id + 1


# ─── Scenario CRUD ─────────────────────────────────────────────────────────────

def list_scenarios() -> list[dict]:
    scenarios = []
    for d in _iter_dirs(ONTO_MARKET_DIR):
        meta = _read_meta(d / "meta.json")
        if meta:
            scenarios.append(meta)
    # 统一按 updated_at 排序（此前先按目录 mtime 排序再按 updated_at 重排，第一次排序无效）
    scenarios.sort(key=lambda s: s.get("updated_at", ""), reverse=True)
    return scenarios


def get_scenario_by_id(scenario_id: int) -> Optional[dict]:
    for s in list_scenarios():
        if s.get("id") == scenario_id:
            return s
    return None


def get_scenario_by_name(name: str) -> Optional[dict]:
    for s in list_scenarios():
        if s.get("name") == name:
            return s
    return None


def create_scenario(name: str, description: str = "") -> dict:
    now = datetime.now(timezone.utc).isoformat()
    scenario = {
        "id": _next_scenario_id(),
        "name": name,
        "description": description,
        "created_at": now,
        "updated_at": now,
    }
    fs_store.write_json(ONTO_MARKET_DIR / name / "meta.json", scenario)
    return scenario


def update_scenario(scenario_id: int, name: Optional[str] = None, description: Optional[str] = None) -> Optional[dict]:
    scenario = get_scenario_by_id(scenario_id)
    if not scenario:
        return None
    old_name = scenario["name"]
    if name is not None:
        scenario["name"] = name
    if description is not None:
        scenario["description"] = description
    scenario["updated_at"] = datetime.now(timezone.utc).isoformat()

    # If name changed, move directory
    if name is not None and name != old_name:
        fs_store.move_path(ONTO_MARKET_DIR / old_name, ONTO_MARKET_DIR / name)

    fs_store.write_json(_scenario_meta_path(scenario["name"]), scenario)
    return scenario


def delete_scenario(scenario_id: int) -> bool:
    scenario = get_scenario_by_id(scenario_id)
    if not scenario:
        return False
    fs_store.delete_tree(ONTO_MARKET_DIR / scenario["name"])
    return True


# ─── Ontology CRUD ─────────────────────────────────────────────────────────────

def list_ontologies_by_scenario(scenario_name: str) -> list[dict]:
    """List ontologies for a given scenario (delegates to list_all_ontologies)."""
    return [o for o in list_all_ontologies() if o.get("scenario_name") == scenario_name]


def _deployed_version_of(ontology_dir: Path) -> str:
    """从已部署 ontology.yaml 解析 deployed_version（缺失 / 损坏返回空串）。"""
    raw = fs_store.read_yaml(ontology_dir / "ontology.yaml")
    meta = raw.get("metadata") if isinstance(raw, dict) else None
    return str(meta.get("deployed_version") or "") if isinstance(meta, dict) else ""


def list_all_ontologies() -> list[dict]:
    """List all ontologies across all scenarios, enriched with scenario_name and deployed_version."""
    results = []
    for scenario_dir in sorted(_iter_dirs(ONTO_MARKET_DIR)):
        for ontology_dir in sorted(_iter_dirs(scenario_dir)):
            data = _read_meta(ontology_dir / "meta.json")
            if not data or "scenario_id" not in data:
                continue
            data["scenario_name"] = scenario_dir.name
            data["ontology_name"] = ontology_dir.name
            data["deployed_version"] = _deployed_version_of(ontology_dir)
            results.append(data)
    results.sort(key=lambda o: o.get("updated_at", ""), reverse=True)
    return results


def get_ontology_by_id(ontology_id: int) -> Optional[tuple[dict, str, str]]:
    """Returns (ontology_data, scenario_name, ontology_name) or None."""
    for scenario_dir in _iter_dirs(ONTO_MARKET_DIR):
        for ontology_dir in _iter_dirs(scenario_dir):
            data = _read_meta(ontology_dir / "meta.json")
            if data and data.get("id") == ontology_id:
                return data, scenario_dir.name, ontology_dir.name
    return None


def create_ontology(scenario_name: str, name: str, description: str = "", creator: str = "") -> Optional[dict]:
    scenario = get_scenario_by_name(scenario_name)
    if not scenario:
        return None
    now = datetime.now(timezone.utc).isoformat()
    ontology = {
        "id": _next_ontology_id(),
        "scenario_id": scenario["id"],
        "name": name,
        "description": description,
        "creator": creator,
        "created_at": now,
        "updated_at": now,
    }
    fs_store.write_json(ONTO_MARKET_DIR / scenario_name / name / "meta.json", ontology)
    return ontology


def update_ontology(ontology_id: int, name: Optional[str] = None, description: Optional[str] = None, creator: Optional[str] = None) -> Optional[dict]:
    result = get_ontology_by_id(ontology_id)
    if not result:
        return None
    ontology, scenario_name, old_onto_name = result
    if name is not None:
        ontology["name"] = name
    if description is not None:
        ontology["description"] = description
    if creator is not None:
        ontology["creator"] = creator
    ontology["updated_at"] = datetime.now(timezone.utc).isoformat()

    # If name changed, move directory
    if name is not None and name != old_onto_name:
        fs_store.move_path(
            ONTO_MARKET_DIR / scenario_name / old_onto_name,
            ONTO_MARKET_DIR / scenario_name / name,
        )

    fs_store.write_json(_ontology_meta_path(scenario_name, ontology["name"]), ontology)
    return ontology


def delete_ontology(ontology_id: int) -> bool:
    result = get_ontology_by_id(ontology_id)
    if not result:
        return False
    _, scenario_name, ontology_name = result
    fs_store.delete_tree(ONTO_MARKET_DIR / scenario_name / ontology_name)
    return True


def get_ontology_name_by_id(ontology_id: int) -> Optional[tuple[str, str]]:
    """Returns (scenario_name, ontology_name) or None."""
    result = get_ontology_by_id(ontology_id)
    if result:
        return result[1], result[2]
    return None
