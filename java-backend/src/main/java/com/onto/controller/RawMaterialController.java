package com.onto.controller;

import com.onto.dto.ApiResponse;
import com.onto.entity.RawMaterial;
import com.onto.service.RawMaterialService;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/raw-materials")
public class RawMaterialController {
    private final RawMaterialService service;

    public RawMaterialController(RawMaterialService service) { this.service = service; }

    @GetMapping
    public ApiResponse<List<RawMaterial>> query(
            @RequestParam(required = false) String rawMaterialId,
            @RequestParam(required = false) String rawMaterialName) {
        return ApiResponse.ok(service.query(rawMaterialId, rawMaterialName));
    }
}
