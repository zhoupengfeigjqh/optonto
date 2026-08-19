---
name: raw-material-inventory
description: 原材料库存和采购本体技能，涵盖原材料采购、库存管理、供应商管理及生产调度场景下的完整业务流程，支持采购单创建、取消、入库、库存查询、供应商查询等核心操作，并内置安全库存预警、采购超期预警等智能规则。
---

# 原材料库存和采购本体技能

## 0 本体基本信息
本体名称（ontology_name）: 原材料采购和库存
本体id（ontology_id）: 1
场景名称（scenario_name）: 生产调度
场景id（scenario_id）: 1

## 1概念与关系
【重点：特别注意，概念-属性-关系代表着该领域的最基本业务逻辑，智能体的任务生成和执行都必须从该网络出发展开】

**概念基本信息**：
- 原材料（RawMaterial）：原材料的核心基础信息，包括原材料编号、名称、计量单位及安全库存阈值。
- 供应商（Supplier）：提供原材料的供应商主体信息，包括供应商编号、名称、地址、联系人及联系方式。
- 原材料采购记录（PurchaseRecord）：记录每一次原材料采购的详细信息，包括采购单号、原材料信息、采购/到位时间、到位数量、供应商、关联客户订单及等待周期。
- 原材料库存（RawMaterialInventory）：原材料的库存快照信息，包括库存编号、原材料信息、材料类型、待入库量、累计库存量、可用库存及单位。
- 客户订单（CustomerOrder）：客户下达的生产订单信息，包括订单编号、订单名称、批次号、缓冲周期、订单类型及状态。
- 交货能力（DeliveryCapability）：供应商针对特定原材料的供货能力信息，包括原材料信息、供应商信息、交货周期及最小起订量。

**概念关系基本信息**：
- hasRawInventory（拥有库存）：原材料（RawMaterial）与原材料库存（RawMaterialInventory）之间为1:1关系，即每种原材料对应一条库存记录。
- recordsRawMaterial（记录原材料）：原材料采购记录（PurchaseRecord）与原材料（RawMaterial）之间为N:1关系，即多条采购记录可对应同一种原材料。
- orderedFromSupplier（向供应商采购）：原材料采购记录（PurchaseRecord）与供应商（Supplier）之间为N:1关系，即多条采购记录可对应同一供应商。
- suppliesRawMaterial（供应原材料）：供应商（Supplier）与原材料（RawMaterial）之间为N:M关系，即一个供应商可供应多种原材料，一种原材料也可由多个供应商供应。
- containsPurchaseRecord（包含采购记录）：客户订单（CustomerOrder）与原材料采购记录（PurchaseRecord）之间为1:N关系，即一个客户订单可包含多条采购记录。
- hasCapability（具有供货能力）：供应商（Supplier）与交货能力（DeliveryCapability）之间为1:N关系，即一个供应商可具备多种原材料的交货能力。

整个关系体系以原材料（RawMaterial）为核心节点，通过采购记录（PurchaseRecord）串联起供应商（Supplier）与客户订单（CustomerOrder），并通过库存（RawMaterialInventory）和交货能力（DeliveryCapability）形成完整的采购-库存-供应业务闭环。

**概念属性基本信息**：
- 原材料（RawMaterial）：rawMaterialId/原材料编号、rawMaterialName/原材料名称、unit/单位、safetyStock/安全库存
- 供应商（Supplier）：supplierId/供应商编号、supplierName/供应商名称、address/地址、contactPerson/联系人、contactPhone/联系电话
- 原材料采购记录（PurchaseRecord）：purchaseRecordId/采购单号、rawMaterialId/原材料编号、rawMaterialName/原材料名称、purchaseTime/采购时间、arrivalTime/到位时间、arrivalQuantity/到位数量、unit/单位、leadTime/等待周期、supplierName/供应商名称、relatedOrderId/关联订单编号、relatedOrderName/关联订单名称
- 原材料库存（RawMaterialInventory）：inventoryId/库存编号、rawMaterialId/原材料编号、rawMaterialName/原材料名称、materialType/材料类型、pendingReceiptQuantity/待入库量、cumulativeStockQuantity/累计库存量、availableStock/可用库存、unit/单位
- 客户订单（CustomerOrder）：customerOrderId/客户订单编号、customerOrderName/客户订单名称、batchNumber/批次号、bufferPeriod/缓冲周期、orderType/订单类型、status/状态
- 交货能力（DeliveryCapability）：rawMaterialId/原材料编号、rawMaterialName/原材料名称、supplierName/供应商名称、supplierId/供应商编号、leadTime/交货周期、minCount/最小起订量

