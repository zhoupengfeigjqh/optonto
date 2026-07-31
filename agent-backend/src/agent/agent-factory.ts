import { Agent } from '@earendil-works/pi-agent-core';
import type { AgentMessage, AgentTool } from '@earendil-works/pi-agent-core';
import { getModel, getModels } from '@earendil-works/pi-ai';
import { Type } from '@sinclair/typebox';
import { MCPClient } from '../services/mcp-client.js';
import { MCPConfigStore } from '../services/mcp-config-store.js';
import { SkillLoader } from '../services/skill-loader.js';
import { config } from '../config.js';
import { buildParentPrompt, CHILD_SYSTEM_PROMPT } from './prompts.js';
import { toolResultToText } from './text-utils.js';
import type { ThreadMessage, SkillContext, SubTaskPlan } from '../types.js';

// ─── 工具集配置 ─────────────────────────────

/** 父 Agent（规划专家）的 MCP 只读工具：浏览场景/本体 + 本体结构明细，不含执行类 */
const PARENT_MCP_TOOL_NAMES = [
  'listScenarios', 'listOntologies', 'getCurrentDate',
  'listOntoBehaviors', 'listOntoConcepts', 'listOntoRelations', 'listOntoFunctions', 'listOntoSecurities',
];

/** 子 Agent（执行专家）的 MCP 工具：行为/函数执行 + 时间计算，不含浏览类 */
const CHILD_MCP_TOOL_NAMES = [
  'executeOntoBehavior', 'executeOntoFunction', 'getCurrentDate', 'dateAdd', 'dateDiff', 'getWeekday',
];

/**
 * 解析 DeepSeek 模型：优先用 config.yaml 的 modelName（此前模型被硬编码且配置不生效），
 * 无效时回退默认 flash，避免 getModel 对未知模型名静默返回 undefined。
 */
function resolveDeepSeekModel() {
  const validIds = new Set(getModels('deepseek').map(m => m.id));
  const id = validIds.has(config.modelName) ? config.modelName : 'deepseek-v4-flash';
  return getModel('deepseek', id as 'deepseek-v4-flash' | 'deepseek-v4-pro');
}

/**
 * AgentFactory — 使用 pi-agent-core SDK 创建 Agent 实例。
 *
 * 两阶段 Skill 加载：
 * 阶段 1（初始）：system prompt 只放技能名称和描述
 * 阶段 2（按需）：Agent 调用 load_skill 工具加载完整 SKILL.md
 */
export class AgentFactory {
  /** 按 MCP server URL 缓存连接，避免每个 Agent/子任务新建连接造成传输资源泄漏 */
  private clientCache = new Map<string, MCPClient>();

  constructor(
    private mcpConfigStore: MCPConfigStore,
    private skillLoader: SkillLoader,
  ) {}

  /**
   * 获取（或创建）指定 URL 的 MCP 客户端。同一 URL 全程复用一条连接。
   */
  private getOrCreateClient(url: string): MCPClient {
    let client = this.clientCache.get(url);
    if (!client) {
      client = new MCPClient(url);
      this.clientCache.set(url, client);
    }
    return client;
  }

  /**
   * 关闭所有缓存的 MCP 连接并清空缓存。编排结束（无论成功/失败/中断）时调用。
   */
  async closeAll(): Promise<void> {
    const clients = [...this.clientCache.values()];
    this.clientCache.clear();
    await Promise.allSettled(clients.map(c => c.close().catch(() => {})));
  }

