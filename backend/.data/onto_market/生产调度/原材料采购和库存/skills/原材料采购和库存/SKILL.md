---
name: 原材料库存和采购本体
description: 该技能提供了原材料、原材料库存以及原材料采购的相关信息。核心业务逻辑围绕原材料的采购、入库、库存管理展开，涉及供应商、客户订单等关联实体。当用户的意图涉及原材料查询、原材料采购、库存盘点、供应商能力评估以及相关预警时，请读取该文件进行进一步的业务理解和行为操作。技能包含从库存查询、创建采购单、跟踪采购状态到最终入库的完整流程，并内置了单位一致性、时间合理性、安全库存预警等关键规则。
---

# 原材料库存和采购本体技能

## 1简介
该技能旨在管理生产调度中的原材料采购与库存环节，涵盖原材料信息、供应商管理、采购记录追踪、库存状态查询以及基于规则的预警与推理。

【重点：特别注意，当智能体生成和执行任务时，请先从概念关系出发进行全局把控，然后再分析行为-规则-函数-安全等内容，以此推导出正确的执行逻辑】

## 2概念与关系
【重点：特别注意，概念-属性-关系代表着该领域的最基本业务逻辑，智能体的任务生成和执行都必须从该网络出发展开】

- **概念**：
    - `RawMaterial` (原材料): 核心实体，定义了原材料的唯一标识、名称、计量单位及安全库存。
    - `Supplier` (供应商): 提供原材料的供应商信息，包括联系方式。
    - `PurchaseRecord` (原材料采购记录): 记录每一次采购行为，关联到具体的原材料、供应商和客户订单。
    - `RawMaterialInventory` (原材料库存): 反映每种原材料的实时库存快照，包括待入库量、累计库存和可用库存。
    - `CustomerOrder` (客户订单): 下游需求来源，采购单可能与之关联。
    - `DeliveryCapability` (交货能力): 描述供应商针对特定原材料的供货能力，如交货周期和最小起订量。

- **关系**：
    - `hasRawInventory`: `RawMaterial` 与 `RawMaterialInventory` 是 **1:1** 关系，即一种原材料对应一个库存记录。
    - `recordsRawMaterial`: `PurchaseRecord` 与 `RawMaterial` 是 **N:1** 关系，多条采购记录可以针对同一种原材料。
    - `orderedFromSupplier`: `PurchaseRecord` 与 `Supplier` 是 **N:1** 关系，多条采购记录可以来自同一个供应商。
    - `suppliesRawMaterial`: `Supplier` 与 `RawMaterial` 是 **N:M** 关系，一个供应商可以提供多种原材料，一种原材料也可由多个供应商提供。
    - `containsPurchaseRecord`: `CustomerOrder` 与 `PurchaseRecord` 是 **1:N** 关系，一个客户订单可能包含多条采购记录。
    - `hasCapability`: `Supplier` 与 `DeliveryCapability` 是 **1:N** 关系，一个供应商可能具备多种原材料的供货能力。

- **概念属性**：
    - `RawMaterial`: `rawMaterialId` (原材料编号), `rawMaterialName` (原材料名称), `unit` (单位), `safetyStock` (安全库存)
    - `Supplier`: `supplierId` (供应商编号), `supplierName` (供应商名称), `address` (地址), `contactPerson` (联系人), `contactPhone` (联系电话)
    - `PurchaseRecord`: `purchaseRecordId` (采购单号), `rawMaterialId` (原材料编号), `rawMaterialName` (原材料名称), `purchaseTime` (采购时间), `arrivalTime` (到位时间), `arrivalQuantity` (到位数量), `unit` (单位), `leadTime` (等待周期), `supplierName` (供应商名称), `relatedOrderId` (关联订单编号), `relatedOrderName` (关联订单名称)
    - `RawMaterialInventory`: `inventoryId` (库存编号), `rawMaterialId` (原材料编号), `rawMaterialName` (原材料名称), `materialType` (材料类型), `pendingReceiptQuantity` (待入库量), `cumulativeStockQuantity` (累计库存量), `availableStock` (可用库存), `unit` (单位)
    - `CustomerOrder`: `customerOrderId` (客户订单编号), `customerOrderName` (客户订单名称), `batchNumber` (批号), `bufferPeriod` (缓冲期), `orderType` (订单类型), `status` (状态)
    - `DeliveryCapability`: `rawMaterialId` (原材料编号), `rawMaterialName` (原材料名称), `supplierName` (供应商名称), `supplierId` (供应商编号), `leadTime` (交货周期), `minCount` (最小起订量)

## 3重要业务流程
【重点：重点业务流程，用于任务执行逻辑的参考，注意这里不是该流程是唯一固定的】

