package com.onto.service;

import com.onto.entity.*;
import com.onto.repository.*;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.*;

/**
 * 采购单服务。
 *
 * 一致性约束（章程 VI：数据一致性）：
 * - 状态变更全部在事务内完成，禁止部分提交；
 * - 状态迁移收敛为「待入库 → 已入库 / 已取消」，非法迁移返回 409；
 * - 重复调用幂等：已是目标状态时不再重复处理（尤其入库不得重复累加库存）；
 * - 并发修改同一采购单由实体 {@code @Version} 乐观锁拦截，冲突经全局异常处理转为 409。
 */
@Service
public class PurchaseRecordService {
    private final PurchaseRecordRepository repo;
    private final InventoryRepository inventoryRepo;

    public PurchaseRecordService(PurchaseRecordRepository repo, InventoryRepository inventoryRepo) {
        this.repo = repo;
        this.inventoryRepo = inventoryRepo;
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
        // 单号并发生成（章程 VI：并发操作必须考虑锁机制）：
        // 原实现用 count()+1 拼单号，并发请求会读到相同 count 而产生重复单号；
        // 改为「先以临时唯一号落库拿到自增主键 → 由主键派生业务单号回写」——
        // 唯一性由数据库主键保证，并由 uk_purchase_order_id 唯一索引兜底，无需加锁或重试。
        PurchaseRecord record = new PurchaseRecord();
        record.setPurchaseOrderId("TMP-" + UUID.randomUUID());
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
        PurchaseRecord saved = repo.saveAndFlush(record);

        String purchaseOrderId = "PO-" + LocalDate.now().format(DateTimeFormatter.ofPattern("yyyyMMdd"))
                + "-" + String.format("%03d", saved.getId());
        saved.setPurchaseOrderId(purchaseOrderId);
        repo.saveAndFlush(saved);

        Map<String, Object> data = new HashMap<>();
        data.put("purchaseOrderId", purchaseOrderId);
        data.put("rawMaterialId", saved.getRawMaterialId());
        data.put("rawMaterialName", saved.getRawMaterialName());
        data.put("unit", saved.getUnit());
        data.put("purchaseTime", saved.getPurchaseTime().toString());
        data.put("arrivalTime", saved.getArrivalTime().toString());
        data.put("arrivalQuantity", saved.getArrivalQuantity());
        data.put("supplierName", saved.getSupplierName());
        data.put("relatedOrderId", saved.getRelatedOrderId());
        data.put("relatedOrderName", saved.getRelatedOrderName() != null ? saved.getRelatedOrderName() : "");
        data.put("status", "待入库");

        return Map.of("code", 0, "data", data);
    }

    /**
     * 取消采购单：幂等 + 状态机。
     * - 不存在 → 404；已取消 → 幂等成功；已入库 → 409（业务不允许回退）。
     */
    @Transactional
    public Map<String, Object> cancel(String purchaseOrderId) {
        PurchaseRecord record = repo.findByPurchaseOrderId(purchaseOrderId).orElse(null);
        if (record == null)
            return Map.of("code", 404, "message", "采购单 " + purchaseOrderId + " 不存在");
        if ("已取消".equals(record.getStatus()))
            return Map.of("code", 0, "data", cancelData(record));
        if ("已入库".equals(record.getStatus()))
            return Map.of("code", 409, "message", "采购单 " + purchaseOrderId + " 已入库，不可取消");

        record.setStatus("已取消");
        repo.saveAndFlush(record);
        return Map.of("code", 0, "data", cancelData(record));
    }

    /**
     * 确认入库：幂等 + 状态机 + 库存回写（同一事务）。
     * - 不存在 → 404；已入库 → 幂等成功（不重复累加库存）；已取消 → 409。
     * - 库存口径：待入库 -Q、累计入库 +Q、可用库存 +Q（均以下限 0 保护）。
     * - 响应结构与既有契约保持一致（不新增字段），避免破坏下游 outputSchema。
     */
    @Transactional
    public Map<String, Object> receive(String purchaseOrderId) {
        PurchaseRecord record = repo.findByPurchaseOrderId(purchaseOrderId).orElse(null);
        if (record == null)
            return Map.of("code", 404, "message", "采购单 " + purchaseOrderId + " 不存在");
        if ("已入库".equals(record.getStatus()))
            return Map.of("code", 0, "data", receiveData(record));
        if ("已取消".equals(record.getStatus()))
            return Map.of("code", 409, "message", "采购单 " + purchaseOrderId + " 已取消，不可入库");

        int qty = record.getArrivalQuantity() == null ? 0 : record.getArrivalQuantity();
        applyInventoryIncrease(record, qty);

        record.setStatus("已入库");
        // saveAndFlush 触发 @Version 校验：并发改动同一单时后提交者抛乐观锁异常 → 409
        repo.saveAndFlush(record);

        return Map.of("code", 0, "data", receiveData(record));
    }

    /** 入库回写库存：库存行不存在时按采购单信息补建，保证账实一致 */
    private void applyInventoryIncrease(PurchaseRecord record, int qty) {
        Inventory inv = inventoryRepo.findByRawMaterialId(record.getRawMaterialId())
            .orElseGet(() -> {
                Inventory created = new Inventory();
                created.setRawMaterialId(record.getRawMaterialId());
                created.setRawMaterialName(record.getRawMaterialName());
                created.setUnit(record.getUnit());
                return created;
            });
        inv.setPendingReceiptQuantity(Math.max(0, nz(inv.getPendingReceiptQuantity()) - qty));
        inv.setCumulativeStockQuantity(nz(inv.getCumulativeStockQuantity()) + qty);
        inv.setAvailableQuantity(nz(inv.getAvailableQuantity()) + qty);
        inventoryRepo.save(inv);
    }

    private static int nz(Integer v) { return v == null ? 0 : v; }

    private static Map<String, Object> cancelData(PurchaseRecord r) {
        Map<String, Object> data = new HashMap<>();
        data.put("purchaseOrderId", r.getPurchaseOrderId());
        data.put("rawMaterialId", r.getRawMaterialId());
        data.put("rawMaterialName", r.getRawMaterialName());
        data.put("status", "已取消");
        return data;
    }

    private static Map<String, Object> receiveData(PurchaseRecord r) {
        Map<String, Object> data = new HashMap<>();
        data.put("purchaseOrderId", r.getPurchaseOrderId());
        data.put("rawMaterialId", r.getRawMaterialId());
        data.put("rawMaterialName", r.getRawMaterialName());
        data.put("unit", r.getUnit());
        data.put("arrivalQuantity", r.getArrivalQuantity());
        data.put("status", "已入库");
        return data;
    }

    private static String toNull(String s) {
        return s != null && !s.isEmpty() ? s : null;
    }
}
