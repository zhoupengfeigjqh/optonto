package com.onto.service;

import com.onto.entity.Inventory;
import com.onto.repository.InventoryRepository;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class InventoryService {
    private final InventoryRepository repo;

    public InventoryService(InventoryRepository repo) { this.repo = repo; }

    public List<Inventory> query(String rawMaterialId, String rawMaterialName) {
        if (rawMaterialId == null && rawMaterialName == null) return repo.findAll();
        if (rawMaterialId != null && rawMaterialName != null)
            return repo.findByRawMaterialIdContainingAndRawMaterialNameContaining(rawMaterialId, rawMaterialName);
        if (rawMaterialId != null)
            return repo.findByRawMaterialIdContaining(rawMaterialId);
        return repo.findByRawMaterialNameContaining(rawMaterialName);
    }
}
