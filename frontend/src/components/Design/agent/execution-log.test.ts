/**
 * 执行记录纯逻辑单测（章程 III：属性传递 / 事件触发 / 边界条件）。
 *
 * 2026-10-05 从 `plan-editing.test.ts` 迁入——分组/统计/标题逻辑本就属于
 * `execution-log.ts`，此前错放在规划编辑的测试文件里（导致
 * `ExecutionLogDrawer.tsx` 注释指向的 `execution-log.test.ts` 长期不存在）。
 * 迁移后测试与被测文件一一对应，`plan-editing.test.ts` 回归「规划编辑」单一职责。
 *
 * 三组：
 *  ① 分组（并行子任务事件交错到达时按 seq 归组，不能按相邻合并）
 *  ② 组内统计与标题
 *  ③ mergeExecEntry —— running → done 的配对（2026-10-05 C5 修复）
 */
import { describe, it, expect } from 'vitest';
import {
  groupExecutionLog, countSubtaskSteps, subtaskStepEntries, subtaskStatus, subtaskTitle,
  mergeExecEntry, type LogEntry,
} from './execution-log';

const top = (name: string, type: LogEntry['type'] = 'tool_call'): LogEntry =>
  ({ time: 't', type, name, status: 'done' });
const child = (seq: number, type: LogEntry['type'], name = 'B'): LogEntry =>
  ({ time: 't', type, name, status: type === 'subtask_done' ? 'done' : 'running', source: 'child', seq });

describe('groupExecutionLog — 执行记录分组', () => {
  it('属性传递：顶层条目按原位置出现，子任务条目归入其组', () => {
    const nodes = groupExecutionLog([top('全局'), child(1, 'subtask_start'), child(1, 'tool_call')]);
    expect(nodes.map(n => n.kind)).toEqual(['top', 'subtask']);
    expect((nodes[1] as any).entries.length).toBe(2);
  });

  it('属性传递：并行子任务事件交错到达时，同一 seq 仍归为一组（不能按相邻合并）', () => {
    const nodes = groupExecutionLog([
      child(1, 'subtask_start'), child(2, 'subtask_start'), child(1, 'tool_call'), child(2, 'tool_call'),
    ]);
    expect(nodes.map(n => (n as any).seq)).toEqual([1, 2]);
    expect((nodes[0] as any).entries.length).toBe(2);
    expect((nodes[1] as any).entries.length).toBe(2);
  });

  it('边界：空记录返回空节点列表', () => {
    expect(groupExecutionLog([])).toEqual([]);
  });

  it('边界：source=child 但 seq 缺失时按顶层条目处理', () => {
    const entry: LogEntry = { time: 't', type: 'tool_call', name: 'X', status: 'done', source: 'child' };
    expect(groupExecutionLog([entry])[0].kind).toBe('top');
  });
});

describe('子任务组统计与标题', () => {
  const entries = [child(1, 'subtask_start'), child(1, 'subtask_input'), child(1, 'tool_call'), child(1, 'tool_call', 'C'), child(1, 'subtask_done')];

  it('属性传递：步数剔除 start / done / input', () => {
    expect(countSubtaskSteps(entries)).toBe(2);
    expect(subtaskStepEntries(entries).length).toBe(2);
  });

  it('属性传递：状态优先取 subtask_done（避免因归组而停在 running）', () => {
    expect(subtaskStatus(entries)).toBe('done');
    expect(subtaskStatus([child(1, 'subtask_start')])).toBe('running');
  });

  it('边界：无任何事件时状态回退为 running', () => {
    expect(subtaskStatus([])).toBe('running');
  });

  it('属性传递：标题带子任务显示名；无 start 事件时回退为序号', () => {
    expect(subtaskTitle([{ ...child(1, 'subtask_start'), displayName: '查库存' }], 1)).toBe('子任务 1: 查库存');
    expect(subtaskTitle([], 2)).toBe('子任务 2');
  });
});

/**
 * mergeExecEntry —— running → done 的配对（C5 修复的防回归）。
 *
 * 修复前的去重键是 `type+name+status+seq`：**父 Agent 的工具调用条目不带 seq**，
 * 两侧 `undefined === undefined` 恒成立，于是同名工具连续/并发调用两次时
 * 第 2 次 running 被丢弃、第 2 次 done 覆盖第 1 次的 result——执行记录错乱。
 * 修复：优先用后端下发的 `toolCallId` 配对，无该键才回退到 type+name+seq+source。
 */
