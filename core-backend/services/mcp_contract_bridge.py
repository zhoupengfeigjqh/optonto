"""把 mcp-shared 的**工具契约编译器**接入 core（动态发布面）。

为什么需要这个桥：自建发布要在 core 侧把"本体函数/行为的 params"编译成 MCP `inputSchema`，
而约束编译（属性名回溯、enum/pattern/min/max、必填非空、本体上下文元数据）只有一份权威实现
——`mcp-shared/tool_contract.py`。在 core 里重写一份就是"同一语义两处实现"，约束会静默漂移。

路径解析两处都成立：
- 容器内：``/app/backend/services/mcp_contract_bridge.py`` → ``parents[2] / "mcp-shared"`` = ``/app/mcp-shared``
  （core 的 Dockerfile 已 COPY mcp-shared 到该路径）；
- 本地直跑：``<repo>/core-backend/services/...`` → ``<repo>/mcp-shared``。

本模块只做路径注入 + 转出符号，**不含任何编译逻辑**。
"""

import sys
from pathlib import Path

_SHARED_DIR = Path(__file__).resolve().parents[2] / "mcp-shared"
if _SHARED_DIR.is_dir() and str(_SHARED_DIR) not in sys.path:
    sys.path.insert(0, str(_SHARED_DIR))

from publish_registry import published_behavior_names  # noqa: E402
from publish_upstream import (  # noqa: E402
    KIND_BEHAVIOR as PUBLISH_KIND_BEHAVIOR,
    KIND_ONTOLOGY_FUNCTION as PUBLISH_KIND_ONTOLOGY_FUNCTION,
    env_name_of,
    upstream_of,
)
from tool_contract import (  # noqa: E402
    CATEGORY_BEHAVIOR,
    CATEGORY_FUNCTION,
    behavior_concept_names,
    params_to_input_schema,
    ready_behavior_names,
    related_concepts,
    with_ontology_scope,
)

__all__ = [
    "CATEGORY_BEHAVIOR",
    "CATEGORY_FUNCTION",
    "PUBLISH_KIND_BEHAVIOR",
    "PUBLISH_KIND_ONTOLOGY_FUNCTION",
    "behavior_concept_names",
    "env_name_of",
    "params_to_input_schema",
    "published_behavior_names",
    "ready_behavior_names",
    "related_concepts",
    "upstream_of",
    "with_ontology_scope",
]
