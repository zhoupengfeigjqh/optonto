# OPTONTO 运行时架构演进方案：三 MCP 服务 + 映射中置 + 可见性管控

**日期**：2026-09-06 · **状态**：已确认，待实施 · **原则**：高内聚、低耦合

---

## 一、总体架构

```
┌─ 设计面（控制面）──────────────────────────────────────────────┐
│ core-backend                                                  │
│  本体建模 CRUD · 数据引擎 CRUD · LLM 智能映射（analyze-mapping） │
│  部署 · 页面 API · 运行期执行职能：归零                          │
└──────────────────────┬───────────────────────────────────────┘
                       │ 唯一耦合：.data 文件契约 + mtime 指纹热加载
┌─ 运行面（数据面）──────┴───────────────────────────────────────┐
│                                                               │
│  Agent（agent-backend 编排面：规划/规则闸/安全/记忆，本轮不变）    │
│    │ SSE 直连三个内置 MCP 服务，对外只讲 MCP 一种协议              │
│    │                │                        │                │
│    ▼                ▼                        ▼                │
│ ┌───────────┐ ┌───────────────────┐ ┌─────────────────────┐  │
│ │optonto-    │ │optonto-data-       │ │optonto-business-mcp │  │
│ │ontology-mcp│ │engine-mcp（新）     │ │（新）                │  │
│ │            │ │                   │ │                     │  │
│ │本体查询list*│ │行为 facade 工具    │ │业务接口原始工具        │  │
│ │本体函数     │ │★ 映射执行（前后翻译）│ │纯业务适配器，          │  │
│ │公共函数     │ │MCP 分发：目标由     │ │不知本体/映射/Agent    │  │
│ │本地沙箱     │ │ data_engine.target │ │                     │  │
│ │            │ │ 决定（非固定下游）   │ │                     │  │
│ │            │ │SQL 型行为+只读闸    │ │                     │  │
│ └───────────┘ └─────────┬─────────┘ └─────────▲───────────┘  │
│                         │ MCP Client callTool │               │
│                         └─────────────────────┘               │
│                                                  │ REST        │
│                                           ┌──────▼──────┐      │
│                                           │business-     │      │
│                                           │backend(Java) │      │
│                                           └─────────────┘      │
└───────────────────────────────────────────────────────────────┘
```

**核心语义**：data-engine-mcp 是**映射代理（mapping proxy）**——站在所有"需要映射的下游 MCP 服务"前面统一做前后翻译；business-mcp 只是当前主要下游，不是唯一下游。

---

## 二、命名体系

| 旧名 | 新名 | 职责 |
|---|---|---|
| optonto-mcp | **optonto-ontology-mcp** | 本体语义面：list 查询、本体函数、公共函数（本地沙箱） |
| —（新服务） | **optonto-data-engine-mcp** | 映射执行面：行为 facade、前后翻译、SQL、MCP 分发 |
| —（新服务） | **optonto-business-mcp** | 业务集成面：业务 REST 包装为 MCP 工具 |

同构命名 `optonto-<职责>-mcp`。改名在阶段一同步完成（compose/nginx/mcp-config-store/前端文案机械替换）；agent-backend 内置身份识别已有"builtin 标记 + 当前 URL + 历史默认 URL"三重判定，旧配置文件兼容。端口不变（ontology-mcp 仍 8002），Agent 侧无感。

---

## 三、职责矩阵（高内聚）

| 服务 | 唯一职责 | 不知道什么 |
|---|---|---|
| optonto-ontology-mcp | 本体查询、本体/公共函数沙箱 | 业务接口、映射 |
| optonto-data-engine-mcp | **映射与执行的唯一权威**：facade、翻译、SQL+只读闸、参数契约检查、MCP 分发 | 下游接口实现细节（只见 MCP 工具） |
| optonto-business-mcp | 业务 REST → MCP 工具，自描述 input/outputSchema | 本体、映射、Agent |
| core-backend | 设计期：建模、映射生成/存储、部署 | 运行期执行（归零） |
| agent-backend | 编排：规划、RuleGate、安全确认、记忆 | 映射（从不接触，本轮不变） |

**协议身份**：三个运行面服务对 Agent 均为 MCP Server；data-engine-mcp 对下游 MCP 服务是 MCP Client（MCP Proxy 形态）；business-mcp 对 Java 是 HTTP Client。

