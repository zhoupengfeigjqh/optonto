/**
 * 验证：前置/后置规则 data_supplements 行为参数结构渲染。
 * 真实 OntologyGateway + 真实 SubtaskRunner.buildInstruction。
 * 运行：npx tsx scripts/verify-supplement-render.ts
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
const dataDir = resolve(repoRoot, '.data');

const pac = new PathAccessController(dataDir, resolve(dataDir, 'threads'));
const gateway = new OntologyGateway(pac);

const ctx: SkillContext = { scenario_name: '生产调度', scenario_id: 1, ontology_name: '原材料采购和库存', ontology_id: 1 };

const subTask: SubTask = {
  seq: 1,
  behavior: 'CreatePurchaseRecord',
  params: {
    rawMaterialId: { type: 'string', required: true, value: 'RM-001' },
    rawMaterialName: { type: 'string', required: true, value: '高强度钢板' },
    arrivalQuantity: { type: 'number', required: true, value: 50 },
    supplierName: { type: 'string', required: true, value: '宝钢钢铁集团' },
    arrivalTime: { type: 'string', required: true, value: '2026-08-20' },
    unit: { type: 'string', required: true, value: '吨' },
  },
  description: '创建高强度钢板的采购单，前置规则需校验原料存在性、单位一致、供应商存在、到位时间合理',
  scenario_name: '生产调度',
  scenario_id: 1,
  ontology_name: '原材料采购和库存',
  ontology_id: 1,
};

const meta: BehaviorMeta = gateway.getBehaviorMeta(ctx.scenario_name, ctx.ontology_name, subTask.behavior);

const runner = new SubtaskRunner({
  confirmManager: null as unknown as ConfirmManager,
  createChildAgent: async () => (null as any),
  childAgents: new Set(),
  getBehaviorDisplayName: (s: string, o: string, b: string) => gateway.getBehaviorMeta(s, o, b).display_name || '',
  getFunctionDisplayName: () => '',
  getBehaviorParams: (s: string, o: string, b: string) => gateway.getBehaviorMeta(s, o, b).params || {},
});

console.log((runner as any).buildInstruction(subTask, meta));
