---
name: 原材料库存和采购本体
description: 该技能提供了原材料、原材料库存以及原材料采购的相关信息。当用户的意图涉及原材料查询、原材料采购、原材料库存管理以及供应商能力评估等操作时，请读取该文件进行进一步的业务理解和行为操作。核心业务逻辑围绕原材料的采购流程展开，包括创建采购单、入库、库存查询，并关联供应商、客户订单等概念。技能内置了多种规则（如单位一致性、安全库存预警）和安全管控节点，以确保业务操作的合规性和风险控制。
---

# 原材料库存和采购本体技能

## 1简介
该技能覆盖了从原材料基础信息、供应商能力、采购订单创建到库存管理的全链路。它帮助智能体理解如何根据客户订单或库存预警发起采购，并确保采购过程的合规性。

## 2概念与关系
**概念基本信息：**
- `RawMaterial`（原材料）：代表生产所需的基础物料。
- `Supplier`（供应商）：提供原材料的厂商。
- `PurchaseRecord`（原材料采购记录）：记录每一次原材料采购的详细信息。
- `RawMaterialInventory`（原材料库存）：记录每种原材料的实时库存状态。
- `CustomerOrder`（客户订单）：代表客户的订单，是采购需求的来源之一。
- `DeliveryCapability`（交货能力）：描述供应商对特定原材料的供货能力（如交货周期、最小起订量）。

**概念关系基本信息：**
- `hasRawInventory`：每个`RawMaterial`（原材料）都对应一个唯一的`RawMaterialInventory`（原材料库存）记录（1:1）。
- `recordsRawMaterial`：每个`PurchaseRecord`（采购记录）都关联一个被采购的`RawMaterial`（原材料）（N:1）。
- `orderedFromSupplier`：每个`PurchaseRecord`（采购记录）都关联一个提供该物料的`Supplier`（供应商）（N:1）。
- `suppliesRawMaterial`：一个`Supplier`（供应商）可以提供多种`RawMaterial`（原材料），一种`RawMaterial`（原材料）也可以由多个`Supplier`（供应商）提供（N:M）。
- `containsPurchaseRecord`：一个`CustomerOrder`（客户订单）可以包含多个`PurchaseRecord`（采购记录）（1:N）。
- `hasCapability`：一个`Supplier`（供应商）拥有多种`DeliveryCapability`（交货能力）（1:N）。

**业务逻辑梳理：**
整个业务围绕“采购”这一核心行为展开。当有客户订单或库存不足时，会触发采购需求。采购时，需要从`Supplier`（供应商）处购买`RawMaterial`（原材料），并创建`PurchaseRecord`（采购记录）。采购的物料到货后，会更新`RawMaterialInventory`（原材料库存）。同时，`Supplier`（供应商）的`DeliveryCapability`（交货能力）为采购决策（如选择哪个供应商、预计到货时间）提供了依据。

## 3行为
**行为介绍：**

- **CreatePurchaseRecord（创建原材料采购单）**
  - **描述**：创建一笔新的原材料采购记录。
  - **输入参数**：`rawMaterialId` (string, 必填), `rawMaterialName` (string, 必填), `arrivalQuantity` (number, 必填), `supplierName` (string, 必填), `arrivalTime` (string, 必填), `relatedOrderId` (string, 必填), `relatedOrderName` (string, 必填), `unit` (string, 必填)。
  - **输出结构**：`code` (number), `data` (object: `purchaseRecordId`, `rawMaterialId`, `rawMaterialName`, `purchaseTime`, `arrivalTime`, `arrivalQuantity`, `unit`, `supplierName`, `relatedOrderId`, `relatedOrderName`, `leadTime`, `status`)。
  - **相关概念**：`PurchaseRecord`（原材料采购记录）, `RawMaterial`（原材料）, `Supplier`（供应商）, `CustomerOrder`（客户订单）。
  - **调用接口**：`executeOntoBehavior`，行为名为 `CreatePurchaseRecord`。

- **CancelPurchaseRecord（取消原材料采购单）**
  - **描述**：取消一笔已创建但尚未入库的采购记录。
  - **输入参数**：`purchaseRecordId` (string, 必填)。
  - **输出结构**：`code` (number), `data` (object: `purchaseRecordId`, `rawMaterialId`, `rawMaterialName`)。
  - **相关概念**：`PurchaseRecord`（原材料采购记录）。
  - **调用接口**：`executeOntoBehavior`，行为名为 `CancelPurchaseRecord`。

