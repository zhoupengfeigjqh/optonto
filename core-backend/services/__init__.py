"""Service for reading/writing ontology YAML files."""

import os
from pathlib import Path
from typing import Optional

import yaml

from config import ONTO_MARKET_DIR
from schemas import DataEngineItem, OntologyData


def _get_ontology_dir(scenario_name: str, ontology_name: str) -> Path:
    """Get the directory path for an ontology's YAML files."""
    return ONTO_MARKET_DIR / scenario_name / ontology_name


def _get_data_engines_path(scenario_name: str, ontology_name: str) -> Path:
    """数据引擎独立文件路径（与 ontology.yaml 同目录）。

    数据引擎是物理集成绑定（URL/method/SQL/参数与响应 schema），与本体语义模型
    职责不同、变更频率不同，单独存放；ontology.yaml 中的 data_engines 段仅作
    迁移前的读时兼容回退，保存后固定清空（单一权威来源，防双写漂移）。
    """
    return _get_ontology_dir(scenario_name, ontology_name) / "data_engines.yaml"


def _get_yaml_path(scenario_name: str, ontology_name: str) -> Path:
    """Get the path to the ontology YAML file."""
    return _get_ontology_dir(scenario_name, ontology_name) / "ontology.yaml"


def _get_functions_dir(scenario_name: str, ontology_name: str) -> Path:
    """Get the directory for function code files."""
    return _get_ontology_dir(scenario_name, ontology_name) / "functions"


def ensure_functions_dir(scenario_name: str, ontology_name: str) -> Path:
    """Ensure the functions directory exists and return its path."""
    dir_path = _get_functions_dir(scenario_name, ontology_name)
    dir_path.mkdir(parents=True, exist_ok=True)
    return dir_path


def ensure_ontology_dir(scenario_name: str, ontology_name: str) -> Path:
    """Ensure the ontology directory exists and return its path."""
    dir_path = _get_ontology_dir(scenario_name, ontology_name)
    dir_path.mkdir(parents=True, exist_ok=True)
    return dir_path


def _load_data_engines_file(scenario_name: str, ontology_name: str) -> Optional[list[DataEngineItem]]:
    """读取独立数据引擎文件；文件不存在返回 None（调用方回退 ontology.yaml 旧段）。

    兼容两种形态：顶层 data_engines: 列表（标准），或整个文件就是一个列表。
    解析失败抛错给调用方——宁可报错也不静默回退到旧段（避免新旧内容不一致难排查）。
    """
    path = _get_data_engines_path(scenario_name, ontology_name)
    if not path.exists():
        return None
    with open(path, "r", encoding="utf-8") as f:
        raw = yaml.safe_load(f) or {}
    items = raw.get("data_engines", []) if isinstance(raw, dict) else raw
    return [DataEngineItem(**e) for e in (items or [])]


def _load_ontology_data_uncached(scenario_name: str, ontology_name: str) -> OntologyData:
    """读盘 + 解析（load_ontology_data 的缓存未命中路径）。"""
    yaml_path = _get_yaml_path(scenario_name, ontology_name)
    if yaml_path.exists():
        with open(yaml_path, "r", encoding="utf-8") as f:
            raw = yaml.safe_load(f) or {}
        data = OntologyData(**raw)
    else:
        data = OntologyData()

    # 数据引擎独立存放：data_engines.yaml 存在则以其为准，否则回退 ontology.yaml 旧段
    engines = _load_data_engines_file(scenario_name, ontology_name)
    if engines is not None:
        data.data_engines = engines
    return data


def _mtime_ns(path: Path) -> int:
    """文件 mtime（纳秒）；文件不存在返回 -1，使"后来创建"必然触发缓存失效。"""
    try:
        return path.stat().st_mtime_ns
    except OSError:
        return -1


# 按 (scenario, ontology) 缓存解析结果，ontology.yaml + data_engines.yaml 双 mtime 失效。
# 与 agent-backend OntologyGateway 的缓存语义一致；本进程保存时主动失效（见 save/write_yaml_raw），
# mtime 同时兜底进程外编辑（手动改文件、git pull）。
_ontology_cache: dict[tuple[str, str], tuple[int, int, OntologyData]] = {}


def load_ontology_data(scenario_name: str, ontology_name: str) -> OntologyData:
    """Load ontology data from YAML file. Returns empty data if file doesn't exist.

    mtime 缓存命中时返回深拷贝——调用方会直接 mutate 返回对象（CRUD append/赋值），
    必须隔离缓存原件，否则未保存的修改会污染缓存。
    """
    key = (scenario_name, ontology_name)
    yaml_mtime = _mtime_ns(_get_yaml_path(scenario_name, ontology_name))
    engines_mtime = _mtime_ns(_get_data_engines_path(scenario_name, ontology_name))
    hit = _ontology_cache.get(key)
    if hit and hit[0] == yaml_mtime and hit[1] == engines_mtime:
        return hit[2].model_copy(deep=True)
    data = _load_ontology_data_uncached(scenario_name, ontology_name)
    _ontology_cache[key] = (yaml_mtime, engines_mtime, data)
    return data.model_copy(deep=True)


