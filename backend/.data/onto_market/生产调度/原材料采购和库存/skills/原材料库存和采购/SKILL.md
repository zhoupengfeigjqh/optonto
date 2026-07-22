---
name: 原材料库存和采购本体
description: 该技能提供了原材料、原材料库存以及原材料采购的相关信息，涵盖了从原材料基础信息查询、供应商管理、采购单创建与取消、入库操作到库存查询的完整业务流程。当用户的意图涉及原材料查询、原材料采购以及原材料库存等相关操作时，请读取该文件进行进一步的业务理解和行为操作。核心业务逻辑包括：基于客户订单需求触发采购、管理采购单的生命周期（创建、取消、入库）、实时监控原材料库存水平（可用库存、待入库量）、并依据安全库存和到位时间等规则进行预警和推理。
---

# 原材料库存和采购本体技能

## 1简介
该技能围绕生产调度中的原材料采购与库存管理，提供了从供应商选择、采购单管理到库存监控的全链路能力，确保生产所需原材料的及时供应与库存健康。

## 2概念与关系
### 概念基本信息
- `RawMaterial`（原材料）：表示生产所需的基础物料。
- `Supplier`（供应商）：提供原材料的合作方。
- `PurchaseRecord`（原材料采购记录）：记录每一次原材料采购的详细信息。
- `RawMaterialInventory`（原材料库存）：反映每种原材料的实时库存状态。
- `CustomerOrder`（客户订单）：触发原材料采购的源头需求。
- `DeliveryCapability`（交货能力）：描述供应商对特定原材料的供货能力（如交货周期、最小起订量）。

### 概念关系基本信息
- `hasRawInventory`（拥有库存）：每个 `RawMaterial` 对应一个唯一的 `RawMaterialInventory`，即一种原材料只有一条库存记录。
- `recordsRawMaterial`（记录原材料）：多个 `PurchaseRecord` 可以关联同一个 `RawMaterial`，即一种原材料可以被多次采购。
- `orderedFromSupplier`（向供应商采购）：多个 `PurchaseRecord` 可以关联同一个 `Supplier`，即可以向同一个供应商多次采购。
- `suppliesRawMaterial`（供应原材料）：一个 `Supplier` 可以供应多种 `RawMaterial`，一种 `RawMaterial` 也可以由多个 `Supplier` 供应。
- `containsPurchaseRecord`（包含采购记录）：一个 `CustomerOrder` 可以包含多个 `PurchaseRecord`，即一个客户订单可能需要多次采购来满足。
- `hasCapability`（拥有能力）：一个 `Supplier` 拥有多个 `DeliveryCapability`，描述其对不同原材料的供货能力。

### 概念属性基本信息
- `RawMaterial`: `rawMaterialId`（原材料编号）, `rawMaterialName`（原材料名称）, `unit`（单位）, `safetyStock`（安全库存）
- `Supplier`: `supplierId`（供应商编号）, `supplierName`（供应商名称）, `address`（地址）, `contactPerson`（联系人）, `contactPhone`（联系电话）
- `PurchaseRecord`: `purchaseRecordId`（采购单号）, `rawMaterialId`（原材料编号）, `rawMaterialName`（原材料名称）, `purchaseTime`（采购时间）, `arrivalTime`（到位时间）, `arrivalQuantity`（到位数量）, `unit`（单位）, `leadTime`（等待周期）, `supplierName`（供应商名称）, `relatedOrderId`（关联订单编号）, `relatedOrderName`（关联订单名称）
- `RawMaterialInventory`: `inventoryId`（库存编号）, `rawMaterialId`（原材料编号）, `rawMaterialName`（原材料名称）, `materialType`（材料类型）, `pendingReceiptQuantity`（待入库量）, `cumulativeStockQuantity`（累计库存量）, `availableStock`（可用库存）, `unit`（单位）
- `CustomerOrder`: `customerOrderId`（客户订单编号）, `customerOrderName`（客户订单名称）, `batchNumber`（批次号）, `bufferPeriod`（缓冲期）, `orderType`（订单类型）, `status`（状态）
- `DeliveryCapability`: `rawMaterialId`（原材料编号）, `rawMaterialName`（原材料名称）, `supplierName`（供应商名称）, `supplierId`（供应商编号）, `leadTime`（交货周期）, `minCount`（最小起订量）

## 3行为
行为推动任务的执行，每当智能体要行为执行时：
1）请判断该行为是否在行为集合里
2）若在则先提取与该行为动作相关的规则和函数，进行规则验证推理或调用相关函数进行计算
3）若在请判断该行为动作是否需要安全管控，即需要人工介入
4）规则和审核节点包括前置（行为执行前）和后置（行为执行后）两种类型。
以确保整个行为的执行是合法的

