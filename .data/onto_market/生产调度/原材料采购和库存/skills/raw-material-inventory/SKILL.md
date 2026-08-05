---
name: raw-material-inventory
description: 原材料库存和采购本体技能，用于生产调度场景下的原材料采购、库存查询、供应商管理等操作。
---

# 原材料库存和采购本体技能

## 0 本体基本信息
本体名称（ontology_name）: 原材料库存和采购本体
本体id（ontology_id）: 1
场景名称（scenario_name）: 生产调度
场景id（scenario_id）: 1

## 1概念与关系
【重点：特别注意，概念-属性-关系代表着该领域的最基本业务逻辑，智能体的任务生成和执行都必须从该网络出发展开】

### 概念基本信息
| 概念英文名 | 概念中文名 | 属性（英文名/中文名） |
|-----------|-----------|---------------------|
| RawMaterial | 原材料 | rawMaterialId/原材料编号, rawMaterialName/原材料名称, unit/单位, safetyStock/安全库存 |
| Supplier | 供应商 | supplierId/供应商编号, supplierName/供应商名称, address/地址, contactPerson/联系人, contactPhone/联系电话 |
| PurchaseRecord | 原材料采购记录 | purchaseRecordId/采购单号, rawMaterialId/原材料编号, rawMaterialName/原材料名称, purchaseTime/采购时间, arrivalTime/到位时间, arrivalQuantity/到位数量, unit/单位, leadTime/等待周期, supplierName/供应商名称, relatedOrderId/关联订单编号, relatedOrderName/关联订单名称 |
| RawMaterialInventory | 原材料库存 | inventoryId/库存编号, rawMaterialId/原材料编号, rawMaterialName/原材料名称, materialType/材料类型, pendingReceiptQuantity/待入库量, cumulativeStockQuantity/累计库存量, availableStock/可用库存, unit/单位 |
| CustomerOrder | 客户订单 | customerOrderId/客户订单编号, customerOrderName/客户订单名称, batchNumber/批次号, bufferPeriod/缓冲期, orderType/订单类型, status/状态 |
| DeliveryCapability | 交货能力 | rawMaterialId/原材料编号, rawMaterialName/原材料名称, supplierName/供应商名称, supplierId/供应商编号, leadTime/交货周期, minCount/最小起订量 |

### 概念关系基本信息
| 关系英文名 | 关系中文名 | 关系描述 |
|-----------|-----------|---------|
| hasRawInventory | 拥有原材料库存 | RawMaterial -> RawMaterialInventory (1:1)，一种原材料对应一条库存记录 |
| recordsRawMaterial | 记录原材料 | PurchaseRecord -> RawMaterial (N:1)，多条采购记录可对应同一种原材料 |
| orderedFromSupplier | 向供应商采购 | PurchaseRecord -> Supplier (N:1)，多条采购记录可对应同一供应商 |
| suppliesRawMaterial | 供应原材料 | Supplier -> RawMaterial (N:M)，供应商与原材料之间是多对多关系 |
| containsPurchaseRecord | 包含采购记录 | CustomerOrder -> PurchaseRecord (1:N)，一个客户订单可包含多条采购记录 |
| hasCapability | 具有供货能力 | Supplier -> DeliveryCapability (1:N)，一个供应商可具备多种原材料的供货能力 |

整个关系体系的逻辑：原材料（RawMaterial）通过`hasRawInventory`关联到库存（RawMaterialInventory），通过`suppliesRawMaterial`关联到供应商（Supplier）；采购记录（PurchaseRecord）通过`recordsRawMaterial`关联到原材料，通过`orderedFromSupplier`关联到供应商，通过`containsPurchaseRecord`关联到客户订单（CustomerOrder）；供应商（Supplier）通过`hasCapability`关联到交货能力（DeliveryCapability）。

