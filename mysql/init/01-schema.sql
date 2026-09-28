CREATE DATABASE IF NOT EXISTS onto_material
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE onto_material;

-- 原材料
-- 索引说明（章程 V：查询必须有索引支撑）：raw_material_id 为业务唯一键（等值查询）；
-- raw_material_name 为等值/LIKE 前缀查询列。注意 LIKE '%x%' 前缀通配无法命中 B-Tree 索引。
CREATE TABLE raw_material (
    id                BIGINT       AUTO_INCREMENT PRIMARY KEY,
    raw_material_id   VARCHAR(64)  NOT NULL,
    raw_material_name VARCHAR(128) NOT NULL,
    unit              VARCHAR(32)  NOT NULL,
    safety_stock      INT          NOT NULL DEFAULT 0,
    created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_raw_material_id (raw_material_id),
    KEY idx_raw_material_name (raw_material_name)
) ENGINE=InnoDB;

-- 供应商
CREATE TABLE supplier (
    id                BIGINT       AUTO_INCREMENT PRIMARY KEY,
    supplier_name     VARCHAR(128) NOT NULL,
    address           VARCHAR(256),
    contact_person    VARCHAR(64),
    contact_phone     VARCHAR(32),
    raw_material_id   VARCHAR(64),
    raw_material_name VARCHAR(128),
    lead_time         INT NOT NULL,
    created_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    KEY idx_supplier_name (supplier_name),
    KEY idx_supplier_rm_name (raw_material_name)
) ENGINE=InnoDB;

-- 供应商-原材料 N:M 关联表
CREATE TABLE supplier_raw_material (
    id              BIGINT       AUTO_INCREMENT PRIMARY KEY,
    supplier_name   VARCHAR(128) NOT NULL,
    raw_material_id VARCHAR(64)  NOT NULL,
    UNIQUE KEY uk_supplier_material (supplier_name, raw_material_id)
) ENGINE=InnoDB;

-- 客户订单
CREATE TABLE customer_order (
    id            BIGINT       AUTO_INCREMENT PRIMARY KEY,
    order_id      VARCHAR(64)  NOT NULL,
    order_name    VARCHAR(128) NOT NULL,
    batch_number  VARCHAR(64),
    buffer_period INT          NOT NULL,
    order_type    VARCHAR(32)  NOT NULL,
    created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_order_id (order_id),
    KEY idx_order_name (order_name)
) ENGINE=InnoDB;

-- 采购记录
-- uk_purchase_order_id 是单号并发生成的兜底（章程 VI：并发必须考虑锁机制）：
-- 服务层用「唯一键 + 冲突重试」的乐观策略，避免 count()+1 在并发下产生重复单号。
CREATE TABLE purchase_record (
    id                 BIGINT       AUTO_INCREMENT PRIMARY KEY,
    purchase_order_id  VARCHAR(64)  NOT NULL,
    raw_material_id    VARCHAR(64)  NOT NULL,
    raw_material_name  VARCHAR(128) NOT NULL,
    unit               VARCHAR(32)  NOT NULL,
    purchase_time      DATE         NOT NULL,
    arrival_time       DATE         NOT NULL,
    arrival_quantity   INT          NOT NULL,
    supplier_name      VARCHAR(128) NOT NULL,
    related_order_id   VARCHAR(64),
    related_order_name VARCHAR(128),
    status             VARCHAR(16)  NOT NULL DEFAULT '待入库',
    created_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    -- 乐观锁版本号（章程 VI：并发操作必须考虑锁机制）：并发改状态时后提交者冲突失败，避免丢失更新
    version            BIGINT       NOT NULL DEFAULT 0,
    UNIQUE KEY uk_purchase_order_id (purchase_order_id),
    KEY idx_pr_raw_material_id (raw_material_id),
    KEY idx_pr_raw_material_name (raw_material_name),
    KEY idx_pr_related_order_id (related_order_id),
    KEY idx_pr_status (status)
) ENGINE=InnoDB;

-- 库存 (1:1 with raw_material)
CREATE TABLE inventory (
    id                        BIGINT       AUTO_INCREMENT PRIMARY KEY,
    raw_material_id           VARCHAR(64)  NOT NULL,
    raw_material_name         VARCHAR(128) NOT NULL,
    unit                      VARCHAR(32)  NOT NULL,
    pending_receipt_quantity  INT NOT NULL DEFAULT 0,
    cumulative_stock_quantity INT NOT NULL DEFAULT 0,
    available_quantity        INT NOT NULL DEFAULT 0,
    consumed_quantity         INT NOT NULL DEFAULT 0,
    created_at                DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at                DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_inv_raw_material_id (raw_material_id),
    KEY idx_inv_raw_material_name (raw_material_name)
) ENGINE=InnoDB;
