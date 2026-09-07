"""直读 .data + mtime 指纹热加载（运行面唯一数据源）。

与 core-backend 的唯一耦合是 .data 文件契约：meta.json（场景/本体清单与 id）、
ontology.yaml（语义模型）、data_engines.yaml / securities.yaml（独立文件，单一权威）。
运行面只读不写；缓存按三文件 mtime 失效，与 core services.load_ontology_data 同语义。

返回全部是 plain dict（yaml.safe_load / json.load 原物），不依赖 core 的 pydantic schemas——
运行面只读取字段，不参与设计期校验。
"""

import json
import os
from pathlib import Path

import yaml

DATA_DIR = Path(os.getenv("DATA_DIR", "/app/.data"))
ONTO_MARKET_DIR = DATA_DIR / "onto_market"
COMMON_DIR = DATA_DIR / "common_functions"
COMMON_MANIFEST_PATH = COMMON_DIR / "functions.json"


def _mtime_ns(path: Path) -> int:
    """文件 mtime（纳秒）；文件不存在返回 -1，使"后来创建"必然触发缓存失效。"""
    try:
        return path.stat().st_mtime_ns
    except OSError:
        return -1


def _read_json(path: Path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None


def _read_yaml(path: Path):
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


# ─── meta.json 清单（对应 core metadata.py 的读路径）────────────────────────────

def list_scenarios() -> list[dict]:
    scenarios = []
    if not ONTO_MARKET_DIR.exists():
        return scenarios
    for d in ONTO_MARKET_DIR.iterdir():
        if not d.is_dir():
            continue
        data = _read_json(d / "meta.json")
        if isinstance(data, dict):
            scenarios.append(data)
    scenarios.sort(key=lambda s: s.get("updated_at", ""), reverse=True)
    return scenarios


def list_all_ontologies() -> list[dict]:
    """跨场景全量本体清单（meta.json + scenario_name/ontology_name  enrichment）。"""
    results = []
    if not ONTO_MARKET_DIR.exists():
        return results
    for scenario_dir in sorted(ONTO_MARKET_DIR.iterdir()):
        if not scenario_dir.is_dir():
            continue
        for ontology_dir in sorted(scenario_dir.iterdir()):
            if not ontology_dir.is_dir():
                continue
            data = _read_json(ontology_dir / "meta.json")
            if not isinstance(data, dict) or "scenario_id" not in data:
                continue
            data["scenario_name"] = scenario_dir.name
            data["ontology_name"] = ontology_dir.name
            results.append(data)
    results.sort(key=lambda o: o.get("updated_at", ""), reverse=True)
    return results


def get_ontology_names(ontology_id: int) -> tuple[str, str] | None:
    """ontology_id → (scenario_name, ontology_name)；未找到返回 None。"""
    for o in list_all_ontologies():
        if o.get("id") == ontology_id:
            return o["scenario_name"], o["ontology_name"]
    return None


# ─── 本体数据（ontology.yaml + data_engines.yaml + securities.yaml 三文件合并）────

def _ontology_dir(scenario_name: str, ontology_name: str) -> Path:
    return ONTO_MARKET_DIR / scenario_name / ontology_name


def ontology_fingerprint() -> tuple[int, int]:
    """(文件数, 最大 mtime_ns)。仅 stat 不解析，供工具清单级缓存的指纹。

    覆盖新增/删除（文件数变化）与编辑（mtime 变化）；函数 .py 代码文件不影响
    工具清单（name/desc/params 都在 ontology.yaml），有意不纳入。
    """
    count, latest = 0, -1
    if ONTO_MARKET_DIR.exists():
        for p in ONTO_MARKET_DIR.rglob("*"):
            if p.is_file() and p.name in ("ontology.yaml", "meta.json"):
                count += 1
                m = p.stat().st_mtime_ns
                if m > latest:
                    latest = m
    return count, latest


# 按 (scenario, ontology) 缓存，ontology.yaml + data_engines.yaml + securities.yaml 三 mtime 失效。
_ontology_cache: dict[tuple[str, str], tuple[int, int, int, dict]] = {}


def load_ontology_data(scenario_name: str, ontology_name: str) -> dict:
    """读取一个本体的完整数据（plain dict）。文件不存在返回空结构。

    data_engines / securities 独立文件存在则以其为准，否则回退 ontology.yaml 旧段
    （与 core 读时兼容口径一致）。返回值为缓存共享对象——运行面只读，禁止 mutate。
    """
    base = _ontology_dir(scenario_name, ontology_name)
    yaml_path = base / "ontology.yaml"
    engines_path = base / "data_engines.yaml"
    securities_path = base / "securities.yaml"
    key = (scenario_name, ontology_name)
    fp = (_mtime_ns(yaml_path), _mtime_ns(engines_path), _mtime_ns(securities_path))
    hit = _ontology_cache.get(key)
    if hit and hit[:3] == fp:
        return hit[3]

    data = _read_yaml(yaml_path) if yaml_path.exists() else None
    if not isinstance(data, dict):
        data = {}
    if engines_path.exists():
        raw = _read_yaml(engines_path) or {}
        items = raw.get("data_engines", []) if isinstance(raw, dict) else raw
        data["data_engines"] = items or []
    if securities_path.exists():
        raw = _read_yaml(securities_path) or {}
        items = raw.get("securities", []) if isinstance(raw, dict) else raw
        data["securities"] = items or []
    _ontology_cache[key] = (*fp, data)
    return data


def load_ontology_data_by_id(ontology_id: int) -> tuple[dict, str, str]:
    """ontology_id → (data, scenario_name, ontology_name)；本体不存在抛 KeyError。"""
    names = get_ontology_names(ontology_id)
    if names is None:
        raise KeyError(f"本体不存在: ontology_id={ontology_id}")
    return load_ontology_data(*names), names[0], names[1]


# ─── 公共函数 manifest ─────────────────────────────────────────────────────────

def load_common_function_entries() -> list[dict]:
    """读取 common_functions/functions.json（不存在/损坏返回 []）。"""
    data = _read_json(COMMON_MANIFEST_PATH)
    return data if isinstance(data, list) else []


def common_manifest_mtime() -> int:
    return _mtime_ns(COMMON_MANIFEST_PATH)


def common_function_code_path(func_name: str) -> Path:
    return COMMON_DIR / f"{func_name}.py"


def ontology_function_code_path(scenario_name: str, ontology_name: str, func_name: str) -> Path:
    return _ontology_dir(scenario_name, ontology_name) / "functions" / f"{func_name}.py"
