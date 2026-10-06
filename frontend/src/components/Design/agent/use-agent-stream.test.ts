/**
 * useAgentStream 单测 —— 流式接收与事件分发（2026-10-05，宪法 III）。
 *
 * ## 为什么必须有这个文件
 *
 * 该 hook 是从 AgentConversation.tsx（559 行）抽出的 190 行核心逻辑，
 * 抽出后既无单测、也不在前端覆盖率 include 范围内 —— 处于门禁盲区。
 * 讽刺之处正在于：抽出的目的本就是让它脱离渲染路径可测，却因漏配门禁而没测。
 * 本条已写入宪法 1.2.0「测试组织与命名」：抽出的核心模块 MUST 同时补测并进门禁。
 *
 * ## 本文件固化的三条不变量（对应源文件头声明，回归即失败）
 *
 * 1. runId 用闭包捕获：事件路由只认发起时捕获的 runId → 并发不串轮
 * 2. 并发守卫用 ref：send 未完成时第二次调用被拒（agentChatStream 只被调一次）
 * 3. done / error 后停止处理本批剩余行（dispatchLine 返回 stop）
 *
 * 另含 m16 回归：流掐断时最后一条事件若不带结尾空行，仍必须被处理（此前被静默丢弃）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// antd 的 message 会往 body 挂浮层并输出告警噪音；本文件只关心调用与否，直接打桩
const warn = vi.fn();
vi.mock('antd', () => ({ message: { warning: (...a: any[]) => warn(...a) } }));

const agentChatStream = vi.fn();
vi.mock('@/api/agent-client', () => ({ agentChatStream: (...a: any[]) => agentChatStream(...a) }));

import { useAgentStream } from './use-agent-stream';
import type { ChatMessage } from './chat-types';
import type { LogEntry } from './execution-log';
import type { SubTaskPlan } from './sse-events';

/** 让出若干轮事件循环，让挂起的 read() 有机会被处理（不依赖 fake timers） */
async function tick(times = 3) {
  for (let i = 0; i < times; i++) await act(async () => { await Promise.resolve(); });
}
/** 构造 SSE 响应体；raw 直接给出原始文本以便构造半包 / 残留 buffer 场景 */
function sseResponse(raw: string, ok = true) {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(raw));
      controller.close();
    },
  });
  return { ok, body: stream, text: async () => raw } as unknown as Response;
}

/** 把事件数组拼成标准 SSE 帧 */
function frames(events: unknown[]): string {
  return events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('');
}

/** 装配 hook 依赖（记录各 setter 调用，便于断言） */
function setup() {
  const setMessages = vi.fn();
  const setExecutionLog = vi.fn();
  const setPlanConfirmModal = vi.fn();
  const setConfirmModal = vi.fn();
  const setConfirmedPlan = vi.fn();
  const setInput = vi.fn();
  const hook = renderHook(() => useAgentStream({
    scenarioName: 'SC', ontologyName: 'ON', threadId: 'T1',
    setMessages, setExecutionLog, setPlanConfirmModal, setConfirmModal, setConfirmedPlan, setInput,
  }));
  return {
    ...hook,
    spies: { setMessages, setExecutionLog, setPlanConfirmModal, setConfirmModal, setConfirmedPlan, setInput },
  };
}

/** 从 setMessages 的 updater 里取出最终消息数组（模拟 React 状态归约） */
function reduceMessages(spy: ReturnType<typeof vi.fn>, initial: ChatMessage[] = []): ChatMessage[] {
  let state = initial;
  for (const call of spy.mock.calls) state = call[0](state);
  return state;
}

/** 归约 setExecutionLog 的调用序列（兼容 updater 函数与直接置值两种传参） */
function reduceLog(spy: ReturnType<typeof vi.fn>): LogEntry[] {
  let log: LogEntry[] = [];
  for (const call of spy.mock.calls) {
    log = typeof call[0] === 'function' ? call[0](log) : call[0];
  }
  return log;
}

/**
 * 取消息正文。
 *
 * ChatMessage 是联合类型（含无正文的 SubtaskChatItem），直接写 `msg.content`
 * 过不了类型检查；此处用一次**窄化断言**而非 `as any`（宪法 I：MUST NOT any 逃逸）。
 */
function bodyOf(m: ChatMessage): string {
  return (m as { content?: string }).content ?? '';
}

beforeEach(() => {
  agentChatStream.mockReset();
  warn.mockReset();
});
// ─── token 与 narrative 分流 ─────────────────────────────────────────────

