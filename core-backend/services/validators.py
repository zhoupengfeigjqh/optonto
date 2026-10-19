"""本体模型的跨字段强耦合校验（业务层）。

分层（章程 II）：本模块属业务层，只依赖 ``schemas`` / ``errors``，不 import fastapi。

校验归属铁律（spec 003 假设）：**值域类**非法值由 Pydantic validator 静默归一（不报错）；
**跨字段强耦合**校验在此抛出 ``InvalidInputError``（→ 400 统一错误体）。
不可放进 Pydantic validator —— 请求体校验失败经 ``main.py`` 的 ``RequestValidationError``
处理器返回 422，会造成 400/422 契约分裂。
"""

from errors import InvalidInputError
from schemas import (
    CONCEPT_RELATION_TYPES,
    STATUS_ATTR_NAME,
    AttributeRestriction,
    BehaviorItem,
    ConceptItem,
    ConceptRelationItem,
    FunctionItem,
    OntologyData,
    ProcessItem,
    RelationItem,
    RuleItem,
)
from services.concept_relations import DISJOINT_WITH, EQUIVALENT_CLASS, is_ancestor
from services.inheritance import ENUM_TYPES, PATTERN_TYPES, RANGE_TYPES, effective_map


def status_enum_of(data: OntologyData, concept_name: str) -> list:
    """取某概念 status 属性的枚举值（生命周期状态全集）。

    走**有效属性**（自有 ∪ 继承，继承已合成收窄）——子概念继承父概念的生命周期
    状态属性后，行为状态跃迁仍应能取到枚举全集。
    无该概念 / 无 status 属性 / 枚举为空 → 返回空列表。
    """
    for ra in effective_map(data.concepts).get(concept_name, []):
        if ra.attribute.name == STATUS_ATTR_NAME:
            return list(getattr(ra.attribute.constraint, "enum", None) or [])
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


def validate_sub_class_of(concept: ConceptItem, data: OntologyData, old_name: str | None = None) -> None:
    """父概念（subClassOf）校验：必须存在、不能是自身、不能形成环。

    ``old_name`` = 更新前的概念名（改名场景下，链上命中旧名同样视为环）。
    """
    parent = (concept.sub_class_of or "").strip()
    if not parent:
        return

    self_names = {n for n in (concept.name, old_name) if n}
    if parent in self_names:
        raise InvalidInputError("父概念不能是概念自身")
    by_name = {c.name: c for c in data.concepts if c.name}
    if parent not in by_name:
        raise InvalidInputError(f"父概念不存在: {parent}")

    seen: set[str] = set()
    cur = parent
    while cur:
        if cur in seen:
            raise InvalidInputError(f"既有父概念链已存在环（{cur}），请先修复后再保存")
        seen.add(cur)
        if cur in self_names:
            raise InvalidInputError(f"父概念设置会形成循环继承：{concept.name} → … → {concept.name}")
        node = by_name.get(cur)
        if node is None:
            break
        cur = (node.sub_class_of or "").strip()


def _validate_one_restriction(attr, name: str, r: AttributeRestriction) -> None:
    """单条收窄校验：枚举只删不增、范围不超父、模式任意但必须是合法正则。"""
    if r.enum is not None and attr.type in ENUM_TYPES:
        base_enum = list(getattr(attr.constraint, "enum", None) or [])
        if not base_enum:
            raise InvalidInputError(f"属性「{name}」的父定义没有枚举值，不能新增枚举")
        if not r.enum:
            raise InvalidInputError(f"属性「{name}」的枚举限制不能为空（空 = 完全继承，请删除该限制）")
        allowed = {str(v) for v in base_enum}
        extra = [v for v in r.enum if str(v) not in allowed]
        if extra:
            raise InvalidInputError(
                f"属性「{name}」的枚举只能从父概念枚举中删除，不能新增："
                + "、".join(str(v) for v in extra)
            )

    if (r.min is not None or r.max is not None) and attr.type in RANGE_TYPES:
        base_min = getattr(attr.constraint, "min", None)
        base_max = getattr(attr.constraint, "max", None)
        if base_min is not None and r.min is not None and r.min < base_min:
            raise InvalidInputError(f"属性「{name}」的最小值不能小于父概念取值范围的 {base_min}")
        if base_max is not None and r.max is not None and r.max > base_max:
            raise InvalidInputError(f"属性「{name}」的最大值不能大于父概念取值范围的 {base_max}")
        if r.min is not None and r.max is not None and r.min > r.max:
            raise InvalidInputError(f"属性「{name}」的取值范围最小值不能大于最大值")

    if r.pattern is not None and attr.type in PATTERN_TYPES and r.pattern:
        import re

        try:
            re.compile(r.pattern)
        except re.error as e:
            raise InvalidInputError(f"属性「{name}」的匹配模式不是合法正则: {e}")


