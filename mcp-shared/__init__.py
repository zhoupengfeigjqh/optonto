"""mcp-shared — 三 MCP 服务共用的构建期库（不是服务、不起容器）。

目录本身即 sys.path 条目（扁平布局，不再有 mcp_shared 内层包目录），模块以顶层名导入：
- data_store：直读 .data（ontology.yaml 语义模型 + **身份** / meta.json 场景花名册与本体注册 /
  data_engines.yaml / securities.yaml）+ mtime 指纹热加载
- mapper：_translate_input / _translate_output（逐字迁自 core-backend services/data_engine.py）
- function_runner：函数 exec + 受限 globals + run(params) 约定（**可信插件执行，非安全沙箱**）
- tool_contract：工具发布/调用契约的**唯一权威**（分类标记 x-category、scope 上下文块、
  系统参数剥离、归属一致性校验）+ params → MCP Tool inputSchema 编译器
- mcp_app：MCP 协议骨架（Streamable HTTP /mcp 单端点 + OAuth well-known + /health /tools）

更名记录（2026-10-02 语义对齐，均为"名字 → 真实职责"）：
`loaders → data_store`、`sandbox → function_runner`、`schema_compile → tool_contract`、
`mcp_base → mcp_app`。

Docker 构建：各服务 Dockerfile 的 context 为仓库根，COPY mcp-shared /app/（这些模块落在 /app 顶层）。
本地直跑：各 server.py 会把 ../mcp-shared 加进 sys.path。
"""