**低耦合三原则**：
1. 服务间契约 = MCP 协议或 `.data` 文件，无私有 API；
2. 运行面不回调 core（core 宕机不影响运行时）；
3. 映射数据落盘自包含（server_url + tool_name 直存，不引用外部注册表）——远程服务改地址只需改一条配置。

---

## 四、仓库目录结构（三服务三文件夹 + 共享库）

```
optonto/
├── core-backend/              # 纯设计面：建模 CRUD、analyze-mapping、部署、页面 API
│   └── （mcp_server_sse.py、data_engine.py 迁出，执行职能归零）
│
├── ontology-mcp/              # optonto-ontology-mcp 容器
│   ├── server.py              # 协议层（薄）：SSE、工具注册、list*/函数路由
│   ├── Dockerfile             # build context = 仓库根（要带 mcp-shared）
│   └── requirements.txt
│
├── data-engine-mcp/           # optonto-data-engine-mcp 容器
│   ├── server.py              # 协议层（薄）
│   ├── facade.py              # 行为工具生成：命名、约束编译 schema、scope 剥离
│   ├── executor.py            # MCP 分发（连接池+重连+15s 超时）/ SQL（只读闸+连接池）+ 契约检查
│   ├── Dockerfile
│   └── requirements.txt
│
├── business-mcp/              # optonto-business-mcp 容器
│   ├── server.py              # 协议层 + REST 适配（配置驱动）
│   ├── config/tools.yaml      # 工具名 → Java REST 端点 + input/outputSchema 声明
│   ├── Dockerfile
│   └── requirements.txt
│
└── mcp-shared/                # 三服务共用的构建期库（不是服务、不起容器）
    ├── loaders.py             # 直读 .data + mtime 指纹热加载
    ├── mapper.py              # _translate_input / _translate_output（逐字迁自 data_engine.py）
    ├── sandbox.py             # 函数 exec + 受限 globals + run(params) 约定
    └── mcp_base.py            # SSE Starlette 骨架、OAuth issuer 推导、/health /tools 端点
```

**关键决策**：
- `mcp-shared/` 是**构建期库**：三个 Dockerfile 的 context 均为仓库根，各自 `COPY mcp-shared/`。运行时三服务零相互依赖；映射翻译/沙箱/指纹加载只有一份实现，改一处三个服务下次构建同时获得——杜绝"复制三份必漂移"。
- 各服务私有物留在各自文件夹（facade/executor 属 data-engine-mcp，tools.yaml 属 business-mcp）。
- core-backend 迁出物：`mcp_server_sse.py` 拆解（骨架→mcp_base、list*/函数→ontology-mcp、行为 facade→data-engine-mcp/facade.py）；`services/data_engine.py` 拆分为 mapper+executor；`Dockerfile.mcp` 拆为三个。

---

## 五、映射代理分发模型

调用行为工具时，data-engine-mcp 按行为绑定的 target 分发：

```yaml
target:
  server_url: http://optonto-business-mcp:8004/sse   # 下游是谁，配置说了算
  tool_name: query_raw_material
```

| engine_type | 分发去向 |
|---|---|
| `MCP` | target.server_url 指定的**任意**下游 MCP 服务（business-mcp 或外部远程 MCP——"外部 MCP 也要映射"场景天然覆盖，无需新机制） |
| `SQL` | 不走 MCP 分发，直连 MySQL（只读闸+连接池本地） |

---

## 六、可见性管控（治理核心）

**问题**：同一业务接口可能双边暴露（business-mcp 原始工具 + data-engine-mcp 行为工具）。Agent 直连原始工具将绕过映射、RuleGate 规则闸、安全管控（均按行为名匹配），且双工具并存令 LLM 规划不可预测。

**策略：配映射即收编**

| 接口状态 | 下游 MCP 原始工具 | data-engine-mcp 行为工具 |
|---|---|---|
| 已配映射（绑定行为） | **对 Agent 隐藏** | ✅ 唯一入口 |
| 未配映射（通用查询） | ✅ 直通暴露 | — |

**实现**：agent-backend 挂载下游 MCP 时按 `allowed_tools` 白名单过滤（机制已有）；隐藏清单由 data-engine-mcp 同步映射配置时自动生成（凡 `engine_type: MCP` 的 target 工具名即入对应服务的隐藏名单），零人工维护。E2E 增加"已映射接口的原始工具不可见"断言。

**命名约定**：行为工具 = 行为名（本体语义），原始工具 = 接口名，天然不撞名。

---

## 七、数据模型

`data_engines.yaml`（落盘自包含）：

