/**
 * Orchestrator 规划确认策略单元测试。
 * 验证 planNeedsConfirm：仅多步任务需要规划确认弹窗，单步任务跳过（由安全管控弹窗兜底）。
 */
import { describe, it, expect } from 'vitest';
import { planNeedsConfirm } from './orchestrator.js';
import type { SubTask, SubTaskPlan } from '../types.js';

function mkSubtask(seq: number): SubTask {
  return {
    seq, behavior: `Behavior${seq}`, params: {}, description: `子任务${seq}`,
    scenario_name: '生产调度', ontology_name: '原材料采购和库存', ontology_id: 1,
  };
}

function plan(subtasks: SubTask[]): SubTaskPlan {
  return { subtasks };
}

describe('planNeedsConfirm — 规划确认策略', () => {
  it('单步任务：跳过规划确认（false）', () => {
    expect(planNeedsConfirm(plan([mkSubtask(1)]))).toBe(false);
  });

  it('多步任务：需要规划确认（true）', () => {
    expect(planNeedsConfirm(plan([mkSubtask(1), mkSubtask(2)]))).toBe(true);
    expect(planNeedsConfirm(plan([mkSubtask(1), mkSubtask(2), mkSubtask(3), mkSubtask(4), mkSubtask(5)]))).toBe(true);
  });

  it('空规划：不弹确认（false，兜底防御）', () => {
    expect(planNeedsConfirm(plan([]))).toBe(false);
  });
});
