---

# 原材料库存和采购本体技能

## 0 本体基本信息
本体名称（onto_name）: 原材料库存和采购本体
本体id（onto_id）: 1
场景名称（scenario_name）: 生产调度
场景id（scenario_id）: 1

## 1原则
【重点：
原则1：当智能体根据用户意图生成和执行任务时，请务必先从概念关系出发进行全局把控，然后再分析行为-规则-函数-安全等内容，以此推导出正确的执行逻辑。这是必须要遵循的原则！
原则2：行为推动任务的执行，为了确保整个行为的执行是合法的，规定每当智能体要行为执行时，还需要做如下检查：
1）请判断该行为是否在行为集合里
2）若在则先提取与该行为动作相关的规则和函数，进行规则验证推理或调用相关函数进行计算
3）完成2）后，请同时判断该行为动作是否需要安全管控，即需要人工介入。
4）不能绕过行为、规则和安全管控进行推理和行动
原则3：流程执行原则，用户输入-LLM-意图分析-本体抽取-LLM-总任务生成+子任务拆分-子任务按顺序执行（子任务信息+前置规则+函数-大语言模型-结果（行为选择）-前置安全管控-调用工具（执行行为）-结果（工具输出）+后置规则-LLM-结果-后置安全管控）-下一个子任务执行-...-结束，流程中有错误则停止！】

## 2概念与关系
【重点：特别注意，概念-属性-关系代表着该领域的最基本业务逻辑，智能体的任务生成和执行都必须从该网络出发展开】

（概念基本信息，提供名称（英文）和展示名称（中文）信息）
- RawMaterial（原材料）
- Supplier（供应商）
- PurchaseRecord（原材料采购记录）
- RawMaterialInventory（原材料库存）
- CustomerOrder（客户订单）
- DeliveryCapability（交货能力）

（概念关系基本信息，提供名称（英文）和展示名称（中文）信息，并说明整个关系体系的逻辑）
- hasRawInventory（拥有原材料库存）：RawMaterial -> RawMaterialInventory (1:1)，一种原材料对应一条库存记录。
- recordsRawMaterial（记录原材料）：PurchaseRecord -> RawMaterial (N:1)，多条采购记录可以关联同一种原材料。
- orderedFromSupplier（从供应商订购）：PurchaseRecord -> Supplier (N:1)，多条采购记录可以关联同一个供应商。
- suppliesRawMaterial（供应原材料）：Supplier -> RawMaterial (N:M)，一个供应商可以供应多种原材料，一种原材料可以由多个供应商供应。
- containsPurchaseRecord（包含采购记录）：CustomerOrder -> PurchaseRecord (1:N)，一个客户订单可以包含多条采购记录。
- hasCapability（拥有供货能力）：Supplier -> DeliveryCapability (1:N)，一个供应商可以拥有多种原材料的供货能力。

（概念属性基本信息，提供名称（英文）和展示名称（中文）信息）
- RawMaterial: rawMaterialId (原材料编号), rawMaterialName (原材料名称), unit (单位), safetyStock (安全库存)
- Supplier: supplierId (供应商编号), supplierName (供应商名称), address (地址), contactPerson (联系人), contactPhone (联系电话)
- PurchaseRecord: purchaseRecordId (采购单号), rawMaterialId (原材料编号), rawMaterialName (原材料名称), purchaseTime (采购时间), arrivalTime (到位时间), arrivalQuantity (到位数量), unit (单位), leadTime (等待周期), supplierName (供应商名称), relatedOrderId (关联订单编号), relatedOrderName (关联订单名称)
- RawMaterialInventory: inventoryId (库存编号), rawMaterialId (原材料编号), rawMaterialName (原材料名称), materialType (材料类型), pendingReceiptQuantity (待入库量), cumulativeStockQuantity (累计库存量), availableStock (可用库存), unit (单位)
- CustomerOrder: customerOrderId (客户订单编号), customerOrderName (客户订单名称), batchNumber (批号), bufferPeriod (缓冲期), orderType (订单类型), status (状态)
- DeliveryCapability: rawMaterialId (原材料编号), rawMaterialName (原材料名称), supplierName (供应商名称), supplierId (供应商编号), leadTime (交货周期), minCount (最小起订量)

## 3重要业务流程
【重点：重点业务流程，用于任务执行逻辑的参考，注意这里不是该流程是唯一固定的】

