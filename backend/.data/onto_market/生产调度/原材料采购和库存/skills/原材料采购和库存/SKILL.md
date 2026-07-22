好的，作为一名专业的智能体技能生成专家，我将根据您提供的本体数据和技能模板，为您生成一份完整的技能文件。

---

---
name: 原材料库存和采购本体
description: 该技能提供了原材料、原材料库存以及原材料采购的相关信息与操作能力。核心业务逻辑围绕原材料的采购、入库、库存管理展开。当用户意图涉及查询原材料信息、供应商信息、库存状态、采购记录，或执行创建/取消采购单、入库等操作时，请读取该文件以理解业务概念、关系、规则和行为，从而进行准确的意图识别、任务规划和行为执行。重点包括：通过查询库存和供应商能力来辅助采购决策；通过执行规则（如安全库存预警、到位超期预警）来驱动后续操作；通过安全管控节点确保关键操作（如创建采购单）的合规性。
---

# 原材料库存和采购本体技能

## 1简介
该技能聚焦于生产调度中的原材料采购与库存管理环节。它定义了原材料、供应商、采购记录、库存、客户订单和交货能力等核心概念及其相互关系，并提供了从采购创建、入库到库存查询、预警等一系列行为与规则，旨在帮助智能体理解并执行与原材料供应链相关的任务。

## 2概念与关系
**概念：**
- 原材料
- 供应商
- 原材料采购记录
- 原材料库存
- 客户订单
- 交货能力

**关系：**
- 原材料 拥有 原材料库存 (1:1)
- 原材料采购记录 记录 原材料 (N:1)
- 原材料采购记录 从 供应商 订购 (N:1)
- 供应商 供应 原材料 (N:M)
- 客户订单 包含 原材料采购记录 (1:N)
- 供应商 拥有 交货能力 (1:N)

**概念属性：**
- 原材料：原材料编号、原材料名称、单位、安全库存
- 供应商：供应商编号、供应商名称、地址、联系人、联系电话
- 原材料采购记录：采购单号、原材料编号、原材料名称、采购时间、到位时间、到位数量、单位、等待周期、供应商名称、关联订单编号、关联订单名称
- 原材料库存：库存编号、原材料编号、原材料名称、材料类型、待入库量、累计库存量、可用库存、单位
- 客户订单：客户订单编号、客户订单名称、批次号、缓冲期、订单类型、状态
- 交货能力：原材料编号、原材料名称、供应商名称、供应商编号、交货周期、最小起订量

## 3行为
### CreatePurchaseRecord（创建原材料采购单）
- **行为描述**：创建一笔新的原材料采购记录。
- **输入参数**：
    - `rawMaterialId` (string, required): 原材料编号，示例: "RM-001"
    - `rawMaterialName` (string, required): 原材料名称，示例: "高强度钢板"
    - `arrivalQuantity` (number, required): 到位数量，示例: 50
    - `supplierName` (string, required): 供应商名称，示例: "XX钢铁集团"
    - `arrivalTime` (string, required): 到位时间，示例: "2023-11-10"
    - `relatedOrderId` (string, required): 关联订单编号，示例: "SO-20231025-001"
    - `relatedOrderName` (string, required): 关联订单名称，示例: "客户A-项目X订单"
    - `unit` (string, required): 单位，示例: "吨"
- **输出结构**：
    ```json
    {
      "code": 0,
      "data": {
        "purchaseRecordId": "PO-20231027-001",
        "rawMaterialId": "RM-001",
        "rawMaterialName": "高强度钢板",
        "purchaseTime": "2023-10-27",
        "arrivalTime": "2023-11-10",
        "arrivalQuantity": 50,
        "unit": "吨",
        "supplierName": "XX钢铁集团",
        "relatedOrderId": "SO-20231025-001",
        "relatedOrderName": "客户A-项目X订单",
        "leadTime": 14,
        "status": "待入库"
      }
    }
    ```
- **相关概念**：原材料、供应商、原材料采购记录、客户订单
- **调用工具**：`executeOntoBehavior`，参数为行为名称和输入参数。

### CancelPurchaseRecord（取消原材料采购单）
- **行为描述**：取消一笔已创建但尚未入库的采购记录。
- **输入参数**：
    - `purchaseRecordId` (string, required): 采购单号，示例: "PO-20231027-001"
- **输出结构**：
    ```json
    {
      "code": 0,
      "data": {
        "purchaseRecordId": "PO-20231027-001",
        "rawMaterialId": "CRX001",
        "rawMaterialName": "高强度钢板"
      }
    }
    ```
- **相关概念**：原材料采购记录
- **调用工具**：`executeOntoBehavior`，参数为行为名称和输入参数。

### ReceiveRawMaterial（入库原材料）
- **行为描述**：将原材料采购入库。
- **输入参数**：
    - `purchaseRecordId` (string, required): 采购单号，示例: "PO-20231027-001"
