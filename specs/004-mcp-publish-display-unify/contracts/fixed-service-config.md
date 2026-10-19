# 契约：固定服务「查看配置」片段（两段式）

**特性**: [spec.md](../spec.md) | **日期**: 2026-10-19 | **状态**: 待实现

**读者**：前端「MCP发布 → 固定发布」的卡片与弹窗实现、跨仓拓扑护栏、契约文档 `specs/contracts/mcp-tools.md` §9.2/§9.3。

## 1. 适用范围

| 服务（key） | 是否出片段 | 第一段（宿主） | 第二段（容器内） |
|---|---|---|---|
| 本体查询 MCP 服务（`ontologyQuery`） | ✅ | ✅ | ✅ |
| 公共函数 MCP 服务（`commonFunction`） | ✅ | ✅ | ✅ |
| 业务系统 MCP（`business`） | ✅ | ✅ | ✅ |
| 数据引擎执行服务（`dataEngine`） | ❌ 零工具、无协议端点 | — | — |
| 本体函数执行服务（`functionExecutor`） | ❌ 零工具、无协议端点 | — | — |

零工具底座**只输出内网执行端点说明**，形态沿用现状：

```json
{ "internal": true, "endpoint": "http://optonto-ontology-function-executor:8006", "endpoints": ["POST /execute-function"] }
```

## 2. 片段结构

两段均为**可整段复制**的 MCP 客户端配置：

```jsonc
// 第一段：平台外的 AI 客户端（Claude / Cursor / VS Code 等）
{
  "mcpServers": {
    "optonto-business": {
      "type": "http",
      "url": "http://<宿主>/8004/mcp"
    }
  }
}

// 第二段：本平台 Agent（容器内地址，粘进「MCP 配置」页的「粘贴配置」）
{
  "mcpServers": {
    "optonto-business": {
      "type": "http",
      "url": "http://optonto-business-mcp:8004/mcp"
    }
  }
}
```

### 字段规则

| 字段 | 必填 | 取值 | 规则 |
|---|---|---|---|
| 外层键 | 是 | 固定 `mcpServers` | 与自建发布片段、客户端配置文件一致 |
| 服务标识（内层键） | 是 | 稳定标识，见 §3 | 两段必须相同；不含空白与中文 |
| `type` | 是 | `http` \| `sse` | 由传输模式推导：`streamable → http`、`sse → sse`；**禁止** `url` / `http-streamable` 等自造值 |
| `url` | 是 | `http://…` | 第一段用宿主地址（含宿主端口）；第二段用容器名 + 容器内端口 |
| `headers` | 否 | 对象 | 仅当平台 MCP 配置中该条目录入请求头时出现；否则**省略整个字段**（不写 `{}`） |

### 禁止出现

- 平台管理字段：`enabled`、`builtin`、`business_data`、`allowed_tools`；
- 进程内传输形态：`command` / `args`（stdio）；
- 占位符残留：`<宿主>` 以外未替换的模板变量（如 `{host}`）。

## 3. 服务标识（clientKey）

| 服务 | clientKey |
|---|---|
| 本体查询 MCP 服务 | `optonto-ontology-query` |
| 公共函数 MCP 服务 | `optonto-common-function` |
| 业务系统 MCP | `optonto-business` |

契约要求：clientKey 与卡片的显示名解耦（显示名可改，clientKey 不改）；`optonto-business` 与此前回显的中文名 `业务系统采购与库存MCP` 不同属**有意变更**——片段 key 是客户端标签，需与另两张同类口径一致。

## 4. 弹窗内容

| 部分 | 对外服务 | 零工具底座 |
|---|---|---|
| 标题 | `<服务名>（对外）` | `<服务名>（内网执行端点）` |
| `json` | 第一段片段 | 内网端点说明（§1） |
| `note` | 用途 + 执行链路；业务系统额外含“未在「MCP 配置」页登记”提示（未登记时） | 零工具说明 + 调用方（core 设计器测试 / 自建发布） |
| `extra[0]` | 标签 `本平台 Agent（容器内地址，粘进「MCP 配置」）` + 第二段片段 | 无 |

**两段用途说明必须同屏可见**，不得只在其中一段的 note 里暗示——这是 FR-005 / SC-003 的判定点。

## 5. 失败的可见性

| 场景 | 行为 |
|---|---|
| 平台 MCP 配置读取失败（业务系统取 headers） | 仍给出两段片段（无 headers），并以提示告知“读取请求头失败，如需鉴权请稍后重试或手工补 headers”；不得整块报错 |
| 业务系统尚未登记 | 给出参考片段 + “请先在「MCP 配置」页新增该服务”的提示 |
| 服务未运行 | 片段照常给出（配置与运行态无关）；仅在 note 中提示连接前需启动 |

## 6. 与既有契约的关系

- `specs/contracts/mcp-tools.md` §9.2（传输入口、type 取值）与 §9.3（地址与令牌分工）为本契约的上位文档，本次需同步一句「固定服务的查看配置同样给两段」；
- 自建发布的片段契约不变（仍由 `client_config` 提供 `mcpServers` / `internal_mcpServers` 两段，含令牌）；
- 拓扑护栏必须断言：三个对外固定服务的两段地址分别命中 compose 的宿主端口与容器内端口（见 `research.md` R7）。
