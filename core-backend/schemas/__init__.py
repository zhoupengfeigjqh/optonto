"""Pydantic schemas for ontology YAML data structures.

枚举值域口径（spec 003 假设）：值域类非法值一律**静默归一**（不报错、不阻断保存），
跨字段强耦合校验放业务层（`services/validators.py` → `errors.InvalidInputError` → 400）。
"""

import logging

from pydantic import BaseModel, Field, field_validator, model_validator

logger = logging.getLogger("core-backend")

# ─── 枚举值域（spec 003）──────────────────────────────────────────────────────

# 关系类型：5 值，可多选（值域外的值静默丢弃）
RELATION_TYPES = ('asymmetric', 'symmetric', 'transitive', 'functional', 'inverse_functional')
# 函数类型：5 值单选，英文码（值域外归一为空串）
FUNCTION_TYPES = ('TRANSFORMATION', 'CALCULATION', 'DERIVATION', 'VALIDATION', 'MODEL')
# 概念生命周期状态属性名：该属性承担对象生命周期语义，其 constraint.enum 即状态全集
STATUS_ATTR_NAME = 'status'


# ─── Ontology Components (YAML-based) ─────────────────────────────────────────

class ConstraintItem(BaseModel):
    """属性约束（挂载在 AttributeItem.constraint 下，全部缺省即无约束、不落盘）。"""
    unique: bool = Field(False, description="是否唯一")
    required: bool = Field(False, description="是否非空")
    enum: list = Field(default_factory=list, description="枚举值")
    pattern: str = Field("", description="匹配模式（正则，仅 string 类型）")
    min: float | None = Field(None, description="取值范围-最小值（仅 number/integer 类型）")
    max: float | None = Field(None, description="取值范围-最大值（仅 number/integer 类型）")

    @field_validator('required', mode='before')
    @classmethod
    def coerce_required(cls, v: any) -> bool:
        return bool(v) if v is not None else False


class AttributeItem(BaseModel):
    name: str = Field(..., description="属性名")
    type: str = Field(..., description="属性类型")
    display_name: str = Field("", description="展示名称")
    description: str = Field("", description="属性描述，用于描述属性语义信息")
    example: str = Field("", description="示例")
    constraint: ConstraintItem | None = Field(None, description="约束")

    @field_validator('example', mode='before')
    @classmethod
    def coerce_example(cls, v: any) -> str:
        return str(v) if v is not None else ""

    @field_validator('constraint', mode='before')
    @classmethod
    def coerce_constraint(cls, v: any) -> any:
        # 存量自由文本约束（"唯一"/"≥ 0"/"yyyy-mm-dd" 等）按决议直接丢弃
        if isinstance(v, str) or v is None:
            return None
        return v

    @field_validator('constraint')
    @classmethod
    def unique_implies_required(cls, v: ConstraintItem | None) -> ConstraintItem | None:
        # 选了唯一则必须非空（与前端联动同规则，兜底 API 直调）
        if v is not None and v.unique:
            v.required = True
        # 全缺省视为无约束，避免 YAML 落一串默认值噪音
        if v is not None and not v.unique and not v.required and not v.enum and not v.pattern and v.min is None and v.max is None:
            return None
        return v


class ConceptItem(BaseModel):
    name: str = Field(..., description="概念名")
    description: str = Field("", description="概念描述")
    attributes: list[AttributeItem] = Field(default_factory=list, description="属性列表")
    display_name: str = Field("", description="展示名称")
    instance_label: str = Field("", description="实例标签：用于实例展示时作为节点标签，可选值为属性的英文名")
    terms: list[str] = Field(default_factory=list, description="术语集：该概念的其他表述（同义词/别名/简称等）")

    @field_validator('terms', mode='before')
    @classmethod
    def coerce_terms(cls, v: any) -> list[str]:
        """术语集规范化：去重、去空串、去首尾空白（顺序保持首次出现）。"""
        if v is None:
            return []
        if isinstance(v, str):
            v = [v]
        if not isinstance(v, list):
            return []
        out: list[str] = []
        for t in v:
            s = str(t).strip()
            if s and s not in out:
                out.append(s)
        return out