## 2重要业务流程
【重点：重点业务流程，用于任务执行逻辑的参考，注意这里不是该流程是唯一固定的】

**原材料采购到入库（ProcureAndReceiveRawMaterial）** 是原材料库存和采购领域的核心业务流程，具体步骤如下：

1. **查询库存（QueryInventory）**：用户或系统查询原材料库存，判断是否需要采购。若可用库存低于安全库存，则触发采购需求。
2. **创建采购单（CreatePurchaseRecord）**：根据库存情况或客户订单需求，创建原材料采购单。创建时需校验原材料存在性、单位一致性、到位时间合理性、供应商名称有效性及关联订单存在性。
3. **查询采购记录（QueryPurchaseRecords）**：定期或主动按需查询采购记录，跟踪已创建的采购单状态，确认采购单是否已到位。
4. **入库原材料（ReceiveRawMaterial）**：确认原材料到货，执行入库操作，更新库存信息。
5. **再次查询库存（QueryInventory）**：入库完成后，再次查询库存，确认库存状态已更新。

## 3行为

### 3.1 CreatePurchaseRecord
- **类型**: 操作行为
- **行为描述**: 创建一笔新的原材料采购记录。
- **输入参数**:
```json
{
  "rawMaterialId": {"type": "string", "required": true, "description": "", "example": "RM-001", "display_name": "原材料编号"},
  "rawMaterialName": {"type": "string", "required": true, "description": "", "example": "高强度钢板", "display_name": "原材料名称"},
  "arrivalQuantity": {"type": "number", "required": true, "description": "", "example": 50, "display_name": "到位数量"},
  "supplierName": {"type": "string", "required": true, "description": "", "example": "XX钢铁集团", "display_name": "供应商名称"},
  "arrivalTime": {"type": "string", "required": true, "description": "", "example": "2023-11-10", "display_name": "到位时间"},
  "relatedOrderId": {"type": "string", "required": false, "description": "", "example": "SO-20231025-001", "display_name": "关联订单编号"},
  "relatedOrderName": {"type": "string", "required": false, "description": "", "example": "客户A-项目X订单", "display_name": "关联订单名称"},
  "unit": {"type": "string", "required": true, "description": "", "example": "吨", "display_name": "单位"}
}
```
- **输出结构**:
```json
{
  "code": {"type": "number", "example": 0},
  "data": {
    "type": "object",
    "properties": {
      "purchaseRecordId": {"type": "string", "display_name": "采购单号", "example": "PO-20231027-001"},
      "rawMaterialId": {"type": "string", "display_name": "原材料编号", "example": "RM-001"},
      "rawMaterialName": {"type": "string", "display_name": "原材料名称", "example": "高强度钢板"},
      "purchaseTime": {"type": "string", "display_name": "采购时间", "example": "2023-10-27"},
      "arrivalTime": {"type": "string", "display_name": "到位时间", "example": "2023-11-10"},
      "arrivalQuantity": {"type": "number", "display_name": "到位数量", "example": 50},
      "unit": {"type": "string", "display_name": "单位", "example": "吨"},
      "supplierName": {"type": "string", "display_name": "供应商名称", "example": "XX钢铁集团"},
      "relatedOrderId": {"type": "string", "display_name": "关联订单编号", "example": "SO-20231025-001"},
      "relatedOrderName": {"type": "string", "display_name": "关联订单名称", "example": "客户A-项目X订单"},
      "leadTime": {"type": "number", "display_name": "等待周期", "example": 14},
      "status": {"type": "string", "display_name": "状态", "example": "待入库"}
    }
  }
}
```
- **相关概念**: 原材料（RawMaterial）、供应商（Supplier）、原材料采购记录（PurchaseRecord）、客户订单（CustomerOrder）
- **接口MCP工具**: 调用 `executeOntoBehavior` 执行行为，参数为 `CreatePurchaseRecord` 及其输入参数。

