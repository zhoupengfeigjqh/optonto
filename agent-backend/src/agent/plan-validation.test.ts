/**
 * topologicalSort 单元测试 —— 独立出来的图算法，补边界兜底（此前只能靠编排集成测试间接覆盖）。
 * 环不在本函数职责内（validatePlanStructure 已前置拦截），故不测环。
 */
import { describe, it, expect } from 'vitest';
import { topologicalSort } from './plan-validation.js';
import type { SubTask } from '../types.js';

function st(seq: number, depends_on?: number[]): SubTask {
  return {
    seq, behavior: `B${seq}`, params: {}, description: `子任务${seq}`,
    scenario_name: '生产调度', scenario_id: 1, ontology_name: '原材料采购和库存', ontology_id: 1,
    ...(depends_on ? { depends_on } : {}),
  };
}

describe('topologicalSort', () => {
  it('无依赖：保持原序', () => {
    expect(topologicalSort([st(1), st(2), st(3)]).map(s => s.seq)).toEqual([1, 2, 3]);
  });

  it('线性依赖：依赖在前', () => {
    // 3 依赖 2，2 依赖 1，输入乱序
    expect(topologicalSort([st(3, [2]), st(1), st(2, [1])]).map(s => s.seq)).toEqual([1, 2, 3]);
  });

  it('多依赖汇聚：所有依赖先于后继', () => {
    // 4 依赖 2、3；2、3 都依赖 1
    const sorted = topologicalSort([st(4, [2, 3]), st(2, [1]), st(3, [1]), st(1)]);
    const idx = new Map(sorted.map((s, i) => [s.seq, i]));
    expect(idx.get(1)!).toBeLessThan(idx.get(2)!);
    expect(idx.get(1)!).toBeLessThan(idx.get(3)!);
    expect(idx.get(2)!).toBeLessThan(idx.get(4)!);
    expect(idx.get(3)!).toBeLessThan(idx.get(4)!);
  });

  it('悬空依赖（引用不存在的 seq）被跳过，不抛错', () => {
    expect(topologicalSort([st(1), st(2, [99])]).map(s => s.seq)).toEqual([1, 2]);
  });

  it('空数组 → 空数组', () => {
    expect(topologicalSort([])).toEqual([]);
  });
});
