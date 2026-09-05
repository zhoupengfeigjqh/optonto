/**
 * 编排层端口 —— Orchestrator 依赖的最小接口集（单文件：原 agent-port.ts 已并入——
 * 两个"端口"文件分立只是历史切片，概念同为编排层对外缝）。
 * 与 SubtaskRunnerDeps 同构：真实实现（AgentFactory / OntologyGateway / pi-agent-core）
 * 结构化满足这些接口，测试可用 fake 替换，主循环（分波/终止/反馈/总结）可脱离真实 SDK 单测。
 */
import type { SubtaskPolicy } from './execution-policy.js';
import type { MountableToolInfo } from './tool-catalog.js';
import type { ThreadMessage, SkillContext, SkillSelection, SubTaskPlan, BehaviorMeta, FunctionMeta } from '../types.js';

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

/** AgentFactory 门面 —— Orchestrator 需要的工厂能力（创建父/子 Agent + run 级资源释放） */
export interface AgentFactoryPort {
  createParentAgent(
    skills: SkillSelection[],
    history: ThreadMessage[],
    onSkillLoaded: (skillName: string) => void,
    onPlanSubmitted?: (plan: SubTaskPlan) => void,
  ): Promise<AgentPort>;
  /** 创建子 Agent（执行专家）。policy 由 buildSubtaskPolicy 一处派生（完整策略对象，不存在半设防形态） */
  createChildAgent(context: SkillContext, policy: SubtaskPolicy): Promise<AgentPort>;
  /** 直连调用函数/MCP 工具（函数子任务确定性执行，不经子 Agent LLM）。返回 MCP 结果文本与是否出错。 */
  callFunctionTool(functionName: string, ontologyId: number, params: Record<string, any>): Promise<{ text: string; isError: boolean }>;
  /** 可挂载工具目录（本体行为/本体函数/公共函数/其他MCP工具四类），父 Agent listAllMcpFunctions 工具与规划校验共用 */
  getMountableToolCatalog(): Promise<MountableToolInfo[]>;
  closeAll(): Promise<void>;
}

/** OntologyGateway 门面 —— Orchestrator 需要的本体元信息查询能力（校验 + 展示用） */
export interface OntologyGatewayPort {
  getBehaviorMeta(scenario: string, ontology: string, behavior: string): BehaviorMeta;
  getBehaviorNames(scenario: string, ontology: string): string[];
  /** 本体函数名列表（本体函数 ∪ 公共函数；函数子任务名校验的文件兜底数据源，正常模式以 MCP 目录为准） */
  getFunctionNames(scenario: string, ontology: string): string[];
  /** 函数信息合一查询（中文名 + 描述 + 参数声明）：本体函数 functions[] → 公共函数 functions.json；
   *  都不在返回 null。FunctionCatalog 文件兜底模式（meta/params）的数据源。 */
  getFunctionInfo(scenario: string, ontology: string, functionName: string): FunctionMeta | null;
}
