---
onto_name: 原材料库存和采购本体
onto_id: 1
scenario_name: 生产调度
scenario_id: 1
description: 该技能提供了原材料、原材料库存以及原材料采购的相关信息。当用户的意图涉及原材料查询、原材料采购以及原材料库存等相关操作时，请读取该文件进行进一步的业务理解和行为操作。核心业务逻辑围绕原材料的采购、入库、库存管理展开，涉及供应商、客户订单等多个关联实体。技能包含创建、取消、入库采购单，查询库存、采购记录、供应商及供货能力等行为，并内置了单位一致性、到位时间合理性、安全库存预警等规则，以及采购到入库的完整流程指引。
---

# 原材料库存和采购本体技能

## 1 原则
原则1：当智能体根据用户意图生成和执行任务时，请务必先从概念关系出发进行全局把控，然后再分析行为-规则-函数-安全等内容，以此推导出正确的执行逻辑。这是必须要遵循的原则！
原则2：行为推动任务的执行，为了确保整个行为的执行是合法的，规定每当智能体要行为执行时，还需要做如下检查：
1）请判断该行为是否在行为集合里
2）若在则先提取与该行为动作相关的规则和函数，进行规则验证推理或调用相关函数进行计算
3）完成2）后，请同时判断该行为动作是否需要安全管控，即需要人工介入。
4）不能绕过行为、规则和安全管控进行推理和行动
原则3：执行细节原则，用户输入-基于本体的意图分析-任务生成和子任务拆分-子任务执行（规则-安全管控-执行-规则-安全管控）-下一个子任务执行-...

## 2 概念与关系
【重点：特别注意，概念-属性-关系代表着该领域的最基本业务逻辑，智能体的任务生成和执行都必须从该网络出发展开】

### 概念
- **RawMaterial（原材料）**: 生产所需的基础物料，定义了其编号、名称、单位和安全库存。
- **Supplier（供应商）**: 提供原材料的供应商信息，包括名称、地址和联系方式。
- **PurchaseRecord（原材料采购记录）**: 记录每一次采购活动的详细信息，包括采购的物料、数量、供应商、关联订单及时间等。
- **RawMaterialInventory（原材料库存）**: 反映每种原材料的实时库存状态，包括待入库量、累计库存量和可用库存。
- **CustomerOrder（客户订单）**: 客户下达的生产订单，采购活动可能与此关联。
- **DeliveryCapability（交货能力）**: 供应商针对特定原材料的供货能力，如交货周期和最小起订量。

### 关系
整个关系体系描述了从“供应商”提供“原材料”，到“采购记录”关联“供应商”和“原材料”，再到“客户订单”包含“采购记录”，以及“原材料”拥有其“库存”的完整业务链条。
- **hasRawInventory**: RawMaterial -> RawMaterialInventory (1:1)，一种原材料对应一个库存记录。
- **recordsRawMaterial**: PurchaseRecord -> RawMaterial (N:1)，多条采购记录可以采购同一种原材料。
- **orderedFromSupplier**: PurchaseRecord -> Supplier (N:1)，多条采购记录可以从同一个供应商采购。
- **suppliesRawMaterial**: Supplier -> RawMaterial (N:M)，一个供应商可以提供多种原材料，一种原材料也可以由多个供应商提供。
- **containsPurchaseRecord**: CustomerOrder -> PurchaseRecord (1:N)，一个客户订单可能包含多笔采购记录。
- **hasCapability**: Supplier -> DeliveryCapability (1:N)，一个供应商拥有多种原材料的供货能力。