（原材料库存和采购的核心业务流程）
1. 查询库存：用户或系统查询原材料库存，判断是否需要采购。
2. 创建采购单：根据库存情况或客户订单需求，创建原材料采购单。
3. 查询采购记录：定期或主动按需查询采购记录，跟踪已创建的采购单状态。
4. 入库原材料：确认原材料到货，执行入库操作，更新库存。
5. 再次查询库存：入库完成后，再次查询库存，确认库存状态已更新。

## 4行为

（行为介绍：包括行为英文名、中文名、类型、行为描述、输入参数（原封不动不修改）、输出结构（原封不动不修改）、相关概念（中文描述）；每个行为需指明需要调用的接口MCP工具，智能体根据该工具的参数自动组装并调用该工具）

### CreatePurchaseRecord（创建原材料采购单）
- **类型**: 行为
- **描述**: 创建一笔新的原材料采购记录。
- **输入参数**: 
  ```json
  {"rawMaterialId": {"type": "string", "required": true, "example": "RM-001", "display_name": "原材料编号"}, "rawMaterialName": {"type": "string", "required": true, "example": "高强度钢板", "display_name": "原材料名称"}, "arrivalQuantity": {"type": "number", "required": true, "example": 50, "display_name": "到位数量"}, "supplierName": {"type": "string", "required": true, "example": "XX钢铁集团", "display_name": "供应商名称"}, "arrivalTime": {"type": "string", "required": true, "example": "2023-11-10", "display_name": "到位时间"}, "relatedOrderId": {"type": "string", "required": false, "example": "SO-20231025-001", "display_name": "关联订单编号"}, "relatedOrderName": {"type": "string", "required": false, "example": "客户A-项目X订单", "display_name": "关联订单名称"}, "unit": {"type": "string", "required": true, "example": "吨", "display_name": "单位"}}
  ```
- **输出结构**: 
  ```json
  {"code": {"type": "number", "example": 0}, "data": {"type": "object", "properties": {"purchaseRecordId": {"type": "string", "display_name": "采购单号", "example": "PO-20231027-001"}, "rawMaterialId": {"type": "string", "display_name": "原材料编号", "example": "RM-001"}, "rawMaterialName": {"type": "string", "display_name": "原材料名称", "example": "高强度钢板"}, "purchaseTime": {"type": "string", "display_name": "采购时间", "example": "2023-10-27"}, "arrivalTime": {"type": "string", "display_name": "到位时间", "example": "2023-11-10"}, "arrivalQuantity": {"type": "number", "display_name": "到位数量", "example": 50}, "unit": {"type": "string", "display_name": "单位", "example": "吨"}, "supplierName": {"type": "string", "display_name": "供应商名称", "example": "XX钢铁集团"}, "relatedOrderId": {"type": "string", "display_name": "关联订单编号", "example": "SO-20231025-001"}, "relatedOrderName": {"type": "string", "display_name": "关联订单名称", "example": "客户A-项目X订单"}, "leadTime": {"type": "number", "display_name": "等待周期", "example": 14}, "status": {"type": "string", "display_name": "状态", "example": "待入库"}}}}
  ```
- **相关概念**: 原材料、供应商、采购记录
- **调用MCP工具**: executeOntoBehavior，参数为行为名称和输入参数。

### CancelPurchaseRecord（取消原材料采购单）
- **类型**: 行为
- **描述**: 取消一笔已创建但尚未入库的采购记录。
- **输入参数**: 
  ```json
  {"purchaseRecordId": {"type": "string", "required": true, "display_name": "采购单号", "example": "PO-20231027-001"}}
  ```
- **输出结构**: 
  ```json
  {"code": {"type": "number", "example": 0}, "data": {"type": "object", "properties": {"purchaseRecordId": {"type": "string", "display_name": "采购单号", "example": "PO-20231027-001"}, "rawMaterialId": {"type": "string", "display_name": "原材料ID", "example": "CRX001"}, "rawMaterialName": {"type": "string", "display_name": "原材料名称", "example": "高强度钢板"}}}}
  ```
- **相关概念**: 采购记录
- **调用MCP工具**: executeOntoBehavior，参数为行为名称和输入参数。

### ReceiveRawMaterial（入库原材料）
- **类型**: 行为
- **描述**: 将原材料采购入库。
- **输入参数**: 
  ```json
  {"purchaseRecordId": {"type": "string", "display_name": "采购单号", "example": "PO-20231027-001"}}
  ```