### 3.2 CancelPurchaseRecord
- **类型**: 操作行为
- **行为描述**: 取消一笔已创建但尚未入库的采购记录。
- **输入参数**:
```json
{
  "purchaseRecordId": {"type": "string", "required": true, "description": "", "example": "PO-20231027-001", "display_name": "采购单号"}
}
```
- **输出结构**:
```json
{
  "code": {"type": "number", "example": 0},
  "data": {
    "type": "object",
    "properties": {
      "purchaseRecordId": {"type": "string", "display_name": "采购单号", "example": "PO-20231027-001"},
      "rawMaterialId": {"type": "string", "display_name": "原材料ID", "example": "CRX001"},
      "rawMaterialName": {"type": "string", "display_name": "原材料名称", "example": "高强度钢板"}
    }
  }
}
```
- **相关概念**: 原材料采购记录（PurchaseRecord）、原材料（RawMaterial）
- **接口MCP工具**: 调用 `executeOntoBehavior` 执行行为，参数为 `CancelPurchaseRecord` 及其输入参数。

### 3.3 ReceiveRawMaterial
- **类型**: 操作行为
- **行为描述**: 将原材料采购入库。
- **输入参数**:
```json
{
  "purchaseRecordId": {"type": "string", "required": true, "description": "", "example": "PO-20231027-001", "display_name": "采购单号"}
}
```
- **输出结构**:
```json
{
  "code": {"type": "number", "example": 0},
  "data": {
    "type": "object",
    "properties": {
      "purchaseRecordId": {"type": "string", "display_name": "采购单号", "example": "PO-20231027-001"},
      "rawMaterialId": {"type": "string", "display_name": "原材料ID", "example": "CRX001"},
      "rawMaterialName": {"type": "string", "display_name": "原材料名称", "example": "高强度钢板"}
    }
  }
}
```
- **相关概念**: 原材料采购记录（PurchaseRecord）、原材料（RawMaterial）、原材料库存（RawMaterialInventory）
- **接口MCP工具**: 调用 `executeOntoBehavior` 执行行为，参数为 `ReceiveRawMaterial` 及其输入参数。

### 3.4 QueryInventory
- **类型**: 查询行为
- **行为描述**: 根据原材料ID或名称查询其最新的库存快照。
- **输入参数**:
```json
{
  "rawMaterialId": {"type": "string", "required": false, "description": "", "example": "RM-001", "display_name": "原材料编号"},
  "rawMaterialName": {"type": "string", "required": false, "description": "", "example": "高强度钢板", "display_name": "原材料名称"}
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
        "inventoryId": {"type": "string", "display_name": "库存编号", "example": "INV-RM-001"},
        "rawMaterialId": {"type": "string", "display_name": "原材料编号", "example": "RM-001"},
        "rawMaterialName": {"type": "string", "display_name": "原材料名称", "example": "高强度钢板"},
        "materialType": {"type": "string", "display_name": "材料类型", "example": "原材料"},
        "pendingReceiptQuantity": {"type": "number", "display_name": "待入库量", "example": 50},
        "cumulativeStockQuantity": {"type": "number", "display_name": "累计库存量", "example": 200},
        "availableStock": {"type": "number", "display_name": "可用库存", "example": 150},
        "unit": {"type": "string", "display_name": "单位", "example": "吨"}
      }
    }
  }
}
```
- **相关概念**: 原材料库存（RawMaterialInventory）、原材料（RawMaterial）
- **接口MCP工具**: 调用 `executeOntoBehavior` 执行行为，参数为 `QueryInventory` 及其输入参数。

