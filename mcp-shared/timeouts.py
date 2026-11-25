"""MCP 相关超时的**唯一来源**（2026-11-25 用户拍板：凡走 MCP 服务的超时统一 60s）。

为什么收口到本模块：同一语义此前散落在四处、四个值——
``mcp-publish`` 60s / ``business-mcp`` 15s / ``data-engine-executor`` 15s /
``core`` 运行面转发 30s。调一个漏三个，调用方与下游的超时谁大谁小纯靠人记。

**范围（只约束"一次 MCP 工具调用/一次平台内转发"的总等待上限）**：
- 自建发布门面 → 执行底座（mcp-publish 的 ``_TIMEOUT``）；
- 业务 MCP 工具 → 业务系统 REST（business-mcp 的 ``HTTP_TIMEOUT``，工具内部实现）；
- 数据引擎执行 → 下游 MCP ``callTool``（data-engine-executor 的 ``MCP_CALL_TIMEOUT``）；
- core 设计器测试 → 8005/8006/8007 执行端点（runtime_forward 的 ``_TIMEOUT``）。

**不在此列**（语义不同，勿套用）：容器就绪探测（``mcp_publish_containers``，20s/2s）、
LLM 调用超时（``LLM_TIMEOUT_*``）、安全确认等待（``CONFIRM_TIMEOUT``）。
agent-backend 侧无法共享本模块，同值常量在 ``services/mcp-client.ts``
（``MCP_CALL_TIMEOUT_MS``）单点维护，改这里时必须同步改那边。
"""

# 单次 MCP 工具调用 / 平台内转发的等待上限（秒）
MCP_CALL_TIMEOUT_S = 60.0

# 建连上限（秒）：与调用上限分开，避免"连不上"也要等满 60s 才报错
MCP_CONNECT_TIMEOUT_S = 5.0