def validate_restrictions(concept: ConceptItem, data: OntologyData) -> None:
    """属性收窄校验：只能作用于继承属性，且只能收窄不能放宽（spec 005）。"""
    restrictions = concept.attribute_restrictions or {}
    if not restrictions:
        return
    parent = (concept.sub_class_of or "").strip()
    if not parent:
        raise InvalidInputError("未选择父概念时不能声明属性限制")
    base = {ra.attribute.name: ra.attribute for ra in effective_map(data.concepts).get(parent, [])}
    for name, r in restrictions.items():
        attr = base.get(name)
        if attr is None:
            raise InvalidInputError(f"属性限制只能作用于继承属性：{name}")
        _validate_one_restriction(attr, name, r)


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


def validate_function_code(code: str) -> str | None:
    """函数代码入口静态校验（保存/生成写盘前调用）。返回 None = 通过，否则返回错误描述。

    统一入口约定（2026-09-05）：本体函数与公共函数同为 ``def run(params: dict) -> dict``，
    exec 后按 "run" 取符号、整包传参。注册名（YAML name / 文件名）只作标识，
    不再要求代码内函数同名——改名/迁移不影响代码。
    """
    import ast

    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        return f"语法错误: {e}"
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name == "run":
            if not node.args.args:
                return "run 必须接收 params 参数（def run(params: dict) -> dict）"
            return None
    return "未找到 def run(params) 定义——函数代码须以 run 为统一入口（与公共函数同约定）"


def validate_relation(relation: RelationItem, data: OntologyData) -> None:
    """关系级校验：源/目标概念必须存在；声明了端点属性时该属性必须属于对应概念。

    与行为/规则同一强度（跨字段强耦合 → 400）：关系是本体里唯一的「跨概念连线」，
    端点或端点属性悬空时，实例图/查询面会静默拿不到数据，必须在保存期拦截。
    """
    concept_names = {c.name for c in data.concepts if c.name}
    if relation.source and relation.source not in concept_names:
        raise InvalidInputError(f"关系的源概念不存在: {relation.source}")
    if relation.target and relation.target not in concept_names:
        raise InvalidInputError(f"关系的目标概念不存在: {relation.target}")

    # 端点属性取**有效属性**：继承来的属性同样可以作为关系端点（spec 005）
    effective = effective_map(data.concepts)
    for label, concept_name, attr_name in (
        ("源端", relation.source, relation.source_attr),
        ("目标端", relation.target, relation.target_attr),
    ):
        if not attr_name:
            continue
        attrs = {ra.attribute.name for ra in effective.get(concept_name, [])}
        if attr_name not in attrs:
            raise InvalidInputError(f"关系{label}关联属性不存在: {concept_name}.{attr_name}")


def _effective_attr_type(data: OntologyData, concept_name: str, attr_name: str) -> str | None:
    """有效属性（自有 ∪ 继承）的类型；不存在返回 None。"""
    for ra in effective_map(data.concepts).get(concept_name, []):
        if ra.attribute.name == attr_name:
            return ra.attribute.type or ""
    return None


