"""直读 .data + mtime 指纹热加载（运行面唯一数据源）。

与 core-backend 的唯一耦合是 .data 文件契约：meta.json（场景花名册与本体注册）、
ontology.yaml（语义模型 + **本体身份**）、data_engines.yaml / securities.yaml（独立文件，单一权威）。

**身份四元组唯一读取来源 = ontology.yaml 的 ``metadata``（2026-10-01 统一）**：
``scenario_name`` / ``scenario_id`` / ``ontology_name`` / ``ontology_id`` 以及本体名 ``name``
一律从 metadata 读，**不用目录名或 meta.json 兜底**（与 core ``repositories/metadata`` 同口径）。
写入侧保证其恒新：core 新建本体即落 metadata；改名（场景/本体）与部署后由
``repositories.metadata.refresh_identity_metadata`` 回刷；metadata 缺失或与目录名不一致 →
该本体跳过并告警（不静默兜底，避免两种语义并存）。

``deployed_version`` 同样读自 metadata：版本是"部署状态"，事实源在部署产物与
``ontology_versions/`` 存档，不写进 meta.json。``list_scenarios`` 仍读场景级 meta.json——
场景没有 ontology.yaml，且那不属于"本体身份"读取。

运行面只读不写；缓存按三文件 mtime 失效，与 core services.load_ontology_data 同语义。

返回全部是 plain dict（yaml.safe_load / json.load 原物），不依赖 core 的 pydantic schemas——
运行面只读取字段，不参与设计期校验。
"""

import json
import os
import sys
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


# ─── 场景花名册（场景级 meta.json；场景没有 ontology.yaml，不属"本体身份"读取）──────

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


# ─── 本体身份四元组：唯一读取来源 = ontology.yaml.metadata（与 core repositories/metadata 同口径）──
_IDENTITY_KEYS = ("scenario_name", "scenario_id", "ontology_name", "ontology_id")


def _ontology_metadata(scenario_name: str, ontology_name: str) -> dict:
    """`<本体>/ontology.yaml` 的 metadata 段（经 load_ontology_data 的 mtime 缓存；缺失/损坏 → {}）。

    走缓存而非每次重新解析：本函数经 list_all_ontologies 进入 get_ontology_names，
    而后者在**每次函数/行为调用的路由前置**热路径上。
    """
    try:
        data = load_ontology_data(scenario_name, ontology_name)
    except Exception:      # 损坏的 yaml 不得影响清单与路由
        return {}
    md = data.get("metadata") if isinstance(data, dict) else None
    return md if isinstance(md, dict) else {}


def _identity_from_metadata(md: dict, scenario_dir_name: str,
                            ontology_dir_name: str) -> dict | None:
    """metadata 段 → 身份四元组；任一项为空或与所在目录名不一致 → None（调用方跳过并告警）。"""
    ident = {k: md.get(k) for k in _IDENTITY_KEYS}
    if any(v is None or v == "" for v in ident.values()):
        return None
    if ident["scenario_name"] != scenario_dir_name or ident["ontology_name"] != ontology_dir_name:
        return None
    return ident


def ontology_identity(scenario_name: str, ontology_name: str) -> dict | None:
    """本体身份四元组（唯一来源 = ontology.yaml.metadata）；不可信时 None。"""
    return _identity_from_metadata(_ontology_metadata(scenario_name, ontology_name),
                                    scenario_name, ontology_name)


def list_all_ontologies() -> list[dict]:
    """跨场景全量本体清单（身份与本体名取自 ontology.yaml.metadata）。

    meta.json 只贡献非身份字段（description / creator / created_at / updated_at）与
    "本体存在"的注册判据；身份缺失或与目录名不一致的本体**跳过并告警**（不兜底推导，
    见模块 docstring 的统一口径）。
    """
    results = []
    if not ONTO_MARKET_DIR.exists():
        return results
    for scenario_dir in sorted(ONTO_MARKET_DIR.iterdir()):
        if not scenario_dir.is_dir():
            continue
        for ontology_dir in sorted(scenario_dir.iterdir()):
            if not ontology_dir.is_dir():
                continue
            meta = _read_json(ontology_dir / "meta.json")
            if not isinstance(meta, dict):
                continue
            md = _ontology_metadata(scenario_dir.name, ontology_dir.name)
            ident = _identity_from_metadata(md, scenario_dir.name, ontology_dir.name)
            if ident is None:
                print(f"[data_store] 本体 {scenario_dir.name}/{ontology_dir.name} 的 ontology.yaml.metadata "
                      f"缺失或与目录名不一致，已跳过（身份唯一来源 = metadata）", file=sys.stderr)
                continue
            row = dict(meta)                      # 非身份字段
            row.update(ident)                     # 身份四元组：metadata 覆盖
            row["id"] = ident["ontology_id"]      # id 键（工具/路由/get_ontology_names 用）同样只认 metadata
            row["name"] = ident["ontology_name"]  # 本体名同样只认 metadata
            row["deployed_version"] = str(md.get("deployed_version") or "")
            results.append(row)
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


def ontology_market_fingerprint() -> tuple[int, int]:
    """**全体本体文件**的变更指纹 (文件数, 最大 mtime_ns)：仅 stat 不解析，供工具清单级缓存失效。

    范围是 `onto_market` 下**全部** `ontology.yaml` + `meta.json`（不是某一个本体的指纹，
    故无参数）；覆盖新增/删除（文件数变化）与编辑（mtime 变化）；函数 .py 代码文件不影响
    工具清单（name/desc/params 都在 ontology.yaml），有意不纳入。

    同时纳入 meta.json：它虽不再是身份来源，但仍是"本体存在"的注册判据与目录改名的
    触发点之一（改名会移动目录并回刷 ontology.yaml.metadata，两者都会改变指纹）。
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


def deployed_version_of(scenario_name: str, ontology_name: str) -> str:
    """已部署版本号（ontology.yaml 的 metadata.deployed_version）；缺失/损坏返回空串。

    与身份四元组共用同一读取通道（``_ontology_metadata``，mtime 缓存），
    口径与 core ``repositories/metadata.list_all_ontologies`` 一致（读时派生，不落盘）。
    """
    return str(_ontology_metadata(scenario_name, ontology_name).get("deployed_version") or "")


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