### 概念属性
- **RawMaterial**: rawMaterialId (原材料编号), rawMaterialName (原材料名称), unit (单位), safetyStock (安全库存)
- **Supplier**: supplierId (供应商编号), supplierName (供应商名称), address (地址), contactPerson (联系人), contactPhone (联系电话)
- **PurchaseRecord**: purchaseRecordId (采购单号), rawMaterialId (原材料编号), rawMaterialName (原材料名称), purchaseTime (采购时间), arrivalTime (到位时间), arrivalQuantity (到位数量), unit (单位), leadTime (等待周期), supplierName (供应商名称), relatedOrderId (关联订单编号), relatedOrderName (关联订单名称)
- **RawMaterialInventory**: inventoryId (库存编号), rawMaterialId (原材料编号), rawMaterialName (原材料名称), materialType (材料类型), pendingReceiptQuantity (待入库量), cumulativeStockQuantity (累计库存量), availableStock (可用库存), unit (单位)
- **CustomerOrder**: customerOrderId (客户订单编号), customerOrderName (客户订单名称), batchNumber (批次号), bufferPeriod (缓冲期), orderType (订单类型), status (状态)
- **DeliveryCapability**: rawMaterialId (原材料ID), rawMaterialName (原材料名称), supplierName (供应商名称), supplierId (供应商编号), leadTime (交货周期), minCount (最小起订量)

## 3 重要业务流程
【重点：重点业务流程，用于任务执行逻辑的参考，注意这里不是该流程是唯一固定的】

**原材料采购到入库流程 (ProcureAndReceiveRawMaterial)**:
1. **查询库存**: 用户或系统首先查询原材料库存，判断是否需要采购。
2. **创建采购单**: 根据库存情况或客户订单需求，创建原材料采购单。
3. **查询采购记录**: 定期或主动按需查询采购记录，跟踪已创建的采购单状态。
4. **入库原材料**: 确认原材料到货，执行入库操作，更新库存。
5. **再次查询库存**: 入库完成后，再次查询库存，确认库存状态已更新。

## 4 行为

### CreatePurchaseRecord（创建原材料采购单）
- **描述**: 创建一笔新的原材料采购记录。
- **输入参数**:
  - `rawMaterialId` (string, 必填): 原材料编号，例如 "RM-001"
  - `rawMaterialName` (string, 必填): 原材料名称，例如 "高强度钢板"
  - `arrivalQuantity` (number, 必填): 到位数量，例如 50
  - `supplierName` (string, 必填): 供应商名称，例如 "XX钢铁集团"
  - `arrivalTime` (string, 必填): 到位时间，例如 "2023-11-10"
  - `relatedOrderId` (string, 选填): 关联订单编号，例如 "SO-20231025-001"
  - `relatedOrderName` (string, 选填): 关联订单名称，例如 "客户A-项目X订单"
  - `unit` (string, 必填): 单位，例如 "吨"
- **输出结构**: 返回创建的采购记录对象，包含 `purchaseRecordId`, `rawMaterialId`, `rawMaterialName`, `purchaseTime`, `arrivalTime`, `arrivalQuantity`, `unit`, `supplierName`, `relatedOrderId`, `relatedOrderName`, `leadTime`, `status`。
- **相关概念**: 原材料 (RawMaterial), 供应商 (Supplier), 客户订单 (CustomerOrder)
- **调用接口**: 使用 `executeOntoBehavior` 工具，行为名为 `CreatePurchaseRecord`，参数为上述输入参数。

### CancelPurchaseRecord（取消原材料采购单）
- **描述**: 取消一笔已创建但尚未入库的采购记录。
- **输入参数**:
  - `purchaseRecordId` (string, 必填): 采购单号，例如 "PO-20231027-001"
- **输出结构**: 返回被取消的采购记录ID和关联的原材料信息，包含 `purchaseRecordId`, `rawMaterialId`, `rawMaterialName`。
- **相关概念**: 采购记录 (PurchaseRecord)
- **调用接口**: 使用 `executeOntoBehavior` 工具，行为名为 `CancelPurchaseRecord`，参数为上述输入参数。

### ReceiveRawMaterial（入库原材料）
- **描述**: 将原材料采购入库。
- **输入参数**:
  - `purchaseRecordId` (string, 必填): 采购单号，例如 "PO-20231027-001"
- **输出结构**: 返回入库的采购记录ID和关联的原材料信息，包含 `purchaseRecordId`, `rawMaterialId`, `rawMaterialName`。
- **相关概念**: 采购记录 (PurchaseRecord), 原材料库存 (RawMaterialInventory)
- **调用接口**: 使用 `executeOntoBehavior` 工具，行为名为 `ReceiveRawMaterial`，参数为上述输入参数。

