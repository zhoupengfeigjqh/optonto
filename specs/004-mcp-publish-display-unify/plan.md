# 实施计划：MCP 发布页的配置展示与卡片结构统一

**分支**: `004-mcp-publish-display-unify` | **日期**: 2026-10-19 | **规格**: [spec.md](./spec.md)

**输入**: 功能规格 `specs/004-mcp-publish-display-unify/spec.md`

**注**: 本文件由 `/speckit.plan` 生成，Phase 0/1 的研究与设计产物见同目录 `research.md`、`data-model.md`、`contracts/`、`quickstart.md`。

## 摘要

两项需求共用一条主线：**把「一块信息在页面上怎么呈现」收敛到单一事实源，再让两块区域共用同一套呈现结构**。

1. **固定发布的「查看配置」统一为两段式**：本体查询 MCP 服务、公共函数 MCP 服务、业务系统 MCP 三张对外卡片，一律输出「宿主地址段（给平台外客户端）+ 容器内地址段（给平台 Agent）」的客户端连接片段，结构与自建发布现有片段一致（`{mcpServers: {<服务标识>: {type, url, headers?}}}`）。业务系统 MCP 不再回显平台内部条目（`enabled` / `business_data` 等管理字段），改为与另两张同构的片段；两个内网执行底座（8005 / 8006）按 2026-10-19 零工具决策不出片段，只说明内网执行端点。
2. **自建发布卡片对齐固定发布卡片**：两块共用同一套信息层级（服务标识 → 运行状态 → 端点 → 传输模式 → 可用工具 → 说明 → 操作），并补「查看工具」——数据来自发布时冻结的注册表快照（新增一个只读端点），不依赖运行中的容器，也不把冻结语义说成实时探测。

**技术路线**：前端把片段生成收敛为 `catalog.ts`（声明）+ `config-snippets.ts`（纯函数）的唯一组合；后端新增一个只读端点读注册表。**不新增任何技术栈与依赖，不改执行链路与协议端点。**

## 技术上下文

**语言/版本**：TypeScript 5.9 + React 18（前端，Next.js 14 App Router）；Python 3.11 + FastAPI（core-backend）。

**主要依赖**：antd 5 + Tailwind（沿用现有 UI 组件与样式体系）；前端测试 Vitest 3 + Testing Library；后端测试 `unittest`（含跨仓静态护栏）。**零新增依赖。**

**存储**：自建发布注册表（`.data/mcp_publishes/`，JSON 文件）+ 平台 MCP 配置（`config/mcp-config.json`，只读其中的请求头）；**无新增存储、无迁移**。

**测试**：`frontend` → `npm test`（vitest）、`npm run lint`；`core-backend` → `python -m unittest`（含 `tests/test_service_topology_consistency.py` 跨仓护栏）。

**目标平台**：Docker Compose 部署的 Web 平台（浏览器 + 内部容器网络）。

**项目类型**：web application（前端与 core-backend 两侧同改）。

**性能目标**：片段生成为纯函数（O(1)，无网络）；「查看配置」打开不新增请求（业务系统仅复用一次已有的配置读取，用于取请求头）；列表接口载荷不增大——工具清单**按需**单独拉取。

**约束**：单组件文件 ≤500 行；不新增技术栈/依赖；跨仓拓扑护栏必须同步且保持通过；界面与文档全中文。

**规模/范围**：5 张固定服务卡片；自建发布按用户创建（每页最多 6 张）；单次发布的工具数在数十以内。

## 宪法检查

*门禁：Phase 0 研究前必须通过；Phase 1 设计后复检。*

| 原则 | 结论 | 本特性的落地点 |
|---|---|---|
| I. 前端组件化与代码质量 | 通过 | 卡片信息行/状态位抽为共用展示原子（避免两块各写一份）；`ToolsModal` 复用；新增组件显式类型、不外泄 `any`；单文件守住 500 行 |
| II. 后端分层架构 | 通过 | 新端点只调用 `services/mcp_publish_containers`，不直接触达注册表读文件（接口层不 import 数据访问原语） |
| III. 测试强制覆盖 | 通过 | 新端点补集成测试；前端纯函数与卡片组件补单测；跨仓护栏同步并保留反向断言 |
| IV. 无障碍与交互体验 | 通过 | 复用 antd `Button` / `Modal`（键盘可达、焦点管理既有），列表项沿用 `clickableProps`；不新增纯图标按钮 |
| V. 性能标准 | 通过 | 片段生成为纯函数、不在渲染路径做重计算；工具清单按需拉取，首屏请求数不增 |
| VI. 数据一致性与接口契约 | 通过 | 片段 `type` 由传输模式唯一推导（`clientTypeOf`），不手写；新响应不写无消费者的字段；两侧类型同日改 |
| VII. 依赖治理 | 通过 | 零新增依赖，全部用既有 antd / Tailwind / 标准库 |
| VIII. 接口契约两侧同改 | 通过 | 前端 `api/mcp.ts` 类型 + core 路由/服务 + `specs/contracts/` 文档同批修改 |
| IX. 优雅降级与故障可观测 | 通过 | 配置读取失败、工具清单失败均以可见错误呈现原因；不把失败伪装成「0 个工具」或空片段 |

**结论**：无违反项，`Complexity Tracking` 留空。

**Phase 1 设计后复检**：再次对照九条原则，结论不变。设计产物带来的具体校验点如下——
`data-model.md` 的新增字段全部落在声明层（无存储变更，符合 VI/X）；`contracts/published-tools-api.md` 的新端点只读且无死字段（VI/VIII）；`quickstart.md` 的失败/空态区分对应 IX；`research.md` R7 明确护栏同步方式（III）。未引入新依赖（VII），未新增目录层级（I/II）。