- **输出结构**: 
  ```json
  {"code": {"type": "number", "example": 0}, "data": {"type": "object", "properties": {"purchaseRecordId": {"type": "string", "display_name": "采购单号", "example": "PO-20231027-001"}, "rawMaterialId": {"type": "string", "display_name": "原材料ID", "example": "CRX001"}, "rawMaterialName": {"type": "string", "display_name": "原材料名称", "example": "高强度钢板"}}}}
  ```
- **相关概念**: 采购记录、原材料库存
- **调用MCP工具**: executeOntoBehavior，参数为行为名称和输入参数。

### QueryInventory（查询原材料库存信息）
- **类型**: 行为
- **描述**: 根据原材料ID或名称查询其最新的库存快照。
- **输入参数**: 
  ```json
  {"rawMaterialId": {"type": "string", "required": false, "description": "", "example": "RM-001"}, "rawMaterialName": {"type": "string", "required": false, "description": "", "example": "高强度钢板"}}
  ```
- **输出结构**: 
  ```json
  {"code": {"type": "number", "example": 0}, "data": {"type": "array", "items": {"type": "object", "properties": {"inventoryId": {"type": "string", "display_name": "库存编号", "example": "INV-RM-001"}, "rawMaterialId": {"type": "string", "display_name": "原材料编号", "example": "RM-001"}, "rawMaterialName": {"type": "string", "display_name": "原材料名称", "example": "高强度钢板"}, "materialType": {"type": "string", "display_name": "材料类型", "example": "原材料"}, "pendingReceiptQuantity": {"type": "number", "display_name": "待入库量", "example": 50}, "cumulativeStockQuantity": {"type": "number", "display_name": "累计库存量", "example": 200}, "availableStock": {"type": "number", "display_name": "可用库存", "example": 150}, "unit": {"type": "string", "display_name": "单位", "example": "吨"}}}}}
  ```
- **相关概念**: 原材料库存
- **调用MCP工具**: executeOntoBehavior，参数为行为名称和输入参数。

### QueryPurchaseRecords（查询原材料采购单信息）
- **类型**: 行为
- **描述**: 根据采购单/原材料/关联客单来查询采购记录列表。
- **输入参数**: 
  ```json
  {"purchaseRecordId": {"type": "string", "required": false, "example": "PO-20231027-001", "display_name": "采购单号"}, "rawMaterialId": {"type": "string", "required": false, "example": "RM-001", "display_name": "原材料编号"}, "rawMaterialName": {"type": "string", "required": false, "example": "高强度钢板", "display_name": "原材料名称"}}
  ```
- **输出结构**: 
  ```json
  {"code": {"type": "number", "example": 0}, "data": {"type": "array", "items": {"type": "object", "properties": {"purchaseRecordId": {"type": "string", "display_name": "采购单号", "example": "PO-20231027-001"}, "rawMaterialId": {"type": "string", "display_name": "原材料编号", "example": "RM-001"}, "rawMaterialName": {"type": "string", "display_name": "原材料名称", "example": "高强度钢板"}, "purchaseTime": {"type": "string", "display_name": "采购时间", "example": "2023-10-27"}, "arrivalTime": {"type": "string", "display_name": "到位时间", "example": "2023-11-10"}, "arrivalQuantity": {"type": "number", "display_name": "到位数量", "example": 50}, "unit": {"type": "string", "display_name": "单位", "example": "吨"}, "supplierName": {"type": "string", "display_name": "供应商名称", "example": "XX钢铁集团"}, "relatedOrderId": {"type": "string", "display_name": "关联订单编号", "example": "SO-20231025-001"}, "relatedOrderName": {"type": "string", "display_name": "关联订单名称", "example": "客户A-项目X订单"}, "leadTime": {"type": "number", "display_name": "等待周期", "example": 14}}}}}
  ```
- **相关概念**: 采购记录
- **调用MCP工具**: executeOntoBehavior，参数为行为名称和输入参数。

### QueryRawMaterials（查询原材料基本信息）
- **类型**: 行为
- **描述**: 根据原材料ID或名称查询原材料的基础信息。
- **输入参数**: 
  ```json
  {"rawMaterialId": {"type": "string", "required": false, "example": "RM-001", "display_name": "原材料编号"}, "rawMaterialName": {"type": "string", "required": false, "example": "高强度钢板", "display_name": "原材料名称"}}
  ```
