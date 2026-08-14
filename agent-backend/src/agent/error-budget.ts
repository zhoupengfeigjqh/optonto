/**
 * 工具报错预算 —— 子任务内工具连续报错达到上限即中断，杜绝 pi-agent 内层循环空转。
 *
 * 背景：pi-agent 单次 prompt() 内 while(hasMoreToolCalls) 无迭代上限，只要 LLM 还在发工具调用就循环不停。
 * 每次工具报错都会作为 toolResult 喂回 LLM 换着法子重试，一遍内可报错 5 次、10 次、20 次。
 * 本预算给每个子任务的子 Agent 挂一个计数器：count >= limit 时工具 execute 返回 terminate:true，
 * pi-agent 收到后 shouldTerminateToolBatch 命中 → 内层循环当场停止，交由 SubtaskRunner 判失败收尾。
 *
 * 关键机制（pi-agent-core 0.78）：executePreparedToolCall 硬编码 isError:false（返回值里的 isError 会被吞），
 * 但 result.terminate 会透传并被 shouldTerminateToolBatch 消费 —— 所以这里只靠 terminate 停循环。
 */

/** 工具报错预算：连续报错累计，任何一次成功调用即重置（同一子 Agent 实例复用）。 */
export interface ToolErrorBudget {
  /** 已报错次数 */
  count: number;
  /** 上限：达到即中断 */
  limit: number;
  /** 是否已超限（SubtaskRunner 据此提前返回，不再走外层重试） */
  exceeded: boolean;
}

/** 默认上限：连续报错 3 次即中断 */
export const TOOL_ERROR_LIMIT = 3;

export function createToolErrorBudget(limit: number = TOOL_ERROR_LIMIT): ToolErrorBudget {
  return { count: 0, limit, exceeded: false };
}

/**
 * 包装工具 execute：捕获报错并计数，达到上限返回 terminate:true 让 pi-agent 停止内层循环。
 * 未达上限时原样 rethrow（LLM 可自纠）；达上限后返回含明确原因的终止结果，不再抛。
 *
 * 计数语义：【连续报错】——任何一次成功调用即把 count 清零。
 * "报错→自纠→成功"的正常探索路径不计入预算；只有连续无进展的报错循环才累积到上限。
 *
 * 超限短路：exceeded 置位后，任何后续调用【一律不执行真实工具】，直接返回 terminate。
 * 关键动机（pi-agent 并行批）：shouldTerminateToolBatch 用 every() 要求【整批】每个调用都带
 * terminate 才停。若只在"第3次报错"那一下带 terminate，批内混入的成功调用/前两次报错会否决
 * every()，循环继续跑、超限后还可能执行写操作。短路后，超限后每个进入的工具都返回 terminate，
 * 下一批整批全命中 → 循环当场硬停，杜绝超限后的新执行。
 */
export function wrapExecuteWithErrorBudget(
  originalExecute: (toolCallId: string, params: any) => Promise<any>,
  budget: ToolErrorBudget,
) {
  return async (toolCallId: string, params: any) => {
    // 超限后短路：不执行真实工具，直接终止（真实 execute 一次都不会再被调用）
    if (budget.exceeded) {
      return terminateResult(budget.limit);
    }
    try {
      const result = await originalExecute(toolCallId, params);
      budget.count = 0; // 成功即重置连续报错计数：只有连续报错才累积到上限
      return result;
    } catch (e) {
      budget.count++;
      if (budget.count >= budget.limit) {
        budget.exceeded = true;
        return terminateResult(budget.limit);
      }
      throw e;
    }
  };
}

/** 终止结果：报错预算耗尽的统一返回体（isError 会被 pi-agent 吞掉，terminate 生效停循环） */
function terminateResult(limit: number) {
  return {
    content: [{ type: 'text', text: `⏹ 子任务连续报错已达 ${limit} 次，已中断执行（不再重试）` }],
    details: {},
    isError: true,
    terminate: true,
  };
}
