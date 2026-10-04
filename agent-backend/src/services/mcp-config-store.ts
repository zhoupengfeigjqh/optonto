import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface MCPServerConfig {
  name: string;
  url: string;
  enabled: boolean;
  /** 为空/不设置时注册全部工具；设置后只注册指定名称的工具 */
  allowed_tools?: string[];
  /** 内置服务标记（仅本体MCP）：不可删除、不可编辑、始终注册全部工具 */
  builtin?: boolean;
  /** 连接携带的 HTTP 头（远程 MCP 鉴权：如 {Authorization: "Bearer xxx"}，架构文档 §九.3） */
  headers?: Record<string, string>;
}

export interface MCPConfig {
  servers: MCPServerConfig[];
}

/**
 * 内置本体MCP —— 唯一内置服务：恒存在、恒启用、恒全选，不可删除。
 * URL 默认 Docker 内网服务名，可用 MCP_BUILTIN_URL 覆盖（如本地直跑指向 http://localhost:8002/mcp）。
 * 2026-09-07 三服务拆分：optonto-mcp 更名 optonto-ontology-mcp（行为工具发布迁至 data-engine-mcp）。
 * 2026-09-28 传输改 Streamable HTTP：端点 /sse → /mcp（旧路径仅作历史配置识别，读取时被当前 URL 顶替）。
 */
const LEGACY_BUILTIN_URLS = [
  'http://optonto-mcp:8002/sse',                 // 三服务拆分前的旧服务名
  'http://optonto-ontology-mcp:8002/sse',        // 改造前的 SSE 端点
  'http://optonto-ontology-mcp:8002/mcp',        // 2026-10-04 本体查询服务更名前（存量配置自动归位）
];
const DEFAULT_BUILTIN_URL = 'http://optonto-ontology-query-mcp:8002/mcp';
export const BUILTIN_MCP_URL = process.env['MCP_BUILTIN_URL'] || DEFAULT_BUILTIN_URL;

/**
 * 数据引擎执行服务 —— 行为工具的**内网挂载入口**（2026-10-04 语义收敛）。
 *
 * 它是执行底座：不发布宿主端口、不对外提供工具，工具面仅供平台 Agent 内网挂载；
 * 对外提供"可执行行为"只有一条路：自建发布（mcp-publish 动态容器，带令牌、绑定单一本体）。
 *
 * 2026-10-04 口径变更（用户拍板）：从「内置恒全选」降级为「预置服务」——首次默认配置里仍带它（开箱可用），
 * 但此后与手工配置的 MCP 服务（如 antv）同权：可做工具范围选择（allowed_tools）、可停用、可编辑、可删除，
 * normalize 不复活、不强制覆盖。只有「行为工具永不收编」按 URL 豁免保留（见 agent-factory discoverTools）。
 * 旧服务名 optonto-data-engine-mcp 已列入 LEGACY，存量配置自动归位。
 */
const DEFAULT_DATA_ENGINE_URL = 'http://optonto-data-engine-executor:8005/mcp';
const LEGACY_DATA_ENGINE_URL = 'http://optonto-data-engine-mcp:8005/sse';
/** 2026-10-04 服务更名前的地址（存量配置自动归位，避免出现两个数据引擎条目） */
const LEGACY_DATA_ENGINE_URLS = [
  LEGACY_DATA_ENGINE_URL,
  'http://optonto-data-engine-mcp:8005/mcp',
];
export const BUILTIN_DATA_ENGINE_MCP_URL = process.env['MCP_BUILTIN_DATA_ENGINE_URL'] || DEFAULT_DATA_ENGINE_URL;

/** 预置数据引擎执行服务（非内置）：仅用于首次默认配置种子，不承担内置语义 */
export const PRESET_DATA_ENGINE_MCP = {
  name: '数据引擎执行服务',
  url: BUILTIN_DATA_ENGINE_MCP_URL,
  enabled: true,
} as MCPServerConfig;

/**
 * 公共函数 MCP —— 平台级通用算力（filterData / aggregateData / dateDiff 等 7 个），**预置挂载**。
 *
 * 为什么必须预置（2026-10-04）：规则的 `related_functions` 可以引用公共函数，而规则闸要求
 * 「关联函数执行过」才算满足（见 execution-policy.missingRuleFunctions）。Agent 只能通过
 * **MCP 工具**调用函数——若无人发布公共函数，引用它们的规则会被永久判为缺口并阻断行为执行
 * （这正是 2026-10-04 之前的真实回归：公共函数一度无任何服务发布）。
 *
 * 口径：预置而非内置——与数据引擎执行服务同权（可停用/删除/改工具范围），normalize 不复活。
 * 公共函数工具不带 scope / ontology_id（非本体执行类），挂载与调用都无需本体上下文。
 */
const DEFAULT_COMMON_FUNCTION_URL = 'http://optonto-common-function-mcp:8007/mcp';
const LEGACY_COMMON_FUNCTION_URLS: string[] = [];
export const BUILTIN_COMMON_FUNCTION_MCP_URL =
  process.env['MCP_BUILTIN_COMMON_FUNCTION_URL'] || DEFAULT_COMMON_FUNCTION_URL;

