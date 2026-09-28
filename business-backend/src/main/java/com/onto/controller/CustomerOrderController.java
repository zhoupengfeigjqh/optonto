package com.onto.controller;

import com.onto.dto.ApiResponse;
import com.onto.entity.CustomerOrder;
import com.onto.service.CustomerOrderService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@Tag(name = "客户订单", description = "被 optonto-business-mcp 包装为 MCP 工具：query_customer_orders。")
@RestController
@RequestMapping("/api/customer-orders")
public class CustomerOrderController {
    private final CustomerOrderService service;

    public CustomerOrderController(CustomerOrderService service) { this.service = service; }

    @Operation(summary = "查询客户订单", description = "过滤条件均可选。")
    @GetMapping
    public ApiResponse<List<CustomerOrder>> query(
            @Parameter(description = "订单号") @RequestParam(required = false) String orderId,
            @Parameter(description = "订单名称") @RequestParam(required = false) String orderName) {
        return ApiResponse.ok(service.query(orderId, orderName));
    }
}
