import { MCPClient } from '../src/services/mcp-client.js';
import { toMountableToolInfo } from '../src/agent/tool-catalog.js';
async function main() {
  for (const url of ['http://localhost:8002/mcp', 'http://localhost:8005/mcp']) {
    const client = new MCPClient(url);
    await client.connect();
    const { tools } = await client.listTools();
    console.log(`== ${url}: ${tools.length} tools`);
    for (const t of tools as any[]) {
      const e = toMountableToolInfo({ name: t.name, description: t.description, parameters: t.inputSchema });
      if (e.category !== '其他MCP工具' || true)
        console.log(`  ${e.name.padEnd(28)} category=${e.category} displayName=${e.displayName ?? ''} scope=${JSON.stringify(e.scope ?? null)}`);
    }
    await client.close?.();
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
