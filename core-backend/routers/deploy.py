"""本体部署 API：版本合并预览 + 部署到 onto_market。

版本语义：以对话创建时录入的版本号（.data.json 中的 version 字段）为准。
同一版本下的所有已生成 yaml（含 metadata.source_file 回退匹配到的）合并为该版本的完整本体。
合并只发生在部署时的内存里，需求侧分片文件保持不动（单一事实来源）。

功能：
- 本体合并：将 thread 分片合并后输出到 ontology_versions/{version}/ 三个 yaml 文件
- 版本预览：从 ontology_versions 读取已存档版本，或从 thread 合并预览
- 部署：先备份当前部署 → 再将版本目录文件复制到部署目录
"""

import hashlib
import json
from datetime import datetime
from pathlib import Path
from typing import Optional

import yaml
from fastapi import APIRouter, HTTPException

from config import DEMAND_THREADS_DIR
from dependencies import get_ontology_names
from schemas import OntologyData
from services import (
    save_ontology_data,
    save_ontology_version,
    load_ontology_version,
    version_exists,
    copy_ontology_to_deploy,
    backup_deploy_to_version,
    split_yaml_top_sections,
    _get_yaml_path,
    _get_ontology_dir,
)
from routers.threads import _find_thread, _thread_dir, _yaml_source_map, _match_ontology_yaml

router = APIRouter(prefix="/api/ontologies/{ontology_id}/deploy", tags=["本体部署"])

# 合并目标节：securities / data_engines 由 save_ontology_data 派生（全花名册
# 同步 / 独立文件），不从需求 yaml 里带进来（单一权威来源）
_MERGE_SECTIONS = ("concepts", "relations", "functions", "behaviors", "rules", "processes")


def _collect_version_docs(ontology_name: str) -> dict[str, list[dict]]:
    """扫描全部需求线程，收集指定本体下已生成 yaml 的文档，按版本分组。

    版本号取自 thread .data.json 的 version 字段（对话创建时录入）。
    返回 {版本: [{md, yaml, thread_id, thread_title}]}；yaml 匹配规则与
    list_requirements 一致（同名优先 + source_file 回退）。
    """
    by_version: dict[str, list[dict]] = {}
    if not DEMAND_THREADS_DIR.exists():
        return by_version
    for tdir in DEMAND_THREADS_DIR.iterdir():
        if not tdir.is_dir():
            continue
        data_path = tdir / ".data.json"
        if not data_path.exists():
            continue
        try:
            data = json.loads(data_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, KeyError):
            continue
        if data.get("ontology_name") != ontology_name:
            continue

        version = (data.get("version") or "").strip()
        if not version:
            continue

        source_map = _yaml_source_map(tdir)
        for md in sorted(tdir.glob("*.md")):
            req_name = md.name[:-3]
            matched = _match_ontology_yaml(tdir, req_name, md.name, source_map)
            if not matched:
                continue
            by_version.setdefault(version, []).append({
                "md": md.name,
                "yaml": matched,
                "thread_id": tdir.name,
                "thread_title": data.get("title", ""),
            })
    return by_version


def _merge_yaml_files(yaml_paths: list[Path], version: str) -> OntologyData:
    """按模板节顺序合并多个分片 yaml，一级目录去重（名字全局唯一），跳过重复的不再追加。

    metadata 采用继承式：source_file / source_thread / created_at 聚合自各分片的
    真实值（保留分片粒度），而非合成占位符。若某分片缺 metadata，则记录该分片
    yaml 文件名并标注「(无溯源)」，不虚构 md 文件名。
    """
    merged = OntologyData()
    seen: dict[str, set] = {s: set() for s in _MERGE_SECTIONS}
    skipped: dict[str, int] = {s: 0 for s in _MERGE_SECTIONS}
    source_files: list[str] = []
    source_threads: list[str] = []
    created_ats: list[str] = []

    for path in yaml_paths:
        raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        if not isinstance(raw, dict):
            continue
        doc = OntologyData(**raw)
        meta = doc.metadata if isinstance(doc.metadata, dict) else {}
        # 缺 source_file 时如实记录分片 yaml 名并标注，不虚构 md 文件名
        source_files.append(str(meta.get("source_file") or f"{path.name}(无溯源)"))
        st = str(meta.get("source_thread") or "")
        if st and st not in source_threads:
            source_threads.append(st)
        ca = str(meta.get("created_at") or "")
        if ca:
            created_ats.append(ca)
        for section in _MERGE_SECTIONS:
            for item in getattr(doc, section, []):
                name = getattr(item, "name", None)
                if name is not None and name in seen[section]:
                    skipped[section] += 1
                    continue
                if name is not None:
                    seen[section].add(name)
                getattr(merged, section).append(item)

    # metadata：source_* 继承自分片；created_at 取最新分片时间；shard_hash 用于幂等性判断；
    # scenario/ontology 名称与 id 由 _finalize_metadata 补全（preview 与 deploy 共用）
    merged.metadata = {
        "source_file": ", ".join(source_files),
        "source_thread": ", ".join(source_threads) if source_threads else "部署合并",
        "created_at": max(created_ats) if created_ats else datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "deployed_version": version,
        "shard_hash": hashlib.sha256(b"".join(p.read_bytes() for p in yaml_paths)).hexdigest()[:16],
    }
    if any(skipped.values()):
        merged.metadata["merge_skipped"] = skipped
    return merged


