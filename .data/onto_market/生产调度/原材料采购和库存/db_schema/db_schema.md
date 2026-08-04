# 原材料采购和库存 - 数据库 Schema

## raw_material（原材料表）

| 字段名 | 类型 | 说明 |
|---|---|---|
| id | BIGINT | 自增主键 |
| raw_material_id | VARCHAR(64) | 原材料编号，唯一 |
| raw_material_name | VARCHAR(128) | 原材料名称 |
| unit | VARCHAR(32) | 单位 |
| safety_stock | INT | 安全库存 |
| created_at | DATETIME | 创建时间 |
| updated_at | DATETIME | 更新时间 |

## supplier（供应商表）

| 字段名 | 类型 | 说明 |
|---|---|---|
| id | BIGINT | 自增主键 |
| supplier_name | VARCHAR(128) | 供应商名称 |
| address | VARCHAR(256) | 地址 |
| contact_person | VARCHAR(64) | 联系人 |
| contact_phone | VARCHAR(32) | 联系电话 |
| raw_material_id | VARCHAR(64) | 可供应的原材料编号 |
| raw_material_name | VARCHAR(128) | 可供应的原材料名称 |
| lead_time | INT | 交货周期（天） |
| created_at | DATETIME | 创建时间 |
| updated_at | DATETIME | 更新时间 |

## supplier_raw_material（供应商-原材料关联表）

| 字段名 | 类型 | 说明 |
|---|---|---|
| id | BIGINT | 自增主键 |
| supplier_name | VARCHAR(128) | 供应商名称 |
| raw_material_id | VARCHAR(64) | 原材料编号 |
| UNIQUE KEY | (supplier_name, raw_material_id) | 联合唯一索引 |

## customer_order（客户订单表）

| 字段名 | 类型 | 说明 |
|---|---|---|
| id | BIGINT | 自增主键 |
| order_id | VARCHAR(64) | 订单编号 |
| order_name | VARCHAR(128) | 订单名称 |
| batch_number | VARCHAR(64) | 批次号 |
| buffer_period | INT | 缓冲期（天） |
| order_type | VARCHAR(32) | 订单类型 |
| created_at | DATETIME | 创建时间 |
| updated_at | DATETIME | 更新时间 |

## purchase_record（采购记录表）

| 字段名 | 类型 | 说明 |
|---|---|---|
| id | BIGINT | 自增主键 |
| purchase_order_id | VARCHAR(64) | 采购单号 |
| raw_material_id | VARCHAR(64) | 原材料编号 |
| raw_material_name | VARCHAR(128) | 原材料名称 |
| unit | VARCHAR(32) | 单位 |
| purchase_time | DATE | 采购日期 |
| arrival_time | DATE | 预计到位日期 |
| arrival_quantity | INT | 采购数量 |
| supplier_name | VARCHAR(128) | 供应商名称 |
| related_order_id | VARCHAR(64) | 关联客户订单编号 |
| related_order_name | VARCHAR(128) | 关联客户订单名称 |
| status | VARCHAR(16) | 状态（待入库/已入库/已取消） |
| created_at | DATETIME | 创建时间 |
| updated_at | DATETIME | 更新时间 |

## inventory（库存表）

| 字段名 | 类型 | 说明 |
|---|---|---|
| id | BIGINT | 自增主键 |
| raw_material_id | VARCHAR(64) | 原材料编号 |
| raw_material_name | VARCHAR(128) | 原材料名称 |
| unit | VARCHAR(32) | 单位 |
| pending_receipt_quantity | INT | 待入库数量 |
| cumulative_stock_quantity | INT | 累计库存量 |
| available_quantity | INT | 可用库存量 |
| consumed_quantity | INT | 已消耗量 |
| created_at | DATETIME | 创建时间 |
| updated_at | DATETIME | 更新时间 |