### 行为列表
- **CreatePurchaseRecord（创建原材料采购单）**：创建一笔新的原材料采购记录。
  - **描述**：根据原材料、供应商、数量、到位时间等信息，生成一个新的采购单。
  - **输入参数**：`rawMaterialId`（原材料编号）, `rawMaterialName`（原材料名称）, `arrivalQuantity`（到位数量）, `supplierName`（供应商名称）, `arrivalTime`（到位时间）, `relatedOrderId`（关联订单编号）, `relatedOrderName`（关联订单名称）, `unit`（单位）
  - **输出结构**：`purchaseRecordId`（采购单号）, `rawMaterialId`（原材料编号）, `rawMaterialName`（原材料名称）, `purchaseTime`（采购时间）, `arrivalTime`（到位时间）, `arrivalQuantity`（到位数量）, `unit`（单位）, `supplierName`（供应商名称）, `relatedOrderId`（关联订单编号）, `relatedOrderName`（关联订单名称）, `leadTime`（等待周期）, `status`（状态）
  - **相关概念**：`RawMaterial`, `Supplier`, `PurchaseRecord`, `CustomerOrder`
  - **关联规则**：`V01_UnitConsistency_Purchase`, `V03_ArrivalTimeValidity`, `V04_RawMaterialExistence`, `V05_SupplierExistence`, `I03_PurchasePurposeInference`, `I04_RelatedOrderValidation`
  - **关联函数**：无
  - **MCP工具**：`executeOntoBehavior`，参数为行为名 `CreatePurchaseRecord` 及上述输入参数。

- **CancelPurchaseRecord（取消原材料采购单）**：取消一笔已创建但尚未入库的采购记录。
  - **描述**：根据采购单号，取消一个状态为“待入库”的采购单。
  - **输入参数**：`purchaseRecordId`（采购单号）
  - **输出结构**：`purchaseRecordId`（采购单号）, `rawMaterialId`（原材料ID）, `rawMaterialName`（原材料名称）
  - **相关概念**：`PurchaseRecord`
  - **关联规则**：无
  - **关联函数**：无
  - **MCP工具**：`executeOntoBehavior`，参数为行为名 `CancelPurchaseRecord` 及上述输入参数。

- **ReceiveRawMaterial（入库原材料）**：将原材料采购入库。
  - **描述**：根据采购单号，将对应的采购原材料入库，并更新库存信息。
  - **输入参数**：`purchaseRecordId`（采购单号）
  - **输出结构**：`purchaseRecordId`（采购单号）, `rawMaterialId`（原材料ID）, `rawMaterialName`（原材料名称）
  - **相关概念**：`PurchaseRecord`, `RawMaterialInventory`
  - **关联规则**：`I02_ArrivalOverdueAlert`
  - **关联函数**：无
  - **MCP工具**：`executeOntoBehavior`，参数为行为名 `ReceiveRawMaterial` 及上述输入参数。

- **QueryInventory（查询原材料库存信息）**：根据原材料ID或名称查询其最新的库存快照。
  - **描述**：查询指定原材料的库存信息，包括可用库存、待入库量等。
  - **输入参数**：`rawMaterialId`（原材料编号）, `rawMaterialName`（原材料名称）
  - **输出结构**：`inventoryId`（库存编号）, `rawMaterialId`（原材料编号）, `rawMaterialName`（原材料名称）, `materialType`（材料类型）, `pendingReceiptQuantity`（待入库量）, `cumulativeStockQuantity`（累计库存量）, `availableStock`（可用库存）, `unit`（单位）
  - **相关概念**：`RawMaterialInventory`, `RawMaterial`
  - **关联规则**：`I01_SafetyStockAlert`
  - **关联函数**：无
  - **MCP工具**：`executeOntoBehavior`，参数为行为名 `QueryInventory` 及上述输入参数。

- **QueryPurchaseRecords（查询原材料采购单信息）**：根据采购单/原材料/关联客单来查询采购记录列表。
  - **描述**：根据多种条件组合查询采购记录。
  - **输入参数**：`purchaseRecordId`（采购单号）, `rawMaterialId`（原材料编号）, `rawMaterialName`（原材料名称）
  - **输出结构**：`purchaseRecordId`（采购单号）, `rawMaterialId`（原材料编号）, `rawMaterialName`（原材料名称）, `purchaseTime`（采购时间）, `arrivalTime`（到位时间）, `arrivalQuantity`（到位数量）, `unit`（单位）, `supplierName`（供应商名称）, `relatedOrderId`（关联订单编号）, `relatedOrderName`（关联订单名称）, `leadTime`（等待周期）
  - **相关概念**：`PurchaseRecord`, `RawMaterial`, `CustomerOrder`
  - **关联规则**：无
  - **关联函数**：无
  - **MCP工具**：`executeOntoBehavior`，参数为行为名 `QueryPurchaseRecords` 及上述输入参数。

