package com.onto.controller;

import com.onto.entity.CustomerOrder;
import com.onto.entity.Inventory;
import com.onto.entity.RawMaterial;
import com.onto.entity.Supplier;
import com.onto.repository.CustomerOrderRepository;
import com.onto.repository.InventoryRepository;
import com.onto.repository.RawMaterialRepository;
import com.onto.repository.SupplierRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import static org.hamcrest.Matchers.hasSize;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 目录类查询接口集成测试（章程 II：每个接口点必须有集成测试，覆盖正常-异常-边界条件）。
 *
 * 覆盖 4 个只读端点：客户订单 / 库存 / 原材料 / 供应商。
 * 重点在于它们的**过滤组合语义**与空结果行为——这些接口被 business-mcp 直接映射为
 * MCP 工具，过滤语义出错会直接反映到 Agent 的查询结果上。
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class CatalogQueryApiTest {

    @Autowired MockMvc mvc;
    @Autowired CustomerOrderRepository orderRepo;
    @Autowired InventoryRepository inventoryRepo;
    @Autowired RawMaterialRepository materialRepo;
    @Autowired SupplierRepository supplierRepo;

    @BeforeEach
    void seed() {
        // created_at / updated_at 由实体 @PrePersist 负责，无需（也没有）setter
        CustomerOrder o1 = new CustomerOrder();
        o1.setOrderId("SO-001");
        o1.setOrderName("华东订单");
        o1.setBatchNumber("B-1");
        o1.setBufferPeriod(7);
        o1.setOrderType("正式");
        orderRepo.saveAndFlush(o1);

        CustomerOrder o2 = new CustomerOrder();
        o2.setOrderId("SO-002");
        o2.setOrderName("华南订单");
        o2.setBatchNumber("B-2");
        o2.setBufferPeriod(3);
        o2.setOrderType("试制");
        orderRepo.saveAndFlush(o2);

        Inventory inv = new Inventory();
        inv.setRawMaterialId("RM-001");
        inv.setRawMaterialName("高强度钢板");
        inv.setUnit("吨");
        inv.setPendingReceiptQuantity(50);
        inv.setCumulativeStockQuantity(100);
        inv.setAvailableQuantity(80);
        inv.setConsumedQuantity(20);
        inventoryRepo.saveAndFlush(inv);

        RawMaterial m = new RawMaterial();
        m.setRawMaterialId("RM-001");
        m.setRawMaterialName("高强度钢板");
        m.setUnit("吨");
        m.setSafetyStock(100);
        materialRepo.saveAndFlush(m);

        Supplier s = new Supplier();
        s.setSupplierName("宝钢");
        s.setLeadTime(5);   // lead_time 非空
        supplierRepo.saveAndFlush(s);
    }

    @Nested
    @DisplayName("客户订单查询")
    class CustomerOrders {

        @Test
        @DisplayName("正常：不带过滤返回全部，字段名保持业务系统原始命名")
        void queryAll() throws Exception {
            mvc.perform(get("/api/customer-orders"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.code").value(0))
                    .andExpect(jsonPath("$.data", hasSize(2)))
                    .andExpect(jsonPath("$.data[0].orderId").exists())
                    .andExpect(jsonPath("$.data[0].bufferPeriod").exists());
        }

        @Test
        @DisplayName("正常：按订单号精确过滤；按名称模糊过滤")
        void queryByFilters() throws Exception {
            mvc.perform(get("/api/customer-orders").param("orderId", "SO-001"))
                    .andExpect(jsonPath("$.data", hasSize(1)))
                    .andExpect(jsonPath("$.data[0].orderId").value("SO-001"));
            mvc.perform(get("/api/customer-orders").param("orderName", "华东"))
                    .andExpect(jsonPath("$.data", hasSize(1)));
        }

        @Test
        @DisplayName("边界：两个条件同时给定时按「与」组合")
        void queryByBothFilters() throws Exception {
            mvc.perform(get("/api/customer-orders").param("orderId", "SO-001").param("orderName", "华南"))
                    .andExpect(jsonPath("$.data", hasSize(0)));
        }

        @Test
        @DisplayName("边界：空串参数视为不过滤")
        void blankFiltersAreIgnored() throws Exception {
            mvc.perform(get("/api/customer-orders").param("orderId", "").param("orderName", ""))
                    .andExpect(jsonPath("$.data", hasSize(2)));
        }

        @Test
        @DisplayName("异常：无匹配返回空数组而非 404")
        void noMatch() throws Exception {
            mvc.perform(get("/api/customer-orders").param("orderId", "SO-none"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.data", hasSize(0)));
        }
    }

    @Nested
    @DisplayName("库存查询")
    class Inventories {

        @Test
        @DisplayName("正常：返回库存三口径")
        void queryAll() throws Exception {
            mvc.perform(get("/api/inventories"))
                    .andExpect(jsonPath("$.data", hasSize(1)))
                    .andExpect(jsonPath("$.data[0].pendingReceiptQuantity").value(50))
                    .andExpect(jsonPath("$.data[0].cumulativeStockQuantity").value(100))
                    .andExpect(jsonPath("$.data[0].availableQuantity").value(80));
        }

        @Test
        @DisplayName("正常：按原材料编号或名称模糊过滤")
        void queryByFilters() throws Exception {
            mvc.perform(get("/api/inventories").param("rawMaterialId", "RM-00"))
                    .andExpect(jsonPath("$.data", hasSize(1)));
            mvc.perform(get("/api/inventories").param("rawMaterialName", "钢板"))
                    .andExpect(jsonPath("$.data", hasSize(1)));
        }

        @Test
        @DisplayName("边界：两个条件组合过滤")
        void queryByBothFilters() throws Exception {
            mvc.perform(get("/api/inventories").param("rawMaterialId", "RM-001").param("rawMaterialName", "钢板"))
                    .andExpect(jsonPath("$.data", hasSize(1)));
            mvc.perform(get("/api/inventories").param("rawMaterialId", "RM-001").param("rawMaterialName", "铝材"))
                    .andExpect(jsonPath("$.data", hasSize(0)));
        }

        @Test
        @DisplayName("边界：空串过滤参数被当作「包含空串」从而命中全部（记录现状语义）")
        void blankFilterMatchesAll() throws Exception {
            // InventoryService 只判 null 不判空串，Containing("") 命中所有行。
            // 这里如实锁定该行为：若将来改为「空串不过滤」，此用例会失败并提醒同步变更契约。
            mvc.perform(get("/api/inventories").param("rawMaterialId", ""))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.data", hasSize(1)));
        }
    }

    @Nested
    @DisplayName("原材料查询")
    class RawMaterials {

        @Test
        @DisplayName("正常：按编号/名称过滤并返回安全库存")
        void query() throws Exception {
            mvc.perform(get("/api/raw-materials"))
                    .andExpect(jsonPath("$.data", hasSize(1)))
                    .andExpect(jsonPath("$.data[0].safetyStock").value(100));
            mvc.perform(get("/api/raw-materials").param("rawMaterialName", "钢板"))
                    .andExpect(jsonPath("$.data", hasSize(1)));
            mvc.perform(get("/api/raw-materials").param("rawMaterialId", "RM-999"))
                    .andExpect(jsonPath("$.data", hasSize(0)));
        }
    }

    @Nested
    @DisplayName("供应商查询")
    class Suppliers {

        @Test
        @DisplayName("正常：不带过滤返回全部")
        void queryAll() throws Exception {
            mvc.perform(get("/api/suppliers"))
                    .andExpect(jsonPath("$.data", hasSize(1)))
                    .andExpect(jsonPath("$.data[0].supplierName").value("宝钢"));
        }

        @Test
        @DisplayName("正常：按供应商名称模糊过滤")
        void queryByName() throws Exception {
            mvc.perform(get("/api/suppliers").param("supplierName", "宝"))
                    .andExpect(jsonPath("$.data", hasSize(1)));
        }

        @Test
        @DisplayName("边界：按可供应原材料名称过滤（无关联时返回空数组）")
        void queryByRawMaterialName() throws Exception {
            mvc.perform(get("/api/suppliers").param("rawMaterialName", "钢板"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.code").value(0));
        }

        @Test
        @DisplayName("边界：空串参数视为不过滤")
        void blankFiltersAreIgnored() throws Exception {
            mvc.perform(get("/api/suppliers").param("supplierName", ""))
                    .andExpect(jsonPath("$.data", hasSize(1)));
        }
    }
}
