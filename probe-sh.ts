import { MCPClient } from './src/services/mcp-client.js';
async function main() {
  for (const url of ['http://localhost:8002/mcp', 'http://localhost:8005/mcp', 'http://localhost:8004/mcp']) {
    const c = new MCPClient(url);
    try {
      const { tools } = await c.listTools();
      console.log(url, '-> tools:', tools.length);
      await c.close();
    } catch (e: any) { console.log(url, '-> ERROR:', e.message?.slice(0, 200)); }
  }
}
main();