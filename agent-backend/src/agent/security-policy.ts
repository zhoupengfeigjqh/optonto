// needsSecurityConfirm（人工确认判定）已迁 execution-policy.ts：它是调度/指令侧的执行面判定，
// 本文件只留运行面硬闸（disable 命中即全场停摆的 SecurityGate 机制）。

/**
 * Run 级安全闸 —— 权限范围 disable 的运行面硬闸共享状态（2026-08-27 定稿：工具层单点）。
 *
 * 一个 run 仅一个实例（RunSession 持有），全 run 所有子 Agent 的工具 execute 包装共享：
 * 任一行为工具（facade）调用命中 disable → 置 violation + 返回 terminate:true
 * （不抛错、不计工具报错预算、无 LLM 试错——策略级拒绝不存在"改对了再试"，重试必败）；
 * violation 置位后，所有后续工具调用在入口短路一律 terminate（中断信号的广播机制），
 * 兄弟子 Agent 随之停摆，orchestrator 波次截断后整个 run 以 securityBlocked 结局收尾。
 *
 * 关键机制同 error-budget：pi-agent 的 executePreparedToolCall 硬编码 isError:false（返回值里的
 * isError 会被吞），只有 result.terminate 透传并被 shouldTerminateToolBatch 消费 → 停内层循环只靠 terminate。
 */
export interface SecurityGate {
  /** 首次命中的 disable 违规文案（first-writer-wins；SubtaskRunner/orchestrator 据此判 securityViolation/securityBlocked） */
  violation: string | null;
}

export function createSecurityGate(): SecurityGate {
  return { violation: null };
}

/** 子 Agent 安全上下文：工具层 disable 闸的输入（禁用集合 + run 级共享闸），由 buildSubtaskPolicy 派生并进 SubtaskPolicy */
export interface ChildSecurityCtx {
  /** 禁用行为集合：behavior_name → display_name（报错文案展示用）；子任务启动时从合法清单内筛 scope 含 disable 者 */
  disabled: ReadonlyMap<string, string>;
  /** run 级共享安全闸（见上） */
  gate: SecurityGate;
}

/** disable 命中文案（工具层闸与结果侧共用，单一事实源） */
export function buildDisableMessage(behaviorName: string, displayName?: string): string {
  const label = displayName ? `${displayName}（${behaviorName}）` : behaviorName;
  return `🔒 行为已被禁用：${label} 的权限范围为 disable，已中断执行。如需启用，请在本体「安全」页签调整该行为的权限范围。`;
}

/**
 * disable 命中的统一终止返回体（与 error-budget 的 terminateResult 同构）。
 * 文本会作为 toolResult 喂回 LLM 说明停止原因；isError 被 pi-agent 吞掉，terminate 生效停循环。
 */
export function securityTerminateResult(message: string) {
  return {
    content: [{ type: 'text', text: message }],
    details: {},
    isError: true,
    terminate: true,
  };
}