- **ReceiveRawMaterial（入库原材料）**
  - **描述**：将原材料采购入库。
  - **输入参数**：`purchaseRecordId` (string, 必填)。
  - **输出结构**：`code` (number), `data` (object: `purchaseRecordId`, `rawMaterialId`, `rawMaterialName`)。
  - **相关概念**：`PurchaseRecord`（原材料采购记录）, `RawMaterialInventory`（原材料库存）。
  - **调用接口**：`executeOntoBehavior`，行为名为 `ReceiveRawMaterial`。

- **QueryInventory（查询原材料库存信息）**
  - **描述**：根据原材料ID或名称查询其最新的库存快照。
  - **输入参数**：`rawMaterialId` (string, 必填), `rawMaterialName` (string, 必填)。
  - **输出结构**：`code` (number), `data` (array of object: `inventoryId`, `rawMaterialId`, `rawMaterialName`, `materialType`, `pendingReceiptQuantity`, `cumulativeStockQuantity`, `availableStock`, `unit`)。
  - **相关概念**：`RawMaterialInventory`（原材料库存）。
  - **调用接口**：`executeOntoBehavior`，行为名为 `QueryInventory`。

- **QueryPurchaseRecords（查询原材料采购单信息）**
  - **描述**：根据采购单/原材料/关联客单来查询采购记录列表。
  - **输入参数**：`purchaseRecordId` (string, 必填), `rawMaterialId` (string, 必填), `rawMaterialName` (string, 必填)。
  - **输出结构**：`code` (number), `data` (array of object: `purchaseRecordId`, `rawMaterialId`, `rawMaterialName`, `purchaseTime`, `arrivalTime`, `arrivalQuantity`, `unit`, `supplierName`, `relatedOrderId`, `relatedOrderName`, `leadTime`)。
  - **相关概念**：`PurchaseRecord`（原材料采购记录）。
  - **调用接口**：`executeOntoBehavior`，行为名为 `QueryPurchaseRecords`。

- **QueryRawMaterials（查询原材料基本信息）**
  - **描述**：根据原材料ID或名称查询原材料的基础信息。
  - **输入参数**：`rawMaterialId` (string, 必填), `rawMaterialName` (string, 必填)。
  - **输出结构**：`code` (number), `data` (array of object: `rawMaterialId`, `rawMaterialName`, `unit`, `safetyStock`)。
  - **相关概念**：`RawMaterial`（原材料）。
  - **调用接口**：`executeOntoBehavior`，行为名为 `QueryRawMaterials`。

- **QuerySuppliers（查询供应商信息）**
  - **描述**：根据供应商名或原材料名查询供应商。
  - **输入参数**：`supplierName` (string, 可选), `rawMaterialName` (string, 可选)。
  - **输出结构**：`code` (number), `data` (array of object: `supplierId`, `supplierName`, `address`, `contactPerson`, `contactPhone`)。
  - **相关概念**：`Supplier`（供应商）。
  - **调用接口**：`executeOntoBehavior`，行为名为 `QuerySuppliers`。

- **QuerySupplierCapability（查询供应商供货能力）**
  - **描述**：根据供应商名或原材料名，查询供应商供货能力。
  - **输入参数**：`supplierName` (string, 可选), `rawMaterialName` (string, 可选)。
  - **输出结构**：`code` (number), `data` (array of object: `supplierName`, `rawMaterialId`, `rawMaterialName`, `leadTime`)。
  - **相关概念**：`DeliveryCapability`（交货能力）。
  - **调用接口**：`executeOntoBehavior`，行为名为 `QuerySupplierCapability`。

【插入：行为推动任务的执行，每当智能体要行为执行时：
1）请判断该行为是否在行为集合里
2）若在则先提取与该行为动作相关的规则和函数，进行规则验证推理或调用相关函数进行计算
3）若在请判断该行为动作是否需要安全管控，即需要人工介入
4）规则和审核节点包括前置（行为执行前）和后置（行为执行后）两种类型。
以确保整个行为的执行是合法的】

## 4函数
**函数介绍：**

- **sumRawNotArrivalQty（原材料未到位数）**
  - **计算逻辑**：根据传入的数据包指定的原材料，过滤掉到位时间小于当前时间的部分，对剩余部分的到位数`arrivalQuantity`求和。
  - **关联概念属性**：`PurchaseRecord.arrivalTime`, `PurchaseRecord.rawMaterialName`, `PurchaseRecord.arrivalQuantity`。
  - **输入参数**：`filterRawMaterialName` (string, 必填), `currentDate` (string, 必填), `purchaseRecordSet` (array of object: `arrivalTime`, `rawMaterialName`, `arrivalQuantity`)。
  - **返回结构**：`result` (object: `rawMaterialName`, `sumNotArrivalQty`)。
  - **调用接口**：`executeOntoFunction`，函数名为 `sumRawNotArrivalQty`。

【插入：函数的计算为实例化对象或对象集合，用于属性的计算和处理】

