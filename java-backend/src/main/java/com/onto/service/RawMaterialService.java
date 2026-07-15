package com.onto.service;

import com.onto.entity.RawMaterial;
import com.onto.repository.RawMaterialRepository;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class RawMaterialService {
    private final RawMaterialRepository repo;

    public RawMaterialService(RawMaterialRepository repo) { this.repo = repo; }

    public List<RawMaterial> query(String rawMaterialId, String rawMaterialName) {
        if (rawMaterialId == null && rawMaterialName == null) return repo.findAll();
        String id = rawMaterialId != null ? rawMaterialId : "";
        String name = rawMaterialName != null ? rawMaterialName : "";
        return repo.findByRawMaterialIdContainingOrRawMaterialNameContaining(id, name);
    }
}
