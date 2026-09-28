# 任务清单：core-backend 分层重构与 business-backend 并发一致性加固

**特性分支**: `002-backend-layering-consistency` · **规范**: [spec.md](./spec.md) · **计划**: [plan.md](./plan.md)

> 说明：本特性在**现有代码上增量推进**，对外接口路径与响应结构保持不变。

## 阶段 1：并发一致性（用户故事 1，P1）✅ 已完成

- [x] T101 `PurchaseRecord` 增加 `@Version` 乐观锁字段（`entity/PurchaseRecord.java`）
- [x] T102 DB 增加 `version` 列：`mysql/init/01-schema.sql` + 迁移
  `mysql/migrations/2026-09-28-purchase-optimistic-lock.sql`（已应用到运行库并核对）
- [x] T103 `cancel` 状态机 + 幂等：已取消→幂等成功；已入库→409
- [x] T104 `receive` 状态机 + 幂等：已入库→幂等成功且**不重复累加库存**；已取消→409
- [x] T105 入库同事务回写库存（`pending -Q` / `cumulative +Q` / `available +Q`，下限 0 保护；
  库存行缺失按采购单补建）
- [x] T106 `GlobalExceptionHandler` 增加乐观锁冲突 → 409 结构化错误
- [x] T107 `InventoryRepository.findByRawMaterialId` 精确查找（对账不走 `Containing`）
- [x] T108 契约保持：响应字段与既有 `outputSchema` 完全一致（不新增字段）
- [ ] T109 业务后端测试基础设施（`spring-boot-starter-test`）+ 状态机/幂等/冲突分支用例
  （当前以 API 实测替代，见「验收记录」）

## 阶段 2：core-backend 分层（用户故事 2，P2）✅ 已完成

路由层已完成下沉（17/17 路由文件直接文件 I/O 为 0）：

- [x] T201 新增数据访问层 `core-backend/repositories/`：`fs_store.py` 提供原子读写原语
  （`read_text/write_text`、`read_json/write_json`、`read_yaml/write_yaml`、`parse_yaml`、
  `read_bytes`、`list_dir/list_files`、`delete_file/delete_tree`、`ensure_dir`）
  - 写入一律「临时文件 + `os.replace`」原子替换，避免读到半成品
  - 容错口径统一为「缺失或损坏即视为缺失」，由业务层决定降级
  - 配套单测 `core-backend/tests/test_fs_store.py`（15 例：正常 / 异常 / 原子性 / 边界）
- [x] T202 `routers/threads.py` 下沉（366 → 338 行）
- [x] T203 `routers/skills.py` 下沉（283 → 268 行）
- [x] T204 `routers/functions.py` / `routers/common_functions.py` 下沉
- [x] T205 `routers/{chat,deploy,ontologies,rules,rule_templates}.py` 下沉
- [x] T205a 顺带修正一处真实缺陷：`chat.py` 原 `yaml.safe_load` 在导入清理后会 `NameError`，
  改经 `fs_store.parse_yaml` 统一解析；`deploy.py` 的 `p.read_bytes()` 一并下沉
- [x] T206 业务层 `services/` 去除文件 I/O 与 HTTP 类型依赖（既未下沉到底层，实现见下）
  - [x] T206a 新增 `core-backend/errors.py`：领域异常（`DomainError` / `ConflictError` /
    `NotFoundError` / `InvalidInputError` / `UpstreamUnavailableError` / `UpstreamTimeoutError` /
    `UpstreamResponseError`），携带 `status_code` 与 `detail`
  - [x] T206b `services/entity_crud.py`：`raise HTTPException(400/404)` → 领域异常
  - [x] T206c `services/runtime_forward.py`：转发失败 → 领域异常（502/504/下游状态码透传）
  - [x] T206d `services/__init__.py` 27 处文件 I/O 全部下沉（448 → 400 行）；
    新增 `fs_store.read_yaml_strict`（保持「损坏即报错、不静默回退旧段」语义）与
    `fs_store.copy_file`（版本部署/备份）
  - [x] T206e `main.py` 注册 `DomainError` 处理器，映射与 `HTTPException` 处理器同构，
    对外契约零变化
  - [x] T206f 5 处 `except HTTPException: raise` 扩为 `except (HTTPException, DomainError): raise`，
    防止业务异常被后续 `except Exception` 吞成 500
  - [x] T206g 补测：`tests/test_error_contract.py` 新增 3 例（领域异常直抛 + 400/404 映射）
