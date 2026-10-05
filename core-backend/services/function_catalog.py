"""可用函数名册（本体函数 ∪ 公共函数）——``related_functions`` 合法取值域的**唯一口径**。

此前「公共函数清单」在 ``routers/functions.py``、``routers/rules.py``、``routers/common_functions.py``
三处各读一遍 ``common_functions/functions.json``，同一份事实三处解析、口径靠人工对齐。
本模块把读取与「本体函数 ∪ 公共函数」的并集收口到业务层一处，路由只做调用。

分层（章程 II）：本模块属业务层；文件读写经数据访问层 ``repositories.fs_store``。
"""

from config import DATA_DIR
from repositories import fs_store

# 公共函数目录与清单（平台通用算力名册；缺失/损坏按空清单降级，口径同 fs_store.read_json）
COMMON_FUNCTIONS_DIR = DATA_DIR / "common_functions"
COMMON_FUNCTIONS_MANIFEST = COMMON_FUNCTIONS_DIR / "functions.json"


def read_common_functions() -> list[dict]:
    """公共函数完整元数据清单（列表接口与名称集合共用同一读取口径）。"""
    data = fs_store.read_json(COMMON_FUNCTIONS_MANIFEST, default=[])
    return data if isinstance(data, list) else []


def common_function_names() -> set[str]:
    """公共函数名集合（用于跨本体函数查重与规则关联函数取值域）。"""
    return {e["name"] for e in read_common_functions()
            if isinstance(e, dict) and e.get("name")}


def available_function_names(data) -> set[str]:
    """可用函数全集：本体函数 ∪ 公共函数（``related_functions`` 的合法取值域）。"""
    return {f.name for f in data.functions if f.name} | common_function_names()


def read_common_function_code(func_name: str) -> str:
    """读取公共函数源码（不存在 → 404）。"""
    from errors import NotFoundError

    code_path = COMMON_FUNCTIONS_DIR / f"{func_name}.py"
    if not fs_store.exists(code_path):
        raise NotFoundError("函数代码文件不存在")
    return fs_store.read_text(code_path)