```yaml
# MCP 型（新增；HTTP 型废弃）
- name: 查询原材料库存
  behavior_name: queryRawMaterial
  engine_type: MCP
  target:
    server_url: http://optonto-business-mcp:8004/sse
    tool_name: query_raw_material
    output_fields: [stockQty, ...]    # 可选：无 outputSchema 时手工/试调录入的目标输出字段
  input_mapping: {材料编号: materialCode}
  output_mapping: {库存数量: stockQty}

# SQL 型（不变）
- name: 库存汇总
  behavior_name: sumInventory
  engine_type: SQL
  sql: SELECT material_code AS 材料编号, SUM(qty) AS 库存总量 ...
```

要点：target 存**解析后的 server_url + tool_name**；映射本质是字典，运行期 `_translate_*` 只换名不校验 schema，字段清单仅为设计期参照。

---

## 八、API 映射页改造（七条需求）

| # | 需求 | 实现 |
|---|---|---|
| 1 | 目标接口=下拉选已配置 MCP 服务 | 数据源 `GET /agent-api/mcp-config`（已有）；选中即解析 URL 落盘 |
| 2 | 接口地址=选该服务下的函数 | 对该服务 `listTools` 拉清单做二级下拉（复用 `/mcp-config/test` 逻辑拆只读端点） |
| 3 | 删除方法选择 | engine_type=MCP 后无意义，schema+前端同删 |
| 4 | 删除复制本体参数 | schema 自动提取后无此需求 |
| 5 | 删除智能解析 | schema 来自 listTools 权威源，不再粘贴文档 |
| 6 | 编辑输入/输出=自动提取 schema | 输入用 `inputSchema`；输出按 §九 降级链提取 |
| 7 | 输入/输出映射、智能对齐、智能映射不变 | `analyze-mapping` LLM 逻辑不动，输入从手工名单升级为真实 schema |

**DB 映射不变**：SQL 引擎同名占位 + `AS` 别名约定原样。

---

## 九、远程 MCP 支持

架构对本地/远程 MCP 一视同仁（全链路只认 SSE URL），但有四个约束：

**1. 网络可达性（两侧都要通）**
- 设计期：映射页 listTools/试调由后端代发，**后端容器**须连通远程地址
- 运行期：**data-engine-mcp 容器**须连通远程地址执行
- 公网服务需确认容器出网策略、防火墙、代理

**2. outputSchema 降级链**（第三方远程 MCP 几乎不声明 outputSchema）：

```
有 outputSchema     → 自动提取（首选；自家 business-mcp 强制声明）
无，但可调通        → 「试调提取」按钮：拿样例参数真实 callTool 一次，从响应反推字段
调不通/不愿调       → 手工录入字段（兜底，存入 target.output_fields）
```

三种来源对映射与运行期完全透明——映射只是键值对，运行期不校验 schema。**编辑输入/输出保留手工编辑能力**。

**3. 鉴权扩展（前置缺口，阶段三补）**
远程 MCP 大多需认证（Bearer token / OAuth）。mcp-config 服务条目加 `headers` 字段，MCPClient 连接时携带；data-engine-mcp 的 MCP 客户端同样支持。

**4. 可见性管控同样适用且更重要**
远程工具字段名/错误语义不可控，"配映射即收编"对远程服务严格执行。

---

## 十、运行期链路

```
映射路径：Agent → data-engine-mcp 行为工具 → 输入映射
        → callTool 下游 MCP（target 决定）→ 输出映射 → Agent
直透路径：Agent → business-mcp 原始工具 → Java REST → 原样返回（未配映射）
SQL 路径：Agent → data-engine-mcp SQL 行为 → 占位替换 → 只读闸 → MySQL
```

**错误穿透**：下游 `isError` → data-engine-mcp 转 RuntimeError → Agent `isError`，与现有报错预算语义对齐。

---

## 十一、core-backend 与 agent-backend 改动

**core-backend**：
- `data_engine.py` 物理迁出（mapper + executor 进 mcp-shared / data-engine-mcp），core 不留副本（消灭双路径）
- `POST /api/ontologies/{id}/behaviors/{name}/call` 降级为转发 data-engine-mcp（env `DATA_ENGINE_MCP_URL`），设计器测试与 Agent 走同一路径
- analyze-mapping / smart-parse（smart-parse 随映射页改造删除）/ 数据引擎 CRUD 保留

