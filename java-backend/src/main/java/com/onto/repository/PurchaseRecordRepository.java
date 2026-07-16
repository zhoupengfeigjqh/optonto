package com.onto.repository;

import com.onto.entity.PurchaseRecord;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;

import java.util.Optional;

public interface PurchaseRecordRepository extends JpaRepository<PurchaseRecord, Long> {

    Optional<PurchaseRecord> findByPurchaseOrderId(String purchaseOrderId);

    @Query("SELECT p FROM PurchaseRecord p WHERE " +
           "(:purchaseOrderId IS NULL OR p.purchaseOrderId LIKE %:purchaseOrderId%) AND " +
           "(:rawMaterialId IS NULL OR p.rawMaterialId = :rawMaterialId) AND " +
           "(:rawMaterialName IS NULL OR p.rawMaterialName LIKE %:rawMaterialName%) AND " +
           "(:relatedOrderId IS NULL OR p.relatedOrderId = :relatedOrderId)")
    List<PurchaseRecord> query(@Param("purchaseOrderId") String purchaseOrderId,
                               @Param("rawMaterialId") String rawMaterialId,
                               @Param("rawMaterialName") String rawMaterialName,
                               @Param("relatedOrderId") String relatedOrderId);
}
