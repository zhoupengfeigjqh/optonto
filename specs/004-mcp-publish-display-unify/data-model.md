# 数据模型：MCP 发布页的配置展示与卡片结构统一

**特性**: [spec.md](./spec.md) | **计划**: [plan.md](./plan.md) | **日期**: 2026-10-19

本特性**不新增持久化数据结构、不做数据迁移**。涉及的是「展示层实体」与「一个只读响应契约」。所有实体现状均有对应代码结构，标注为“扩展”的字段为本次新增。

## 1. 固定服务声明（FixedServiceDef，扩展）

`frontend/src/components/Design/mcp-publish/catalog.ts` —— 固定服务卡片的唯一事实源。

| 字段 | 类型 | 现状 | 说明 |
|---|---|---|---|
| `key` | `'ontologyQuery' \| 'commonFunction' \| 'functionExecutor' \| 'dataEngine' \| 'business'` | 已有 | 卡片键，同时用于启停白名单校验 |
| `title` | `string` | 已有 | 卡片标题（中文） |
| `service` | `'ontology-query' \| 'common-function' \| 'function-executor' \| 'data-engine' \| 'business'` | 已有 | 后端启停服务的键 |
| `endpoint` | `string` | 已有 | **宿主**端点模板：对外服务含 `{host}:PORT`；内网底座为“Docker 内网 + 容器名:端口”说明 |
| `internalEndpoint` | `string` | **扩展** | **容器内**端点（`http://<容器名>:<容器内端口>/mcp`）；仅对外服务有值，内网底座留空 |
| `clientKey` | `string` | **扩展** | 客户端配置片段里的服务标识（稳定、与显示名解耦） |
| `exposure` | `'对外' \| '内网'` | 已有 | 暴露面 |
| `publishTools` | `boolean` | 已有 | 是否对外提供工具 |
| `transport` | `'streamable' \| 'sse' \| 'none'` | 已有 | 协议端点形态（片段 `type` 的唯一来源） |
| `role` | `string` | 已有 | 角色说明文案 |

**校验规则**

| 规则 | 依据 |
|---|---|
| 恰好 5 条，`key` 唯一且与后端启停白名单一一对应 | 拓扑护栏 `WhitelistCase` |
| `transport` 必须与服务端 `build_mcp_app(transport=…)` 实际一致 | 护栏 `TransportClaimCase` |
| `transport='none'` ⇒ `publishTools=false` 且 `exposure='内网'` | 护栏 `test_不挂协议端点的服务不得对外` |
| `endpoint` 含 `{host}:PORT` ⇒ 该 PORT 必须在 compose 有宿主映射 | 护栏 `test_前端对外端点必须有对应宿主端口` |
| `internalEndpoint` ⇒ 必须指向真实容器名 + 该容器内监听端口 | 新增护栏断言（复用 `assert_url_real`） |
| `clientKey` 唯一且不含中文/空格 | 新增：片段 key 是客户端标签，必须可直接粘贴 |

**当前取值**

| key | clientKey | endpoint（宿主） | internalEndpoint（容器内） | transport |
|---|---|---|---|---|
| ontologyQuery | `optonto-ontology-query` | `http://{host}:8002/mcp` | `http://optonto-ontology-query-mcp:8002/mcp` | streamable |
| commonFunction | `optonto-common-function` | `http://{host}:8007/mcp` | `http://optonto-common-function-mcp:8007/mcp` | streamable |
| business | `optonto-business` | `http://{host}:8004/mcp` | `http://optonto-business-mcp:8004/mcp` | streamable |
| dataEngine | —（无片段） | `Docker 内网 optonto-data-engine-executor:8005` | —（零工具，无协议端点） | none |
| functionExecutor | —（无片段） | `Docker 内网 optonto-function-executor:8006` | —（零工具，无协议端点） | none |

## 2. 客户端配置片段（ClientSnippet）

「查看配置」弹窗的产出实体，与自建发布同一形态（`specs/contracts/fixed-service-config.md`）。

```text
{ "mcpServers": { "<clientKey>": { "type": "http" | "sse", "url": "http://…", "headers"?: { "<头名>": "<值>" } } } }
```

**字段规则**

| 字段 | 规则 | 依据 |
|---|---|---|
| 外层键 | 固定为 `mcpServers`（与自建发布片段、MCP 客户端配置一致） | FR-002 |
| 服务标识 | 取 `clientKey`；同一服务两段的 key 相同 | FR-008 |
| `type` | 由 `transport` 推导：`streamable → http`、`sse → sse`；`none → 不生成片段` | FR-003、FR-010、FR-011 |
| `url` | 第一段用 `endpoint`（替换 `{host}`）；第二段用 `internalEndpoint` | FR-004、FR-005 |
| `headers` | 仅当平台 MCP 配置里该条目登记了请求头时存在；否则**整个字段省略** | FR-007 |
| 禁止字段 | `enabled` / `builtin` / `business_data` / `allowed_tools` / `command` | FR-006 |

