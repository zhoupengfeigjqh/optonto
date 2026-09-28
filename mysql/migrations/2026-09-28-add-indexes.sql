-- 2026-09-28 补齐业务查询索引与并发唯一键（章程 V 性能 / VI 数据一致性）
--
-- 适用场景：已有存量数据的数据库升级。
--   新建库无需执行——mysql/init/01-schema.sql 已直接包含下述索引与唯一键。
--
-- 注意：MySQL 不支持 ADD INDEX IF NOT EXISTS，本文件为一次性迁移；
--   重复执行会报 "Duplicate key name"，属预期（可用 SHOW INDEX FROM <table> 先核对）。
--
-- 索引设计说明：
--   - 等值查询列（raw_material_id / order_id / related_order_id / status）建普通或唯一索引，可命中；
--   - LIKE '%x%' 前缀通配列（*_name）即使建索引也无法命中，索引仅对等值/前缀查询生效，
--     后续如需模糊检索请改前缀匹配或引入全文索引。

USE onto_material;

-- 原材料：raw_material_id 为业务唯一键
ALTER TABLE raw_material
    ADD UNIQUE KEY uk_raw_material_id (raw_material_id),
    ADD KEY idx_raw_material_name (raw_material_name);

-- 供应商：按名称/原材料名过滤
ALTER TABLE supplier
    ADD KEY idx_supplier_name (supplier_name),
    ADD KEY idx_supplier_rm_name (raw_material_name);

-- 客户订单：order_id 为业务唯一键
ALTER TABLE customer_order
    ADD UNIQUE KEY uk_order_id (order_id),
    ADD KEY idx_order_name (order_name);

-- 采购记录：单号唯一（并发生成的兜底）+ 过滤列索引
ALTER TABLE purchase_record
    ADD UNIQUE KEY uk_purchase_order_id (purchase_order_id),
    ADD KEY idx_pr_raw_material_id (raw_material_id),
    ADD KEY idx_pr_raw_material_name (raw_material_name),
    ADD KEY idx_pr_related_order_id (related_order_id),
    ADD KEY idx_pr_status (status);

-- 库存：与原材料 1:1
ALTER TABLE inventory
    ADD UNIQUE KEY uk_inv_raw_material_id (raw_material_id),
    ADD KEY idx_inv_raw_material_name (raw_material_name);
