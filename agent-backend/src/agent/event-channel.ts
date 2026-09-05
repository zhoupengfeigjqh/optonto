/**
 * EventChannel —— SSE 直发 + 执行记录推送的统一出口（二者同源于 sendEvent，避免双通道各自穿线）。
 *
 * 全编排链路（orchestrator 三阶段 / SubtaskRunner / ConfirmManager）只以这一种形态传递事件通道，
 * 不再拆回 sendEvent + pushEntry 两个参数穿线。
 *
 * entry() 调用方不传 time——时间戳由通道统一打（mkEntry 语义），
 * 消灭散落在各处的 30+ 处 `new Date().toLocaleTimeString()` 字面量：
 * 改时间格式/时区只动这一处（locality）。
 */
import type { SSEEvent, ExecutionEntry } from '../types.js';

export interface EventChannel {
  /** SSE 事件直发（token/error/done/confirm/feedback 等） */
  raw: (e: SSEEvent) => void;
  /** 执行记录推送（time 由通道统一打，调用方不传） */
  entry: (e: Omit<ExecutionEntry, 'time'>) => void;
}

/** 从 SSE 发送函数构建事件通道（每个 run 一个，orchestrator.runExecute 入口创建） */
export function createEventChannel(sendEvent: (e: SSEEvent) => void): EventChannel {
  return {
    raw: sendEvent,
    entry: (e) => sendEvent({ type: 'exec_entry', entry: { time: new Date().toLocaleTimeString(), ...e } }),
  };
}

/**
 * ToolCallBridge —— SDK 工具事件 start/end 的 toolCallId 桥接（父/子 Agent 订阅两侧同一模式，单点化）。
 * start 事件带 args、end 不带：靠桥接配对保证 start/end 同名同参数，
 * 前端 running→done 去重匹配不破、参数不被覆盖成空。
 */
export class ToolCallBridge {
  private held = new Map<string, any>();
  /** start 时暂存参数 */
  hold(toolCallId: string, params: any): void { this.held.set(toolCallId, params); }
  /** end 时取出并删除（一次性配对；未配对 → undefined） */
  take(toolCallId: string): any {
    const params = this.held.get(toolCallId);
    this.held.delete(toolCallId);
    return params;
  }
}

/**
 * 子任务展示信息三元组（单源）：
 *  - displayName：中文（英文），执行记录侧面板用，如 创建采购记录（CreatePurchaseRecord）
 *  - displayLabel：纯中文（行为/函数 display_name，空则回退子任务描述），聊天区用
 *  - description：子任务描述（父 Agent 生成），聊天区标题副行用
 * 行为子任务与函数子任务共用同一规则（orchestrator 入口记录与 SubtaskRunner 内部记录不再各自内联）。
 */
export function entryDisplay(label: string | undefined, name: string, description?: string) {
  const displayLabel = label || description || '';
  return {
    displayName: `${displayLabel}（${name}）`,
    displayLabel,
    description,
  };
}