### 概念属性基本信息
| 属性英文名 | 属性中文名 | 所属概念 | 类型 |
|-----------|-----------|---------|------|
| rawMaterialId | 原材料编号 | RawMaterial, PurchaseRecord, RawMaterialInventory, DeliveryCapability | string |
| rawMaterialName | 原材料名称 | RawMaterial, PurchaseRecord, RawMaterialInventory, DeliveryCapability | string |
| unit | 单位 | RawMaterial, PurchaseRecord, RawMaterialInventory | string |
| safetyStock | 安全库存 | RawMaterial | number |
| supplierId | 供应商编号 | Supplier, DeliveryCapability | string |
| supplierName | 供应商名称 | Supplier, PurchaseRecord, DeliveryCapability | string |
| address | 地址 | Supplier | string |
| contactPerson | 联系人 | Supplier | string |
| contactPhone | 联系电话 | Supplier | string |
| purchaseRecordId | 采购单号 | PurchaseRecord | string |
| purchaseTime | 采购时间 | PurchaseRecord | string |
| arrivalTime | 到位时间 | PurchaseRecord | string |
| arrivalQuantity | 到位数量 | PurchaseRecord | number |
| leadTime | 等待周期/交货周期 | PurchaseRecord, DeliveryCapability | number |
| relatedOrderId | 关联订单编号 | PurchaseRecord | string |
| relatedOrderName | 关联订单名称 | PurchaseRecord | string |
| inventoryId | 库存编号 | RawMaterialInventory | string |
| materialType | 材料类型 | RawMaterialInventory | enum |
| pendingReceiptQuantity | 待入库量 | RawMaterialInventory | number |
| cumulativeStockQuantity | 累计库存量 | RawMaterialInventory | number |
| availableStock | 可用库存 | RawMaterialInventory | number |
| customerOrderId | 客户订单编号 | CustomerOrder | string |
| customerOrderName | 客户订单名称 | CustomerOrder | string |
| batchNumber | 批次号 | CustomerOrder | string |
| bufferPeriod | 缓冲期 | CustomerOrder | number |
| orderType | 订单类型 | CustomerOrder | enum |
| status | 状态 | CustomerOrder | enum |
| minCount | 最小起订量 | DeliveryCapability | number |

## 2重要业务流程
【重点：重点业务流程，用于任务执行逻辑的参考，注意这里不是该流程是唯一固定的】

原材料采购到入库（ProcureAndReceiveRawMaterial）是核心业务流程，具体步骤如下：
1. **查询库存**：用户或系统查询原材料库存，判断是否需要采购。
2. **创建采购单**：根据库存情况或客户订单需求，创建原材料采购单。
3. **查询采购记录**：定期或主动按需查询采购记录，跟踪已创建的采购单状态。
4. **入库原材料**：确认原材料到货，执行入库操作，更新库存。
5. **再次查询库存**：入库完成后，再次查询库存，确认库存状态已更新。

## 3行为