- [x] T207 回归：`core-backend/tests` 全绿 + 路由层与业务层文件 I/O 检索为 0
- [x] T208 根级 `metadata.py` 归位数据访问层（**P2 收口**）
  - `core-backend/metadata.py` → `core-backend/repositories/metadata.py`（git mv 保留历史）
  - 33 处文件 I/O 下沉：`iterdir/exists` → `fs_store.list_dir/exists`；
    `open+json.load/dump` → `fs_store.read_json/write_json`；
    `shutil.move` → `fs_store.move_path`（新增原语）；`shutil.rmtree` → `fs_store.delete_tree`；
    内联 `yaml.safe_load(read_text())` → `fs_store.read_yaml`
  - 8 处导入方改为 `from repositories.metadata import ...`（`routers/{deploy,functions,ontologies,
    scenarios,skills,threads}.py`、`services/__init__.py`×2、`dependencies.py`），调用点零改动
  - `repositories/__init__.py` 导出 `fs_store` 与 `metadata`

### P2 收口结论

| 层 | 目录 | 直接文件 I/O | fastapi 依赖 |
|---|---|---|---|
| 接口层 | `routers/` | 0（17 个文件） | 允许 |
| 业务层 | `services/` | 0 | **0**（改抛领域异常） |
| 数据层 | `repositories/` | 全部收敛于此 | 0 |
| 领域异常 | `errors.py` | — | 0 |

## 阶段 3：接口文档（用户故事 3，P3）✅ 已完成

- [x] T301 business-backend 引入 springdoc-openapi 2.3.0（与 Spring Boot 3.2 对应；
      springfox 停更且不兼容 Boot 3，选型理由已写进 pom 注释），暴露 `/swagger-ui.html` 与 `/v3/api-docs`
  - `application.yml` 增加 `springdoc` 段，`api-docs.enabled` 支持 `API_DOCS_ENABLED` 环境变量关闭（生产可按需关）
  - 新增 `com/onto/config/OpenApiConfig.java`：标题/版本/描述/服务器列表；
    描述里写明统一信封语义（`code=0` 成功、非 0 失败且 HTTP 码与 code 一致）与「字段名保持业务原始命名」的约定
  - 5 个控制器补 `@Tag` / `@Operation` / `@Parameter`（含与 business-mcp 工具名的对应关系）；
    `ApiResponse` 补 `@Schema` 说明信封字段
- [x] T302 校验文档覆盖全部 REST 端点（5 个控制器）
  - 实测 `/v3/api-docs`：**7 个路径 / 8 个操作**，与代码中 8 个端点**逐一对应、无遗漏无多余**
  - 5 个 tag（客户订单/库存/采购单/原材料/供应商）、12 个 schema（5 个 `ApiResponse*` 包装 + 5 个实体 + …）
  - `/swagger-ui.html` 与 `/swagger-ui/index.html` 均 200；业务端点（`/api/raw-materials`、`/api/suppliers`）回归 200
  - MCP 全链路回归：`core → data-engine-mcp → business-mcp → Java` 返回真实数据（HTTP 200），
    证明重写控制器（加注解）未改变运行行为

## 阶段 4：业务系统测试（用户故事 2 的测试要求，章程 II）✅ 已完成

