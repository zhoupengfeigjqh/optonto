/**
 * 编排层端口 —— Orchestrator 依赖的最小接口集。
 * 与 AgentPort / SubtaskRunnerDeps 同构：真实实现（AgentFactory / OntologyGateway）
 * 结构化满足这些接口，测试可用 fake 替换，主循环（分波/终止/反馈/总结）可脱离真实 SDK 单测。
 */
import type { AgentPort } from './agent-port.js';
import type { ToolErrorBudget } from './error-budget.js';
import type { LegalCalls } from './legal-calls.js';
import type { ChildSecurityCtx } from './security-policy.js';
import type { ThreadMessage, SkillContext, SkillSelection, SubTaskPlan, BehaviorMeta, FunctionInfo } from '../types.js';

/** 可挂载函数/工具目录条目（getMountableToolCatalog 返回）。三类：本体函数 / 公共函数 / 其他MCP工具 */
export interface MountableToolInfo {
  name: string;
  category: '本体函数' | '公共函数' | '其他MCP工具';
  description: string;
  /** 中文显示名（发布方结构化标记：本体函数 scope.display_name / 公共函数 x-display_name），无则由上层兜底 */
  displayName?: string;
  /** 参数声明结构（inputSchema 经 schemaToDeclaredParams 转形，已剥离 scope/ontology_id），与子任务 params 填法同形 */
  params: Record<string, any>;
  /** 本体函数独有：所属场景/本体真实值（ontology_id/scenario_id/scenario_name/ontology_name） */
  scope?: Record<string, any>;
}

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
    requiredParamsMap?: Record<string, string[]>,
    errorBudget?: ToolErrorBudget,
    legalCalls?: LegalCalls,
    security?: ChildSecurityCtx,
  ): Promise<AgentPort>;
  /** 直连调用函数/MCP 工具（函数子任务确定性执行，不经子 Agent LLM）。返回 MCP 结果文本与是否出错。 */
  callFunctionTool(functionName: string, ontologyId: number, params: Record<string, any>): Promise<{ text: string; isError: boolean }>;
  /** 可挂载函数/工具目录（本体函数/公共函数/其他MCP工具三类），父 Agent listAllMcpFunctions 工具与规划校验共用 */
  getMountableToolCatalog(): Promise<MountableToolInfo[]>;
  closeAll(): Promise<void>;
}

/** OntologyGateway 门面 —— Orchestrator 需要的本体元信息查询能力（校验 + 展示用） */
export interface OntologyGatewayPort {
  getBehaviorMeta(scenario: string, ontology: string, behavior: string): BehaviorMeta;
  getBehaviorNames(scenario: string, ontology: string): string[];
  /** 本体函数名列表（本体函数 ∪ 公共函数；函数子任务名校验的文件兜底数据源，正常模式以 MCP 目录为准） */
  getFunctionNames(scenario: string, ontology: string): string[];
  /** 函数信息合一查询（中文名 + 描述 + 参数声明 + 关联概念）：本体函数 functions[] → 公共函数 functions.json；
   *  都不在返回 null。FunctionCatalog 文件兜底模式（meta/params）与规划期约束校验（concepts）共用。 */
  getFunctionInfo(scenario: string, ontology: string, functionName: string): FunctionInfo | null;
}
