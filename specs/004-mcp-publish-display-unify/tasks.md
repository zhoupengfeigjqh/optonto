# 任务清单：MCP 发布页的配置展示与卡片结构统一

**输入**: 设计文档 `specs/004-mcp-publish-display-unify/`

**前置**: `plan.md`（必需）、`spec.md`（用户故事来源，必需）、`research.md`、`data-model.md`、`contracts/`、`quickstart.md`

**测试**: 本清单**包含测试任务**——项目章程原则 III 规定「测试强制覆盖（不可协商）」，且 `plan.md` 宪法检查已声明新端点补集成测试、纯函数与卡片补单测、跨仓护栏同步。

**组织方式**: 按用户故事分阶段，每个阶段可独立实现、独立测试、独立交付。

## 格式：`[ID] [P?] [Story] 描述`

- **[P]**：可并行（不同文件、不依赖未完成任务）
- **[Story]**：所属用户故事（US1 / US2 / US3）
- 每条任务都给出精确文件路径

## 路径约定

- 前端：`frontend/src/...`（Next.js App Router + React + TypeScript + antd + Tailwind）
- 后端：`core-backend/...`（FastAPI + Python）
- 文档：`specs/004-mcp-publish-display-unify/...` 与 `specs/contracts/...`

---

## Phase 1: 准备（共享基线）

**目的**：确认改动前状态可信，避免把既有失败误算成本次改动引入。

- [X] T001 按 `specs/004-mcp-publish-display-unify/quickstart.md` §1 跑基线门禁并记录结果（`frontend` 的 `npm test` / `npm run lint`；`core-backend` 的 `tests.test_mcp_publish` / `tests.test_service_topology_consistency`），结果追加到本文件末尾「进度记录」

---

## Phase 2: 基础（阻塞前置）

**目的**：本次不改存储、不加依赖、不新增目录，唯一跨故事的前置是「护栏正则的书写约束」——它约束所有阶段对 `catalog.ts` / `config-snippets.ts` 的编辑方式。

**⚠️ 关键**：本阶段完成前不要动 `catalog.ts` / `config-snippets.ts`。

- [X] T002 核对并记录两条护栏的解析约束到本文件「约束备忘」：`core-backend/tests/test_service_topology_consistency.py` 对 `frontend/src/components/Design/mcp-publish/catalog.ts` 的正则（`key: '…',` / `service: '…'` / `endpoint: '…'` / `transport: '…'` / 块尾 `\n  },` / 恰好 5 条）与对 `frontend/src/components/Design/mcp-publish/config-snippets.ts` 的正则（`key === 'functionExecutor'` 分支内的 `endpoints: [...]`、`clientTypeOf(def.transport)` 字样）

---

## Phase 3: 用户故事 1 - 固定发布「查看配置」两段式（优先级：P1）🎯 MVP

**目标**：本体查询 / 公共函数 / 业务系统三张对外卡片的「查看配置」统一输出「宿主段 + 容器内段」，业务系统不再回显平台内部条目；两个零工具底座不出片段。

**独立验证**：`specs/004-mcp-publish-display-unify/quickstart.md` §2（三张弹窗结构一致、两段可分别粘贴成功、业务系统无管理字段、底座无片段）。

### 测试（先行）

- [X] T003 [P] [US1] 扩充 `frontend/src/components/Design/mcp-publish/config-snippets.test.ts`：三服务均给两段且服务标识为 `optonto-ontology-query` / `optonto-common-function` / `optonto-business`；`type` 为 `http`；零工具底座（`dataEngine` / `functionExecutor`）不产出 `mcpServers`；片段不含 `enabled` / `business_data` / `allowed_tools`；headers 仅在匹配到配置条目时出现

### 实现

