package com.onto.entity;

import jakarta.persistence.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "customer_order")
public class CustomerOrder {
    @Id
    @Column(name = "order_id", length = 64)
    private String orderId;

    @Column(name = "order_name", length = 128, nullable = false)
    private String orderName;

    @Column(name = "batch_number", length = 64)
    private String batchNumber;

    @Column(name = "buffer_period", nullable = false)
    private Integer bufferPeriod;

    @Column(name = "order_type", length = 32, nullable = false)
    private String orderType;

    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    public CustomerOrder() {}

    @PrePersist
    protected void onCreate() {
        LocalDateTime now = LocalDateTime.now();
        this.createdAt = now;
        this.updatedAt = now;
    }

    @PreUpdate
    protected void onUpdate() {
        this.updatedAt = LocalDateTime.now();
    }

    public String getOrderId() { return orderId; }
    public void setOrderId(String v) { this.orderId = v; }
    public String getOrderName() { return orderName; }
    public void setOrderName(String v) { this.orderName = v; }
    public String getBatchNumber() { return batchNumber; }
    public void setBatchNumber(String v) { this.batchNumber = v; }
    public Integer getBufferPeriod() { return bufferPeriod; }
    public void setBufferPeriod(Integer v) { this.bufferPeriod = v; }
    public String getOrderType() { return orderType; }
    public void setOrderType(String v) { this.orderType = v; }
    public LocalDateTime getCreatedAt() { return createdAt; }
    public LocalDateTime getUpdatedAt() { return updatedAt; }
}