- **QueryRawMaterials（查询原材料基本信息）**：根据原材料ID或名称查询原材料的基础信息。
  - **描述**：查询原材料的基本属性，如单位、安全库存等。
  - **输入参数**：`rawMaterialId`（原材料编号）, `rawMaterialName`（原材料名称）
  - **输出结构**：`rawMaterialId`（原材料编号）, `rawMaterialName`（原材料名称）, `unit`（单位）, `safetyStock`（安全库存）
  - **相关概念**：`RawMaterial`
  - **关联规则**：无
  - **关联函数**：无
  - **MCP工具**：`executeOntoBehavior`，参数为行为名 `QueryRawMaterials` 及上述输入参数。

- **QuerySuppliers（查询供应商信息）**：根据供应商名或原材料名查询供应商。
  - **描述**：查询供应商的详细信息。
  - **输入参数**：`supplierName`（供应商名称，模糊匹配）, `rawMaterialName`（原材料名称）
  - **输出结构**：`supplierId`（供应商编号）, `supplierName`（供应商名称）, `address`（地址）, `contactPerson`（联系人）, `contactPhone`（联系电话）
  - **相关概念**：`Supplier`, `RawMaterial`
  - **关联规则**：无
  - **关联函数**：无
  - **MCP工具**：`executeOntoBehavior`，参数为行为名 `QuerySuppliers` 及上述输入参数。

- **QuerySupplierCapability（查询供应商供货能力）**：根据供应商名或原材料名，查询供应商供货能力。
  - **描述**：查询供应商对特定原材料的交货周期等信息。
  - **输入参数**：`supplierName`（供应商名称，模糊匹配）, `rawMaterialName`（原材料名称）
  - **输出结构**：`supplierName`（供应商名称）, `rawMaterialId`（原材料ID）, `rawMaterialName`（原材料名称）, `leadTime`（交货周期）
  - **相关概念**：`Supplier`, `DeliveryCapability`
  - **关联规则**：无
  - **关联函数**：无
  - **MCP工具**：`executeOntoBehavior`，参数为行为名 `QuerySupplierCapability` 及上述输入参数。

## 4函数
函数的计算为实例化对象或对象集合，用于属性的计算和处理

### 函数列表
- **sumRawNotArrivalQty（原材料未到位数）**：根据传入的数据包指定的原材料，过滤掉到位时间小于当前时间的部分，对剩余部分的到位数arrivalQuantity求和。
  - **计算逻辑**：从 `purchaseRecordSet` 中筛选出 `rawMaterialName` 等于 `filterRawMaterialName` 且 `arrivalTime` 大于等于 `currentDate` 的记录，然后对这些记录的 `arrivalQuantity` 进行求和。
  - **关联概念属性**：`PurchaseRecord.arrivalTime`, `PurchaseRecord.rawMaterialName`, `PurchaseRecord.arrivalQuantity`
  - **输入参数**：`filterRawMaterialName`（原材料名称）, `currentDate`（日期）, `purchaseRecordSet`（采购记录集合）
  - **返回结构**：`rawMaterialName`（原材料名称）, `sumNotArrivalQty`（未到位总量）
  - **MCP工具**：`executeOntoFunction`，参数为函数名 `sumRawNotArrivalQty` 及上述输入参数。

## 5规则
规则主要用于对执行行为的前置和后置进行把控，每次智能体执行行为的时候，若有规则则必须判断，以确保整个行为的执行是合法可控的。例如：在行为执行前对输入参数进行校验，或者在行为执行后对输出结果进行校验以及推理等

### 规则列表
- **V01_UnitConsistency_Purchase（采购-原料单位一致性）**：创建采购单时，输入的 unit 必须与关联原材料的 unit 一致。
  - **类型**：验证规则
  - **介入位置**：前置（行为执行前）
  - **关联行为**：`CreatePurchaseRecord`
  - **关联函数**：无
  - **规则设计**：在调用 `CreatePurchaseRecord` 前，先通过 `QueryRawMaterials` 查询该原材料的 `unit`，并与输入的 `unit` 进行比较，若不一致则阻止行为执行并提示用户。