- **原材料采购到入库流程 (`ProcureAndReceiveRawMaterial`)**:
    1.  **查询库存**: 用户或系统查询原材料库存，判断是否需要采购。
    2.  **创建采购单**: 根据库存情况或客户订单需求，创建原材料采购单。
    3.  **查询采购记录**: 定期或主动按需查询采购记录，跟踪已创建的采购单状态。
    4.  **执行入库**: 确认原材料到货，执行入库操作，更新库存。
    5.  **再次查询库存**: 入库完成后，再次查询库存，确认库存状态已更新。

## 4行为
【重点：行为推动任务的执行，每当智能体要行为执行时：
1）请判断该行为是否在行为集合里
2）若在则先提取与该行为动作相关的规则和函数，进行规则验证推理或调用相关函数进行计算
3）若在请判断该行为动作是否需要安全管控，即需要人工介入
4）规则和审核节点包括前置（行为执行前）和后置（行为执行后）两种类型。
以确保整个行为的执行是合法的】

- **`CreatePurchaseRecord` (创建原材料采购单)**
    - **描述**: 创建一笔新的原材料采购记录。
    - **输入参数**: `rawMaterialId` (string, 必填), `rawMaterialName` (string, 必填), `arrivalQuantity` (number, 必填), `supplierName` (string, 必填), `arrivalTime` (string, 必填), `relatedOrderId` (string, 必填), `relatedOrderName` (string, 必填), `unit` (string, 必填)
    - **输出结构**: `code` (number), `data` (object: `purchaseRecordId`, `rawMaterialId`, `rawMaterialName`, `purchaseTime`, `arrivalTime`, `arrivalQuantity`, `unit`, `supplierName`, `relatedOrderId`, `relatedOrderName`, `leadTime`, `status`)
    - **相关概念**: `PurchaseRecord`, `RawMaterial`, `Supplier`, `CustomerOrder`
    - **接口MCP工具**: `executeOntoBehavior` (行为名称: `CreatePurchaseRecord`)

- **`CancelPurchaseRecord` (取消原材料采购单)**
    - **描述**: 取消一笔已创建但尚未入库的采购记录。
    - **输入参数**: `purchaseRecordId` (string, 必填)
    - **输出结构**: `code` (number), `data` (object: `purchaseRecordId`, `rawMaterialId`, `rawMaterialName`)
    - **相关概念**: `PurchaseRecord`
    - **接口MCP工具**: `executeOntoBehavior` (行为名称: `CancelPurchaseRecord`)

- **`ReceiveRawMaterial` (入库原材料)**
    - **描述**: 将原材料采购入库。
    - **输入参数**: `purchaseRecordId` (string, 必填)
    - **输出结构**: `code` (number), `data` (object: `purchaseRecordId`, `rawMaterialId`, `rawMaterialName`)
    - **相关概念**: `PurchaseRecord`, `RawMaterialInventory`
    - **接口MCP工具**: `executeOntoBehavior` (行为名称: `ReceiveRawMaterial`)

- **`QueryInventory` (查询原材料库存信息)**
    - **描述**: 根据原材料ID或名称查询其最新的库存快照。
    - **输入参数**: `rawMaterialId` (string, 必填), `rawMaterialName` (string, 必填)
    - **输出结构**: `code` (number), `data` (array of object: `inventoryId`, `rawMaterialId`, `rawMaterialName`, `materialType`, `pendingReceiptQuantity`, `cumulativeStockQuantity`, `availableStock`, `unit`)
    - **相关概念**: `RawMaterialInventory`
    - **接口MCP工具**: `executeOntoBehavior` (行为名称: `QueryInventory`)

- **`QueryPurchaseRecords` (查询原材料采购单信息)**
    - **描述**: 根据采购单/原材料/关联客单来查询采购记录列表。
    - **输入参数**: `purchaseRecordId` (string, 必填), `rawMaterialId` (string, 必填), `rawMaterialName` (string, 必填)
    - **输出结构**: `code` (number), `data` (array of object: `purchaseRecordId`, `rawMaterialId`, `rawMaterialName`, `purchaseTime`, `arrivalTime`, `arrivalQuantity`, `unit`, `supplierName`, `relatedOrderId`, `relatedOrderName`, `leadTime`)
    - **相关概念**: `PurchaseRecord`
    - **接口MCP工具**: `executeOntoBehavior` (行为名称: `QueryPurchaseRecords`)

