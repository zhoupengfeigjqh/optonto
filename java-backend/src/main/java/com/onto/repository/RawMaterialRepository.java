package com.onto.repository;

import com.onto.entity.RawMaterial;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface RawMaterialRepository extends JpaRepository<RawMaterial, String> {
    List<RawMaterial> findByRawMaterialIdContainingOrRawMaterialNameContaining(String id, String name);
}
