package com.onto.repository;

import com.onto.entity.Supplier;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface SupplierRepository extends JpaRepository<Supplier, String> {
    List<Supplier> findBySupplierNameContaining(String name);
    List<Supplier> findByRawMaterialNameContaining(String rawMaterialName);
    List<Supplier> findBySupplierNameContainingAndRawMaterialNameContaining(String name, String rawMaterialName);
}
