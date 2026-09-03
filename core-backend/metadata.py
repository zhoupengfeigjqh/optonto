"""File-based metadata storage for scenarios and ontologies.
Replaces SQLite + SQLAlchemy. Data stored in meta.json under onto_market/."""

import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from config import ONTO_MARKET_DIR


# ─── Path helpers ──────────────────────────────────────────────────────────────

def _scenario_meta_path(scenario_name: str) -> Path:
    return ONTO_MARKET_DIR / scenario_name / "meta.json"


def _ontology_meta_path(scenario_name: str, ontology_name: str) -> Path:
    return ONTO_MARKET_DIR / scenario_name / ontology_name / "meta.json"


# ─── ID generation (scan-based) ────────────────────────────────────────────────

def _next_scenario_id() -> int:
    max_id = 0
    if not ONTO_MARKET_DIR.exists():
        return 1
    for d in ONTO_MARKET_DIR.iterdir():
        if not d.is_dir():
            continue
        meta = d / "meta.json"
        if meta.exists():
            try:
                with open(meta, encoding="utf-8") as f:
                    data = json.load(f)
                max_id = max(max_id, data.get("id", 0))
            except (json.JSONDecodeError, KeyError):
                continue
    return max_id + 1


def _next_ontology_id() -> int:
    max_id = 0
    if not ONTO_MARKET_DIR.exists():
        return 1
    for scenario_dir in ONTO_MARKET_DIR.iterdir():
        if not scenario_dir.is_dir():
            continue
        for ontology_dir in scenario_dir.iterdir():
            if not ontology_dir.is_dir():
                continue
            meta = ontology_dir / "meta.json"
            if meta.exists():
                try:
                    with open(meta, encoding="utf-8") as f:
                        data = json.load(f)
                    max_id = max(max_id, data.get("id", 0))
                except (json.JSONDecodeError, KeyError):
                    continue
    return max_id + 1


# ─── Scenario CRUD ─────────────────────────────────────────────────────────────

def list_scenarios() -> list[dict]:
    scenarios = []
    if not ONTO_MARKET_DIR.exists():
        return scenarios
    for d in ONTO_MARKET_DIR.iterdir():
        if not d.is_dir():
            continue
        meta_path = d / "meta.json"
        if not meta_path.exists():
            continue
        try:
            with open(meta_path, encoding="utf-8") as f:
                scenarios.append(json.load(f))
        except (json.JSONDecodeError, KeyError):
            continue
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
    dir_path = ONTO_MARKET_DIR / name
    dir_path.mkdir(parents=True, exist_ok=True)
    meta_path = dir_path / "meta.json"
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(scenario, f, ensure_ascii=False, indent=2)
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
        old_path = ONTO_MARKET_DIR / old_name
        new_path = ONTO_MARKET_DIR / name
        if old_path.exists():
            shutil.move(str(old_path), str(new_path))

    meta_path = _scenario_meta_path(scenario["name"])
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(scenario, f, ensure_ascii=False, indent=2)
    return scenario


def delete_scenario(scenario_id: int) -> bool:
    scenario = get_scenario_by_id(scenario_id)
    if not scenario:
        return False
    dir_path = ONTO_MARKET_DIR / scenario["name"]
    if dir_path.exists():
        shutil.rmtree(dir_path)
    return True


# ─── Ontology CRUD ─────────────────────────────────────────────────────────────

def list_ontologies_by_scenario(scenario_name: str) -> list[dict]:
    """List ontologies for a given scenario (delegates to list_all_ontologies)."""
    return [o for o in list_all_ontologies() if o.get("scenario_name") == scenario_name]


def list_all_ontologies() -> list[dict]:
    """List all ontologies across all scenarios, enriched with scenario_name and deployed_version."""
    results = []
    if not ONTO_MARKET_DIR.exists():
        return results
    for scenario_dir in sorted(ONTO_MARKET_DIR.iterdir()):
        if not scenario_dir.is_dir():
            continue
        for ontology_dir in sorted(scenario_dir.iterdir()):
            if not ontology_dir.is_dir():
                continue
            meta_path = ontology_dir / "meta.json"
            if not meta_path.exists():
                continue
            try:
                with open(meta_path, encoding="utf-8") as f:
                    data = json.load(f)
                if "scenario_id" in data:
                    data["scenario_name"] = scenario_dir.name
                    data["ontology_name"] = ontology_dir.name
                    # 从已部署的 ontology.yaml 解析 deployed_version（无则空串）
                    ontology_yaml = ontology_dir / "ontology.yaml"
                    deployed_version = ""
                    if ontology_yaml.exists():
                        try:
                            import yaml
                            raw = yaml.safe_load(ontology_yaml.read_text(encoding="utf-8")) or {}
                            meta = raw.get("metadata") if isinstance(raw, dict) else None
                            if isinstance(meta, dict):
                                deployed_version = str(meta.get("deployed_version") or "")
                        except Exception:
                            pass
                    data["deployed_version"] = deployed_version
                    results.append(data)
            except (json.JSONDecodeError, KeyError):
                continue
    results.sort(key=lambda o: o.get("updated_at", ""), reverse=True)
    return results


def get_ontology_by_id(ontology_id: int) -> Optional[tuple[dict, str, str]]:
    """Returns (ontology_data, scenario_name, ontology_name) or None."""
    if not ONTO_MARKET_DIR.exists():
        return None
    for scenario_dir in ONTO_MARKET_DIR.iterdir():
        if not scenario_dir.is_dir():
            continue
        for ontology_dir in scenario_dir.iterdir():
            if not ontology_dir.is_dir():
                continue
            meta_path = ontology_dir / "meta.json"
            if not meta_path.exists():
                continue
            try:
                with open(meta_path, encoding="utf-8") as f:
                    data = json.load(f)
                if data.get("id") == ontology_id:
                    return data, scenario_dir.name, ontology_dir.name
            except (json.JSONDecodeError, KeyError):
                continue
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
    dir_path = ONTO_MARKET_DIR / scenario_name / name
    dir_path.mkdir(parents=True, exist_ok=True)
    meta_path = dir_path / "meta.json"
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(ontology, f, ensure_ascii=False, indent=2)
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
        old_path = ONTO_MARKET_DIR / scenario_name / old_onto_name
        new_path = ONTO_MARKET_DIR / scenario_name / name
        if old_path.exists():
            shutil.move(str(old_path), str(new_path))

    meta_path = _ontology_meta_path(scenario_name, ontology["name"])
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(ontology, f, ensure_ascii=False, indent=2)
    return ontology


def delete_ontology(ontology_id: int) -> bool:
    result = get_ontology_by_id(ontology_id)
    if not result:
        return False
    _, scenario_name, ontology_name = result
    dir_path = ONTO_MARKET_DIR / scenario_name / ontology_name
    if dir_path.exists():
        shutil.rmtree(dir_path)
    return True


def get_ontology_name_by_id(ontology_id: int) -> Optional[tuple[str, str]]:
    """Returns (scenario_name, ontology_name) or None."""
    result = get_ontology_by_id(ontology_id)
    if result:
        return result[1], result[2]
    return None