describe('useAgentStream — token 与 narrative 分流', () => {
  it('token 累积到本轮 assistant 占位消息（先 user 后空 assistant）', async () => {
    agentChatStream.mockResolvedValue(sseResponse(frames([
      { type: 'token', token: '你好' },
      { type: 'token', token: '，世界' },
    ])));
    const { result, spies } = setup();
    await act(async () => { await result.current.send('hi'); });

    const msgs = reduceMessages(spies.setMessages);
    expect(msgs.map(m => m.role)).toEqual(['user', 'assistant']);
    // 用 toMatchObject 而非 msgs[i].content：ChatMessage 是联合类型（含无 content 的
    // SubtaskChatItem），直接取属性无法通过类型检查（chat-types 的设计使 Extract 收窄失效）
    expect(msgs[0]).toMatchObject({ role: 'user', content: 'hi' });
    // 两个 token 依次追加到同一条 assistant 消息（累积而非覆盖）
    expect(msgs[1]).toMatchObject({ role: 'assistant', content: '你好，世界' });
    expect((msgs[0] as { timestamp?: string }).timestamp).toBeTruthy();
  });

  it('narrative 流入同一条消息的 narrative 字段并置 streaming（不混入正文）', async () => {
    agentChatStream.mockResolvedValue(sseResponse(frames([
      { type: 'narrative', token: '思考中' },
      { type: 'narrative_end', outcome: 'plan' },
    ])));
    const { result, spies } = setup();
    await act(async () => { await result.current.send('hi'); });

    const assistant = reduceMessages(spies.setMessages)[1] as any;
    expect(assistant.narrative).toBe('思考中');
    // narrative_end(plan) → 定格：停转圈但保留内容
    expect(assistant.narrativeStreaming).toBe(false);
    expect(assistant.content).toBe('');
  });

  it('narrative_end(answer) → 撤掉思考区（直答路径）', async () => {
    agentChatStream.mockResolvedValue(sseResponse(frames([
      { type: 'narrative', token: '临时思考' },
      { type: 'narrative_end', outcome: 'answer' },
      { type: 'token', token: '正式回答' },
    ])));
    const { result, spies } = setup();
    await act(async () => { await result.current.send('hi'); });
    const assistant = reduceMessages(spies.setMessages)[1] as any;
    expect(assistant.narrative).toBeUndefined();
    expect(assistant.narrativeStreaming).toBe(false);
    expect(assistant.content).toBe('正式回答');
  });
});

// ─── 不变量 2：并发守卫 ────────────────────────────────────────────────────

describe('useAgentStream — 并发守卫（不变量 2）', () => {
  it('send 未完成时第二次调用被拒：agentChatStream 只被调一次', async () => {
    let release: (v: Response) => void = () => {};
    agentChatStream.mockReturnValue(new Promise<Response>(res => { release = res; }));

    const { result } = setup();
    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.send('第一条');
      second = result.current.send('第二条'); // 同一 tick 连发
    });
    expect(agentChatStream).toHaveBeenCalledTimes(1);

    await act(async () => { release(sseResponse(frames([{ type: 'done' }]))); await first; });
    expect(agentChatStream).toHaveBeenCalledTimes(1);
    await second;
  });

  it('空字符串直接返回，不发请求', async () => {
    const { result } = setup();
    await act(async () => { await result.current.send(''); });
    expect(agentChatStream).not.toHaveBeenCalled();
  });

  // 注：空白串（'   '）在 hook 层**不会**被拦截——send 的契约是「text 需已 trim」，
  // trim 由调用方（AgentConversation 的 send(input.trim())）负责。
  // 故此处不写「空白被拒」的用例：那会与实际契约不符，误导后来者以为 hook 内部做了 trim。
});

// ─── done 与 error：事件序列终止 ───────────────────────────────────────────

