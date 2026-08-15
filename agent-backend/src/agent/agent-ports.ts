/**
 * 编排层端口 —— Orchestrator 依赖的最小接口集。
 * 与 AgentPort / SubtaskRunnerDeps 同构：真实实现（AgentFactory / OntologyGateway）
 * 结构化满足这些接口，测试可用 fake 替换，主循环（分波/终止/反馈/总结）可脱离真实 SDK 单测。
 */
import type { AgentPort } from './agent-port.js';
import type { ToolErrorBudget } from './error-budget.js';
import type { LegalCalls } from './legal-calls.js';
import type { ThreadMessage, SkillContext, SkillSelection, SubTaskPlan, BehaviorMeta } from '../types.js';

/** AgentFactory 门面 —— Orchestrator 需要的工厂能力（创建父/子 Agent + run 级资源释放） */
export interface AgentFactoryPort {
  createParentAgent(
    skills: SkillSelection[],
    history: ThreadMessage[],
    onSkillLoaded: (skillName: string) => void,
    onPlanSubmitted?: (plan: SubTaskPlan) => void,
  ): Promise<AgentPort>;
  createChildAgent(
    context: SkillContext,
    primaryBehavior?: string,
    requiredParams?: string[],
    errorBudget?: ToolErrorBudget,
    legalCalls?: LegalCalls,
  ): Promise<AgentPort>;
  closeAll(): Promise<void>;
}

/** OntologyGateway 门面 —— Orchestrator 需要的本体元信息查询能力（校验 + 展示用） */
export interface OntologyGatewayPort {
  getBehaviorMeta(scenario: string, ontology: string, behavior: string): BehaviorMeta;
  getBehaviorNames(scenario: string, ontology: string): string[];
  /** 函数元信息（中文显示名），工具调用展示用 */
  getFunctionMeta(scenario: string, ontology: string, functionName: string): { display_name: string; description?: string };
}
