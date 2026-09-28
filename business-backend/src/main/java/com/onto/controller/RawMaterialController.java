package com.onto.controller;

import com.onto.dto.ApiResponse;
import com.onto.entity.RawMaterial;
import com.onto.service.RawMaterialService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@Tag(name = "原材料", description = "被 optonto-business-mcp 包装为 MCP 工具：query_raw_materials。")
@RestController
@RequestMapping("/api/raw-materials")
public class RawMaterialController {
    private final RawMaterialService service;

    public RawMaterialController(RawMaterialService service) { this.service = service; }

    @Operation(summary = "查询原材料", description = "过滤条件均可选。")
    @GetMapping
    public ApiResponse<List<RawMaterial>> query(
            @Parameter(description = "原材料编号") @RequestParam(required = false) String rawMaterialId,
            @Parameter(description = "原材料名称") @RequestParam(required = false) String rawMaterialName) {
        return ApiResponse.ok(service.query(rawMaterialId, rawMaterialName));
    }
}
