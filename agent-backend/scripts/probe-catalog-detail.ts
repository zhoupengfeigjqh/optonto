/**
 * 详细探针：打印 getMountableToolCatalog 条目的完整 JSON（四类各取代表）。
 * 用法: npx tsx scripts/probe-catalog-detail.ts
 */
import { MCPClient } from '../src/services/mcp-client.js';
import { toMountableToolInfo } from '../src/agent/agent-factory.js';

const PARENT_QUERY = ['listScenarios', 'listOntologies', 'listOntoBehaviors', 'listOntoConcepts',
  'listOntoRelations', 'listOntoFunctions', 'listOntoSecurities', 'listOntoProcesses'];

async function main() {
  const client = new MCPClient('http://localhost:8002/sse');
  await client.connect();
  const { tools } = await client.listTools();
  console.log(`MCP 工具总数: ${tools.length}`);
  const catalog = tools
    .filter((t: any) => !PARENT_QUERY.includes(t.name) && t.name !== 'executeOntoBehavior')
    .map((t: any) => toMountableToolInfo({ name: t.name, description: t.description, parameters: (t as any).inputSchema }));
  console.log(`目录条目总数: ${catalog.length}\n分类统计:`);
  const byCat: Record<string, number> = {};
  for (const e of catalog) byCat[e.category] = (byCat[e.category] ?? 0) + 1;
  console.log(byCat);

  // 四类各取一个代表，打印完整 JSON
  const picks = ['CreatePurchaseRecord', 'sumRawNotArrivalQty', 'getCurrentDate'];
  const external = catalog.find((e: any) => e.category === '其他MCP工具');
  for (const name of picks) {
    const e = catalog.find((x: any) => x.name === name);
    if (e) console.log(`\n===== ${name} =====\n${JSON.stringify(e, null, 2)}`);
  }
  if (external) console.log(`\n===== ${external.name}（其他MCP工具代表） =====\n${JSON.stringify(external, null, 2)}`);
  await client.close?.();
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
