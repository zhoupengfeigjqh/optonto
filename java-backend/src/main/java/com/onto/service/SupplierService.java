package com.onto.service;

import com.onto.entity.Supplier;
import com.onto.repository.SupplierRepository;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class SupplierService {
    private final SupplierRepository repo;

    public SupplierService(SupplierRepository repo) { this.repo = repo; }

    public List<Supplier> query(String supplierName, String rawMaterialId) {
        if (rawMaterialId != null && !rawMaterialId.isEmpty())
            return repo.findByRawMaterialId(rawMaterialId);
        if (supplierName != null && !supplierName.isEmpty())
            return repo.findBySupplierNameContaining(supplierName);
        return repo.findAll();
    }
}
