"""tools.yaml 声明加载与校验（无 mcp 依赖，server.py 与单测共用）。

配置错误=运维事故：缺必填字段（含强制 input/outputSchema）即抛 ValueError 启动失败，
不静默跳过——本服务由人手工运维，启动日志必须一眼看到错在哪。
"""

import yaml


REQUIRED_FIELDS = ("name", "description", "endpoint", "inputSchema", "outputSchema")
ALLOWED_METHODS = ("GET", "POST", "PUT", "DELETE")


def load_tool_decls(yaml_path) -> dict[str, dict]:
    """加载 tools.yaml → {工具名: 声明}。任何一条不合法即抛 ValueError。"""
    raw = yaml.safe_load(open(yaml_path, encoding="utf-8").read()) or {}
    decls: dict[str, dict] = {}
    for i, t in enumerate(raw.get("tools") or []):
        where = f"tools[{i}]({t.get('name', '?')})" if isinstance(t, dict) else f"tools[{i}]"
        if not isinstance(t, dict):
            raise ValueError(f"{where}: 条目必须是映射")
        for field in REQUIRED_FIELDS:
            if not t.get(field):
                raise ValueError(f"{where}: 缺少必填字段 {field}（input/outputSchema 强制声明，见架构文档 §九）")
        ep = t["endpoint"]
        if not isinstance(ep, dict) or not ep.get("path") or (ep.get("method") or "").upper() not in ALLOWED_METHODS:
            raise ValueError(f"{where}: endpoint 须含 method(GET/POST/PUT/DELETE) 与 path")
        if t["name"] in decls:
            raise ValueError(f"{where}: 工具名重复")
        decls[t["name"]] = t
    return decls
