/**
 * AgentConversation 单测（章程 III：属性传递 / 事件触发 / 边界条件）。
 *
 * 这是聊天主管路，核心逻辑是**把 SSE 消息流按阶段路由到界面**：
 * narrative(思考) → plan_confirm(规划确认) → exec_entry/subtask(子任务块) → token(正文)。
 * 因此测试手段是「喂一段可控的 SSE 事件流，断言界面落到正确状态」。
 *
 * 子组件（思考块/子任务块/安全确认）替换为探针：本组件的职责是路由与状态编排，
 * 子组件自身的渲染已由各自的测试覆盖。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/api/agent-client', () => ({
  getAgentThread: vi.fn(),
  agentChatStream: vi.fn(),
}));
vi.mock('./NarrativeBlock', () => ({
  default: ({ item }: any) => <div data-testid="narrative">{item.content}</div>,
}));
vi.mock('./SubtaskBlock', () => ({
  default: ({ item }: any) => <div data-testid="subtask">{item.title}</div>,
}));
vi.mock('./SecurityConfirmModal', () => ({
  default: ({ confirmModal }: any) => <div data-testid="security-modal">{confirmModal.confirmId}</div>,
}));

import AgentConversation from './AgentConversation';
import * as agentApi from '@/api/agent-client';
import { selectOption } from '@/test/antd';
import { message as messageApi } from 'antd';

/**
 * 构造一段 SSE 响应流（事件按顺序下发后关闭）。
 *
 * `close=false` 且给了 `signal` 时，模拟**真实 fetch 被 abort 的行为**：signal 触发后
 * `reader.read()` 抛 `AbortError`。这一步不能省——`agentChatStream` 被 mock 后不会自带
 * abort→reader 的联动，不显式建模就测不出「中断后 sending 复位、发送框恢复可用」。
 */
