/**
 * TargetConfigModal 单测（章程 III：属性传递 / 事件触发 / 边界条件）。
 *
 * 该组件是拆分中「把状态收进组件」的代表：自持表单状态并自己拉取 MCP 服务/工具清单，
 * 对外只暴露 initialTarget + onSave。测试因此聚焦：
 * 回显初值（含旧 HTTP 配置的迁移告警）、服务→工具联动、选中工具后 schema 自动提取、
 * 试调提取的样例参数、保存时的载荷组装、未选齐/JSON 非法时的拦截。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/components/JsonEditor', () => ({
  default: ({ value, onChange }: any) => (
    <textarea data-testid="json-editor" value={value} onChange={e => onChange(e.target.value)} />
  ),
}));
vi.mock('@/api/agent-client', () => ({
  getMCPConfig: vi.fn(),
  listMCPTools: vi.fn(),
  callMCPTool: vi.fn(),
}));

import TargetConfigModal from './TargetConfigModal';
import * as agentApi from '@/api/agent-client';
import { selectOption, openSelect, optionTexts, clickOption } from '@/test/antd';
import { emptyTarget } from './data-engine-helpers';

const servers = [
  { name: '业务系统', url: 'http://biz:8004/mcp', enabled: true, builtin: false, headers: { Authorization: 'Bearer x' } },
  { name: '内置服务', url: 'http://builtin:9000/mcp', enabled: true, builtin: true },
  { name: '已停用服务', url: 'http://off:9000/mcp', enabled: false, builtin: false },
];

const tools = [
  {
    name: 'query_inventories', description: '查询库存',
    inputSchema: { type: 'object', required: ['rawMaterialId'], properties: { rawMaterialId: { type: 'string' } } },
    outputSchema: { type: 'object', properties: { data: { type: 'array' } } },
  },
  { name: 'create_purchase_record', description: '创建采购单', inputSchema: { type: 'object', properties: { qty: { type: 'integer' } } } },
];

function setup(overrides: Record<string, unknown> = {}) {
  // serversList 是本测试的注入点：setup 内部会设置 getMCPConfig 桩，
  // 用例若想换服务清单必须从这里传，否则会被 setup 覆盖。
  const { serversList = servers, ...rest } = overrides as { serversList?: unknown[] };
  vi.mocked(agentApi.getMCPConfig).mockResolvedValue({ servers: serversList } as any);
  vi.mocked(agentApi.listMCPTools).mockResolvedValue({ success: true, tools } as any);
  const props = {
    open: true,
    behaviorLabel: '查询库存',
    initialTarget: { ...emptyTarget },
    onCancel: vi.fn(),
    onSave: vi.fn().mockResolvedValue(undefined),
    ...rest,
  };
  render(<TargetConfigModal {...(props as any)} />);
  return props;
}

/** 选服务 → 选工具的常用前置动作 */
async function pickServerAndTool(toolName = 'query_inventories') {
  await waitFor(() => expect(vi.mocked(agentApi.getMCPConfig)).toHaveBeenCalled());
  selectOption('业务系统', 0);
  await waitFor(() => expect(vi.mocked(agentApi.listMCPTools)).toHaveBeenCalledWith('http://biz:8004/mcp', { Authorization: 'Bearer x' }));
  // 工具清单是异步回填的：反复展开工具下拉直到目标工具出现
  await waitFor(() => {
    openSelect(1);
    expect(optionTexts().join(' ')).toContain(toolName);
  });
  clickOption(toolName);
}

/**
 * 最上层可见弹窗里的编辑器。
 * 参数/输出结构编辑器位于**嵌套弹窗**内（默认不渲染），必须先打开对应弹窗；
 * 且 antd 关闭弹窗后仍留在 DOM 里，所以要按「最上层可见 wrap」取，避免拿到隐藏的那份。
 */
function visibleEditors(): HTMLTextAreaElement[] {
  const wraps = Array.from(document.querySelectorAll('.ant-modal-wrap'))
    .filter(w => (w as HTMLElement).style.display !== 'none');
  const top = wraps[wraps.length - 1] as HTMLElement | undefined;
  return Array.from(top?.querySelectorAll('[data-testid="json-editor"]') ?? []) as HTMLTextAreaElement[];
}

