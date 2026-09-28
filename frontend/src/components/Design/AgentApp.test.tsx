/**
 * AgentApp 单测（章程 III：属性传递 / 事件触发 / 边界条件）。
 *
 * 拆分后 AgentApp 只负责线程列表 + 新建对话 + 进入会话，测试聚焦这三件事：
 * 列表渲染、新建对话（含本体范围多选 → 提交参数）、进入/返回会话、缺少场景/本体时不请求。
 *
 * 会话界面（AgentConversation）在此以「出现其标题」作为进入成功的信号，
 * 其自身行为由 AgentConversation.test.tsx 覆盖。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/api/agent-client', () => ({
  listAgentThreads: vi.fn(),
  createAgentThread: vi.fn(),
  deleteAgentThread: vi.fn(),
  getAgentThread: vi.fn(),
  agentChatStream: vi.fn(),
}));
vi.mock('@/api/client', () => ({
  listAllOntologies: vi.fn(),
}));

import AgentApp from './AgentApp';
import * as agentApi from '@/api/agent-client';
import * as api from '@/api/client';

const threads = [
  { id: 't1', title: '采购计划讨论', message_count: 4, created_at: '2026-09-28T10:00:00.000Z' },
  { id: 't2', title: '', message_count: 0, created_at: '' },
];

const ontologies = [
  { scenario_name: '生产调度', ontology_name: '原材料采购和库存' },
  { scenario_name: '生产调度', ontology_name: '资源（人力和设备）' },
];

function mockLoaded() {
  vi.mocked(agentApi.listAgentThreads).mockResolvedValue(threads as any);
  vi.mocked(api.listAllOntologies).mockResolvedValue(ontologies as any);
  vi.mocked(agentApi.getAgentThread).mockResolvedValue({ messages: [] } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AgentApp — 属性传递', () => {
  it('渲染线程列表，标题为空时显示「未命名对话」', async () => {
    mockLoaded();
    render(<AgentApp scenarioName="生产调度" ontologyName="原材料采购和库存" />);
    expect(await screen.findByText('采购计划讨论')).toBeInTheDocument();
    expect(screen.getByText('未命名对话')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
  });

  it('创建时间缺失时显示占位符 -', async () => {
    mockLoaded();
    render(<AgentApp scenarioName="生产调度" ontologyName="原材料采购和库存" />);
    await screen.findByText('采购计划讨论');
    expect(screen.getByText('-')).toBeInTheDocument();
  });

  it('按场景/本体拉取线程与全量本体列表', async () => {
    mockLoaded();
    render(<AgentApp scenarioName="生产调度" ontologyName="原材料采购和库存" />);
    await waitFor(() => {
      expect(vi.mocked(agentApi.listAgentThreads)).toHaveBeenCalledWith('生产调度', '原材料采购和库存');
      expect(vi.mocked(api.listAllOntologies)).toHaveBeenCalled();
    });
  });
});

describe('AgentApp — 事件触发', () => {
  it('打开新建对话时默认勾选当前本体，并提交所选范围', async () => {
    mockLoaded();
    vi.mocked(agentApi.createAgentThread).mockResolvedValue({ id: 'new-1' } as any);
    render(<AgentApp scenarioName="生产调度" ontologyName="原材料采购和库存" />);
    await screen.findByText('采购计划讨论');

    fireEvent.click(screen.getByRole('button', { name: /新建对话/ }));
    const titleInput = await screen.findByPlaceholderText('输入对话标题（可选）');
    fireEvent.change(titleInput, { target: { value: '我的新对话' } });

    // 默认已选中当前本体（Select 的已选项以 selection-item 呈现）
    expect(document.querySelectorAll('.ant-select-selection-item').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: '创 建' }));
    await waitFor(() => expect(vi.mocked(agentApi.createAgentThread)).toHaveBeenCalledWith(
      '生产调度', '原材料采购和库存', '我的新对话',
      [{ scenario: '生产调度', ontology: '原材料采购和库存' }],
    ));
  });

  it('标题留空时提交默认标题「新对话」', async () => {
    mockLoaded();
    vi.mocked(agentApi.createAgentThread).mockResolvedValue({ id: 'new-2' } as any);
    render(<AgentApp scenarioName="生产调度" ontologyName="原材料采购和库存" />);
    await screen.findByText('采购计划讨论');

    fireEvent.click(screen.getByRole('button', { name: /新建对话/ }));
    fireEvent.click(await screen.findByRole('button', { name: '创 建' }));
    await waitFor(() => expect(vi.mocked(agentApi.createAgentThread)).toHaveBeenCalledWith(
      '生产调度', '原材料采购和库存', '新对话', expect.any(Array),
    ));
  });

  it('点击会话标题进入会话界面', async () => {
    mockLoaded();
    render(<AgentApp scenarioName="生产调度" ontologyName="原材料采购和库存" />);
    fireEvent.click(await screen.findByText('采购计划讨论'));
    // 进入后会加载历史消息并渲染会话头部
    expect(await screen.findByText('智能体对话')).toBeInTheDocument();
    expect(vi.mocked(agentApi.getAgentThread)).toHaveBeenCalledWith('生产调度', '原材料采购和库存', 't1');
  });

  it('返回按钮退出会话并刷新列表', async () => {
    mockLoaded();
    render(<AgentApp scenarioName="生产调度" ontologyName="原材料采购和库存" />);
    fireEvent.click(await screen.findByText('采购计划讨论'));
    await screen.findByText('智能体对话');
    const before = vi.mocked(agentApi.listAgentThreads).mock.calls.length;

    fireEvent.click(document.querySelector('.anticon-arrow-left')!.closest('button') as HTMLElement);
    await waitFor(() => expect(screen.getByText('智能体应用')).toBeInTheDocument());
    expect(vi.mocked(agentApi.listAgentThreads).mock.calls.length).toBeGreaterThan(before);
  });

  it('删除按钮弹出二次确认，确认后调用删除接口', async () => {
    mockLoaded();
    vi.mocked(agentApi.deleteAgentThread).mockResolvedValue(undefined as any);
    render(<AgentApp scenarioName="生产调度" ontologyName="原材料采购和库存" />);
    await screen.findByText('采购计划讨论');

    fireEvent.click(document.querySelector('.anticon-delete')!.closest('button') as HTMLElement);
    expect(await screen.findByText('删除后不可恢复，确定要删除吗？')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));
    await waitFor(() => expect(vi.mocked(agentApi.deleteAgentThread)).toHaveBeenCalledWith('生产调度', '原材料采购和库存', 't1'));
  });
});

describe('AgentApp — 边界条件', () => {
  it('缺少场景或本体时不发起任何请求', async () => {
    render(<AgentApp />);
    await waitFor(() => expect(document.querySelector('.ant-table')).toBeTruthy());
    expect(vi.mocked(agentApi.listAgentThreads)).not.toHaveBeenCalled();
    expect(vi.mocked(api.listAllOntologies)).not.toHaveBeenCalled();
  });

  it('列表为空时表格渲染但无数据行', async () => {
    vi.mocked(agentApi.listAgentThreads).mockResolvedValue([]);
    vi.mocked(api.listAllOntologies).mockResolvedValue([]);
    render(<AgentApp scenarioName="生产调度" ontologyName="原材料采购和库存" />);
    await waitFor(() => expect(vi.mocked(agentApi.listAgentThreads)).toHaveBeenCalled());
    expect(document.querySelectorAll('.ant-table-row').length).toBe(0);
  });

  it('创建工作流失败时给出错误提示且不进入会话', async () => {
    mockLoaded();
    vi.mocked(agentApi.createAgentThread).mockRejectedValue(new Error('名称重复'));
    render(<AgentApp scenarioName="生产调度" ontologyName="原材料采购和库存" />);
    await screen.findByText('采购计划讨论');

    fireEvent.click(screen.getByRole('button', { name: /新建对话/ }));
    fireEvent.click(await screen.findByRole('button', { name: '创 建' }));
    expect(await screen.findByText(/创建失败: 名称重复/)).toBeInTheDocument();
    expect(screen.queryByText('智能体对话')).not.toBeInTheDocument();
  });
});
