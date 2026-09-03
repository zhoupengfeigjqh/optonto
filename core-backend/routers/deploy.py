"""本体部署 API：版本合并预览 + 部署到 onto_market。

版本语义：以需求文档头部的「版本：v1.1」行为准。同一版本下的所有已生成
yaml（含 metadata.source_file 回退匹配到的）合并为该版本的完整本体。
合并只发生在部署时的内存里，需求侧分片文件保持不动（单一事实来源）。
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
    split_yaml_top_sections,
    _get_yaml_path,
)
from routers.threads import _find_thread, _thread_dir, _yaml_source_map, _match_ontology_yaml

router = APIRouter(prefix="/api/ontologies/{ontology_id}/deploy", tags=["本体部署"])

# 合并目标节：securities / data_engines 由 save_ontology_data 派生（全花名册
# 同步 / 独立文件），不从需求 yaml 里带进来（单一权威来源）
_MERGE_SECTIONS = ("concepts", "relations", "functions", "behaviors", "rules", "processes")


def _parse_version(md_path: Path) -> str:
    """从 md 前 10 行解析「版本：xxx」，与 list_requirements 同一规则。"""
    try:
        for line in md_path.read_text(encoding="utf-8").splitlines()[:10]:
            stripped = line.strip()
            if stripped.startswith("版本："):
                return stripped[len("版本："):].strip()
    except Exception:
        pass
    return ""


def _collect_version_docs(ontology_name: str) -> dict[str, list[dict]]:
    """扫描全部需求线程，收集指定本体下已生成 yaml 的文档，按版本分组。

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

        source_map = _yaml_source_map(tdir)
        for md in sorted(tdir.glob("*.md")):
            req_name = md.name[:-3]
            matched = _match_ontology_yaml(tdir, req_name, md.name, source_map)
            if not matched:
                continue
            version = _parse_version(md)
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


@router.post("/deploy")
async def deploy_ontology(ontology_id: int, body: dict):
    """把该版本合并后的本体部署到 onto_market/{scenario}/{ontology}/ontology.yaml。

    幂等性护栏：比较分片输入哈希（shard_hash）与上次部署记录。分片不变则
    合并结果必然不变，跳过写入。比版本号比较更精确——同版本但分片内容变了
    也允许重新部署。
    """
    sc_name, ontology_name = await get_ontology_names(ontology_id)
    version = (body.get("version") or "").strip()
    if not version:
        raise HTTPException(status_code=400, detail="请提供要部署的版本号")

    _, paths = _resolve_version_docs(ontology_name, version)
    merged = _merge_yaml_files(paths, version)
    shard_hash = merged.metadata["shard_hash"]

    current_path = _get_yaml_path(sc_name, ontology_name)
    current_shard_hash = ""
    if current_path.exists():
        try:
            raw = yaml.safe_load(current_path.read_text(encoding="utf-8")) or {}
            meta = raw.get("metadata") if isinstance(raw, dict) else None
            if isinstance(meta, dict):
                current_shard_hash = str(meta.get("shard_hash") or "")
        except Exception:
            current_shard_hash = ""

    if current_shard_hash == shard_hash:
        return {
            "message": f"版本 {version} 分片未变化，无需重复部署",
            "deployed_version": version,
            "already_deployed": True,
        }

    _finalize_metadata(merged, ontology_id, ontology_name, sc_name)
    save_ontology_data(sc_name, ontology_name, merged)
    return {
        "message": f"已部署版本 {version} 到 {sc_name}/{ontology_name}/ontology.yaml",
        "deployed_version": version,
        "already_deployed": False,
        "stats": {s: len(getattr(merged, s)) for s in _MERGE_SECTIONS},
    }
