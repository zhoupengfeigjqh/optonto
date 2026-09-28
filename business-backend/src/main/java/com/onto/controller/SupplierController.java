package com.onto.controller;

import com.onto.dto.ApiResponse;
import com.onto.entity.Supplier;
import com.onto.service.SupplierService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@Tag(name = "供应商", description = "被 optonto-business-mcp 包装为 MCP 工具：query_suppliers。")
@RestController
@RequestMapping("/api/suppliers")
public class SupplierController {
    private final SupplierService service;

    public SupplierController(SupplierService service) { this.service = service; }

    @Operation(summary = "查询供应商", description = "可按供应商名称或可供应原材料名称过滤；过滤条件均可选。")
    @GetMapping
    public ApiResponse<List<Supplier>> query(
            @Parameter(description = "供应商名称") @RequestParam(required = false) String supplierName,
            @Parameter(description = "可供应原材料名称") @RequestParam(required = false) String rawMaterialName) {
        return ApiResponse.ok(service.query(supplierName, rawMaterialName));
    }
}
