---
name: 原材料库存和采购本体
description: 该技能提供了原材料、原材料库存以及原材料采购的相关信息，包括原材料基础信息、供应商信息、采购记录、库存快照、交货能力等核心概念及其关系。当用户的意图涉及原材料查询、原材料采购、库存管理、供应商选择以及采购到入库的完整流程时，请读取该文件进行进一步的业务理解和行为操作。本技能重点支持创建采购单、入库、查询库存与采购记录、查询供应商及供货能力等行为，并内置了单位一致性、到位时间合理性、安全库存预警、采购超期预警等验证与推理规则，确保业务操作的合法性与合理性。
---

# 原材料库存和采购本体技能

## 1 简介
本技能围绕生产调度中的原材料采购和库存管理，提供了从原材料基础信息、供应商管理、采购记录、库存快照到交货能力的完整业务视图。支持采购单创建、取消、入库、库存查询、采购记录查询、供应商及供货能力查询等核心操作，并内置了单位一致性、到位时间合理性、安全库存预警、采购超期预警等规则，确保业务操作的合法性与合理性。

【重点：特别注意，当智能体生成和执行任务时，请先从概念关系出发进行全局把控，然后再分析行为-规则-函数-安全等内容，以此推导出正确的执行逻辑】

## 2 概念与关系

### 2.1 概念
- **RawMaterial（原材料）**: 表示生产所需的基础物料，包含编号、名称、单位、安全库存等属性。
- **Supplier（供应商）**: 表示提供原材料的供应商，包含编号、名称、地址、联系人、联系电话等属性。
- **PurchaseRecord（原材料采购记录）**: 表示一次原材料采购行为，包含采购单号、原材料信息、采购时间、到位时间、数量、供应商、关联订单等属性。
- **RawMaterialInventory（原材料库存）**: 表示原材料的库存快照，包含库存编号、原材料信息、材料类型、待入库量、累计库存量、可用库存、单位等属性。
- **CustomerOrder（客户订单）**: 表示客户下达的生产订单，包含订单编号、名称、批次号、缓冲期、订单类型、状态等属性。
- **DeliveryCapability（交货能力）**: 表示供应商对特定原材料的供货能力，包含原材料信息、供应商信息、交货周期、最小起订量等属性。

### 2.2 关系
- **hasRawInventory**: RawMaterial -> RawMaterialInventory (1:1)，一种原材料对应一个库存记录。
- **recordsRawMaterial**: PurchaseRecord -> RawMaterial (N:1)，多条采购记录可关联同一种原材料。
- **orderedFromSupplier**: PurchaseRecord -> Supplier (N:1)，多条采购记录可关联同一个供应商。
- **suppliesRawMaterial**: Supplier -> RawMaterial (N:M)，一个供应商可供应多种原材料，一种原材料可由多个供应商供应。
- **containsPurchaseRecord**: CustomerOrder -> PurchaseRecord (1:N)，一个客户订单可包含多条采购记录。
- **hasCapability**: Supplier -> DeliveryCapability (1:N)，一个供应商可拥有多种原材料的交货能力。

### 2.3 概念属性
- **RawMaterial**: rawMaterialId (原材料编号), rawMaterialName (原材料名称), unit (单位), safetyStock (安全库存)
- **Supplier**: supplierId (供应商编号), supplierName (供应商名称), address (地址), contactPerson (联系人), contactPhone (联系电话)
- **PurchaseRecord**: purchaseRecordId (采购单号), rawMaterialId (原材料编号), rawMaterialName (原材料名称), purchaseTime (采购时间), arrivalTime (到位时间), arrivalQuantity (到位数量), unit (单位), leadTime (等待周期), supplierName (供应商名称), relatedOrderId (关联订单编号), relatedOrderName (关联订单名称)
- **RawMaterialInventory**: inventoryId (库存编号), rawMaterialId (原材料编号), rawMaterialName (原材料名称), materialType (材料类型), pendingReceiptQuantity (待入库量), cumulativeStockQuantity (累计库存量), availableStock (可用库存), unit (单位)
- **CustomerOrder**: customerOrderId (客户订单编号), customerOrderName (客户订单名称), batchNumber (批次号), bufferPeriod (缓冲期), orderType (订单类型), status (状态)
- **DeliveryCapability**: rawMaterialId (原材料编号), rawMaterialName (原材料名称), supplierName (供应商名称), supplierId (供应商编号), leadTime (交货周期), minCount (最小起订量)

【重点：特别注意，概念-属性-关系代表着该领域的最基本业务逻辑，智能体的任务生成和执行都必须从该网络出发展开】

## 3 重要业务流程