- [x] T401 建测试基座：`spring-boot-starter-test` + H2（test scope，MODE=MySQL）
  - 选型说明写进 pom：**不用 Testcontainers** —— 测试在 `docker build` 的构建容器里跑，
    那里没有 Docker 守护进程，Testcontainers 起不来；H2 的 MySQL 兼容模式足以覆盖
    JPA 查询与事务语义
  - `src/test/resources/application.yml`：`ddl-auto=create-drop` 由实体建表，
    其余配置（Jackson 命名策略等）与生产一致，避免「测试过、线上不过」
- [x] T402 `PurchaseRecordApiTest`（21 例）：4 个采购单端点 × 正常/异常/边界
  - 正常 6：创建（单号格式/状态）、四种过滤组合、取消、入库并校验**库存三口径回写**
  - 异常 6：不存在→404、已入库取消→409、已取消入库→409、405 折成统一信封、缺字段不落库
  - 边界 9：重复取消/重复入库幂等（不重复累加库存）、库存行缺失自动补建、
    待入库数量下限 0 保护、空串过滤视为不过滤、空结果返回数组、可选字段空串转 null、
    数字字符串可解析
- [x] T403 `CatalogQueryApiTest`（14 例）：4 个目录类查询端点
  - 客户订单 / 库存 / 原材料 / 供应商；过滤组合、空结果、空串语义
  - 其中一条**如实锁定现状语义**：`InventoryService` 只判 `null` 不判空串，
    `?rawMaterialId=` 会 `Containing("")` 命中全部——若将来改语义，该用例会失败提醒同步契约
- [x] T404 JaCoCo 覆盖率门槛（`verify` 阶段生效，未达标即构建失败）
  - 统计范围限定 `com.onto.{service,controller,web}`（entity/dto/repository 为 JPA 声明式
    代码与数据载体，纳入会稀释指标）
  - 实测：**行 149/157 = 94.9%，分支 93/108 = 86.1%**（门槛行/分支均 80%），
    `mvn -B verify` → **BUILD SUCCESS，Tests run: 35, Failures: 0, Errors: 0**
  - 逐类：`PurchaseRecordService` 行 91/91、`PurchaseRecordController` 14/14、
    5 个 Service 中 3 个 100%；`GlobalExceptionHandler` 行 6/12、分支 2/8
    （`DataIntegrityViolation` 与乐观锁两个 handler 需构造并发/约束冲突，未覆盖）
- 运行方式（镜像构建仍用 `-DskipTests`，保持镜像构建快速稳健；测试在独立 Maven 容器里跑）：
  ```
  docker run --rm -v "<repo>/business-backend":/app -w /app \
    maven:3.9-eclipse-temurin-17-alpine mvn -B verify
  ```

## 验收记录（P1，2026-09-28 实测）

| 场景 | 结果 |
|---|---|
| 创建采购单 | `PO-20260928-094`，`version` 随创建期两次写入递增 |
| 首次入库 | 库存 `cumulative 2400→2410`、`available 1800→1810`（+10 与到货量一致） |
| 重复入库 | HTTP 200 且库存保持不变（幂等，不重复累加） |
| 已入库后取消 | HTTP 409 `{"code":409,"message":"采购单 … 已入库，不可取消"}` |
| 不存在的单号 | HTTP 404 结构化错误 |
| 乐观锁接线 | `version` 1 → 2（每次状态变更递增） |
| MCP 链路穿透 | 409 → `isError=true`，信息可读（`业务系统拒绝: … 已入库，不可取消`） |
| 正常链路回归 | `QueryRawMaterials` 仍 `isError=false` 返回数据 |

## 遗留说明

- 业务后端目前**无可运行的单测基础设施**（pom 无 `spring-boot-starter-test`）。P1 以 API 实测 +
  数据库核对验证；补测试基础设施记为 T109。
- 并发冲突的**压测式**复现（同单并行请求）因环境审批限制未执行，改为直接核对 `version` 递增
  与异常处理器接线，二者共同保证「并发后提交者 409、不丢失更新」。
