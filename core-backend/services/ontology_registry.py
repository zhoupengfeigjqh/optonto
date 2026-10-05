"""场景 / 本体注册表（花名册与身份）—— 接口层访问注册表的**唯一入口**。

分层（章程 II）：接口层 MUST NOT 直连数据访问层（``repositories``）。本模块把
``repositories.metadata`` 的领域操作收口为业务层 API，供
``routers.ontologies`` / ``routers.scenarios`` / ``routers.deploy`` / ``routers.skills`` /
``routers.functions`` / ``dependencies`` 使用。

职责边界：
- 只做「取数 + 领域语义（找不到即 404）」；**不**写业务规则（如改名回刷由调用方决定时机）；
- 身份的唯一读取来源仍是 ``ontology.yaml.metadata``（见 repositories.metadata 的约定），
  本模块不新增第二事实源。
"""

from typing import Optional

from errors import NotFoundError
from repositories import metadata


# ─── 场景 ───────────────────────────────────────────────────────────────────────

def list_scenarios() -> list[dict]:
    return metadata.list_scenarios()


def get_scenario(scenario_id: int) -> Optional[dict]:
    return metadata.get_scenario_by_id(scenario_id)


def require_scenario(scenario_id: int) -> dict:
    """取场景，不存在 → 404。"""
    scenario = metadata.get_scenario_by_id(scenario_id)
    if not scenario:
        raise NotFoundError("场景不存在")
    return scenario


def scenario_by_name(name: str) -> Optional[dict]:
    return metadata.get_scenario_by_name(name)


def create_scenario(name: str, description: str = "") -> dict:
    return metadata.create_scenario(name, description)


def update_scenario(scenario_id: int, *, name=None, description=None) -> Optional[dict]:
    return metadata.update_scenario(scenario_id, name=name, description=description)


def delete_scenario(scenario_id: int) -> None:
    metadata.delete_scenario(scenario_id)


def ontology_dir_names(scenario_name: str) -> list[str]:
    """场景下所有本体目录名（物理枚举）——改名回刷身份时用，避免「读身份→刷身份」自锁。"""
    return metadata.list_ontology_dir_names(scenario_name)


# ─── 本体 ───────────────────────────────────────────────────────────────────────

def list_all_ontologies() -> list[dict]:
    """全场景本体清单（每行含 identity 四元组与 deployed_version）。"""
    return metadata.list_all_ontologies()


def list_ontologies_by_scenario(scenario_name: str) -> list[dict]:
    return metadata.list_ontologies_by_scenario(scenario_name)


def find_ontology(ontology_id: int) -> Optional[tuple[dict, str, str]]:
    """按 id 定位本体：返回 (本体行, 场景名, 本体名)；不存在返回 None。"""
    return metadata.get_ontology_by_id(ontology_id)


def require_ontology(ontology_id: int) -> tuple[dict, str, str]:
    """按 id 定位本体，不存在 → 404。"""
    result = metadata.get_ontology_by_id(ontology_id)
    if not result:
        raise NotFoundError("本体不存在")
    return result


def scenario_and_ontology_of(ontology_id: int) -> Optional[tuple[str, str]]:
    """ontology_id → (场景名, 本体名)；身份不可信/不存在返回 None。

    按本体操作的路由共用（行为/函数/规则/技能/数据引擎/部署/文件…）。
    """
    return metadata.get_ontology_name_by_id(ontology_id)


def create_ontology(*, scenario_name: str, name: str, description: str = "", creator: str = "") -> Optional[dict]:
    return metadata.create_ontology(
        scenario_name=scenario_name, name=name, description=description, creator=creator)


def update_ontology(ontology_id: int, *, name=None, description=None, creator=None) -> Optional[dict]:
    return metadata.update_ontology(ontology_id, name=name, description=description, creator=creator)


def delete_ontology(ontology_id: int) -> None:
    metadata.delete_ontology(ontology_id)


def refresh_identity_metadata(scenario_name: str, ontology_name: str) -> None:
    """改名/部署后回刷 ontology.yaml.metadata 的身份四元组（写侧保证 metadata 恒新）。"""
    metadata.refresh_identity_metadata(scenario_name, ontology_name)


def registry_ids(scenario_name: str, ontology_name: str) -> tuple:
    """注册表分配的身份 id（写侧唯一取 id 实现）。"""
    return metadata.registry_ids(scenario_name, ontology_name)