### 原材料采购到入库流程（ProcureAndReceiveRawMaterial）
1. **查询库存**：用户或系统查询原材料库存，判断是否需要采购。
2. **创建采购单**：根据库存情况或客户订单需求，创建原材料采购单。
3. **查询采购记录**：定期或主动按需查询采购记录，跟踪已创建的采购单状态。
4. **入库操作**：确认原材料到货，执行入库操作，更新库存。
5. **再次查询库存**：入库完成后，再次查询库存，确认库存状态已更新。

## 4 行为

### 4.1 CreatePurchaseRecord（创建原材料采购单）
- **描述**: 创建一笔新的原材料采购记录。
- **输入参数**:
  - rawMaterialId (string, 必填): 原材料编号，示例: "RM-001"
  - rawMaterialName (string, 必填): 原材料名称，示例: "高强度钢板"
  - arrivalQuantity (number, 必填): 到位数量，示例: 50
  - supplierName (string, 必填): 供应商名称，示例: "XX钢铁集团"
  - arrivalTime (string, 必填): 到位时间，示例: "2023-11-10"
  - relatedOrderId (string, 必填): 关联订单编号，示例: "SO-20231025-001"
  - relatedOrderName (string, 必填): 关联订单名称，示例: "客户A-项目X订单"
  - unit (string, 必填): 单位，示例: "吨"
- **输出结构**: 返回创建的采购记录对象，包含采购单号、原材料信息、采购时间、到位时间、数量、单位、供应商、关联订单、等待周期、状态等。
- **相关概念**: PurchaseRecord, RawMaterial, Supplier, CustomerOrder
- **调用接口**: 使用 `executeOntoBehavior` 工具，参数名为 `CreatePurchaseRecord`，参数值按上述输入参数组装。

### 4.2 CancelPurchaseRecord（取消原材料采购单）
- **描述**: 取消一笔已创建但尚未入库的采购记录。
- **输入参数**:
  - purchaseRecordId (string, 必填): 采购单号，示例: "PO-20231027-001"
- **输出结构**: 返回被取消的采购记录对象，包含采购单号、原材料ID、原材料名称。
- **相关概念**: PurchaseRecord
- **调用接口**: 使用 `executeOntoBehavior` 工具，参数名为 `CancelPurchaseRecord`，参数值按上述输入参数组装。

### 4.3 ReceiveRawMaterial（入库原材料）
- **描述**: 将原材料采购入库。
- **输入参数**:
  - purchaseRecordId (string, 必填): 采购单号，示例: "PO-20231027-001"
- **输出结构**: 返回入库后的采购记录对象，包含采购单号、原材料ID、原材料名称。
- **相关概念**: PurchaseRecord, RawMaterialInventory
- **调用接口**: 使用 `executeOntoBehavior` 工具，参数名为 `ReceiveRawMaterial`，参数值按上述输入参数组装。

### 4.4 QueryInventory（查询原材料库存信息）
- **描述**: 根据原材料ID或名称查询其最新的库存快照。
- **输入参数**:
  - rawMaterialId (string, 必填): 原材料编号，示例: "RM-001"
  - rawMaterialName (string, 必填): 原材料名称，示例: "高强度钢板"
- **输出结构**: 返回库存快照列表，包含库存编号、原材料信息、材料类型、待入库量、累计库存量、可用库存、单位等。
- **相关概念**: RawMaterialInventory, RawMaterial
- **调用接口**: 使用 `executeOntoBehavior` 工具，参数名为 `QueryInventory`，参数值按上述输入参数组装。

### 4.5 QueryPurchaseRecords（查询原材料采购单信息）
- **描述**: 根据采购单/原材料/关联客单来查询采购记录列表。
- **输入参数**:
  - purchaseRecordId (string, 必填): 采购单号，示例: "PO-20231027-001"
  - rawMaterialId (string, 必填): 原材料编号，示例: "RM-001"
  - rawMaterialName (string, 必填): 原材料名称，示例: "高强度钢板"
- **输出结构**: 返回采购记录列表，包含采购单号、原材料信息、采购时间、到位时间、数量、单位、供应商、关联订单、等待周期等。
- **相关概念**: PurchaseRecord, RawMaterial, Supplier, CustomerOrder
- **调用接口**: 使用 `executeOntoBehavior` 工具，参数名为 `QueryPurchaseRecords`，参数值按上述输入参数组装。

### 4.6 QueryRawMaterials（查询原材料基本信息）
- **描述**: 根据原材料ID或名称查询原材料的基础信息。
- **输入参数**:
  - rawMaterialId (string, 必填): 原材料编号，示例: "RM-001"
  - rawMaterialName (string, 必填): 原材料名称，示例: "高强度钢板"
- **输出结构**: 返回原材料基础信息列表，包含原材料编号、名称、单位、安全库存等。
- **相关概念**: RawMaterial
- **调用接口**: 使用 `executeOntoBehavior` 工具，参数名为 `QueryRawMaterials`，参数值按上述输入参数组装。

