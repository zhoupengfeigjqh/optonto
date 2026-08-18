/**
 * LLM 直调工具 —— 记忆模块（短期摘要 / 长期分析）共用的轻量调用。
 * 与 agent-factory 共用同一模型解析逻辑（resolveDeepSeekModel），避免两处重复。
 */
import { Agent } from '@earendil-works/pi-agent-core';
import { getModel, getModels } from '@earendil-works/pi-ai';
import { config } from '../config.js';
import { contentToText } from '../utils/text-utils.js';

/**
 * 解析 DeepSeek 模型：优先用 config.yaml 的 modelName，无效时回退默认 flash。
 * 从 agent-factory 抽离，供记忆模块复用，保证全系统同一套模型解析。
 */
export function resolveDeepSeekModel() {
  const validIds = new Set(getModels('deepseek').map(m => m.id));
  const id = validIds.has(config.modelName) ? config.modelName : 'deepseek-v4-flash';
  return getModel('deepseek', id as 'deepseek-v4-flash' | 'deepseek-v4-pro');
}

/**
 * 轻量 LLM 直调：无工具 Agent 单轮 prompt，返回最后一条 assistant 文本。
 * 带超时兜底（默认 60s），避免 API 挂起拖住主流程；记忆模块均为异步/后台调用。
 */
export async function askLLM(systemPrompt: string, userText: string, timeoutMs = 60_000): Promise<string> {
  const agent = new Agent({
    initialState: { systemPrompt, model: resolveDeepSeekModel(), tools: [] },
  });
  try {
    await Promise.race([
      agent.prompt(userText),
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          try { agent.abort(); } catch {}
          reject(new Error('LLM 直调超时'));
        }, timeoutMs);
      }),
    ]);
    const msgs: any[] = agent.state?.messages ?? [];
    const last = [...msgs].reverse().find((m: any) => m.role === 'assistant' && !m.errorMessage);
    return last ? contentToText(last.content) : '';
  } finally {
    // 裸 Agent 无 MCP 连接，无需额外清理
  }
}
