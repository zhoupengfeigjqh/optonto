package com.onto.controller;

import com.onto.dto.ApiResponse;
import com.onto.entity.Supplier;
import com.onto.service.SupplierService;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/suppliers")
public class SupplierController {
    private final SupplierService service;

    public SupplierController(SupplierService service) { this.service = service; }

    @GetMapping
    public ApiResponse<List<Supplier>> query(
            @RequestParam(required = false) String supplierName,
            @RequestParam(required = false) String rawMaterialId) {
        return ApiResponse.ok(service.query(supplierName, rawMaterialId));
    }
}
