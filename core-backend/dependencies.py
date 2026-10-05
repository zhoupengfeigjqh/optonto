"""Shared dependencies for routers —— 本体 id → (场景名, 本体名) 依赖注入。

分层（章程 II）：本模块属接口层装配，不做文件 I/O；注册表查询经业务层
``services.ontology_registry``，身份不可信/不存在一律 404（与清单口径一致）。
"""

from errors import NotFoundError
from services import ontology_registry


async def get_ontology_names(ontology_id: int):
    """ontology_id → (scenario_name, ontology_name)，**身份唯一来源 = ontology.yaml.metadata**。

    所有按本体操作的路由共用（行为/函数/规则/技能/数据引擎/部署/文件…）。身份不可信的
    本体视为「不存在」（404）；口径与实现见 repositories.metadata。
    """
    result = ontology_registry.scenario_and_ontology_of(ontology_id)
    if not result:
        raise NotFoundError("本体不存在")
    return result
