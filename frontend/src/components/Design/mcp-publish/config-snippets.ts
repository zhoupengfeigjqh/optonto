/**
 * 固定服务的「查看配置」片段 —— 纯函数，无 React 依赖。
 *
 * 语义分两类（不可混为一谈）：
 * - **对外工具面**（本体查询 / 公共函数 / 业务系统）→ 给**两段**可粘贴的连接片段：
 *   第一段宿主地址（平台外的 AI 客户端），第二段容器内地址（本平台 Agent——它在容器里，
 *   `localhost` 指向它自己，只能走容器名）。两段结构与自建发布「查看配置」完全同构；
 * - **零工具底座**（本体函数执行 8006 / 数据引擎执行 8005）→ **不给连接片段**，只说明内网执行端点。
 *   两者 `transport='none'`（2026-10-19 方案 B），没有 `/mcp` 也没有工具，给出片段只会让人照着一个
 *   连不上的地址去配客户端。
 *
 * 片段里的 `type`（`http` / `sse`）由 `catalog.ts` 的 `clientTypeOf(transport)` 推导——
 * 它是**客户端配置**用于区分连接方式的字段，与平台「传输模式」是同一件事的两种叫法：
 * `streamable → http`、`sse → sse`（写死 `"url"` 是自造值，客户端不认）。
 *
 * 平台管理字段（`enabled` / `builtin` / `business_data` / `allowed_tools`）**一律不进片段**：
 * 它们是平台存储语义（启停、身份、业务数据闸、工具范围），任何 MCP 客户端都不认，
 * 混进片段只会得到"粘进去连不上"。
 */
import type { MCPServerConfig } from '@/api/agent-client';
import { clientTypeOf, type FixedServiceDef } from './catalog';

export interface ConfigModalContent {
  title: string;
  json: string;
  note?: string;
  /** 附加片段（同一服务的另一种地址/用途）：各自带标签与复制按钮 */
  extra?: { label: string; json: string }[];
}

/** 生成片段时可选的上下文（业务系统这类非内置服务才需要） */
export interface SnippetOptions {
  /** 平台「MCP 配置」里该条目录入的请求头（有则并入片段，无则整个字段省略） */
  headers?: Record<string, string>;
  /** 该服务是否已在「MCP 配置」页登记（false ⇒ 片段可用，但需提示先登记） */
  registered?: boolean;
  /** 读取平台 MCP 配置失败的原因（有值 ⇒ 提示请求头未带入，而不是整块报错） */
  configError?: string;
}

/** 第二段的用途标签（与自建发布「查看配置」同一套措辞，避免同类信息两套说法） */
const INTERNAL_LABEL = '本平台 Agent（容器内地址，粘进「MCP 配置」）';

/** 服务标识：优先声明里的稳定值，缺省回落到后端服务键 */
function clientKeyOf(def: FixedServiceDef): string {
  return def.clientKey || def.service;
}

/**
 * 地址的「端口 + 路径」部分（`8004/mcp`）——用它匹配平台配置里的条目。
 *
 * 为什么不用整串相等：同一服务在配置里可能填的是容器内地址，也可能被用户填成宿主地址
 * （`{host}` 是运行期才知道的，无法整串比较）；而服务名/显示名是用户可改的，不能作为身份。
 */
function portAndPath(url: string | undefined): string {
  const hit = /^https?:\/\/[^/]*:(\d+)(\/.*)?$/.exec((url || '').trim());
  if (!hit) return '';
  // 去掉路径尾部斜杠（配置里多写一个 `/` 不该导致取不到请求头）
  const path = (hit[2] || '/').replace(/\/+$/, '');
  return `${hit[1]}${path}`;
}

/** 在平台 MCP 配置里定位该固定服务的条目（宿主地址或容器内地址命中均算） */
export function findServiceEntry(
  def: FixedServiceDef,
  servers: MCPServerConfig[] | undefined,
): MCPServerConfig | undefined {
  const wanted = [def.internalEndpoint, def.endpoint].map(portAndPath).filter(Boolean);
  if (wanted.length === 0) return undefined;
  return (servers || []).find(s => wanted.includes(portAndPath(s.url)));
}

/** 一段 `{mcpServers: {<服务标识>: {type, url[, headers]}}}` 片段 */
function snippetOf(def: FixedServiceDef, url: string, headers?: Record<string, string>): string {
  const entry: Record<string, unknown> = { type: clientTypeOf(def.transport), url };
  if (headers) entry.headers = headers;
  return JSON.stringify({ mcpServers: { [clientKeyOf(def)]: entry } }, null, 2);
}

