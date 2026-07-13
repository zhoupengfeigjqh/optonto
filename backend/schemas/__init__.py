"""Pydantic schemas for request/response validation."""

from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


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


class BehaviorItem(BaseModel):
    name: str = Field(..., description="行为名称")
    description: str = Field("", description="行为描述")
    url: str = Field("", description="HTTP URL")
    method: str = Field("POST", description="请求方式 (POST/GET)")
    params: dict = Field(default_factory=dict, description="接口参数 (JSON)")
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
    description: str = Field("", description="事件描述")
    related_behavior: Optional[str] = Field(None, description="关联行为")
    trigger_behaviors: list[str] = Field(default_factory=list, description="后续触发行为（可多选）")
    display_name: str = Field("", description="展示名称")


class OntologyData(BaseModel):
    """本体完整数据结构，对应 YAML 文件内容。"""
    concepts: list[ConceptItem] = Field(default_factory=list)
    relations: list[RelationItem] = Field(default_factory=list)
    behaviors: list[BehaviorItem] = Field(default_factory=list)
    rules: list[RuleItem] = Field(default_factory=list)
    events: list[EventItem] = Field(default_factory=list)


# ─── YAML file list ───────────────────────────────────────────────────────────

class YamlFileOut(BaseModel):
    path: str
    content: str