def _invalidate_ontology_cache(scenario_name: str, ontology_name: str) -> None:
    """本进程写盘后主动失效缓存（不依赖 mtime 粒度，保证写后读一致）。"""
    _ontology_cache.pop((scenario_name, ontology_name), None)


def save_ontology_data(scenario_name: str, ontology_name: str, data: OntologyData) -> None:
    """Save ontology data to YAML file."""
    yaml_path = _get_yaml_path(scenario_name, ontology_name)
    ensure_ontology_dir(scenario_name, ontology_name)

    # 在 metadata 中固化场景/本体名称与 id（权威来源：meta.json）
    from metadata import get_scenario_by_name, list_ontologies_by_scenario
    scenario = get_scenario_by_name(scenario_name)
    scenario_id = scenario.get("id") if scenario else None
    ontology_id = None
    if scenario_id is not None:
        for o in list_ontologies_by_scenario(scenario_name):
            if o.get("name") == ontology_name:
                ontology_id = o.get("id")
                break
    if not isinstance(data.metadata, dict):
        data.metadata = {}
    data.metadata["scenario_name"] = scenario_name
    data.metadata["scenario_id"] = scenario_id
    data.metadata["ontology_name"] = ontology_name
    data.metadata["ontology_id"] = ontology_id

    # 数据引擎拆写到独立文件；ontology.yaml 彻底不含 data_engines 键（引擎唯一权威来源 = data_engines.yaml）。
    # 用 model_copy 避免改动调用方对象（路由在 save 后仍可能读取 data.data_engines）。
    engines = data.data_engines
    ontology_data = data.model_copy(update={"data_engines": []})
    ontology_dict = ontology_data.model_dump(exclude_none=True)
    ontology_dict.pop("data_engines", None)

    with open(yaml_path, "w", encoding="utf-8") as f:
        yaml.dump(
            ontology_dict,
            f,
            default_flow_style=False,
            allow_unicode=True,
            sort_keys=False,
        )

    with open(_get_data_engines_path(scenario_name, ontology_name), "w", encoding="utf-8") as f:
        yaml.dump(
            {"data_engines": [e.model_dump(exclude_none=True) for e in engines]},
            f,
            default_flow_style=False,
            allow_unicode=True,
            sort_keys=False,
        )

    _invalidate_ontology_cache(scenario_name, ontology_name)


def read_yaml_raw(scenario_name: str, ontology_name: str) -> Optional[str]:
    """Read YAML file content as raw string."""
    yaml_path = _get_yaml_path(scenario_name, ontology_name)
    if not yaml_path.exists():
        return None
    with open(yaml_path, "r", encoding="utf-8") as f:
        return f.read()


def write_yaml_raw(scenario_name: str, ontology_name: str, content: str) -> None:
    """Write raw YAML string to file, then parse and return the structured data."""
    yaml_path = _get_yaml_path(scenario_name, ontology_name)
    ensure_ontology_dir(scenario_name, ontology_name)
    with open(yaml_path, "w", encoding="utf-8") as f:
        f.write(content)
    _invalidate_ontology_cache(scenario_name, ontology_name)


def list_ontology_yaml_files(scenario_name: str, ontology_name: str) -> list[dict]:
    """List all YAML files in the ontology directory."""
    dir_path = _get_ontology_dir(scenario_name, ontology_name)
    if not dir_path.exists():
        return []
    files = []
    for f in sorted(dir_path.iterdir()):
        if f.is_file() and f.suffix in (".yaml", ".yml"):
            files.append({"name": f.name, "path": str(f.relative_to(ONTO_MARKET_DIR))})
    return files


def build_restricted_globals() -> dict:
    """Restricted globals for exec'ing user function code (ontology + common).

    注意：__import__ 有意保留——现有函数代码依赖它（如公共函数在 run() 内部
    `from datetime import ...`）。这是"可信插件执行"，不是安全沙箱。
    """
    import datetime as _datetime
    import json as _json
    import math as _math
    import re as _re
    return {
        "datetime": _datetime, "json": _json, "math": _math, "re": _re,
        "__builtins__": {
            "abs": abs, "all": all, "any": any, "bool": bool, "dict": dict,
            "enumerate": enumerate, "float": float, "int": int, "isinstance": isinstance,
            "len": len, "list": list, "max": max, "min": min, "range": range,
            "round": round, "sorted": sorted, "str": str, "sum": sum, "tuple": tuple,
            "type": type, "zip": zip, "map": map, "filter": filter, "reversed": reversed,
            "True": True, "False": False, "None": None,
            "__import__": __import__, "print": print,
        },
    }