**agent-backend**：
- 内置服务 1 → 3 个（ontology / data-engine / business），business-mcp 条目带自动生成的 allowed_tools
- MCPClient 补 headers/auth 支持（远程服务前置）
- 身份识别沿用 builtin 标记 + URL 机制，旧配置兼容

---

## 十二、配置收口（docker-compose）

| 容器 | env |
|---|---|
| optonto-ontology-mcp | `DATA_DIR=/app/.data`（已有） |
| optonto-data-engine-mcp | `DATA_DIR=/app/.data`、`DB_HOST/PORT/USERNAME/PASSWORD/NAME` |
| optonto-business-mcp | `BUSINESS_API_BASE=http://optonto-business-backend:8080` |
| optonto-core-backend | `DATA_ENGINE_MCP_URL=http://optonto-data-engine-mcp:8005` |
| optonto-agent-backend | 三个内置 MCP 条目 URL |

---

## 十三、迁移阶段

1. **阶段一**：建四文件夹骨架（三服务 + mcp-shared）→ 代码迁移（mcp_server_sse.py 拆解、data_engine.py 拆分）→ 三服务更名（compose/nginx/mcp-config-store/前端文案）→ core 端点降级转发——HTTP 型暂保留，可回滚
2. **阶段二**：business-mcp 薄服务 + `engine_type: MCP` 分发器 + Java 侧端点包装（tools.yaml 声明） ✅ 已落地（2026-09-07）
   - business-mcp：config/tools.yaml 声明 8 个工具（Java 五控制器全覆盖），input/outputSchema 强制（缺一条启动即失败）；信封 code!=0 / HTTP≥400 → isError 穿透；null 字段递归剔除
   - **协议约束落地形态**：structuredContent 只能是对象且过 SDK jsonschema 校验 → 查询类数组负载统一包 `{"result": [...]}`，文本通道与 structured 同负载（单一形状，映射路径面向它）
   - **MCP 分发器**：逐调用建连（同一 task 内 connect→call→close），不做跨请求会话缓存——anyio cancel scope 不能跨 task 关闭，缓存会话并发下关闭即炸（实测）；15s 总超时；isError → RuntimeError 穿透
   - core schema 放行：TargetApiConfig + server_url/tool_name/output_fields；MCP 型引擎无 method 语义，op_type 推导落 query（写行为须显式 op_type=command）
   - 验证：pytest 20/20（新增 decls 校验 4 + MCP 分发 4）；docker 实测映射路径（中文字段换名+白名单）、直透路径、错误穿透三条全通
3. **阶段三**：~~agent-backend 三内置挂载~~（阶段一已按"双内置"落地：business-mcp 是模拟业务系统须手工配置，不内置）+ 可见性管控（配映射即收编）+ MCPClient 鉴权扩展 ✅ 已落地（2026-09-07）
   - **可见性收编**：新模块 `agent-backend/src/services/visibility-guard.ts`——扫 `.data` 全本体 data_engines（独立文件优先 / ontology.yaml 旧段回退，与 OntologyGateway 同口径），engine_type=MCP 的 `target.server_url+tool_name` 进隐藏索引（URL 规范化去尾斜杠，`{count}:{最新mtime}` 指纹缓存免每次重扫）；discoverTools 对**非内置**服务隐藏命中工具（覆盖用户 allowed_tools），内置服务永不收编
   - **headers 鉴权**：mcp-config 服务条目 + `headers` 字段 → MCPClient 经 SSEClientTransport 的 requestInit/eventSourceInit 携带（eventsource npm 包支持自定义头）；data-engine-mcp 侧 `target.headers` 透传 `_mcp_call_tool` 连接；/mcp-config/test 探针接受 headers 并透出 outputSchema（阶段四映射页数据源）
   - 验证：vitest 291/291（新增 visibility-guard 6 + discoverTools 收编接线 2）、pytest 21/21（headers 透传 +1）、E2E `e2e-visibility-guard.py` 全过（收编日志断言 + 设计期探针不受收编影响 + 内置不收编），facade/prerule/error-budget/legal-list 回归全绿
