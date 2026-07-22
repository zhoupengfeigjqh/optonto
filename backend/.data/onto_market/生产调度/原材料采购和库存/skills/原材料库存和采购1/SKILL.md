好的，作为一名专业的智能体技能生成专家，我将根据您提供的本体数据和技能模板，为您生成一份完整的、可直接使用的智能体技能文件（SKILL.md）。

---

---
name: 原材料库存和采购本体
description: 该技能提供了原材料、原材料库存以及原材料采购的相关信息与操作能力。核心业务逻辑围绕原材料的采购流程展开，包括创建采购单、取消采购单、入库操作，以及查询库存、供应商和采购记录。技能内置了多项验证规则（如单位一致性、到位时间合理性）和推理规则（如安全库存预警、采购超期提醒），并针对关键操作（创建、取消、入库）设置了安全管控节点，确保业务流程的合规性与安全性。当用户的意图涉及原材料查询、原材料采购以及原材料库存等相关操作时，请读取该文件进行进一步的业务理解和行为操作。
---

# 原材料库存和采购本体技能

## 1 简介
原材料库存和采购本体技能，用于管理生产调度中的原材料信息、库存状态、供应商信息以及采购流程。它涵盖了从原材料定义、供应商管理、采购单创建到库存更新的完整业务闭环。

【插入：特别注意，当智能体生成和执行任务时，请先从概念关系出发进行全局把控，然后再分析行为-规则-函数-安全等内容，以此推导出正确的执行逻辑】

## 2 概念与关系

### 概念
- **RawMaterial (原材料)**: 生产所需的基础物料。
- **Supplier (供应商)**: 提供原材料的公司或个人。
- **PurchaseRecord (原材料采购记录)**: 每一次采购操作的详细记录。
- **RawMaterialInventory (原材料库存)**: 原材料在仓库中的实时库存快照。
- **CustomerOrder (客户订单)**: 触发采购需求的客户订单。
- **DeliveryCapability (交货能力)**: 供应商针对特定原材料的供货能力（如交货周期、最小起订量）。

### 关系
- **hasRawInventory (拥有库存)**: 一种原材料 (`RawMaterial`) 对应一条库存记录 (`RawMaterialInventory`)，关系为 1:1。
- **recordsRawMaterial (记录原材料)**: 一条采购记录 (`PurchaseRecord`) 关联一种原材料 (`RawMaterial`)，关系为 N:1。
- **orderedFromSupplier (向供应商采购)**: 一条采购记录 (`PurchaseRecord`) 关联一个供应商 (`Supplier`)，关系为 N:1。
- **suppliesRawMaterial (供应原材料)**: 一个供应商 (`Supplier`) 可以供应多种原材料，一种原材料也可以由多个供应商供应，关系为 N:M。
- **containsPurchaseRecord (包含采购记录)**: 一个客户订单 (`CustomerOrder`) 可以包含多条采购记录 (`PurchaseRecord`)，关系为 1:N。
- **hasCapability (拥有能力)**: 一个供应商 (`Supplier`) 拥有多条供货能力记录 (`DeliveryCapability`)，关系为 1:N。

### 概念属性
- **RawMaterial**: rawMaterialId (原材料编号), rawMaterialName (原材料名称), unit (单位), safetyStock (安全库存)
- **Supplier**: supplierId (供应商编号), supplierName (供应商名称), address (地址), contactPerson (联系人), contactPhone (联系电话)
- **PurchaseRecord**: purchaseRecordId (采购单号), rawMaterialId (原材料编号), rawMaterialName (原材料名称), purchaseTime (采购时间), arrivalTime (到位时间), arrivalQuantity (到位数量), unit (单位), leadTime (等待周期), supplierName (供应商名称), relatedOrderId (关联订单编号), relatedOrderName (关联订单名称)
- **RawMaterialInventory**: inventoryId (库存编号), rawMaterialId (原材料编号), rawMaterialName (原材料名称), materialType (材料类型), pendingReceiptQuantity (待入库量), cumulativeStockQuantity (累计库存量), availableStock (可用库存), unit (单位)
- **CustomerOrder**: customerOrderId (客户订单编号), customerOrderName (客户订单名称), batchNumber (批号), bufferPeriod (缓冲期), orderType (订单类型), status (状态)
- **DeliveryCapability**: rawMaterialId (原材料编号), rawMaterialName (原材料名称), supplierName (供应商名称), supplierId (供应商编号), leadTime (交货周期), minCount (最小起订量)

