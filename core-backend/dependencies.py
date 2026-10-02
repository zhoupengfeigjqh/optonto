"""Shared dependencies for routers — file-based metadata layer."""

from fastapi import HTTPException

from repositories.metadata import get_ontology_name_by_id


async def get_ontology_names(ontology_id: int):
    """ontology_id → (scenario_name, ontology_name)，**身份唯一来源 = ontology.yaml.metadata**。

    所有按本体操作的路由共用（行为/函数/规则/技能/数据引擎/部署/文件…）。身份不可信的
    本体视为"不存在"（404），与清单口径一致；口径与实现见 repositories.metadata。
    """
    result = get_ontology_name_by_id(ontology_id)
    if not result:
        raise HTTPException(status_code=404, detail="本体不存在")
    return result