- **输出结构**：
    ```json
    {
      "code": 0,
      "data": {
        "purchaseRecordId": "PO-20231027-001",
        "rawMaterialId": "CRX001",
        "rawMaterialName": "高强度钢板"
      }
    }
    ```
- **相关概念**：原材料采购记录、原材料库存
- **调用工具**：`executeOntoBehavior`，参数为行为名称和输入参数。

### QueryInventory（查询原材料库存信息）
- **行为描述**：根据原材料ID或名称查询其最新的库存快照。
- **输入参数**：
    - `rawMaterialId` (string, required): 原材料编号，示例: "RM-001"
    - `rawMaterialName` (string, required): 原材料名称，示例: "高强度钢板"
- **输出结构**：
    ```json
    {
      "code": 0,
      "data": [
        {
          "inventoryId": "INV-RM-001",
          "rawMaterialId": "RM-001",
          "rawMaterialName": "高强度钢板",
          "materialType": "原材料",
          "pendingReceiptQuantity": 50,
          "cumulativeStockQuantity": 200,
          "availableStock": 150,
          "unit": "吨"
        }
      ]
    }
    ```
- **相关概念**：原材料库存、原材料
- **调用工具**：`executeOntoBehavior`，参数为行为名称和输入参数。

### QueryPurchaseRecords（查询原材料采购单信息）
- **行为描述**：根据采购单/原材料/关联客单来查询采购记录列表。
- **输入参数**：
    - `purchaseRecordId` (string, required): 采购单号，示例: "PO-20231027-001"
    - `rawMaterialId` (string, required): 原材料编号，示例: "RM-001"
    - `rawMaterialName` (string, required): 原材料名称，示例: "高强度钢板"
- **输出结构**：
    ```json
    {
      "code": 0,
      "data": [
        {
          "purchaseRecordId": "PO-20231027-001",
          "rawMaterialId": "RM-001",
          "rawMaterialName": "高强度钢板",
          "purchaseTime": "2023-10-27",
          "arrivalTime": "2023-11-10",
          "arrivalQuantity": 50,
          "unit": "吨",
          "supplierName": "XX钢铁集团",
          "relatedOrderId": "SO-20231025-001",
          "relatedOrderName": "客户A-项目X订单",
          "leadTime": 14
        }
      ]
    }
    ```
- **相关概念**：原材料采购记录、原材料、客户订单
- **调用工具**：`executeOntoBehavior`，参数为行为名称和输入参数。

### QueryRawMaterials（查询原材料基本信息）
- **行为描述**：根据原材料ID或名称查询原材料的基础信息。
- **输入参数**：
    - `rawMaterialId` (string, required): 原材料编号，示例: "RM-001"
    - `rawMaterialName` (string, required): 原材料名称，示例: "高强度钢板"
- **输出结构**：
    ```json
    {
      "code": 0,
      "data": [
        {
          "rawMaterialId": "RM-001",
          "rawMaterialName": "高强度钢板",
          "unit": "吨",
          "safetyStock": 100
        }
      ]
    }
    ```
- **相关概念**：原材料
- **调用工具**：`executeOntoBehavior`，参数为行为名称和输入参数。

### QuerySuppliers（查询供应商信息）
- **行为描述**：根据供应商名或原材料名查询供应商。
- **输入参数**：
    - `supplierName` (string, optional): 供应商名称，模糊匹配，示例: "宝钢钢铁集团"
    - `rawMaterialName` (string, optional): 原材料名称，示例: "钢板008"
- **输出结构**：
    ```json
    {
      "code": 0,
      "data": [
        {
          "supplierId": "SUP-001",
          "supplierName": "宝钢钢铁集团",
          "address": "上海市宝山区富锦路888号",
          "contactPerson": "张经理",
          "contactPhone": "13800131001"
        }
      ]
    }
    ```
- **相关概念**：供应商、原材料
- **调用工具**：`executeOntoBehavior`，参数为行为名称和输入参数。

### QuerySupplierCapability（查询供应商供货能力）
- **行为描述**：根据供应商名或原材料名，查询供应商供货能力。
- **输入参数**：
    - `supplierName` (string, optional): 供应商名称，模糊匹配，示例: "宝钢钢铁集团"
    - `rawMaterialName` (string, optional): 原材料名称，示例: "钢板008"
- **输出结构**：
    ```json
    {
      "code": 0,
      "data": [
        {
          "supplierName": "宝钢钢铁集团",
          "rawMaterialId": "RM-001",
          "rawMaterialName": "高强度钢板",
          "leadTime": 100
        }
      ]
    }
    ```
- **相关概念**：交货能力、供应商、原材料
- **调用工具**：`executeOntoBehavior`，参数为行为名称和输入参数。

