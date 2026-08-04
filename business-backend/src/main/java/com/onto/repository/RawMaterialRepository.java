package com.onto.repository;

import com.onto.entity.RawMaterial;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface RawMaterialRepository extends JpaRepository<RawMaterial, Long> {
    List<RawMaterial> findByRawMaterialIdContaining(String id);
    List<RawMaterial> findByRawMaterialNameContaining(String name);
    List<RawMaterial> findByRawMaterialIdContainingAndRawMaterialNameContaining(String id, String name);
}
