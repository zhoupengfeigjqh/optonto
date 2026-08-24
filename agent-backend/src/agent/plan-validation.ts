/**
 * 规划校验 —— 纯函数集合，脱离 orchestrator 可独立单测。
 * 输入 plan（+ 只读的 OntologyGateway / FunctionCatalogView），输出错误/非法项列表，不做任何编排副作用。
 */
import type { SubTask, SubTaskPlan } from '../types.js';
import type { OntologyGatewayPort } from './agent-ports.js';
import type { FunctionCatalogView } from './function-catalog.js';
import { validateParamStructure, buildAttrConstraintMap, mergeAttrConstraints, validateConstraintValues, type ConstraintViolations } from './param-contract.js';

export interface InvalidTaskName {
  sub: SubTask;
  valid: string[];
}

/** 行为名合法性：枚举比对行为是否存在于所属本体。函数子任务（function 非空）跳过。返回非法子任务及该本体的合法名列表。 */
export function validateBehaviorNames(gateway: OntologyGatewayPort, plan: SubTaskPlan): InvalidTaskName[] {
  const invalid: InvalidTaskName[] = [];
  for (const st of plan.subtasks) {
    if (st.function) continue; // 函数子任务不走行为名校验
    const names = gateway.getBehaviorNames(st.scenario_name, st.ontology_name);
    if (!names.includes(st.behavior)) invalid.push({ sub: st, valid: names });
  }
  return invalid;
}

/** 函数名合法性：函数子任务的 function 必须存在于合法函数集合。行为子任务跳过。
 *  合法集合由 FunctionCatalogView 单源提供（本体函数 ∪ 公共函数 ∪ 其他MCP工具，三源 join 已收进 FunctionCatalog）。 */
export function validateFunctionNames(catalog: FunctionCatalogView, plan: SubTaskPlan): InvalidTaskName[] {
  const invalid: InvalidTaskName[] = [];
  for (const st of plan.subtasks) {
    if (!st.function) continue;
    const names = catalog.functionNames(st.scenario_name, st.ontology_name);
    if (!names.includes(st.function)) invalid.push({ sub: st, valid: names });
  }
  return invalid;
}

/** 参数结构校验：必填字段齐全 + 类型匹配。只查"结构"不查 value（缺失值由子Agent 按 SKILL.md 补）。判定委托给 param-contract。
 *  函数节点的参数声明由 FunctionCatalogView 单源提供（functionInfo：本体函数限定本体 → 公共函数 → 其他MCP工具）；
 *  函数不在任何源（functionInfo null）→ 结构无从比对，跳过（参数正确性由 MCP 工具 schema 兜底）。 */
export function validateAllParams(gateway: OntologyGatewayPort, catalog: FunctionCatalogView, plan: SubTaskPlan): string[] {
  const errors: string[] = [];
  for (const st of plan.subtasks) {
    if (st.function) {
      const fnParams = catalog.functionInfo(st.scenario_name, st.ontology_name, st.function)?.params ?? null;
      // null = 函数不在任何声明源 → 结构无从比对，跳过（参数正确性由 MCP 工具 schema 兜底）
      if (fnParams) errors.push(...validateParamStructure(fnParams, st.params || {}, st.seq, st.function));
      continue;
    }
    const meta = gateway.getBehaviorMeta(st.scenario_name, st.ontology_name, st.behavior);
    errors.push(...validateParamStructure(meta.params, st.params || {}, st.seq, st.behavior));
  }
  return errors;
}

/**
 * 枚举/匹配模式约束校验（校验链尾）：按"参数名 = 属性名"从关联概念的属性 constraint 回溯
 * 枚举/正则，对已填非空值递归校验。分类返回——枚举违例（高风险，调用方硬停止整个任务）
 * 与模式不匹配（可 nudge 父 Agent 转换格式）。
 * 行为子任务：声明源 = getBehaviorMeta（params + related_concepts 解析的概念属性）；
 * 函数子任务：声明源 = getFunctionInfo（本体函数按 related_concepts 解析概念属性；
 * 公共函数 concepts 恒空 → 自然跳过；第三源 MCP 工具 info 为 null → 跳过）。
 * 子 Agent 执行期不做此类检查。
 */