- **输出结构**: 
  ```json
  {"code": {"type": "number", "example": 0}, "data": {"type": "array", "items": {"type": "object", "properties": {"rawMaterialId": {"type": "string", "display_name": "原材料编号", "example": "RM-001"}, "rawMaterialName": {"type": "string", "display_name": "原材料名称", "example": "高强度钢板"}, "unit": {"type": "string", "display_name": "单位", "example": "吨"}, "safetyStock": {"type": "number", "display_name": "安全库存", "example": 100}}}}}
  ```
- **相关概念**: 原材料
- **调用MCP工具**: executeOntoBehavior，参数为行为名称和输入参数。

### QuerySuppliers（查询供应商信息）
- **类型**: 行为
- **描述**: 根据供应商名或原材料名查询供应商。
- **输入参数**: 
  ```json
  {"supplierName": {"type": "string", "required": false, "example": "宝钢钢铁集团", "display_name": "供应商名称，模糊匹配"}, "rawMaterialName": {"type": "string", "required": false, "example": "钢板008", "display_name": "原材料名称"}}
  ```
- **输出结构**: 
  ```json
  {"code": {"type": "number", "example": 0}, "data": {"type": "array", "items": {"type": "object", "properties": {"supplierId": {"type": "string", "display_name": "供应商编号", "example": "SUP-001"}, "supplierName": {"type": "string", "display_name": "供应商名称", "example": "宝钢钢铁集团"}, "address": {"type": "string", "display_name": "地址", "example": "上海市宝山区富锦路888号"}, "contactPerson": {"type": "string", "display_name": "联系人", "example": "张经理"}, "contactPhone": {"type": "string", "display_name": "联系电话", "example": "13800131001"}}}}}
  ```
- **相关概念**: 供应商
- **调用MCP工具**: executeOntoBehavior，参数为行为名称和输入参数。

### QuerySupplierCapability（查询供应商供货能力）
- **类型**: 行为
- **描述**: 根据供应商名或原材料名，查询供应商供货能力。
- **输入参数**: 
  ```json
  {"supplierName": {"type": "string", "required": false, "example": "宝钢钢铁集团", "display_name": "供应商名称，模糊匹配"}, "rawMaterialName": {"type": "string", "required": false, "example": "钢板008", "display_name": "原材料名称"}}
  ```
- **输出结构**: 
  ```json
  {"code": {"type": "number", "example": 0}, "data": {"type": "array", "items": {"type": "object", "properties": {"supplierName": {"type": "string", "display_name": "供应商名称", "example": "宝钢钢铁集团"}, "rawMaterialId": {"type": "string", "display_name": "原材料ID", "example": "RM-001"}, "rawMaterialName": {"type": "string", "display_name": "原材料名称", "example": "高强度钢板"}, "leadTime": {"type": "number", "display_name": "交货周期", "example": 100}}}}}
  ```
- **相关概念**: 供应商、交货能力
- **调用MCP工具**: executeOntoBehavior，参数为行为名称和输入参数。

### QuerySupplierCapabilitySQL（查询供应商供货能力SQL）
- **类型**: 行为
- **描述**: 根据供应商名或原材料名，查询供应能力。
- **输入参数**: 
  ```json
  {"supplierName": {"type": "string", "required": true, "description": "", "example": "宝钢钢铁集团"}, "rawMaterialName": {"type": "string", "required": true, "description": "", "example": "钢板008"}}
  ```
- **输出结构**: 
  ```json
  {"data": {"type": "array", "items": {"type": "object", "properties": {"supplierName": {"type": "string", "display_name": "供应商名称", "example": "宝钢钢铁集团"}, "rawMaterialId": {"type": "string", "display_name": "原材料ID", "example": "RM-001"}, "rawMaterialName": {"type": "string", "display_name": "原材料名称", "example": "高强度钢板"}, "leadTime": {"type": "number", "display_name": "交货周期", "example": 100}}}}}
  ```
- **相关概念**: 供应商、交货能力
- **调用MCP工具**: executeOntoBehavior，参数为行为名称和输入参数。

## 5函数
【重点：函数的计算为实例化对象或对象集合，用于属性的计算和处理】

（函数介绍：包括英文名、中文名、计算逻辑、关联概念属性、输入参数（原封不动不修改）、返回结构（原封不动不修改）；每个函数需指明需要调用的接口MCP工具，智能体根据该工具的参数自动组装并调用该工具）

