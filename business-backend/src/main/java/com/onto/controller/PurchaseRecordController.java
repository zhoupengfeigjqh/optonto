package com.onto.controller;

import com.onto.dto.ApiResponse;
import com.onto.entity.PurchaseRecord;
import com.onto.service.PurchaseRecordService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@Tag(name = "采购单", description = """
        采购单的查询与状态变更。
        被 optonto-business-mcp 包装为 MCP 工具：
        query_purchase_records / create_purchase_record / cancel_purchase_record / receive_purchase_record。
        """)
@RestController
@RequestMapping("/api/purchase-records")
public class PurchaseRecordController {
    private final PurchaseRecordService service;

    public PurchaseRecordController(PurchaseRecordService service) { this.service = service; }

    @Operation(summary = "查询采购单", description = "所有过滤条件均为可选，不传即不按该字段过滤。")
    @GetMapping
    public ApiResponse<List<PurchaseRecord>> query(
            @Parameter(description = "采购单号") @RequestParam(required = false) String purchaseOrderId,
            @Parameter(description = "原材料编号") @RequestParam(required = false) String rawMaterialId,
            @Parameter(description = "原材料名称") @RequestParam(required = false) String rawMaterialName,
            @Parameter(description = "关联订单号") @RequestParam(required = false) String relatedOrderId) {
        return ApiResponse.ok(service.query(purchaseOrderId, rawMaterialId, rawMaterialName, relatedOrderId));
    }

    @Operation(summary = "创建采购单",
            description = "入参使用业务系统原始字段名（如 rawMaterialId / purchaseQty），不做任何换名。")
    @PostMapping
    public ApiResponse<Map<String, Object>> create(@RequestBody Map<String, Object> params) {
        Map<String, Object> result = service.create(params);
        return ApiResponse.ok((Map<String, Object>) result.get("data"));
    }

    @Operation(summary = "取消采购单",
            description = "采购单不存在或状态不允许取消时返回非 0 code，HTTP 状态码与 code 一致。")
    @PostMapping("/{purchaseOrderId}/cancel")
    public ResponseEntity<ApiResponse<Map<String, Object>>> cancel(
            @Parameter(description = "采购单号") @PathVariable String purchaseOrderId) {
        Map<String, Object> result = service.cancel(purchaseOrderId);
        int code = (int) result.get("code");
        if (code != 0)
            return ResponseEntity.status(code).body(ApiResponse.fail(code, (String) result.get("message")));
        return ResponseEntity.ok(ApiResponse.ok((Map<String, Object>) result.get("data")));
    }

    @Operation(summary = "采购单收货",
            description = "采购单不存在或状态不允许收货时返回非 0 code，HTTP 状态码与 code 一致。")
    @PostMapping("/{purchaseOrderId}/receive")
    public ResponseEntity<ApiResponse<Map<String, Object>>> receive(
            @Parameter(description = "采购单号") @PathVariable String purchaseOrderId) {
        Map<String, Object> result = service.receive(purchaseOrderId);
        int code = (int) result.get("code");
        if (code != 0)
            return ResponseEntity.status(code).body(ApiResponse.fail(code, (String) result.get("message")));
        return ResponseEntity.ok(ApiResponse.ok((Map<String, Object>) result.get("data")));
    }
}