4. **阶段四**：前端 API 映射页改造（§八 七条 + 试调提取按钮 + 手工录入兜底）+ 三卡启停面板 ✅ 已落地（2026-09-07）
   - 后端：agent-backend 新增 `POST /mcp-config/tools`（只读 listTools，二级下拉数据源）与 `POST /mcp-config/call-tool`（试调提取：真实 callTool 一次，isError 穿透）；core `GET /api/mcp/business/status` 只读（start/stop 仍白名单 404 硬边界）；nginx 新增 `/mcp-data-engine/` 代理
   - 映射页七条：目标接口=非内置 MCP 服务下拉 → 工具二级下拉（showSearch）；选中即自动提取 inputSchema→target.params / outputSchema→target.response（JSON Schema→平台结构转换），无 outputSchema 时"试调提取"按钮（样例参数预填→真实调用→响应反推字段）+ 手工编辑兜底；方法选择/复制本体参数/智能解析（含 core smart-parse 路由与前端 smartParseTarget）已删除；保存落 `engine_type: MCP` + server_url/tool_name + headers 快照；旧 HTTP 配置回显迁移提示；智能对齐/智能映射/映射弹窗原样
   - 三卡面板：ontology/data-engine 可启停（停止弹确认：中断行为调用/Agent 瘫痪文案），business-mcp 只读状态 + "请在 Docker 手动启停"提示
   - 验证：tsc 净、vitest 291/291、pytest 21/21、E2E 五脚本全绿；端点实测（business status、/mcp-data-engine/tools、tools 8 条含 outputSchema、call-tool 成功+错误穿透）
5. **阶段五**：存量 HTTP 型引擎手工改绑（URL→工具对应只有人知道，不自动迁移）→ HTTP 型正式删除 ✅ 已落地（2026-09-07）
   - 本仓库存量 8 条 API 引擎的 URL↔工具对应明确（business-mcp 即这些端点的适配器），用一次性脚本 `scripts/migrate-http-engines-to-mcp.py`（dry-run 默认 + `--apply` + 自动备份 .p5bak）改绑：engine_type→MCP、落 server_url/tool_name、清 url/method；输出映射路径重写——查询类 `data[*].x→result[*].x`、变更类 `data.x→x`，code/data 信封壳条目丢弃（新形态无壳）；input_mapping/params/response 不动
   - HTTP 执行路径删除：executor `_call_engine` 改为兜底报错（"请在映射页重新选择 MCP 服务与工具"）；mcp-shared `http_call`/`_substitute_path_params`/`_is_json` 与 httpx 依赖移除；core schema engine_type 默认 MCP、描述改 "SQL/MCP"
   - 验证：改绑后设计期调用逐条实测（QueryInventory 白名单换名、QuerySuppliers、SQL 引擎不受影响），E2E 五脚本全绿（facade 写路径 CreatePurchaseRecord 走 MCP 建单成功）、pytest 21/21、vitest 291/291、tsc 前后端净

每阶段独立验证，任一阶段停下系统可运行。

---

## 十四、搭车修复与风险

**搭车**：① SQL 输出列名 vs 行为返回字段 warn-only 校验（补静默劣化缺口）；② `_translate_*` 嵌套/数组场景补单测。

| 风险 | 对策 |
|---|---|
| 可见性管控失效 → 规则被绕过 | 清单配置自动生成而非手维护；E2E 断言兜底 |
| data-engine-mcp→下游会话稳定性 | 连接池+断线重连+15s 超时（参考 agent-backend MCPClient） |
| 远程 MCP 鉴权/可达性 | headers 扩展（阶段三）；部署 checklist 确认两侧出网 |
| 存量引擎双形态并存期 | 阶段五前 HTTP 型可用；迁移清单逐条核对 |
| core 转发链路断裂（data-engine-mcp 宕机） | 转发 5s 超时+明确报错；healthcheck 依赖编排 |

---

## 十五、验证方案

- vitest 全量（agent-backend 三内置挂载、可见性过滤新增单测）
- Python 侧：mapper/executor 单测（迁移前后同一用例对比返回）
- E2E：现有 `e2e-*.py` 走 core 转发路径不变 + 新增"映射路径 / 直透路径 / 可见性收编 / 远程 MCP（mock）"四场景
- 设计器手工回归：映射页七条交互 + 试调提取 + 手工录入逐条过

---

## 十六、服务启停管控（2026-09-06 补充）

**边界**：ontology-mcp / data-engine-mcp 前端可启停；business-mcp **只能用户在 Docker 手动启停**，前端只读显示状态。

**理由**：前两者是平台运行时底座（基础设施级），UI 运维开关合理；business-mcp 是集成边缘——它启动即意味着业务系统真实接口进入 Agent 可调用面，启停必须是显式运维决策，且与可见性管控形成双层防护（服务未起 → 接口不存在；起了 → 已映射的原始工具仍对 Agent 隐藏）。

