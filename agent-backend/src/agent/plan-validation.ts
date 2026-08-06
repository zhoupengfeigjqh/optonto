/**
 * 规划校验 —— 纯函数集合，脱离 orchestrator 可独立单测。
 * 输入 plan（+ 只读的 OntologyGateway），输出错误/非法项列表，不做任何编排副作用。
 */
import type { SubTask, SubTaskPlan } from '../types.js';
import type { OntologyGatewayPort } from './agent-ports.js';
import { validateParamStructure } from './param-contract.js';

export interface InvalidBehavior {
  sub: SubTask;
  valid: string[];
}

/** 行为名合法性：枚举比对行为是否存在于所属本体。返回非法子任务及该本体的合法名列表。 */
export function validateBehaviorNames(gateway: OntologyGatewayPort, plan: SubTaskPlan): InvalidBehavior[] {
  const invalid: InvalidBehavior[] = [];
  for (const st of plan.subtasks) {
    const names = gateway.getBehaviorNames(st.scenario_name, st.ontology_name);
    if (!names.includes(st.behavior)) invalid.push({ sub: st, valid: names });
  }
  return invalid;
}

/** 参数结构校验：必填字段齐全 + 类型匹配。只查"结构"不查 value（缺失值由子Agent 按 SKILL.md 补）。判定委托给 param-contract。 */
export function validateParamsStructure(gateway: OntologyGatewayPort, plan: SubTaskPlan): string[] {
  const errors: string[] = [];
  for (const st of plan.subtasks) {
    const meta = gateway.getBehaviorMeta(st.scenario_name, st.ontology_name, st.behavior);
    errors.push(...validateParamStructure(meta, st.params || {}, st.seq, st.behavior));
  }
  return errors;
}

/** 规划结构校验：依赖存在性 / 无自引用 / 无环。返回错误列表（空数组 = 通过）。 */
export function validatePlanStructure(plan: SubTaskPlan): string[] {
  const errors: string[] = [];
  const seqs = new Set(plan.subtasks.map(st => st.seq));
  for (const st of plan.subtasks) {
    if (!st.depends_on || st.depends_on.length === 0) continue;
    for (const dep of st.depends_on) {
      if (dep === st.seq) errors.push(`子任务 ${st.seq} 不能依赖自身`);
      else if (!seqs.has(dep)) errors.push(`子任务 ${st.seq} 依赖的子任务 ${dep} 不存在（可能已被删除）`);
    }
  }
  // 环检测（DFS 三色标记：0 未访问 / 1 访问中 / 2 已访问）
  const color = new Map<number, 0 | 1 | 2>();
  const visit = (seq: number): boolean => {
    const c = color.get(seq) ?? 0;
    if (c === 1) return true;
    if (c === 2) return false;
    color.set(seq, 1);
    const st = plan.subtasks.find(s => s.seq === seq);
    if (st?.depends_on) {
      for (const d of st.depends_on) if (visit(d)) return true;
    }
    color.set(seq, 2);
    return false;
  };
  for (const st of plan.subtasks) {
    if (visit(st.seq)) { errors.push('子任务依赖关系存在循环，请调整依赖设置'); break; }
  }
  return errors;
}