### 4.7 QuerySuppliers（查询供应商信息）
- **描述**: 根据供应商名或原材料名查询供应商。
- **输入参数**:
  - supplierName (string, 可选): 供应商名称，模糊匹配，示例: "宝钢钢铁集团"
  - rawMaterialName (string, 可选): 原材料名称，示例: "钢板008"
- **输出结构**: 返回供应商信息列表，包含供应商编号、名称、地址、联系人、联系电话等。
- **相关概念**: Supplier, RawMaterial
- **调用接口**: 使用 `executeOntoBehavior` 工具，参数名为 `QuerySuppliers`，参数值按上述输入参数组装。

### 4.8 QuerySupplierCapability（查询供应商供货能力）
- **描述**: 根据供应商名或原材料名，查询供应商供货能力。
- **输入参数**:
  - supplierName (string, 可选): 供应商名称，模糊匹配，示例: "宝钢钢铁集团"
  - rawMaterialName (string, 可选): 原材料名称，示例: "钢板008"
- **输出结构**: 返回供货能力列表，包含供应商名称、原材料ID、原材料名称、交货周期等。
- **相关概念**: DeliveryCapability, Supplier, RawMaterial
- **调用接口**: 使用 `executeOntoBehavior` 工具，参数名为 `QuerySupplierCapability`，参数值按上述输入参数组装。

【重点：行为推动任务的执行，每当智能体要行为执行时：
1）请判断该行为是否在行为集合里
2）若在则先提取与该行为动作相关的规则和函数，进行规则验证推理或调用相关函数进行计算
3）若在请判断该行为动作是否需要安全管控，即需要人工介入
4）规则和审核节点包括前置（行为执行前）和后置（行为执行后）两种类型。
以确保整个行为的执行是合法的】

## 5 函数

### 5.1 sumRawNotArrivalQty（原材料未到位数）
- **描述**: 根据传入的数据包指定的原材料，过滤掉到位时间小于当前时间的部分，对剩余部分的到位数arrivalQuantity求和。
- **输入参数**:
  - filterRawMaterialName (string, 必填): 原材料名称，示例: "高强度钢板"
  - currentDate (string, 必填): 日期，示例: "2026-01-01"
  - purchaseRecordSet (array, 必填): 采购记录集合，每个元素包含 arrivalTime (到位时间), rawMaterialName (原材料名称), arrivalQuantity (计划的到位数量)
- **返回结构**: 返回一个对象，包含 rawMaterialName (原材料名称) 和 sumNotArrivalQty (未到位总量)。
- **关联概念**: PurchaseRecord
- **调用接口**: 使用 `executeOntoFunction` 工具，参数名为 `sumRawNotArrivalQty`，参数值按上述输入参数组装。

## 6 规则

### 6.1 V01_UnitConsistency_Purchase（采购-原料单位一致性）
- **类型**: 验证规则
- **介入位置**: 前置（行为执行前）
- **描述**: 创建采购单时，输入的 unit 必须与关联原材料的 unit 一致。
- **关联行为**: CreatePurchaseRecord
- **关联函数**: 无
- **规则设计**: {"left": {"type": "concept", "concept": "PurchaseRecord", "attribute": "unit"}, "operator": "eq", "right": {"type": "concept", "concept": "RawMaterial", "attribute": "unit"}}

### 6.2 V03_ArrivalTimeValidity（到位时间合理性）
- **类型**: 验证规则
- **介入位置**: 前置（行为执行前）
- **描述**: 创建采购单时，输入的 arrivalTime 必须晚于 purchaseTime。
- **关联行为**: CreatePurchaseRecord
- **关联函数**: 无
- **规则设计**: {"left": {"type": "concept", "concept": "PurchaseRecord", "attribute": "arrivalTime"}, "operator": "gt", "right": {"type": "concept", "concept": "PurchaseRecord", "attribute": "purchaseTime"}}

### 6.3 V04_RawMaterialExistence（采购-原料存在性）
- **类型**: 验证规则
- **介入位置**: 前置（行为执行前）
- **描述**: 创建采购单时，提供的 rawMaterialId 必须与RawMaterial 概念中的rawMaterialId一致。
- **关联行为**: CreatePurchaseRecord
- **关联函数**: 无
- **规则设计**: {"left": {"type": "concept", "concept": "PurchaseRecord", "attribute": "rawMaterialId"}, "operator": "in", "right": {"type": "set", "concept": "RawMaterial", "attribute": "rawMaterialId"}}

### 6.4 V05_SupplierExistence（采购-供应商存在性）
- **类型**: 验证规则
- **介入位置**: 前置（行为执行前）
- **描述**: 创建采购单时，提供的 supplierName 必须与 Supplier 概念中suplierName的一致。
- **关联行为**: CreatePurchaseRecord
- **关联函数**: 无
- **规则设计**: {"left": {"type": "concept", "concept": "PurchaseRecord", "attribute": "supplierName"}, "operator": "in", "right": {"type": "set", "concept": "Supplier", "attribute": "supplierName", "value": "", "function": "", "returnField": ""}}

