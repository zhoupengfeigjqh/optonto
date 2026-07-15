CREATE DATABASE IF NOT EXISTS onto_material
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE onto_material;

-- 原材料
CREATE TABLE raw_material (
    raw_material_id   VARCHAR(64)  PRIMARY KEY,
    raw_material_name VARCHAR(128) NOT NULL,
    unit              VARCHAR(32)  NOT NULL,
    safety_stock      INT          NOT NULL DEFAULT 0,
    created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- 供应商
CREATE TABLE supplier (
    supplier_name  VARCHAR(128) PRIMARY KEY,
    address        VARCHAR(256),
    contact_person VARCHAR(64),
    contact_phone  VARCHAR(32),
    raw_material_id   VARCHAR(64),
    raw_material_name VARCHAR(128),
    lead_time      INT NOT NULL,
    created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- 供应商-原材料 N:M 关联表
CREATE TABLE supplier_raw_material (
    id              BIGINT       AUTO_INCREMENT PRIMARY KEY,
    supplier_name   VARCHAR(128) NOT NULL,
    raw_material_id VARCHAR(64)  NOT NULL,
    FOREIGN KEY (supplier_name)   REFERENCES supplier(supplier_name),
    FOREIGN KEY (raw_material_id) REFERENCES raw_material(raw_material_id),
    UNIQUE KEY uk_supplier_material (supplier_name, raw_material_id)
) ENGINE=InnoDB;

-- 客户订单
CREATE TABLE customer_order (
    order_id      VARCHAR(64)  PRIMARY KEY,
    order_name    VARCHAR(128) NOT NULL,
    batch_number  VARCHAR(64),
    buffer_period INT          NOT NULL,
    order_type    VARCHAR(32)  NOT NULL,
    created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- 采购记录
CREATE TABLE purchase_record (
    purchase_order_id VARCHAR(64)  PRIMARY KEY,
    raw_material_id   VARCHAR(64)  NOT NULL,
    raw_material_name VARCHAR(128) NOT NULL,
    unit              VARCHAR(32)  NOT NULL,
    purchase_time     DATE         NOT NULL,
    arrival_time      DATE         NOT NULL,
    arrival_quantity  INT          NOT NULL,
    supplier_name     VARCHAR(128) NOT NULL,
    related_order_id  VARCHAR(64),
    related_order_name VARCHAR(128),
    status            VARCHAR(16)  NOT NULL DEFAULT '待入库',
    created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (raw_material_id)  REFERENCES raw_material(raw_material_id),
    FOREIGN KEY (supplier_name)    REFERENCES supplier(supplier_name),
    FOREIGN KEY (related_order_id) REFERENCES customer_order(order_id)
) ENGINE=InnoDB;

-- 库存 (1:1 with raw_material)
CREATE TABLE inventory (
    raw_material_id             VARCHAR(64) PRIMARY KEY,
    raw_material_name           VARCHAR(128) NOT NULL,
    unit                        VARCHAR(32)  NOT NULL,
    pending_receipt_quantity    INT NOT NULL DEFAULT 0,
    cumulative_stock_quantity   INT NOT NULL DEFAULT 0,
    available_quantity          INT NOT NULL DEFAULT 0,
    consumed_quantity           INT NOT NULL DEFAULT 0,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (raw_material_id) REFERENCES raw_material(raw_material_id)
) ENGINE=InnoDB;
