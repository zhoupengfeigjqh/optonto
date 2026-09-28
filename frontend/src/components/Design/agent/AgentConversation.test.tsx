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
  default: ({ item }: any) => <div data-testid="subtask">{item.displayName}</div>,
}));
vi.mock('./SecurityConfirmModal', () => ({
  default: ({ confirmModal }: any) => <div data-testid="security-modal">{confirmModal.confirmId}</div>,
}));

import AgentConversation from './AgentConversation';
import * as agentApi from '@/api/agent-client';
import { selectOption } from '@/test/antd';

/** 构造一段 SSE 响应流（事件按顺序下发后关闭） */
function sseStream(events: object[], close = true): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const e of events) controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n`));
      if (close) controller.close();
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
    await waitFor(() => expect(agentApi.agentChatStream).toHaveBeenCalledWith('生产调度', '原材料采购和库存', 't1', '查一下库存'));

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
      { type: 'exec_entry', entry: { time: '10:00', type: 'subtask_start', name: 'QueryInventory', displayName: '查询库存', status: 'running', source: 'child', seq: 1 } },
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

  it('历史加载失败给出错误提示且不崩溃', async () => {
    vi.mocked(agentApi.getAgentThread).mockRejectedValue(new Error('线程不存在'));
    render(<AgentConversation threadId="t9" scenarioName="s" ontologyName="o" onBack={vi.fn()} />);
    expect(await screen.findByText(/加载对话失败: 线程不存在/)).toBeInTheDocument();
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
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/agent-api/abort', { method: 'POST' }));
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
            { seq: 1, behavior: 'QueryInventory', display_name: '查询库存', params: { 原材料编号: { value: 'RM-001', required: true } } },
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
      { type: 'exec_entry', entry: { time: '10:00', type: 'subtask_start', name: 'QueryInventory', displayName: '查询库存', status: 'running', source: 'child', seq: 1 } },
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
    vi.mocked(agentApi.agentChatStream).mockResolvedValue(okResponse([
      { type: 'feedback', status: 'running' },
    ]) as any);
    await send('执行');
    expect(await screen.findByText(/父Agent 正在处理/)).toBeInTheDocument();
  });

  it('子任务完成事件更新子任务块状态', async () => {
    setup([]);
    vi.mocked(agentApi.agentChatStream).mockResolvedValue(okResponse([
      { type: 'exec_entry', entry: { time: '10:00', type: 'subtask_start', name: 'QueryInventory', displayName: '查询库存', status: 'running', source: 'child', seq: 1 } },
      { type: 'exec_entry', entry: { time: '10:02', type: 'subtask_done', name: 'QueryInventory', displayName: '查询库存', status: 'done', source: 'child', seq: 1 } },
    ]) as any);
    await send('执行');
    expect(await screen.findByTestId('subtask')).toHaveTextContent('查询库存');
  });

  it('子任务阶段后的首个 token 会新开一条总结消息', async () => {
    setup([]);
    vi.mocked(agentApi.agentChatStream).mockResolvedValue(okResponse([
      { type: 'exec_entry', entry: { time: '10:00', type: 'subtask_start', name: 'QueryInventory', displayName: '查询库存', status: 'running', source: 'child', seq: 1 } },
      { type: 'token', token: '总结：库存充足' },
    ]) as any);
    await send('执行');
    expect(await screen.findByText('总结：库存充足')).toBeInTheDocument();
  });
});