  /**
   * 创建父 Agent（规划专家）。
   * 注册 load_skill + submit_plan + MCP 只读浏览工具（PARENT_MCP_TOOL_NAMES）。
   * - onSkillLoaded：父 Agent 调用 load_skill 时触发，通知 orchestrator 记录已加载的技能名。
   * - onPlanSubmitted：父 Agent 调用 submit_plan 提交规划时触发，规划已通过 TypeBox schema 校验。
   */
  async createParentAgent(
    skillNames: string[],
    history: ThreadMessage[],
    scenario: string,
    ontology: string,
    onSkillLoaded: (skillName: string) => void,
    onPlanSubmitted?: (plan: SubTaskPlan) => void,
  ): Promise<Agent> {
    const descriptions = this.skillLoader.getSkillDescriptions(scenario, ontology, skillNames);
    // 父 Agent 初始时不含"本体基本信息"——它在 load_skill 后从 SKILL.md 内容获取
    const systemPrompt = buildParentPrompt(descriptions);
    const model = resolveDeepSeekModel();

    const loadSkillTool = this.createLoadSkillTool(scenario, ontology, onSkillLoaded);
    const submitPlanTool = this.createSubmitPlanTool(onPlanSubmitted);
    const allMcp = await this.discoverTools(scenario, ontology);
    const parentMcpTools = allMcp.filter(t => PARENT_MCP_TOOL_NAMES.includes(t.name));
    const tools: AgentTool[] = [loadSkillTool, submitPlanTool, ...parentMcpTools];

    const historyMessages: AgentMessage[] = history.map(msg => {
      if (msg.role === 'user') {
        return { role: 'user', content: msg.content, timestamp: Date.parse(msg.timestamp) || Date.now() } as unknown as AgentMessage;
      }
      return { role: 'assistant', content: [{ type: 'text', text: msg.content }], timestamp: Date.parse(msg.timestamp) || Date.now() } as unknown as AgentMessage;
    });

    const agent = new Agent({
      initialState: { systemPrompt, model, tools, thinkingLevel: 'low' },
      transformContext: async (messages) => [...historyMessages, ...messages],
    });
    return agent;
  }

  /**
   * 创建子 Agent（执行专家）。
   * 只注册 MCP 执行/时间工具（CHILD_MCP_TOOL_NAMES），不挂 load_skill。
   * context 来自 SKILL.md frontmatter 提取，不从 URL/body 获取。
   */
  async createChildAgent(context: SkillContext): Promise<Agent> {
    const { scenario_name: scenario, ontology_name: ontology, ontology_id: ontologyId } = context;
    const model = resolveDeepSeekModel();
    const allMcp = await this.discoverTools(scenario, ontology);
    // 子Agent不需要浏览场景/本体/本体结构，指令已包含完整上下文
    const mcpTools = allMcp.filter(t => CHILD_MCP_TOOL_NAMES.includes(t.name));
    const systemPrompt = `${CHILD_SYSTEM_PROMPT}\n\n## 当前上下文\n- 场景: ${scenario}\n- 本体: ${ontology}\n- 本体ID: ${ontologyId}\n\n直接使用给定的行为名称和参数调用 executeOntoBehavior。`;
    const agent = new Agent({
      initialState: { systemPrompt, model, tools: mcpTools, thinkingLevel: 'low' },
    });
    return agent;
  }

  /**
   * 创建 load_skill 工具。
   * Agent 在需要某个技能的完整知识时调用。
   * 加载后通过 onSkillLoaded 回调通知 orchestrator 记录。
   */
  private createLoadSkillTool(scenario: string, ontology: string, onSkillLoaded?: (skillName: string) => void): AgentTool {
    return {
      name: 'load_skill',
      label: '加载技能知识',
      description: '加载指定技能的完整知识文件。当用户问题涉及某个技能领域时，先调用此工具获取完整知识再回答。',
      parameters: Type.Object({
        skill_name: Type.String({ description: '技能名称，如 raw-material-inventory' }),
      }),
      execute: async (toolCallId, params) => {
        const p = params as any;
        const skillName = p.skill_name as string;
        const content = this.skillLoader.loadSkill(scenario, ontology, skillName);
        if (onSkillLoaded) onSkillLoaded(skillName);
        return {
          content: [{ type: 'text', text: content }],
          details: { skill_name: skillName },
        };
      },
    };
  }

