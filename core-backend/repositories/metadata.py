"""场景 / 本体元数据存储（meta.json）—— 数据访问层。

原位于仓库根 ``metadata.py``（历史位置），2026-09-28 归位至数据访问层：
只有本层可直接做文件 I/O（章程 II：接口层–业务层–数据访问层），
业务层与接口层经本模块读写。

替代早期 SQLite + SQLAlchemy 方案，数据以 ``onto_market/{场景}/{本体}/meta.json`` 存放。
id 由扫描现有 meta.json 取最大值 +1 生成（无中心计数器，不引入额外状态）。

**职责边界（2026-10-01 统一）**：meta.json 只负责**注册**（id 分配、创建登记、存在性判据）
与**非身份字段**（description / creator / created_at / updated_at）。本体身份四元组
（scenario_name / scenario_id / ontology_name / ontology_id）与本体名的**唯一读取来源**是
``<本体>/ontology.yaml`` 的 ``metadata``（见 ``read_ontology_identity``）；写入侧由
``create_ontology`` + ``save_ontology_data`` + ``refresh_identity_metadata`` 保证其恒新。
"""

import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from config import ONTO_MARKET_DIR

from . import fs_store

logger = logging.getLogger(__name__)


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


def list_ontology_dir_names(scenario_name: str) -> list[str]:
    """按目录**物理枚举**场景下的本体目录名（不读身份）。

    供"改名回刷"使用：改名后 identity 尚未同步，若走 list_ontologies_by_scenario（读身份）
    会因"与目录不一致"被跳过而自锁（找不到要回刷的对象）。
    """
    return sorted(d.name for d in _iter_dirs(ONTO_MARKET_DIR / scenario_name))


def refresh_identity_metadata(scenario_name: str, ontology_name: str) -> bool:
    """按当前目录名 + 注册表回刷 `<本体>/ontology.yaml` 的 metadata 身份四元组。

    何时需要：**改名（场景/本体）与部署**——两者都会让 yaml 里的身份落后于目录名，
    而身份的唯一读取来源就是 metadata（落后 → 读取侧判为不可信 → 清单/路由整条跳过）。

    只 patch metadata 段并原样写回（不重写语义模型，避免丢失模型中未声明的历史字段）。
    返回 False = 未找到本体目录/ontology.yaml（调用方按需告警）。
    """
    ontology_dir = ONTO_MARKET_DIR / scenario_name / ontology_name
    meta = _read_meta(ontology_dir / "meta.json")
    path = ontology_dir / "ontology.yaml"
    raw = fs_store.read_yaml(path)
    if not meta or not isinstance(raw, dict):
        return False
    scenario_id, ontology_id = registry_ids(scenario_name, ontology_name)
    md = raw.get("metadata")
    if not isinstance(md, dict):
        md = {}
    md["scenario_name"] = scenario_name
    md["scenario_id"] = scenario_id
    md["ontology_name"] = ontology_name
    md["ontology_id"] = ontology_id
    raw["metadata"] = md
    fs_store.write_yaml(path, raw)
    return True


# ─── 本体身份四元组：唯一读取来源 = ontology.yaml.metadata ────────────────────────
# 口径（2026-10-01 统一）：scenario_name / scenario_id / ontology_name / ontology_id（以及本体名 name）
# 一律只从 `<本体>/ontology.yaml` 的 metadata 读；**不再**用目录名或 meta.json 兜底推导。
# 写入侧保证其恒新：create_ontology（路由创建后立即 save_ontology_data）、save_ontology_data、
# 改名（update_scenario / update_ontology 路由）三处都会刷新。

_IDENTITY_KEYS = ("scenario_name", "scenario_id", "ontology_name", "ontology_id")


def _ontology_yaml_path(scenario_name: str, ontology_name: str) -> Path:
    return ONTO_MARKET_DIR / scenario_name / ontology_name / "ontology.yaml"


def _read_ontology_yaml_metadata(ontology_dir: Path) -> dict:
    """读 `<本体>/ontology.yaml` 的 metadata 段（缺失/损坏/非 dict → 空 dict）。"""
    raw = fs_store.read_yaml(ontology_dir / "ontology.yaml")
    md = raw.get("metadata") if isinstance(raw, dict) else None
    return md if isinstance(md, dict) else {}


def read_ontology_identity(ontology_dir: Path, *, scenario_dir_name: str,
                           ontology_dir_name: str) -> Optional[dict]:
    """本体身份四元组（唯一来源 = ontology.yaml.metadata）；不可信时返回 None（调用方跳过并告警）。

    不可信 = metadata 缺失 / 四元组任一项为空 / **与所在目录名不一致**（数据被外部篡改的信号）。
    刻意不做"退回目录名或 meta.json"的兜底：身份只认一个来源，兜底会让两种语义并存（这正是本次要消除的问题）。
    """
    md = _read_ontology_yaml_metadata(ontology_dir)
    ident = {k: md.get(k) for k in _IDENTITY_KEYS}
    if any(v is None or v == "" for v in ident.values()):
        return None
    if ident["scenario_name"] != scenario_dir_name or ident["ontology_name"] != ontology_dir_name:
        return None
    return ident


