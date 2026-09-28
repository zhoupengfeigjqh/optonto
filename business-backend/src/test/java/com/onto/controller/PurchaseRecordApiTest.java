package com.onto.controller;

import com.onto.entity.Inventory;
import com.onto.entity.PurchaseRecord;
import com.onto.repository.InventoryRepository;
import com.onto.repository.PurchaseRecordRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.HashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.hasSize;
import static org.hamcrest.Matchers.matchesPattern;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 采购单接口集成测试（章程 II：每个接口点必须有集成测试，覆盖正常-异常-边界条件）。
 *
 * 走完整 MVC 栈（Controller → Service → JPA → H2），因此同时验证了：
 * 统一响应信封、HTTP 状态码语义、状态机与幂等、入库时的事务内库存回写。
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class PurchaseRecordApiTest {

    @Autowired MockMvc mvc;
    @Autowired PurchaseRecordRepository repo;
    @Autowired InventoryRepository inventoryRepo;

    private static final String BASE = "/api/purchase-records";

    // ─── 测试数据 ────────────────────────────────────────────────────────────

    private PurchaseRecord seed(String orderId, String status, int qty) {
        PurchaseRecord r = new PurchaseRecord();
        r.setPurchaseOrderId(orderId);
        r.setRawMaterialId("RM-001");
        r.setRawMaterialName("高强度钢板");
        r.setUnit("吨");
        r.setPurchaseTime(LocalDate.now());
        r.setArrivalTime(LocalDate.now().plusDays(3));
        r.setArrivalQuantity(qty);
        r.setSupplierName("宝钢");
        r.setStatus(status);
        return repo.saveAndFlush(r);
    }

    private Inventory seedInventory(int pending, int cumulative, int available) {
        Inventory inv = new Inventory();
        inv.setRawMaterialId("RM-001");
        inv.setRawMaterialName("高强度钢板");
        inv.setUnit("吨");
        inv.setPendingReceiptQuantity(pending);
        inv.setCumulativeStockQuantity(cumulative);
        inv.setAvailableQuantity(available);
        return inventoryRepo.saveAndFlush(inv);
    }

    private Map<String, Object> createBody() {
        Map<String, Object> body = new HashMap<>();
        body.put("rawMaterialId", "RM-001");
        body.put("rawMaterialName", "高强度钢板");
        body.put("unit", "吨");
        body.put("arrivalTime", LocalDate.now().plusDays(3).toString());
        body.put("arrivalQuantity", 100);
        body.put("supplierName", "宝钢");
        return body;
    }

    // ─── 正常路径 ────────────────────────────────────────────────────────────

    @Nested
    @DisplayName("正常路径")
    class HappyPath {

        @Test
        @DisplayName("创建采购单：返回业务单号、状态为待入库、账实字段回显")
        void create() throws Exception {
            mvc.perform(post(BASE).contentType(MediaType.APPLICATION_JSON)
                            .content(new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(createBody())))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.code").value(0))
                    .andExpect(jsonPath("$.data.purchaseOrderId").value(matchesPattern("PO-\\d{8}-\\d{3}")))
                    .andExpect(jsonPath("$.data.status").value("待入库"))
                    .andExpect(jsonPath("$.data.rawMaterialId").value("RM-001"))
                    .andExpect(jsonPath("$.data.arrivalQuantity").value(100));
        }

        @Test
        @DisplayName("查询采购单：按原材料编号精确过滤")
        void queryByRawMaterialId() throws Exception {
            seed("PO-1", "待入库", 10);
            mvc.perform(get(BASE).param("rawMaterialId", "RM-001"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.code").value(0))
                    .andExpect(jsonPath("$.data", hasSize(1)))
                    .andExpect(jsonPath("$.data[0].purchaseOrderId").value("PO-1"));
        }

        @Test
        @DisplayName("查询采购单：单号与名称按模糊匹配")
        void queryByFuzzyFields() throws Exception {
            seed("PO-20260928-001", "待入库", 10);
            mvc.perform(get(BASE).param("purchaseOrderId", "20260928"))
                    .andExpect(jsonPath("$.data", hasSize(1)));
            mvc.perform(get(BASE).param("rawMaterialName", "钢板"))
                    .andExpect(jsonPath("$.data", hasSize(1)));
        }

        @Test
        @DisplayName("查询采购单：按关联订单号过滤")
        void queryByRelatedOrder() throws Exception {
            PurchaseRecord r = seed("PO-2", "待入库", 10);
            r.setRelatedOrderId("SO-9");
            repo.saveAndFlush(r);

            mvc.perform(get(BASE).param("relatedOrderId", "SO-9"))
                    .andExpect(jsonPath("$.data", hasSize(1)));
            mvc.perform(get(BASE).param("relatedOrderId", "SO-not-exist"))
                    .andExpect(jsonPath("$.data", hasSize(0)));
        }

        @Test
        @DisplayName("取消采购单：待入库 → 已取消")
        void cancel() throws Exception {
            seed("PO-3", "待入库", 10);
            mvc.perform(post(BASE + "/PO-3/cancel"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.code").value(0))
                    .andExpect(jsonPath("$.data.status").value("已取消"));
            assertThat(repo.findByPurchaseOrderId("PO-3").orElseThrow().getStatus()).isEqualTo("已取消");
        }

        @Test
        @DisplayName("确认入库：待入库 → 已入库，并在同一事务内回写库存三口径")
        void receive() throws Exception {
            seed("PO-4", "待入库", 30);
            seedInventory(50, 100, 80);

            mvc.perform(post(BASE + "/PO-4/receive"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.code").value(0))
                    .andExpect(jsonPath("$.data.status").value("已入库"))
                    .andExpect(jsonPath("$.data.arrivalQuantity").value(30));

            Inventory inv = inventoryRepo.findByRawMaterialId("RM-001").orElseThrow();
            assertThat(inv.getPendingReceiptQuantity()).isEqualTo(20);   // 50 - 30
            assertThat(inv.getCumulativeStockQuantity()).isEqualTo(130); // 100 + 30
            assertThat(inv.getAvailableQuantity()).isEqualTo(110);       // 80 + 30
        }
    }

    // ─── 异常路径 ────────────────────────────────────────────────────────────

    @Nested
    @DisplayName("异常路径")
    class ErrorPath {

        @Test
        @DisplayName("取消不存在的采购单：404 且带可读信息")
        void cancelMissing() throws Exception {
            mvc.perform(post(BASE + "/PO-none/cancel"))
                    .andExpect(status().isNotFound())
                    .andExpect(jsonPath("$.code").value(404))
                    .andExpect(jsonPath("$.message", containsString("不存在")));
        }

        @Test
        @DisplayName("入库不存在的采购单：404")
        void receiveMissing() throws Exception {
            mvc.perform(post(BASE + "/PO-none/receive"))
                    .andExpect(status().isNotFound())
                    .andExpect(jsonPath("$.code").value(404));
        }

        @Test
        @DisplayName("取消已入库的采购单：409（业务不允许回退）")
        void cancelReceived() throws Exception {
            seed("PO-5", "已入库", 10);
            mvc.perform(post(BASE + "/PO-5/cancel"))
                    .andExpect(status().isConflict())
                    .andExpect(jsonPath("$.code").value(409))
                    .andExpect(jsonPath("$.message", containsString("已入库")));
        }

        @Test
        @DisplayName("入库已取消的采购单：409")
        void receiveCancelled() throws Exception {
            seed("PO-6", "已取消", 10);
            mvc.perform(post(BASE + "/PO-6/receive"))
                    .andExpect(status().isConflict())
                    .andExpect(jsonPath("$.code").value(409))
                    .andExpect(jsonPath("$.message", containsString("已取消")));
        }

        @Test
        @DisplayName("方法不支持：405 也折成统一信封（不返回 Spring 默认 /error 裸结构）")
        void methodNotAllowed() throws Exception {
            mvc.perform(put(BASE))
                    .andExpect(status().isMethodNotAllowed())
                    .andExpect(jsonPath("$.code").value(405))
                    .andExpect(jsonPath("$.message").exists());
        }

        @Test
        @DisplayName("请求体缺必填字段：非 2xx 且不写入数据")
        void createWithMissingFields() throws Exception {
            long before = repo.count();
            Map<String, Object> body = new HashMap<>();
            body.put("rawMaterialId", "RM-001");   // 缺 arrivalTime / arrivalQuantity 等
            mvc.perform(post(BASE).contentType(MediaType.APPLICATION_JSON)
                            .content(new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(body)))
                    .andExpect(status().is5xxServerError());
            assertThat(repo.count()).isEqualTo(before);
        }
    }

    // ─── 边界条件 ────────────────────────────────────────────────────────────

    @Nested
    @DisplayName("边界条件")
    class Boundary {

        @Test
        @DisplayName("重复取消：幂等成功，不报错")
        void cancelTwiceIsIdempotent() throws Exception {
            seed("PO-7", "待入库", 10);
            mvc.perform(post(BASE + "/PO-7/cancel")).andExpect(status().isOk());
            mvc.perform(post(BASE + "/PO-7/cancel"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.code").value(0))
                    .andExpect(jsonPath("$.data.status").value("已取消"));
        }

        @Test
        @DisplayName("重复入库：幂等成功且库存不重复累加")
        void receiveTwiceDoesNotDoubleCount() throws Exception {
            seed("PO-8", "待入库", 30);
            seedInventory(50, 100, 80);

            mvc.perform(post(BASE + "/PO-8/receive")).andExpect(status().isOk());
            mvc.perform(post(BASE + "/PO-8/receive"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.code").value(0));

            Inventory inv = inventoryRepo.findByRawMaterialId("RM-001").orElseThrow();
            assertThat(inv.getCumulativeStockQuantity()).isEqualTo(130);
            assertThat(inv.getAvailableQuantity()).isEqualTo(110);
        }

        @Test
        @DisplayName("库存行不存在时入库自动补建，保证账实一致")
        void receiveCreatesMissingInventory() throws Exception {
            seed("PO-9", "待入库", 25);
            assertThat(inventoryRepo.findByRawMaterialId("RM-001")).isEmpty();

            mvc.perform(post(BASE + "/PO-9/receive")).andExpect(status().isOk());

            Inventory inv = inventoryRepo.findByRawMaterialId("RM-001").orElseThrow();
            assertThat(inv.getRawMaterialName()).isEqualTo("高强度钢板");
            assertThat(inv.getCumulativeStockQuantity()).isEqualTo(25);
            assertThat(inv.getAvailableQuantity()).isEqualTo(25);
        }

        @Test
        @DisplayName("待入库数量小于到货量时，待入库口径按下限 0 保护（不出负数）")
        void pendingReceiptNeverGoesNegative() throws Exception {
            seed("PO-10", "待入库", 30);
            seedInventory(10, 0, 0);

            mvc.perform(post(BASE + "/PO-10/receive")).andExpect(status().isOk());

            Inventory inv = inventoryRepo.findByRawMaterialId("RM-001").orElseThrow();
            assertThat(inv.getPendingReceiptQuantity()).isZero();
            assertThat(inv.getCumulativeStockQuantity()).isEqualTo(30);
        }

        @Test
        @DisplayName("查询不带任何过滤条件时返回全部")
        void queryWithoutFilters() throws Exception {
            seed("PO-11", "待入库", 10);
            seed("PO-12", "待入库", 10);
            mvc.perform(get(BASE))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.data", hasSize(2)));
        }

        @Test
        @DisplayName("过滤参数为空串时按「不过滤」处理（不误当成过滤条件）")
        void queryWithBlankFilters() throws Exception {
            seed("PO-13", "待入库", 10);
            mvc.perform(get(BASE).param("purchaseOrderId", "").param("rawMaterialId", ""))
                    .andExpect(jsonPath("$.data", hasSize(1)));
        }

        @Test
        @DisplayName("无匹配结果时返回空数组而非报错")
        void queryNoMatch() throws Exception {
            mvc.perform(get(BASE).param("rawMaterialId", "RM-not-exist"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.code").value(0))
                    .andExpect(jsonPath("$.data", hasSize(0)));
        }

        @Test
        @DisplayName("可选的关联订单字段为空串时落库为 null（不存空串）")
        void createNormalizesBlankOptionalFields() throws Exception {
            Map<String, Object> body = createBody();
            body.put("relatedOrderId", "");
            body.put("relatedOrderName", "");
            mvc.perform(post(BASE).contentType(MediaType.APPLICATION_JSON)
                            .content(new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(body)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.data.relatedOrderId").doesNotExist());
        }

        @Test
        @DisplayName("到货数量以字符串传入时也能解析（兼容前端表单序列化）")
        void createAcceptsNumericString() throws Exception {
            Map<String, Object> body = createBody();
            body.put("arrivalQuantity", "42");
            mvc.perform(post(BASE).contentType(MediaType.APPLICATION_JSON)
                            .content(new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(body)))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.data.arrivalQuantity").value(42));
        }
    }
}
