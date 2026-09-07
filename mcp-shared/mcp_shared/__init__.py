"""mcp_shared — 三 MCP 服务共用的构建期库（不是服务、不起容器）。

模块：
- loaders：直读 .data（meta.json / ontology.yaml / data_engines.yaml / securities.yaml）+ mtime 指纹热加载
- mapper：_translate_input / _translate_output（逐字迁自 core-backend services/data_engine.py）
- sandbox：函数 exec + 受限 globals + run(params) 约定
- schema_compile：params → MCP Tool inputSchema（含概念约束回溯）+ scope 作用域块
- mcp_base：SSE Starlette 骨架、OAuth well-known、/health /tools 端点

Docker 构建：各服务 Dockerfile 的 context 为仓库根，COPY mcp-shared/mcp_shared /app/mcp_shared。
本地直跑：各 server.py 会把 ../mcp-shared 加进 sys.path。
"""
