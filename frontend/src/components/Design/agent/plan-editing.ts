/**
 * 规划（plan）编辑与校验的纯逻辑（自 AgentApp.tsx 的 AgentConversation 抽取）。
 *
 * 抽出来的理由：规划确认弹窗的「改参数 / 删子任务 / 调依赖 / 提交前校验」全是纯数据变换，
 * 与 React 状态无关，混在 900 行的会话组件里既难单测也难复用。
 *
 * 所有函数均不可变：返回新的 plan 对象，不修改入参。
 * 深拷贝策略与抽取前一致（`JSON.parse(JSON.stringify(...))`）——规划数据只含 JSON 可表达的值。
 */

/** 规划中的一个子任务（字段按后端规划结构与界面消费需要列出，其余字段原样保留） */
export interface PlanSubtask {
  seq: number;
  behavior: string;
  display_name?: string;
  description?: string;
  /** 参数：`{ [key]: { value, description?, required? } }` 或历史裸值 */
  params?: Record<string, any>;
  depends_on?: number[];
  [key: string]: any;
}

export interface Plan {
  subtasks?: PlanSubtask[];
  [key: string]: any;
}

/** 深拷贝规划（编辑前先复制，避免直接改动弹窗里的原始值） */
export function clonePlan<T>(plan: T): T {
  return JSON.parse(JSON.stringify(plan));
}

/** 修改某子任务的参数值（参数项不存在时不动——与抽取前行为一致） */
export function updateSubtaskParam(plan: Plan, seq: number, key: string, value: string): Plan {
  const next = clonePlan(plan);
  const target = next.subtasks?.find(s => s.seq === seq);
  if (target?.params?.[key]) target.params[key].value = value;
  return next;
}

/**
 * 删除子任务，并**级联清理**其他子任务对它的依赖。
 * 不清理会留下悬空依赖，提交时被后端/前端校验拦下，用户需手工再删一遍。
 */
export function deleteSubtask(plan: Plan, seq: number): Plan {
  const next = clonePlan(plan);
  next.subtasks = (next.subtasks || []).filter(s => s.seq !== seq);
  next.subtasks.forEach(s => {
    if (s.depends_on) s.depends_on = s.depends_on.filter(d => d !== seq);
  });
  return next;
}

/** 设置某子任务的前置依赖 */
export function setSubtaskDeps(plan: Plan, seq: number, deps: number[]): Plan {
  const next = clonePlan(plan);
  const target = next.subtasks?.find(s => s.seq === seq);
  if (target) target.depends_on = deps;
  return next;
}

/**
 * 前端结构校验：依赖存在性 / 无自引用 / 无环。返回错误列表（空 = 通过）。
 * 环检测用 DFS 三色标记（1=访问中，2=已完成）。
 */
export function validatePlan(plan: Plan): string[] {
  const errors: string[] = [];
  const subs: any[] = plan?.subtasks || [];
  const seqs = new Set<number>(subs.map((s: any) => s.seq));
  for (const st of subs) {
    if (!st.depends_on || !st.depends_on.length) continue;
    for (const d of st.depends_on) {
      if (d === st.seq) errors.push(`子任务 ${st.seq} 不能依赖自身`);
      else if (!seqs.has(d)) errors.push(`子任务 ${st.seq} 依赖的子任务 ${d} 已被删除`);
    }
  }
  // 环检测（DFS 三色标记）
  const color = new Map<number, number>();
  const visit = (seq: number): boolean => {
    const c = color.get(seq) ?? 0;
    if (c === 1) return true;
    if (c === 2) return false;
    color.set(seq, 1);
    const st = subs.find((s: any) => s.seq === seq);
    if (st?.depends_on) for (const d of st.depends_on) if (visit(d)) return true;
    color.set(seq, 2);
    return false;
  };
  for (const st of subs) {
    if (visit(st.seq)) { errors.push('子任务依赖关系存在循环'); break; }
  }
  return errors;
}

/**
 * 判断规划是否未被改动。
 * 仅当确有改动时才回传 editedPlan——否则后端会误判「规划已修改」。
 */
export function isPlanUnchanged(edited: Plan, original: Plan): boolean {
  return JSON.stringify(edited) === JSON.stringify(original);
}