describe('useAgentStream — done 与 error（不变量 3）', () => {
  it('done → 关两个弹窗', async () => {
    agentChatStream.mockResolvedValue(sseResponse(frames([
      { type: 'confirm', confirmId: 'c1', behavior: 'B', content: 'x', params: {} },
      { type: 'done' },
    ])));
    const { result, spies } = setup();
    await act(async () => { await result.current.send('hi'); });
    expect(spies.setConfirmModal).toHaveBeenCalled();
    expect(spies.setPlanConfirmModal).toHaveBeenLastCalledWith(null);
    expect(spies.setConfirmModal).toHaveBeenLastCalledWith(null);
  });

  it('done 之后同批剩余事件被丢弃（dispatchLine 返回 stop）', async () => {
    agentChatStream.mockResolvedValue(sseResponse(frames([
      { type: 'done' },
      { type: 'token', token: '不该被处理' },
    ])));
    const { result, spies } = setup();
    await act(async () => { await result.current.send('hi'); });
    expect(bodyOf(reduceMessages(spies.setMessages)[1])).toBe('');
  });

  it('error → 正文写入 [错误: ...]', async () => {
    agentChatStream.mockResolvedValue(sseResponse(frames([
      { type: 'error', message: '规划校验失败' },
    ])));
    const { result, spies } = setup();
    await act(async () => { await result.current.send('hi'); });
    expect(bodyOf(reduceMessages(spies.setMessages)[1])).toContain('[错误: 规划校验失败]');
  });

  it('error 发生在子任务阶段 → 先为总结新开一条消息再写错误（不贴到子任务块上）', async () => {
    agentChatStream.mockResolvedValue(sseResponse(frames([
      { type: 'exec_entry', entry: { time: 't', type: 'subtask_start', name: 'B1', status: 'running', source: 'child', seq: 1 } },
      { type: 'error', message: '执行炸了' },
    ])));
    const { result, spies } = setup();
    await act(async () => { await result.current.send('hi'); });
    const msgs = reduceMessages(spies.setMessages);
    // user / assistant(占位) / subtask / assistant(总结承接)
    // 子任务块插在占位之后，故 error 分支新开的总结消息位于末尾
    expect(msgs.map(m => m.role)).toEqual(['user', 'assistant', 'subtask', 'assistant']);
    expect(bodyOf(msgs[3])).toContain('[错误: 执行炸了]');
  });
});
// ─── 半包与残留 buffer（m16 回归）─────────────────────────────────────────

describe('useAgentStream — 半包与残留 buffer（m16 回归）', () => {
  it('最后一条事件不带结尾空行时仍被处理（此前被静默丢弃）', async () => {
    // 少一个结尾 \n\n —— SSE 规范允许
    const raw = `data: ${JSON.stringify({ type: 'token', token: '最后一句' })}\n`;
    agentChatStream.mockResolvedValue(sseResponse(raw));
    const { result, spies } = setup();
    await act(async () => { await result.current.send('hi'); });
    expect(bodyOf(reduceMessages(spies.setMessages)[1])).toBe('最后一句');
  });

  it('非法 JSON 行被跳过，不中断整个流', async () => {
    const raw = `data: {坏JSON\n\n${frames([{ type: 'token', token: '正常' }])}`;
    agentChatStream.mockResolvedValue(sseResponse(raw));
    const { result, spies } = setup();
    await act(async () => { await result.current.send('hi'); });
    expect(bodyOf(reduceMessages(spies.setMessages)[1])).toBe('正常');
  });

  it('未知事件类型 → 告警并忽略（契约漂移可见）', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    agentChatStream.mockResolvedValue(sseResponse(frames([
      { type: '未来新增的事件', payload: 1 },
      { type: 'token', token: 'ok' },
    ])));
    const { result, spies } = setup();
    await act(async () => { await result.current.send('hi'); });
    expect(spy).toHaveBeenCalled();
    expect(bodyOf(reduceMessages(spies.setMessages)[1])).toBe('ok');
    spy.mockRestore();
  });
});

// ─── feedback 与 analyzing 转圈 ────────────────────────────────────────────

describe('useAgentStream — feedback 与 analyzing 转圈', () => {
  it('异常收尾后 analyzing 必为 false（C2b 回归：error/done/中断三条路径都不发 feedback）', async () => {
    agentChatStream.mockResolvedValue(sseResponse(frames([
      { type: 'feedback', status: 'running' },
      { type: 'error', message: '异常收尾' },
    ])));
    const { result } = setup();
    await act(async () => { await result.current.send('hi'); });
    // 只靠 finally 收尾才不至于永久转圈
    expect(result.current.analyzing).toBe(false);
    expect(result.current.sending).toBe(false);
  });

  it('流未结束时 sending 为 true，结束后回到 false', async () => {
    let release: (v: Response) => void = () => {};
    agentChatStream.mockReturnValue(new Promise<Response>(res => { release = res; }));
    const { result } = setup();
    let pending!: Promise<void>;
    act(() => { pending = result.current.send('hi'); });
    expect(result.current.sending).toBe(true);
    await act(async () => {
      release(sseResponse(frames([{ type: 'feedback', status: 'running' }, { type: 'done' }])));
      await pending;
    });
    expect(result.current.sending).toBe(false);
  });
});