## 4函数
### sumRawNotArrivalQty（原材料未到位数）
- **计算逻辑**：根据传入的数据包指定的原材料，过滤掉到位时间小于当前时间的部分，对剩余部分的到位数arrivalQuantity求和。
- **关联概念属性**：原材料采购记录（rawMaterialName, arrivalTime, arrivalQuantity）
- **输入参数**：
    - `filterRawMaterialName` (string, required): 原材料名称，示例: "高强度钢板"
    - `currentDate` (string, required): 日期，示例: "2026-01-01"
    - `purchaseRecordSet` (array, required): 采购记录集合，每个元素包含 `arrivalTime`, `rawMaterialName`, `arrivalQuantity`。
- **返回结构**：
    ```json
    {
      "result": {
        "rawMaterialName": "高强度钢板",
        "sumNotArrivalQty": 100
      }
    }
    ```
- **调用工具**：`executeOntoFunction`，参数为函数名称和输入参数。

## 5规则
### V01_UnitConsistency_Purchase（采购-原料单位一致性）
- **规则类型**：验证规则
- **规则描述**：创建采购单时，输入的 unit 必须与关联原材料的 unit 一致。
- **规则介入位置**：前置
- **关联行为**：CreatePurchaseRecord
- **关联函数**：无
- **规则详情**：创建采购单时，输入的 unit 必须与关联原材料的 unit 一致。

### V03_ArrivalTimeValidity（到位时间合理性）
- **规则类型**：验证规则
- **规则描述**：创建采购单时，输入的 arrivalTime 必须晚于 purchaseTime。
- **规则介入位置**：前置
- **关联行为**：CreatePurchaseRecord
- **关联函数**：无
- **规则详情**：创建采购单时，输入的 arrivalTime 必须晚于 purchaseTime。

### V04_RawMaterialExistence（采购-原料存在性）
- **规则类型**：验证规则
- **规则描述**：创建采购单时，提供的 rawMaterialId 必须与RawMaterial 概念中的rawMaterialId一致。
- **规则介入位置**：前置
- **关联行为**：CreatePurchaseRecord
- **关联函数**：无
- **规则详情**：创建采购单时，提供的 rawMaterialId 必须与RawMaterial 概念中的rawMaterialId一致。

### V05_SupplierExistence（采购-供应商存在性）
- **规则类型**：验证规则
- **规则描述**：创建采购单时，提供的 supplierName 必须与 Supplier 概念中suplierName的一致。
- **规则介入位置**：前置
- **关联行为**：CreatePurchaseRecord
- **关联函数**：无
- **规则详情**：创建采购单时，提供的 supplierName 必须与 Supplier 概念中suplierName的一致。

### I01_SafetyStockAlert（安全库存预警）
- **规则类型**：推理规则
- **规则描述**：IF 可用库存availableStock < 原材料的safetyStock THEN 推送预警，建议创建采购单或关注库存。
- **规则介入位置**：后置
- **关联行为**：QueryInventory, ReceiveRawMaterial
- **关联函数**：无
- **规则详情**：IF 可用库存availableStock < 原材料的safetyStock THEN 推送预警，建议创建采购单或关注库存。

### I02_ArrivalOverdueAlert（采购到位超期预警）
- **规则类型**：推理规则
- **规则描述**：IF 当前日期 >= 采购单arrivalTime THEN 提示用户是否启动入库操作。
- **规则介入位置**：后置
- **关联行为**：QueryPurchaseRecords
- **关联函数**：无
- **规则详情**：IF 当前日期 >= 采购单arrivalTime THEN 提示用户是否启动入库操作。

### I03_PurchasePurposeInference（采购目的推理）
- **规则类型**：推理规则
- **规则描述**：IF 采购单relatedOrderId 为空 THEN 该采购目的可视为“补充库存”。
- **规则介入位置**：后置
- **关联行为**：CreatePurchaseRecord
- **关联函数**：无
- **规则详情**：IF 采购单relatedOrderId 为空 THEN 该采购目的可视为“补充库存”。

### I04_RelatedOrderValidation（采购关联订单校验）
- **规则类型**：推理规则
- **规则描述**：IF 采购单relatedOrderId不为空且不在 CustomerOrder 表中 (或状态为 已取消) THEN 提示用户该客户订单可能已失效，请确认是否取消该采购单。
- **规则介入位置**：后置
- **关联行为**：CreatePurchaseRecord
- **关联函数**：无
- **规则详情**：IF 采购单relatedOrderId不为空且不在 CustomerOrder 表中 (或状态为 已取消) THEN 提示用户该客户订单可能已失效，请确认是否取消该采购单。

## 6安全管控
- **行为名称**：CreatePurchaseRecord
- **介入位置**：前置
- **审核内容**：审核采购的必要性：检查库存是否确实需要补货，关联的客户订单是否真实有效，采购数量和到位时间是否合理。

- **行为名称**：CancelPurchaseRecord
- **介入位置**：前置
- **审核内容**：审核取消的原因：确认取消采购单是否合理，是否已与供应商沟通，是否存在违约风险。

- **行为名称**：ReceiveRawMaterial
- **介入位置**：前置
- **审核内容**：审核入库的准确性：确认到货的原材料、数量、供应商是否与采购单一致，质检是否已通过（如适用）。