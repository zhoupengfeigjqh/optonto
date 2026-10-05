"""需求线程（threads/demand）存储层 —— 该领域**唯一**的文件读写出口。

分层（章程 II）：接口层（``routers.threads`` / ``routers.chat`` / ``routers.deploy``）一律经本模块，
不再直连 ``repositories``；三个 router 也不再互相 import 私有函数。

目录布局：``.data/threads/demand/{thread_id}/``
- ``.data.json``：线程元数据（id / title / status / version / messages / 身份四元组）
- ``{本体名}_{内容}.md``：需求文档（导出产物）
- ``{本体名}_{内容}.yaml``：由该需求生成的本体分片（生成产物；部署时合并）

失败语义：不存在 → ``NotFoundError``（404）；数据损坏/模板缺失 → ``InternalError``（500）；
入参不合法 → ``InvalidInputError``（400）。
"""

import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator, Optional

from config import DATA_DIR, DEMAND_THREADS_DIR
from errors import InternalError, InvalidInputError, NotFoundError
from repositories import fs_store
from repositories.metadata import ontology_identity_by_name

# 本体 YAML 模板（「本体生成」勾选范围与生成基线）
ONTOLOGY_TEMPLATE_PATH = DATA_DIR / "templates" / "onto_template.yaml"

# 需求文档保留名：与线程元数据文件冲突
_RESERVED_CONTENT_NAMES = {"data"}


# ─── 目录与线程元数据 ───────────────────────────────────────────────────────────

def thread_dir(thread_id: str) -> Path:
    """需求线程目录（扁平位于 threads/demand/ 下）。"""
    return DEMAND_THREADS_DIR / thread_id


def _thread_path(thread_id: str) -> Path:
    return thread_dir(thread_id) / ".data.json"


def all_thread_dirs(scenario: str = "", ontology: str = "") -> list[tuple[Path, str, str]]:
    """扫描全部需求线程目录，按 updated 时间倒序返回 (目录, 场景名, 本体名)。

    可按场景/本体过滤（过滤依据 = 线程 ``.data.json`` 内记录的名称）。
    """
    results: list[tuple[Path, str, str]] = []
    if not fs_store.exists(DEMAND_THREADS_DIR):
        return results
    dirs = [d for d in fs_store.list_dir(DEMAND_THREADS_DIR) if d.is_dir()]
    for tdir in sorted(dirs, key=lambda p: p.stat().st_mtime, reverse=True):
        data = fs_store.read_json(tdir / ".data.json")
        if not isinstance(data, dict):
            continue
        sc = data.get("scenario_name", "")
        onto = data.get("ontology_name", "")
        if scenario and sc != scenario:
            continue
        if ontology and onto != ontology:
            continue
        results.append((tdir, sc, onto))
    return results


def iter_thread_dirs() -> Iterator[Path]:
    """全部需求线程目录（未过滤；生成器）——供部署版本归集等跨线程扫描使用。"""
    if not fs_store.exists(DEMAND_THREADS_DIR):
        return
    for d in fs_store.list_dir(DEMAND_THREADS_DIR):
        if d.is_dir():
            yield d


def read_thread_json(tdir: Path) -> Optional[dict]:
    """读取线程 ``.data.json``（缺失/损坏 → None）。"""
    data = fs_store.read_json(tdir / ".data.json")
    return data if isinstance(data, dict) else None


def find_thread(thread_id: str) -> tuple[Path, str, str]:
    """定位线程：返回 (目录, 场景名, 本体名)；不存在 → 404；元数据损坏 → 500。"""
    tdir = thread_dir(thread_id)
    path = tdir / ".data.json"
    if not fs_store.exists(path):
        raise NotFoundError("对话不存在")
    # 文件存在却解析不出内容 = 数据损坏，与「不存在」区分开，避免用 404 掩盖故障
    data = fs_store.read_json(path)
    if not isinstance(data, dict):
        raise InternalError("对话数据损坏")
    return tdir, data.get("scenario_name", ""), data.get("ontology_name", "")


def load_thread(thread_id: str) -> tuple[dict, str, str]:
    """读取线程完整数据：返回 (data, 场景名, 本体名)。"""
    tdir, sc, onto = find_thread(thread_id)
    data = fs_store.read_json(tdir / ".data.json")
    if not isinstance(data, dict):
        raise InternalError("对话数据损坏")
    return data, sc, onto


def save_thread(data: dict) -> None:
    """保存线程数据（要求含场景名与本体名）。"""
    sc = data.get("scenario_name", "")
    onto = data.get("ontology_name", "")
    if not sc or not onto:
        raise InvalidInputError("缺少场景或本体名称")
    fs_store.write_json(_thread_path(data["id"]), data)


