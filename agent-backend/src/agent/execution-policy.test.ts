/**
 * buildSubtaskPolicy 单元测试 —— 子任务执行策略的单一派生点。
 * 验证四件套一次派生：合法清单 / 必填表（主行为取 meta，补充行为走 info 口）/
 * 禁用集合（scope 含 disable，值带 display_name）/ 报错预算（每子任务一份新实例），
 * 以及 run 级安全闸按引用透传（所有子任务共享同一道闸）。
 */
import { describe, it, expect } from 'vitest';
import { buildSubtaskPolicy } from './execution-policy.js';
import type { SubtaskInfoPort } from './execution-policy.js';
import { createSecurityGate } from './security-policy.js';
import type { SubTask, BehaviorMeta } from '../types.js';

const subTask: SubTask = {
  seq: 1,
  behavior: 'CreatePurchaseRecord',
  params: {},
  description: '创建采购记录',
  scenario_name: '生产调度',
  scenario_id: 1,
  ontology_name: '原材料采购和库存',
  ontology_id: 1,
};

const meta: BehaviorMeta = {
  display_name: '创建采购记录',
  params: { rawMaterialId: { required: true }, note: { required: false } },
  preRules: [
    { name: 'V01', description: '单位一致性', position: '前置', related_behaviors: [], data_supplements: ['QueryRawMaterials'], related_functions: [] },
  ],
  postRules: [
    { name: 'I02', description: '超期预警', position: '后置', related_behaviors: [], data_supplements: [], related_functions: ['getCurrentDate'] },
  ],
  concepts: [],
  isWrite: true,
};

function mkInfo(over?: Partial<SubtaskInfoPort>): SubtaskInfoPort {
  return {
    behaviorDisplayName: (_s, _o, bn) => `${bn}中文名`,
    functionDisplayName: () => '',
    behaviorParams: () => ({ materialName: { required: true }, pageSize: { required: false } }),
    behaviorScope: () => ['everyone'],
    ...over,
  };
}

describe('buildSubtaskPolicy — 子任务执行策略单一派生点', () => {
  it('合法清单 = 主行为 ∪ 规则补充行为 ∪ 规则函数 ∪ 父 Agent related_functions', () => {
    const policy = buildSubtaskPolicy(
      { ...subTask, related_functions: ['sumRawNotArrivalQty'] }, meta, mkInfo(), createSecurityGate(),
    );
    expect(policy.legalCalls.behaviors).toEqual(['CreatePurchaseRecord', 'QueryRawMaterials']);
    expect(policy.legalCalls.functions).toEqual(['getCurrentDate', 'sumRawNotArrivalQty']);
  });

  it('必填表：主行为取 meta.params，补充行为取 info.behaviorParams（只收 required）', () => {
    const policy = buildSubtaskPolicy(subTask, meta, mkInfo(), createSecurityGate());
    expect(policy.requiredParamsMap).toEqual({
      CreatePurchaseRecord: ['rawMaterialId'],
      QueryRawMaterials: ['materialName'],
    });
  });

  it('禁用集合：scope 含 disable 的合法行为入集，主行为 display_name 取 meta、补充行为走 info 口', () => {
    const info = mkInfo({
      behaviorScope: (_s, _o, bn) => bn === 'QueryRawMaterials' ? ['disable'] : ['everyone'],
      behaviorDisplayName: (_s, _o, bn) => bn === 'QueryRawMaterials' ? '查询原材料' : '',
    });
    const policy = buildSubtaskPolicy(subTask, meta, info, createSecurityGate());
    expect([...policy.security.disabled.entries()]).toEqual([['QueryRawMaterials', '查询原材料']]);

    // 主行为被禁：display_name 取 meta（不走 info 口）
    const info2 = mkInfo({ behaviorScope: () => ['disable'] });
    const policy2 = buildSubtaskPolicy(subTask, meta, info2, createSecurityGate());
    expect(policy2.security.disabled.get('CreatePurchaseRecord')).toBe('创建采购记录');
    expect(policy2.security.disabled.get('QueryRawMaterials')).toBe('QueryRawMaterials中文名');
  });

  it('预算每子任务一份新实例；安全闸按引用透传（run 级共享）', () => {
    const gate = createSecurityGate();
    const p1 = buildSubtaskPolicy(subTask, meta, mkInfo(), gate);
    const p2 = buildSubtaskPolicy(subTask, meta, mkInfo(), gate);
    expect(p1.errorBudget).not.toBe(p2.errorBudget); // 预算不共享：各子任务独立熔断
    expect(p1.security.gate).toBe(gate);             // 闸共享：一处命中全场停摆
    expect(p2.security.gate).toBe(gate);
    expect(p1.errorBudget.count).toBe(0);
  });
});