function sseStream(events: object[], close = true, signal?: AbortSignal): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const e of events) controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n`));
      if (close) { controller.close(); return; }
      if (signal) {
        signal.addEventListener('abort', () => {
          try { controller.error(new DOMException('Aborted', 'AbortError')); } catch { /* 已结束，忽略 */ }
        });
      }
    },
  });
}

const okResponse = (events: object[]) => ({ ok: true, body: sseStream(events) }) as unknown as Response;

function setup(messages: any[] = []) {
  vi.mocked(agentApi.getAgentThread).mockResolvedValue({ messages } as any);
  const props = {
    threadId: 't1', scenarioName: '生产调度', ontologyName: '原材料采购和库存', onBack: vi.fn(),
  };
  render(<AgentConversation {...props} />);
  return props;
}

/** 输入并发送一条消息（按钮名用正则：antd 对「图标+2 个汉字」不插空格，无图标才插） */
async function send(text: string) {
  const textarea = await screen.findByPlaceholderText('输入您的问题... (Shift+Enter 换行)');
  fireEvent.change(textarea, { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: /发\s*送/ }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AgentConversation — 属性传递', () => {
  it('加载历史消息并渲染到聊天区', async () => {
    setup([{ role: 'user', content: '历史问题', timestamp: '2026-09-28T10:00:00.000Z' }]);
    expect(await screen.findByText('历史问题')).toBeInTheDocument();
    expect(vi.mocked(agentApi.getAgentThread)).toHaveBeenCalledWith('生产调度', '原材料采购和库存', 't1');
  });

  it('按 threadId / 场景 / 本体拉取历史', async () => {
    setup();
    await waitFor(() => expect(vi.mocked(agentApi.getAgentThread)).toHaveBeenCalledTimes(1));
  });

  it('无历史消息时展示空态引导', async () => {
    setup([]);
    expect(await screen.findByText('开始一段新的智能体对话')).toBeInTheDocument();
  });

  it('返回按钮触发 onBack', async () => {
    const props = setup([]);
    await screen.findByText('开始一段新的智能体对话');
    fireEvent.click(document.querySelector('.anticon-arrow-left')!.closest('button') as HTMLElement);
    expect(props.onBack).toHaveBeenCalledTimes(1);
  });
});

describe('AgentConversation — SSE 事件路由（事件触发）', () => {
  it('narrative 事件流入思考区，token 事件进入正文', async () => {
    setup([]);
    vi.mocked(agentApi.agentChatStream).mockResolvedValue(okResponse([
      { type: 'narrative', token: '正在规划…' },
      { type: 'narrative_end', outcome: 'plan' },
      { type: 'token', token: '库存充足' },
      { type: 'done' },
    ]) as any);

    await send('查一下库存');
    // 第 5 个参数是 AbortSignal（C2：中断时取消本地流读取），用 anything() 匹配避免绑死实例
    await waitFor(() => expect(agentApi.agentChatStream).toHaveBeenCalledWith(
      '生产调度', '原材料采购和库存', 't1', '查一下库存', expect.anything(),
    ));

    // 规划期思考区（探针收到 narrative 内容）
    expect((await screen.findAllByTestId('narrative'))[0]).toHaveTextContent('正在规划…');
    // 正文回流到同一条 assistant 消息
    expect(await screen.findByText('库存充足')).toBeInTheDocument();
  });

  it('narrative_end outcome=answer 时撤掉思考区（直答路径）', async () => {
    setup([]);
    vi.mocked(agentApi.agentChatStream).mockResolvedValue(okResponse([
      { type: 'narrative', token: '直接思考' },
      { type: 'narrative_end', outcome: 'answer' },
      { type: 'token', token: '直接回答' },
      { type: 'done' },
    ]) as any);

    await send('你好');
    expect(await screen.findByText('直接回答')).toBeInTheDocument();
    expect(screen.queryByTestId('narrative')).not.toBeInTheDocument();
  });

  it('plan_confirm 事件打开规划确认弹窗并展示子任务数', async () => {
    setup([]);
    // 注意：不带 done —— done 的语义是「本轮结束，关闭待确认弹窗」（见下一个用例），
    // 真实后端在用户响应前不会发 done。
    vi.mocked(agentApi.agentChatStream).mockResolvedValue(okResponse([
      { type: 'plan_confirm', confirmId: 'c1', plan: { subtasks: [{ seq: 1, behavior: 'QueryInventory', params: {} }] } },
    ]) as any);

    await send('制定计划');
    expect(await screen.findByText(/规划已就绪，共 1 个操作/)).toBeInTheDocument();
  });

  it('confirm 事件打开安全确认弹窗', async () => {
    setup([]);
    vi.mocked(agentApi.agentChatStream).mockResolvedValue(okResponse([
      { type: 'confirm', confirmId: 'c2', behavior: 'CreatePurchaseRecord', content: '将创建采购单', params: {} },
    ]) as any);

    await send('建采购单');
    expect(await screen.findByTestId('security-modal')).toHaveTextContent('c2');
  });

  it('done 事件关闭待确认的规划弹窗（本轮结束）', async () => {
    setup([]);
    vi.mocked(agentApi.agentChatStream).mockResolvedValue(okResponse([
      { type: 'plan_confirm', confirmId: 'c3', plan: { subtasks: [{ seq: 1, behavior: 'A', params: {} }] } },
      { type: 'done' },
    ]) as any);

    await send('制定计划');
    // 流结束后不应残留确认弹窗
    await waitFor(() => expect(screen.queryByText(/规划已就绪/)).not.toBeInTheDocument());
  });

  it('exec_entry(source=child) 事件生成子任务块', async () => {
    setup([]);
    vi.mocked(agentApi.agentChatStream).mockResolvedValue(okResponse([
      { type: 'exec_entry', entry: { time: '10:00', type: 'subtask_start', name: 'QueryInventory', title: '查询库存', status: 'running', source: 'child', seq: 1 } },
      { type: 'done' },
    ]) as any);

    await send('执行');
    expect(await screen.findByTestId('subtask')).toHaveTextContent('查询库存');
  });

  it('error 事件把错误信息追加到正文', async () => {
    setup([]);
    vi.mocked(agentApi.agentChatStream).mockResolvedValue(okResponse([
      { type: 'error', message: '规划校验失败' },
    ]) as any);

    await send('试试');
    expect(await screen.findByText(/\[错误: 规划校验失败\]/)).toBeInTheDocument();
  });

  it('plan_received 事件被消费且不重复渲染正文（补 C4 契约缺口）', async () => {
    setup([]);
    // 后端确认规划后连发 plan_received（结构化，含用户编辑）+ token（文本摘要）；
    // 修复前前端对 plan_received 零处理、零引用（写而不读的死契约）
    vi.mocked(agentApi.agentChatStream).mockResolvedValue(okResponse([
      { type: 'plan_received', plan: { subtasks: [{ seq: 1, behavior: 'QueryInventory', description: '盘点当前库存数量', params: {}, scenario_name: '生产调度', ontology_name: '原材料采购和库存', ontology_id: 1 }] } },
      { type: 'done' },
    ]) as any);

    await send('查库存');
    // 事件被安全消费（流正常结束、不抛错）；正文只由随后的 token 事件呈现，
    // plan_received 的结构化数据不重复渲染（否则同一计划在界面上出现两遍）
    await waitFor(() => expect(agentApi.agentChatStream).toHaveBeenCalled());
    expect(screen.queryByText(/盘点当前库存数量/)).not.toBeInTheDocument();
  });

  it('未知事件类型被忽略且不中断流（契约守卫）', async () => {
    setup([]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.mocked(agentApi.agentChatStream).mockResolvedValue(okResponse([
      { type: 'brand_new_event', payload: 'x' },
      { type: 'token', token: '正常内容' },
      { type: 'done' },
    ]) as any);

    await send('测试');
    // 未知事件被跳过并告警，后续事件照常处理
    expect(await screen.findByText('正常内容')).toBeInTheDocument();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('点击执行记录按钮打开侧面板', async () => {
    setup([]);
    await screen.findByText('开始一段新的智能体对话');
    fireEvent.click(screen.getByRole('button', { name: /执行记录/ }));
    expect(await screen.findByText('暂无执行记录')).toBeInTheDocument();
  });
});

describe('AgentConversation — 边界条件', () => {
  it('空输入不发送（按钮禁用且不调用流接口）', async () => {
    setup([]);
    const textarea = await screen.findByPlaceholderText('输入您的问题... (Shift+Enter 换行)');
    fireEvent.change(textarea, { target: { value: '   ' } });
    const sendBtn = screen.getByRole('button', { name: /发\s*送/ });
    expect(sendBtn).toBeDisabled();
    fireEvent.click(sendBtn);
    expect(vi.mocked(agentApi.agentChatStream)).not.toHaveBeenCalled();
  });

  it('历史加载失败给出错误态与重试入口，且不崩溃（F1：不再伪装成「空对话」）', async () => {
    vi.mocked(agentApi.getAgentThread).mockRejectedValue(new Error('线程不存在'));
    render(<AgentConversation threadId="t9" scenarioName="s" ontologyName="o" onBack={vi.fn()} />);
    // 错误态必须显式呈现原因 + 重试入口——原先只弹 toast 后照常渲染「开始一段新的对话」空态，
    // 用户无法区分"加载失败"与"新对话"
    expect(await screen.findByText(/加载对话失败：线程不存在/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /重\s*试/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /返回会话列表/ })).toBeInTheDocument();
    // 关键：不应同时渲染空态引导（那正是"伪装成新对话"的表现）
    expect(screen.queryByText('开始一段新的智能体对话')).not.toBeInTheDocument();
  });

  it('加载失败后点重试可重新拉取（错误态提供恢复路径）', async () => {
    const getThread = vi.mocked(agentApi.getAgentThread);
    getThread.mockRejectedValueOnce(new Error('线程不存在'));
    getThread.mockResolvedValueOnce({ messages: [{ role: 'assistant', content: '历史回复', timestamp: '' }] } as any);
    render(<AgentConversation threadId="t9" scenarioName="s" ontologyName="o" onBack={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: /重\s*试/ }));
    expect(await screen.findByText('历史回复')).toBeInTheDocument();
    expect(getThread).toHaveBeenCalledTimes(2);
  });

  it('流接口返回非 2xx 时把响应文本作为错误展示', async () => {
    setup([]);
    vi.mocked(agentApi.agentChatStream).mockResolvedValue({ ok: false, text: async () => '模型不可用' } as any);
    await send('你好');
    expect(await screen.findByText(/\[错误: 模型不可用\]/)).toBeInTheDocument();
  });

  it('流进行中显示中断按钮，点击后请求中断', async () => {
    setup([]);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    // 不关闭的流：保持 sending 态
    vi.mocked(agentApi.agentChatStream).mockResolvedValue({ ok: true, body: sseStream([{ type: 'narrative', token: '…' }], false) } as any);

    await send('长任务');
    const abortBtn = await screen.findByRole('button', { name: /中\s*断/ });
    fireEvent.click(abortBtn);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/agent-api/abort', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ thread_id: 't1' }),
    })));
    vi.unstubAllGlobals();
  });
});

// ─── 规划确认的交互（覆盖 onConfirmExecute / handleRejectPlan / 计划编辑）──────

describe('AgentConversation — 规划确认交互', () => {
  /** 让一段 plan_confirm 事件落地，返回 fetch 桩 */
  async function reachPlanConfirm(fetchMock: ReturnType<typeof vi.fn>) {
    vi.stubGlobal('fetch', fetchMock);
    setup([]);
    vi.mocked(agentApi.agentChatStream).mockResolvedValue(okResponse([
      {
        type: 'plan_confirm', confirmId: 'c1',
        plan: {
          subtasks: [
            { seq: 1, behavior: 'QueryInventory', title: '查询库存', params: { 原材料编号: { value: 'RM-001', required: true } } },
            { seq: 2, behavior: 'CreatePurchaseRecord', params: {} },
          ],
        },
      },
    ]) as any);
    await send('制定计划');
    await screen.findByText(/规划已就绪，共 2 个操作/);
  }

  it('确认执行：未改动时只回执 approved，不回传 plan', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    await reachPlanConfirm(fetchMock);
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/agent-api/plan-confirm/c1'),
      expect.objectContaining({ method: 'POST', body: '{"approved":true}' }),
    ));
    vi.unstubAllGlobals();
  });

  it('确认执行：结构校验不通过时留在弹窗内提示，不回执后端', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    await reachPlanConfirm(fetchMock);
    // 删掉子任务 1 → 子任务 2 的依赖仍指向 1 之外？此处构造自依赖：把 1 的依赖设为自身
    fireEvent.click(screen.getByRole('button', { name: /高级选项/ }));
    selectOption('子任务 2'); // 子任务 1 的依赖选择器里选 2
    // 再把子任务 2 的依赖设为 1 → 1↔2 成环
    selectOption('子任务 1', 1);
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }));
    expect(await screen.findByText(/循环/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('拒绝并重规划：回执 rejectAction=replan 并附调整建议', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    await reachPlanConfirm(fetchMock);
    fireEvent.change(document.querySelector('textarea.ant-input') as HTMLElement, { target: { value: '去掉第 2 个操作' } });
    fireEvent.mouseEnter(screen.getByRole('button', { name: '拒 绝' }));
    fireEvent.click(await screen.findByText('拒绝并重规划'));
    // 回执与聊天区提示分别断言：回执只校验 URL 与 approved=false，避免对 body 逐字比对过脆
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/agent-api/plan-confirm/c1'),
      expect.objectContaining({ body: expect.stringContaining('"approved":false') }),
    ));
    expect(fetchMock.mock.calls[0][1].body).toContain('"rejectAction":"replan"');
    expect(await screen.findByText(/已拒绝规划并要求重新规划/)).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('删除子任务：高级模式下删除后弹窗内子任务减少', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    await reachPlanConfirm(fetchMock);
    fireEvent.click(screen.getByRole('button', { name: /高级选项/ }));
    fireEvent.click(document.querySelectorAll('.anticon-delete')[0].closest('button') as HTMLElement);
    await waitFor(() => expect(screen.getByText(/共 1 个操作/)).toBeInTheDocument());
    vi.unstubAllGlobals();
  });

  it('编辑参数：高级模式下改参数值后回执带上修改后的 plan', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    await reachPlanConfirm(fetchMock);
    fireEvent.click(screen.getByRole('button', { name: /高级选项/ }));
    const input = document.querySelector('input.ant-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'RM-777' } });
    fireEvent.click(screen.getByRole('button', { name: '确认执行' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/agent-api/plan-confirm/c1', expect.objectContaining({
      body: expect.stringContaining('RM-777'),
    })));
    vi.unstubAllGlobals();
  });
});

describe('AgentConversation — 执行记录面板交互', () => {
  it('子任务事件进入执行记录，可折叠/展开', async () => {
    setup([]);
    vi.mocked(agentApi.agentChatStream).mockResolvedValue(okResponse([
      { type: 'exec_entry', entry: { time: '10:00', type: 'subtask_start', name: 'QueryInventory', title: '查询库存', status: 'running', source: 'child', seq: 1 } },
      { type: 'exec_entry', entry: { time: '10:01', type: 'tool_call', name: 'query_inventories', status: 'done', source: 'child', seq: 1 } },
    ]) as any);
    await send('执行');

    fireEvent.click(screen.getByRole('button', { name: /执行记录/ }));
    const group = await screen.findByText('子任务 1: 查询库存');
    fireEvent.click(group);
    await waitFor(() => expect(screen.getByText('▶')).toBeInTheDocument());
  });

  it('feedback 事件驱动「父Agent 正在处理」提示的显隐', async () => {
    setup([]);
    // 不关流的写法才能观测 running→done 的中间态（关流后 finally 会立即收尾，见下方 C2b 用例）
    vi.mocked(agentApi.agentChatStream).mockResolvedValue({ ok: true, body: sseStream([
      { type: 'feedback', status: 'running' },
      { type: 'feedback', status: 'done' },
    ]) } as any);
    await send('执行');
    // 两条事件在同一 chunk 内依次处理，最终态为隐藏
    await waitFor(() => expect(screen.queryByText(/父Agent 正在处理/)).not.toBeInTheDocument());
  });

  it('C2b：分析中异常收尾（流关闭且无 feedback done）不再残留转圈', async () => {
    setup([]);
    // 只发 feedback running 就关流 = 分析期间被中断/异常终止
    vi.mocked(agentApi.agentChatStream).mockResolvedValue(okResponse([
      { type: 'feedback', status: 'running' },
    ]) as any);
    await send('执行');
    // 「父Agent 正在处理」只在分析期间可见，流结束即应收掉——否则转圈永久残留
    await waitFor(() => expect(screen.queryByText(/父Agent 正在处理/)).not.toBeInTheDocument());
  });

  it('子任务完成事件更新子任务块状态', async () => {
    setup([]);
    vi.mocked(agentApi.agentChatStream).mockResolvedValue(okResponse([
      { type: 'exec_entry', entry: { time: '10:00', type: 'subtask_start', name: 'QueryInventory', title: '查询库存', status: 'running', source: 'child', seq: 1 } },
      { type: 'exec_entry', entry: { time: '10:02', type: 'subtask_done', name: 'QueryInventory', title: '查询库存', status: 'done', source: 'child', seq: 1 } },
    ]) as any);
    await send('执行');
    expect(await screen.findByTestId('subtask')).toHaveTextContent('查询库存');
  });

  it('子任务阶段后的首个 token 会新开一条总结消息', async () => {
    setup([]);
    vi.mocked(agentApi.agentChatStream).mockResolvedValue(okResponse([
      { type: 'exec_entry', entry: { time: '10:00', type: 'subtask_start', name: 'QueryInventory', title: '查询库存', status: 'running', source: 'child', seq: 1 } },
      { type: 'token', token: '总结：库存充足' },
    ]) as any);
    await send('执行');
    expect(await screen.findByText('总结：库存充足')).toBeInTheDocument();
  });
});

/**
 * 并发守卫（2026-10-05 审查 E6）。
 *
 * 修复前 `handleSend` 的守卫读的是 `sending` state，而 `setSending(true)` 到下次渲染
 * 之间存在窗口：同一 tick 内的两次调用（Enter 连按 / 按钮连点）都会读到 false
 * 而双双通过 → 发出两个流。后端虽有单 run 互斥（第二个收到「已有任务正在执行中」），
 * 但两个流的事件都写进同一条消息，用户看到内容错乱。
 * 现在守卫走 `sendingRef`（同步），真正做到「同一时刻只有一个 run」。
 */
describe('AgentConversation — 并发守卫（E6）', () => {
  it('流进行中连按 Enter：只发一次请求（ref 同步守卫）', async () => {
    setup([]);
    const streamSpy = vi.mocked(agentApi.agentChatStream);
    streamSpy.mockResolvedValue({ ok: true, body: sseStream([{ type: 'narrative', token: '…' }], false) } as any);

    const textarea = await screen.findByPlaceholderText('输入您的问题... (Shift+Enter 换行)');
    fireEvent.change(textarea, { target: { value: '查库存' } });
    // 连按三次 Enter（修复前会发出三个流）
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    await waitFor(() => expect(streamSpy).toHaveBeenCalledTimes(1));
  });

  it('前一轮结束后可再次发送（守卫随 finally 释放，不永久锁死）', async () => {
    setup([]);
    const streamSpy = vi.mocked(agentApi.agentChatStream);
    streamSpy.mockResolvedValueOnce(okResponse([{ type: 'done' }]) as any);

    await send('第一轮');
    await waitFor(() => expect(streamSpy).toHaveBeenCalledTimes(1));
    // 第一轮已结束（done → finally 释放守卫），第二轮应能正常发出
    await send('第二轮');
    await waitFor(() => expect(streamSpy).toHaveBeenCalledTimes(2));
  });
});

/**
 * 中断链路（2026-10-05 C2）。
 *
 * 修复前：`AbortController` 只创建从不 `.abort()`，且 `agentChatStream` 没有 signal 参数——
 * 点「中断」只通知后端，本地 reader 继续读、token 继续追加、输入框持续 `disabled`，
 * 用户看着「已中断」按钮而内容还在动。
 */
describe('AgentConversation — 中断（C2）', () => {
  it('中断：通知后端 + UI 立即响应，且**保留连接**以接收后端的中断结论（2026-10-06 修复回归）', async () => {
    setup([]);
    // 捕获传给流接口的 signal（验证中断时**不**被 abort——否则收不到后端的中断结论）
    let capturedSignal: AbortSignal | undefined;
    vi.mocked(agentApi.agentChatStream).mockImplementation(async (_s, _o, _t, _m, signal) => {
      capturedSignal = signal;
      return { ok: true, body: sseStream([{ type: 'narrative', token: '…' }], false) } as any;
    });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    await send('长任务');
    expect(capturedSignal).toBeInstanceOf(AbortSignal);

    fireEvent.click(screen.getByRole('button', { name: /中\s*断/ }));

    // 后端收到中断请求（带 thread_id 供归属校验，2026-10-05 M8）
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/agent-api/abort', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ thread_id: 't1' }),
    })));

    // 关键契约：连接**不**被掐断 —— 后端随后会发 narrative_end(aborted) + 中断结论 + done，
    // 一旦 abort 这些收尾事件全部收不到（表现为「一直转圈、没有中断结论」的回归）
    expect(capturedSignal!.aborted).toBe(false);
  });

  it('中断后思考区立即定格（转圈停止），不等流结束', async () => {
    setup([]);
    vi.mocked(agentApi.agentChatStream).mockResolvedValue({
      ok: true, body: sseStream([{ type: 'narrative', token: '正在分析' }], false) as any,
    } as any);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));

    await send('长任务');
    fireEvent.click(screen.getByRole('button', { name: /中\s*断/ }));

    // 思考块的转圈应立刻停（原先要等流结束才停，用户表现为"点了没反应"）
    await waitFor(() => {
      expect(screen.queryByText('正在输出...')).not.toBeInTheDocument();
    });
    // 中断按钮应恢复为「发送」（可立即发新消息）
    await waitFor(() => expect(screen.getByRole('button', { name: /发\s*送/ })).toBeInTheDocument());
  });

  it('中断被后端拒绝（409：任务已结束或属其他会话）→ 明确提示，不静默', async () => {
    setup([]);
    vi.mocked(agentApi.agentChatStream).mockResolvedValue({ ok: true, body: sseStream([{ type: 'narrative', token: '…' }], false) } as any);
    // antd 的 message.warning 返回 MessageType（用于后续 close），测试里不关心，用空对象占位
    const warn = vi.spyOn(messageApi, 'warning').mockImplementation((() => ({})) as unknown as typeof messageApi.warning);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 409, json: async () => ({ message: '中断请求与当前执行的任务不匹配（该任务属于其他会话）' }),
    }));

    await send('长任务');
    fireEvent.click(screen.getByRole('button', { name: /中\s*断/ }));

    // 后端如实回报"没中断" → 前端必须转达，而不是让用户以为已中断
    await waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining('其他会话')));
    warn.mockRestore();
  });

  it('中断后发送框恢复可用（sending 随流结束复位），且不写入错误文案', async () => {
    setup([]);
    vi.mocked(agentApi.agentChatStream).mockImplementation(async (_s, _o, _t, _m, signal) => ({
      ok: true, body: sseStream([{ type: 'narrative', token: '思考中' }], false, signal),
    } as any));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));

    await send('长任务');
    const textarea = screen.getByPlaceholderText('输入您的问题... (Shift+Enter 换行)') as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /中\s*断/ }));

    // AbortError 不该被当成失败写进正文（用户是主动中断的）
    await waitFor(() => expect((screen.getByPlaceholderText('输入您的问题... (Shift+Enter 换行)') as HTMLTextAreaElement).disabled).toBe(false));
    expect(screen.queryByText(/\[错误:/)).not.toBeInTheDocument();
  });
});

/**
 * 确认回执失败处理（2026-10-05 C3）。
 *
 * 修复前：五处 `fetch(...).catch(() => {})` 静默失败——弹窗照样关闭、UI 呈现已确认态，
 * 而后端等 60s 超时才判失败，用户与系统之间存在「状态真空」（写操作上尤其危险）。
 * 现在：回执失败**保持弹窗打开**并展示原因，用户可重试或改为拒绝。
 */
describe('AgentConversation — 规划确认回执失败（C3）', () => {
  /**
   * 只覆盖规划确认：PlanConfirmModal 在本文件**未被 mock**，可断到真实按钮与错误展示。
   * 安全管控弹窗被替换为探针（无按钮），其 busy/error 呈现由
   * `SecurityConfirmModal.test.tsx` 覆盖，此处只断言「回执失败 → 弹窗不关闭」。
   */
  const openPlanConfirm = () => ({ ok: true, body: sseStream([
    { type: 'plan_confirm', confirmId: 'c1', plan: { subtasks: [
      { seq: 1, behavior: 'QueryInventory', description: '查库存', params: {}, scenario_name: '生产调度', ontology_name: '原材料采购和库存', ontology_id: 1 },
    ] } },
    // 不带 done：真实后端在用户响应前不会发 done（done 语义是"本轮结束、关闭弹窗"）
  ]) } as any);

  it('回执 500 → 弹窗保持打开 + 展示原因（不再静默关闭）', async () => {
    setup([]);
    vi.mocked(agentApi.agentChatStream).mockResolvedValue(openPlanConfirm());
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 500, json: async () => ({ message: '服务器内部错误' }),
    }));

    await send('查库存');
    expect(await screen.findByText(/规划已就绪，共 1 个操作/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /确认执行/ }));

    // 失败原因就地展示
    expect(await screen.findByText(/服务器内部错误/)).toBeInTheDocument();
    // 关键：弹窗未关闭（信息条仍在），用户可重试或改拒绝
    expect(screen.getByText(/规划已就绪，共 1 个操作/)).toBeInTheDocument();
  });

  it('回执 404（确认已失效）→ 明确引导改用「拒绝」结束等待', async () => {
    setup([]);
    vi.mocked(agentApi.agentChatStream).mockResolvedValue(openPlanConfirm());
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 404, json: async () => ({ message: '该规划确认请求已失效' }),
    }));

    await send('查库存');
    await screen.findByText(/规划已就绪，共 1 个操作/);
    fireEvent.click(screen.getByRole('button', { name: /确认执行/ }));

    expect(await screen.findByText(/该规划确认请求已失效/)).toBeInTheDocument();
    expect(screen.getByText(/可改为「拒绝」结束等待/)).toBeInTheDocument();
  });

  it('回执失败后弹窗仍可操作（用户有出路：可再发起一次回执，而非被静默关闭）', async () => {
    setup([]);
    vi.mocked(agentApi.agentChatStream).mockResolvedValue(openPlanConfirm());
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ message: '服务器内部错误' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ message: 'ok' }) });
    vi.stubGlobal('fetch', fetchMock);

    await send('查库存');
    await screen.findByText(/规划已就绪，共 1 个操作/);
    fireEvent.click(screen.getByRole('button', { name: /确认执行/ }));
    await screen.findByText(/服务器内部错误/);

    // 弹窗未关闭 → 用户可原地重试；重试这次成功即收尾
    // （不断言弹窗消失：那取决于 antd 关闭动画时序，与本次要测的"回执语义"无关）
    expect(screen.getByText(/规划已就绪，共 1 个操作/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /确认执行/ }));
    // 第二次回执确实发出（此前 5 处的 .catch(() => {}) 会让这里静默无反应）
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    // 且第二次的 body 仍是有效的规划确认（可重试而非卡死）
    expect(fetchMock.mock.calls[1][1].body).toContain('"approved":true');
  });
});