【插入：特别注意，概念-属性-关系代表着该领域的基本业务逻辑，智能体的任务生成和执行都必须从该网络出发展开】

## 3 行为

### 3.1 CreatePurchaseRecord (创建原材料采购单)
- **行为描述**: 创建一笔新的原材料采购记录。
- **输入参数**:
  - `rawMaterialId` (string, 必填): 原材料编号，例如 "RM-001"
  - `rawMaterialName` (string, 必填): 原材料名称，例如 "高强度钢板"
  - `arrivalQuantity` (number, 必填): 到位数量，例如 50
  - `supplierName` (string, 必填): 供应商名称，例如 "XX钢铁集团"
  - `arrivalTime` (string, 必填): 到位时间，例如 "2023-11-10"
  - `relatedOrderId` (string, 必填): 关联订单编号，例如 "SO-20231025-001"
  - `relatedOrderName` (string, 必填): 关联订单名称，例如 "客户A-项目X订单"
  - `unit` (string, 必填): 单位，例如 "吨"
- **输出结构**: 返回一个包含新创建的采购记录详细信息的对象。
- **相关概念**: PurchaseRecord, RawMaterial, Supplier, CustomerOrder
- **调用接口**: 使用 `executeOntoBehavior` 工具，行为名为 `CreatePurchaseRecord`，并传入上述输入参数。

### 3.2 CancelPurchaseRecord (取消原材料采购单)
- **行为描述**: 取消一笔已创建但尚未入库的采购记录。
- **输入参数**:
  - `purchaseRecordId` (string, 必填): 采购单号，例如 "PO-20231027-001"
- **输出结构**: 返回被取消的采购单的基本信息。
- **相关概念**: PurchaseRecord
- **调用接口**: 使用 `executeOntoBehavior` 工具，行为名为 `CancelPurchaseRecord`，并传入上述输入参数。

### 3.3 ReceiveRawMaterial (入库原材料)
- **行为描述**: 将原材料采购入库。
- **输入参数**:
  - `purchaseRecordId` (string, 必填): 采购单号，例如 "PO-20231027-001"
- **输出结构**: 返回已入库的采购单的基本信息。
- **相关概念**: PurchaseRecord, RawMaterialInventory
- **调用接口**: 使用 `executeOntoBehavior` 工具，行为名为 `ReceiveRawMaterial`，并传入上述输入参数。

### 3.4 QueryInventory (查询原材料库存信息)
- **行为描述**: 根据原材料ID或名称查询其最新的库存快照。
- **输入参数**:
  - `rawMaterialId` (string, 必填): 原材料编号，例如 "RM-001"
  - `rawMaterialName` (string, 必填): 原材料名称，例如 "高强度钢板"
- **输出结构**: 返回一个包含库存信息的数组。
- **相关概念**: RawMaterialInventory, RawMaterial
- **调用接口**: 使用 `executeOntoBehavior` 工具，行为名为 `QueryInventory`，并传入上述输入参数。

### 3.5 QueryPurchaseRecords (查询原材料采购单信息)
- **行为描述**: 根据采购单/原材料/关联客单来查询采购记录列表。
- **输入参数**:
  - `purchaseRecordId` (string, 必填): 采购单号，例如 "PO-20231027-001"
  - `rawMaterialId` (string, 必填): 原材料编号，例如 "RM-001"
  - `rawMaterialName` (string, 必填): 原材料名称，例如 "高强度钢板"
- **输出结构**: 返回一个包含采购记录信息的数组。
- **相关概念**: PurchaseRecord, RawMaterial, CustomerOrder
- **调用接口**: 使用 `executeOntoBehavior` 工具，行为名为 `QueryPurchaseRecords`，并传入上述输入参数。

### 3.6 QueryRawMaterials (查询原材料基本信息)
- **行为描述**: 根据原材料ID或名称查询原材料的基础信息。
- **输入参数**:
  - `rawMaterialId` (string, 必填): 原材料编号，例如 "RM-001"
  - `rawMaterialName` (string, 必填): 原材料名称，例如 "高强度钢板"
- **输出结构**: 返回一个包含原材料基础信息的数组。
- **相关概念**: RawMaterial
- **调用接口**: 使用 `executeOntoBehavior` 工具，行为名为 `QueryRawMaterials`，并传入上述输入参数。

