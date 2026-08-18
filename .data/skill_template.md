---
name: skill name（必须是英文）
description: 技能描述
---

# 原材料库存和采购本体技能

## 0 本体基本信息
本体名称（ontology_name）: 原材料库存和采购
本体id（ontology_id）: 1
场景名称（scenario_name）: 生产调度
场景id（scenario_id）: 1

## 1概念与关系
【重点：特别注意，概念-属性-关系代表着该领域的最基本业务逻辑，智能体的任务生成和执行都必须从该网络出发展开】

（概念基本信息，提供名称（英文）和展示名称（中文）信息）
（概念关系基本信息，提供名称（英文）和展示名称（中文）信息，并说明整个关系体系的逻辑）
（概念属性基本信息，提供名称（英文）和展示名称（中文）信息）

## 2重要业务流程
【重点：重点业务流程，用于任务执行逻辑的参考，注意这里不是该流程是唯一固定的】

（原材料库存和采购的核心业务流程）

## 3行为

（行为介绍：包括行为英文名、中文名、类型、行为描述、输入参数（原封不动不修改）、输出结构（原封不动不修改）、相关概念（中文描述）；每个行为需指明需要调用的接口MCP工具，智能体根据该工具的参数自动组装并调用该工具）

例子如下：
### 3.1 QuerySuppliers
- **类型**: 查询行为
- **行为描述**: 根据供应商名或原材料名查询供应商。
- **输入参数**:
```json
{
  "supplierName": {"type": "string", "required": false, "example": "宝钢钢铁集团", "display_name": "供应商名称，模糊匹配"},
  "rawMaterialName": {"type": "string", "required": false, "example": "钢板008", "display_name": "原材料名称"}
}
```
- **输出结构**:
```json
{
  "code": {"type": "number", "example": 0},
  "data": {
    "type": "array",
    "items": {
      "type": "object",
      "properties": {
        "supplierId": {"type": "string", "display_name": "供应商编号", "example": "SUP-001"},
        "supplierName": {"type": "string", "display_name": "供应商名称", "example": "宝钢钢铁集团"},
        "address": {"type": "string", "display_name": "地址", "example": "上海市宝山区富锦路888号"},
        "contactPerson": {"type": "string", "display_name": "联系人", "example": "张经理"},
        "contactPhone": {"type": "string", "display_name": "联系电话", "example": "13800131001"}
      }
    }
  }
}
```
- **相关概念**: 供应商（Supplier）、原材料（RawMaterial）
- **接口MCP工具**: 调用 `executeOntoBehavior` 执行行为，参数为 `QuerySuppliers` 及其输入参数。

## 4函数
【重点：函数的计算为实例化对象或对象集合，用于属性的计算和处理】

（函数介绍：包括英文名、中文名、计算逻辑、关联概念属性、输入参数（原封不动不修改）、返回结构（原封不动不修改）；每个函数需指明需要调用的接口MCP工具，智能体根据该工具的参数自动组装并调用该工具）

例子如下：
### 4.1 sumRawNotArrivalQty（原材料未到位数）
- **计算逻辑**: 根据传入的数据包指定的原材料，过滤掉到位时间小于当前时间的部分，对剩余部分的到位数arrivalQuantity求和。
- **关联概念属性**: 原材料采购记录（PurchaseRecord）的 rawMaterialName/原材料名称、arrivalTime/到位时间、arrivalQuantity/到位数量
- **输入参数**:
```json
{
  "filterRawMaterialName": {"type": "string", "display_name": "原材料名称", "example": "高强度钢板", "required": true},
  "currentDate": {"type": "string", "display_name": "日期", "example": "2026-01-01", "required": true},
  "purchaseRecordSet": {
    "type": "array",
    "display_name": "采购记录集",
    "items": {
      "type": "object",
      "properties": {
        "arrivalTime": {"type": "string", "display_name": "到位时间", "example": "2026-09-01", "required": true},
        "rawMaterialName": {"type": "string", "display_name": "原材料名称", "example": "高强度钢板", "required": true},
        "arrivalQuantity": {"type": "number", "display_name": "计划的到位数量", "example": 100, "required": true}
      }
    },
    "required": true
  }
}
```
- **返回结构**:
```json
{
  "result": {
    "type": "object",
    "properties": {
      "rawMaterialName": {"type": "string", "display_name": "原材料名称", "example": "高强度钢板"},
      "sumNotArrivalQty": {"type": "number", "display_name": "未到位总量", "example": 100}
    }
  }
}
```
- **接口MCP工具**: 直接调用函数名对应的 MCP 工具（工具名即函数名，如 `sumRawNotArrivalQty`）执行函数，参数为该函数声明的输入参数。

## 5规则
【重点：规则主要用于对执行行为的前置和后置进行把控，每次智能体执行行为的时候，若有规则则必须判断，以确保整个行为的执行是合法可控的。例如：在行为执行前对输入参数进行校验，或者在行为执行后对输出结果进行校验以及推理等】

（规则介绍：包括规则英文名、中文名、规则类型、规则描述、规则介入位置、关联行为、关联函数、规则结构（从ontology中原封不动提取rule_detail，不要修改））

## 6安全管控
【重点：安全管控的目的是对危险行为引入人工确认，介入位置可以在行为的执行前或执行后。介入时，智能体应该临时暂停后续操作，让用户对当前任务内容进行审核（具体内容请参考审核内容）】

（行为名称、介入位置、审核内容）