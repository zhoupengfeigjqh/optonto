/**
 * 固定服务的「配置片段」文案与 JSON —— 纯函数，无 React 依赖。
 *
 * 语义分两类（不可混为一谈）：
 * - 对外工具面（本体查询 / 公共函数）→ 给出**可直接粘进「MCP配置」**的连接片段；
 * - 执行底座（本体函数 / 数据引擎）→ **不给对外连接片段**，只说明它是内网执行端点。
 *
 * 片段里的 `type`（`http` / `sse`）由 `catalog.ts` 的 `clientTypeOf(transport)` 推导——
 * 它是**客户端配置**用于区分连接方式的字段，与平台「传输模式」是同一件事的两种叫法：
 * `streamable → http`、`sse → sse`（写死 `"url"` 是自造值，客户端不认）。
 *
 * 业务系统 MCP 是外部形态（需读「MCP 配置」页里手工维护的条目），不在此静态生成，
 * 由组件异步获取（`staticServiceConfig` 对其返回 `null`）。
 */
import { clientTypeOf, type FixedServiceDef } from './catalog';

export interface ConfigModalContent {
  title: string;
  json: string;
  note?: string;
  /** 附加片段（同一服务的另一种地址/用途，如自建发布的「容器内地址」）：各自带标签与复制按钮 */
  extra?: { label: string; json: string }[];
}

/** 静态配置片段；返回 `null` 表示需由调用方异步取（业务系统 MCP）。 */
export function staticServiceConfig(def: FixedServiceDef, host: string): ConfigModalContent | null {
  if (def.key === 'ontologyQuery') {
    return {
      title: '本体查询 MCP 服务（对外）',
      json: JSON.stringify({ mcpServers: { 'optonto-ontology-query': { type: clientTypeOf(def.transport), url: `http://${host}:8002/mcp` } } }, null, 2),
      note: '平台内置对外工具面之一（另一个是公共函数 MCP 服务）：只发布本体语义查询（listOnto* 八件套），只读、无副作用。'
        + '本体函数与行为请用下方「自建发布」按本体切片对外提供。',
    };
  }
  if (def.key === 'commonFunction') {
    return {
      title: '公共函数 MCP 服务（对外）',
      json: JSON.stringify({ mcpServers: { 'optonto-common-function': { type: clientTypeOf(def.transport), url: `http://${host}:8007/mcp` } } }, null, 2),
      note: '平台级通用算力：日期处理 / 数据过滤 / 聚合 / 分组共 7 个公共函数，跨本体共享、约定为纯计算（无副作用）。'
        + '与本体函数的区别——那个有本体归属、对外要按本体切片发布；公共函数无归属，连接即用。'
        + '本服务发布与执行一体（调用即在本服务内本地执行，无需转发）。',
    };
  }
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
      note: '行为执行的唯一实现（映射翻译 → 下游 MCP）。工具面仅供平台 Agent 内网挂载，不对外提供；'
        + '对外暴露行为请用下方「自建发布」。',
    };
  }
  return null;
}