## 5规则
**规则介绍：**

- **V01_UnitConsistency_Purchase（采购-原料单位一致性）**
  - **规则类型**：验证规则。
  - **规则描述**：创建采购单时，输入的 `unit` 必须与关联原材料的 `unit` 一致。
  - **规则介入位置**：前置。
  - **关联行为**：`CreatePurchaseRecord`。
  - **关联函数**：无。
  - **规则设计**：`unit` 必须与 `RawMaterial.unit` 一致。

- **V03_ArrivalTimeValidity（到位时间合理性）**
  - **规则类型**：验证规则。
  - **规则描述**：创建采购单时，输入的 `arrivalTime` 必须晚于 `purchaseTime`。
  - **规则介入位置**：前置。
  - **关联行为**：`CreatePurchaseRecord`。
  - **关联函数**：无。
  - **规则设计**：`arrivalTime` > `purchaseTime`。

- **V04_RawMaterialExistence（采购-原料存在性）**
  - **规则类型**：验证规则。
  - **规则描述**：创建采购单时，提供的 `rawMaterialId` 必须与 `RawMaterial` 概念中的 `rawMaterialId` 一致。
  - **规则介入位置**：前置。
  - **关联行为**：`CreatePurchaseRecord`。
  - **关联函数**：无。
  - **规则设计**：`rawMaterialId` 必须在 `RawMaterial` 中存在。

- **V05_SupplierExistence（采购-供应商存在性）**
  - **规则类型**：验证规则。
  - **规则描述**：创建采购单时，提供的 `supplierName` 必须与 `Supplier` 概念中 `supplierName` 的一致。
  - **规则介入位置**：前置。
  - **关联行为**：`CreatePurchaseRecord`。
  - **关联函数**：无。
  - **规则设计**：`supplierName` 必须在 `Supplier` 中存在。

- **I01_SafetyStockAlert（安全库存预警）**
  - **规则类型**：推理规则。
  - **规则描述**：IF 可用库存 `availableStock` < 原材料的 `safetyStock` THEN 推送预警，建议创建采购单或关注库存。
  - **规则介入位置**：后置。
  - **关联行为**：`QueryInventory`, `ReceiveRawMaterial`。
  - **关联函数**：无。
  - **规则设计**：`availableStock` < `safetyStock`。

- **I02_ArrivalOverdueAlert（采购到位超期预警）**
  - **规则类型**：推理规则。
  - **规则描述**：IF 当前日期 >= 采购单 `arrivalTime` THEN 提示用户是否启动入库操作。
  - **规则介入位置**：后置。
  - **关联行为**：`QueryPurchaseRecords`。
  - **关联函数**：无。
  - **规则设计**：`currentDate` >= `arrivalTime`。

- **I03_PurchasePurposeInference（采购目的推理）**
  - **规则类型**：推理规则。
  - **规则描述**：IF 采购单 `relatedOrderId` 为空 THEN 该采购目的可视为“补充库存”。
  - **规则介入位置**：后置。
  - **关联行为**：`CreatePurchaseRecord`。
  - **关联函数**：无。
  - **规则设计**：`relatedOrderId` 为空。

- **I04_RelatedOrderValidation（采购关联订单校验）**
  - **规则类型**：推理规则。
  - **规则描述**：IF 采购单 `relatedOrderId` 不为空且不在 `CustomerOrder` 表中 (或状态为 已取消) THEN 提示用户该客户订单可能已失效，请确认是否取消该采购单。
  - **规则介入位置**：后置。
  - **关联行为**：`CreatePurchaseRecord`, `QueryPurchaseRecords`。
  - **关联函数**：无。
  - **规则设计**：`relatedOrderId` 不为空且 `CustomerOrder.status` 为“已取消”或不存在。

【插入：规则主要用于对执行行为的前置和后置进行把控，每次智能体执行行为的时候，若有规则则必须判断，以确保整个行为的执行是合法可控的。例如：在行为执行前对输入参数进行校验，或者在行为执行后对输出结果进行校验以及推理等】

## 6安全管控
- **CreatePurchaseRecord（创建原材料采购单）**
  - **介入位置**：前置。
  - **审核内容**：审核采购的必要性：检查库存是否确实需要补货，关联的客户订单是否真实有效，采购数量和到位时间是否合理。

- **CancelPurchaseRecord（取消原材料采购单）**
  - **介入位置**：前置。
  - **审核内容**：审核取消的原因：确认取消采购单是否合理，是否已与供应商沟通，是否存在违约风险。

- **ReceiveRawMaterial（入库原材料）**
  - **介入位置**：前置。
  - **审核内容**：审核入库的准确性：确认到货的原材料、数量、供应商是否与采购单一致，质检是否已通过（如适用）。