/**
 * 规划校验 —— 纯函数集合，脱离 orchestrator 可独立单测。
 * 输入 plan（+ 只读的 OntologyGateway / FunctionCatalogView），输出错误/非法项列表，不做任何编排副作用。
 */
import type { SubTask, SubTaskPlan } from '../types.js';
import type { OntologyGatewayPort } from './agent-ports.js';
import type { FunctionCatalogView } from './function-catalog.js';
import { validateParamsAgainstSchema } from './param-contract.js';

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

/**
 * 参数校验（行为/函数统一）：对 core 编译的 inputSchema 跑「必填 key 齐全 + 已填值合规」。
 * 编译 schema 已含概念属性约束（enum/pattern/min/max/必填 minLength），类型与约束一次校验覆盖，
 * 不再分"结构校验"与"约束校验"两道。违例统一由 PlanGate nudge 父 Agent 修正一次（不硬停）。
 * schema 数据源 = run 级目录快照（FunctionCatalogView）：行为走 behaviorSchema（scope 裸名回溯），
 * 函数走 functionInfo（三源）。schema 为 null（MCP 未连接/无声明源）→ 跳过（执行期 harness schema 兜底）。
 * 只查"已填值"，value 留空放行，由子 Agent 按 SKILL.md 补 / 波次反馈中继填。
 */
export function validateAllParams(catalog: FunctionCatalogView, plan: SubTaskPlan): string[] {
  const errors: string[] = [];
  for (const st of plan.subtasks) {
    const schema = st.function
      ? (catalog.functionInfo(st.scenario_name, st.ontology_name, st.function)?.schema ?? null)
      : catalog.behaviorSchema(st.scenario_name, st.ontology_name, st.behavior);
    if (!schema) continue;
    errors.push(...validateParamsAgainstSchema(schema, st.params || {}, st.seq, st.function || st.behavior));
  }
  return errors;
}

/**
 * 本体范围硬闸：每个子任务的 ontology_id 必须在本次对话所选本体集合内（行为/函数子任务同查）。
 * 用户在新建对话时声明的允许集是锚点；公共函数/其他MCP工具是全局工具不受影响
 * （函数子任务的 ontology_id 仅作本体函数路由，越界语义仍是"访问了未授权本体"，一律拦）。
 * 返回违例子任务列表（空数组 = 通过）。allowed 为空集（通用模式）时任何子任务都违例——
 * 但通用模式父 Agent 未挂 submit_plan，规划到不了这里，本函数无需特判。
 */
export function validateOntologyScope(plan: SubTaskPlan, allowed: ReadonlySet<number>): SubTask[] {
  return plan.subtasks.filter(st => !allowed.has(st.ontology_id));
}

/**
 * 言行不一检测：父 Agent 文本声称"已提交规划/即将开始执行"，但 submit_plan 工具回调为空时使用。
 * 只在规划阶段"无规划"分支调用（有规划时不评估，正常路径零影响）。
 * 命中 → 调用方 nudge 一次自救；仍无规划 → 诚实报错，不把虚假声明原文转发给用户。
 * 误判防护：只认完成态/宣告态措辞（已提交/提交了/即将开始执行），
 * 条件要约（"可以提交/如果需要我可以提交"）不匹配。
 */
export function looksLikePlanClaim(text: string): boolean {
  if (!text) return false;
  if (/submit_?plan/i.test(text)) return true;
  const CLAIM_PATTERNS = [
    // "已提交执行计划" / "已为您提交了规划"
    /(已|已经|已为您|刚刚|现已|成功)\s*提交[^。!！?？\n]{0,15}(计划|规划)/,
    /提交(了|完成)[^。!！?？\n]{0,15}(计划|规划)/,
    // "执行计划已提交" / "规划已成功提交"（要求"已/已经/成功"完成态标记，
    // 排除"如需调整计划，请重新提交"这类建议性表述）
    /(计划|规划)[^。!！?？\n]{0,12}(已|已经|成功)提交(了|完成)?/,
    // "执行计划已生成/已制定完成"（声称规划存在但未走工具；
    // 必须带"执行"限定，排除"生产计划已完成"这类业务数据直答）
    /执行(计划|规划)[^。!！?？\n]{0,8}(已|已经)(生成|制定|完成)/,
    // "即将/现在/马上开始执行子任务/计划"（执行宣告，规划阶段不可能真在执行）
    /(即将|现在|马上)\s*(开始)?\s*执行[^。!！?？\n]{0,10}(子任务|计划|规划|步骤)/,
  ];
  return CLAIM_PATTERNS.some(p => p.test(text));
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