### QueryInventory（查询原材料库存信息）
- **描述**: 根据原材料ID或名称查询其最新的库存快照。
- **输入参数**:
  - `rawMaterialId` (string, 必填): 原材料编号，例如 "RM-001"
  - `rawMaterialName` (string, 必填): 原材料名称，例如 "高强度钢板"
- **输出结构**: 返回库存信息列表，每个元素包含 `inventoryId`, `rawMaterialId`, `rawMaterialName`, `materialType`, `pendingReceiptQuantity`, `cumulativeStockQuantity`, `availableStock`, `unit`。
- **相关概念**: 原材料库存 (RawMaterialInventory)
- **调用接口**: 使用 `executeOntoBehavior` 工具，行为名为 `QueryInventory`，参数为上述输入参数。

### QueryPurchaseRecords（查询原材料采购单信息）
- **描述**: 根据采购单/原材料/关联客单来查询采购记录列表。
- **输入参数**:
  - `purchaseRecordId` (string, 选填): 采购单号，例如 "PO-20231027-001"
  - `rawMaterialId` (string, 选填): 原材料编号，例如 "RM-001"
  - `rawMaterialName` (string, 选填): 原材料名称，例如 "高强度钢板"
- **输出结构**: 返回采购记录列表，每个元素包含 `purchaseRecordId`, `rawMaterialId`, `rawMaterialName`, `purchaseTime`, `arrivalTime`, `arrivalQuantity`, `unit`, `supplierName`, `relatedOrderId`, `relatedOrderName`, `leadTime`。
- **相关概念**: 采购记录 (PurchaseRecord)
- **调用接口**: 使用 `executeOntoBehavior` 工具，行为名为 `QueryPurchaseRecords`，参数为上述输入参数。

### QueryRawMaterials（查询原材料基本信息）
- **描述**: 根据原材料ID或名称查询原材料的基础信息。
- **输入参数**:
  - `rawMaterialId` (string, 选填): 原材料编号，例如 "RM-001"
  - `rawMaterialName` (string, 选填): 原材料名称，例如 "高强度钢板"
- **输出结构**: 返回原材料信息列表，每个元素包含 `rawMaterialId`, `rawMaterialName`, `unit`, `safetyStock`。
- **相关概念**: 原材料 (RawMaterial)
- **调用接口**: 使用 `executeOntoBehavior` 工具，行为名为 `QueryRawMaterials`，参数为上述输入参数。

### QuerySuppliers（查询供应商信息）
- **描述**: 根据供应商名或原材料名查询供应商。
- **输入参数**:
  - `supplierName` (string, 选填): 供应商名称，模糊匹配，例如 "宝钢钢铁集团"
  - `rawMaterialName` (string, 选填): 原材料名称，例如 "钢板008"
- **输出结构**: 返回供应商信息列表，每个元素包含 `supplierId`, `supplierName`, `address`, `contactPerson`, `contactPhone`。
- **相关概念**: 供应商 (Supplier)
- **调用接口**: 使用 `executeOntoBehavior` 工具，行为名为 `QuerySuppliers`，参数为上述输入参数。

### QuerySupplierCapability（查询供应商供货能力）
- **描述**: 根据供应商名或原材料名，查询供应商供货能力。
- **输入参数**:
  - `supplierName` (string, 选填): 供应商名称，模糊匹配，例如 "宝钢钢铁集团"
  - `rawMaterialName` (string, 选填): 原材料名称，例如 "钢板008"
- **输出结构**: 返回供货能力信息列表，每个元素包含 `supplierName`, `rawMaterialId`, `rawMaterialName`, `leadTime`。
- **相关概念**: 交货能力 (DeliveryCapability)
- **调用接口**: 使用 `executeOntoBehavior` 工具，行为名为 `QuerySupplierCapability`，参数为上述输入参数。

## 5 函数
【重点：函数的计算为实例化对象或对象集合，用于属性的计算和处理】