### sumRawNotArrivalQty（原材料未到位数）
- **计算逻辑**: 根据传入的数据包指定的原材料，过滤掉到位时间小于当前时间的部分，对剩余部分的到位数arrivalQuantity求和。
- **关联概念属性**: PurchaseRecord.rawMaterialName, PurchaseRecord.arrivalTime, PurchaseRecord.arrivalQuantity
- **输入参数**: 
  ```json
  {"filterRawMaterialName": {"type": "string", "display_name": "原材料名称", "example": "高强度钢板", "required": true}, "currentDate": {"type": "string", "display_name": "日期", "example": "2026-01-01", "required": true}, "purchaseRecordSet": {"type": "array", "display_name": "采购记录集", "items": {"type": "object", "properties": {"arrivalTime": {"type": "string", "display_name": "到位时间", "example": "2026-09-01", "required": true}, "rawMaterialName": {"type": "string", "display_name": "原材料名称", "example": "高强度钢板", "required": true}, "arrivalQuantity": {"type": "number", "display_name": "计划的到位数量", "example": 100, "required": true}}}, "required": true}}
  ```
- **返回结构**: 
  ```json
  {"result": {"type": "object", "properties": {"rawMaterialName": {"type": "string", "display_name": "原材料名称", "example": "高强度钢板"}, "sumNotArrivalQty": {"type": "number", "display_name": "未到位总量", "example": 100}}}}
  ```
- **调用MCP工具**: executeOntoFunction，参数为函数名称和输入参数。

## 6规则
【重点：规则主要用于对执行行为的前置和后置进行把控，每次智能体执行行为的时候，若有规则则必须判断，以确保整个行为的执行是合法可控的。例如：在行为执行前对输入参数进行校验，或者在行为执行后对输出结果进行校验以及推理等】

（规则介绍：包括规则英文名、中文名、规则类型、规则描述、规则介入位置、关联行为、关联函数、规则结构（从ontology中原封不动提取rule_detail，不要修改））

### V01_UnitConsistency_Purchase（采购-原料单位一致性）
- **规则类型**: 验证规则
- **规则描述**: 创建采购单时，输入的 unit 必须与关联原材料的 unit 一致。
- **规则介入位置**: 前置
- **关联行为**: CreatePurchaseRecord
- **关联函数**: 无
- **规则结构**: 
  ```json
  {"left": {"type": "concept", "concept": "PurchaseRecord", "attribute": "unit"}, "operator": "eq", "right": {"type": "concept", "concept": "RawMaterial", "attribute": "unit"}}
  ```

### V03_ArrivalTimeValidity（到位时间合理性）
- **规则类型**: 验证规则
- **规则描述**: 创建采购单时，输入的 arrivalTime 必须晚于 purchaseTime。
- **规则介入位置**: 前置
- **关联行为**: CreatePurchaseRecord
- **关联函数**: 无
- **规则结构**: 
  ```json
  {"left": {"type": "concept", "concept": "PurchaseRecord", "attribute": "arrivalTime"}, "operator": "gt", "right": {"type": "concept", "concept": "PurchaseRecord", "attribute": "purchaseTime"}}
  ```

### V04_RawMaterialExistence（采购-原料存在性）
- **规则类型**: 验证规则
- **规则描述**: 创建采购单时，提供的 rawMaterialId 必须与RawMaterial 概念中的rawMaterialId一致。
- **规则介入位置**: 前置
- **关联行为**: CreatePurchaseRecord
- **关联函数**: 无
- **规则结构**: 
  ```json
  {"left": {"type": "concept", "concept": "PurchaseRecord", "attribute": "rawMaterialId"}, "operator": "in", "right": {"type": "set", "concept": "RawMaterial", "attribute": "rawMaterialId"}}
  ```

### V05_SupplierExistence（采购-供应商存在性）
- **规则类型**: 验证规则
- **规则描述**: 创建采购单时，提供的 supplierName 必须与 Supplier 概念中suplierName的一致。
- **规则介入位置**: 前置
- **关联行为**: CreatePurchaseRecord
- **关联函数**: 无
- **规则结构**: 
  ```json
  {"left": {"type": "concept", "concept": "PurchaseRecord", "attribute": "supplierName"}, "operator": "in", "right": {"type": "set", "concept": "Supplier", "attribute": "supplierName", "value": "", "function": "", "returnField": ""}}
  ```