export function validateAllConstraints(gateway: OntologyGatewayPort, plan: SubTaskPlan): ConstraintViolations {
  const out: ConstraintViolations = { patternErrors: [], enumErrors: [] };
  for (const st of plan.subtasks) {
    let declared: Record<string, any> | null;
    let concepts: Parameters<typeof buildAttrConstraintMap>[0];
    if (st.function) {
      const info = gateway.getFunctionInfo(st.scenario_name, st.ontology_name, st.function);
      if (!info) continue; // 第三源 MCP 工具：无文件声明源，跳过
      declared = info.params;
      concepts = info.concepts || [];
    } else {
      const meta = gateway.getBehaviorMeta(st.scenario_name, st.ontology_name, st.behavior);
      if (!meta?.params) continue;
      declared = meta.params;
      concepts = meta.concepts || [];
    }
    const attrMap = buildAttrConstraintMap(concepts);
    if (attrMap.size === 0) continue; // 关联属性无约束声明 → 无校验依据
    const merged = mergeAttrConstraints(declared, attrMap);
    const v = validateConstraintValues(merged, st.params || {}, st.seq, st.function || st.behavior);
    out.patternErrors.push(...v.patternErrors);
    out.enumErrors.push(...v.enumErrors);
  }
  return out;
}

/**
 * seq 冲突校验：① 规划内 seq 唯一；② 反馈路径防冒名——seq 指向已执行子任务但任务名不一致
 * （调整规划是权威全集，冒名 seq 会被"剔除已执行"filter 当成已执行静默吞掉，新任务凭空消失）。
 * executedTasks：已执行 seq → 任务名（波次反馈路径传入）；不传（规划路径）则规则②休眠。
 */
export function validateSeqConflicts(plan: SubTaskPlan, executedTasks?: ReadonlyMap<number, string>): string[] {
  const errors: string[] = [];
  const seen = new Map<number, string>();
  for (const st of plan.subtasks) {
    const name = st.function || st.behavior;
    if (seen.has(st.seq)) {
      errors.push(`seq ${st.seq} 被重复占用（${seen.get(st.seq)} 与 ${name}）`);
    } else {
      seen.set(st.seq, name);
    }
    const executedName = executedTasks?.get(st.seq);
    if (executedName !== undefined && executedName !== name) {
      errors.push(`子任务 ${st.seq}（${name}）冒用了已执行子任务的 seq（已执行的是 ${executedName}），新增子任务请使用未占用的 seq`);
    }
  }
  return errors;
}

/** 按 depends_on 拓扑排序（DFS 后序：依赖在前，被依赖的后继在后）。悬空依赖对应的 seq 直接跳过（已被 validatePlanStructure 兜底）。 */
export function topologicalSort(subtasks: SubTask[]): SubTask[] {
  const sorted: SubTask[] = [];
  const visited = new Set<number>();
  const visit = (seq: number) => {
    if (visited.has(seq)) return;
    visited.add(seq);
    const st = subtasks.find(s => s.seq === seq);
    if (!st) return;
    if (st.depends_on) for (const d of st.depends_on) visit(d);
    sorted.push(st);
  };
  for (const st of subtasks) visit(st.seq);
  return sorted;
}

/**
 * 规划结构校验：依赖存在性 / 无自引用 / 无环。返回错误列表（空数组 = 通过）。
 * executedSeqs：已执行成功子任务的 seq 集合（波次反馈中继路径传入）。
 * dep 指向已执行子任务不算悬空——它不是"不存在"而是"已完成"：中继调整规划常只含
 * 剩余未执行子任务，depends_on 仍引用已执行的前序 seq，这是合法的（执行时就绪检查读 session.results）。
 */
export function validatePlanStructure(plan: SubTaskPlan, executedSeqs: ReadonlySet<number> = new Set()): string[] {
  const errors: string[] = [];
  const seqs = new Set(plan.subtasks.map(st => st.seq));
  for (const st of plan.subtasks) {
    if (!st.depends_on || st.depends_on.length === 0) continue;
    for (const dep of st.depends_on) {
      if (dep === st.seq) errors.push(`子任务 ${st.seq} 不能依赖自身`);
      else if (!seqs.has(dep) && !executedSeqs.has(dep)) errors.push(`子任务 ${st.seq} 依赖的子任务 ${dep} 不存在（可能已被删除）`);
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
