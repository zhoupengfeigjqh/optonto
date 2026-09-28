# 实施计划：core-backend 分层重构与 business-backend 并发一致性加固

**特性分支**: `002-backend-layering-consistency` · **对应规范**: [spec.md](./spec.md) · **日期**: 2026-09-28

## 摘要

在**现有代码基础上增量加固**后端：先修数据一致性（并发锁、库存回写、幂等），再收敛 core-backend 分层
（路由层不得直接做文件 I/O），最后补接口文档。对外接口路径与响应结构保持不变。

## 技术上下文

- business-backend：Spring Boot 3.2 + JPA + MySQL 8（`purchase_record` / `inventory` 等 6 表）
- core-backend：FastAPI + 文件型存储（`.data`），`routers` / `services` / `schemas` 分层
- agent-backend：Express，已在前序批次统一错误契约为 `{code,message,detail,error}`
- 迁移脚本：`mysql/migrations/`（存量库）；新建库由 `mysql/init/01-schema.sql` 直接建好

## 宪法检查（Constitution Check）

| 章程条款 | 本计划如何满足 |
|---|---|
| II 后端分层 | P2 把路由层文件 I/O 下沉到数据访问层；业务层不依赖 HTTP 类型 |
| III 测试 | 业务后端补 Spring 测试基础设施（`spring-boot-starter-test`）并覆盖状态机/幂等/冲突分支 |
| V 性能 | 库存按 `raw_material_id` 精确查找（唯一索引支撑），不走 `Containing` 全表扫描 |
| VI 数据一致性 | `@Version` 乐观锁 + 同事务库存回写 + 幂等 + 非法状态迁移 409 + 统一错误体 |
| 技术治理 | 新增 `spring-boot-starter-test`（测试期依赖，章程 III 强制要求） |

## 实施策略

### P1 并发一致性（已完成）

1. **乐观锁**：`PurchaseRecord` 加 `@Version`；DB 加 `version BIGINT NOT NULL DEFAULT 0`（init + 迁移）。
2. **状态机**：收敛为「待入库 → 已入库 / 已取消」；非法迁移返回 409（不入库改为不可取消、已取消不可入库）。
3. **幂等**：已是目标状态时直接返回成功，**不重复累加库存**。
4. **库存回写**：`receive` 在同一事务内回写 `pending -Q / cumulative +Q / available +Q`（下限 0 保护）；
   库存行缺失时按采购单信息补建。
5. **冲突语义**：`ObjectOptimisticLockingFailureException` → 409 `{code,message}`（统一错误体）。
6. **契约不变**：响应字段与既有 `outputSchema` 完全一致（不新增字段），避免破坏 MCP 下游校验。

### P2 core-backend 分层（待实施）

按风险从低到高推进，每步保持接口行为不变：

1. 新增 `repositories/`（或 `storage/`）层，封装 `.data` 文件读写（原子写、路径校验、mtime 指纹）。
2. 逐路由替换：`threads` → `skills` → `functions`/`common_functions` → `deploy` → `chat` → `ontologies`。
3. `services` 去除 `fastapi.Request` / `HTTPException` 依赖，改抛领域异常，由路由层映射为 HTTP。
4. 每步用既有 pytest 用例回归（`core-backend/tests`）。

### P3 接口文档（待实施）

- business-backend 引入 springdoc-openapi，暴露 `/swagger-ui` 与 `/v3/api-docs`，覆盖全部 REST 端点。

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| 乐观锁导致高频冲突影响可用性 | 冲突场景仅限同一采购单并发写；返回 409 并提示重试，语义明确 |
| 库存回写改变既有演示数据 | 回写是规范要求的账实一致；响应结构不变，下游无感 |
| 存量库缺 `version` 列导致启动失败 | 提供一次性迁移脚本并在本批已应用到运行库 |
| core 分层重构面大 | 分路由小步推进，每步跑回归；不做一次性大爆炸式改造 |

## 验收方式

- 单号并发生成：并发创建 20 次无重复单号（唯一索引兜底）
- 状态机：重复入库不重复累加；已入库取消返回 409；非存在返回 404
- 库存对账：入库后 `cumulative +Q`、`available +Q`、`pending` 不为负
- 乐观锁：`version` 随更新递增；并发冲突返回 409 结构化错误
- 分层：core-backend 路由层文件 I/O 调用数为 0
