import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface MCPServerConfig {
  name: string;
  url: string;
  enabled: boolean;
  /** 为空/不设置时注册全部工具；设置后只注册指定名称的工具 */
  allowed_tools?: string[];
}

export interface MCPConfig {
  servers: MCPServerConfig[];
}

const DEFAULT_CONFIG: MCPConfig = {
  servers: [
    {
      name: '本体MCP',
      url: 'http://optonto-mcp:8002/sse',
      enabled: true,
    },
  ],
};

/**
 * MCP 配置存储 —— 全局唯一，不区分场景/本体。
 * 所有新增配置的 MCP 服务统一存入 ./config/mcp-config.json。
 */
export class MCPConfigStore {
  constructor(private configPath: string) {}

  /** 读取全局配置，不存在则返回默认 */
  getConfig(): MCPConfig {
    try {
      if (existsSync(this.configPath)) {
        const raw = readFileSync(this.configPath, 'utf-8');
        return JSON.parse(raw);
      }
    } catch {
      // 文件损坏回退默认
    }
    return { ...DEFAULT_CONFIG, servers: [...DEFAULT_CONFIG.servers] };
  }

  /** 保存全局配置（覆盖写入） */
  saveConfig(config: MCPConfig): void {
    mkdirSync(dirname(this.configPath), { recursive: true });
    writeFileSync(this.configPath, JSON.stringify(config, null, 2), 'utf-8');
  }
}