### sumRawNotArrivalQty（原材料未到位数）
- **描述**: 根据传入的数据包指定的原材料，过滤掉到位时间小于当前时间的部分，对剩余部分的到位数 `arrivalQuantity` 求和。
- **计算逻辑**: 从 `purchaseRecordSet` 中筛选出 `rawMaterialName` 等于 `filterRawMaterialName` 且 `arrivalTime` 大于等于 `currentDate` 的记录，然后对这些记录的 `arrivalQuantity` 进行求和。
- **关联概念属性**: 采购记录 (PurchaseRecord) 的 `rawMaterialName`, `arrivalTime`, `arrivalQuantity`。
- **输入参数**:
  - `filterRawMaterialName` (string): 原材料名称，例如 "高强度钢板"
  - `currentDate` (string): 日期，例如 "2026-01-01"
  - `purchaseRecordSet` (array): 采购记录集合，每个元素包含 `arrivalTime`, `rawMaterialName`, `arrivalQuantity`。
- **返回结构**: 返回一个对象，包含 `rawMaterialName` 和 `sumNotArrivalQty` (未到位总量)。
- **调用接口**: 使用 `executeOntoFunction` 工具，函数名为 `sumRawNotArrivalQty`，参数为上述输入参数。

## 6 规则
【重点：规则主要用于对执行行为的前置和后置进行把控，每次智能体执行行为的时候，若有规则则必须判断，以确保整个行为的执行是合法可控的。例如：在行为执行前对输入参数进行校验，或者在行为执行后对输出结果进行校验以及推理等】

### V01_UnitConsistency_Purchase（采购-原料单位一致性）
- **类型**: 验证规则
- **描述**: 创建采购单时，输入的 `unit` 必须与关联原材料的 `unit` 一致。
- **介入位置**: 前置 (行为执行前)
- **关联行为**: CreatePurchaseRecord
- **关联函数**: 无
- **规则结构**: `{"left": {"type": "concept", "concept": "PurchaseRecord", "attribute": "unit"}, "operator": "eq", "right": {"type": "concept", "concept": "RawMaterial", "attribute": "unit"}}`

### V03_ArrivalTimeValidity（到位时间合理性）
- **类型**: 验证规则
- **描述**: 创建采购单时，输入的 `arrivalTime` 必须晚于 `purchaseTime`。
- **介入位置**: 前置 (行为执行前)
- **关联行为**: CreatePurchaseRecord
- **关联函数**: 无
- **规则结构**: `{"left": {"type": "concept", "concept": "PurchaseRecord", "attribute": "arrivalTime"}, "operator": "gt", "right": {"type": "concept", "concept": "PurchaseRecord", "attribute": "purchaseTime"}}`

### V04_RawMaterialExistence（采购-原料存在性）
- **类型**: 验证规则
- **描述**: 创建采购单时，提供的 `rawMaterialId` 必须与 `RawMaterial` 概念中的 `rawMaterialId` 一致。
- **介入位置**: 前置 (行为执行前)
- **关联行为**: CreatePurchaseRecord
- **关联函数**: 无
- **规则结构**: `{"left": {"type": "concept", "concept": "PurchaseRecord", "attribute": "rawMaterialId"}, "operator": "in", "right": {"type": "set", "concept": "RawMaterial", "attribute": "rawMaterialId"}}`

### V05_SupplierExistence（采购-供应商存在性）
- **类型**: 验证规则
- **描述**: 创建采购单时，提供的 `supplierName` 必须与 `Supplier` 概念中 `supplierName` 的一致。
- **介入位置**: 前置 (行为执行前)
- **关联行为**: CreatePurchaseRecord
- **关联函数**: 无
- **规则结构**: `{"left": {"type": "concept", "concept": "PurchaseRecord", "attribute": "supplierName"}, "operator": "in", "right": {"type": "set", "concept": "Supplier", "attribute": "supplierName", "value": "", "function": "", "returnField": ""}}`