def delete_thread_dir(thread_id: str) -> None:
    """删除线程目录及其全部内容（不存在 → 404）。"""
    tdir, _, _ = find_thread(thread_id)
    fs_store.delete_tree(tdir)


def resolve_ids(scenario_name: str, ontology_name: str) -> tuple[Optional[int], Optional[int]]:
    """(scenario_id, ontology_id)：**身份唯一来源 = ontology.yaml.metadata**；不可信时 (None, None)。

    线程/对话记录要落 id 时统一走这里（与清单、依赖注入同一口径），不读 meta.json/目录名。
    """
    try:
        ident = ontology_identity_by_name(scenario_name, ontology_name)
        if not ident:
            return None, None
        return int(ident["scenario_id"]), int(ident["ontology_id"])
    except Exception:
        return None, None


def create_thread(*, title: str, scenario_name: str, ontology_name: str, version: str) -> dict:
    """新建线程（校验入参 → 落盘 → 返回线程对象）。"""
    if not version:
        raise InvalidInputError("请提供版本号(version)")
    if not scenario_name or not ontology_name:
        raise InvalidInputError("请提供场景名称(scenario_name)和本体名称(ontology_name)")
    now = datetime.now(timezone.utc).isoformat()
    scenario_id, ontology_id = resolve_ids(scenario_name, ontology_name)
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
    save_thread(thread)
    return thread


def list_threads(scenario: str = "", ontology: str = "") -> list[dict]:
    """线程列表（对外视图）：旧线程缺 id 时按名称从 ontology.yaml.metadata 解析兜底。"""
    threads: list[dict] = []
    for tdir, sc_name, onto_name in all_thread_dirs(scenario, ontology):
        data = fs_store.read_json(tdir / ".data.json")
        if not isinstance(data, dict):
            continue
        scenario_id = data.get("scenario_id")
        ontology_id = data.get("ontology_id")
        if scenario_id is None or ontology_id is None:
            sid, oid = resolve_ids(sc_name, onto_name)
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


def get_thread(thread_id: str, scenario: str = "", ontology: str = "") -> dict:
    """线程详情；给定场景/本体时校验归属（不符 → 404）；旧线程补 id。"""
    data, sc, onto = load_thread(thread_id)
    if scenario and sc != scenario:
        raise NotFoundError("对话不存在")
    if ontology and onto != ontology:
        raise NotFoundError("对话不存在")
    data["scenario_name"] = sc
    data["ontology_name"] = onto
    if "scenario_id" not in data or "ontology_id" not in data:
        sid, oid = resolve_ids(sc, onto)
        data["scenario_id"] = data.get("scenario_id", sid)
        data["ontology_id"] = data.get("ontology_id", oid)
    return data


def update_thread(thread_id: str, *, title=None, status=None) -> dict:
    """更新线程标题/状态（None = 不改）。"""
    data, _, _ = load_thread(thread_id)
    if title is not None:
        data["title"] = title
    if status is not None:
        data["status"] = status
    data["updated_at"] = datetime.now(timezone.utc).isoformat()
    save_thread(data)
    return data


def clear_messages(thread_id: str) -> None:
    """清空线程消息但保留线程本身。"""
    data, _, _ = load_thread(thread_id)
    data["messages"] = []
    data["updated_at"] = datetime.now(timezone.utc).isoformat()
    save_thread(data)


def mark_documented(thread: dict) -> None:
    """标记线程为「已出文档」并落盘（导出/生成本体后调用）。"""
    thread["status"] = "documented"
    thread["updated_at"] = datetime.now(timezone.utc).isoformat()
    save_thread(thread)


# ─── 本体模板 ───────────────────────────────────────────────────────────────────

def read_template_text() -> str:
    """读取本体 YAML 模板全文（缺失 → 500）。"""
    if not fs_store.exists(ONTOLOGY_TEMPLATE_PATH):
        raise InternalError("本体模板文件不存在")
    return fs_store.read_text(ONTOLOGY_TEMPLATE_PATH)


def template_sections() -> list[str]:
    """模板的一级目录名（供前端「本体生成」勾选范围，动态解析而非硬编码）。"""
    from services import split_yaml_top_sections  # 延迟导入：避免与 services 包初始化顺序耦合

    return [key for key, _ in split_yaml_top_sections(read_template_text())]


# ─── 需求文件（md / yaml 分片） ─────────────────────────────────────────────────

def yaml_source_map(tdir: Path) -> dict[str, str]:
    """线程目录内 yaml → {yaml 文件名: metadata.source_file}（解析失败/无 metadata 记空串）。"""
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


