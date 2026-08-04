package com.onto.controller;

import com.onto.dto.ApiResponse;
import com.onto.entity.CustomerOrder;
import com.onto.service.CustomerOrderService;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/customer-orders")
public class CustomerOrderController {
    private final CustomerOrderService service;

    public CustomerOrderController(CustomerOrderService service) { this.service = service; }

    @GetMapping
    public ApiResponse<List<CustomerOrder>> query(
            @RequestParam(required = false) String orderId,
            @RequestParam(required = false) String orderName) {
        return ApiResponse.ok(service.query(orderId, orderName));
    }
}