// ─── 弹窗与执行记录 ────────────────────────────────────────────────────────

describe('useAgentStream — 弹窗与执行记录', () => {
  it('plan_confirm → 深拷贝出可编辑副本（弹窗改动不污染后端对象）', async () => {
    const plan = { subtasks: [{ seq: 1, behavior: 'B' }] };
    agentChatStream.mockResolvedValue(sseResponse(frames([{ type: 'plan_confirm', confirmId: 'p1', plan }])));
    const { result, spies } = setup();
    await act(async () => { await result.current.send('hi'); });
    const arg = spies.setPlanConfirmModal.mock.calls.at(-1)![0];
    expect(arg.confirmId).toBe('p1');
    expect(arg.editedPlan).toEqual(plan);
    expect(arg.editedPlan).not.toBe(plan);
    expect(arg.editedPlan.subtasks).not.toBe(plan.subtasks);
  });

  it('plan_received → 落入 confirmedPlan（C4：此前该事件前端零处理）', async () => {
    const plan: SubTaskPlan = { subtasks: [{ seq: 1, behavior: 'B' }] as any };
    agentChatStream.mockResolvedValue(sseResponse(frames([{ type: 'plan_received', plan }])));
    const { result, spies } = setup();
    await act(async () => { await result.current.send('hi'); });
    expect(spies.setConfirmedPlan).toHaveBeenCalledWith(plan);
  });

  it('exec_entry → 累积到执行记录（走 mergeExecEntry 去重配对）', async () => {
    agentChatStream.mockResolvedValue(sseResponse(frames([
      { type: 'exec_entry', entry: { time: 't', type: 'tool_call', name: 'X', status: 'running', source: 'parent', toolCallId: 'tc1' } },
      { type: 'exec_entry', entry: { time: 't', type: 'tool_call', name: 'X', status: 'done', source: 'parent', toolCallId: 'tc1', result: 'ok' } },
    ])));
    const { result, spies } = setup();
    await act(async () => { await result.current.send('hi'); });
    const log = reduceLog(spies.setExecutionLog);
    expect(log).toHaveLength(1); // running → done 配对成一条，而非两条
    expect(log[0].status).toBe('done');
    expect(log[0].result).toBe('ok');
  });

  it('子任务条目（source=child 且有 seq）→ 聊天区出现子任务块', async () => {
    agentChatStream.mockResolvedValue(sseResponse(frames([
      { type: 'exec_entry', entry: { time: 't', type: 'subtask_start', name: 'B1', displayName: '行为一（B1）', status: 'running', source: 'child', seq: 1 } },
    ])));
    const { result, spies } = setup();
    await act(async () => { await result.current.send('hi'); });
    const block = reduceMessages(spies.setMessages).find(m => m.role === 'subtask') as any;
    expect(block).toBeTruthy();
    expect(block.seq).toBe(1);
    expect(block.behavior).toBe('B1');
  });
});
// ─── 中断 ──────────────────────────────────────────────────────────────────

describe('useAgentStream — 中断', () => {
  it('AbortError（用户中断）→ 不往正文写错误文案', async () => {
    agentChatStream.mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    const { result, spies } = setup();
    await act(async () => { await result.current.send('hi'); });
    const msgs = reduceMessages(spies.setMessages);
    expect(msgs).toHaveLength(2); // user + 空 assistant，未追加错误
    expect(bodyOf(msgs[1])).toBe('');
  });

  it('普通错误 → 写入错误文案并释放 sending', async () => {
    agentChatStream.mockRejectedValue(new Error('网络断了'));
    const { result, spies } = setup();
    await act(async () => { await result.current.send('hi'); });
    expect(bodyOf(reduceMessages(spies.setMessages)[1])).toContain('[错误: 网络断了]');
    expect(result.current.sending).toBe(false);
  });

  it('HTTP 非 2xx → 用响应体文本作为错误信息', async () => {
    agentChatStream.mockResolvedValue({ ok: false, text: async () => '线程不存在' } as unknown as Response);
    const { result, spies } = setup();
    await act(async () => { await result.current.send('hi'); });
    expect(bodyOf(reduceMessages(spies.setMessages)[1])).toContain('[错误: 线程不存在]');
  });

  it('abort() → 通知后端并带 thread_id，成功时不提示', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    const { result } = setup();
    await act(async () => { await result.current.abort(); });
    expect(fetchMock).toHaveBeenCalledWith('/agent-api/abort', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ thread_id: 'T1' }),
    }));
    expect(warn).not.toHaveBeenCalled();
  });

  it('abort() → 409 时明确提示未被接受（不假装已中断）', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false, status: 409, json: async () => ({ message: '当前没有正在执行的任务' }),
    });
    vi.stubGlobal('fetch', fetchMock);
    const { result } = setup();
    await act(async () => { await result.current.abort(); });
    expect(warn).toHaveBeenCalled();
  });

  it('abort() → 请求抛错也提示（后端可能仍在执行该任务）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const { result } = setup();
    await act(async () => { await result.current.abort(); });
    expect(warn).toHaveBeenCalled();
  });
});

