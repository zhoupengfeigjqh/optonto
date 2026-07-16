package com.onto.service;

import com.onto.entity.*;
import com.onto.repository.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.*;

@Service
public class PurchaseRecordService {
    private final PurchaseRecordRepository repo;

    public PurchaseRecordService(PurchaseRecordRepository repo) {
        this.repo = repo;
    }

    public List<PurchaseRecord> query(String purchaseOrderId, String rawMaterialId,
                                       String rawMaterialName, String relatedOrderId) {
        return repo.query(
            purchaseOrderId != null && !purchaseOrderId.isEmpty() ? purchaseOrderId : null,
            rawMaterialId != null && !rawMaterialId.isEmpty() ? rawMaterialId : null,
            rawMaterialName != null && !rawMaterialName.isEmpty() ? rawMaterialName : null,
            relatedOrderId != null && !relatedOrderId.isEmpty() ? relatedOrderId : null
        );
    }

    @Transactional
    public Map<String, Object> create(Map<String, Object> params) {
        String purchaseOrderId = "PO-" + LocalDate.now().format(DateTimeFormatter.ofPattern("yyyyMMdd"))
                + "-" + String.format("%03d", repo.count() + 1);

        PurchaseRecord record = new PurchaseRecord();
        record.setPurchaseOrderId(purchaseOrderId);
        record.setRawMaterialId((String) params.get("rawMaterialId"));
        record.setRawMaterialName((String) params.get("rawMaterialName"));
        record.setUnit((String) params.get("unit"));
        record.setPurchaseTime(LocalDate.now());
        record.setArrivalTime(LocalDate.parse((String) params.get("arrivalTime")));
        record.setArrivalQuantity(params.get("arrivalQuantity") instanceof Integer
            ? (Integer) params.get("arrivalQuantity")
            : Integer.valueOf(params.get("arrivalQuantity").toString()));
        record.setSupplierName((String) params.get("supplierName"));
        record.setRelatedOrderId(toNull((String) params.get("relatedOrderId")));
        record.setRelatedOrderName(toNull((String) params.get("relatedOrderName")));
        record.setStatus("待入库");
        repo.save(record);

        Map<String, Object> data = new HashMap<>();
        data.put("purchaseOrderId", purchaseOrderId);
        data.put("rawMaterialId", record.getRawMaterialId());
        data.put("rawMaterialName", record.getRawMaterialName());
        data.put("unit", record.getUnit());
        data.put("purchaseTime", record.getPurchaseTime().toString());
        data.put("arrivalTime", record.getArrivalTime().toString());
        data.put("arrivalQuantity", record.getArrivalQuantity());
        data.put("supplierName", record.getSupplierName());
        data.put("relatedOrderId", record.getRelatedOrderId());
        data.put("relatedOrderName", record.getRelatedOrderName() != null ? record.getRelatedOrderName() : "");
        data.put("status", "待入库");

        return Map.of("code", 0, "data", data);
    }

    @Transactional
    public Map<String, Object> cancel(String purchaseOrderId) {
        PurchaseRecord record = repo.findByPurchaseOrderId(purchaseOrderId).orElse(null);
        if (record == null)
            return Map.of("code", 404, "message", "采购单 " + purchaseOrderId + " 不存在");

        record.setStatus("已取消");
        repo.save(record);

        return Map.of("code", 0, "data", Map.of(
            "purchaseOrderId", purchaseOrderId,
            "rawMaterialId", record.getRawMaterialId(),
            "rawMaterialName", record.getRawMaterialName(),
            "status", "已取消"
        ));
    }

    @Transactional
    public Map<String, Object> receive(String purchaseOrderId) {
        PurchaseRecord record = repo.findByPurchaseOrderId(purchaseOrderId).orElse(null);
        if (record == null)
            return Map.of("code", 404, "message", "采购单 " + purchaseOrderId + " 不存在");

        record.setStatus("已入库");
        repo.save(record);

        return Map.of("code", 0, "data", Map.of(
            "purchaseOrderId", purchaseOrderId,
            "rawMaterialId", record.getRawMaterialId(),
            "rawMaterialName", record.getRawMaterialName(),
            "unit", record.getUnit(),
            "arrivalQuantity", record.getArrivalQuantity(),
            "status", "已入库"
        ));
    }

    private static String toNull(String s) {
        return s != null && !s.isEmpty() ? s : null;
    }
}
