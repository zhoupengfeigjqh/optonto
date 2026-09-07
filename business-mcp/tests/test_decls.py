# -*- coding: utf-8 -*-
"""business-mcp tools.yaml 声明加载校验单测（decls.load_tool_decls）。

锁定强制约束：input/outputSchema 必填（映射页自动提取的权威来源）、
endpoint 方法白名单、工具名唯一——配置错误必须启动即炸，不静默跳过。
"""
import sys
from pathlib import Path

import pytest

_REPO_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(_REPO_ROOT / "business-mcp"))

from decls import load_tool_decls

REAL_TOOLS_YAML = _REPO_ROOT / "business-mcp" / "config" / "tools.yaml"


def _write(tmp_path, tools):
    import yaml
    p = tmp_path / "tools.yaml"
    p.write_text(yaml.safe_dump({"tools": tools}, allow_unicode=True), encoding="utf-8")
    return p


def _valid(**over):
    t = {
        "name": "query_x",
        "description": "查询 X",
        "endpoint": {"method": "GET", "path": "/api/x"},
        "inputSchema": {"type": "object", "properties": {}},
        "outputSchema": {"type": "array"},
    }
    t.update(over)
    return t


def test_real_tools_yaml_loads():
    decls = load_tool_decls(REAL_TOOLS_YAML)
    assert len(decls) == 8
    assert "query_purchase_records" in decls
    # 强制 outputSchema 的全量断言：映射页依赖它做自动提取
    assert all(t.get("outputSchema") for t in decls.values())


def test_missing_output_schema_rejected(tmp_path):
    bad = _valid()
    del bad["outputSchema"]
    with pytest.raises(ValueError, match="outputSchema"):
        load_tool_decls(_write(tmp_path, [bad]))


def test_bad_method_rejected(tmp_path):
    with pytest.raises(ValueError, match="method"):
        load_tool_decls(_write(tmp_path, [_valid(endpoint={"method": "PATCHX", "path": "/api/x"})]))


def test_duplicate_name_rejected(tmp_path):
    with pytest.raises(ValueError, match="重复"):
        load_tool_decls(_write(tmp_path, [_valid(), _valid()]))