/** 各对外工具面的说明文案（与卡片 role 分工：这里讲"两段怎么用"，卡片讲"这个服务是什么"） */
const OUTWARD_NOTES: Record<string, string> = {
  ontologyQuery:
    '平台内置对外工具面之一（另一个是公共函数 MCP 服务）：只发布本体语义查询（listOnto* 八件套），只读、无副作用。\n'
    + '第一段给平台外的 AI 客户端（Claude / Cursor 等）：宿主地址。\n'
    + '在本平台内使用时，复制第二段（容器内地址），到「MCP 配置」页点「粘贴配置」导入即可。\n'
    + '本体函数与行为请用「自建发布」按本体切片对外提供。',
  commonFunction:
    '平台级通用算力：日期处理 / 数据过滤 / 聚合 / 分组共 7 个公共函数，跨本体共享、约定为纯计算（无副作用）。\n'
    + '第一段给平台外的 AI 客户端（Claude / Cursor 等）：宿主地址。\n'
    + '在本平台内使用时，复制第二段（容器内地址），到「MCP 配置」页点「粘贴配置」导入即可。\n'
    + '本服务发布与执行一体（调用即在本服务内本地执行，无需转发）。',
  business:
    '业务侧集成边缘（非平台内置、外部形态）：把业务系统 REST 接口包装为 MCP 工具。\n'
    + '第一段给平台外的 AI 客户端（Claude / Cursor 等）：宿主地址。\n'
    + '在本平台内使用时，复制第二段（容器内地址），到「MCP 配置」页点「粘贴配置」导入即可。\n'
    + '本体行为对业务系统的调用走「接口映射」，本服务只是被映射的下游目标。',
};

/**
 * 固定服务的「查看配置」内容。
 *
 * 返回**非 null**：三个对外工具面给两段；两个零工具底座给内网端点说明（不是"缺数据"，是"没有片段"）。
 */
export function staticServiceConfig(
  def: FixedServiceDef,
  host: string,
  options: SnippetOptions = {},
): ConfigModalContent {
  // ── 零工具底座：无 /mcp、无工具，不产出连接片段（结构上不可连，而非约定） ──
  if (def.key === 'functionExecutor') {
    return {
      title: '本体函数执行服务（内网执行端点）',
      json: JSON.stringify({ internal: true, endpoint: 'http://optonto-ontology-function-executor:8006', endpoints: ['POST /execute-function'] }, null, 2),
      note: '零工具服务：不挂 /mcp 与 /sse，外部客户端误连直接 404。'
        + '只执行**本体函数**（执行前做归属一致性校验），调用方是 core 设计器测试与自建发布（函数类）。'
        + '公共函数执行不在这里——已迁至公共函数 MCP 服务（8007 /execute-common-function），该服务发布与执行一体。',
    };
  }
  if (def.key === 'dataEngine') {
    return {
      title: '数据引擎执行服务（内网执行端点）',
      json: JSON.stringify({ internal: true, endpoint: 'http://optonto-data-engine-executor:8005', endpoints: ['POST /call-behavior', 'POST /call-engine'] }, null, 2),
      note: '行为执行的唯一实现（映射翻译 → 下游 MCP）。**零工具**：不挂 /mcp，平台 Agent 也不直连；'
        + '对外暴露行为一律走「自建发布」（按本体切片 + 令牌）。',
    };
  }

  // ── 对外工具面：宿主段 + 容器内段（结构同自建发布） ──
  const clientType = clientTypeOf(def.transport);
  if (!clientType || !def.internalEndpoint) {
    // 声明不完整（transport='none' 或漏填容器内地址）：退回内网端点说明，绝不编造可粘贴片段
    return {
      title: `${def.title}（内网执行端点）`,
      json: JSON.stringify({ internal: true, endpoint: def.endpoint, endpoints: [] }, null, 2),
      note: '该服务未声明可连接的协议端点（transport=none），不提供客户端配置片段。',
    };
  }

  const notes = [OUTWARD_NOTES[def.key] || `${def.title}：对外提供 MCP 工具。`];
  if (options.registered === false) {
    notes.push('该服务尚未在「MCP 配置」页登记：请先前往该页新增（它不是平台内置服务，不会自动注册）。');
  }
  if (options.configError) {
    notes.push(`读取平台 MCP 配置失败（${options.configError}），片段未带入请求头；如需鉴权请稍后重试或手工补 headers。`);
  }

  return {
    title: def.key === 'business' ? '业务系统 MCP（对外）' : `${def.title}（对外）`,
    json: snippetOf(def, def.endpoint.replace('{host}', host), options.headers),
    note: notes.join('\n'),
    extra: [{ label: INTERNAL_LABEL, json: snippetOf(def, def.internalEndpoint, options.headers) }],
  };
}