- [X] T004 [US1] 在 `frontend/src/components/Design/mcp-publish/catalog.ts` 的 `FixedServiceDef` 增加 `clientKey?: string` 与 `internalEndpoint?: string`，为三条对外服务填值（`http://optonto-ontology-query-mcp:8002/mcp`、`http://optonto-common-function-mcp:8007/mcp`、`http://optonto-business-mcp:8004/mcp`），两个底座留空；**保持既有行格式不变**（T002 约束）
- [X] T005 [US1] 重构 `frontend/src/components/Design/mcp-publish/config-snippets.ts`：新增通用两段生成（由 `endpoint` + `internalEndpoint` + `clientKey` + `clientTypeOf` 组装），业务系统不再返回 `null`；对外服务输出 `json`（宿主段）+ `extra[0]`（容器内段，标签沿用自建发布措辞）；两个零工具底座保留 `{internal: true, endpoint, endpoints: [...]}` 说明；新增请求头并入逻辑（按规范化 URL 匹配配置条目，匹配不到则不带 `headers` 且不报错）
- [X] T006 [US1] 修改 `frontend/src/components/Design/MCPPublish.tsx` 的 `openConfig`：删除 `getMCPConfig()` 整条回显分支与 `s.url.includes('business-mcp')` 嗅探；业务系统改为「先取 headers（失败降级为空 + 提示）→ 静态生成两段」；未登记时保留 FR-009 提示文案
- [X] T007 [P] [US1] 在 `core-backend/tests/test_service_topology_consistency.py` 增加断言：三个对外固定服务的 `internalEndpoint` 指向真实容器与容器内端口（复用 `assert_url_real`）、`clientKey` 唯一、片段代码中不出现管理字段名
- [ ] T008 [US1] 按 `specs/004-mcp-publish-display-unify/quickstart.md` §2 执行人工验证（界面两段 + 宿主/容器两向粘贴 + 底座无片段 + 业务未登记场景），结果记入「进度记录」
  - 状态：镜像已重建并重启（2026-10-19）；前端产物已含新片段代码。界面两段粘贴需人工点检（浏览器操作无法自动化）

**检查点**：US1 完成后即可单独交付——它修的是在网缺陷（业务系统片段不可粘贴）。

---

## Phase 4: 用户故事 2 - 自建发布卡片结构对齐（优先级：P2）

**目标**：两块卡片共享同一信息层级与状态口径；自建发布的令牌、本体、依赖、快照提示不丢失。

**独立验证**：`quickstart.md` §3.1（并排比对信息项与顺序、状态四态可用、1280×800 下完整可读）。

### 测试（先行）

- [X] T009 [P] [US2] 扩充 `frontend/src/components/Design/mcp-publish/cards.test.tsx`：自建卡片渲染端点/传输模式/可用工具数/令牌/本体/依赖快照提示；状态位文案与固定卡片同口径；`status='not_found'` 显示「容器缺失」

### 实现

- [X] T010 [US2] 在 `frontend/src/components/Design/mcp-publish/cards.tsx` 抽出共用展示原子：`StatusBadge`（检查中 / 运行中 / 已停止 / 容器缺失）与 `InfoRow`（标签 + 值），并让 `FixedServiceCard` 改用它（视觉与文案不变）
- [X] T011 [US2] 重排 `cards.tsx` 的 `PublishedServiceCard` 为统一层级：标题 + 类型标签 → 状态位 → 信息区（端点 → 传输模式 → 可用工具数）→ 领域行（类型与已选工具、本体、访问令牌、依赖与「发布时快照」）→ 按钮组（查看配置 / 启动·停止 / 删除）
- [X] T012 [US2] 同步 `frontend/src/components/Design/MCPPublish.tsx` 的自建卡片渲染与区块说明文案（与固定发布区块同口径；不改变任何启停/创建/删除行为）
- [ ] T013 [US2] 按 `specs/004-mcp-publish-display-unify/quickstart.md` §3.1 验证（并排比对 + 1280×800 视口 + 容器缺失态），结果记入「进度记录」
  - 状态：镜像已重建并重启（2026-10-19）；并排比对与视口检查待人工点检

**检查点**：US2 不依赖 US1，可与 US1 并行；完成后两块视觉一致，US3 才有放置入口的位置。

---

## Phase 5: 用户故事 3 - 自建发布「查看工具」（优先级：P3）

**目标**：新增只读端点返回发布时冻结的工具快照；自建卡片可按需查看工具（名称/描述/参数），并标注快照语义。

**独立验证**：`quickstart.md` §3.2/§3.3/§4（数量一致、参数可展开、停机可看、失败不冒充 0、404 语义）。

### 测试（先行）

- [X] T014 [P] [US3] 在 `core-backend/tests/test_mcp_publish.py` 增加 `/api/mcp/published/{name}/tools` 用例：成功形状（四字段 + 工具顺序）、`tools: []` 且 200、不存在时 404（且不是 200 空清单）
- [X] T015 [P] [US3] 在 `frontend/src/components/Design/mcp-publish/PublishModals.test.tsx` 增加：传入 `note` 时显示快照说明；`tools: []` 显示「0 个工具（发布时未勾选任何工具）」而非「暂无工具信息」

