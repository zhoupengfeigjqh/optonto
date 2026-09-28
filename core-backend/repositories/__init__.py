"""数据访问层（章程 II：接口层–业务层–数据访问层）。

- ``fs_store``：文件系统读写原语（原子写、统一容错），路由与业务层不得绕开它直接做文件 I/O。
- ``metadata``：场景 / 本体元数据存储（meta.json），2026-09-28 由仓库根 ``metadata.py`` 归位至此。

约定：本层之外（``routers`` / ``services``）不得出现 ``open`` / ``Path.write_text`` /
``shutil`` 等文件 I/O 调用。
"""

from . import fs_store, metadata  # noqa: F401

__all__ = ["fs_store", "metadata"]