class RelationItem(BaseModel):
    name: str = Field(..., description="关系名")
    source: str = Field(..., description="源概念")
    target: str = Field(..., description="目标概念")
    cardinality: str = Field("1:N", description="基数 (1:N, N:1, N:M)")
    source_attr: str = Field("", description="关联概念属性-源端（源概念.属性）")
    target_attr: str = Field("", description="关联概念属性-目标端（目标概念.属性）")
    description: str = Field("", description="关系说明")
    display_name: str = Field("", description="展示名称")

    relation_type: list[str] = Field(
        default_factory=list,
        description="关系类型（可多选）：asymmetric/symmetric/transitive/functional/inverse_functional",
    )

    @field_validator('cardinality', mode='before')
    @classmethod
    def coerce_cardinality(cls, v: any) -> str:
        valid = {'1:1', 'N:1', '1:N', 'N:M'}
        s = str(v) if v is not None else "1:N"
        return s if s in valid else "1:N"

    @field_validator('relation_type', mode='before')
    @classmethod
    def coerce_relation_type(cls, v: any) -> list[str]:
        """关系类型规范化：值域外丢弃、去重保序（不阻断保存）。"""
        if v is None:
            return []
        if isinstance(v, str):
            v = [v]
        if not isinstance(v, list):
            return []
        out: list[str] = []
        for t in v:
            s = str(t)
            if s in RELATION_TYPES and s not in out:
                out.append(s)
        return out


class BehaviorItem(BaseModel):
    """本体行为。

    行为关联概念**唯一**（``concept`` 标量）；command 行为可声明状态机跃迁
    ``from_status`` → ``to_status``，取值来自关联概念 ``status`` 属性的 ``constraint.enum``
    （强耦合校验见 ``services/validators.py``：越界 → 400）。
    """

    name: str = Field(..., description="行为名称")
    description: str = Field("", description="行为描述")
    op_type: str = Field("", description="操作类型（command/query）")
    params: dict = Field(default_factory=dict, description="输入参数")
    response: dict = Field(default_factory=dict, description="返回结构 (JSON)")
    concept: str = Field("", description="关联概念（唯一）")
    display_name: str = Field("", description="展示名称")
    from_status: str = Field("", description="源状态：command 状态机跃迁起点（取自关联概念 status 枚举）")
    to_status: str = Field("", description="目标状态：command 状态机跃迁终点（取自关联概念 status 枚举）")

    @model_validator(mode='before')
    @classmethod
    def migrate_related_concepts(cls, v: any) -> any:
        """旧字段 related_concepts（数组）→ concept（标量）。

        spec 003：行为关联概念收缩为唯一。存量数据实测恒为单元素，迁移无损；
        意外多元素时取首个并记 warning（不报错，保持读时兼容口径）。
        """
        if isinstance(v, dict) and 'related_concepts' in v and 'concept' not in v:
            legacy = v.get('related_concepts') or []
            if isinstance(legacy, str):
                legacy = [legacy]
            if isinstance(legacy, list) and len(legacy) > 1:
                logger.warning("行为 %s 的 related_concepts 含 %d 个元素，迁移取首个", v.get('name'), len(legacy))
            v = {**v, 'concept': str(legacy[0]) if isinstance(legacy, list) and legacy else ""}
        return v