### I01_SafetyStockAlert（安全库存预警）
- **规则类型**: 推理规则
- **规则描述**: IF 可用库存availableStock < 原材料的safetyStock THEN 推送预警，建议创建采购单或关注库存。
- **规则介入位置**: 后置
- **关联行为**: QueryInventory, ReceiveRawMaterial
- **关联函数**: 无
- **规则结构**: 
  ```json
  {"if": {"logic": "and", "conditions": [{"left": {"type": "concept", "concept": "RawMaterialInventory", "attribute": "availableStock"}, "operator": "lt", "right": {"type": "concept", "concept": "RawMaterial", "attribute": "safetyStock"}}]}, "then": "可用库存低于安全库存，建议创建采购单或关注库存", "else": "库存正常，无需操作"}
  ```

### I02_ArrivalOverdueAlert（采购到位超期预警）
- **规则类型**: 推理规则
- **规则描述**: IF 当前日期 >= 采购单arrivalTime  THEN 提示用户是否启动入库操作。
- **规则介入位置**: 后置
- **关联行为**: QueryPurchaseRecords, CreatePurchaseRecord
- **关联函数**: 无
- **规则结构**: 
  ```json
  {"if": {"logic": "and", "conditions": [{"left": {"type": "function", "function": "getCurrentDate", "returnField": "date"}, "operator": "ge", "right": {"type": "concept", "concept": "PurchaseRecord", "attribute": "arrivalTime"}}]}, "then": "采购单已到位，建议启动入库操作", "else": "采购单尚未到位，无需操作"}
  ```

### I03_PurchasePurposeInference（采购目的推理）
- **规则类型**: 推理规则
- **规则描述**: IF 采购单relatedOrderId 为空 THEN 该采购目的可视为“补充库存”。
- **规则介入位置**: 后置
- **关联行为**: CreatePurchaseRecord
- **关联函数**: 无
- **规则结构**: 
  ```json
  {"if": {"logic": "and", "conditions": [{"left": {"type": "concept", "concept": "PurchaseRecord", "attribute": "relatedOrderId"}, "operator": "eq", "right": {"type": "value", "value": "\"\""}}]}, "then": "该采购单的采购目的可视为“补充库存”", "else": "该采购单有关联订单，采购目的可能为生产订单备料"}
  ```

### I04_RelatedOrderValidation（采购关联订单校验）
- **规则类型**: 推理规则
- **规则描述**: IF 采购单relatedOrderId不为空且不在 CustomerOrder 表中 (或状态为 已取消) THEN 提示用户该客户订单可能已失效，请确认是否取消该采购单。
- **规则介入位置**: 后置
- **关联行为**: CreatePurchaseRecord
- **关联函数**: 无
- **规则结构**: 
  ```json
  {"if": {"logic": "and", "conditions": [{"left": {"type": "concept", "concept": "PurchaseRecord", "attribute": "relatedOrderId"}, "operator": "ne", "right": {"type": "value", "value": "\"\""}}, {"left": {"type": "concept", "concept": "PurchaseRecord", "attribute": "relatedOrderId"}, "operator": "not in", "right": {"type": "set", "concept": "CustomerOrder", "attribute": "customerOrderId"}}]}, "then": "该采购单关联的客户订单可能已失效，请确认是否取消该采购单。", "else": "采购单关联的客户订单有效，无需操作。"}
  ```

## 7安全管控
【重点：安全管控的目的是对危险行为引入人工确认，介入位置可以在行为的执行前或执行后。介入时，智能体应该临时暂停后续操作，让用户对当前任务内容进行审核（具体内容请参考审核内容）】

（行为名称、介入位置、审核内容）

### CreatePurchaseRecord
- **介入位置**: 前置
- **审核内容**: 审核采购的必要性：检查库存是否确实需要补货，关联的客户订单是否真实有效，采购数量和到位时间是否合理。

### CancelPurchaseRecord
- **介入位置**: 前置
- **审核内容**: 审核取消的原因：确认取消采购单是否合理，是否已与供应商沟通，是否存在违约风险。

### ReceiveRawMaterial
- **介入位置**: 前置
- **审核内容**: 审核入库的准确性：确认到货的原材料、数量、供应商是否与采购单一致，质检是否已通过（如适用）。