def validate_link_attributes(
    data: OntologyData,
    source: str,
    target: str,
    source_attr: str,
    target_attr: str,
    label: str = "概念关系",
) -> None:
    """关联概念属性（两端 join 字段）校验：同填同空、必须存在、两端类型一致。

    概念关系的关联概念属性**选填**（互斥/等价多数没有连接键）；对象关系仍由
    ``validate_relation`` 按既有口径校验，本函数只服务概念关系。
    """
    has_source = bool((source_attr or "").strip())
    has_target = bool((target_attr or "").strip())
    if not has_source and not has_target:
        return
    if has_source != has_target:
        raise InvalidInputError(f"{label}的关联概念属性必须两端同时填写，或同时留空")
    source_type = _effective_attr_type(data, source, source_attr)
    if source_type is None:
        raise InvalidInputError(f"{label}源端关联属性不存在: {source}.{source_attr}")
    target_type = _effective_attr_type(data, target, target_attr)
    if target_type is None:
        raise InvalidInputError(f"{label}目标端关联属性不存在: {target}.{target_attr}")
    if source_type != target_type:
        raise InvalidInputError(
            f"{label}两端关联属性类型不一致：{source}.{source_attr}（{source_type or '空'}）"
            f" ≠ {target}.{target_attr}（{target_type or '空'}）"
        )


def validate_concept_relation(
    relation: ConceptRelationItem, data: OntologyData, exclude_name: str | None = None
) -> None:
    """概念关系校验（类级公理）：类型、端点、对称去重、继承链矛盾、关联属性。

    值域类非法值已在 Pydantic 层归一为空串，这里统一转 400（跨字段强耦合）。
    """
    if relation.relation_type not in CONCEPT_RELATION_TYPES:
        raise InvalidInputError(
            "概念关系类型只能为 SubClassOf / EquivalentClass / DisjointWith，且不可为空"
        )

    concept_names = {c.name for c in data.concepts if c.name}
    if not relation.source:
        raise InvalidInputError("概念关系缺少源概念")
    if not relation.target:
        raise InvalidInputError("概念关系缺少目标概念")
    if relation.source not in concept_names:
        raise InvalidInputError(f"概念关系的源概念不存在: {relation.source}")
    if relation.target not in concept_names:
        raise InvalidInputError(f"概念关系的目标概念不存在: {relation.target}")
    if relation.source == relation.target:
        raise InvalidInputError("概念关系不能指向概念自身")

    if relation.relation_type == EQUIVALENT_CLASS:
        if is_ancestor(data, relation.source, relation.target) or is_ancestor(
            data, relation.target, relation.source
        ):
            raise InvalidInputError("等价关系不能建立在祖先-后代概念之间（与继承关系矛盾）")
    if relation.relation_type == DISJOINT_WITH:
        if is_ancestor(data, relation.source, relation.target) or is_ancestor(
            data, relation.target, relation.source
        ):
            raise InvalidInputError("互斥关系不能建立在祖先-后代概念之间")

    # 对称关系（等价/互斥）：同一无序概念对只允许登记一条，反向重复直接拒绝
    if relation.relation_type in (EQUIVALENT_CLASS, DISJOINT_WITH):
        pair = frozenset((relation.source, relation.target))
        for other in data.concept_relations:
            if other.name == exclude_name:
                continue
            if other.relation_type != relation.relation_type:
                continue
            if frozenset((other.source, other.target)) == pair:
                raise InvalidInputError(
                    f"概念关系已存在（{other.name}）：{relation.relation_type} 是对称关系，"
                    "同一概念对只登记一条，禁止反向重复"
                )

    validate_link_attributes(
        data, relation.source, relation.target, relation.source_attr, relation.target_attr
    )


def validate_process(process: ProcessItem, data: OntologyData) -> None:
    """流程级校验：步骤的「当前动作」必须非空且命中本体行为；上一动作（可空 = 流程起点）同理。

    动作即行为名——流程是行为的编排，引用不存在的动作会让流程图/技能摘要出现幽灵节点。
    """
    behavior_names = {b.name for b in data.behaviors if b.name}
    for step in process.steps or []:
        if not step.current_action:
            raise InvalidInputError("流程步骤缺少 current_action（当前动作）")
        if step.current_action not in behavior_names:
            raise InvalidInputError(f"流程步骤引用的行为不存在: {step.current_action}")
        if step.previous_action and step.previous_action not in behavior_names:
            raise InvalidInputError(f"流程步骤引用的上一动作不存在: {step.previous_action}")


def validate_function_concepts(function: FunctionItem, data: OntologyData) -> None:
    """函数级校验：``related_concepts`` 声明的概念必须存在于本体（约束回溯的数据源）。"""
    concept_names = {c.name for c in data.concepts if c.name}
    for name in function.related_concepts or []:
        if name and name not in concept_names:
            raise InvalidInputError(f"函数关联概念不存在: {name}")
