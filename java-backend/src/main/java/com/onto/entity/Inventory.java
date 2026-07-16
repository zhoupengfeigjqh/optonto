package com.onto.entity;

import jakarta.persistence.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "inventory")
public class Inventory {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "raw_material_id", length = 64)
    private String rawMaterialId;

    @Column(name = "raw_material_name", length = 128, nullable = false)
    private String rawMaterialName;

    @Column(length = 32, nullable = false)
    private String unit;

    @Column(name = "pending_receipt_quantity", nullable = false)
    private Integer pendingReceiptQuantity = 0;

    @Column(name = "cumulative_stock_quantity", nullable = false)
    private Integer cumulativeStockQuantity = 0;

    @Column(name = "available_quantity", nullable = false)
    private Integer availableQuantity = 0;

    @Column(name = "consumed_quantity", nullable = false)
    private Integer consumedQuantity = 0;

    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    public Inventory() {}

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

    public Long getId() { return id; }
    public void setId(Long v) { this.id = v; }
    public String getRawMaterialId() { return rawMaterialId; }
    public void setRawMaterialId(String v) { this.rawMaterialId = v; }
    public String getRawMaterialName() { return rawMaterialName; }
    public void setRawMaterialName(String v) { this.rawMaterialName = v; }
    public String getUnit() { return unit; }
    public void setUnit(String v) { this.unit = v; }
    public Integer getPendingReceiptQuantity() { return pendingReceiptQuantity; }
    public void setPendingReceiptQuantity(Integer v) { this.pendingReceiptQuantity = v; }
    public Integer getCumulativeStockQuantity() { return cumulativeStockQuantity; }
    public void setCumulativeStockQuantity(Integer v) { this.cumulativeStockQuantity = v; }
    public Integer getAvailableQuantity() { return availableQuantity; }
    public void setAvailableQuantity(Integer v) { this.availableQuantity = v; }
    public Integer getConsumedQuantity() { return consumedQuantity; }
    public void setConsumedQuantity(Integer v) { this.consumedQuantity = v; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public LocalDateTime getUpdatedAt() { return updatedAt; }
}