- **`QueryRawMaterials` (查询原材料基本信息)**
    - **描述**: 根据原材料ID或名称查询原材料的基础信息。
    - **输入参数**: `rawMaterialId` (string, 必填), `rawMaterialName` (string, 必填)
    - **输出结构**: `code` (number), `data` (array of object: `rawMaterialId`, `rawMaterialName`, `unit`, `safetyStock`)
    - **相关概念**: `RawMaterial`
    - **接口MCP工具**: `executeOntoBehavior` (行为名称: `QueryRawMaterials`)

- **`QuerySuppliers` (查询供应商信息)**
    - **描述**: 根据供应商名或原材料名查询供应商。
    - **输入参数**: `supplierName` (string, 可选), `rawMaterialName` (string, 可选)
    - **输出结构**: `code` (number), `data` (array of object: `supplierId`, `supplierName`, `address`, `contactPerson`, `contactPhone`)
    - **相关概念**: `Supplier`
    - **接口MCP工具**: `executeOntoBehavior` (行为名称: `QuerySuppliers`)

- **`QuerySupplierCapability` (查询供应商供货能力)**
    - **描述**: 根据供应商名或原材料名，查询供应商供货能力。
    - **输入参数**: `supplierName` (string, 可选), `rawMaterialName` (string, 可选)
    - **输出结构**: `code` (number), `data` (array of object: `supplierName`, `rawMaterialId`, `rawMaterialName`, `leadTime`)
    - **相关概念**: `DeliveryCapability`, `Supplier`
    - **接口MCP工具**: `executeOntoBehavior` (行为名称: `QuerySupplierCapability`)

## 5函数
【重点：函数的计算为实例化对象或对象集合，用于属性的计算和处理】

- **`sumRawNotArrivalQty` (原材料未到位数)**
    - **描述**: 根据传入的数据包指定的原材料，过滤掉到位时间小于当前时间的部分，对剩余部分的到位数 `arrivalQuantity` 求和。
    - **输入参数**: `filterRawMaterialName` (string, 必填), `currentDate` (string, 必填), `purchaseRecordSet` (array of object: `arrivalTime`, `rawMaterialName`, `arrivalQuantity`)
    - **返回结构**: `result` (object: `rawMaterialName`, `sumNotArrivalQty`)
    - **关联概念属性**: `PurchaseRecord.arrivalTime`, `PurchaseRecord.rawMaterialName`, `PurchaseRecord.arrivalQuantity`
    - **接口MCP工具**: `executeOntoFunction` (函数名称: `sumRawNotArrivalQty`)

## 6规则
【重点：规则主要用于对执行行为的前置和后置进行把控，每次智能体执行行为的时候，若有规则则必须判断，以确保整个行为的执行是合法可控的。例如：在行为执行前对输入参数进行校验，或者在行为执行后对输出结果进行校验以及推理等】

- **`V01_UnitConsistency_Purchase` (采购-原料单位一致性)**
    - **类型**: 验证规则
    - **描述**: 创建采购单时，输入的 `unit` 必须与关联原材料的 `unit` 一致。
    - **介入位置**: 前置
    - **关联行为**: `CreatePurchaseRecord`
    - **关联函数**: 无
    - **规则设计**: `{"left": {"type": "concept", "concept": "PurchaseRecord", "attribute": "unit"}, "operator": "eq", "right": {"type": "concept", "concept": "RawMaterial", "attribute": "unit"}}`

- **`V03_ArrivalTimeValidity` (到位时间合理性)**
    - **类型**: 验证规则
    - **描述**: 创建采购单时，输入的 `arrivalTime` 必须晚于 `purchaseTime`。
    - **介入位置**: 前置
    - **关联行为**: `CreatePurchaseRecord`
    - **关联函数**: 无
    - **规则设计**: `{"left": {"type": "concept", "concept": "PurchaseRecord", "attribute": "arrivalTime"}, "operator": "gt", "right": {"type": "concept", "concept": "PurchaseRecord", "attribute": "purchaseTime"}}`

- **`V04_RawMaterialExistence` (采购-原料存在性)**
    - **类型**: 验证规则
    - **描述**: 创建采购单时，提供的 `rawMaterialId` 必须与 `RawMaterial` 概念中的 `rawMaterialId` 一致。
    - **介入位置**: 前置
    - **关联行为**: `CreatePurchaseRecord`
    - **关联函数**: 无
    - **规则设计**: `{"left": {"type": "concept", "concept": "PurchaseRecord", "attribute": "rawMaterialId"}, "operator": "in", "right": {"type": "set", "concept": "RawMaterial", "attribute": "rawMaterialId"}}`

