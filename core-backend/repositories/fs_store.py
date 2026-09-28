"""文件系统数据访问原语（数据访问层）。

分层约定（章程 II：接口层–业务层–数据访问层，禁止跨层调用）：

- 只有本层可以直接使用 ``open`` / ``Path.write_text`` / ``shutil`` 等文件 I/O；
- 业务层（``services``）与接口层（``routers``）一律经本层读写。

写入语义：一律「先写临时文件 → ``os.replace`` 原子替换」。
避免写到一半被并发读请求读到半成品（章程 VI：禁止部分提交的等价约束在文件存储上的体现）。
"""

import json
import os
import shutil
from pathlib import Path
from typing import Any, Optional

import yaml

# ─── 目录与存在性 ─────────────────────────────────────────────────────────────


def ensure_dir(path: Path) -> Path:
    """确保目录存在（含父级），返回该目录。"""
    path.mkdir(parents=True, exist_ok=True)
    return path


def exists(path: Path) -> bool:
    return path.exists()


def list_dir(path: Path) -> list[Path]:
    """列出目录条目；目录不存在时返回空列表（调用方无需先判存在）。"""
    if not path.is_dir():
        return []
    return list(path.iterdir())


def list_files(path: Path, pattern: str) -> list[Path]:
    """按 glob 模式列出文件（已排序，结果稳定）；目录不存在返回空列表。"""
    if not path.is_dir():
        return []
    return sorted(path.glob(pattern))


# ─── 文本 ─────────────────────────────────────────────────────────────────────


def read_text(path: Path, default: Optional[str] = None) -> str:
    """读取文本。

    ``default`` 为 None 时文件不存在则抛 ``FileNotFoundError``（调用方需显式处理）；
    传入字符串时文件不存在返回该默认值，便于「可选配置」场景。
    """
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError:
        if default is None:
            raise
        return default


def read_text_if_exists(path: Path) -> Optional[str]:
    """读取文本，文件不存在返回 None（不抛异常）。"""
    return read_text(path, default=None) if path.exists() else None


def write_text(path: Path, content: str) -> None:
    """原子写入文本（自动创建父目录）。"""
    _atomic_write(path, content)


# ─── JSON ─────────────────────────────────────────────────────────────────────


def read_json(path: Path, default: Any = None) -> Any:
    """读取 JSON；文件不存在、内容为空或解析失败时返回 ``default``。

    历史上各处自行 ``json.load`` 并各自 try/except，容错口径不一（有的抛、有的静默），
    此处统一为「损坏即视为缺失」，由业务层决定如何降级。
    """
    try:
        raw = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return default
    if not raw.strip():
        return default
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return default


def write_json(path: Path, data: Any) -> None:
    """原子写入 JSON（UTF-8、不转义中文、缩进 2）。"""
    _atomic_write(path, json.dumps(data, ensure_ascii=False, indent=2))


# ─── YAML ─────────────────────────────────────────────────────────────────────


def read_bytes(path: Path) -> bytes:
    """读取二进制内容（用于哈希/校验等场景）。"""
    return path.read_bytes()


class CorruptedFileError(Exception):
    """文件存在但内容无法解析（区别于「文件缺失」）。"""

    def __init__(self, path: Path, reason: str = ""):
        self.path = path
        self.reason = reason
        suffix = f"（{reason}）" if reason else ""
        super().__init__(f"文件内容无法解析: {path}{suffix}")


def read_yaml_strict(path: Path) -> Any:
    """严格读取 YAML：内容损坏时抛 ``CorruptedFileError``，不做静默降级。

    用于「宁可报错也不静默回退」的场景（如数据引擎 / 安全管控独立文件：
    静默回退到旧段会让新旧内容不一致且难以排查）。文件缺失则抛 ``FileNotFoundError``。
    """
    raw = path.read_text(encoding="utf-8")
    if not raw.strip():
        return None
    try:
        return yaml.safe_load(raw)
    except yaml.YAMLError as e:
        raise CorruptedFileError(path, str(e)) from e


def copy_file(src: Path, dst: Path) -> bool:
    """复制文件（保留原时间戳）；源不存在返回 False，不抛异常。"""
    if not src.exists():
        return False
    ensure_dir(dst.parent)
    shutil.copy2(src, dst)
    return True


def parse_yaml(text: str, default: Any = None) -> Any:
    """解析 YAML 文本；内容为空或解析失败时返回 ``default``（与 ``read_yaml`` 同口径）。

    供「待校验的 YAML 字符串」（如 LLM 生成结果）复用同一套解析容错。
    """
    if not text or not text.strip():
        return default
    try:
        return yaml.safe_load(text)
    except yaml.YAMLError:
        return default


def read_yaml(path: Path, default: Any = None) -> Any:
    """读取 YAML；文件不存在、内容为空或解析失败时返回 ``default``。"""
    try:
        raw = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        return default
    return parse_yaml(raw, default)


def write_yaml(path: Path, data: Any) -> None:
    """原子写入 YAML（UTF-8、不排序键、允许中文）。"""
    _atomic_write(path, yaml.safe_dump(data, allow_unicode=True, sort_keys=False))


# ─── 删除 ─────────────────────────────────────────────────────────────────────


def delete_file(path: Path) -> bool:
    """删除文件；返回是否真的删除了（不存在返回 False）。"""
    try:
        path.unlink()
        return True
    except FileNotFoundError:
        return False


def delete_tree(path: Path) -> bool:
    """递归删除目录；返回是否真的删除了（不存在返回 False）。"""
    if not path.exists():
        return False
    shutil.rmtree(path)
    return True


def move_path(src: Path, dst: Path) -> bool:
    """移动文件或目录（改名场景）；源不存在返回 False，不抛异常。

    目标父目录自动创建。跨文件系统时 ``shutil.move`` 会退化为「复制 + 删除」，
    因此改名后目标要么完整存在、要么整段失败，不会留下半截目录。
    """
    if not src.exists():
        return False
    ensure_dir(dst.parent)
    shutil.move(str(src), str(dst))
    return True


# ─── 内部 ─────────────────────────────────────────────────────────────────────


def _atomic_write(path: Path, content: str) -> None:
    """临时文件 + ``os.replace``；同目录写入保证 replace 的原子性。"""
    ensure_dir(path.parent)
    tmp = path.with_name(f"{path.name}.tmp")
    try:
        tmp.write_text(content, encoding="utf-8")
        os.replace(tmp, path)
    finally:
        # replace 成功后 tmp 已不存在；失败时清理残留临时文件
        if tmp.exists():
            tmp.unlink(missing_ok=True)
