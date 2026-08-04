package com.onto.controller;

import com.onto.dto.ApiResponse;
import com.onto.entity.Inventory;
import com.onto.service.InventoryService;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/inventories")
public class InventoryController {
    private final InventoryService service;

    public InventoryController(InventoryService service) { this.service = service; }

    @GetMapping
    public ApiResponse<List<Inventory>> query(
            @RequestParam(required = false) String rawMaterialId,
            @RequestParam(required = false) String rawMaterialName) {
        return ApiResponse.ok(service.query(rawMaterialId, rawMaterialName));
    }
}
