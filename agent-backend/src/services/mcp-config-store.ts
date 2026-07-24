import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { PathAccessController } from '../security/path-access-controller.js';

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
 * MCP 配置存储。
 * 每个本体一个 mcp-config.json，存放在 ontology 目录下。
 */
export class MCPConfigStore {
  constructor(private pac: PathAccessController) {}

  private configPath(scenario: string, ontology: string): string {
    // 校验场景和本体名（通过 PAC 的路径校验机制）
    this.pac.assertCanConfigAccess(scenario, ontology);
    const baseDir = this.pac.resolveConfigDir(scenario, ontology);
    return join(baseDir, 'mcp-config.json');
  }

  /** 读取配置，不存在则返回默认 */
  getConfig(scenario: string, ontology: string): MCPConfig {
    const path = this.configPath(scenario, ontology);
    try {
      if (existsSync(path)) {
        const raw = readFileSync(path, 'utf-8');
        return JSON.parse(raw);
      }
    } catch {
      // 文件损坏回退默认
    }
    return { ...DEFAULT_CONFIG, servers: [...DEFAULT_CONFIG.servers] };
  }

  /** 保存配置 */
  saveConfig(scenario: string, ontology: string, config: MCPConfig): void {
    const path = this.configPath(scenario, ontology);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(config, null, 2), 'utf-8');
  }
}
