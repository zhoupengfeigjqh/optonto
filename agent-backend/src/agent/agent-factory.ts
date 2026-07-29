import { Agent } from '@earendil-works/pi-agent-core';
import type { AgentMessage, AgentTool } from '@earendil-works/pi-agent-core';
import { getModel } from '@earendil-works/pi-ai';
import { Type } from '@sinclair/typebox';
import { MCPClient } from '../services/mcp-client.js';
import { MCPConfigStore } from '../services/mcp-config-store.js';
import { SkillLoader } from '../services/skill-loader.js';
import { AGENT_PRINCIPLES } from '../config.js';
import type { ThreadMessage, SkillDescription } from '../types.js';

/**
 * 构建 Agent 的 system prompt。
 */
interface AgentContext {
  scenarioName: string;
  scenarioId: number;
  ontologyName: string;
  ontologyId: number;
}

function buildSystemPrompt(descriptions: SkillDescription[], context?: AgentContext): string {
  const skillList = descriptions
    .map(d => `- ${d.name}: ${d.description}`)
    .join('\n');

  const contextBlock = descriptions.length > 0 && context
    ? `\n## 本体基本信息\n- 场景名称（scenario_name）: ${context.scenarioName}\n- 场景ID（scenario_id）: ${context.scenarioId}\n- 本体名称（ontology_name）: ${context.ontologyName}\n- 本体ID（ontology_id）: ${context.ontologyId}`
    : '';

  return `你是一个智能业务助手，帮助用户解答关于业务领域的问题。

你需要基于加载的技能文件中定义的领域知识来回答用户的问题。
严格按照技能文件中定义的业务规则、流程和概念进行推理。

## 基本准则
1. 只回答与当前业务领域相关的问题
2. 基于加载的技能文件中的知识进行回答
3. 如果超出技能范围，礼貌说明无法回答
4. 所有回答用中文

## 任务执行原则
${AGENT_PRINCIPLES}
${contextBlock}
## 可用技能
${skillList || '（无可用技能）'}

## 工具说明
- 当用户问题涉及某个技能领域时，先调用 \`load_skill\` 加载该技能的完整知识文件
- 加载后基于知识回答，必要时再根据技能文件中提供的调用 MCP 工具查询实时数据
- 如果用户只是询问信息或了解流程，直接回答问题即可，不要输出 JSON 规划`;
}

/**
 * AgentFactory — 使用 pi-agent-core SDK 创建 Agent 实例。
 *
 * 两阶段 Skill 加载：
 * 阶段 1（初始）：system prompt 只放技能名称和描述
 * 阶段 2（按需）：Agent 调用 load_skill 工具加载完整 SKILL.md
 */
export class AgentFactory {
  constructor(
    private mcpConfigStore: MCPConfigStore,
    private skillLoader: SkillLoader,
  ) {}

  async createAgent(
    skillNames: string[],
    history: ThreadMessage[],
    scenario: string,
    ontology: string,
    ontologyId: number = 0,
  ): Promise<Agent> {
    const descriptions = this.skillLoader.getSkillDescriptions(scenario, ontology, skillNames);
    const scenarioId = this.skillLoader.getScenarioId(scenario, ontology);
    const context = descriptions.length > 0 ? { scenarioName: scenario, scenarioId, ontologyName: ontology, ontologyId } : undefined;
    const systemPrompt = buildSystemPrompt(descriptions, context);
    const model = getModel('deepseek', 'deepseek-v4-flash');

    // 探索 MCP 工具 + 注册 load_skill
    const mcpTools = await this.discoverTools(scenario, ontology);
    const loadSkillTool = this.createLoadSkillTool(scenario, ontology);
    const tools = [...mcpTools, loadSkillTool];

    // 历史消息通过 transformContext 注入
    const historyMessages: AgentMessage[] = history.map(msg => {
      if (msg.role === 'user') {
        return {
          role: 'user',
          content: msg.content,
          timestamp: Date.parse(msg.timestamp) || Date.now(),
        } as unknown as AgentMessage;
      }
      return {
        role: 'assistant',
        content: [{ type: 'text', text: msg.content }],
        timestamp: Date.parse(msg.timestamp) || Date.now(),
      } as unknown as AgentMessage;
    });

    const agent = new Agent({
      initialState: {
        systemPrompt,
        model,
        tools,
        thinkingLevel: 'low',
      },
      transformContext: async (messages) => {
        return [...historyMessages, ...messages];
      },
    });

    return agent;
  }

  /**
   * 创建 load_skill 工具。
   * Agent 在需要某个技能的完整知识时调用。
   */
  private createLoadSkillTool(scenario: string, ontology: string): AgentTool {
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
        return {
          content: [{ type: 'text', text: content }],
          details: { skill_name: skillName },
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
        client = new MCPClient(server.url);
        await client.connect();

        const result = await client.listTools();
        const mcpTools = result.tools || [];

        for (const t of mcpTools) {
          const toolName = t.name as string;
          if (server.allowed_tools && server.allowed_tools.length > 0 && !server.allowed_tools.includes(toolName)) {
            continue;
          }
          tools.push({
            name: toolName,
            label: toolName,
            description: (t.description as string) || `[${server.name}] ${toolName}`,
            parameters: Type.Object({}, { additionalProperties: true }),
            execute: async (toolCallId, params) => {
              if (!client) throw new Error('MCP 未连接');
              const p = params as any;
              const result = await client.callTool(toolName, p);
              const text = result.content
                ?.map((c: any) => ('text' in c ? c.text : ''))
                .filter(Boolean)
                .join('\n') || '';
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