describe('mergeExecEntry — running/done 配对（2026-10-05 C5）', () => {
  /** 父 Agent 侧的工具调用（无 seq，只有 toolCallId 区分次） */
  const parentCall = (toolCallId: string, status: 'running' | 'done', result?: string): LogEntry => ({
    time: 't', type: 'tool_call', name: 'listOntoBehaviors', status, source: 'parent', toolCallId, result,
  });

  it('防回归：父 Agent 同名工具连续调用两次 → 两条独立记录，result 互不覆盖', () => {
    let log: LogEntry[] = [];
    log = mergeExecEntry(log, parentCall('call-1', 'running'));
    log = mergeExecEntry(log, parentCall('call-1', 'done', '第1次结果'));
    log = mergeExecEntry(log, parentCall('call-2', 'running'));
    log = mergeExecEntry(log, parentCall('call-2', 'done', '第2次结果'));

    expect(log).toHaveLength(2);
    expect(log[0].result).toBe('第1次结果');
    expect(log[1].result).toBe('第2次结果');
  });

  it('属性传递：并发调用（两次 running 先到，再依次 done）仍各归其位', () => {
    let log: LogEntry[] = [];
    log = mergeExecEntry(log, parentCall('call-1', 'running'));
    log = mergeExecEntry(log, parentCall('call-2', 'running'));
    log = mergeExecEntry(log, parentCall('call-2', 'done', 'B'));
    log = mergeExecEntry(log, parentCall('call-1', 'done', 'A'));

    expect(log).toHaveLength(2);
    expect(log[0].result).toBe('A');
    expect(log[1].result).toBe('B');
  });

  it('事件触发：重复 start（同 toolCallId 再次 running）幂等丢弃，不重复记录', () => {
    let log: LogEntry[] = [];
    log = mergeExecEntry(log, parentCall('call-1', 'running'));
    log = mergeExecEntry(log, parentCall('call-1', 'running'));
    expect(log).toHaveLength(1);
  });

  it('属性传递：无 toolCallId 的同名 tool_call 按 type+name+seq+source 回退配对', () => {
    // 回退路径的正向验证：旧版后端（无 toolCallId）下 tool_call 仍能 start→done 就地合并
    let log: LogEntry[] = [];
    log = mergeExecEntry(log, { time: 't', type: 'tool_call', name: 'query_inventories', status: 'running', source: 'child', seq: 1 });
    log = mergeExecEntry(log, { time: 't', type: 'tool_call', name: 'query_inventories', status: 'done', source: 'child', seq: 1, result: 'ok' });
    expect(log).toHaveLength(1);
    expect(log[0].status).toBe('done');
    expect(log[0].result).toBe('ok');
  });

  it('边界：子任务起止是两条独立记录（type 不同故不配对），完成态由 subtaskStatus 取 done 优先', () => {
    // subtask_start/subtask_done 是【独立事件】而非 running→done 配对：归组靠 groupExecutionLog，
    // 状态靠 subtaskStatus 取 done 优先。配对只适用于 tool_call（有 toolCallId 或同 type 前后两条）
    let log: LogEntry[] = [];
    log = mergeExecEntry(log, { ...child(1, 'subtask_start'), displayName: '查询库存' });
    log = mergeExecEntry(log, { ...child(1, 'subtask_done'), displayName: '查询库存' });
    expect(log).toHaveLength(2);
    expect(log.map(e => e.status)).toEqual(['running', 'done']);
  });

  it('边界：无 toolCallId 且 seq 缺失的不同 source 条目不误配（父/子同名不串）', () => {
    let log: LogEntry[] = [];
    log = mergeExecEntry(log, { time: 't', type: 'tool_call', name: 'X', status: 'running', source: 'parent' });
    log = mergeExecEntry(log, { time: 't', type: 'tool_call', name: 'X', status: 'done', source: 'parent', result: 'r' });
    // 子任务侧同名条目（带 seq）不与父侧配对
    log = mergeExecEntry(log, { time: 't', type: 'tool_call', name: 'X', status: 'running', source: 'child', seq: 1 });
    expect(log).toHaveLength(2);
    expect(log[0].source).toBe('parent');
    expect(log[1].source).toBe('child');
  });

  it('属性传递：done 携带的展示字段补齐（displayLabel/description 曾被丢弃 → 死键）', () => {
    let log: LogEntry[] = [];
    log = mergeExecEntry(log, { ...child(1, 'subtask_start'), displayLabel: '查询库存', description: '查当前库存' });
    log = mergeExecEntry(log, { ...child(1, 'subtask_done'), displayLabel: '查询库存', description: '查当前库存' });
    expect(log[0].displayLabel).toBe('查询库存');
    expect(log[0].description).toBe('查当前库存');
  });
});