### 3.7 QuerySuppliers (查询供应商信息)
- **行为描述**: 根据供应商名或原材料名查询供应商。
- **输入参数**:
  - `supplierName` (string, 可选): 供应商名称，模糊匹配，例如 "宝钢钢铁集团"
  - `rawMaterialName` (string, 可选): 原材料名称，例如 "钢板008"
- **输出结构**: 返回一个包含供应商信息的数组。
- **相关概念**: Supplier, RawMaterial
- **调用接口**: 使用 `executeOntoBehavior` 工具，行为名为 `QuerySuppliers`，并传入上述输入参数。

### 3.8 QuerySupplierCapability (查询供应商供货能力)
- **行为描述**: 根据供应商名或原材料名，查询供应商供货能力。
- **输入参数**:
  - `supplierName` (string, 可选): 供应商名称，模糊匹配，例如 "宝钢钢铁集团"
  - `rawMaterialName` (string, 可选): 原材料名称，例如 "钢板008"
- **输出结构**: 返回一个包含供应商供货能力信息的数组。
- **相关概念**: DeliveryCapability, Supplier, RawMaterial
- **调用接口**: 使用 `executeOntoBehavior` 工具，行为名为 `QuerySupplierCapability`，并传入上述输入参数。

【插入：行为推动任务的执行，每当智能体要行为执行时：
1）请判断该行为是否在行为集合里
2）若在则先提取与该行为动作相关的规则和函数，进行规则验证推理或调用相关函数进行计算
3）若在请判断该行为动作是否需要安全管控，即需要人工介入
4）规则和审核节点包括前置（行为执行前）和后置（行为执行后）两种类型。
以确保整个行为的执行是合法的】

## 4 函数

### 4.1 sumRawNotArrivalQty (原材料未到位数)
- **计算逻辑**: 根据传入的原材料名称和当前日期，从给定的采购记录集合中，过滤掉到位时间小于当前日期的记录，然后对剩余记录的 `arrivalQuantity` 进行求和。
- **关联概念属性**: PurchaseRecord.arrivalTime, PurchaseRecord.rawMaterialName, PurchaseRecord.arrivalQuantity
- **输入参数**:
  - `filterRawMaterialName` (string, 必填): 原材料名称，例如 "高强度钢板"
  - `currentDate` (string, 必填): 日期，例如 "2026-01-01"
  - `purchaseRecordSet` (array, 必填): 采购记录集合，每个对象包含 `arrivalTime`, `rawMaterialName`, `arrivalQuantity` 属性。
- **返回结构**: 返回一个包含原材料名称和未到位总量的对象。
- **调用接口**: 使用 `executeOntoFunction` 工具，函数名为 `sumRawNotArrivalQty`，并传入上述输入参数。

【插入：函数的计算为实例化对象或对象集合，用于属性的计算和处理】

## 5 规则

### 5.1 V01_UnitConsistency_Purchase (采购-原料单位一致性)
- **规则类型**: 验证规则
- **规则描述**: 创建采购单时，输入的 `unit` 必须与关联原材料的 `unit` 一致。
- **介入位置**: 前置 (行为执行前)
- **关联行为**: CreatePurchaseRecord
- **关联函数**: 无
- **规则设计**: 在调用 `CreatePurchaseRecord` 前，先通过 `QueryRawMaterials` 查询对应原材料的 `unit`，并与输入参数中的 `unit` 进行比较。

### 5.2 V03_ArrivalTimeValidity (到位时间合理性)
- **规则类型**: 验证规则
- **规则描述**: 创建采购单时，输入的 `arrivalTime` 必须晚于 `purchaseTime`。
- **介入位置**: 前置 (行为执行前)
- **关联行为**: CreatePurchaseRecord
- **关联函数**: 无
- **规则设计**: 在调用 `CreatePurchaseRecord` 前，比较输入参数中的 `arrivalTime` 与系统当前时间（作为 `purchaseTime`）。

### 5.3 V04_RawMaterialExistence (采购-原料存在性)
- **规则类型**: 验证规则
- **规则描述**: 创建采购单时，提供的 `rawMaterialId` 必须与 `RawMaterial` 概念中的 `rawMaterialId` 一致。
- **介入位置**: 前置 (行为执行前)
- **关联行为**: CreatePurchaseRecord
- **关联函数**: 无
- **规则设计**: 在调用 `CreatePurchaseRecord` 前，先通过 `QueryRawMaterials` 查询是否存在该 `rawMaterialId`。

