/**
 * 子 Agent 输出结果协议 —— 「【状态】成功/失败」标记的单一事实源。
 * 提示词从这里生成标记（prompts.ts），extractResult 从这里解析（subtask-runner.ts）。
 * 改输出约定只动这一处，不再"改提示词文本 + 改解析正则"两边同步。
 */

export const RESULT_STATUS_OK = '【状态】成功';
export const RESULT_STATUS_FAIL = '【状态】失败';
export const RESULT_STATUS_RE = /【状态】(成功|失败)/g;

/** 生成子 Agent 回复末尾的状态标记 */
export function formatResultStatus(success: boolean): string {
  return success ? RESULT_STATUS_OK : RESULT_STATUS_FAIL;
}

/** 解析文本中的状态标记：以【最后一条】标记为准（与历史行为一致）；无标记视为成功。 */
export function parseResultStatus(content: string): { failed: boolean; found: boolean } {
  const matches = content.match(RESULT_STATUS_RE) || [];
  if (matches.length === 0) return { failed: false, found: false };
  return { failed: matches[matches.length - 1] === RESULT_STATUS_FAIL, found: true };
}

/** 剔除正文中的状态标记，还原为纯摘要 */
export function stripResultStatus(content: string): string {
  return content.replace(RESULT_STATUS_RE, '').trim();
}