class RuleItem(BaseModel):
    """本体规则：附着于行为的约束逻辑。

    2026-09-30 口径 B（类型即角色 → 真阻断）：
    - 规则的约束逻辑由 ``related_functions``（关联函数）承载，可含**本体函数与公共函数**；
      其中**本体函数且 ``type=VALIDATION``（逻辑验证）者为「判断函数」**——运行期由 agent 侧规则闸
      在主行为工具调用前核查其统一信封返回值 ``data.pass/reason``：``pass=false`` 或缺失 ``pass``
      （fail-closed）即拒绝主行为（真阻断）；其余函数（CALCULATION 等本体函数 / 公共函数）只要求
      执行过（留痕审计）。
    - ``data_supplements``：按关联函数声明关联的概念（``related_concepts``）推出对应 query 行为（前端自动推导，可手工增减）。
    - 旧条件树字段已退役（字段移除，不再读时兼容）；旧 ``check_functions`` 读时并入
      ``related_functions``（口径 B 取消独立裁决函数字段——角色由函数类型承载）。
    - 绑定行为唯一（``behavior`` 标量）口径不变。
    """

    name: str = Field(..., description="规则名")
    description: str = Field("", description="规则描述")
    behavior: str = Field("", description="绑定行为（唯一）")
    related_functions: list[str] = Field(default_factory=list, description="关联函数（本体函数∪公共函数；本体且 type=VALIDATION 者为判断函数，返回 data.pass/reason 并参与真阻断）")
    display_name: str = Field("", description="展示名称")
    position: str = Field("", description="介入位置（前置/后置）")
    data_supplements: list[str] = Field(default_factory=list, description="数据补充（可多选 query 行为；自动推导自关联函数声明的关联概念，可手工增减）")

    @model_validator(mode='before')
    @classmethod
    def migrate_rule_fields(cls, v: any) -> any:
        """读时迁移（口径同项目既有惯例）：
        ① 旧字段 related_behaviors（数组）→ behavior（标量）：取唯一元素；
        ② 旧字段 check_functions（裁决函数列表，2026-09-30 口径 B 已取消）→ 并入 related_functions
           （角色改由函数类型承载：VALIDATION 型本体函数即判断函数）。
        """
        if not isinstance(v, dict):
            return v
        if 'related_behaviors' in v and 'behavior' not in v:
            legacy = v.get('related_behaviors') or []
            if isinstance(legacy, str):
                legacy = [legacy]
            if isinstance(legacy, list) and len(legacy) > 1:
                logger.warning("规则 %s 的 related_behaviors 含 %d 个元素，迁移取首个", v.get('name'), len(legacy))
            v = {**v, 'behavior': str(legacy[0]) if isinstance(legacy, list) and legacy else ""}
        if 'check_functions' in v:
            legacy_checks = v.get('check_functions') or []
            if isinstance(legacy_checks, str):
                legacy_checks = [legacy_checks]
            current = v.get('related_functions') or []
            if isinstance(current, str):
                current = [current]
            merged = [f for f in [*current, *legacy_checks] if f]
            v = {k: val for k, val in v.items() if k != 'check_functions'}
            v = {**v, 'related_functions': list(dict.fromkeys(merged))}
        return v


class ProcessStep(BaseModel):
    current_action: str = Field("", description="当前动作")
    previous_action: str = Field("", description="上一动作")
    description: str = Field("", description="步骤描述")
    connection_type: str = Field("串行", description="衔接类型（串行/并行）")

    @field_validator('connection_type', mode='before')
    @classmethod
    def coerce_connection_type(cls, v: any) -> str:
        valid = {'串行', '并行'}
        s = str(v) if v is not None else "串行"
        return s if s in valid else "串行"


class ProcessItem(BaseModel):
    name: str = Field(..., description="流程英文名称")
    display_name: str = Field("", description="流程展示名称")
    goal: str = Field("", description="流程目标")
    description: str = Field("", description="流程描述")
    steps: list[ProcessStep] = Field(default_factory=list, description="流程步骤列表")


class SecurityItem(BaseModel):
    """行为安全管控配置（独立存放于 securities.yaml，与安全页签列一一对应，六字段齐全）。

    display_name/op_type 为反范式快照字段：保存时由后端从 behaviors + data_engines 重新推导
    覆盖写入（只读，API 传入值无效），保证与行为定义永不漂移。
    scope: 权限范围，恒为数组（类型稳定）：['everyone']=所有用户（默认）、['disable']=全部禁用、
    ['用户名', ...]=用户或组织白名单（后续用户表落地后使用）。旧标量形态（scope: everyone）加载时自动包成单元素数组。
    confirm: true=执行前弹窗人工确认（command 行为默认），false=显式关闭。
    文件为全花名册：每个行为恒定一条记录（保存时自动增删同步），全字段恒落盘。
    旧格式加载时自动迁移：audit_content→confirm_content，audit_node 废弃；
    ontology.yaml 旧 securities 段在 securities.yaml 缺失时读时回退，保存后彻底剥离。
    """
    action_name: str = Field(..., description="行为名称（选自行为列表）")
    display_name: str = Field("", description="行为展示名称（保存时后端从行为定义刷新，只读快照）")
    op_type: str = Field("", description="操作类型 command/query（保存时后端推导刷新，只读快照）")
    scope: list[str] = Field(default_factory=lambda: ["everyone"], description="权限范围（恒数组）：everyone=所有用户（默认）/disable=全部禁用/用户或组织白名单（后续）")
    confirm: bool = Field(True, description="人工确认：true=执行前弹窗确认，false=显式关闭")
    confirm_content: str = Field("", description="确认内容（弹窗提示文案，留空用通用文案）")

    @field_validator('scope', mode='before')
    @classmethod
    def coerce_scope(cls, v: any) -> any:
        # 兼容旧标量形态：str → 单元素数组
        if isinstance(v, str):
            return [v]
        return v

    @field_validator('scope')
    @classmethod
    def validate_scope(cls, v: list[str]) -> list[str]:
        if not v:
            raise ValueError("权限范围不能为空：至少保留 everyone")
        # everyone/disable 为互斥特殊值：只能单独选择，不得与其他值（含彼此）共存；用户名之间可多选
        if len(v) > 1 and {'everyone', 'disable'} & set(v):
            raise ValueError("权限范围非法：everyone/disable 只能单独选择，不能与其他值共存")
        return v

    @model_validator(mode='before')
    @classmethod
    def migrate_legacy(cls, v: any) -> any:
        if isinstance(v, dict) and 'audit_content' in v and 'confirm_content' not in v:
            v = {**v, 'confirm_content': v.get('audit_content') or ''}
        return v


