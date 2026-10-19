"""自建发布注册表（``.data/mcp_publishes/publishes.json``）的**只读**投影。

写入侧唯一实现是 core 的 ``services/mcp_publish_registry``（校验、工具编译、容器编排都在那里，
它才是注册表 schema 的权威）。运行面只需要回答一个问题：

> 这个行为现在有没有挂载点？

2026-10-19 方案 B 后，行为工具的唯一来源是自建发布（数据引擎执行服务已零工具化）。
若查询面仍按"已映射就绪"列出行为，父 Agent 会规划一个没有挂载点的行为——正是契约 ⑥
要消灭的"能规划、挂不上"。故查询面按"就绪 ∩ 已发布"过滤，本模块提供后者。

为什么放 mcp-shared：core 容器与查询服务不共享文件系统，唯一共享的运行时资产就是构建期
COPY 进来的 ``mcp-shared/``。发布类型常量同样引用 ``publish_upstream``，不写第二份字符串。

**只读、无缓存**：注册表很小，且 `listOntoBehaviors` 是低频调用；缓存反而会引入
"刚发布完查不到"的困惑（core 写入后无失效通知）。读失败按"空"处理——发布面不存在
等价于"什么都没有发布"，不是错误。
"""

import json
from pathlib import Path

import data_store
from publish_upstream import KIND_BEHAVIOR


def registry_path() -> Path:
    """注册表路径（每次现取 DATA_DIR，便于测试替换数据目录）。"""
    return data_store.DATA_DIR / "mcp_publishes" / "publishes.json"


def _read_registry(registry_file: Path | None = None) -> list[dict]:
    path = registry_file or registry_path()
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError):
        return []
    return data if isinstance(data, list) else []


def published_behavior_names(
    ontology_id: int | None = None, registry_file: Path | None = None,
) -> set[str]:
    """已发布为工具的**行为名**集合（可按本体收窄）。

    只统计 ``kind == "behavior"`` 的发布；本体函数发布不参与行为规划面。
    ``ontology_id`` 为 None 时返回全平台并集。

    已知局限（有意接受，文档同步）：注册表是**期望态**——发布容器被停掉、或该发布尚未加入
    「MCP 配置」时，这里仍会算作"已发布"。硬闸始终在 agent 侧：规划校验以实际发现的工具目录
    为准，此处只用于降低"列出后必然被拒"的无谓一轮。
    """
    names: set[str] = set()
    for entry in _read_registry(registry_file):
        if not isinstance(entry, dict) or entry.get("kind") != KIND_BEHAVIOR:
            continue
        if ontology_id is not None and entry.get("ontology_id") != int(ontology_id):
            continue
        items = entry.get("items")
        if not isinstance(items, list):
            continue
        names.update(str(i).strip() for i in items if str(i).strip())
    return names