  /**
   * 创建 submit_plan 工具。
   * 父 Agent 通过工具调用提交结构化规划，参数经 SDK 的 validateToolArguments 按
   * TypeBox schema 校验（缺字段/类型错误会自动强转并让 LLM 自纠），
   * 规划通过 onPlanSubmitted 回调交给 orchestrator，不再依赖正则抓取文本 JSON。
   */
  private createSubmitPlanTool(onPlanSubmitted?: (plan: SubTaskPlan) => void): AgentTool {
    return {
      name: 'submit_plan',
      label: '提交子任务规划',
      description: '当用户需求属于业务操作、需要拆分为多个子任务执行时，调用本工具提交完整的子任务执行规划。',
      parameters: Type.Object({
        subtasks: Type.Array(Type.Object({
          // 数值字段放宽为 number|string：TypeBox 不做字符串数字强转，
          // 由 execute 回调统一规整为 number（规避 LLM 输出 "1" 导致校验失败的场景）
          seq: Type.Union([Type.Number(), Type.String()]),
          behavior: Type.String(),
          params: Type.Record(Type.String(), Type.Any()),
          description: Type.String(),
          guidance: Type.Optional(Type.String()),
          scenario_name: Type.String(),
          scenario_id: Type.Union([Type.Number(), Type.String()]),
          ontology_name: Type.String(),
          ontology_id: Type.Union([Type.Number(), Type.String()]),
          depends_on: Type.Optional(Type.Array(Type.Union([Type.Number(), Type.String()]))),
        })),
        reasoning: Type.Optional(Type.String()),
      }),
      execute: async (toolCallId, params) => {
        const plan = params as { subtasks: Array<Record<string, any>> };
        // 规整数值字段：LLM 可能输出字符串数字，统一转 number 供拓扑排序/seq 匹配使用
        for (const st of plan.subtasks) {
          st.seq = Number(st.seq);
          st.scenario_id = st.scenario_id != null && st.scenario_id !== '' ? Number(st.scenario_id) : undefined;
          st.ontology_id = Number(st.ontology_id);
          if (Array.isArray(st.depends_on)) st.depends_on = st.depends_on.map((d: any) => Number(d));
        }
        if (onPlanSubmitted) onPlanSubmitted(plan as unknown as SubTaskPlan);
        return {
          content: [{ type: 'text', text: '已接收执行规划，将按序执行。' }],
          details: { submitted: true },
        };
      },
    };
  }

  /**
   * 从 MCP 配置中连接启用的服务，自动发现并注册工具。
   */
  private async discoverTools(scenario: string, ontology: string): Promise<AgentTool[]> {
    const mcpConfig = this.mcpConfigStore.getConfig(scenario, ontology);
    const tools: AgentTool[] = [];

    for (const server of mcpConfig.servers) {
      if (!server.enabled) continue;

      let client: MCPClient | null = null;
      try {
        // 复用缓存连接（connect 幂等），避免每个 Agent 新建 SSE 连接
        client = this.getOrCreateClient(server.url);
        await client.connect();

        const result = await client.listTools();
        const mcpTools = result.tools || [];

        for (const t of mcpTools) {
          const toolName = t.name as string;
          if (server.allowed_tools && server.allowed_tools.length > 0 && !server.allowed_tools.includes(toolName)) {
            continue;
          }
          // 优先用 MCP 提供的原生 JSON Schema 做参数校验与类型强转，
          // 无 schema 时退回宽松校验（validateToolArguments 原生支持 JSON Schema）
          const inputSchema = (t as any).inputSchema;
          tools.push({
            name: toolName,
            label: toolName,
            description: (t.description as string) || `[${server.name}] ${toolName}`,
            parameters: inputSchema && typeof inputSchema === 'object' && Object.keys(inputSchema).length > 0
              ? inputSchema
              : Type.Object({}, { additionalProperties: true }),
            execute: async (toolCallId, params) => {
              if (!client) throw new Error('MCP 未连接');
              const p = params as any;
              // LLM 可能传字符串类型，强制转数字
              if (p.ontology_id !== undefined) p.ontology_id = Number(p.ontology_id);
              if (p.scenario_id !== undefined) p.scenario_id = Number(p.scenario_id);
              const result = await client.callTool(toolName, p);
              const text = toolResultToText(result.content);
              if (result.isError) {
                return { content: [{ type: 'text', text }], details: {}, isError: true };
              }
              return { content: [{ type: 'text', text }], details: {} };
            },
          });
        }

        console.log(`[MCP] ${server.name}: 发现 ${mcpTools.length} 个工具`);
      } catch (e: any) {
        console.error(`[MCP] ${server.name} 连接失败: ${e.message}`);
      }
    }

    return tools;
  }
}