### 5.4 V05_SupplierExistence (采购-供应商存在性)
- **规则类型**: 验证规则
- **规则描述**: 创建采购单时，提供的 `supplierName` 必须与 `Supplier` 概念中 `supplierName` 的一致。
- **介入位置**: 前置 (行为执行前)
- **关联行为**: CreatePurchaseRecord
- **关联函数**: 无
- **规则设计**: 在调用 `CreatePurchaseRecord` 前，先通过 `QuerySuppliers` 查询是否存在该 `supplierName`。

### 5.5 I01_SafetyStockAlert (安全库存预警)
- **规则类型**: 推理规则
- **规则描述**: 如果可用库存 `availableStock` 小于原材料的 `safetyStock`，则推送预警，建议创建采购单或关注库存。
- **介入位置**: 后置 (行为执行后)
- **关联行为**: QueryInventory, ReceiveRawMaterial
- **关联函数**: 无
- **规则设计**: 在执行 `QueryInventory` 或 `ReceiveRawMaterial` 后，检查返回的 `availableStock` 是否小于对应原材料的 `safetyStock`。

### 5.6 I02_ArrivalOverdueAlert (采购到位超期预警)
- **规则类型**: 推理规则
- **规则描述**: 如果当前日期大于等于采购单的 `arrivalTime`，则提示用户是否启动入库操作。
- **介入位置**: 后置 (行为执行后)
- **关联行为**: QueryPurchaseRecords
- **关联函数**: 无
- **规则设计**: 在执行 `QueryPurchaseRecords` 后，检查返回的每条记录的 `arrivalTime` 是否早于或等于当前日期。

### 5.7 I03_PurchasePurposeInference (采购目的推理)
- **规则类型**: 推理规则
- **规则描述**: 如果采购单的 `relatedOrderId` 为空，则该采购目的可视为“补充库存”。
- **介入位置**: 后置 (行为执行后)
- **关联行为**: CreatePurchaseRecord, QueryPurchaseRecords
- **关联函数**: 无
- **规则设计**: 在执行 `CreatePurchaseRecord` 或 `QueryPurchaseRecords` 后，检查返回或创建的记录的 `relatedOrderId` 是否为空。

### 5.8 I04_RelatedOrderValidation (采购关联订单校验)
- **规则类型**: 推理规则
- **规则描述**: 如果采购单的 `relatedOrderId` 不为空且不在 `CustomerOrder` 表中（或状态为“已取消”），则提示用户该客户订单可能已失效，请确认是否取消该采购单。
- **介入位置**: 后置 (行为执行后)
- **关联行为**: CreatePurchaseRecord, QueryPurchaseRecords
- **关联函数**: 无
- **规则设计**: 在执行 `CreatePurchaseRecord` 或 `QueryPurchaseRecords` 后，检查返回或创建的记录的 `relatedOrderId`，并查询 `CustomerOrder` 表进行校验。

【插入：规则主要用于对执行行为的前置和后置进行把控，每次智能体执行行为的时候，若有规则则必须判断，以确保整个行为的执行是合法可控的。例如：在行为执行前对输入参数进行校验，或者在行为执行后对输出结果进行校验以及推理等】

## 6 安全管控

### 6.1 CreatePurchaseRecord (创建原材料采购单)
- **介入位置**: 前置 (行为执行前)
- **审核内容**: 审核采购的必要性：检查库存是否确实需要补货，关联的客户订单是否真实有效，采购数量和到位时间是否合理。

### 6.2 CancelPurchaseRecord (取消原材料采购单)
- **介入位置**: 前置 (行为执行前)
- **审核内容**: 审核取消的原因：确认取消采购单是否合理，是否已与供应商沟通，是否存在违约风险。

### 6.3 ReceiveRawMaterial (入库原材料)
- **介入位置**: 前置 (行为执行前)
- **审核内容**: 审核入库的准确性：确认到货的原材料、数量、供应商是否与采购单一致，质检是否已通过（如适用）。

【插入：安全管控的目的是对危险行为引入人工确认，审核节点表示是行为执行前还是执行后，此时应该临时中断操作，让用户对相关内容进行审核（具体内容请参考审核内容）】