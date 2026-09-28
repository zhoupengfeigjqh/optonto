"""mcp-shared — 三 MCP 服务共用的构建期库（不是服务、不起容器）。

目录本身即 sys.path 条目（扁平布局，不再有 mcp_shared 内层包目录），模块以顶层名导入：
- loaders：直读 .data（meta.json / ontology.yaml / data_engines.yaml / securities.yaml）+ mtime 指纹热加载
- mapper：_translate_input / _translate_output（逐字迁自 core-backend services/data_engine.py）
- sandbox：函数 exec + 受限 globals + run(params) 约定
- schema_compile：params → MCP Tool inputSchema（含概念约束回溯）+ scope 作用域块
- mcp_base：Streamable HTTP Starlette 骨架（/mcp 单端点）、OAuth well-known、/health /tools 端点

Docker 构建：各服务 Dockerfile 的 context 为仓库根，COPY mcp-shared /app/（这些模块落在 /app 顶层）。
本地直跑：各 server.py 会把 ../mcp-shared 加进 sys.path。
"""