### 3.5 QueryPurchaseRecords
- **类型**: 查询行为
- **行为描述**: 根据采购单/原材料/关联客单来查询采购记录列表。
- **输入参数**:
```json
{
  "purchaseRecordId": {"type": "string", "required": false, "description": "", "example": "PO-20231027-001", "display_name": "采购单号"},
  "rawMaterialId": {"type": "string", "required": false, "description": "", "example": "RM-001", "display_name": "原材料编号"},
  "rawMaterialName": {"type": "string", "required": false, "description": "", "example": "高强度钢板", "display_name": "原材料名称"}
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
        "purchaseRecordId": {"type": "string", "display_name": "采购单号", "example": "PO-20231027-001"},
        "rawMaterialId": {"type": "string", "display_name": "原材料编号", "example": "RM-001"},
        "rawMaterialName": {"type": "string", "display_name": "原材料名称", "example": "高强度钢板"},
        "purchaseTime": {"type": "string", "display_name": "采购时间", "example": "2023-10-27"},
        "arrivalTime": {"type": "string", "display_name": "到位时间", "example": "2023-11-10"},
        "arrivalQuantity": {"type": "number", "display_name": "到位数量", "example": 50},
        "unit": {"type": "string", "display_name": "单位", "example": "吨"},
        "supplierName": {"type": "string", "display_name": "供应商名称", "example": "XX钢铁集团"},
        "relatedOrderId": {"type": "string", "display_name": "关联订单编号", "example": "SO-20231025-001"},
        "relatedOrderName": {"type": "string", "display_name": "关联订单名称", "example": "客户A-项目X订单"},
        "leadTime": {"type": "number", "display_name": "等待周期", "example": 14}
      }
    }
  }
}
```
- **相关概念**: 原材料采购记录（PurchaseRecord）、原材料（RawMaterial）、客户订单（CustomerOrder）
- **接口MCP工具**: 调用 `executeOntoBehavior` 执行行为，参数为 `QueryPurchaseRecords` 及其输入参数。

### 3.6 QueryRawMaterials
- **类型**: 查询行为
- **行为描述**: 根据原材料ID或名称查询原材料的基础信息。
- **输入参数**:
```json
{
  "rawMaterialId": {"type": "string", "required": false, "description": "", "example": "RM-001", "display_name": "原材料编号"},
  "rawMaterialName": {"type": "string", "required": false, "description": "", "example": "高强度钢板", "display_name": "原材料名称"}
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
        "rawMaterialId": {"type": "string", "display_name": "原材料编号", "example": "RM-001"},
        "rawMaterialName": {"type": "string", "display_name": "原材料名称", "example": "高强度钢板"},
        "unit": {"type": "string", "display_name": "单位", "example": "吨"},
        "safetyStock": {"type": "number", "display_name": "安全库存", "example": 100}
      }
    }
  }
}
```
- **相关概念**: 原材料（RawMaterial）
- **接口MCP工具**: 调用 `executeOntoBehavior` 执行行为，参数为 `QueryRawMaterials` 及其输入参数。

