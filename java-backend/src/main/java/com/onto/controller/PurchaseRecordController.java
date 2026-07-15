package com.onto.controller;

import com.onto.dto.ApiResponse;
import com.onto.entity.PurchaseRecord;
import com.onto.service.PurchaseRecordService;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/purchase-records")
public class PurchaseRecordController {
    private final PurchaseRecordService service;

    public PurchaseRecordController(PurchaseRecordService service) { this.service = service; }

    @GetMapping
    public ApiResponse<List<PurchaseRecord>> query(
            @RequestParam(required = false) String purchaseOrderId,
            @RequestParam(required = false) String rawMaterialId,
            @RequestParam(required = false) String rawMaterialName,
            @RequestParam(required = false) String relatedOrderId) {
        return ApiResponse.ok(service.query(purchaseOrderId, rawMaterialId, rawMaterialName, relatedOrderId));
    }

    @PostMapping
    public ApiResponse<Map<String, Object>> create(@RequestBody Map<String, Object> params) {
        Map<String, Object> result = service.create(params);
        return ApiResponse.ok((Map<String, Object>) result.get("data"));
    }

    @PostMapping("/{purchaseOrderId}/cancel")
    public ApiResponse<Map<String, Object>> cancel(@PathVariable String purchaseOrderId) {
        Map<String, Object> result = service.cancel(purchaseOrderId);
        int code = (int) result.get("code");
        if (code != 0)
            return ApiResponse.fail(code, (String) result.get("message"));
        return ApiResponse.ok((Map<String, Object>) result.get("data"));
    }

    @PostMapping("/{purchaseOrderId}/receive")
    public ApiResponse<Map<String, Object>> receive(@PathVariable String purchaseOrderId) {
        Map<String, Object> result = service.receive(purchaseOrderId);
        int code = (int) result.get("code");
        if (code != 0)
            return ApiResponse.fail(code, (String) result.get("message"));
        return ApiResponse.ok((Map<String, Object>) result.get("data"));
    }
}
