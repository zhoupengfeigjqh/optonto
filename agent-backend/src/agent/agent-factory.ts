import { Agent } from '@earendil-works/pi-agent-core';
import type { AgentMessage, AgentTool } from '@earendil-works/pi-agent-core';
import { getModel } from '@earendil-works/pi-ai';
import { Type } from '@sinclair/typebox';
import { MCPClient } from '../services/mcp-client.js';
import { MCPConfigStore } from '../services/mcp-config-store.js';
import { SkillLoader } from '../services/skill-loader.js';
import { buildParentPrompt, CHILD_SYSTEM_PROMPT } from './prompts.js';
import type { ThreadMessage, SkillContext } from '../types.js';

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

  /**
   * 创建父 Agent（规划专家）。
   * 注册 load_skill + MCP 只读工具（listScenarios、listOntologies、getCurrentDate）。
   * onSkillLoaded 回调在父 Agent 调用 load_skill 时触发，通知 orchestrator 记录已加载的技能名。
   */
  async createParentAgent(
    skillNames: string[],
    history: ThreadMessage[],
    scenario: string,
    ontology: string,
    onSkillLoaded: (skillName: string) => void,
  ): Promise<Agent> {
    const descriptions = this.skillLoader.getSkillDescriptions(scenario, ontology, skillNames);
    // 父 Agent 初始时不含"本体基本信息"——它在 load_skill 后从 SKILL.md 内容获取
    const systemPrompt = buildParentPrompt(descriptions);
    const model = getModel('deepseek', 'deepseek-v4-flash');

    const loadSkillTool = this.createLoadSkillTool(scenario, ontology, onSkillLoaded);
    const allMcp = await this.discoverTools(scenario, ontology);
    const parentMcpTools = allMcp.filter(t =>
      ['listScenarios', 'listOntologies', 'getCurrentDate'].includes(t.name),
    );
    const tools: AgentTool[] = [loadSkillTool, ...parentMcpTools];

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
   * 只注册 MCP 工具，不挂 load_skill。
   * context 来自 SKILL.md frontmatter 提取，不从 URL/body 获取。
   */
  async createChildAgent(context: SkillContext): Promise<Agent> {
    const { scenario_name: scenario, ontology_name: ontology, ontology_id: ontologyId } = context;
    const model = getModel('deepseek', 'deepseek-v4-flash');
    const allMcp = await this.discoverTools(scenario, ontology);
    // 子Agent不需要浏览场景/本体，指令已包含完整上下文
    const mcpTools = allMcp.filter(t => !['listScenarios', 'listOntologies'].includes(t.name));
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
              // LLM 可能传字符串类型，强制转数字
              if (p.ontology_id !== undefined) p.ontology_id = Number(p.ontology_id);
              if (p.scenario_id !== undefined) p.scenario_id = Number(p.scenario_id);
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