def match_ontology_yaml(tdir: Path, req_name: str, filename: str, source_map: dict[str, str]) -> str:
    """该需求 md 对应的本体 yaml 是否已生成，返回匹配的 yaml 文件名（无则空串）。

    两级判定：① 同名优先（``{req_name}.yaml``）；② ``metadata.source_file`` 回退。
    两条都不中即视为未生成。
    """
    same_name = f"{req_name}.yaml"
    if fs_store.exists(tdir / same_name):
        return same_name
    for yaml_name, source_file in source_map.items():
        if source_file == filename:
            return yaml_name
    return ""


def list_md_files(tdir: Path) -> list[Path]:
    """线程目录内的需求文档（*.md）。"""
    return fs_store.list_files(tdir, "*.md")


def read_yaml_dict(path: Path) -> dict:
    """读取分片 yaml 为 dict（非 dict / 空文件 → 空 dict）。"""
    raw = fs_store.read_yaml(path)
    return raw if isinstance(raw, dict) else {}


def read_requirement_md(thread_id: str, filename: str) -> str:
    """读取需求文档内容（不存在 → 404）。"""
    tdir, _, _ = find_thread(thread_id)
    path = tdir / filename
    if not fs_store.exists(path):
        raise NotFoundError("需求文件不存在")
    return fs_store.read_text(path)


def write_requirement_md(thread_id: str, filename: str, content: str) -> Path:
    """写入需求文档（同名覆盖），返回文件路径。"""
    tdir, _, _ = find_thread(thread_id)
    path = tdir / filename
    fs_store.write_text(path, content)
    return path


def get_requirement_file(thread_id: str, filename: str) -> dict:
    """需求文档读取视图（不存在 → 404）。"""
    tdir, _, _ = find_thread(thread_id)
    path = tdir / filename
    if not fs_store.exists(path):
        raise NotFoundError("文件不存在")
    return {"content": fs_store.read_text(path), "filename": filename, "thread_id": thread_id}


def save_requirement_file(thread_id: str, filename: str, content: str) -> None:
    """保存需求文档（同名覆盖）。"""
    tdir, _, _ = find_thread(thread_id)
    fs_store.write_text(tdir / filename, content)


def delete_requirement_file(thread_id: str, filename: str) -> None:
    """删除需求文档，并连带删除同目录下由它生成的本体 yaml（若存在）。

    不再连带删除本体目录（原逻辑会按 source_file 删掉整个 onto_market 本体，过于危险，已移除）。
    """
    tdir, _, _ = find_thread(thread_id)
    path = tdir / filename
    if not fs_store.exists(path):
        raise NotFoundError("文件不存在")
    if filename.endswith(".md"):
        fs_store.delete_file(tdir / f"{filename[:-3]}.yaml")
    fs_store.delete_file(path)


def write_generated_yaml(thread_id: str, yaml_filename: str, doc: dict) -> Path:
    """写入由需求生成的本体分片 yaml（同名覆盖）。"""
    path = thread_dir(thread_id) / yaml_filename
    fs_store.write_yaml(path, doc)
    return path


def list_requirements(scenario: str = "", ontology: str = "") -> list[dict]:
    """需求文档列表（跨线程扫描 md；``has_ontology`` 实时推导，无持久化状态）。"""
    items: list[dict] = []
    for tdir, sc_name, onto_name in all_thread_dirs(scenario, ontology):
        thread_id = tdir.name
        thread_data = fs_store.read_json(tdir / ".data.json")
        source_map = yaml_source_map(tdir)

        for f in list_md_files(tdir):
            stat = f.stat()
            filename = f.name
            req_name = filename[:-3]

            # 按最后一个 _ 拆分为 本体名_内容；无 _ 的旧文件回退为本体名=线程所属本体、内容=文件名
            if "_" in req_name:
                doc_onto, _, doc_content = req_name.rpartition("_")
            else:
                doc_onto, doc_content = onto_name, req_name

            matched_yaml = match_ontology_yaml(tdir, req_name, filename, source_map)
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


def build_export_doc_name(ontology_name: str, content: str) -> str:
    """校验并组装需求文档名 ``{本体名}_{内容}``（非法 → 400）。"""
    doc_name = f"{ontology_name}_{content}"
    if "/" in doc_name or "\\" in doc_name or doc_name in {".", ".."}:
        raise InvalidInputError("本体名或内容包含非法字符")
    if content.lower() in _RESERVED_CONTENT_NAMES:
        raise InvalidInputError("内容不能使用保留名 data（与线程元数据冲突）")
    if len(doc_name) > 120:
        raise InvalidInputError("本体名+内容过长（超过120字符）")
    return doc_name