class FunctionItem(BaseModel):
    name: str = Field(..., description="函数名称")
    display_name: str = Field("", description="展示名称")
    description: str = Field("", description="描述/计算逻辑")
    related_concepts: list[str] = Field(default_factory=list, description="关联概念")
    params: dict = Field(default_factory=dict, description="输入参数")
    response: dict = Field(default_factory=dict, description="返回结构")
    code_file: str = Field("", description="函数代码文件路径（functions/函数名.py）")
    type: str = Field("", description="函数类型：TRANSFORMATION/CALCULATION/DERIVATION/VALIDATION/MODEL")

    @field_validator('type', mode='before')
    @classmethod
    def coerce_function_type(cls, v: any) -> str:
        """函数类型规范化：值域外归一为空串（不推断、不阻断）。"""
        s = str(v) if v is not None else ""
        return s if s in FUNCTION_TYPES else ""


class TargetApiConfig(BaseModel):
    """目标系统 API 配置"""
    data_source_name: str = Field("", description="数据源名称")
    api_name: str = Field("", description="接口名称")
    url: str = Field("", description="API接口地址")
    method: str = Field("POST", description="请求方式 (GET/POST/PATCH/DELETE)")
    params: dict = Field(default_factory=dict, description="输入参数")
    response: dict = Field(default_factory=dict, description="输出结构")
    # 下游 MCP 服务与工具（落盘自包含，不引用外部注册表；引擎唯一形态=MCP）
    server_url: str = Field("", description="下游 MCP 服务地址（Streamable HTTP 端点，必填）")
    tool_name: str = Field("", description="下游 MCP 工具名（必填）")
    output_fields: list[str] = Field(default_factory=list, description="目标输出字段（无 outputSchema 时手工/试调录入，设计期参照）")
    headers: dict = Field(default_factory=dict, description="连接下游 MCP 携带的 HTTP 头（远程鉴权，可选）")


class DataEngineItem(BaseModel):
    """数据引擎 — 本体行为与目标 MCP 工具映射（SQL/HTTP 型已删除，2026-09-07）"""
    name: str = Field(..., description="数据引擎名称")
    display_name: str = Field("", description="展示名称")
    behavior_name: str = Field(..., description="本体行为名称")
    target: TargetApiConfig = Field(default_factory=TargetApiConfig)
    input_mapping: dict = Field(default_factory=dict, description="输入映射 {ontology_param: target_param}")
    output_mapping: dict = Field(default_factory=dict, description="输出映射 {ontology_field: target_field}")


class OntologyData(BaseModel):
    """本体完整数据结构，对应 YAML 文件内容。"""
    metadata: dict = Field(default_factory=dict, description="元数据（名称、来源等）")
    concepts: list[ConceptItem] = Field(default_factory=list)
    relations: list[RelationItem] = Field(default_factory=list)
    functions: list[FunctionItem] = Field(default_factory=list, description="函数列表")
    behaviors: list[BehaviorItem] = Field(default_factory=list)
    rules: list[RuleItem] = Field(default_factory=list)
    processes: list[ProcessItem] = Field(default_factory=list)
    securities: list[SecurityItem] = Field(default_factory=list)
    data_engines: list[DataEngineItem] = Field(default_factory=list)


# ─── YAML file list ───────────────────────────────────────────────────────────

class YamlFileOut(BaseModel):
    path: str
    content: str
    updated_at: str = ""