- **`V05_SupplierExistence` (采购-供应商存在性)**
    - **类型**: 验证规则
    - **描述**: 创建采购单时，提供的 `supplierName` 必须与 `Supplier` 概念中 `supplierName` 的一致。
    - **介入位置**: 前置
    - **关联行为**: `CreatePurchaseRecord`
    - **关联函数**: 无
    - **规则设计**: `{"left": {"type": "concept", "concept": "PurchaseRecord", "attribute": "supplierName"}, "operator": "in", "right": {"type": "set", "concept": "Supplier", "attribute": "supplierName", "value": "", "function": "", "returnField": ""}}`

- **`I01_SafetyStockAlert` (安全库存预警)**
    - **类型**: 推理规则
    - **描述**: IF 可用库存 `availableStock` < 原材料的 `safetyStock` THEN 推送预警，建议创建采购单或关注库存。
    - **介入位置**: 后置
    - **关联行为**: `QueryInventory`, `ReceiveRawMaterial`
    - **关联函数**: 无
    - **规则设计**: `{"if": {"logic": "and", "conditions": [{"left": {"type": "concept", "concept": "RawMaterialInventory", "attribute": "availableStock"}, "operator": "lt", "right": {"type": "concept", "concept": "RawMaterial", "attribute": "safetyStock"}}]}, "then": "可用库存低于安全库存，建议创建采购单或关注库存", "else": "库存正常，无需操作"}`

- **`I02_ArrivalOverdueAlert` (采购到位超期预警)**
    - **类型**: 推理规则
    - **描述**: IF 当前日期 >= 采购单 `arrivalTime` THEN 提示用户是否启动入库操作。
    - **介入位置**: 后置
    - **关联行为**: `QueryPurchaseRecords`
    - **关联函数**: 无
    - **规则设计**: `{"if": {"logic": "and", "conditions": [{"left": {"type": "function", "function": "getCurrentDate", "returnField": "date"}, "operator": "ge", "right": {"type": "concept", "concept": "PurchaseRecord", "attribute": "arrivalTime"}}]}, "then": "采购单已到位，建议启动入库操作", "else": "采购单尚未到位，无需操作"}`

- **`I03_PurchasePurposeInference` (采购目的推理)**
    - **类型**: 推理规则
    - **描述**: IF 采购单 `relatedOrderId` 为空 THEN 该采购目的可视为“补充库存”。
    - **介入位置**: 后置
    - **关联行为**: `CreatePurchaseRecord`, `QueryPurchaseRecords`
    - **关联函数**: 无
    - **规则设计**: `{"if": {"logic": "and", "conditions": [{"left": {"type": "concept", "concept": "PurchaseRecord", "attribute": "relatedOrderId"}, "operator": "eq", "right": {"type": "value", "value": "\"\""}}]}, "then": "该采购单的采购目的可视为“补充库存”", "else": "该采购单有关联订单，采购目的可能为生产订单备料"}`

- **`I04_RelatedOrderValidation` (采购关联订单校验)**
    - **类型**: 推理规则
    - **描述**: IF 采购单 `relatedOrderId` 不为空且不在 `CustomerOrder` 表中 (或状态为 已取消) THEN 提示用户该客户订单可能已失效，请确认是否取消该采购单。
    - **介入位置**: 后置
    - **关联行为**: `CreatePurchaseRecord`, `QueryPurchaseRecords`
    - **关联函数**: 无
    - **规则设计**: `{"if": {"logic": "and", "conditions": [{"left": {"type": "concept", "concept": "PurchaseRecord", "attribute": "relatedOrderId"}, "operator": "ne", "right": {"type": "value", "value": "\"\""}}, {"left": {"type": "concept", "concept": "PurchaseRecord", "attribute": "relatedOrderId"}, "operator": "not in", "right": {"type": "set", "concept": "CustomerOrder", "attribute": "customerOrderId"}}]}, "then": "该采购单关联的客户订单可能已失效，请确认是否取消该采购单。", "else": "采购单关联的客户订单有效，无需操作。"}`

## 7安全管控
【重点：安全管控的目的是对危险行为引入人工确认，审核节点表示是行为执行前还是执行后，此时应该临时中断操作，让用户对相关内容进行审核（具体内容请参考审核内容）】

- **行为名称**: `CreatePurchaseRecord`
    - **介入位置**: 前置
    - **审核内容**: 审核采购的必要性：检查库存是否确实需要补货，关联的客户订单是否真实有效，采购数量和到位时间是否合理。

- **行为名称**: `CancelPurchaseRecord`
    - **介入位置**: 前置
    - **审核内容**: 审核取消的原因：确认取消采购单是否合理，是否已与供应商沟通，是否存在违约风险。

- **行为名称**: `ReceiveRawMaterial`
    - **介入位置**: 前置
    - **审核内容**: 审核入库的准确性：确认到货的原材料、数量、供应商是否与采购单一致，质检是否已通过（如适用）。