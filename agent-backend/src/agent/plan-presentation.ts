/**
 * 规划与中继的展示层渲染（自 `orchestrator.ts` 抽取，2026-10-06，宪法 II ≤500 行）。
 *
 * ## 为什么抽
 *
 * 这三个函数是**纯渲染**：把结构化数据转成给人看的字符串 / 展示字段，不含任何
 * 编排决策（不排波、不调度、不碰 run状态）。此前它们与编排逻辑混在一个类里，
 * 使 orchestrator.ts 超过 500 行；而它们与"编排"是**两个不同的关注点**，
 * 拆开后各自可独立测试（只需传 gateway 与 catalog，无需构造 Orchestrator）。
 *
 * ## 单一事实源不变
 *
 * `buildRelayStructureHint` 取的是**权威参数声明**（函数走 FunctionCatalog 三源、
 * 行为走 gateway 行为声明），与中继后的参数校验器消费同一份声明——填值依据与判错
 * 依据严格一致，不靠父 Agent 记忆或抄写。抽取不改变该口径。
 */
import { isParamValueEmpty, renderParamStructure, type ParamSpec } from './param-contract.js';
import type { OntologyGatewayPort } from './agent-ports.js';
import type { FunctionCatalogView } from './function-catalog.js';
import type { SubTask, SubTaskPlan, SubTaskResult } from '../types.js';
import type { EventChannel } from './event-channel.js';

/** 波收尾的失败 token 渲染（securityBlocked / 普通失败两分支共用） */
export function emitWaveFailures(waveResults: SubTaskResult[], emit: EventChannel): void {
  for (const r of waveResults) {
    if (!r.success) emit.raw({ type: 'token', token: `\r📋 **子任务 ${r.seq} ${r.task}** ❌ ${r.error}\n` });
  }
}

/**
 * 中继结构参考（硬编码取数，无 LLM 选择空间）：找出直接依赖本波结果的后续子任务，
 * 从权威声明现取其 array/object 参数结构，渲染成 sketch 附进中继 prompt。
 *
 * 无声明源（functionParams 返回 null）或全部参数都是标量 → 返回空串（prompt 不加段）。
 */
export function buildRelayStructureHint(
  gateway: OntologyGatewayPort,
  catalog: FunctionCatalogView,
  waveResults: SubTaskResult[],
  pending: SubTask[],
): string {
  const waveSeqs = new Set(waveResults.map(r => r.seq));
  // 只取直接依赖本波的子任务：跨代依赖到后续波次中继时再填，不超前
  const dependents = pending.filter(st => (st.depends_on || []).some(d => waveSeqs.has(d)));
  if (dependents.length === 0) return '';
  const blocks: string[] = [];
  for (const st of dependents) {
    const declared = st.function
      ? (catalog.functionInfo(st.scenario_name, st.ontology_name, st.function)?.params ?? null)
      : gateway.getBehaviorMeta(st.scenario_name, st.ontology_name, st.behavior)?.params;
    if (!declared) continue; // 无声明源 → 跳过（与校验器"无声明跳过、MCP schema 兜底"口径一致）
    const lines: string[] = [];
    for (const [key, spec] of Object.entries(declared)) {
      const s = spec as ParamSpec;
      if (s?.type !== 'array' && s?.type !== 'object') continue; // 标量无内部结构，不需要提示
      lines.push(...renderParamStructure(key, s, { filled: !isParamValueEmpty(st.params?.[key]) }));
    }
    if (lines.length > 0) blocks.push(`子任务${st.seq}（${st.function || st.behavior}）：\n${lines.join('\n')}`);
  }
  if (blocks.length === 0) return '';
  return `\n\n【待填参数结构参考】（以下子任务依赖本波结果，其 array/object 参数严格按此结构填纯值，数组项/对象字段直接填值即可，不要再包 {type/value} 等包装）\n${blocks.join('\n')}`;
}

/**
 * 给规划补展示字段：每个子任务附加行为中文名 display_name，供前端弹窗可读展示。
 *
 * 纯展示用途，不参与结构校验；行为/函数名已在确认前经 validateTaskBehaviorNames /
 * validateTaskFunctionNames 校验存在，getBehaviorMeta 不会抛错。
 */
export function enrichPlanDisplay(
  gateway: OntologyGatewayPort,
  catalog: FunctionCatalogView,
  plan: SubTaskPlan,
): SubTaskPlan {
  return {
    ...plan,
    subtasks: plan.subtasks.map(st => ({
      ...st,
      display_name: st.function
        ? (catalog.functionInfo(st.scenario_name, st.ontology_name, st.function)?.displayName ?? '')
        : (gateway.getBehaviorMeta(st.scenario_name, st.ontology_name, st.behavior).display_name || ''),
    })),
  };
}