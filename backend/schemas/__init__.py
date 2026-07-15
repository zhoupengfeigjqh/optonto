"""Pydantic schemas for request/response validation."""

from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field, field_validator


# ─── Scenario ─────────────────────────────────────────────────────────────────

class ScenarioCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255, description="场景名称")
    description: str = Field("", description="场景描述")


class ScenarioUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None


class ScenarioOut(BaseModel):
    id: int
    name: str
    description: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ─── Ontology ─────────────────────────────────────────────────────────────────

class OntologyCreate(BaseModel):
    scenario_id: int
    name: str = Field(..., min_length=1, max_length=255, description="本体名称")
    description: str = Field("", description="本体描述")
    creator: str = Field("", description="创建人")


class OntologyUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    creator: Optional[str] = None


class OntologyOut(BaseModel):
    id: int
    scenario_id: int
    name: str
    description: str
    creator: str
    scenario_name: str = Field("", description="所属场景名称")
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ─── Ontology Components (YAML-based) ─────────────────────────────────────────

class AttributeItem(BaseModel):
    name: str = Field(..., description="属性名")
    type: str = Field(..., description="属性类型")
    required: bool = Field(True, description="是否必填")
    display_name: str = Field("", description="展示名称")
    example: str = Field("", description="示例")
    constraint: str = Field("", description="约束")

    @field_validator('example', mode='before')
    @classmethod
    def coerce_example(cls, v: any) -> str:
        return str(v) if v is not None else ""


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
    url: str = Field("", description="HTTP URL")
    method: str = Field("POST", description="请求方式 (GET/POST/PATCH/DELETE)")
    params: dict = Field(default_factory=dict, description="接口参数 (JSON)")
    response: dict = Field(default_factory=dict, description="返回结构 (JSON)")
    related_concepts: list[str] = Field(default_factory=list, description="关联概念")
    display_name: str = Field("", description="展示名称")


class RuleItem(BaseModel):
    name: str = Field(..., description="规则名")
    description: str = Field("", description="规则描述")
    related_behaviors: list[str] = Field(default_factory=list, description="关联行为（可多选）")
    display_name: str = Field("", description="展示名称")
    rule_type: str = Field("", description="规则类型（计算规则/验证规则/推理规则）")
    position: str = Field("", description="介入位置（前置/后置）")


class EventItem(BaseModel):
    name: str = Field(..., description="事件名")
    event_type: str = Field("", description="事件类型（动作执行/状态变化）")
    trigger_condition: str = Field("", description="触发条件")
    related_concepts: list[str] = Field(default_factory=list, description="关联概念（可多选）")
    related_behavior: Optional[str] = Field(None, description="关联行为")
    trigger_behaviors: list[str] = Field(default_factory=list, description="后续触发行为（可多选）")
    display_name: str = Field("", description="展示名称")


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
    action_name: str = Field(..., description="动作名称（选自行为列表）")
    audit_node: str = Field("前置", description="审核节点（前置/后置）")
    audit_content: str = Field("", description="审核内容")

    @field_validator('audit_node', mode='before')
    @classmethod
    def coerce_audit_node(cls, v: any) -> str:
        valid = {'前置', '后置'}
        s = str(v) if v is not None else "前置"
        return s if s in valid else "前置"


class TargetApiConfig(BaseModel):
    """目标系统 API 配置"""
    data_source_name: str = Field("", description="数据源名称")
    api_name: str = Field("", description="接口名称")
    url: str = Field("", description="API接口地址")
    method: str = Field("POST", description="请求方式 (GET/POST/PATCH/DELETE)")
    params: dict = Field(default_factory=dict, description="输入参数")
    response: dict = Field(default_factory=dict, description="输出结构")


class DataEngineItem(BaseModel):
    """数据引擎 — 本体行为与目标API映射"""
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
    behaviors: list[BehaviorItem] = Field(default_factory=list)
    rules: list[RuleItem] = Field(default_factory=list)
    events: list[EventItem] = Field(default_factory=list)
    processes: list[ProcessItem] = Field(default_factory=list)
    securities: list[SecurityItem] = Field(default_factory=list)
    data_engines: list[DataEngineItem] = Field(default_factory=list)


# ─── YAML file list ───────────────────────────────────────────────────────────

class YamlFileOut(BaseModel):
    path: str
    content: str
    updated_at: str = ""
