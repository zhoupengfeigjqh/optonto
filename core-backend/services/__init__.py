"""Service for reading/writing ontology YAML files."""

import os
import re
from pathlib import Path
from typing import Optional

import yaml

from config import ONTO_MARKET_DIR
from schemas import DataEngineItem, OntologyData, SecurityItem

# 顶层节名：`key:` 且顶格（无缩进），排除注释行
_TOP_KEY_RE = re.compile(r"^[A-Za-z_][\w-]*:", re.MULTILINE)


def split_yaml_top_sections(text: str) -> list[tuple[str, str]]:
    """按顶层 `key:` 切分 YAML 文本，返回 [(节名, 该节完整原文)]。

    首个顶层 key 之前的内容（文件头注释等）忽略。用文本切分而非 yaml.load+dump，
    以保留模板原始排版与注释。
    """
    lines = text.split("\n")
    bounds = [i for i, line in enumerate(lines)
              if line and not line[0].isspace() and _TOP_KEY_RE.match(line)]
    sections: list[tuple[str, str]] = []
    for n, start in enumerate(bounds):
        end = bounds[n + 1] if n + 1 < len(bounds) else len(lines)
        seg = "\n".join(lines[start:end]).rstrip("\n")
        sections.append((seg.split(":", 1)[0].strip(), seg))
    return sections


def slice_yaml_sections(text: str, keep: list[str]) -> str:
    """只保留 keep 中的顶层节（按模板原有顺序）；keep 为空或无一命中时回退原文。

    用于「本体生成」时按用户勾选的一级目录裁剪提示词模板，避免模型看到无关节
    后被诱导输出与本次需求文档无关的内容。
    """
    sections = split_yaml_top_sections(text)
    if not sections:
        return text
    kept = [seg for key, seg in sections if key in keep]
    return "\n".join(kept) if kept else text


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


def _get_securities_path(scenario_name: str, ontology_name: str) -> Path:
    """行为安全管控独立文件路径（与 ontology.yaml 同目录）。

    安全管控（权限范围/人工确认）是运行面治理配置，与本体语义模型职责不同、
    变更频率不同，单独存放；文件为全花名册（每行为一条六字段记录），保存时
    自动同步行为增删并刷新 display_name/op_type 快照；ontology.yaml 中的
    securities 段仅作迁移前的读时兼容回退，保存后固定清空（单一权威来源）。
    """
    return _get_ontology_dir(scenario_name, ontology_name) / "securities.yaml"


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


def _load_securities_file(scenario_name: str, ontology_name: str) -> Optional[list[SecurityItem]]:
    """读取独立安全管控文件；文件不存在返回 None（调用方回退 ontology.yaml 旧段）。

    兼容两种形态：顶层 securities: 列表（标准），或整个文件就是一个列表。
    解析失败抛错给调用方——宁可报错也不静默回退到旧段（避免新旧内容不一致难排查）。
    """
    path = _get_securities_path(scenario_name, ontology_name)
    if not path.exists():
        return None
    with open(path, "r", encoding="utf-8") as f:
        raw = yaml.safe_load(f) or {}
    items = raw.get("securities", []) if isinstance(raw, dict) else raw
    return [SecurityItem(**e) for e in (items or [])]


# 与前端 resolveOpType / agent ontology-gateway isWrite 同一推导规则
_WRITE_METHODS = {"POST", "PATCH", "DELETE", "PUT"}


def _resolve_op_type(behavior, engines: list[DataEngineItem]) -> str:
    """推导行为操作类型：op_type 显式值优先；空则查数据引擎，非 SQL 且 method 为写方法 → command，否则 query。"""
    if behavior.op_type in ("command", "query"):
        return behavior.op_type
    eng = next((d for d in engines if d.behavior_name == behavior.name), None)
    if eng and eng.engine_type != "SQL" and (eng.target.method or "").upper() in _WRITE_METHODS:
        return "command"
    return "query"


