package com.onto.repository;

import com.onto.entity.SupplierRawMaterial;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface SupplierRawMaterialRepository extends JpaRepository<SupplierRawMaterial, Long> {
    List<SupplierRawMaterial> findBySupplierName(String supplierName);
    List<SupplierRawMaterial> findByRawMaterialId(String rawMaterialId);
}
