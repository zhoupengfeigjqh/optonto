/**
 * MCP发布页 —— 固定服务目录与展示口径（**纯数据，无 React 依赖**）。
 *
 * 固定服务元数据是「前端卡片声明」的唯一来源：卡片标题/角色/暴露面/工具面/端点全部由此驱动。
 * `service` 键与 `endpoint` 受 `core-backend/tests/test_service_topology_consistency.py`
 * 与 `docker-compose.yml` 双向守护——改这里（或改 compose）都会被该护栏拦下，请同日修改。
 *
 * 键名即角色（2026-10-04 语义统一）：
 * - 对外发布工具：本体查询 MCP 服务、公共函数 MCP 服务、业务系统 MCP；
 * - 执行底座（不对外）：本体函数执行服务（零工具）、数据引擎执行服务（工具面仅内网）。
 * - 对外提供"可执行能力"（函数/行为）只有一条路：自建发布。
 */
import type { McpServiceKey, PublishKind, PublishTransport } from '@/api/client';

/** MCP 工具清单条目（对外工具面 /tools 返回形状） */
export interface ToolInfo { name: string; description: string; inputSchema?: any }

export type CardKey = 'ontologyQuery' | 'commonFunction' | 'functionExecutor' | 'dataEngine' | 'business';

export interface CardState {
  checking: boolean;
  running: boolean;
  toggling: boolean;
  tools: ToolInfo[];
  statusText: string;
}

export const INIT: CardState = { checking: true, running: false, toggling: false, tools: [], statusText: '' };

/**
 * 固定服务的**协议传输模式**（事实源 = 各服务 `server.py` 的 `build_mcp_app(transport=…)`，
 * 缺省即 `streamable`）：
 * - `streamable`：只挂 `/mcp` 单端点（本体查询 8002 / 公共函数 8007 / 业务系统 8004 / 数据引擎执行 8005）；
 * - `sse`：`/sse` + `/messages/`（固定服务都不用，仅自建发布可选）；
 * - `none`：**不挂任何协议端点**——零工具的执行底座（本体函数执行服务 8006）。
 */
export type FixedTransport = 'streamable' | 'sse' | 'none';

export interface FixedServiceDef {
  key: CardKey; title: string; service: McpServiceKey;
  endpoint: string; exposure: '对外' | '内网'; publishTools: boolean;
  /** 协议端点形态（卡片展示 + 配置片段 type 的唯一来源） */
  transport: FixedTransport;
  role: string;
}

export const FIXED_SERVICES: FixedServiceDef[] = [
  {
    key: 'ontologyQuery', title: '本体查询 MCP 服务', service: 'ontology-query',
    endpoint: 'http://{host}:8002/mcp', exposure: '对外', publishTools: true,
    transport: 'streamable',
    role: '回答「本体里有什么」：概念 / 关系 / 函数清单 / 行为清单 / 流程 / 安全配置 / 花名册（只读、无副作用）。',
  },
  {
    key: 'commonFunction', title: '公共函数 MCP 服务', service: 'common-function',
    endpoint: 'http://{host}:8007/mcp', exposure: '对外', publishTools: true,
    transport: 'streamable',
    role: '平台级通用算力（filterData / aggregateData / dateDiff 等 7 个）：无本体归属、跨场景共享、纯计算。发布与执行一体——本服务内直接执行，无需转发。与本体函数不同：那个有本体归属、对外需按本体切片，故其执行底座不对外。',
  },
  {
    key: 'functionExecutor', title: '本体函数执行服务', service: 'function-executor',
    endpoint: 'Docker 内网 optonto-ontology-function-executor:8006', exposure: '内网', publishTools: false,
    transport: 'none',
    role: '函数执行的唯一实现（本地执行函数代码）。零工具：不提供任何 MCP 工具，只接受 /execute-function 调用。',
  },
  {
    key: 'dataEngine', title: '数据引擎执行服务', service: 'data-engine',
    endpoint: 'Docker 内网 optonto-data-engine-executor:8005', exposure: '内网', publishTools: false,
    transport: 'streamable',
    role: '本体行为执行的唯一实现（映射翻译 → 下游 MCP）。工具面仅供平台 Agent 内网挂载，不对外提供。',
  },
  {
    key: 'business', title: '业务系统 MCP', service: 'business',
    endpoint: 'http://{host}:8004/mcp', exposure: '对外', publishTools: true,
    transport: 'streamable',
    role: '业务侧集成边缘：模拟外部业务系统（直连 business-backend）。与其他固定服务同权，可启停。',
  },
];

/** 自建发布可勾选项：函数恒可选；行为需已就绪（已完成数据引擎映射，契约 ⑥） */
export interface SelectableItem { name: string; label: string; ready: boolean; hint?: string }

export const KIND_LABEL: Record<PublishKind, string> = { ontology_function: '本体函数', behavior: '本体行为' };
export const TRANSPORT_LABEL: Record<PublishTransport, string> = { sse: 'sse', streamable: 'streamable-http' };

/**
 * 固定服务传输模式的展示文案（与自建发布卡片同一套叫法：streamable-http / sse）。
 *
 * 用 `streamable-http`（**MCP 规范里的传输名**）而不是 `http-streamable`——词序反了就是自造词，
 * 与规范/客户端对不上（客户端配置里的 `type` 取值是 `http`，见 `CLIENT_TYPE`）。
 */
export const FIXED_TRANSPORT_LABEL: Record<FixedTransport, string> = {
  streamable: 'streamable-http（/mcp 单端点）',
  sse: 'sse（/sse + /messages/）',
  none: '无协议端点（零工具，仅 /execute-function）',
};

/**
 * 平台传输模式 → **MCP 客户端配置**里的 `type`。
 *
 * 为什么需要映射：`type` 是客户端（Claude Code / VS Code 的 mcp.json 等）用来区分连接方式的字段，
 * 合法取值是 `http` / `sse` / `stdio`（本地进程）——**`url` 不是合法值**
 * （2026-10-05 用户提问暴露：此前片段里写死 `"type": "url"`，属自造值，严格校验的客户端会拒收）。
 *
 * 为什么 Streamable HTTP 取 `http` 而不是 `streamable-http`（2026-10-05 查官方文档后确定）：
 * - VS Code 的 `type` 枚举只有 `stdio` / `http` / `sse`（`http` 优先、不支持再回退 SSE）；
 * - Claude Code 把 `http` 作为规范传输 `streamable-http` 的**规范名**与推荐值，同时接受
 *   `streamable-http` 作为**别名**——但 `http-streamable`（词序反过来）两边都不认。
 * 取交集：`streamable → http` 在两家客户端都成立（展示名走规范名 `streamable-http`，见 TRANSPORT_LABEL）。
 */
export const CLIENT_TYPE: Record<'streamable' | 'sse', 'http' | 'sse'> = {
  streamable: 'http',
  sse: 'sse',
};

/** 客户端配置片段的 `type`；`none`（不挂协议端点）没有可粘贴的连接片段，返回 null */
export function clientTypeOf(transport: FixedTransport): 'http' | 'sse' | null {
  return transport === 'none' ? null : CLIENT_TYPE[transport];
}

/** 自建发布的执行链路说明（与 mcp-shared/publish_upstream 的上游目标一致） */
export const EXEC_NOTE: Record<PublishKind, string> = {
  ontology_function: '由本体函数执行服务在本地执行函数代码（发布门面只转发，不含执行实现）',
  behavior: '由数据引擎执行服务做映射翻译后调下游 MCP（发布门面只转发）',
};
