package com.onto.repository;

import com.onto.entity.Inventory;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface InventoryRepository extends JpaRepository<Inventory, String> {
    List<Inventory> findByRawMaterialIdContainingOrRawMaterialNameContaining(String id, String name);
}
