/**
 * 本地探针：以宿主机身份连 localhost:8002 拉 MCP 目录，走真实 toMountableToolInfo 分类，
 * 打印 getMountableToolCatalog 结果（父 Agent listAllMcpFunctions 的数据源）。
 * 用法: npx tsx scripts/probe-catalog.ts
 */
import { MCPClient } from '../src/services/mcp-client.js';
import { toMountableToolInfo } from '../src/agent/agent-factory.js';

const PARENT_QUERY = ['listScenarios', 'listOntologies', 'listOntoBehaviors', 'listOntoConcepts',
  'listOntoRelations', 'listOntoFunctions', 'listOntoSecurities'];

async function main() {
  const client = new MCPClient('http://localhost:8002/sse');
  await client.connect();
  const { tools } = await client.listTools();
  console.log(`MCP 工具总数: ${tools.length}`);
  const catalog = tools
    .filter((t: any) => !PARENT_QUERY.includes(t.name) && t.name !== 'executeOntoBehavior')
    .map((t: any) => toMountableToolInfo({ name: t.name, description: t.description, parameters: (t as any).inputSchema }));
  for (const e of catalog) {
    console.log(`  ${e.name.padEnd(30)} category=${e.category} displayName=${e.displayName ?? ''} params=${Object.keys(e.params)} scope=${JSON.stringify(e.scope ?? null)}`);
  }
  await client.close?.();
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