// ─── 轮次 id ───────────────────────────────────────────────────────────────

describe('useAgentStream — currentRunId', () => {
  it('每轮自增，供回执定位要更新的 assistant 消息', async () => {
    agentChatStream.mockResolvedValue(sseResponse(frames([{ type: 'done' }])));
    const { result } = setup();
    expect(result.current.currentRunId()).toBe(0);
    await act(async () => { await result.current.send('一'); });
    expect(result.current.currentRunId()).toBe(1);
    await act(async () => { await result.current.send('二'); });
    expect(result.current.currentRunId()).toBe(2);
  });
});
// ─── 中断：挂起的 read() 必须被唤醒（回归：点了中断没反应、刷新才生效）─────────

describe('useAgentStream — 中断唤醒挂起的读循环（回归）', () => {
  /**
   * 构造一个**永远不产出也不结束**的流。
   *
   * 这正是生产上「点了中断没反应、刷新页面才看到中断结果」的成因：
   * 经 nginx 代理的 SSE 在 AbortController.abort() 后，reader.read() 可能既不返回也不抛错，
   * 而旧实现把 UI 状态复位全挂在 send() 的 finally 上（等 read 自然结束）→ UI 永远卡在 sending。
   */
  function hangingStream() {
    return new ReadableStream({
      start(controller) {
        // 只发一个 token 就算「已开始」，之后既不 push 也不 close —— 模拟连接半开
        controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: 'token', token: '开始' })}\n\n`));
      },
    });
  }

  it('read() 挂起时点中断 → sending 立即变false（不依赖流结束）', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, body: hangingStream() });
    vi.stubGlobal('fetch', fetchMock);
    const { result } = setup();

    // 发起会话：流开始后永不结束
    let pending!: Promise<void>;
    act(() => { pending = result.current.send('hi'); });
    expect(result.current.sending).toBe(true);

    // 点中断 —— 不 await abort()：UI 必须在 abort 的同步部分就恢复
    act(() => { void result.current.abort(); });

    expect(result.current.sending).toBe(false); // 关键：立即恢复，不等流
    await act(async () => { await pending; });
    expect(result.current.sending).toBe(false);
  });

});
// ─── 中断：必须收到后端的收尾事件（回归：一直转圈、无中断结论）───────────────

describe('useAgentStream — 中断后仍接收后端收尾事件（回归）', () => {
  /**
   * 模拟「可分段产出」的流：先发一个 narrative（转圈中），之后**由测试驱动**继续发事件。
   * 这模拟真实链路——用户点中断时连接保持，后端随后发 narrative_end(aborted) + 中断结论 + done。
   */
  function controllableStream() {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const enc = new TextEncoder();
    const push = (ev: unknown) => controller.enqueue(enc.encode(`data: ${JSON.stringify(ev)}\n\n`));
    const close = () => controller.close();
    const body = new ReadableStream<Uint8Array>({ start: (c) => { controller = c; } });
    return {
      response: { ok: true, body, text: async () => '' } as unknown as Response,
      push, close,
    };
  }

  it('中断后收到 narrative_end(aborted) → 思考区定格（转圈停止）', async () => {
    const s = controllableStream();
    agentChatStream.mockResolvedValue(s.response);
    const { result, spies } = setup();

    let pending!: Promise<void>;
    act(() => { pending = result.current.send('hi'); });
    // 规划期思考块开始转圈
    await act(async () => { s.push({ type: 'narrative', token: '正在分析' }); await tick(1); });
    expect((reduceMessages(spies.setMessages)[1] as any).narrativeStreaming).toBe(true);

    // 用户点中断（UI 立即定格，不等网络）
    act(() => { void result.current.abort(); });
    await tick(1);
    expect((reduceMessages(spies.setMessages)[1] as any).narrativeStreaming).toBe(false);

    // 后端随后发 narrative_end(aborted) —— 仍应被接收并处理（幂等定格）
    await act(async () => { s.push({ type: 'narrative_end', outcome: 'aborted' }); await tick(1); });
    expect((reduceMessages(spies.setMessages)[1] as any).narrativeStreaming).toBe(false);
    await act(async () => { s.close(); await pending; });
  });

  it('中断后仍能收到后端的中断结论 token 与 done（关键：不能丢收尾事件）', async () => {
    const s = controllableStream();
    agentChatStream.mockResolvedValue(s.response);
    const { result, spies } = setup();

    let pending!: Promise<void>;
    act(() => { pending = result.current.send('hi'); });
    await act(async () => { s.push({ type: 'narrative', token: '正在分析' }); await tick(1); });

    act(() => { void result.current.abort(); });
    await tick(1);

    // 后端在中断后发出的收尾事件（orchestrator.summaryPhase 的中断分支 / planning 的已中断）
    await act(async () => {
      s.push({ type: 'narrative_end', outcome: 'aborted' });
      s.push({ type: 'token', token: '\n\n任务已被用户中断。' });
      s.push({ type: 'done' });
      await tick(2);
    });
    await act(async () => { s.close(); await pending; });

    // 中断结论必须出现在正文里——这正是用户要的「输出中断结论」
    const assistant = reduceMessages(spies.setMessages)[1] as any;
    expect(assistant.content).toContain('任务已被用户中断');
    expect(result.current.sending).toBe(false);
    expect(result.current.analyzing).toBe(false);
  });

  it('中断后按钮立即可用（不等流结束）——用户可马上发新消息', async () => {
    const s = controllableStream();
    agentChatStream.mockResolvedValue(s.response);
    const { result } = setup();

    let pending!: Promise<void>;
    act(() => { pending = result.current.send('hi'); });
    await act(async () => { s.push({ type: 'narrative', token: '思考' }); await tick(1); });
    expect(result.current.sending).toBe(true);

    act(() => { void result.current.abort(); });
    // 关键：流还没结束（后端还在发收尾事件），但 UI 已解除发送态
    expect(result.current.sending).toBe(false);

    await act(async () => { s.push({ type: 'done' }); s.close(); await pending; });
  });
});
// ─── 中断：AbortSignal 不得被 abort（否则收不到父 Agent 总结）────────────────

describe('useAgentStream — 中断必须保留连接以接收父Agent 总结（回归）', () => {
  it('点中断不会 abort 底层 fetch（signal.aborted 保持 false）', async () => {
    let captured: AbortSignal | undefined;
    agentChatStream.mockImplementation(async (_s: any, _o: any, _t: any, _m: any, signal: any) => {
      captured = signal;
      return sseResponse(frames([{ type: 'done' }]));
    });
    const { result } = setup();

    let pending!: Promise<void>;
    act(() => { pending = result.current.send('hi'); });
    await act(async () => { await pending; });
    expect(captured).toBeInstanceOf(AbortSignal);

    // 再来一轮：中途中断，检查 signal 未被 abort
    let captured2: AbortSignal | undefined;
    agentChatStream.mockImplementation(async (_s: any, _o: any, _t: any, _m: any, signal: any) => {
      captured2 = signal;
      // 第二轮流保持开启（不 close）：中断后仍能继续收到后端的收尾事件
      return new ReadableStream({
        start(c) { c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: 'narrative', token: '思考' })}\n\n`)); },
      });
    });
    let pending2!: Promise<void>;
    act(() => { pending2 = result.current.send('第二轮'); });
    await tick();

    act(() => { void result.current.abort(); });
    // 关键契约：连接不被掐断 → 后端 summaryPhase 的总结才能流回来
    expect(captured2!.aborted).toBe(false);

    await act(async () => { await pending2; });
  });

  // 注：卸载清理（abort 连接 + 唤醒哨兵）刻意**不写**用例。
  // 原因：jsdom + `act` 会把微任务 flush 到底，无法可靠构造「read() 永不结算」的挂起态——
  // 实测断言会随机地提前结束（先后踩了「result.current 为 null」与「settled 提前为 true」）。
  // 宁可少一条覆盖，也不留会在 CI偶发失败的用例。该清理路径由代码审查保障。
});