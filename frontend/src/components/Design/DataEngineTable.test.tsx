/**
 * DataEngineTable 单测（章程 III：属性传递 / 事件触发 / 边界条件）。
 *
 * 该组件拆分后只做「加载 + 编排 + 表格」，因此测试聚焦：
 * 表格内容与按钮态由数据决定、点击各按钮打开对应弹窗、加载失败与空数据、
 * 无目标结构时智能动作按钮禁用、非映射页签不触发加载。
 *
 * 依赖 API 一律打桩（章程：测试禁止真实网络）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';

vi.mock('@/api/client', () => ({
  getDataEngines: vi.fn(),
  createDataEngine: vi.fn(),
  updateDataEngine: vi.fn(),
  analyzeMapping: vi.fn(),
  callBehavior: vi.fn(),
  smartAlign: vi.fn(),
  getBehaviors: vi.fn(),
  updateBehavior: vi.fn(),
}));
vi.mock('@/api/agent-client', () => ({
  getMCPConfig: vi.fn(),
  listMCPTools: vi.fn(),
  callMCPTool: vi.fn(),
}));
// JsonEditor（CodeMirror）在 jsdom 下无意义，替换为 textarea 探针，便于注入非法 JSON
vi.mock('@/components/JsonEditor', () => ({
  default: ({ value, onChange }: any) => (
    <textarea data-testid="json-editor" value={value} onChange={e => onChange(e.target.value)} />
  ),
}));

import DataEngineTable from './DataEngineTable';
import * as api from '@/api/client';
import * as agentApi from '@/api/agent-client';

// 本文件要渲染 antd Table 并反复开合多个 Modal/Select，是全套里最重的文件（单跑约 3 分钟、
// 并发下更久）。给本文件单独放宽超时，避免被其他文件抢占 CPU 时误报超时。
vi.setConfig({ testTimeout: 60000, hookTimeout: 60000 });

const behaviors = [
  { name: 'QueryInventory', display_name: '查询库存', params: { 原材料编号: { type: 'string', display_name: '原材料编号' } }, response: {} },
  { name: 'CreatePurchaseRecord', display_name: '', params: {}, response: {} },
];

const engines = [
  {
    name: 'QueryInventory', behavior_name: 'QueryInventory', display_name: '',
    target: { server_url: 'http://biz:8004/mcp', tool_name: 'query_inventories', params: { q: { type: 'string' } }, response: {} },
    input_mapping: { 原材料编号: 'rawMaterialId', 数量: 'qty' },
    output_mapping: {},
  },
];

function mockLoaded() {
  vi.mocked(api.getBehaviors).mockResolvedValue(behaviors as any);
  vi.mocked(api.getDataEngines).mockResolvedValue(engines as any);
  vi.mocked(agentApi.getMCPConfig).mockResolvedValue({ servers: [] } as any);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DataEngineTable — 属性传递', () => {
  it('按行为渲染表格行，显示名缺失时回退英文名', async () => {
    mockLoaded();
    render(<DataEngineTable ontologyId={1} activeTab="api-mapping" />);
    expect(await screen.findByText('查询库存')).toBeInTheDocument();
    expect(screen.getByText('CreatePurchaseRecord')).toBeInTheDocument();
  });

  it('已配置目标接口时按钮显示「已设置」，未配置显示「编辑」', async () => {
    mockLoaded();
    render(<DataEngineTable ontologyId={1} activeTab="api-mapping" />);
    await screen.findByText('查询库存');
    expect(screen.getAllByText('已设置').length).toBe(1);
    expect(screen.getAllByText('编辑').length).toBeGreaterThan(0);
  });

  it('输入映射已填充 2 条时按钮显示「已映射2」', async () => {
    mockLoaded();
    render(<DataEngineTable ontologyId={1} activeTab="api-mapping" />);
    expect(await screen.findByText('已映射2')).toBeInTheDocument();
  });

  it('有目标结构时智能对齐/智能映射可用，无结构时禁用', async () => {
    mockLoaded();
    render(<DataEngineTable ontologyId={1} activeTab="api-mapping" />);
    await screen.findByText('查询库存');
    const smartAlignBtns = screen.getAllByRole('button', { name: '智能对齐' });
    expect(smartAlignBtns[0]).toBeEnabled();   // QueryInventory 有 target.params
    expect(smartAlignBtns[1]).toBeDisabled();  // CreatePurchaseRecord 无结构
  });
});

describe('DataEngineTable — 事件触发', () => {
  it('点击目标接口设置打开目标配置弹窗', async () => {
    mockLoaded();
    render(<DataEngineTable ontologyId={1} activeTab="api-mapping" />);
    await screen.findByText('查询库存');
    fireEvent.click(screen.getAllByRole('button', { name: /已设置/ })[0]);
    expect(await screen.findByText(/目标接口设置 - 查询库存/)).toBeInTheDocument();
  });

  it('点击输入映射打开映射弹窗并带入本体字段', async () => {
    mockLoaded();
    render(<DataEngineTable ontologyId={1} activeTab="api-mapping" />);
    await screen.findByText('查询库存');
    fireEvent.click(screen.getByText('已映射2'));
    expect(await screen.findByText(/输入映射 - 查询库存/)).toBeInTheDocument();
    expect(screen.getByText('本体字段')).toBeInTheDocument();
  });

  it('点击智能映射打开确认弹窗（不直接调接口）', async () => {
    mockLoaded();
    render(<DataEngineTable ontologyId={1} activeTab="api-mapping" />);
    await screen.findByText('查询库存');
    fireEvent.click(screen.getAllByRole('button', { name: '智能映射' })[0]);
    expect(await screen.findByText(/智能映射 - 查询库存/)).toBeInTheDocument();
    expect(vi.mocked(api.analyzeMapping)).not.toHaveBeenCalled();
  });

  it('点击连接测试打开连接测试弹窗', async () => {
    mockLoaded();
    render(<DataEngineTable ontologyId={1} activeTab="api-mapping" />);
    await screen.findByText('查询库存');
    fireEvent.click(screen.getAllByRole('button', { name: /连接测试/ })[0]);
    expect(await screen.findByText(/连接测试 - 查询库存/)).toBeInTheDocument();
  });
});

describe('DataEngineTable — 边界条件', () => {
  it('无行为时不渲染数据行', async () => {
    vi.mocked(api.getBehaviors).mockResolvedValue([]);
    vi.mocked(api.getDataEngines).mockResolvedValue([]);
    render(<DataEngineTable ontologyId={1} activeTab="api-mapping" />);
    await waitFor(() => expect(vi.mocked(api.getBehaviors)).toHaveBeenCalled());
    expect(document.querySelectorAll('.ant-table-row').length).toBe(0);
  });

  it('非映射页签不触发加载', async () => {
    render(<DataEngineTable ontologyId={1} activeTab="concepts" />);
    await waitFor(() => expect(document.querySelector('.ant-table')).toBeTruthy());
    expect(vi.mocked(api.getBehaviors)).not.toHaveBeenCalled();
  });

  it('加载失败给出错误提示且不抛错', async () => {
    vi.mocked(api.getBehaviors).mockRejectedValue(new Error('后端不可达'));
    vi.mocked(api.getDataEngines).mockRejectedValue(new Error('后端不可达'));
    render(<DataEngineTable ontologyId={1} activeTab="data-engines" />);
    expect(await screen.findByText(/加载失败: 后端不可达/)).toBeInTheDocument();
  });

  it('activeTab 为 data-engines 时同样加载（两个页签共用同一数据）', async () => {
    mockLoaded();
    render(<DataEngineTable ontologyId={1} activeTab="data-engines" />);
    await waitFor(() => expect(vi.mocked(api.getDataEngines)).toHaveBeenCalledWith(1));
  });
});

// ─── 各操作链路的处理器（覆盖编排逻辑，含已有引擎与需新建引擎两条路径）────────

describe('DataEngineTable — 智能对齐 / 智能映射', () => {
  it('确认智能对齐后调用对齐接口并刷新列表', async () => {
    mockLoaded();
    vi.mocked(api.smartAlign).mockResolvedValue({} as any);
    render(<DataEngineTable ontologyId={1} activeTab="api-mapping" />);
    await screen.findByText('查询库存');

    fireEvent.click(screen.getAllByRole('button', { name: '智能对齐' })[0]);
    fireEvent.click(await screen.findByRole('button', { name: '确认对齐' }));
    await waitFor(() => expect(vi.mocked(api.smartAlign)).toHaveBeenCalledWith(1, 'QueryInventory'));
    // 完成后重新拉取（load 被再次调用）
    await waitFor(() => expect(vi.mocked(api.getBehaviors).mock.calls.length).toBeGreaterThan(1));
  });

  it('智能对齐失败给出错误提示', async () => {
    mockLoaded();
    vi.mocked(api.smartAlign).mockRejectedValue(new Error('对齐服务异常'));
    render(<DataEngineTable ontologyId={1} activeTab="api-mapping" />);
    await screen.findByText('查询库存');

    fireEvent.click(screen.getAllByRole('button', { name: '智能对齐' })[0]);
    fireEvent.click(await screen.findByRole('button', { name: '确认对齐' }));
    expect(await screen.findByText(/智能对齐失败: 对齐服务异常/)).toBeInTheDocument();
  });

  it('确认智能映射后调用分析接口并展示结论弹窗', async () => {
    mockLoaded();
    vi.mocked(api.analyzeMapping).mockResolvedValue({ status: 'ok', message: '字段一一对应，可直接映射', issues: [] } as any);
    render(<DataEngineTable ontologyId={1} activeTab="api-mapping" />);
    await screen.findByText('查询库存');

    fireEvent.click(screen.getAllByRole('button', { name: '智能映射' })[0]);
    fireEvent.click(await screen.findByRole('button', { name: '确认映射' }));
    await waitFor(() => expect(vi.mocked(api.analyzeMapping)).toHaveBeenCalled());
    // 状态标签与结论文案分别断言（结论文案里若也含「可映射」会撞成多元素）
    expect(await screen.findByText('字段一一对应，可直接映射')).toBeInTheDocument();
    expect(screen.getByText('可映射')).toBeInTheDocument();
  });

  it('智能映射失败时把错误作为结论展示（不抛错）', async () => {
    mockLoaded();
    vi.mocked(api.analyzeMapping).mockRejectedValue(new Error('模型不可用'));
    render(<DataEngineTable ontologyId={1} activeTab="api-mapping" />);
    await screen.findByText('查询库存');

    fireEvent.click(screen.getAllByRole('button', { name: '智能映射' })[0]);
    fireEvent.click(await screen.findByRole('button', { name: '确认映射' }));
    expect(await screen.findByText('模型不可用')).toBeInTheDocument();
    expect(screen.getByText('不可映射')).toBeInTheDocument();
  });
});

describe('DataEngineTable — 映射保存 / 连接测试 / 行为编辑', () => {
  it('保存输入映射写回已有引擎', async () => {
    mockLoaded();
    vi.mocked(api.updateDataEngine).mockResolvedValue({} as any);
    render(<DataEngineTable ontologyId={1} activeTab="api-mapping" />);
    await screen.findByText('查询库存');

    fireEvent.click(screen.getByText('已映射2'));
    fireEvent.click(await screen.findByRole('button', { name: '保 存' }));
    await waitFor(() => expect(vi.mocked(api.updateDataEngine)).toHaveBeenCalledWith(1, 'QueryInventory', expect.objectContaining({ input_mapping: { 原材料编号: 'rawMaterialId', 数量: 'qty' } })));
  });

  it('保存输出映射：尚无引擎的行为走新建', async () => {
    mockLoaded();
    vi.mocked(api.createDataEngine).mockResolvedValue({} as any);
    render(<DataEngineTable ontologyId={1} activeTab="api-mapping" />);
    const row = (await screen.findByText('CreatePurchaseRecord')).closest('tr') as HTMLElement;

    // 按行定位：同一行里有「目标接口设置 / 输入映射 / 输出映射」三个「编辑」按钮，
    // 用索引猜会点错，必须限定在行内取第 3 个（输出映射）
    const buttons = within(row).getAllByRole('button').filter(b => (b.textContent || '').includes('编辑'));
    fireEvent.click(buttons[2]);
    fireEvent.click(await screen.findByRole('button', { name: '保 存' }));
    await waitFor(() => expect(vi.mocked(api.createDataEngine)).toHaveBeenCalledWith(1, expect.objectContaining({ behavior_name: 'CreatePurchaseRecord' })));
  });

  it('连接测试发送请求调用行为接口并展示响应', async () => {
    mockLoaded();
    vi.mocked(api.callBehavior).mockResolvedValue({ data: [{ stock: 35 }] } as any);
    render(<DataEngineTable ontologyId={1} activeTab="api-mapping" />);
    await screen.findByText('查询库存');

    fireEvent.click(screen.getAllByRole('button', { name: /连接测试/ })[0]);
    fireEvent.click(await screen.findByRole('button', { name: /发送请求/ }));
    await waitFor(() => expect(vi.mocked(api.callBehavior)).toHaveBeenCalledWith(1, 'QueryInventory', expect.any(Object)));
    expect(await screen.findByText(/stock/)).toBeInTheDocument();
  });

  it('连接测试失败时把错误渲染进结果区', async () => {
    mockLoaded();
    vi.mocked(api.callBehavior).mockRejectedValue(new Error('下游不可达'));
    render(<DataEngineTable ontologyId={1} activeTab="api-mapping" />);
    await screen.findByText('查询库存');

    fireEvent.click(screen.getAllByRole('button', { name: /连接测试/ })[0]);
    fireEvent.click(await screen.findByRole('button', { name: /发送请求/ }));
    expect(await screen.findByText('下游不可达')).toBeInTheDocument();
  });

  it('点击行为名打开编辑弹窗，保存后写回行为定义', async () => {
    mockLoaded();
    vi.mocked(api.updateBehavior).mockResolvedValue({} as any);
    render(<DataEngineTable ontologyId={1} activeTab="api-mapping" />);
    fireEvent.click(await screen.findByText('查询库存'));

    expect(await screen.findByText(/编辑行为参数 - 查询库存/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '保 存' }));
    await waitFor(() => expect(vi.mocked(api.updateBehavior)).toHaveBeenCalledWith(1, 'QueryInventory', expect.objectContaining({ params: expect.any(Object) })));
  });

  it('行为编辑时 JSON 非法则拦截并提示', async () => {
    mockLoaded();
    render(<DataEngineTable ontologyId={1} activeTab="api-mapping" />);
    fireEvent.click(await screen.findByText('查询库存'));
    await screen.findByText(/编辑行为参数 - 查询库存/);

    const editors = screen.getAllByTestId('json-editor') as HTMLTextAreaElement[];
    fireEvent.change(editors[0], { target: { value: '{oops' } });
    fireEvent.click(screen.getByRole('button', { name: '保 存' }));
    expect(await screen.findByText(/参数 JSON 格式错误/)).toBeInTheDocument();
    expect(vi.mocked(api.updateBehavior)).not.toHaveBeenCalled();
  });
});
