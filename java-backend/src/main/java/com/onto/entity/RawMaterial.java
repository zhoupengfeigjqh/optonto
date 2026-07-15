package com.onto.entity;

import jakarta.persistence.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "raw_material")
public class RawMaterial {
    @Id
    @Column(name = "raw_material_id", length = 64)
    private String rawMaterialId;

    @Column(name = "raw_material_name", length = 128, nullable = false)
    private String rawMaterialName;

    @Column(length = 32, nullable = false)
    private String unit;

    @Column(name = "safety_stock", nullable = false)
    private Integer safetyStock = 0;

    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    public RawMaterial() {}

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

    public String getRawMaterialId() { return rawMaterialId; }
    public void setRawMaterialId(String v) { this.rawMaterialId = v; }
    public String getRawMaterialName() { return rawMaterialName; }
    public void setRawMaterialName(String v) { this.rawMaterialName = v; }
    public String getUnit() { return unit; }
    public void setUnit(String v) { this.unit = v; }
    public Integer getSafetyStock() { return safetyStock; }
    public void setSafetyStock(Integer v) { this.safetyStock = v; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public LocalDateTime getUpdatedAt() { return updatedAt; }
}
