package com.onto.service;

import com.onto.entity.Supplier;
import com.onto.repository.SupplierRepository;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class SupplierService {
    private final SupplierRepository repo;

    public SupplierService(SupplierRepository repo) { this.repo = repo; }

    public List<Supplier> query(String supplierName, String rawMaterialName) {
        boolean hasName = supplierName != null && !supplierName.isEmpty();
        boolean hasRaw = rawMaterialName != null && !rawMaterialName.isEmpty();
        if (!hasName && !hasRaw) return repo.findAll();
        if (hasName && hasRaw)
            return repo.findBySupplierNameContainingAndRawMaterialNameContaining(supplierName, rawMaterialName);
        if (hasName)
            return repo.findBySupplierNameContaining(supplierName);
        return repo.findByRawMaterialNameContaining(rawMaterialName);
    }
}