### 3.1 CreatePurchaseRecord
- **类型**: 操作行为
- **行为描述**: 创建一笔新的原材料采购记录。
- **输入参数**:
```json
{
  "rawMaterialId": {"type": "string", "required": true, "description": "原材料编号", "example": "RM-001"},
  "rawMaterialName": {"type": "string", "required": true, "description": "原材料名称", "example": "高强度钢板"},
  "arrivalQuantity": {"type": "number", "required": true, "description": "到位数量", "example": 50},
  "supplierName": {"type": "string", "required": true, "description": "供应商名称", "example": "XX钢铁集团"},
  "arrivalTime": {"type": "string", "required": true, "description": "到位时间", "example": "2023-11-10"},
  "relatedOrderId": {"type": "string", "required": false, "description": "关联订单编号", "example": "SO-20231025-001"},
  "relatedOrderName": {"type": "string", "required": false, "description": "关联订单名称", "example": "客户A-项目X订单"},
  "unit": {"type": "string", "required": true, "description": "单位", "example": "吨"}
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
  "purchaseRecordId": {"type": "string", "required": true, "display_name": "采购单号", "example": "PO-20231027-001"}
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
  "purchaseRecordId": {"type": "string", "required": true, "display_name": "采购单号", "example": "PO-20231027-001"}
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
  "rawMaterialId": {"type": "string", "required": false, "description": "原材料编号", "example": "RM-001"},
  "rawMaterialName": {"type": "string", "required": false, "description": "原材料名称", "example": "高强度钢板"}
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
  "purchaseRecordId": {"type": "string", "required": false, "example": "PO-20231027-001", "display_name": "采购单号"},
  "rawMaterialId": {"type": "string", "required": false, "example": "RM-001", "display_name": "原材料编号"},
  "rawMaterialName": {"type": "string", "required": false, "example": "高强度钢板", "display_name": "原材料名称"}
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
- **相关概念**: 原材料采购记录（PurchaseRecord）、原材料（RawMaterial）、供应商（Supplier）
- **接口MCP工具**: 调用 `executeOntoBehavior` 执行行为，参数为 `QueryPurchaseRecords` 及其输入参数。

### 3.6 QueryRawMaterials
- **类型**: 查询行为
- **行为描述**: 根据原材料ID或名称查询原材料的基础信息。
- **输入参数**:
```json
{
  "rawMaterialId": {"type": "string", "required": false, "example": "RM-001", "display_name": "原材料编号"},
  "rawMaterialName": {"type": "string", "required": false, "example": "高强度钢板", "display_name": "原材料名称"}
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

### 3.8 QuerySupplierCapability
- **类型**: 查询行为
- **行为描述**: 根据供应商名或原材料名，查询供应商供货能力。
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
        "supplierName": {"type": "string", "display_name": "供应商名称", "example": "宝钢钢铁集团"},
        "rawMaterialId": {"type": "string", "display_name": "原材料ID", "example": "RM-001"},
        "rawMaterialName": {"type": "string", "display_name": "原材料名称", "example": "高强度钢板"},
        "leadTime": {"type": "number", "display_name": "交货周期", "example": 100}
      }
    }
  }
}
```
- **相关概念**: 供应商（Supplier）、交货能力（DeliveryCapability）、原材料（RawMaterial）
- **接口MCP工具**: 调用 `executeOntoBehavior` 执行行为，参数为 `QuerySupplierCapability` 及其输入参数。

### 3.9 QuerySupplierCapabilitySQL
- **类型**: 查询行为
- **行为描述**: 根据供应商名或原材料名，查询供应能力。
- **输入参数**:
```json
{
  "supplierName": {"type": "string", "required": true, "description": "供应商名称", "example": "宝钢钢铁集团"},
  "rawMaterialName": {"type": "string", "required": true, "description": "原材料名称", "example": "钢板008"}
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
- **相关概念**: 供应商（Supplier）、交货能力（DeliveryCapability）、原材料（RawMaterial）
- **接口MCP工具**: 调用 `executeOntoBehavior` 执行行为，参数为 `QuerySupplierCapabilitySQL` 及其输入参数。

## 4函数
【重点：函数的计算为实例化对象或对象集合，用于属性的计算和处理】

### 4.1 sumRawNotArrivalQty
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

### 5.1 V01_UnitConsistency_Purchase
- **规则类型**: 验证规则
- **规则描述**: 创建采购单时，提供的 rawMaterialId 必须与RawMaterial 概念中的rawMaterialId一致，并且unit也必须一致。
- **规则介入位置**: 前置
- **关联行为**: CreatePurchaseRecord（创建原材料采购单）
- **关联函数**: 无
- **规则结构**:
```json
{"if": {"logic": "and", "conditions": [{"left": {"type": "concept", "concept": "PurchaseRecord", "attribute": "rawMaterialId"}, "operator": "in", "right": {"type": "set", "concept": "RawMaterial", "attribute": "rawMaterialId"}}, {"left": {"type": "concept", "concept": "PurchaseRecord", "attribute": "unit"}, "operator": "eq", "right": {"type": "concept", "concept": "RawMaterial", "attribute": "unit"}}]}}
```

### 5.2 V03_ArrivalTimeValidity
- **规则类型**: 验证规则
- **规则描述**: 创建采购单时，输入的 arrivalTime 必须晚于 purchaseTime。
- **规则介入位置**: 前置
- **关联行为**: CreatePurchaseRecord（创建原材料采购单）
- **关联函数**: 无
- **规则结构**:
```json
{"if": {"logic": "and", "conditions": [{"left": {"type": "concept", "concept": "PurchaseRecord", "attribute": "arrivalTime"}, "operator": "gt", "right": {"type": "concept", "concept": "PurchaseRecord", "attribute": "purchaseTime"}}]}}
```

### 5.3 V05_SupplierExistence
- **规则类型**: 验证规则
- **规则描述**: 创建采购单时，提供的 supplierName 必须与 Supplier 概念中supplierName的一致。
- **规则介入位置**: 前置
- **关联行为**: CreatePurchaseRecord（创建原材料采购单）
- **关联函数**: 无
- **规则结构**:
```json
{"if": {"logic": "and", "conditions": [{"left": {"type": "concept", "concept": "PurchaseRecord", "attribute": "supplierName"}, "operator": "in", "right": {"type": "set", "concept": "Supplier", "attribute": "supplierName"}}]}}
```

### 5.4 I01_SafetyStockAlert
- **规则类型**: 推理规则
- **规则描述**: IF 可用库存availableStock < 原材料的safetyStock THEN 推送预警，建议创建采购单或关注库存。
- **规则介入位置**: 后置
- **关联行为**: QueryInventory（查询原材料库存信息）
- **关联函数**: 无
- **规则结构**:
```json
{"if": {"logic": "and", "conditions": [{"left": {"type": "concept", "concept": "RawMaterialInventory", "attribute": "availableStock"}, "operator": "lt", "right": {"type": "concept", "concept": "RawMaterial", "attribute": "safetyStock"}}]}, "then": "可用库存低于安全库存，建议创建采购单或关注库存", "else": "库存正常，无需操作"}
```

### 5.5 I02_ArrivalOverdueAlert
- **规则类型**: 推理规则
- **规则描述**: IF 当前日期 >= 采购单arrivalTime THEN 提示用户是否启动入库操作。
- **规则介入位置**: 后置
- **关联行为**: QueryPurchaseRecords（查询原材料采购单信息）
- **关联函数**: getCurrentDate（获取当前日期）
- **规则结构**:
```json
{"if": {"logic": "and", "conditions": [{"left": {"type": "function", "function": "getCurrentDate", "returnField": "date"}, "operator": "ge", "right": {"type": "concept", "concept": "PurchaseRecord", "attribute": "arrivalTime"}}]}, "then": "采购单已到位，建议启动入库操作", "else": "采购单尚未到位，无需操作"}
```

### 5.6 I03_PurchasePurposeInference
- **规则类型**: 推理规则
- **规则描述**: IF 采购单relatedOrderId 为空 THEN 该采购目的可视为"补充库存"。
- **规则介入位置**: 后置
- **关联行为**: CreatePurchaseRecord（创建原材料采购单）
- **关联函数**: 无
- **规则结构**:
```json
{"if": {"logic": "and", "conditions": [{"left": {"type": "concept", "concept": "PurchaseRecord", "attribute": "relatedOrderId"}, "operator": "eq", "right": {"type": "value", "value": "\"\""}}]}, "then": "该采购单的采购目的可视为“补充库存”", "else": "该采购单有关联订单，采购目的可能为生产订单备料"}
```

### 5.7 I04_RelatedOrderValidation
- **规则类型**: 推理规则
- **规则描述**: 创建采购单时，如果客户订单relatedOrderId不为空，则必须存在于客户订单中。
- **规则介入位置**: 前置
- **关联行为**: CreatePurchaseRecord（创建原材料采购单）
- **关联函数**: 无
- **规则结构**:
```json
{"if": {"logic": "and", "conditions": [{"left": {"type": "concept", "concept": "PurchaseRecord", "attribute": "relatedOrderId"}, "operator": "ne", "right": {"type": "value", "value": "\"\""}}, {"left": {"type": "concept", "concept": "PurchaseRecord", "attribute": "relatedOrderId"}, "operator": "not in", "right": {"type": "set", "concept": "CustomerOrder", "attribute": "customerOrderId"}}]}, "then": "关联订单编号不存在于客户订单中，请中断后续推理，并检查", "else": "关联订单编号存在或未填写，校验通过"}
```

## 6安全管控
【重点：安全管控的目的是对危险行为引入人工确认，介入位置可以在行为的执行前或执行后。介入时，智能体应该临时暂停后续操作，让用户对当前任务内容进行审核（具体内容请参考审核内容）】

### 6.1 CreatePurchaseRecord
- **介入位置**: 前置
- **审核内容**: 审核采购的必要性：检查库存是否确实需要补货，关联的客户订单是否真实有效，采购数量和到位时间是否合理。

### 6.2 CancelPurchaseRecord
- **介入位置**: 前置
- **审核内容**: 审核取消的原因：确认取消采购单是否合理，是否已与供应商沟通，是否存在违约风险。

### 6.3 ReceiveRawMaterial
- **介入位置**: 前置
- **审核内容**: 审核入库的准确性：确认到货的原材料、数量、供应商是否与采购单一致，质检是否已通过（如适用）。