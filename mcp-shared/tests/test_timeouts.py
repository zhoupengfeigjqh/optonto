"""MCP 超时常量测试：锁定「凡走 MCP 服务的调用统一 60s」（2026-11-25 用户拍板）。

为什么要测常量：同一语义此前散落四处四个值（60 / 15 / 15 / 30），没有任何测试能发现漂移——
某个调用点被改回 15s 只会表现为"偶发超时"，排障时看不出是配置不一致。

运行：cd mcp-shared && python -m pytest tests -q
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from timeouts import MCP_CALL_TIMEOUT_S, MCP_CONNECT_TIMEOUT_S  # noqa: E402

_REPO_ROOT = Path(__file__).resolve().parents[2]


def test_单次MCP调用超时统一60秒():
    assert MCP_CALL_TIMEOUT_S == 60.0


def test_建连超时5秒():
    assert MCP_CONNECT_TIMEOUT_S == 5.0


def test_各调用点引用统一常量而不是各自写死():
    """漏改检测：四个 Python 调用点都必须引用 MCP_CALL_TIMEOUT_S，且不再残留旧的 15/30 字面量。"""
    call_sites = [
        _REPO_ROOT / "mcp-publish" / "server.py",
        _REPO_ROOT / "business-mcp" / "server.py",
        _REPO_ROOT / "data-engine-executor" / "executor.py",
        _REPO_ROOT / "core-backend" / "services" / "runtime_forward.py",
    ]
    for path in call_sites:
        text = path.read_text(encoding="utf-8")
        assert "MCP_CALL_TIMEOUT_S" in text, f"{path} 未引用统一超时常量"
        assert "httpx.Timeout(30.0" not in text, f"{path} 仍残留 30s 转发超时"