### 6.5 I01_SafetyStockAlert（安全库存预警）
- **类型**: 推理规则
- **介入位置**: 后置（行为执行后）
- **描述**: IF 可用库存availableStock < 原材料的safetyStock THEN 推送预警，建议创建采购单或关注库存。
- **关联行为**: QueryInventory, ReceiveRawMaterial
- **关联函数**: 无
- **规则设计**: {"if": {"logic": "and", "conditions": [{"left": {"type": "concept", "concept": "RawMaterialInventory", "attribute": "availableStock"}, "operator": "lt", "right": {"type": "concept", "concept": "RawMaterial", "attribute": "safetyStock"}}]}, "then": "可用库存低于安全库存，建议创建采购单或关注库存", "else": "库存正常，无需操作"}

### 6.6 I02_ArrivalOverdueAlert（采购到位超期预警）
- **类型**: 推理规则
- **介入位置**: 后置（行为执行后）
- **描述**: IF 当前日期 >= 采购单arrivalTime THEN 提示用户是否启动入库操作。
- **关联行为**: QueryPurchaseRecords
- **关联函数**: 无
- **规则设计**: {"if": {"logic": "and", "conditions": [{"left": {"type": "function", "function": "getCurrentDate", "returnField": "date"}, "operator": "ge", "right": {"type": "concept", "concept": "PurchaseRecord", "attribute": "arrivalTime"}}]}, "then": "采购单已到位，建议启动入库操作", "else": "采购单尚未到位，无需操作"}

### 6.7 I03_PurchasePurposeInference（采购目的推理）
- **类型**: 推理规则
- **介入位置**: 后置（行为执行后）
- **描述**: IF 采购单relatedOrderId 为空 THEN 该采购目的可视为“补充库存”。
- **关联行为**: CreatePurchaseRecord
- **关联函数**: 无
- **规则设计**: {"if": {"logic": "and", "conditions": [{"left": {"type": "concept", "concept": "PurchaseRecord", "attribute": "relatedOrderId"}, "operator": "eq", "right": {"type": "value", "value": "\"\""}}]}, "then": "该采购单的采购目的可视为“补充库存”", "else": "该采购单有关联订单，采购目的可能为生产订单备料"}

### 6.8 I04_RelatedOrderValidation（采购关联订单校验）
- **类型**: 推理规则
- **介入位置**: 后置（行为执行后）
- **描述**: IF 采购单relatedOrderId不为空且不在 CustomerOrder 表中 (或状态为 已取消) THEN 提示用户该客户订单可能已失效，请确认是否取消该采购单。
- **关联行为**: CreatePurchaseRecord
- **关联函数**: 无
- **规则设计**: {"if": {"logic": "and", "conditions": [{"left": {"type": "concept", "concept": "PurchaseRecord", "attribute": "relatedOrderId"}, "operator": "ne", "right": {"type": "value", "value": "\"\""}}, {"left": {"type": "concept", "concept": "PurchaseRecord", "attribute": "relatedOrderId"}, "operator": "not in", "right": {"type": "set", "concept": "CustomerOrder", "attribute": "customerOrderId"}}]}, "then": "该采购单关联的客户订单可能已失效，请确认是否取消该采购单。", "else": "采购单关联的客户订单有效，无需操作。"}

【重点：规则主要用于对执行行为的前置和后置进行把控，每次智能体执行行为的时候，若有规则则必须判断，以确保整个行为的执行是合法可控的。例如：在行为执行前对输入参数进行校验，或者在行为执行后对输出结果进行校验以及推理等】

## 7 安全管控

### 7.1 CreatePurchaseRecord（创建原材料采购单）
- **介入位置**: 前置（行为执行前）
- **审核内容**: 审核采购的必要性：检查库存是否确实需要补货，关联的客户订单是否真实有效，采购数量和到位时间是否合理。

### 7.2 CancelPurchaseRecord（取消原材料采购单）
- **介入位置**: 前置（行为执行前）
- **审核内容**: 审核取消的原因：确认取消采购单是否合理，是否已与供应商沟通，是否存在违约风险。

### 7.3 ReceiveRawMaterial（入库原材料）
- **介入位置**: 前置（行为执行前）
- **审核内容**: 审核入库的准确性：确认到货的原材料、数量、供应商是否与采购单一致，质检是否已通过（如适用）。

【重点：安全管控的目的是对危险行为引入人工确认，审核节点表示是行为执行前还是执行后，此时应该临时中断操作，让用户对相关内容进行审核（具体内容请参考审核内容）】