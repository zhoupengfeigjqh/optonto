/**
 * 开发探针：按「MCP 配置」里**已启用**的条目逐个发现工具，打印分类/展示名/scope。
 *
 * 2026-10-19 方案 B 后行为工具只在自建发布容器里（8005 已零工具、不再有 /mcp），
 * 故不再硬编码地址——直接以配置为准，行为/函数工具都能看到。
 *
 * 用法（agent-backend 目录）：npx tsx scripts/probe2.ts
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { MCPClient } from '../src/services/mcp-client.js';
import { toMountableToolInfo } from '../src/agent/tool-catalog.js';

async function main() {
  const cfg = JSON.parse(readFileSync(join(process.cwd(), 'config/mcp-config.json'), 'utf-8'));
  const servers = (cfg.servers || []).filter((s: any) => s.enabled);
  for (const server of servers) {
    const client = new MCPClient(server.url, server.headers);
    await client.connect();
    const { tools } = await client.listTools();
    console.log(`== ${server.name}: ${tools.length} tools`);
    for (const t of tools as any[]) {
      const e = toMountableToolInfo({ name: t.name, description: t.description, parameters: t.inputSchema });
      console.log(`  ${e.name.padEnd(28)} category=${e.category} title=${e.title ?? ''} scope=${JSON.stringify(e.scope ?? null)}`);
    }
    await client.close?.();
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
