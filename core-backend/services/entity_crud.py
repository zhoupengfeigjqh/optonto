"""实体 CRUD 辅助 —— 9 个同构 router 的查重/定位样板收敛。

此前每个 router 各自写 `any(x.name==item.name)`（400 查重）与
`next((i for i,x in enumerate(...))...)`（404 定位），逻辑逐字重复约 24 处。
统一到这里，错误消息与行为与原先完全一致。
"""

from fastapi import HTTPException


def ensure_unique(items, name: str, entity_label: str, exclude_name: str | None = None, field: str = "name", duplicate_msg: str | None = None) -> None:
    """创建/改名查重：重名抛 400「{entity_label}名称已存在」。

    exclude_name 为当前条目原名：改名为自身原名时不误判重名（与各 router 原逻辑一致）。
    field 为唯一性字段名：多数实体用 name，securities 用 action_name。
    duplicate_msg 覆盖默认消息（securities 用「该动作已存在安全审核设置」）。
    """
    for it in items:
        it_name = getattr(it, field, None)
        if it_name == name and it_name != exclude_name:
            raise HTTPException(status_code=400, detail=duplicate_msg or f"{entity_label}名称已存在")


def find_index(items, name: str, entity_label: str, field: str = "name") -> int:
    """按唯一字段定位索引：不存在抛 404「{entity_label}不存在」。"""
    idx = next((i for i, it in enumerate(items) if getattr(it, field, None) == name), -1)
    if idx == -1:
        raise HTTPException(status_code=404, detail=f"{entity_label}不存在")
    return idx
