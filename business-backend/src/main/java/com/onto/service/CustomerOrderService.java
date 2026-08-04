package com.onto.service;

import com.onto.entity.CustomerOrder;
import com.onto.repository.CustomerOrderRepository;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class CustomerOrderService {
    private final CustomerOrderRepository repo;

    public CustomerOrderService(CustomerOrderRepository repo) { this.repo = repo; }

    public List<CustomerOrder> query(String orderId, String orderName) {
        boolean hasId = orderId != null && !orderId.isEmpty();
        boolean hasName = orderName != null && !orderName.isEmpty();
        if (!hasId && !hasName) return repo.findAll();
        if (hasId && hasName)
            return repo.findByOrderIdAndOrderNameContaining(orderId, orderName);
        if (hasId)
            return repo.findByOrderId(orderId);
        return repo.findByOrderNameContaining(orderName);
    }
}