def _finalize_metadata(merged: OntologyData, ontology_id: int, ontology_name: str, sc_name: str) -> None:
    """给合并结果补上 scenario/ontology 名称与 id（preview 与 deploy 共用，保证展示与落盘一致）。

    shard_hash 已在 _merge_yaml_files 中计算，此处不再处理。
    字段读取与 save_ontology_data 对齐：meta.json 里是 id/name，不是 scenario_id/ontology_name。
    """
    from metadata import get_scenario_by_name, list_ontologies_by_scenario

    sc = get_scenario_by_name(sc_name)
    merged.metadata["scenario_name"] = sc_name
    merged.metadata["scenario_id"] = sc.get("id") if sc else None
    ontos = list_ontologies_by_scenario(sc_name)
    onto = next((o for o in ontos if o.get("name") == ontology_name), None)
    merged.metadata["ontology_name"] = ontology_name
    merged.metadata["ontology_id"] = onto.get("id") if onto else ontology_id


def _resolve_version_docs(ontology_name: str, version: str) -> tuple[list[dict], list[Path]]:
    """按版本取文档列表与 yaml 路径；一个都没有则 404。"""
    docs = _collect_version_docs(ontology_name).get(version, [])
    if not docs:
        raise HTTPException(status_code=404, detail=f"版本「{version}」下没有已生成的本体文件")
    paths = [_thread_dir(d["thread_id"]) / d["yaml"] for d in docs]
    return docs, paths


@router.get("/versions")
async def list_deploy_versions(ontology_id: int):
    """列出该本体所有「至少有一个已生成 yaml」的版本及其文档明细。"""
    _, ontology_name = await get_ontology_names(ontology_id)
    by_version = _collect_version_docs(ontology_name)
    versions = [
        {"version": v, "docs": docs, "count": len(docs)}
        for v, docs in sorted(by_version.items(), reverse=True)
    ]
    return {"versions": versions}


@router.get("/preview")
async def preview_deploy(ontology_id: int, version: str):
    """拼接该版本的所有 yaml，返回去重合并后的完整本体（不落盘）。"""
    sc_name, ontology_name = await get_ontology_names(ontology_id)
    docs, paths = _resolve_version_docs(ontology_name, version)
    merged = _merge_yaml_files(paths, version)
    _finalize_metadata(merged, ontology_id, ontology_name, sc_name)
    return {
        "version": version,
        "docs": docs,
        "merged": merged.model_dump(exclude_none=True),
        "stats": {s: len(getattr(merged, s)) for s in _MERGE_SECTIONS},
    }


@router.get("/deployed")
async def get_deployed_ontology(ontology_id: int):
    """获取当前已部署的 ontology.yaml 内容（用于左上角「已部署版本」查看）。"""
    sc_name, ontology_name = await get_ontology_names(ontology_id)
    path = _get_yaml_path(sc_name, ontology_name)
    if not path.exists():
        raise HTTPException(status_code=404, detail="当前本体尚未部署")
    return {"content": path.read_text(encoding="utf-8")}


def _get_deployed_version(scenario_name: str, ontology_name: str) -> str:
    """读取当前部署的 ontology.yaml 中的 deployed_version，不存在则返回空字符串。"""
    current_path = _get_yaml_path(scenario_name, ontology_name)
    if not current_path.exists():
        return ""
    try:
        raw = yaml.safe_load(current_path.read_text(encoding="utf-8")) or {}
        meta = raw.get("metadata") if isinstance(raw, dict) else None
        if isinstance(meta, dict):
            return str(meta.get("deployed_version") or "")
    except Exception:
        return ""
    return ""