/**
 * 打开「编辑输入参数 / 编辑输出结构」嵌套弹窗并返回其编辑器。
 * 按钮名用正则：这些按钮带图标，antd 图标会贡献 aria-label（如 "code"），
 * 使可访问名变成 "code 编辑输入" 而非 "编辑输入"。
 */
function openEditor(which: '输入' | '输出'): HTMLTextAreaElement {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`编辑${which}`) }));
  const editors = visibleEditors();
  expect(editors.length).toBe(1);
  return editors[0];
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TargetConfigModal — 属性传递', () => {
  it('标题带行为展示名', () => {
    setup();
    expect(screen.getByText(/目标接口设置 - 查询库存/)).toBeInTheDocument();
  });

  it('服务下拉只列出手工（非内置）且启用的服务', async () => {
    setup();
    await waitFor(() => expect(vi.mocked(agentApi.getMCPConfig)).toHaveBeenCalled());
    openSelect(0);
    const texts = optionTexts().join(' | ');
    expect(texts).toContain('业务系统');
    expect(texts).not.toContain('内置服务');
    expect(texts).not.toContain('已停用服务');
  });

  it('回显初值：已配 server_url + tool_name 时拉取工具清单并选中', async () => {
    setup({
      initialTarget: { ...emptyTarget, server_url: 'http://biz:8004/mcp', tool_name: 'query_inventories' },
    });
    await waitFor(() => expect(vi.mocked(agentApi.listMCPTools)).toHaveBeenCalled());
    await waitFor(() => {
      const selected = Array.from(document.querySelectorAll('.ant-select-selection-item')).map(el => el.textContent || '');
      expect(selected.join(' ')).toContain('业务系统');
      expect(selected.join(' ')).toContain('query_inventories');
    });
  });

  it('旧 HTTP 配置（有 url 无 server_url）显示迁移告警', () => {
    setup({ initialTarget: { ...emptyTarget, url: 'http://legacy/api', method: 'POST' } });
    expect(screen.getByText(/仍是旧 HTTP 直连配置/)).toBeInTheDocument();
  });

  it('已是 MCP 配置时不显示迁移告警', () => {
    setup({ initialTarget: { ...emptyTarget, server_url: 'http://biz:8004/mcp', tool_name: 'query_inventories' } });
    expect(screen.queryByText(/仍是旧 HTTP 直连配置/)).not.toBeInTheDocument();
  });
});

describe('TargetConfigModal — 事件触发', () => {
  it('选中工具后自动提取输入 schema（含 required 标记）', async () => {
    setup();
    await pickServerAndTool();
    expect(openEditor('输入').value).toContain('rawMaterialId');
    expect(visibleEditors()[0].value).toContain('"required": true');
  });

  it('选中工具后自动提取输出 schema', async () => {
    setup();
    await pickServerAndTool();
    expect(openEditor('输出').value).toContain('"data"');
  });

  it('工具未声明 outputSchema 时输出重置为空对象', async () => {
    setup();
    await pickServerAndTool('create_purchase_record');
    expect(openEditor('输入').value).toContain('qty');
  });

  it('工具未声明 outputSchema 时输出保持空对象', async () => {
    setup();
    await pickServerAndTool('create_purchase_record');
    expect(openEditor('输出').value).toBe('{}');
  });

  it('选中工具时把服务名与工具名带入数据源/接口名称（仍可手改）', async () => {
    setup();
    await pickServerAndTool();
    const inputs = Array.from(document.querySelectorAll('input.ant-input')) as HTMLInputElement[];
    const values = inputs.map(i => i.value);
    expect(values).toContain('业务系统');
    expect(values).toContain('query_inventories');
  });

  it('保存时组装 MCP 形态的 target（清空 url/method、带上 headers 快照）', async () => {
    const props = setup();
    await pickServerAndTool();
    fireEvent.click(screen.getByRole('button', { name: '保 存' }));
    await waitFor(() => expect(props.onSave).toHaveBeenCalledTimes(1));
    const [target, server] = vi.mocked(props.onSave).mock.calls[0];
    expect(target).toMatchObject({
      server_url: 'http://biz:8004/mcp',
      tool_name: 'query_inventories',
      url: '',
      method: '',
      headers: { Authorization: 'Bearer x' },
    });
    expect(server).toMatchObject({ name: '业务系统' });
  });

  it('试调提取：按输入 schema 生成样例参数并打开试调弹窗', async () => {
    setup();
    await pickServerAndTool();
    fireEvent.click(screen.getByRole('button', { name: /试调提取/ }));
    expect(await screen.findByText(/试调提取 - query_inventories/)).toBeInTheDocument();
    expect(visibleEditors()[0].value).toContain('"rawMaterialId"');
  });

  it('试调成功时用响应样本反推输出结构', async () => {
    setup();
    vi.mocked(agentApi.callMCPTool).mockResolvedValue({ success: true, data: { data: [{ stock: 35 }] } } as any);
    await pickServerAndTool();
    fireEvent.click(screen.getByRole('button', { name: /试调提取/ }));
    await screen.findByText(/试调提取 - query_inventories/);
    fireEvent.click(screen.getByRole('button', { name: /发送试调/ }));
    await waitFor(() => expect(vi.mocked(agentApi.callMCPTool)).toHaveBeenCalledTimes(1));
    // 反推结果写回输出结构：打开输出编辑弹窗校验
    await waitFor(() => {
      fireEvent.click(screen.getByRole('button', { name: /编辑输出/ }));
      expect(visibleEditors()[0].value).toContain('stock');
    });
  });

  it('取消触发 onCancel', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: '取 消' }));
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });
});

