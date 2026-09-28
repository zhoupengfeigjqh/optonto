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

    数据引擎是物理集成绑定（目标 MCP 工具+映射），与本体语义模型
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
def _resolve_op_type(behavior, engines: list[DataEngineItem]) -> str:
    """推导行为操作类型：op_type 显式值为准；空 → query。

    数据引擎唯一形态为 MCP（SQL/HTTP 已删除），无 method 语义可推导——
    写行为必须在行为上显式 op_type=command。
    """
    if behavior.op_type in ("command", "query"):
        return behavior.op_type
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


# ─── Ontology Versions（版本存档目录管理） ──────────────────────────────────────


def _get_ontology_versions_dir(scenario_name: str, ontology_name: str) -> Path:
    """获取本体版本存档目录路径（与 ontology.yaml 同级的 ontology_versions/）。"""
    return _get_ontology_dir(scenario_name, ontology_name) / "ontology_versions"


def _get_version_dir(scenario_name: str, ontology_name: str, version: str) -> Path:
    """获取指定版本的存档目录路径。"""
    return _get_ontology_versions_dir(scenario_name, ontology_name) / version


def version_exists(scenario_name: str, ontology_name: str, version: str) -> bool:
    """检查指定版本是否已存档（三个文件均存在才算）。"""
    vdir = _get_version_dir(scenario_name, ontology_name, version)
    return all((vdir / f).exists() for f in ("ontology.yaml", "securities.yaml", "data_engines.yaml"))


def save_ontology_version(scenario_name: str, ontology_name: str, version: str, data: OntologyData) -> None:
    """将合并后的本体数据保存到 ontology_versions/{version}/ 三个 yaml 文件。

    逻辑与 save_ontology_data 一致：数据引擎/安全管控拆写独立文件。
    """
    vdir = _get_version_dir(scenario_name, ontology_name, version)
    vdir.mkdir(parents=True, exist_ok=True)

    # 在 metadata 中固化场景/本体名称与 id
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
    data.metadata.pop("name", None)
    data.metadata["scenario_name"] = scenario_name
    data.metadata["scenario_id"] = scenario_id
    data.metadata["ontology_name"] = ontology_name
    data.metadata["ontology_id"] = ontology_id

    # 数据引擎/安全管控拆写
    engines = data.data_engines
    data.securities = _sync_securities_roster(data)
    ontology_data = data.model_copy(update={"data_engines": [], "securities": []})
    ontology_dict = ontology_data.model_dump(exclude_none=True)
    ontology_dict.pop("data_engines", None)
    ontology_dict.pop("securities", None)

    with open(vdir / "ontology.yaml", "w", encoding="utf-8") as f:
        yaml.dump(ontology_dict, f, default_flow_style=False, allow_unicode=True, sort_keys=False)
    with open(vdir / "data_engines.yaml", "w", encoding="utf-8") as f:
        yaml.dump({"data_engines": [e.model_dump(exclude_none=True) for e in engines]}, f, default_flow_style=False, allow_unicode=True, sort_keys=False)
    with open(vdir / "securities.yaml", "w", encoding="utf-8") as f:
        yaml.dump({"securities": [s.model_dump(exclude_none=True) for s in data.securities]}, f, default_flow_style=False, allow_unicode=True, sort_keys=False)


def load_ontology_version(scenario_name: str, ontology_name: str, version: str) -> OntologyData:
    """从 ontology_versions/{version}/ 读取三个 yaml 文件，合并为 OntologyData。

    如果版本目录不存在或文件不全，抛出 FileNotFoundError。
    """
    vdir = _get_version_dir(scenario_name, ontology_name, version)
    if not vdir.exists():
        raise FileNotFoundError(f"本体版本目录不存在: {vdir}")

    data = OntologyData()

    # 读取 ontology.yaml
    onto_path = vdir / "ontology.yaml"
    if onto_path.exists():
        with open(onto_path, "r", encoding="utf-8") as f:
            raw = yaml.safe_load(f) or {}
        data = OntologyData(**raw)

    # 读取 securities.yaml
    sec_path = vdir / "securities.yaml"
    if sec_path.exists():
        with open(sec_path, "r", encoding="utf-8") as f:
            raw = yaml.safe_load(f) or {}
        items = raw.get("securities", []) if isinstance(raw, dict) else raw
        if items:
            data.securities = [SecurityItem(**e) for e in items]

    # 读取 data_engines.yaml
    de_path = vdir / "data_engines.yaml"
    if de_path.exists():
        with open(de_path, "r", encoding="utf-8") as f:
            raw = yaml.safe_load(f) or {}
        items = raw.get("data_engines", []) if isinstance(raw, dict) else raw
        if items:
            data.data_engines = [DataEngineItem(**e) for e in items]

    return data


def copy_ontology_to_deploy(scenario_name: str, ontology_name: str, version: str) -> None:
    """将 ontology_versions/{version}/ 的三个文件复制到部署目录，覆盖现有文件。"""
    vdir = _get_version_dir(scenario_name, ontology_name, version)
    if not vdir.exists():
        raise FileNotFoundError(f"版本目录不存在: {vdir}")

    deploy_dir = _get_ontology_dir(scenario_name, ontology_name)
    deploy_dir.mkdir(parents=True, exist_ok=True)

    for fname in ("ontology.yaml", "securities.yaml", "data_engines.yaml"):
        src = vdir / fname
        dst = deploy_dir / fname
        if src.exists():
            import shutil
            shutil.copy2(src, dst)


def backup_deploy_to_version(scenario_name: str, ontology_name: str, version: str) -> None:
    """将当前部署目录的三个文件备份到 ontology_versions/{version}/。

    用于部署前备份当前版本。如目标版本目录已存在则覆盖。
    """
    if not version:
        return
    vdir = _get_version_dir(scenario_name, ontology_name, version)
    vdir.mkdir(parents=True, exist_ok=True)

    deploy_dir = _get_ontology_dir(scenario_name, ontology_name)
    import shutil
    for fname in ("ontology.yaml", "securities.yaml", "data_engines.yaml"):
        src = deploy_dir / fname
        dst = vdir / fname
        if src.exists():
            shutil.copy2(src, dst)


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


# 函数沙箱（build_restricted_globals / run 入口）已迁至 mcp-shared/sandbox.py，
# 由 ontology-mcp 本地执行；core 仅保留保存期静态校验 _validate_function_code（routers/functions.py）。