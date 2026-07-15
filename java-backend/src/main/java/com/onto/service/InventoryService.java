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
        String id = rawMaterialId != null ? rawMaterialId : "";
        String name = rawMaterialName != null ? rawMaterialName : "";
        return repo.findByRawMaterialIdContainingOrRawMaterialNameContaining(id, name);
    }
}