def list_all_ontologies() -> list[dict]:
    """跨场景全量本体清单。

    身份四元组与本体名 `name` **统一取自 ontology.yaml.metadata**；meta.json 只贡献非身份字段
    （description / creator / created_at / updated_at）与"本体存在"的注册判据。metadata 不可信的本体
    跳过并告警——见 read_ontology_identity 的口径说明。
    """
    results = []
    for scenario_dir in sorted(_iter_dirs(ONTO_MARKET_DIR)):
        for ontology_dir in sorted(_iter_dirs(scenario_dir)):
            meta = _read_meta(ontology_dir / "meta.json")
            if not meta:
                continue
            ident = read_ontology_identity(
                ontology_dir, scenario_dir_name=scenario_dir.name,
                ontology_dir_name=ontology_dir.name)
            if ident is None:
                logger.warning(
                    "本体 %s/%s 的 ontology.yaml.metadata 缺失或与目录名不一致，已跳过（身份以 metadata 为唯一来源）",
                    scenario_dir.name, ontology_dir.name)
                continue
            md = _read_ontology_yaml_metadata(ontology_dir)
            row = dict(meta)                        # 非身份字段
            row.update(ident)                       # 身份四元组：以 metadata 覆盖
            row["id"] = ident["ontology_id"]        # id 键（对外唯一标识）同样只认 metadata
            row["name"] = ident["ontology_name"]    # 本体名同样只认 metadata
            row["deployed_version"] = str(md.get("deployed_version") or "")
            results.append(row)
    results.sort(key=lambda o: o.get("updated_at", ""), reverse=True)
    return results


def get_ontology_by_id(ontology_id: int) -> Optional[tuple[dict, str, str]]:
    """**物理定位**本体（供改名/删除等目录操作）：返回 (meta.json, 场景目录名, 本体目录名)。

    返回的名字是**目录名**（物理路径锚点），用于拼路径/移动目录，不是身份读取出口。
    匹配优先 yaml.metadata.ontology_id（身份唯一来源），再回退注册表 id —— 回退是刻意的：
    身份不可信（如 metadata 名字与目录不一致）时仍要能通过接口改名/删除来修复，否则只能手工改文件。
    """
    for scenario_dir in _iter_dirs(ONTO_MARKET_DIR):
        for ontology_dir in _iter_dirs(scenario_dir):
            meta = _read_meta(ontology_dir / "meta.json")
            if not meta:
                continue
            md = _read_ontology_yaml_metadata(ontology_dir)
            if md.get("ontology_id") == ontology_id or meta.get("id") == ontology_id:
                return meta, scenario_dir.name, ontology_dir.name
    return None


def registry_ids(scenario_name: str, ontology_name: str) -> tuple[Optional[int], Optional[int]]:
    """(scenario_id, ontology_id)：**id 的分配权在注册表**（meta.json，扫描现有 id 取 max+1）。

    yaml.metadata 里的 id 是它的读取镜像；写入侧（``save_ontology_data`` /
    ``refresh_identity_metadata`` / deploy 的 ``_finalize_metadata``）统一经本函数取值，
    避免"多处各自查 id"造成口径分裂。
    """
    scenario = get_scenario_by_name(scenario_name)
    meta = _read_meta(ONTO_MARKET_DIR / scenario_name / ontology_name / "meta.json")
    return (scenario.get("id") if scenario else None), (meta.get("id") if meta else None)


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


def ontology_identity_by_name(scenario_name: str, ontology_name: str) -> Optional[dict]:
    """(场景名, 本体名) → 身份四元组；**唯一来源 = ontology.yaml.metadata**，不可信返回 None。

    供"只有名字、需要 id"的读取方使用（线程/对话记录 id 兜底等）；与 list_all_ontologies 同口径：
    metadata 缺失、四元组不全或与目录名不一致 → 不可信（不做兜底推导）。
    """
    ontology_dir = ONTO_MARKET_DIR / scenario_name / ontology_name
    if not (ontology_dir / "ontology.yaml").exists():
        return None
    return read_ontology_identity(ontology_dir, scenario_dir_name=scenario_name,
                                  ontology_dir_name=ontology_name)


def get_ontology_name_by_id(ontology_id: int) -> Optional[tuple[str, str]]:
    """ontology_id → (scenario_name, ontology_name)：**身份唯一来源 = ontology.yaml.metadata**。

    供 `dependencies.get_ontology_names`（所有按本体操作的路由共用）使用——与清单同一口径：
    身份不可信（metadata 缺失/不全/与目录名不一致）的本体在此等同于"不存在"（调用方 404），
    日志已有对应告警（见 list_all_ontologies）。
    """
    for o in list_all_ontologies():
        if o.get("id") == ontology_id:
            return o["scenario_name"], o["ontology_name"]
    return None