### 实现

- [X] T016 [US3] 在 `core-backend/services/mcp_publish_containers.py` 增加 `published_tools(name)`：读注册表条目返回 `{name, kind, ontology_name, tools}`，条目不存在抛既有 `NotFoundError`；不探测容器状态
- [X] T017 [US3] 在 `core-backend/routers/mcp_publish.py` 增加 `GET /{name}/tools` 路由（放在 `/{name}/client-config` 之后，复用同一 `runtime` 门面）
- [X] T018 [P] [US3] 在 `frontend/src/api/mcp.ts` 增加 `PublishedToolInfo` / `PublishedToolsResponse` 类型与 `getPublishedTools(name)`，并修正第 116 行过时注释（`type:"url"` → `http`/`sse`）
- [X] T019 [US3] 在 `frontend/src/components/Design/MCPPublish.tsx` 增加 `showPublishedTools(svc)` 编排：请求失败 → `message.error` 且不打开弹窗；成功 → 打开弹窗并附「发布时快照，修改本体后需重新发布才会更新」说明
- [X] T020 [US3] 在 `frontend/src/components/Design/mcp-publish/cards.tsx` 的自建卡片信息区增加「可用工具：N」与「查看工具」入口（`tool_count === 0` 时不渲染入口，与固定卡片一致）；同步 `PublishedCardProps` 增加 `onShowTools`
- [X] T021 [US3] 在 `frontend/src/components/Design/mcp-publish/PublishModals.tsx` 为 `ToolsModal` 增加可选 `note` 与「0 个工具」空态文案（不影响固定发布调用）
- [ ] T022 [US3] 按 `specs/004-mcp-publish-display-unify/quickstart.md` §3.2/§3.3/§4 验证并记录结果
  - 状态：接口级已通过（部署后经 nginx 复验：`raw_inventory_purchase_function` 200 / 6 个工具，`ghost` 404）；弹窗交互待人工点检

**检查点**：US3 依赖 US2 的入口位置；后端部分（T014/T016/T017）与前端部分可并行推进。

---

## Phase 6: 收尾与横切关注点

- [X] T023 [P] 同步契约文档：`specs/contracts/mcp-tools.md` §9.2（固定服务同样给两段片段）、§9.3（两段地址分工适用于固定服务）、§9.4（自建发布工具清单可从发布记录查看）
- [X] T024 [P] 清理口径注释：`frontend/src/components/Design/mcp-publish/config-snippets.ts` 模块头（业务系统不再异步回显）、`frontend/src/components/Design/mcp-publish/cards.tsx` 模块头（两块同构）、`core-backend/services/mcp_publish_registry.py::public_view` 文档串（工具清单走独立端点）
- [X] T025 跑完整门禁：`frontend` 的 `npm test` / `npm run lint`；`core-backend` 的 `tests.test_mcp_publish` / `tests.test_service_topology_consistency`，结果记入「进度记录」
- [ ] T026 [P] 按 `specs/004-mcp-publish-display-unify/quickstart.md` §5 做回归（固定服务启停、自建发布创建/停止/删除、自建发布查看配置、本体查询工具数、零工具底座卡片）
  - 状态：待人工点检（镜像已重建并重启；启停/创建/删除为浏览器操作）

---

## 依赖关系与执行顺序

### 阶段依赖

- **Phase 1（T001）** → 无依赖，先跑
- **Phase 2（T002）** → 依赖 T001（基线结果）
- **Phase 3 / US1（T003–T008）** → 依赖 T002
- **Phase 4 / US2（T009–T013）** → 依赖 T002；**与 US1 完全独立**（不读新字段）
- **Phase 5 / US3（T014–T022）** → 依赖 T002；前端入口位置依赖 US2（T011），后端 T014/T016/T017 可与 US2 并行
- **Phase 6（T023–T026）** → 依赖 US1/US2/US3 全部完成

### 故事内依赖

| 故事 | 链 |
|---|---|
| US1 | T003 ∥（T004 → T005 → T006）∥ T007 → T008 |
| US2 | T009 ∥（T010 → T011 → T012）→ T013 |
| US3 | （T014 ∥ T015 ∥ T018）→（T016 → T017）→（T019 → T020 → T021）→ T022 |

### 并行示例：用户故事 1

