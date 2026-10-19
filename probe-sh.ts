import { MCPClient } from './src/services/mcp-client.js';
async function main() {
  // 8005 自 2026-10-19 起为零工具执行底座（transport=none，无 /mcp），故不再探测
  for (const url of ['http://localhost:8002/mcp', 'http://localhost:8004/mcp']) {
    const c = new MCPClient(url);
    try {
      const { tools } = await c.listTools();
      console.log(url, '-> tools:', tools.length);
      await c.close();
    } catch (e: any) { console.log(url, '-> ERROR:', e.message?.slice(0, 200)); }
  }
}
main();