import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface MCPServerConfig {
  name: string;
  url: string;
  enabled: boolean;
  /** 为空/不设置时注册全部工具；设置后只注册指定名称的工具 */
  allowed_tools?: string[];
  /** 内置服务标记（本体MCP）：不可删除、不可编辑、始终注册全部工具 */
  builtin?: boolean;
  /** 连接携带的 HTTP 头（远程 MCP 鉴权：如 {Authorization: "Bearer xxx"}，架构文档 §九.3） */
  headers?: Record<string, string>;
}

export interface MCPConfig {
  servers: MCPServerConfig[];
}

/**
 * 内置本体MCP —— 恒存在、恒启用、恒全选，不可删除。
 * URL 默认 Docker 内网服务名，可用 MCP_BUILTIN_URL 覆盖（如本地直跑指向 http://localhost:8002/sse）。
 * 2026-09-07 三服务拆分：optonto-mcp 更名 optonto-ontology-mcp（行为 facade 迁至 data-engine-mcp）。
 */
const LEGACY_BUILTIN_URL = 'http://optonto-mcp:8002/sse';
const DEFAULT_BUILTIN_URL = 'http://optonto-ontology-mcp:8002/sse';
export const BUILTIN_MCP_URL = process.env['MCP_BUILTIN_URL'] || DEFAULT_BUILTIN_URL;

/** 内置数据引擎MCP —— 行为 facade 唯一入口（2026-09-07 从本体MCP 拆出）。同内置语义：恒存在、恒启用、恒全选。 */
const DEFAULT_DATA_ENGINE_URL = 'http://optonto-data-engine-mcp:8005/sse';
export const BUILTIN_DATA_ENGINE_MCP_URL = process.env['MCP_BUILTIN_DATA_ENGINE_URL'] || DEFAULT_DATA_ENGINE_URL;

export const BUILTIN_MCP = {
  name: '本体MCP',
  url: BUILTIN_MCP_URL,
  enabled: true,
  builtin: true,
} as MCPServerConfig;

export const BUILTIN_DATA_ENGINE_MCP = {
  name: '数据引擎MCP',
  url: BUILTIN_DATA_ENGINE_MCP_URL,
  enabled: true,
  builtin: true,
} as MCPServerConfig;

const BUILTIN_SERVERS = [BUILTIN_MCP, BUILTIN_DATA_ENGINE_MCP];

const DEFAULT_CONFIG: MCPConfig = {
  servers: [...BUILTIN_SERVERS],
};

/** 内置身份识别：builtin 标记 / 任一内置当前 URL / 历史默认 URL（配置文件里可能残留旧默认，env 切换后仍要正确归类） */
function isBuiltinServer(s: MCPServerConfig | undefined | null): boolean {
  return !!s && (s.builtin === true
    || s.url === BUILTIN_MCP_URL || s.url === LEGACY_BUILTIN_URL
    || s.url === BUILTIN_DATA_ENGINE_MCP_URL);
}

/**
 * 规整配置：确保内置服务（本体MCP + 数据引擎MCP）恒存在且形态固定；用户服务剥离 builtin 标记。
 */
function normalize(config: MCPConfig): MCPConfig {
  const others = (config.servers || [])
    .filter(s => s && !isBuiltinServer(s))
    .map(s => {
      const { builtin, ...rest } = s as any;
      return rest;
    });
  return { servers: [...BUILTIN_SERVERS, ...others] };
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