### 3.7 QuerySuppliers
- **类型**: 查询行为
- **行为描述**: 根据供应商名或原材料名查询供应商。
- **输入参数**:
```json
{
  "supplierName": {"type": "string", "required": false, "description": "", "example": "宝钢钢铁集团", "display_name": "供应商名称，模糊匹配"},
  "rawMaterialName": {"type": "string", "required": false, "description": "", "example": "钢板008", "display_name": "原材料名称"}
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

### 3.8 QuerySupplierCapability
- **类型**: 查询行为
- **行为描述**: 根据供应商名或原材料名，查询供应商供货能力。
- **输入参数**:
```json
{
  "supplierName": {"type": "string", "required": false, "description": "", "example": "宝钢钢铁集团", "display_name": "供应商名称"},
  "rawMaterialName": {"type": "string", "required": false, "description": "", "example": "钢板008", "display_name": "原材料名称"}
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
        "supplierName": {"type": "string", "display_name": "供应商名称", "example": "宝钢钢铁集团"},
        "rawMaterialId": {"type": "string", "display_name": "原材料ID", "example": "RM-001"},
        "rawMaterialName": {"type": "string", "display_name": "原材料名称", "example": "高强度钢板"},
        "leadTime": {"type": "number", "display_name": "交货周期", "example": 100}
      }
    }
  }
}
```
- **相关概念**: 交货能力（DeliveryCapability）、供应商（Supplier）、原材料（RawMaterial）
- **接口MCP工具**: 调用 `executeOntoBehavior` 执行行为，参数为 `QuerySupplierCapability` 及其输入参数。

### 3.9 QuerySupplierCapabilitySQL
- **类型**: 查询行为
- **行为描述**: 根据供应商名或原材料名，查询供应能力。
- **输入参数**:
```json
{
  "supplierName": {"type": "string", "required": true, "description": "", "example": "宝钢钢铁集团", "display_name": "供应商名称"},
  "rawMaterialName": {"type": "string", "required": true, "description": "", "example": "钢板008", "display_name": "原材料名称"}
}
```
- **输出结构**:
```json
{
  "data": {
    "type": "array",
    "items": {
      "type": "object",
      "properties": {
        "supplierName": {"type": "string", "display_name": "供应商名称", "example": "宝钢钢铁集团"},
        "rawMaterialId": {"type": "string", "display_name": "原材料ID", "example": "RM-001"},
        "rawMaterialName": {"type": "string", "display_name": "原材料名称", "example": "高强度钢板"},
        "leadTime": {"type": "number", "display_name": "交货周期", "example": 100}
      }
    }
  }
}
```
- **相关概念**: 交货能力（DeliveryCapability）、供应商（Supplier）、原材料（RawMaterial）
- **接口MCP工具**: 调用 `executeOntoBehavior` 执行行为，参数为 `QuerySupplierCapabilitySQL` 及其输入参数。

## 4函数
【重点：函数的计算为实例化对象或对象集合，用于属性的计算和处理】

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
- **接口MCP工具**: 调用 `executeOntoFunction` 执行函数，参数为 `sumRawNotArrivalQty` 及其输入参数。

## 5规则
【重点：规则主要用于对执行行为的前置和后置进行把控，每次智能体执行行为的时候，若有规则则必须判断，以确保整个行为的执行是合法可控的。例如：在行为执行前对输入参数进行校验，或者在行为执行后对输出结果进行校验以及推理等】

### 5.1 V01_UnitConsistency_Purchase（采购-原料存在且单位一致）
- **规则类型**: 验证规则
- **规则描述**: 创建采购单时，提供的 rawMaterialId 必须与RawMaterial 概念中的rawMaterialId一致，并且unit页必须一致。
- **规则介入位置**: 前置
- **关联行为**: CreatePurchaseRecord
- **关联函数**: 无
- **规则结构**:
```json
{
  "if": {
    "logic": "and",
    "conditions": [
      {
        "left": {"type": "concept", "concept": "PurchaseRecord", "attribute": "rawMaterialId"},
        "operator": "eq",
        "right": {"type": "concept", "concept": "RawMaterial", "attribute": "rawMaterialId"}
      },
      {
        "left": {"type": "concept", "concept": "PurchaseRecord", "attribute": "unit"},
        "operator": "eq",
        "right": {"type": "concept", "concept": "RawMaterial", "attribute": "unit"}
      }
    ]
  }
}
```

### 5.2 V03_ArrivalTimeValidity（采购-到位时间合理性）
- **规则类型**: 验证规则
- **规则描述**: 创建采购单时，输入的 arrivalTime 必须晚于 purchaseTime。
- **规则介入位置**: 前置
- **关联行为**: CreatePurchaseRecord
- **关联函数**: 无
- **规则结构**:
```json
{
  "if": {
    "logic": "and",
    "conditions": [
      {
        "left": {"type": "concept", "concept": "PurchaseRecord", "attribute": "arrivalTime"},
        "operator": "gt",
        "right": {"type": "concept", "concept": "PurchaseRecord", "attribute": "purchaseTime"}
      }
    ]
  }
}
```

### 5.3 V05_SupplierExistence（采购-供应商名称一致）
- **规则类型**: 验证规则
- **规则描述**: 创建采购单时，提供的 supplierName 必须与 Supplier 概念中suplierName的一致。
- **规则介入位置**: 前置
- **关联行为**: CreatePurchaseRecord
- **关联函数**: 无
- **规则结构**:
```json
{
  "if": {
    "logic": "and",
    "conditions": [
      {
        "left": {"type": "concept", "concept": "PurchaseRecord", "attribute": "supplierName"},
        "operator": "in",
        "right": {"type": "concept", "concept": "Supplier", "attribute": "supplierName"}
      }
    ]
  }
}
```

### 5.4 I01_SafetyStockAlert（安全库存预警）
- **规则类型**: 推理规则
- **规则描述**: IF 可用库存availableStock < 原材料的safetyStock THEN 推送预警，建议创建采购单或关注库存。
- **规则介入位置**: 后置
- **关联行为**: QueryInventory
- **关联函数**: 无
- **规则结构**:
```json
{
  "if": {
    "logic": "and",
    "conditions": [
      {
        "left": {"type": "concept", "concept": "RawMaterialInventory", "attribute": "availableStock"},
        "operator": "lt",
        "right": {"type": "concept", "concept": "RawMaterial", "attribute": "safetyStock"}
      }
    ]
  },
  "then": "可用库存低于安全库存，建议创建采购单或关注库存",
  "else": "库存正常，无需操作"
}
```

### 5.5 I02_ArrivalOverdueAlert（采购到位超期预警）
- **规则类型**: 推理规则
- **规则描述**: IF 当前日期 >= 采购单arrivalTime THEN 提示用户是否启动入库操作。
- **规则介入位置**: 后置
- **关联行为**: QueryPurchaseRecords
- **关联函数**: 无
- **规则结构**:
```json
{
  "if": {
    "logic": "and",
    "conditions": [
      {
        "left": {"type": "function", "function": "getCurrentDate", "returnField": "date"},
        "operator": "ge",
        "right": {"type": "concept", "concept": "PurchaseRecord", "attribute": "arrivalTime"}
      }
    ]
  },
  "then": "采购单已到位，建议启动入库操作",
  "else": "采购单尚未到位，无需操作"
}
```

### 5.6 I03_PurchasePurposeInference（采购目的推理）
- **规则类型**: 推理规则
- **规则描述**: IF 采购单relatedOrderId 为空 THEN 该采购目的可视为“补充库存”。
- **规则介入位置**: 后置
- **关联行为**: CreatePurchaseRecord
- **关联函数**: 无
- **规则结构**:
```json
{
  "if": {
    "logic": "and",
    "conditions": [
      {
        "left": {"type": "concept", "concept": "PurchaseRecord", "attribute": "relatedOrderId"},
        "operator": "eq",
        "right": {"type": "value", "value": "\"\""}
      }
    ]
  },
  "then": "该采购单的采购目的可视为“补充库存”",
  "else": "该采购单有关联订单，采购目的可能为生产订单备料"
}
```

### 5.7 I04_RelatedOrderValidation（采购-关联订单存在性）
- **规则类型**: 推理规则
- **规则描述**: 创建采购单时，如果客户订单relatedOrderId不为空，则必须存在于客户订单中。
- **规则介入位置**: 前置
- **关联行为**: CreatePurchaseRecord
- **关联函数**: 无
- **规则结构**:
```json
{
  "if": {
    "logic": "and",
    "conditions": [
      {
        "left": {"type": "concept", "concept": "PurchaseRecord", "attribute": "relatedOrderId"},
        "operator": "ne",
        "right": {"type": "value", "value": "\"\""}
      },
      {
        "left": {"type": "concept", "concept": "PurchaseRecord", "attribute": "relatedOrderId"},
        "operator": "not in",
        "right": {"type": "set", "concept": "CustomerOrder", "attribute": "customerOrderId"}
      }
    ]
  },
  "then": "关联订单编号不存在于客户订单中，请中断后续推理，并检查",
  "else": "关联订单编号存在或未填写，校验通过"
}
```

## 6安全管控
【重点：安全管控的目的是对危险行为引入人工确认，介入位置可以在行为的执行前或执行后。介入时，智能体应该临时暂停后续操作，让用户对当前任务内容进行审核（具体内容请参考审核内容）】

### 6.1 CreatePurchaseRecord
- **介入位置**: 前置
- **审核内容**: 确认采购的必要性：请确认是否确实需要补货，关联的客户订单是否真实有效，采购数量和到位时间是否合理。

### 6.2 CancelPurchaseRecord
- **介入位置**: 前置
- **审核内容**: 确认取消的原因：确认取消采购单是否合理，是否已与供应商沟通，是否存在违约风险。

### 6.3 ReceiveRawMaterial
- **介入位置**: 前置
- **审核内容**: 确认入库的准确性：请确认到货的原材料、数量、供应商是否与采购单一致，质检是否已通过（如适用）。