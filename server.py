"""⚠️ 已废弃的占位文件（请勿引用，待删除）。

本文件曾是 `mcp-publish/server.py`（自建发布门面）的一份**陈旧副本**，且契约已落后：
它用的是旧的发布类型常量（`kind="function"`）与旧的环境变量名（`FUNCTION_EXECUTOR_URL`），
与 `mcp-shared/publish_upstream.py` 的现行契约（`ontology_function` /
`ONTOLOGY_FUNCTION_EXECUTOR_URL`）不一致。若被误用，会拒绝 core 下发的发布配置。

经全仓核对：本文件**不被任何 Dockerfile / docker-compose / 测试 / 源码引用**
（根目录 `Dockerfile` 构建的是 `ontology-query-mcp/server.py`），属死代码。

唯一实现：`mcp-publish/server.py`；转发契约唯一权威：`mcp-shared/publish_upstream.py`。

处置建议：`git rm server.py`（本次会话无删除权限，故以占位文件消除契约漂移风险）。
"""
