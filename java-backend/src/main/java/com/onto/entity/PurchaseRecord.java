package com.onto.entity;

import jakarta.persistence.*;
import java.time.LocalDate;
import java.time.LocalDateTime;

@Entity
@Table(name = "purchase_record")
public class PurchaseRecord {
    @Id
    @Column(name = "purchase_order_id", length = 64)
    private String purchaseOrderId;

    @Column(name = "raw_material_id", length = 64, nullable = false)
    private String rawMaterialId;

    @Column(name = "raw_material_name", length = 128, nullable = false)
    private String rawMaterialName;

    @Column(length = 32, nullable = false)
    private String unit;

    @Column(name = "purchase_time", nullable = false)
    private LocalDate purchaseTime;

    @Column(name = "arrival_time", nullable = false)
    private LocalDate arrivalTime;

    @Column(name = "arrival_quantity", nullable = false)
    private Integer arrivalQuantity;

    @Column(name = "supplier_name", length = 128, nullable = false)
    private String supplierName;

    @Column(name = "related_order_id", length = 64)
    private String relatedOrderId;

    @Column(name = "related_order_name", length = 128)
    private String relatedOrderName;

    @Column(length = 16, nullable = false)
    private String status = "待入库";

    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    public PurchaseRecord() {}

    @PrePersist
    protected void onCreate() {
        LocalDateTime now = LocalDateTime.now();
        this.createdAt = now;
        this.updatedAt = now;
    }

    @PreUpdate
    protected void onUpdate() {
        this.updatedAt = LocalDateTime.now();
    }

    public String getPurchaseOrderId() { return purchaseOrderId; }
    public void setPurchaseOrderId(String v) { this.purchaseOrderId = v; }
    public String getRawMaterialId() { return rawMaterialId; }
    public void setRawMaterialId(String v) { this.rawMaterialId = v; }
    public String getRawMaterialName() { return rawMaterialName; }
    public void setRawMaterialName(String v) { this.rawMaterialName = v; }
    public String getUnit() { return unit; }
    public void setUnit(String v) { this.unit = v; }
    public LocalDate getPurchaseTime() { return purchaseTime; }
    public void setPurchaseTime(LocalDate v) { this.purchaseTime = v; }
    public LocalDate getArrivalTime() { return arrivalTime; }
    public void setArrivalTime(LocalDate v) { this.arrivalTime = v; }
    public Integer getArrivalQuantity() { return arrivalQuantity; }
    public void setArrivalQuantity(Integer v) { this.arrivalQuantity = v; }
    public String getSupplierName() { return supplierName; }
    public void setSupplierName(String v) { this.supplierName = v; }
    public String getRelatedOrderId() { return relatedOrderId; }
    public void setRelatedOrderId(String v) { this.relatedOrderId = v; }
    public String getRelatedOrderName() { return relatedOrderName; }
    public void setRelatedOrderName(String v) { this.relatedOrderName = v; }
    public String getStatus() { return status; }
    public void setStatus(String v) { this.status = v; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public LocalDateTime getUpdatedAt() { return updatedAt; }
}
