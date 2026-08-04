package com.onto.repository;

import com.onto.entity.CustomerOrder;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface CustomerOrderRepository extends JpaRepository<CustomerOrder, Long> {
    List<CustomerOrder> findByOrderId(String orderId);
    List<CustomerOrder> findByOrderNameContaining(String orderName);
    List<CustomerOrder> findByOrderIdAndOrderNameContaining(String orderId, String orderName);
}
