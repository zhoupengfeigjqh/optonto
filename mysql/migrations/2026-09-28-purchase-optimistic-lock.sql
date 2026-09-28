-- 2026-09-28 采购单乐观锁版本列（章程 VI：并发操作必须考虑锁机制）
--
-- 适用场景：已有存量数据的数据库升级。
--   新建库无需执行——mysql/init/01-schema.sql 已包含该列。
--
-- 语义：Hibernate @Version 字段。并发修改同一采购单时，后提交的事务因版本不匹配失败，
--   由 GlobalExceptionHandler 转为 HTTP 409，避免「读到同一份旧状态各自保存」导致的状态覆盖。
--
-- 注意：MySQL 不支持 ADD COLUMN IF NOT EXISTS，本文件为一次性迁移；
--   重复执行会报 "Duplicate column name"，属预期。

USE onto_material;

ALTER TABLE purchase_record
    ADD COLUMN version BIGINT NOT NULL DEFAULT 0;
