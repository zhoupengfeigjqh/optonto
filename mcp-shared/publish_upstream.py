"""自建发布的**转发契约**：发布类型 → 执行底座（环境变量名 / 默认地址 / 路径 / 载荷键）。

**为什么需要这个模块（2026-10-04 缺陷修复）**：转发契约此前**只存在于门面侧**
（``mcp-publish/server.py::_UPSTREAM``），而**注入方在 core**（``mcp_publish_registry.build_run_kwargs``）。
两侧各写一份就出现了真实故障：core 对**两类**发布都注入 ``ONTOLOGY_FUNCTION_EXECUTOR_URL``，
门面却按 kind 读 ``ONTOLOGY_FUNCTION_EXECUTOR_URL`` / ``DATA_ENGINE_EXECUTOR_URL``——

- 行为类容器里塞了一个「名为本体函数执行器、值却指向数据引擎」的死变量，语义错乱；
- 真正该读的 ``DATA_ENGINE_EXECUTOR_URL`` **从未被注入**，行为发布只是**碰巧**命中了门面侧的
  默认值才跑通——默认值一改就静默断链，且从日志上完全看不出原因。

契约分裂的代价不是"多写一行"，而是**执行链路上的静默错误**。本模块把契约收到唯一一处：
core 读它来注入环境变量，门面读它来解析，两侧不可能再漂移。

**为什么不放 core**：core 容器与门面容器不共享运行时文件系统，唯一天然共享的是**构建期**
COPY 进各镜像的 ``mcp-shared/``（同一份源码，不可达依赖）——语义唯一实现必须落在这里。

**注入与读取的约定**：core 注入**该 kind 对应的那一个**环境变量（不注入另一个），门面只读自己的
spec 里的那个名字，故不存在"注入了一堆看都不看的变量"。
"""

# 发布类型（语义明确，不与「公共函数」混淆）：
# - ontology_function 本体函数：有本体归属 → 转发本体函数执行服务（带 ontology_id）
# - behavior         本体行为：跨系统执行   → 转发数据引擎执行服务
# 公共函数**不在此列**：它无本体归属、跨场景共享，由公共函数 MCP 服务直接对外发布，
# 无需"按本体切片"，进自建发布就是语义污染。
KIND_ONTOLOGY_FUNCTION = "ontology_function"
KIND_BEHAVIOR = "behavior"
KINDS = (KIND_ONTOLOGY_FUNCTION, KIND_BEHAVIOR)

# 各 kind 的转发目标：**执行底座**（都不对外提供工具，仅内网可达）
# path + target_key（执行面字段名不同，转发时一一对应）
PUBLISH_UPSTREAMS = {
    KIND_ONTOLOGY_FUNCTION: {
        "env": "ONTOLOGY_FUNCTION_EXECUTOR_URL",
        "default": "http://optonto-ontology-function-executor:8006",
        "path": "/execute-function",
        "target_key": "function_name",
        "label": "本体函数执行服务",
    },
    KIND_BEHAVIOR: {
        "env": "DATA_ENGINE_EXECUTOR_URL",
        "default": "http://optonto-data-engine-executor:8005",
        "path": "/call-behavior",
        "target_key": "behavior_name",
        "label": "数据引擎执行服务",
    },
}


def upstream_of(kind: str) -> dict:
    """发布类型 → 转发契约（未知 kind 直接报错，不静默回落到某个执行底座）。"""
    spec = PUBLISH_UPSTREAMS.get(kind)
    if spec is None:
        raise ValueError(f"未知发布类型: {kind}（可选 {'、'.join(KINDS)}）")
    return spec


def env_name_of(kind: str) -> str:
    """该发布类型应当被注入的环境变量名——**注入方与读取方的唯一握手名**。"""
    return upstream_of(kind)["env"]
