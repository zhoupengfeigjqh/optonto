"""本体模型的跨字段强耦合校验（业务层）。

分层（章程 II）：本模块属业务层，只依赖 ``schemas`` / ``errors``，不 import fastapi。

校验归属铁律（spec 003 假设）：**值域类**非法值由 Pydantic validator 静默归一（不报错）；
**跨字段强耦合**校验在此抛出 ``InvalidInputError``（→ 400 统一错误体）。
不可放进 Pydantic validator —— 请求体校验失败经 ``main.py`` 的 ``RequestValidationError``
处理器返回 422，会造成 400/422 契约分裂。
"""

from errors import InvalidInputError
from schemas import STATUS_ATTR_NAME, BehaviorItem, OntologyData, RuleItem


def status_enum_of(data: OntologyData, concept_name: str) -> list:
    """取某概念 status 属性的枚举值（生命周期状态全集）。

    无该概念 / 无 status 属性 / 枚举为空 → 返回空列表。
    """
    concept = next((c for c in data.concepts if c.name == concept_name), None)
    if concept is None:
        return []
    for a in concept.attributes or []:
        if a.name == STATUS_ATTR_NAME:
            return list(getattr(a.constraint, "enum", None) or [])
    return []


def validate_status_attribute(attributes: list) -> None:
    """概念属性级校验：至多一个 ``status`` 属性；若存在则必须 string 类型且枚举非空。"""
    status_attrs = [a for a in attributes if getattr(a, "name", "") == STATUS_ATTR_NAME]
    if len(status_attrs) > 1:
        raise InvalidInputError("概念只能有一个 status（生命周期状态）属性")
    if not status_attrs:
        return
    attr = status_attrs[0]
    if (attr.type or "") != "string":
        raise InvalidInputError(
            f"status（生命周期状态）属性的类型必须是 string，当前为「{attr.type or '空'}」"
        )
    enum = getattr(attr.constraint, "enum", None) or []
    if not enum:
        raise InvalidInputError("status（生命周期状态）属性必须填写枚举值（即该对象的生命周期状态集合）")


def validate_behavior_status(behavior: BehaviorItem, data: OntologyData) -> None:
    """行为级校验：关联概念必须存在；声明了 from/to 时必须落在该概念 status 枚举内。

    ``from_status`` / ``to_status`` 均为空 → 跳过（存量行为兼容，spec FR-008）。
    """
    if behavior.concept and not any(c.name == behavior.concept for c in data.concepts):
        raise InvalidInputError(f"关联概念不存在: {behavior.concept}")

    from_status = (behavior.from_status or "").strip()
    to_status = (behavior.to_status or "").strip()
    if not from_status and not to_status:
        return
    if not behavior.concept:
        raise InvalidInputError("声明状态跃迁前必须先选择关联概念")
    enum = status_enum_of(data, behavior.concept)
    if not enum:
        raise InvalidInputError(
            f"关联概念 {behavior.concept} 没有生命周期状态属性"
            "（需有 name=status、type=string 且填写了枚举值的属性），无法声明状态跃迁"
        )
    for label, value in (("源状态", from_status), ("目标状态", to_status)):
        if value and value not in enum:
            raise InvalidInputError(
                f"{label}「{value}」不在概念 {behavior.concept} 的状态枚举内："
                + "、".join(str(e) for e in enum)
            )


def validate_related_functions(rule: RuleItem, data: OntologyData, extra_available: set[str] | None = None) -> None:
    """规则级校验：关联函数（``related_functions``）必须存在于 本体函数 ∪ 公共函数。

    2026-09-30 口径 B：关联函数是规则约束逻辑的载体——其中本体且 ``type=VALIDATION`` 者为
    判断函数（返回 data.pass/reason，运行期闸据此真阻断）；拼错的函数名会让闸在运行期
    fail-closed 拒绝主行为（或静默失去约束），必须在保存期拦截。
    """
    names = {f.name for f in data.functions if f.name} | (extra_available or set())
    for fn in rule.related_functions or []:
        if fn and fn not in names:
            raise InvalidInputError(f"规则关联函数不存在: {fn}")
