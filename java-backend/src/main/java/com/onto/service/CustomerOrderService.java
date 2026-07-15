package com.onto.service;

import com.onto.entity.CustomerOrder;
import com.onto.repository.CustomerOrderRepository;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class CustomerOrderService {
    private final CustomerOrderRepository repo;

    public CustomerOrderService(CustomerOrderRepository repo) { this.repo = repo; }

    public List<CustomerOrder> findAll() { return repo.findAll(); }
}