**两段的用途标注（弹窗文案约束）**

| 段 | 标注 | 复制去向 |
|---|---|---|
| 第一段（`json`） | 平台外的 AI 客户端（Claude / Cursor 等）：宿主地址 | 该客户端的 MCP 配置文件 |
| 第二段（`extra[0].json`） | 本平台 Agent（容器内地址）：容器名 + 容器内端口 | 平台「MCP 配置」页的「粘贴配置」 |

## 3. 配置弹窗内容（ConfigModalContent）

| 字段 | 类型 | 说明 |
|---|---|---|
| `title` | `string` | 弹窗标题（含服务名与「对外」/「内网执行端点」定位） |
| `json` | `string` | 第一段（对外服务）或内网端点说明（零工具底座） |
| `note` | `string` | 用途说明、执行链路、失败/未登记提示 |
| `extra` | `{ label: string; json: string }[]`（可选） | 第二段：容器内地址（对外服务专用） |

**不变式**：`extra` 最多 1 段；`json` 与 `extra[0].json` 的 `clientKey` 必须相同；`note` 至少说明一段的适用对象。

## 4. 自建发布服务（PublishedService，现状不变）

`frontend/src/api/mcp.ts` 的既有类型，**不新增字段**（工具清单改为按需端点）。

| 字段 | 类型 | 说明 |
|---|---|---|
| `name` | `string` | 发布名（= 客户端片段 key） |
| `kind` | `'ontology_function' \| 'behavior'` | 发布类型 |
| `ontology_id` / `ontology_name` | `number` / `string` | 绑定的单一本体 |
| `items` | `string[]` | 发布时勾选的函数/行为名 |
| `tool_count` | `number` | 快照工具数 |
| `host_port` | `number` | 宿主端口（8020–8099） |
| `transport` | `'streamable' \| 'sse'` | 传输模式 |
| `token` | `string` | 访问令牌（须带 `X-MCP-Token`） |
| `container_name` | `string` | 容器名（`optonto-mcp-<slug>-<hex6>`） |
| `created_at` | `string` | 创建时间（ISO） |
| `status` | `string` | `running` / `exited` / `not_found` / `unknown` |
| `running` | `boolean` | 是否运行中 |

**状态跃迁（展示用）**

```text
创建 → running ──停止──▶ exited ──启动──▶ running
                │                          │
                └──容器被外部删除──▶ not_found ──启动──▶ running
读取失败/未知 → unknown（如实显示，不猜测）
```

## 5. 发布工具清单响应（PublishedToolsResponse，新增）

`GET /api/mcp/published/{name}/tools` 的响应实体（契约见 `contracts/published-tools-api.md`）。

| 字段 | 类型 | 说明 |
|---|---|---|
| `name` | `string` | 发布名 |
| `kind` | `'ontology_function' \| 'behavior'` | 发布类型（弹窗可显示归类） |
| `ontology_name` | `string` | 绑定本体中文名 |
| `tools` | `ToolInfo[]` | 发布时冻结的工具快照（可为空数组） |

**ToolInfo（与固定服务 `/tools` 同一形状，便于复用弹窗）**

| 字段 | 类型 | 说明 |
|---|---|---|
| `name` | `string` | 工具名（= 函数名/行为名，裸名） |
| `description` | `string` | 描述（发布时已拼入本体名与信封说明） |
| `inputSchema` | `object` | JSON Schema（含 `properties` / `required`；`ontology_id` 必填，本体归属在顶层元数据 `x-ontology-scope`） |

**校验规则**

| 规则 | 依据 |
|---|---|
| `tools` 顺序与 `items` 一致（注册表按勾选顺序编译） | 快照一致性 |
| `tools.length` 必须等于列表接口的 `tool_count` | 两侧同源（同一注册表条目） |
| 条目不存在 → 404（`NotFoundError`），不得返回空 `tools` 冒充成功 | FR-016 |
| `tools` 为空数组 ⇒ `tool_count` 必须为 0，弹窗显示“0 个工具” | FR-016 |

## 6. 卡片视图实体（展示层）

| 实体 | 来源 | 关键属性 |
|---|---|---|
| `CardState`（固定） | `/api/mcp/{service}/status` + `/tools` | `checking` / `running` / `toggling` / `tools` / `statusText` |
| 自建卡片状态 | `listPublished()` 的 `running` / `status` + 区块刷新态 | 与固定卡片共用 `StatusBadge` 的四种取值：检查中 / 运行中 / 已停止 / 容器缺失 |

**统一信息层级（两块共用）**

1. 标题 + 标签组（固定：对外提供工具 / 暴露面；自建：发布类型）
2. 状态位（`StatusBadge`）
3. 信息行（`InfoRow`）：端点 → 传输模式 → 可用工具（数量 + 查看入口）
4. 领域行：固定=`role` 说明；自建=类型与已选工具、本体、访问令牌、依赖与快照提示
5. 按钮组：查看配置 / 启动·停止（/ 删除）
