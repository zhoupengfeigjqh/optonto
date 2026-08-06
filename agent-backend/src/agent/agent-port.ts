/**
 * Agent 门面 —— 编排层依赖的最小 Agent 接口（pi-agent-core 实现此缝）。
 * orchestrator / subtask-runner 只依赖这个 interface，不直接读 SDK 内部状态；
 * 测试时可用 fake 实现替换（与 SubtaskRunnerDeps.createChildAgent 同构：一个真实 adapter，测试用 fake）。
 *
 * 注：SDK 的 `state` 是只读 getter，故这里声明为 readonly；`state.messages` 本身可写（编排需注入/裁剪父上下文）。
 */
export interface AgentPort {
  /** 发起一轮 prompt。 */
  prompt(input: string, images?: unknown[]): Promise<void>;
  /** 中断当前在途执行（幂等，安全重复调用）。 */
  abort(): void;
  /** 订阅生命周期事件（SDK 监听器附带当前 run 的 abort signal）。 */
  subscribe(listener: (event: any, signal: AbortSignal) => void): void;
  readonly state: {
    messages: any[];
    errorMessage?: string;
  };
}
