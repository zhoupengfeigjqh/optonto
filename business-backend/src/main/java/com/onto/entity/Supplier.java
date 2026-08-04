package com.onto.entity;

import jakarta.persistence.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "supplier")
public class Supplier {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "supplier_name", length = 128)
    private String supplierName;

    @Column(length = 256)
    private String address;

    @Column(name = "contact_person", length = 64)
    private String contactPerson;

    @Column(name = "contact_phone", length = 32)
    private String contactPhone;

    @Column(name = "raw_material_id", length = 64)
    private String rawMaterialId;

    @Column(name = "raw_material_name", length = 128)
    private String rawMaterialName;

    @Column(name = "lead_time", nullable = false)
    private Integer leadTime;

    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    public Supplier() {}

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
    public String getSupplierName() { return supplierName; }
    public void setSupplierName(String v) { this.supplierName = v; }
    public String getAddress() { return address; }
    public void setAddress(String v) { this.address = v; }
    public String getContactPerson() { return contactPerson; }
    public void setContactPerson(String v) { this.contactPerson = v; }
    public String getContactPhone() { return contactPhone; }
    public void setContactPhone(String v) { this.contactPhone = v; }
    public String getRawMaterialId() { return rawMaterialId; }
    public void setRawMaterialId(String v) { this.rawMaterialId = v; }
    public String getRawMaterialName() { return rawMaterialName; }
    public void setRawMaterialName(String v) { this.rawMaterialName = v; }
    public Integer getLeadTime() { return leadTime; }
    public void setLeadTime(Integer v) { this.leadTime = v; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public LocalDateTime getUpdatedAt() { return updatedAt; }
}
