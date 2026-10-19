/**
 * MCPPublish 容器单测（章程 III：属性传递 / 事件触发 / 边界条件）。
 *
 * 该组件拆分后只做「两块视图切换（固定发布 / 自建发布）+ 固定服务状态编排
 * + 自建发布 CRUD + 弹窗开关 + 分页」，因此测试聚焦：
 * 五张固定卡片、切换后自建发布空态/卡片、打开新建弹窗时拉取本体清单、超过 6 个时分页。
 * 依赖 API 一律打桩（章程：测试禁止真实网络）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

vi.mock('@/api/client', () => ({
  // 编译期清单（真实模块导出常量，非函数）：mock 工厂必须一并给出，否则 import 拿到 undefined
  ALL_PUBLISH_KINDS: ['ontology_function', 'behavior'],
  ALL_PUBLISH_TRANSPORTS: ['streamable', 'sse'],
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
  getPublishedTools: vi.fn(),
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

/** 右上角切换按钮（antd Segmented 渲染为 radiogroup，项即 radio） */
const switchTo = (view: '固定发布' | '自建发布') =>
  fireEvent.click(screen.getByRole('radio', { name: new RegExp(`^${view}`) }));

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
  it('默认展示「固定发布」块：五张固定服务卡片；两块互斥（未见自建发布内容）', async () => {
    render(<MCPPublish ontologyId={1} />);
    await waitFor(() => expect(api.listPublished).toHaveBeenCalled());

    // 卡片标题在「顶部说明」里也可能被提及（如「本体查询 MCP 服务」），故按出现次数断言
    for (const title of ['本体查询 MCP 服务', '公共函数 MCP 服务', '本体函数执行服务', '数据引擎执行服务', '业务系统 MCP']) {
      expect(screen.getAllByText(title).length).toBeGreaterThan(0);
    }
    // 固定块不渲染自建发布：空态与新建入口都不在
    expect(screen.queryByText(/还没有自建发布/)).toBeNull();
    expect(screen.queryByRole('button', { name: /新建发布/ })).toBeNull();
    // 刷新只在区块右上角一个（5 张卡片不再各带一个刷新按钮），与自建发布同构。
    // 名字用非锚定正则：antd 对「两个汉字」按钮会插空格，loading 时还会带上图标名，故只匹配关键字
    expect(screen.getAllByRole('button', { name: /刷\s*新/ })).toHaveLength(1);
  });

  it('切换到「自建发布」显示空态与新建入口', async () => {
    render(<MCPPublish ontologyId={1} />);
    await waitFor(() => expect(api.listPublished).toHaveBeenCalled());

    switchTo('自建发布');
    expect(await screen.findByText(/还没有自建发布/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /新建发布/ })).toBeTruthy();
    // 固定卡片已随视图隐藏
    expect(screen.queryByText('数据引擎执行服务')).toBeNull();
  });

  it('渲染自建发布卡片', async () => {
    vi.mocked(api.listPublished).mockResolvedValue({ services: [publishedSvc] } as any);
    render(<MCPPublish ontologyId={1} />);
    switchTo('自建发布');
    await waitFor(() => expect(screen.getByText('order-query')).toBeTruthy());
    expect(screen.getByRole('button', { name: '删 除' })).toBeTruthy();
  });

  it('自建发布「刷新」给出提示（与固定发布一致）；首屏自动加载保持静默', async () => {
    render(<MCPPublish ontologyId={1} />);
    switchTo('自建发布');
    await waitFor(() => expect(screen.getByRole('button', { name: /刷\s*新/ })).toBeTruthy());
    // 首屏自动加载不应弹「状态已刷新」（那是上一次刷新动作的扰动）
    expect(document.body.textContent).not.toContain('状态已刷新');

    vi.mocked(api.listPublished).mockClear();
    fireEvent.click(screen.getByRole('button', { name: /刷\s*新/ }));
    await waitFor(() => expect(api.listPublished).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(document.body.textContent).toContain('状态已刷新'));
  });

  it('自建发布「刷新」期间卡片状态位显示「检查中...」（与固定发布同一套反馈）', async () => {
    vi.mocked(api.listPublished).mockResolvedValue({ services: [publishedSvc] } as any);
    render(<MCPPublish ontologyId={1} />);
    switchTo('自建发布');
    await waitFor(() => expect(screen.getByText('order-query')).toBeTruthy());
    expect(screen.getByText('运行中')).toBeTruthy();

    // 把下一次读取挂起，观察刷新期间的中间态
    let resolveList: (v: any) => void = () => {};
    vi.mocked(api.listPublished).mockReturnValue(new Promise(res => { resolveList = res; }) as any);
    fireEvent.click(screen.getByRole('button', { name: /刷\s*新/ }));

    await waitFor(() => expect(screen.getByText('检查中...')).toBeTruthy());
    resolveList({ services: [publishedSvc] });
    await waitFor(() => expect(screen.getByText('运行中')).toBeTruthy());
  });

  it('自建发布超过 6 个时分页：首页仅 6 张卡片', async () => {
    const many = Array.from({ length: 7 }, (_, i) => ({ ...publishedSvc, name: `svc-${i + 1}` }));
    vi.mocked(api.listPublished).mockResolvedValue({ services: many } as any);
    render(<MCPPublish ontologyId={1} />);
    switchTo('自建发布');

    await waitFor(() => expect(screen.getByText('svc-6')).toBeTruthy());
    expect(screen.queryByText('svc-7')).toBeNull();   // 第 7 个在第 2 页
  });

  it('自建发布「查看配置」给出两段片段：宿主地址（外部客户端）+ 容器内地址（平台 Agent）', async () => {
    vi.mocked(api.listPublished).mockResolvedValue({ services: [publishedSvc] } as any);
    vi.mocked(api.getPublishedClientConfig).mockResolvedValue({
      mcpServers: { 'order-query': { type: 'http', url: 'http://h:8030/mcp', headers: { 'X-MCP-Token': 'tk' } } },
      internal_mcpServers: {
        'order-query': { type: 'http', url: 'http://optonto-mcp-publish-x:8100/mcp', headers: { 'X-MCP-Token': 'tk' } },
      },
    } as any);
    render(<MCPPublish ontologyId={1} />);
    switchTo('自建发布');
    await waitFor(() => expect(screen.getByText('order-query')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: '查看配置' }));
    await waitFor(() => expect(screen.getByText(/本平台 Agent（容器内地址/)).toBeTruthy());
    expect(screen.getByText(/h:8030\/mcp/)).toBeTruthy();
    expect(screen.getByText(/optonto-mcp-publish-x:8100\/mcp/)).toBeTruthy();
  });

  it('自建发布「查看工具」：弹窗列出快照工具并标注快照语义', async () => {
    vi.mocked(api.listPublished).mockResolvedValue({ services: [publishedSvc] } as any);
    vi.mocked(api.getPublishedTools).mockResolvedValue({
      name: 'order-query', kind: 'behavior', ontology_name: '订单排程',
      tools: [{ name: 'QueryOrder', description: '查询订单', inputSchema: { type: 'object', properties: {} } }],
    } as any);
    render(<MCPPublish ontologyId={1} />);
    switchTo('自建发布');
    await waitFor(() => expect(screen.getByText('order-query')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: '查看工具' }));
    await waitFor(() => expect(screen.getByText('QueryOrder')).toBeTruthy());
    // 卡片上本来就有「工具清单为发布时快照」，弹窗里还应有完整说明
    expect(screen.getAllByText(/发布时快照/).length).toBeGreaterThanOrEqual(2);
    expect(api.getPublishedTools).toHaveBeenCalledWith('order-query');
  });

  it('自建发布「查看工具」失败：提示原因且不打开空清单', async () => {
    vi.mocked(api.listPublished).mockResolvedValue({ services: [publishedSvc] } as any);
    vi.mocked(api.getPublishedTools).mockRejectedValue(new Error('不存在'));
    render(<MCPPublish ontologyId={1} />);
    switchTo('自建发布');
    await waitFor(() => expect(screen.getByText('order-query')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: '查看工具' }));
    // 失败以错误提示呈现；不得把“找不到”显示成“0 个工具”
    await waitFor(() => expect(document.body.textContent).toContain('读取「order-query」工具清单失败'));
    // 弹窗根本不该打开（否则“找不到”会被误读成“0 个工具”）
    expect(screen.queryByText('0 个工具（发布时未勾选任何工具）')).toBeNull();
    expect(screen.queryByText(/工具列表/)).toBeNull();
  });

  it('新建表单的类型/传输模式选项来自后端 /meta（不在前端硬编码）', async () => {
    vi.mocked(api.getPublishMeta).mockResolvedValue({
      kinds: ['behavior'], transports: ['sse'], host_port_min: 8020, host_port_max: 8099,
    } as any);
    render(<MCPPublish ontologyId={1} />);
    switchTo('自建发布');
    fireEvent.click(screen.getByRole('button', { name: /新建发布/ }));
    await waitFor(() => expect(screen.getByText('新建 MCP 发布')).toBeTruthy());

    // 只渲染后端下发的类型；并把当前选择收敛到合法值
    await waitFor(() => expect(screen.getByText(/勾选本体行为/)).toBeTruthy());
    expect(screen.queryByText('本体函数')).toBeNull();
    expect(screen.getByText('sse（/sse + /messages/）')).toBeTruthy();
  });

  it('打开新建弹窗时拉取本体函数/行为/数据引擎（就绪判据的唯一数据源）', async () => {
    render(<MCPPublish ontologyId={1} />);
    switchTo('自建发布');
    fireEvent.click(screen.getByRole('button', { name: /新建发布/ }));
    await waitFor(() => expect(screen.getByText('新建 MCP 发布')).toBeTruthy());

    await waitFor(() => expect(api.getFunctions).toHaveBeenCalledWith(1));
    expect(api.getBehaviors).toHaveBeenCalledWith(1);
    expect(api.getDataEngines).toHaveBeenCalledWith(1);
    expect(api.getPublishMeta).toHaveBeenCalled();
  });
});
