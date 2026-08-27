"""Pydantic schemas for ontology YAML data structures."""

from pydantic import BaseModel, Field, field_validator, model_validator


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


class RelationItem(BaseModel):
    name: str = Field(..., description="关系名")
    source: str = Field(..., description="源概念")
    target: str = Field(..., description="目标概念")
    cardinality: str = Field("1:N", description="基数 (1:N, N:1, N:M)")
    source_attr: str = Field("", description="关联概念属性-源端（源概念.属性）")
    target_attr: str = Field("", description="关联概念属性-目标端（目标概念.属性）")
    description: str = Field("", description="关系说明")
    display_name: str = Field("", description="展示名称")

    @field_validator('cardinality', mode='before')
    @classmethod
    def coerce_cardinality(cls, v: any) -> str:
        valid = {'1:1', 'N:1', '1:N', 'N:M'}
        s = str(v) if v is not None else "1:N"
        return s if s in valid else "1:N"


class BehaviorItem(BaseModel):
    name: str = Field(..., description="行为名称")
    description: str = Field("", description="行为描述")
    behavior_type: str = Field("API", description="接口类型（API/SQL）")
    op_type: str = Field("", description="操作类型（command/query）")
    params: dict = Field(default_factory=dict, description="输入参数")
    response: dict = Field(default_factory=dict, description="返回结构 (JSON)")
    related_concepts: list[str] = Field(default_factory=list, description="关联概念")
    display_name: str = Field("", description="展示名称")


class RuleItem(BaseModel):
    name: str = Field(..., description="规则名")
    description: str = Field("", description="规则描述")
    related_behaviors: list[str] = Field(default_factory=list, description="关联行为（可多选）")
    related_functions: list[str] = Field(default_factory=list, description="关联函数（可多选）")
    display_name: str = Field("", description="展示名称")
    rule_type: str = Field("", description="规则类型（验证规则/推理规则）")
    position: str = Field("", description="介入位置（前置/后置）")
    rule_detail: dict | None = Field(None, description="规则结构配置（条件结构）")
    data_supplements: list[str] = Field(default_factory=list, description="数据补充（可多选行为）")


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


class TargetApiConfig(BaseModel):
    """目标系统 API 配置"""
    data_source_name: str = Field("", description="数据源名称")
    api_name: str = Field("", description="接口名称")
    url: str = Field("", description="API接口地址")
    method: str = Field("POST", description="请求方式 (GET/POST/PATCH/DELETE)")
    params: dict = Field(default_factory=dict, description="输入参数")
    response: dict = Field(default_factory=dict, description="输出结构")


class DataEngineItem(BaseModel):
    """数据引擎 — 本体行为与目标API/SQL映射"""
    name: str = Field(..., description="数据引擎名称")
    display_name: str = Field("", description="展示名称")
    behavior_name: str = Field(..., description="本体行为名称")
    engine_type: str = Field("API", description="引擎类型（API/SQL）")
    target: TargetApiConfig = Field(default_factory=TargetApiConfig)
    input_mapping: dict = Field(default_factory=dict, description="输入映射 {ontology_param: target_param}")
    output_mapping: dict = Field(default_factory=dict, description="输出映射 {ontology_field: target_field}")
    sql: str = Field("", description="SQL 查询语句")


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
