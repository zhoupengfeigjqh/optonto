"""本体函数代码文件（``functions/{函数名}.py``）存储层 —— 该领域**唯一**读写出口。

分层（章程 II）：``routers.functions`` 一律经本模块，不直连 ``repositories``。
路径口径与 ``services.get_functions_dir`` 同源（本体目录下的 functions/）。
"""

from pathlib import Path

from repositories import fs_store
from services import ensure_functions_dir, get_functions_dir


def code_path(scenario_name: str, ontology_name: str, function_name: str) -> Path:
    """函数代码文件路径（本体目录/functions/{函数名}.py）。"""
    return get_functions_dir(scenario_name, ontology_name) / f"{function_name}.py"


def read_code(scenario_name: str, ontology_name: str, function_name: str) -> tuple[str, bool]:
    """读取函数代码：返回 (内容, 是否存在)；不存在时内容为空串。"""
    path = code_path(scenario_name, ontology_name, function_name)
    if not fs_store.exists(path):
        return "", False
    return fs_store.read_text(path), True


def write_code(scenario_name: str, ontology_name: str, function_name: str, code: str) -> None:
    """写入函数代码（自动建 functions/ 目录，同名覆盖）。"""
    ensure_functions_dir(scenario_name, ontology_name)
    fs_store.write_text(code_path(scenario_name, ontology_name, function_name), code)


def delete_code(scenario_name: str, ontology_name: str, function_name: str) -> None:
    """删除函数代码文件（不存在视为已删除，幂等）。"""
    fs_store.delete_file(code_path(scenario_name, ontology_name, function_name))