- **V03_ArrivalTimeValidity（到位时间合理性）**：创建采购单时，输入的 arrivalTime 必须晚于 purchaseTime。
  - **类型**：验证规则
  - **介入位置**：前置（行为执行前）
  - **关联行为**：`CreatePurchaseRecord`
  - **关联函数**：无
  - **规则设计**：在调用 `CreatePurchaseRecord` 前，获取当前时间作为 `purchaseTime`，并与输入的 `arrivalTime` 进行比较，若 `arrivalTime` 不晚于 `purchaseTime`，则阻止行为执行并提示用户。

- **V04_RawMaterialExistence（采购-原料存在性）**：创建采购单时，提供的 rawMaterialId 必须与RawMaterial 概念中的rawMaterialId一致。
  - **类型**：验证规则
  - **介入位置**：前置（行为执行前）
  - **关联行为**：`CreatePurchaseRecord`
  - **关联函数**：无
  - **规则设计**：在调用 `CreatePurchaseRecord` 前，通过 `QueryRawMaterials` 查询该 `rawMaterialId` 是否存在，若不存在则阻止行为执行并提示用户。

- **V05_SupplierExistence（采购-供应商存在性）**：创建采购单时，提供的 supplierName 必须与 Supplier 概念中suplierName的一致。
  - **类型**：验证规则
  - **介入位置**：前置（行为执行前）
  - **关联行为**：`CreatePurchaseRecord`
  - **关联函数**：无
  - **规则设计**：在调用 `CreatePurchaseRecord` 前，通过 `QuerySuppliers` 查询该 `supplierName` 是否存在，若不存在则阻止行为执行并提示用户。

- **I01_SafetyStockAlert（安全库存预警）**：IF 可用库存availableStock < 原材料的safetyStock THEN 推送预警，建议创建采购单或关注库存。
  - **类型**：推理规则
  - **介入位置**：后置（行为执行后）
  - **关联行为**：`QueryInventory`
  - **关联函数**：无
  - **规则设计**：在 `QueryInventory` 返回结果后，比较 `availableStock` 与对应原材料的 `safetyStock`，若低于安全库存，则向用户推送预警信息。

- **I02_ArrivalOverdueAlert（采购到位超期预警）**：IF 当前日期 >= 采购单arrivalTime  THEN 提示用户是否启动入库操作。
  - **类型**：推理规则
  - **介入位置**：后置（行为执行后）
  - **关联行为**：`QueryPurchaseRecords`, `ReceiveRawMaterial`
  - **关联函数**：无
  - **规则设计**：在查询采购记录或执行入库操作前，检查采购单的 `arrivalTime` 是否已到期或超期，若是则提示用户是否进行入库。

- **I03_PurchasePurposeInference（采购目的推理）**：IF 采购单relatedOrderId 为空 THEN 该采购目的可视为“补充库存”。
  - **类型**：推理规则
  - **介入位置**：后置（行为执行后）
  - **关联行为**：`CreatePurchaseRecord`
  - **关联函数**：无
  - **规则设计**：在成功创建采购单后，检查返回结果中的 `relatedOrderId` 是否为空，若为空则向用户说明该采购单的目的是“补充库存”。

- **I04_RelatedOrderValidation（采购关联订单校验）**：IF 采购单relatedOrderId不为空且不在 CustomerOrder 表中 (或状态为 已取消) THEN 提示用户该客户订单可能已失效，请确认是否取消该采购单。
  - **类型**：推理规则
  - **介入位置**：后置（行为执行后）
  - **关联行为**：`CreatePurchaseRecord`
  - **关联函数**：无
  - **规则设计**：在成功创建采购单后，检查返回结果中的 `relatedOrderId`，若不为空，则查询 `CustomerOrder` 表确认该订单是否存在且状态有效，若无效则向用户发出警告。

## 6安全管控
安全管控的目的是对危险行为引入人工确认，审核节点表示是行为执行前还是执行后，此时应该临时中断操作，让用户对相关内容进行审核（具体内容请参考审核内容）

### 安全管控列表
- **CreatePurchaseRecord**：
  - **介入位置**：前置（行为执行前）
  - **审核内容**：审核采购的必要性：检查库存是否确实需要补货，关联的客户订单是否真实有效，采购数量和到位时间是否合理。

- **CancelPurchaseRecord**：
  - **介入位置**：前置（行为执行前）
  - **审核内容**：审核取消的原因：确认取消采购单是否合理，是否已与供应商沟通，是否存在违约风险。

- **ReceiveRawMaterial**：
  - **介入位置**：前置（行为执行前）
  - **审核内容**：审核入库的准确性：确认到货的原材料、数量、供应商是否与采购单一致，质检是否已通过（如适用）。