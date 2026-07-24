import { Agent } from '@earendil-works/pi-agent-core';
import type { AgentMessage, AgentTool } from '@earendil-works/pi-agent-core';
import { getModel } from '@earendil-works/pi-ai';
import { Type } from '@sinclair/typebox';
import { MCPClient } from '../services/mcp-client.js';
import { MCPConfigStore } from '../services/mcp-config-store.js';
import type { ThreadMessage } from '../types.js';

function buildSystemPrompt(skillContent: string): string {
  return `你是一个智能业务助手，帮助用户解答关于业务领域的问题。

你需要基于加载的技能文件中定义的领域知识来回答用户的问题。
严格按照技能文件中定义的业务规则、流程和概念进行推理。

## 核心原则
1. 只回答与当前业务领域相关的问题
2. 基于加载的技能文件中的知识进行回答
3. 如果超出技能范围，礼貌说明无法回答
4. 所有回答用中文

## 可用工具
你可以调用以下工具来获取实时数据或执行业务操作。
当用户查询数据时，实际调用工具获取真实数据。

${skillContent ? `\n## 已加载的技能知识\n\n${skillContent}` : ''}`;
}

/**
 * AgentFactory — 使用 pi-agent-core SDK 创建 Agent 实例。
 *
 * 每次对话动态读取本体 MCP 配置，
 * 连接启用的 MCP 服务并自动发现注册其工具。
 */
export class AgentFactory {
  constructor(private mcpConfigStore: MCPConfigStore) {}

  async createAgent(
    skillContent: string,
    history: ThreadMessage[],
    scenario: string,
    ontology: string,
  ): Promise<Agent> {
    const systemPrompt = buildSystemPrompt(skillContent);
    const model = getModel('deepseek', 'deepseek-v4-flash');

    // 历史消息转为 AgentMessage 格式
    const historyMessages: AgentMessage[] = history.map(msg => {
      if (msg.role === 'user' || msg.role === 'toolResult') {
        return {
          role: msg.role === 'toolResult' ? 'tool' : 'user',
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

    // 读取 MCP 配置，动态发现工具
    const tools = await this.discoverTools(scenario, ontology);

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
          // 如果设置了 allowed_tools，只注册白名单内的工具
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
              // 传到 MCP 的参数展开为顶层 key
              const p = params as any;
              const result = await client.callTool(toolName, p);
              const text = result.content
                ?.map((c: any) => ('text' in c ? c.text : ''))
                .filter(Boolean)
                .join('\n') || '';
              // 标记 isError
              if (result.isError) {
                return {
                  content: [{ type: 'text', text }],
                  details: {},
                  isError: true,
                };
              }
              return {
                content: [{ type: 'text', text }],
                details: {},
              };
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
