package com.onto.repository;

import com.onto.entity.Inventory;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface InventoryRepository extends JpaRepository<Inventory, Long> {
    List<Inventory> findByRawMaterialIdContaining(String id);
    List<Inventory> findByRawMaterialNameContaining(String name);
    List<Inventory> findByRawMaterialIdContainingAndRawMaterialNameContaining(String id, String name);

    /** 精确匹配原材料 ID（入库回写库存用；Containing 语义不适用于对账） */
    Optional<Inventory> findByRawMaterialId(String rawMaterialId);
}
