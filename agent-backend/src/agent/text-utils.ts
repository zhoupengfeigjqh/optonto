/**
 * 消息 / 工具结果中的文本提取工具，统一各处重复的 content 解析逻辑。
 */

/** 从 Agent 消息的 content 中提取纯文本（兼容 string 与 content 块数组两种形态） */
export function contentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((c: any) => c.text || '').join('');
  }
  return '';
}

/** 从 MCP 工具返回的 content 中提取文本（多行拼接） */
export function toolResultToText(content: any[] | undefined): string {
  return (content || [])
    .map((c: any) => ('text' in c ? c.text : ''))
    .filter(Boolean)
    .join('\n');
}

/** 从消息列表末尾向前找最后一条非错误 assistant 消息，提取纯文本（无则空串）。 */
export function getLastAssistantMessage(messages: any[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === 'assistant' && !m.errorMessage) {
      return contentToText(m.content);
    }
  }
  return '';
}
