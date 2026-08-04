package com.onto.entity;

import jakarta.persistence.*;

@Entity
@Table(name = "supplier_raw_material",
       uniqueConstraints = @UniqueConstraint(columnNames = {"supplier_name", "raw_material_id"}))
public class SupplierRawMaterial {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "supplier_name", length = 128, nullable = false)
    private String supplierName;

    @Column(name = "raw_material_id", length = 64, nullable = false)
    private String rawMaterialId;

    public SupplierRawMaterial() {}

    public Long getId() { return id; }
    public String getSupplierName() { return supplierName; }
    public void setSupplierName(String v) { this.supplierName = v; }
    public String getRawMaterialId() { return rawMaterialId; }
    public void setRawMaterialId(String v) { this.rawMaterialId = v; }
}
