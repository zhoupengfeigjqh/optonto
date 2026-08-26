---
name: skill name（必须是英文）
description: 技能描述
---

# 原材料库存和采购本体技能

## 0 本体基本信息
本体名称（ontology_name）: 原材料采购和库存
本体id（ontology_id）: 1
场景名称（scenario_name）: 生产调度
场景id（scenario_id）: 1

## 1 概念详情
【重点：特别注意，概念-属性-关系代表着该领域的最基本业务逻辑，智能体的任务生成和执行都必须从该网络出发展开】

（以表格列出全部概念：概念名（英文）、展示名称（中文）、概念描述。所有内容原封不动来自本体数据，不要自行编造或增删）

| 概念名 | 展示名称 | 概念描述 |
|---|---|---|
| RawMaterial | 原材料 | 表示企业生产所需的各类原材料 |
| Supplier | 供应商 | 为企业提供原材料的供应商主体 |

## 2 概念间的关系

（先以表格列出全部关系：关系名（英文）、展示名称（中文）、源概念 → 目标概念、基数、关联字段、关系说明。关联字段格式为「源概念.属性 = 目标概念.属性」，未填写的显示为 -。表格之后用一段话说明整个关系体系的业务逻辑（以哪些概念为核心、如何串联）。所有内容原封不动来自本体数据，关系体系逻辑可基于表格内容归纳）

| 关系名 | 展示名称 | 源概念 → 目标概念 | 基数 | 关联字段 | 关系说明 |
|---|---|---|---|---|---|
| hasRawInventory | 拥有库存 | RawMaterial → RawMaterialInventory | 1:1 | RawMaterial.rawMaterialId = RawMaterialInventory.rawMaterialId | 一种原材料对应一条库存记录 |
| orderedFromSupplier | 向供应商采购 | PurchaseRecord → Supplier | N:1 | PurchaseRecord.supplierName = Supplier.supplierName | 多条采购记录可对应同一供应商 |

（关系体系逻辑说明：以 XXX 为核心，通过 XXX 将 XXX 串联起来，形成……的完整业务逻辑链条）

## 3 概念属性及约束

（按概念分组，每组以表格列出该概念的全部属性：属性名（英文）、展示名称（中文）、类型、约束。约束列只写非空约束，格式为「唯一；必填；枚举=[值1,值2]；模式=正则；范围=最小~最大」的组合，无约束填 -。所有内容原封不动来自本体数据，不要自行编造约束）

**原材料（RawMaterial）**

| 属性名 | 展示名称 | 类型 | 约束 |
|---|---|---|---|
| rawMaterialId | 原材料编号 | string | 唯一；必填 |
| safetyStock | 安全库存 | number | 范围=0~+∞ |
| unit | 单位 | string | - |

**供应商（Supplier）**

| 属性名 | 展示名称 | 类型 | 约束 |
|---|---|---|---|
| supplierId | 供应商编号 | string | 唯一；必填 |

## 4 重要业务流程
【重点：重点业务流程，用于任务执行逻辑的参考，注意这里不是该流程是唯一固定的】

（原材料库存和采购的核心业务流程）

## 5 行为

（行为介绍：包括行为英文名、中文名、类型、行为描述、输入参数（原封不动不修改）、输出结构（原封不动不修改）、相关概念（中文描述）；每个行为需指明需要调用的接口MCP工具，智能体根据该工具的参数自动组装并调用该工具）

例子如下：
### 5.1 QuerySuppliers
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