### I01_SafetyStockAlert（安全库存预警）
- **类型**: 推理规则
- **描述**: 如果可用库存 `availableStock` 小于原材料的 `safetyStock`，则推送预警，建议创建采购单或关注库存。
- **介入位置**: 后置 (行为执行后)
- **关联行为**: QueryInventory, ReceiveRawMaterial
- **关联函数**: 无
- **规则结构**: `{"if": {"logic": "and", "conditions": [{"left": {"type": "concept", "concept": "RawMaterialInventory", "attribute": "availableStock"}, "operator": "lt", "right": {"type": "concept", "concept": "RawMaterial", "attribute": "safetyStock"}}]}, "then": "可用库存低于安全库存，建议创建采购单或关注库存", "else": "库存正常，无需操作"}`

### I02_ArrivalOverdueAlert（采购到位超期预警）
- **类型**: 推理规则
- **描述**: 如果当前日期大于等于采购单的 `arrivalTime`，则提示用户是否启动入库操作。
- **介入位置**: 后置 (行为执行后)
- **关联行为**: QueryPurchaseRecords
- **关联函数**: 无
- **规则结构**: `{"if": {"logic": "and", "conditions": [{"left": {"type": "function", "function": "getCurrentDate", "returnField": "date"}, "operator": "ge", "right": {"type": "concept", "concept": "PurchaseRecord", "attribute": "arrivalTime"}}]}, "then": "采购单已到位，建议启动入库操作", "else": "采购单尚未到位，无需操作"}`

### I03_PurchasePurposeInference（采购目的推理）
- **类型**: 推理规则
- **描述**: 如果采购单的 `relatedOrderId` 为空，则该采购目的可视为“补充库存”。
- **介入位置**: 后置 (行为执行后)
- **关联行为**: CreatePurchaseRecord, QueryPurchaseRecords
- **关联函数**: 无
- **规则结构**: `{"if": {"logic": "and", "conditions": [{"left": {"type": "concept", "concept": "PurchaseRecord", "attribute": "relatedOrderId"}, "operator": "eq", "right": {"type": "value", "value": "\"\""}}]}, "then": "该采购单的采购目的可视为“补充库存”", "else": "该采购单有关联订单，采购目的可能为生产订单备料"}`

### I04_RelatedOrderValidation（采购关联订单校验）
- **类型**: 推理规则
- **描述**: 如果采购单的 `relatedOrderId` 不为空且不在 `CustomerOrder` 表中（或状态为已取消），则提示用户该客户订单可能已失效，请确认是否取消该采购单。
- **介入位置**: 后置 (行为执行后)
- **关联行为**: CreatePurchaseRecord, QueryPurchaseRecords
- **关联函数**: 无
- **规则结构**: `{"if": {"logic": "and", "conditions": [{"left": {"type": "concept", "concept": "PurchaseRecord", "attribute": "relatedOrderId"}, "operator": "ne", "right": {"type": "value", "value": "\"\""}}, {"left": {"type": "concept", "concept": "PurchaseRecord", "attribute": "relatedOrderId"}, "operator": "not in", "right": {"type": "set", "concept": "CustomerOrder", "attribute": "customerOrderId"}}]}, "then": "该采购单关联的客户订单可能已失效，请确认是否取消该采购单。", "else": "采购单关联的客户订单有效，无需操作。"}`

## 7 安全管控
【重点：安全管控的目的是对危险行为引入人工确认，介入位置可以在行为的执行前或执行后。介入时，智能体应该临时暂停后续操作，让用户对当前任务内容进行审核（具体内容请参考审核内容）】

### CreatePurchaseRecord
- **介入位置**: 前置
- **审核内容**: 审核采购的必要性：检查库存是否确实需要补货，关联的客户订单是否真实有效，采购数量和到位时间是否合理。

### CancelPurchaseRecord
- **介入位置**: 前置
- **审核内容**: 审核取消的原因：确认取消采购单是否合理，是否已与管理部门或供应商沟通，是否存在违约风险。

### ReceiveRawMaterial
- **介入位置**: 前置
- **审核内容**: 审核入库的准确性：确认到货的原材料、数量、供应商是否与采购单一致。
```