@router.get("/version-exists")
async def check_version_exists(ontology_id: int, version: str):
    """检查指定版本是否已存档到 ontology_versions/{version}/。"""
    sc_name, ontology_name = await get_ontology_names(ontology_id)
    exists = version_exists(sc_name, ontology_name, version)
    return {"exists": exists}


@router.get("/version-preview")
async def preview_version(ontology_id: int, version: str):
    """从 ontology_versions/{version}/ 读取已存档的三个 yaml 文件，返回合并内容。"""
    sc_name, ontology_name = await get_ontology_names(ontology_id)
    if not version_exists(sc_name, ontology_name, version):
        raise HTTPException(status_code=404, detail=f"版本「{version}」尚未存档，请先执行本体合并")

    merged = load_ontology_version(sc_name, ontology_name, version)
    # 构造 stats 统计
    stats = {s: len(getattr(merged, s)) for s in _MERGE_SECTIONS}
    return {
        "version": version,
        "docs": [],
        "merged": merged.model_dump(exclude_none=True),
        "stats": stats,
        "from_version_dir": True,
    }


@router.post("/save-version")
async def save_version(ontology_id: int, body: dict):
    """将 thread 分片合并后输出到 ontology_versions/{version}/ 三个 yaml 文件。

    这是「本体合并」按钮的 API：从 thread 合并 → 写入 version 目录。
    """
    sc_name, ontology_name = await get_ontology_names(ontology_id)
    version = (body.get("version") or "").strip()
    if not version:
        raise HTTPException(status_code=400, detail="请提供版本号")

    # 从 thread 合并
    _, paths = _resolve_version_docs(ontology_name, version)
    merged = _merge_yaml_files(paths, version)
    _finalize_metadata(merged, ontology_id, ontology_name, sc_name)

    # 写入 version 目录
    save_ontology_version(sc_name, ontology_name, version, merged)

    stats = {s: len(getattr(merged, s)) for s in _MERGE_SECTIONS}
    return {
        "message": f"已将版本「{version}」合并结果保存到 ontology_versions/{version}/",
        "version": version,
        "stats": stats,
    }


@router.get("/deployed-version")
async def get_deployed_version_info(ontology_id: int):
    """获取当前部署的版本号。"""
    sc_name, ontology_name = await get_ontology_names(ontology_id)
    deployed_version = _get_deployed_version(sc_name, ontology_name)
    return {"deployed_version": deployed_version}


@router.post("/deploy")
async def deploy_ontology(ontology_id: int, body: dict):
    """部署指定版本到 onto_market/{scenario}/{ontology}/。

    新流程：
    1. 先备份当前部署的三个文件到 ontology_versions/{当前部署版本}/
    2. 再将 ontology_versions/{目标版本}/ 的三个文件复制到部署目录
    3. 更新 metadata 中的 deployed_version
    """
    sc_name, ontology_name = await get_ontology_names(ontology_id)
    version = (body.get("version") or "").strip()
    if not version:
        raise HTTPException(status_code=400, detail="请提供要部署的版本号")

    # 检查目标版本是否已存档
    if not version_exists(sc_name, ontology_name, version):
        raise HTTPException(status_code=400, detail=f"版本「{version}」尚未存档，请先执行本体合并")

    # 获取当前部署版本
    current_deployed_version = _get_deployed_version(sc_name, ontology_name)

    # 1. 备份当前部署到版本目录
    if current_deployed_version:
        backup_deploy_to_version(sc_name, ontology_name, current_deployed_version)

    # 2. 从版本目录复制到部署目录
    copy_ontology_to_deploy(sc_name, ontology_name, version)

    # 3. 更新 ontology.yaml 中的 deployed_version
    onto_path = _get_yaml_path(sc_name, ontology_name)
    raw = yaml.safe_load(onto_path.read_text(encoding="utf-8")) or {}
    if not isinstance(raw, dict):
        raw = {}
    if not isinstance(raw.get("metadata"), dict):
        raw["metadata"] = {}
    raw["metadata"]["deployed_version"] = version
    with open(onto_path, "w", encoding="utf-8") as f:
        yaml.dump(raw, f, default_flow_style=False, allow_unicode=True, sort_keys=False)

    # 统计数据
    merged = load_ontology_version(sc_name, ontology_name, version)
    stats = {s: len(getattr(merged, s)) for s in _MERGE_SECTIONS} if merged else {}

    return {
        "message": f"已部署版本「{version}」到 {sc_name}/{ontology_name}/",
        "deployed_version": version,
        "already_deployed": version == current_deployed_version,
        "stats": stats,
    }