def _sync_securities_roster(data: OntologyData) -> list[SecurityItem]:
    """全花名册同步：每个行为恒定一条记录。

    已有条目保留 scope/confirm/confirm_content 配置，display_name/op_type 快照强制刷新；
    新行为补默认条目（scope=everyone，confirm=command?True:False）；已删行为的条目移除。
    """
    existing = {s.action_name: s for s in data.securities}
    roster = []
    for b in data.behaviors:
        op = _resolve_op_type(b, data.data_engines)
        sec = existing.get(b.name)
        if sec is None:
            sec = SecurityItem(action_name=b.name, scope=["everyone"], confirm=(op == "command"), confirm_content="")
        sec.display_name = b.display_name or b.name
        sec.op_type = op
        roster.append(sec)
    return roster


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
    # 安全管控独立存放：securities.yaml 存在则以其为准，否则回退 ontology.yaml 旧段
    securities = _load_securities_file(scenario_name, ontology_name)
    if securities is not None:
        data.securities = securities
    return data


def _mtime_ns(path: Path) -> int:
    """文件 mtime（纳秒）；文件不存在返回 -1，使"后来创建"必然触发缓存失效。"""
    try:
        return path.stat().st_mtime_ns
    except OSError:
        return -1


# 按 (scenario, ontology) 缓存解析结果，ontology.yaml + data_engines.yaml + securities.yaml 三 mtime 失效。
# 与 agent-backend OntologyGateway 的缓存语义一致；本进程保存时主动失效（见 save/write_yaml_raw），
# mtime 同时兜底进程外编辑（手动改文件、git pull）。
_ontology_cache: dict[tuple[str, str], tuple[int, int, int, OntologyData]] = {}


def load_ontology_data(scenario_name: str, ontology_name: str) -> OntologyData:
    """Load ontology data from YAML file. Returns empty data if file doesn't exist.

    mtime 缓存命中时返回深拷贝——调用方会直接 mutate 返回对象（CRUD append/赋值），
    必须隔离缓存原件，否则未保存的修改会污染缓存。
    """
    key = (scenario_name, ontology_name)
    yaml_mtime = _mtime_ns(_get_yaml_path(scenario_name, ontology_name))
    engines_mtime = _mtime_ns(_get_data_engines_path(scenario_name, ontology_name))
    securities_mtime = _mtime_ns(_get_securities_path(scenario_name, ontology_name))
    hit = _ontology_cache.get(key)
    if hit and hit[0] == yaml_mtime and hit[1] == engines_mtime and hit[2] == securities_mtime:
        return hit[3].model_copy(deep=True)
    data = _load_ontology_data_uncached(scenario_name, ontology_name)
    _ontology_cache[key] = (yaml_mtime, engines_mtime, securities_mtime, data)
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
    # name 已废弃（本体名以 meta.json / metadata.ontology_name 为准），保存时清除历史遗留值
    data.metadata.pop("name", None)
    data.metadata["scenario_name"] = scenario_name
    data.metadata["scenario_id"] = scenario_id
    data.metadata["ontology_name"] = ontology_name
    data.metadata["ontology_id"] = ontology_id

    # 数据引擎/安全管控拆写到独立文件；ontology.yaml 彻底不含这两个键（唯一权威来源 = 独立文件）。
    # 安全管控先做全花名册同步（补新行为默认条目、刷新 display_name/op_type 快照、移除已删行为），
    # 并回写 data.securities 让调用方在同一请求内读到同步后的结果。
    # 用 model_copy 避免改动调用方对象的其他部分（路由在 save 后仍可能读取 data.data_engines）。
    engines = data.data_engines
    data.securities = _sync_securities_roster(data)
    ontology_data = data.model_copy(update={"data_engines": [], "securities": []})
    ontology_dict = ontology_data.model_dump(exclude_none=True)
    ontology_dict.pop("data_engines", None)
    ontology_dict.pop("securities", None)

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

    with open(_get_securities_path(scenario_name, ontology_name), "w", encoding="utf-8") as f:
        yaml.dump(
            {"securities": [s.model_dump(exclude_none=True) for s in data.securities]},
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

    白名单含常用异常类型与 set/frozenset：函数代码需要 try/except Exception 兜错误契约、
    以及 isinstance(obj, (set, frozenset)) 类型判断（filterData/aggregateData/groupReduce 用到）。
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
            "set": set, "frozenset": frozenset,
            "Exception": Exception, "ValueError": ValueError, "TypeError": TypeError,
            "KeyError": KeyError, "IndexError": IndexError,
            "type": type, "zip": zip, "map": map, "filter": filter, "reversed": reversed,
            "True": True, "False": False, "None": None,
            "__import__": __import__, "print": print,
        },
    }