```bash
# 三个互不冲突的文件可同时开工
任务："T003 扩充 config-snippets.test.ts 断言"
任务："T004 扩展 catalog.ts 的 clientKey / internalEndpoint"
任务："T007 增加 test_service_topology_consistency.py 的两段断言"
```

### 并行示例：用户故事 2 / 3

```bash
# US2：测试与原子抽取可并行（不同文件）
任务："T009 扩充 cards.test.tsx"
任务："T010 抽 StatusBadge / InfoRow 到 cards.tsx"

# US3：后端接口、前端类型、弹窗测试三处并行
任务："T014 补 test_mcp_publish.py 的 /tools 用例"
任务："T018 补 api/mcp.ts 的 getPublishedTools"
任务："T015 补 PublishModals.test.tsx 的快照说明与空态"
```

---

## 实施策略

### MVP 优先（仅用户故事 1）

1. 完成 Phase 1 + Phase 2
2. 完成 Phase 3（US1）
3. **停下验证**：按 quickstart §2 验收（宿主/容器两向粘贴成功）
4. 可先发布——US1 独立修复「业务系统片段不可粘贴 / 含管理字段」的在网缺陷

### 增量交付

1. 基线就绪 → US1 交付并验证（MVP）
2. US2 交付（纯展示重构，可与 US1 并行）
3. US3 交付（新只读端点 + 工具查看）
4. Phase 6 收尾：契约文档、注释、全量门禁、回归

### 并行团队策略

- 基线（T001/T002）由一人先完成；
- 之后：A → US1；B → US2；C → US3 后端（T014/T016/T017/T018）；
- US3 前端（T019–T021）在 B 完成 T011 后接手。

---

## 约束备忘（T002 结论）

- `catalog.ts`：每条以 `key: '…',` 开头、`\n  },` 收尾，`service:` / `endpoint:` / `transport:` / `exposure:` / `publishTools:` 保持单引号与既有缩进；恰好 5 条。**本次新增字段一律追加在 `endpoint` 之后**，既有行未改，护栏正则无需调整。
- `config-snippets.ts`：保留 `key === 'functionExecutor'` 分支与 `endpoints: [...]` 数组形态；保留 `clientTypeOf(def.transport)` 调用字样；禁止出现 `type: 'url'` 与 `http-streamable` 字面量。**本次重写后两条均保留**（`test_公共函数迁移后旧端点只允许出现在归位说明里`、`TransportClaimCase` 全绿）。
- 新增字段一律**追加**，不改既有行，避免护栏正则失配。

## 进度记录

| 任务 | 结果 | 备注 |
|---|---|---|
| T001 | ✅ 通过 | 前端基线 42 文件 / 506 用例；core 基线 38 用例；lint 0 error（450 warning 皆为存量） |
| T002 | ✅ 完成 | 两条护栏正则可解析；本次只追加字段，未改既有行格式 |
| T003–T007 | ✅ 通过 | 片段单测 19 条（含两段/type/禁字段/headers/未登记/读取失败/零工具）；护栏新增 3 条断言共 19 条用例全绿 |
| T009–T012 | ✅ 通过 | 卡片单测 8 条；两块共用 `StatusBadge` / `InfoRow`；自建卡片补「可用工具 + 查看工具」 |
| T014–T021 | ✅ 通过 | 端点用例 3 条（成功/空快照/404）；前端 `getPublishedTools` + 弹窗 note/空态；失败只 toast 不开弹窗 |
| T023–T025 | ✅ 通过 | 契约三节同步；`public_view` 文档串补“不含 tools”；全量单测 **42 文件 / 523 用例通过**，`tsc --noEmit` 0 error，lint 0 error，core 三套 **50 用例 OK** |
| T008 / T013 / T022 / T026 | 🔍 镜像已重建，待人工点检 | 2026-10-19 `docker compose up -d --build` 完成，两容器 Up；经 nginx 复验 `/api/mcp/published/{name}/tools` 200（6 个工具）与 404 语义，前端产物含新片段代码。剩余为浏览器点击项（两段粘贴、卡片并排、启停回归），按 quickstart §2/§3/§5 点检 |

## 备注

- `[P]` 任务 = 不同文件、无未完成依赖
- `[Story]` 标签把任务映射到用户故事，便于独立验证与回溯
- 每个用户故事都应可独立完成、独立测试
- 实现前先让新增测试失败（红→绿）
- 每完成一条任务或一组合逻辑任务后提交
- 避免：含糊任务、同文件并行冲突、破坏故事独立性的跨故事依赖