**实现**：
- `mcp_ctl.py`：写死容器名 → **白名单映射** `{ontology: optonto-ontology-mcp, data-engine: optonto-data-engine-mcp}`，路由变 `/api/mcp/{service}/start|stop|status`；business-mcp 不进白名单（API 层硬边界）。严禁收任意容器名——docker.sock 等价宿主机 root。
- 前端 MCPService 面板：单卡片 → 三卡片。ontology / data-engine 可启停；business-mcp 只读状态 + "请在 Docker 中手动启动"提示。
- 停止确认：停 data-engine-mcp / ontology-mcp 弹确认（中断行为调用 / Agent 基本瘫痪）。
- compose：business-mcp 不配 `restart: unless-stopped`（默认不自动拉起，由人控制）；另两个可配。

**降级行为**：

| 场景 | 表现 |
|---|---|
| business-mcp 未启动 | 映射调用连不上下游 → isError 穿透；直透工具 listTools 失败自动消失；本体查询/函数不受影响 |
| data-engine-mcp 停止 | 行为全部不可用，本体查询/函数可用 |
| ontology-mcp 停止 | Agent 基本瘫痪 |

**落点**：白名单改造随阶段一（更名同步换容器名）；面板三卡片随阶段四。

---

## 十七、SQL 型与 behavior_type 彻底删除（2026-09-07 拍板落地）

阶段五之后追加的收口：DB 映射（SQL 引擎）整条线与行为"接口类型"字段全部删除，引擎唯一形态=MCP。

- **.data**：QuerySupplierCapabilitySQL 行为+引擎+安全条目+db_schema/ 目录全删；全部 ontology.yaml/onto_template.yaml 的 `behavior_type` 剥离；data_engines.yaml 的 `engine_type` 随下次保存自然消失（schema 已删字段）。
- **core-backend**：`routers/db_schema.py` 整删（路由+注册）；`generate-sql` 路由与 `DB_GENERATE_*` 提示词删除；需求提示词"接口类型（SQL/API）"讨论要求与总表列删除；`_resolve_op_type` 简化为 **op_type 唯一权威，空即 query**（引擎不再参与推导，三端契约同步改写，契约用例 T1-T7 → T1-T4）。
- **data-engine-mcp**：executor `execute_sql`/MySQL 连接池删除，`_ensure_mcp()` 兜底——显式标已删除类型（SQL/HTTP）的旧配置报 ValueError 引导重配；requirements 去 mysql-connector；compose 去 DB_HOST/DB_PORT 环境变量。
- **agent-backend**：`ontology-gateway` isWrite 同上简化；**visibility-guard 改"缺省即 MCP"**——target 配了 server_url+tool_name 即收编（engine_type 字段不再落盘，严格匹配会漏收编），显式标已删除类型的旧配置跳过。
- **frontend**：DBMappingTable/SqlEditor 整删；导航"API映射"更名**接口映射**，DB映射入口删除；BehaviorTable 删"接口类型"列与编辑 Select；SecurityTable/InstanceGraph 删 engine_type==='SQL' 分支；client.ts 删 getDbSchema/uploadDbSchema/generateSQL/callDataEngine 与 DataEngine.engine_type/sql、Behavior.behavior_type 字段。
- **验证**：core unittest 9/9、data-engine-mcp pytest 6/6（新增已删除类型报错兜底用例）、vitest 288/288、前后端 tsc 净。

## 十八、data_engines 输出映射回退修复（2026-09-07）

阶段五迁移后，原材料采购和库存 8 条引擎中 7 条的 output_mapping 被回退为迁移前形态
（含 code/data 壳条目与 data[*].x / data.x 目标路径），_translate_output 白名单将下游
{"result":[...]} 响应整体滤空，facade 返回 data:{}（表现为 QuerySupplierCapability 查无数据）。
根因未查明（疑似陈旧浏览器态触发 core 保存覆盖）。

修复：按 target.tool_name 的 query_ 前缀判定查询/变更，重写映射值
（data[*].x→result[*].x、data.x→x、剔除壳与空值条目），并为 5 条查询引擎补 `data: result`
壳换名（translator 只按映射换名，壳不改名会把 result 键原样留给行为返回）。
修复后 8 行为 facade 全通：QuerySupplierCapability(高强度钢板) 返回宝钢(leadTime 7)等真实行。
备份 data_engines.yaml.fixbak。

教训：facade E2E 必须断言响应内容（行数/字段），只断言 tool_call 事件会漏掉映射滤空。

---

**方案冻结。实施从阶段一开始。**
