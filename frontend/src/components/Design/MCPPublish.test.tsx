/**
 * MCPPublish 容器单测（章程 III：属性传递 / 事件触发 / 边界条件）。
 *
 * 该组件拆分后只做「固定服务状态编排 + 自建发布 CRUD + 弹窗开关」，
 * 因此测试聚焦：五张固定卡片渲染、自建发布空态与卡片渲染、打开新建弹窗时拉取本体清单。
 * 依赖 API 一律打桩（章程：测试禁止真实网络）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

vi.mock('@/api/client', () => ({
  getMcpStatus: vi.fn(),
  startMcp: vi.fn(),
  stopMcp: vi.fn(),
  getMcpTools: vi.fn(),
  getBusinessMcpTools: vi.fn(),
  getCommonFunctionMcpTools: vi.fn(),
  listPublished: vi.fn(),
  getPublishMeta: vi.fn(),
  createPublished: vi.fn(),
  startPublished: vi.fn(),
  stopPublished: vi.fn(),
  deletePublished: vi.fn(),
  getPublishedClientConfig: vi.fn(),
  getFunctions: vi.fn(),
  getBehaviors: vi.fn(),
  getDataEngines: vi.fn(),
}));
vi.mock('@/api/agent-client', () => ({ getMCPConfig: vi.fn() }));

import MCPPublish from './MCPPublish';
import * as api from '@/api/client';

const publishedSvc = {
  name: 'order-query', kind: 'behavior', ontology_id: 2, ontology_name: '订单排程',
  items: ['QueryOrder'], tool_count: 1, host_port: 8030, transport: 'streamable',
  token: 'tk', container_name: 'c', created_at: '', status: 'running', running: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getMcpStatus).mockResolvedValue({ status: 'running', running: true, container: 'c' } as any);
  vi.mocked(api.getMcpTools).mockResolvedValue([] as any);
  vi.mocked(api.getBusinessMcpTools).mockResolvedValue([] as any);
  vi.mocked(api.getCommonFunctionMcpTools).mockResolvedValue([] as any);
  vi.mocked(api.listPublished).mockResolvedValue({ services: [] } as any);
  vi.mocked(api.getPublishMeta).mockResolvedValue({ kinds: [], transports: [], host_port_min: 8020, host_port_max: 8099 } as any);
  vi.mocked(api.getFunctions).mockResolvedValue([] as any);
  vi.mocked(api.getBehaviors).mockResolvedValue([] as any);
  vi.mocked(api.getDataEngines).mockResolvedValue([] as any);
});

describe('MCPPublish', () => {
  it('渲染五张固定服务卡片与自建发布空态', async () => {
    render(<MCPPublish ontologyId={1} />);
    await waitFor(() => expect(api.listPublished).toHaveBeenCalled());

    // 卡片标题在「顶部说明」里也可能被提及（如「本体查询 MCP 服务」），故按出现次数断言
    for (const title of ['本体查询 MCP 服务', '公共函数 MCP 服务', '本体函数执行服务', '数据引擎执行服务', '业务系统 MCP']) {
      expect(screen.getAllByText(title).length).toBeGreaterThan(0);
    }
    expect(screen.getByText(/还没有自建发布/)).toBeTruthy();
  });

  it('渲染自建发布卡片', async () => {
    vi.mocked(api.listPublished).mockResolvedValue({ services: [publishedSvc] } as any);
    render(<MCPPublish ontologyId={1} />);
    await waitFor(() => expect(screen.getByText('order-query')).toBeTruthy());
    expect(screen.getByRole('button', { name: '删 除' })).toBeTruthy();
  });

  it('打开新建弹窗时拉取本体函数/行为/数据引擎（就绪判据的唯一数据源）', async () => {
    render(<MCPPublish ontologyId={1} />);
    fireEvent.click(screen.getByRole('button', { name: /新建发布/ }));
    await waitFor(() => expect(screen.getByText('新建 MCP 发布')).toBeTruthy());

    await waitFor(() => expect(api.getFunctions).toHaveBeenCalledWith(1));
    expect(api.getBehaviors).toHaveBeenCalledWith(1);
    expect(api.getDataEngines).toHaveBeenCalledWith(1);
    expect(api.getPublishMeta).toHaveBeenCalled();
  });
});