## 项目结构

### 文档（本特性）

```text
specs/004-mcp-publish-display-unify/
├── plan.md              # 本文件
├── research.md          # Phase 0 输出（决策与取舍）
├── data-model.md        # Phase 1 输出（实体与校验）
├── quickstart.md        # Phase 1 输出（可执行的验证指南）
├── contracts/           # Phase 1 输出（片段契约 / 工具清单端点契约）
├── checklists/
│   └── requirements.md  # 规格质量检查清单（已通过）
└── tasks.md             # Phase 2 输出（由 /speckit.tasks 生成，本命令不创建）
```

### 源码（仓库根，本特性触碰的实际路径）

```text
frontend/src/
├── api/
│   ├── mcp.ts                       # + getPublishedTools；修正 #116 处过时注释（type:"url"）
│   └── agent-client.ts              # 仅类型沿用（读 MCP 配置取 headers，不改接口）
├── components/Design/
│   ├── MCPPublish.tsx               # 容器：打开配置/工具弹窗的编排（删除业务卡片异步回显分支）
│   └── mcp-publish/
│       ├── catalog.ts               # 固定服务声明唯一事实源：+ clientKey / internalEndpoint
│       ├── config-snippets.ts       # 两段式片段生成（纯函数，取代按 key 硬编码）
│       ├── cards.tsx                # 两块卡片共用状态位/信息行；PublishedServiceCard 结构对齐
│       ├── PublishModals.tsx        # ToolsModal 支持“发布时快照”说明与空态
│       ├── *test.ts(x)              # 单测同步
│       └── readiness.ts             # 不动
core-backend/
├── routers/mcp_publish.py           # + GET /api/mcp/published/{name}/tools
├── services/mcp_publish_containers.py  # + published_tools(name)
└── tests/
    ├── test_mcp_publish.py          # + 新端点集成用例（成功 / 404）
    └── test_service_topology_consistency.py  # 护栏同步（新增字段与片段结构）
specs/contracts/mcp-tools.md         # §9.2/§9.3 展示口径同步（片段结构 + 自建发布工具查看）
```

**结构决策**：沿用仓库既有的 web application 布局（`frontend/` + `core-backend/` + 只读的 `mcp-shared/` 契约），不新增目录层级；展示原子留在 `mcp-publish/` 子目录内，以守住单文件 500 行上限。

## 实施分期（详细任务由 `/speckit.tasks` 展开）

| 阶段 | 对应故事 | 内容 | 可独立交付 |
|---|---|---|---|
| A | US1（P1） | `catalog.ts` 增 `clientKey` / `internalEndpoint`；`config-snippets.ts` 改为通用两段式生成；业务卡片改走静态生成（请求头按需并入）；`MCPPublish.tsx` 删除回显分支与字符串嗅探 | 是（修正在网缺陷） |
| B | US2（P2） | 抽共用状态位/信息行；`PublishedServiceCard` 按统一层级重排，保留令牌/本体/依赖/快照提示 | 是（纯展示重构） |
| C | US3（P3） | core 新增 `/{name}/tools`（返回注册表快照）；前端 `getPublishedTools` + 卡片「查看工具」+ 快照说明与错误/空态 | 是（依赖 B 的位置） |

## 关键设计决定（详见 research.md）

- **片段事实源放前端声明层**：`catalog.ts` 已有 `endpoint` / `transport` / `service`，新增两个字段即可覆盖两段地址与服务标识；避免为此新增后端接口（见 R1）。
- **业务系统的请求头按需并入**：仍然读一次平台 MCP 配置，但**只取 headers**，绝不整条回显（见 R2）。
- **8005 / 8006 不出片段**：两者 `transport='none'`，`clientTypeOf` 返回 `null` 即无片段；8005 的旧「工具面仅内网」表述随 2026-10-19 零工具决策一并收敛（见 R3）。
- **自建发布的工具清单走注册表快照**：新增只读端点，不用 `listPublished` 内联（避免列表膨胀）、不做容器实时探测（停机不可用且破坏冻结语义）（见 R4）。

## 风险与回滚

| 风险 | 影响 | 应对 |
|---|---|---|
| 跨仓护栏对 `catalog.ts` 的格式敏感（`key:` / `service:` / `endpoint:` / `transport:` 单引号、块尾 `\n  },`、恰好 5 条） | 新增字段时正则失配导致护栏误报 | 新增字段只追加、不动既有行格式；同日跑护栏测试；若确需改结构，同批更新护栏断言 |
| `config-snippets.ts` 被护栏按 `key === 'functionExecutor' … endpoints: [...]` 正则解析 | 重构函数体可能让护栏解析失败 | 保留该分支与 `endpoints:` 数组形态；或同批更新护栏（更推荐保留） |
| 业务系统条目按地址匹配请求头失败（用户填了宿主地址/改名） | 片段缺 headers | 规范化地址匹配 + 匹配不到时只出片段不带头并给出提示，不阻断（FR-007 / FR-009） |
| 自建发布工具清单端点被误当成“实时探测” | 用户改本体后以为已生效 | 弹窗固定标注“发布时快照，改本体需重新发布”；文档同步 |
| 卡片信息项增多导致拥挤 | 可读性下降 | 信息行保持两列式短标签；卡片宽度沿用 `w-96`；按钮组不超过 3 个 |

**回滚**：阶段 A/B/C 相互独立，前端回退两文件即恢复旧展示；core 新端点为纯只读，保留无副作用，可直接下线而不影响既有接口。