describe('TargetConfigModal — 边界条件', () => {
  it('未选齐服务与工具时保存按钮禁用', async () => {
    setup();
    await waitFor(() => expect(vi.mocked(agentApi.getMCPConfig)).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: '保 存' })).toBeDisabled();
  });

  it('输入 JSON 非法时给出告警且不调用 onSave', async () => {
    const props = setup();
    await pickServerAndTool();
    fireEvent.change(openEditor('输入'), { target: { value: '{oops' } });
    fireEvent.click(screen.getAllByRole('button', { name: '确 认' })[0]);
    fireEvent.click(screen.getByRole('button', { name: '保 存' }));
    expect(await screen.findByText(/输入 JSON 格式无效/)).toBeInTheDocument();
    expect(props.onSave).not.toHaveBeenCalled();
  });

  it('读取 MCP 服务配置失败时告警且不崩溃', async () => {
    vi.mocked(agentApi.getMCPConfig).mockRejectedValue(new Error('配置服务不可达'));
    render(<TargetConfigModal open behaviorLabel="查询库存" initialTarget={{ ...emptyTarget }} onCancel={vi.fn()} onSave={vi.fn()} />);
    expect(await screen.findByText(/读取 MCP 服务配置失败/)).toBeInTheDocument();
  });

  it('切换服务时清空已选工具并重新拉取该服务的工具清单', async () => {
    setup({
      serversList: [...servers, { name: '服务B', url: 'http://b2:8004/mcp', enabled: true, builtin: false }],
    });
    await pickServerAndTool();
    expect(vi.mocked(agentApi.listMCPTools)).toHaveBeenCalledTimes(1);

    selectOption('服务B', 0);
    await waitFor(() => expect(vi.mocked(agentApi.listMCPTools)).toHaveBeenCalledWith('http://b2:8004/mcp', undefined));
    // 工具被清空 → 保存按钮重新禁用
    expect(screen.getByRole('button', { name: '保 存' })).toBeDisabled();
  });

  it('拉取工具清单失败时告警且不崩溃', async () => {
    setup();
    await waitFor(() => expect(vi.mocked(agentApi.getMCPConfig)).toHaveBeenCalled());
    // 覆盖桩要在 setup 之后（setup 会重置为成功桩），但要在选服务之前（选服务时才真正拉清单）
    vi.mocked(agentApi.listMCPTools).mockResolvedValue({ success: false, tools: [], error: '服务未响应' } as any);
    selectOption('业务系统', 0);
    expect(await screen.findByText(/拉取工具清单失败: 服务未响应/)).toBeInTheDocument();
  });

  it('试调失败时告警（工具返回 success=false）', async () => {
    setup();
    vi.mocked(agentApi.callMCPTool).mockResolvedValue({ success: false, error: '鉴权失败' } as any);
    await pickServerAndTool();
    fireEvent.click(screen.getByRole('button', { name: /试调提取/ }));
    await screen.findByText(/试调提取 - query_inventories/);
    fireEvent.click(screen.getByRole('button', { name: /发送试调/ }));
    expect(await screen.findByText(/试调失败: 鉴权失败/)).toBeInTheDocument();
  });
});