export const PRESET_COMMON_FUNCTION_MCP = {
  name: '公共函数MCP',
  url: BUILTIN_COMMON_FUNCTION_MCP_URL,
  enabled: true,
} as MCPServerConfig;

/** 是否公共函数 MCP（当前 URL 或历史 URL）——用于「公共函数工具不被收编」等豁免判定 */
export function isCommonFunctionMcpUrl(url: string | undefined | null): boolean {
  const u = normalizeUrl(url ?? '');
  return u === normalizeUrl(BUILTIN_COMMON_FUNCTION_MCP_URL)
    || LEGACY_COMMON_FUNCTION_URLS.some((legacy) => u === normalizeUrl(legacy));
}

export const BUILTIN_MCP = {
  name: '本体查询MCP',
  url: BUILTIN_MCP_URL,
  enabled: true,
  builtin: true,
} as MCPServerConfig;

/** URL 规范化同款（visibility-guard.normalizeServerUrl）：去首尾空白与末尾斜杠，容忍配置两侧录入差异 */
function normalizeUrl(url: string): string {
  return (url || '').trim().replace(/\/+$/, '');
}

/** 是否数据引擎执行服务（当前 URL 或历史 URL——含 /sse 与 2026-10-04 更名前的地址）——用于收编豁免等内置语义 */
export function isDataEngineMcpUrl(url: string | undefined | null): boolean {
  const u = normalizeUrl(url ?? '');
  return u === normalizeUrl(BUILTIN_DATA_ENGINE_MCP_URL)
    || LEGACY_DATA_ENGINE_URLS.some((legacy) => u === normalizeUrl(legacy));
}

const DEFAULT_CONFIG: MCPConfig = {
  servers: [BUILTIN_MCP, { ...PRESET_DATA_ENGINE_MCP }, { ...PRESET_COMMON_FUNCTION_MCP }],
};

/**
 * 内置身份识别（仅本体查询 MCP）：当前 URL / 历史默认 URL 匹配，或 builtin 标记且名为「本体MCP」
 * （含更名前的显示名，存量配置据此归位）。
 * 注意：历史配置里数据引擎条目带 builtin:true 残留——不能仅凭 builtin 标记判定内置，
 * 否则降级后的数据引擎条目会被当作内置滤掉（迁移必须保留它，只剥离 builtin 标记）。
 */
function isBuiltinServer(s: MCPServerConfig | undefined | null): boolean {
  return !!s && (s.url === BUILTIN_MCP_URL || LEGACY_BUILTIN_URLS.includes(s.url)
    || (s.builtin === true && (s.name === '本体MCP' || s.name === '本体查询MCP')));
}

/**
 * URL 归位（2026-10-04 服务更名 / 端口收敛的迁移）：旧地址 → 当前地址。
 *
 * 为什么必须归位而不是"原样保留"：旧地址指向**已不存在的容器**，条目留着就会静默失效
 * （Agent 挂载时报连接错误，最难排查）。归位只改 url，name / enabled / allowed_tools
 * 等用户配置一律保留——迁移不改变用户的取舍。
 */
function migrateUrl(url: string): string {
  const u = normalizeUrl(url);
  if (!u) return url;
  if (LEGACY_DATA_ENGINE_URLS.some(legacy => u === normalizeUrl(legacy))) {
    return BUILTIN_DATA_ENGINE_MCP_URL;
  }
  if (LEGACY_COMMON_FUNCTION_URLS.some(legacy => u === normalizeUrl(legacy))) {
    return BUILTIN_COMMON_FUNCTION_MCP_URL;
  }
  return url;
}

/**
 * 规整配置：确保内置本体查询 MCP 恒存在且形态固定；其余服务（含数据引擎执行服务预置/手工
 * 配置）剥离 builtin 标记、**URL 归位**、其余字段原样保留。
 */
function normalize(config: MCPConfig): MCPConfig {
  const others = (config.servers || [])
    .filter(s => s && !isBuiltinServer(s))
    .map(s => {
      const { builtin, ...rest } = s as any;
      return { ...rest, url: migrateUrl(rest.url) };
    });
  return { servers: [BUILTIN_MCP, ...others] };
}

/**
 * MCP 配置存储 —— 全局唯一，不区分场景/本体。
 * 所有新增配置的 MCP 服务统一存入 ./config/mcp-config.json。
 */
export class MCPConfigStore {
  constructor(private configPath: string) {}

  /** 读取全局配置，不存在则返回默认；读入时强制规整内置本体MCP */
  getConfig(): MCPConfig {
    try {
      if (existsSync(this.configPath)) {
        const raw = readFileSync(this.configPath, 'utf-8');
        return normalize(JSON.parse(raw));
      }
    } catch {
      // 文件损坏回退默认
    }
    return normalize({ ...DEFAULT_CONFIG, servers: [...DEFAULT_CONFIG.servers] });
  }

  /** 保存全局配置（覆盖写入，写入前强制规整内置本体MCP） */
  saveConfig(config: MCPConfig): void {
    mkdirSync(dirname(this.configPath), { recursive: true });
    writeFileSync(this.configPath, JSON.stringify(normalize(config), null, 2), 'utf-8');
  }
}
