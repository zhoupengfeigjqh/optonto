/**
 * 验证：规则 related_functions 是否出现在子 Agent 指令中。
 * QueryPurchaseRecords 有后置规则 I02（related_functions: [getCurrentDate]）。
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PathAccessController } from '../src/security/path-access-controller.js';
import { OntologyGateway } from '../src/services/ontology-gateway.js';
import { SubtaskRunner } from '../src/agent/subtask-runner.js';
import type { SubTask, BehaviorMeta, SkillContext } from '../src/types.js';
import type { ConfirmManager } from '../src/agent/confirm-manager.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');
const pac = new PathAccessController(resolve(repoRoot, '.data'), resolve(repoRoot, '.data', 'threads'));
const gateway = new OntologyGateway(pac);

const ctx: SkillContext = { scenario_name: '生产调度', scenario_id: 1, ontology_name: '原材料采购和库存', ontology_id: 1 };
const subTask: SubTask = {
  seq: 1, behavior: 'QueryPurchaseRecords', params: { rawMaterialName: { type: 'string', required: false, value: '高强度钢板' } },
  description: '查询高强度钢板采购记录', scenario_name: ctx.scenario_name, scenario_id: 1, ontology_name: ctx.ontology_name, ontology_id: 1,
};
const meta: BehaviorMeta = gateway.getBehaviorMeta(ctx.scenario_name, ctx.ontology_name, subTask.behavior);

const runner = new SubtaskRunner({
  confirmManager: null as unknown as ConfirmManager,
  createChildAgent: async () => (null as any),
  childAgents: new Set(),
  getBehaviorDisplayName: (s: string, o: string, b: string) => gateway.getBehaviorMeta(s, o, b).display_name || '',
  getFunctionDisplayName: (s: string, o: string, f: string) => gateway.getFunctionMeta(s, o, f).display_name || '',
  getBehaviorParams: (s: string, o: string, b: string) => gateway.getBehaviorMeta(s, o, b).params || {},
  getFunctionParams: (s: string, o: string, f: string) => gateway.getFunctionParams(s, o, f),
});

console.log('该行为关联的规则（含 related_functions）：');
for (const r of [...meta.preRules, ...meta.postRules]) {
  console.log(`  [${r.name}] related_functions=${JSON.stringify(r.related_functions)}`);
}
console.log('\n── 渲染后的指令（后置规则段） ──');
console.log((runner as any).buildInstruction(subTask, meta));

console.log('\n── 非共享（本体函数）路径演示 ──');
const ontologyFn = 'sumRawNotArrivalQty';
console.log(`getFunctionParams(${ontologyFn}) =`, JSON.stringify(gateway.getFunctionParams(ctx.scenario_name, ctx.ontology_name, ontologyFn), null, 2));
console.log((runner as any).renderRelatedFunctions([ontologyFn], ctx.scenario_name, ctx.ontology_name));
