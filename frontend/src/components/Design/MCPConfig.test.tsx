/**
 * 「MCP 配置」页关键链路单测（自建发布令牌的录入闭环）：
 *  - 粘贴「查看配置」片段 → 落库时带上 X-MCP-Token 请求头；
 *  - 手工新增时请求头非法 JSON → 拦住保存（不静默丢令牌）；
 *  - 「选择工具」探针必须带 headers（否则带令牌的服务永远 401）；
 *  - 内置固定项只读；令牌在列表里只出现掩码，不得明文。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/api/agent-client', () => ({
  getMCPConfig: vi.fn(),
  saveMCPConfig: vi.fn(),
  testMCPConnection: vi.fn(),
}));

import MCPConfigPanel from './MCPConfig';
import * as agentApi from '@/api/agent-client';

const PUBLISH_TOKEN = '6UuE8_4nY683gZ13rNQbHDCfxgMgEF3Z';

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(agentApi.getMCPConfig).mockResolvedValue({ servers: [] } as any);
  vi.mocked(agentApi.saveMCPConfig).mockResolvedValue({ message: 'ok' } as any);
  vi.mocked(agentApi.testMCPConnection).mockResolvedValue({ success: true, tools: [] } as any);
});

/** 渲染并等待配置加载完成（加载期间组件只渲染 Spin，按钮还没挂上） */
const renderPanel = async () => {
  const utils = render(<MCPConfigPanel />);
  await waitFor(() => expect(screen.getByRole('button', { name: /粘贴配置/ })).toBeTruthy());
  return utils;
};

describe('MCPConfigPanel', () => {
  it('粘贴自建发布片段 → 保存时带上 X-MCP-Token 请求头', async () => {
    await renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /粘贴配置/ }));

    const snippet = JSON.stringify({
      mcpServers: {
        svc_function: {
          type: 'url',
          url: 'http://192.168.1.9:8021/mcp',
          headers: { 'X-MCP-Token': PUBLISH_TOKEN },
        },
      },
    });
    fireEvent.change(screen.getByPlaceholderText(/mcpServers/), { target: { value: snippet } });
    fireEvent.click(screen.getByRole('button', { name: /导\s*入/ }));

    await waitFor(() => expect(agentApi.saveMCPConfig).toHaveBeenCalledTimes(1));
    const saved = vi.mocked(agentApi.saveMCPConfig).mock.calls[0][0];
    expect(saved.servers).toEqual([
      {
        name: 'svc_function',
        url: 'http://192.168.1.9:8021/mcp',
        headers: { 'X-MCP-Token': PUBLISH_TOKEN },
        enabled: true,
      },
    ]);
  });

  it('片段非法 → 不保存，错误就地显示', async () => {
    await renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /粘贴配置/ }));
    fireEvent.change(screen.getByPlaceholderText(/mcpServers/), { target: { value: '{"mcpServers":{}}' } });
    fireEvent.click(screen.getByRole('button', { name: /导\s*入/ }));

    expect(await screen.findByText(/没有 mcpServers 条目/)).toBeTruthy();
    expect(agentApi.saveMCPConfig).not.toHaveBeenCalled();
  });

  it('同名服务已存在时不覆盖（提示改走编辑）', async () => {
    vi.mocked(agentApi.getMCPConfig).mockResolvedValue({
      servers: [{ name: 'svc_function', url: 'http://old:8021/mcp', enabled: true }],
    } as any);
    await renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /粘贴配置/ }));
    fireEvent.change(screen.getByPlaceholderText(/mcpServers/), {
      target: { value: '{"mcpServers":{"svc_function":{"url":"http://new:8021/mcp"}}}' },
    });
    fireEvent.click(screen.getByRole('button', { name: /导\s*入/ }));

    expect(await screen.findByText(/已存在/)).toBeTruthy();
    expect(agentApi.saveMCPConfig).not.toHaveBeenCalled();
  });

  it('手工新增：请求头非法 JSON → 拦住保存', async () => {
    const { container } = await renderPanel();
    fireEvent.click(screen.getByRole('button', { name: /新增 MCP 服务/ }));

    fireEvent.change(screen.getByPlaceholderText('服务名称'), { target: { value: 'svc_manual' } });
    fireEvent.change(screen.getByPlaceholderText('http://example.com/mcp'), { target: { value: 'http://h:8022/mcp' } });
    fireEvent.change(screen.getByPlaceholderText(/\{"X-MCP-Token"/), { target: { value: 'not-json' } });
    fireEvent.click(container.querySelector('.anticon-check')!.closest('button')!);

    // 解析在 await 之前同步失败 → 不会进入 persistConfig
    expect(agentApi.saveMCPConfig).not.toHaveBeenCalled();
  });

  it('编辑行可切换「业务数据」，保存载荷带上 business_data（缺省为否）', async () => {
    vi.mocked(agentApi.getMCPConfig).mockResolvedValue({
      servers: [{ name: '业务系统', url: 'http://biz:8004/mcp', enabled: true, business_data: false }],
    } as any);
    const { container } = await renderPanel();
    await waitFor(() => expect(screen.getByText('业务系统')).toBeTruthy());
    expect(screen.getByText('否')).toBeTruthy();      // 列表先显示「否」

    fireEvent.click(screen.getByRole('button', { name: /编\s*辑/ }));
    // 编辑态里该行只剩「业务数据」这一个开关（操作列换成确认/取消）
    fireEvent.click(container.querySelector('.ant-switch')!);
    fireEvent.click(container.querySelector('.anticon-check')!.closest('button')!);

    await waitFor(() => expect(agentApi.saveMCPConfig).toHaveBeenCalledTimes(1));
    const saved = vi.mocked(agentApi.saveMCPConfig).mock.calls[0][0];
    expect(saved.servers[0]).toMatchObject({ name: '业务系统', business_data: true });
    expect(saved.servers[0].headers).toBeUndefined();
  });

  it('内置固定项的「业务数据」列显示「—」（不作映射目标）', async () => {
    vi.mocked(agentApi.getMCPConfig).mockResolvedValue({
      servers: [{ name: '本体查询MCP', url: 'http://optonto-ontology-query-mcp:8002/mcp', enabled: true, builtin: true }],
    } as any);
    await renderPanel();
    await waitFor(() => expect(screen.getByText('本体查询MCP')).toBeTruthy());
    // 按行断言：该行「业务数据」单元格是「—」，且不出现「否」
    const row = screen.getByText('本体查询MCP').closest('tr')!;
    expect(row.textContent).toContain('—');
    expect(row.textContent).not.toContain('否');
  });

  it('「选择工具」探针带上该条目的请求头；令牌在列表里只显示掩码', async () => {
    vi.mocked(agentApi.getMCPConfig).mockResolvedValue({
      servers: [
        { name: '本体查询MCP', url: 'http://optonto-ontology-query-mcp:8002/mcp', enabled: true, builtin: true },
        { name: 'publish-svc', url: 'http://h:8021/mcp', enabled: true, headers: { 'X-MCP-Token': PUBLISH_TOKEN } },
      ],
    } as any);
    await renderPanel();
    await waitFor(() => expect(screen.getByText('publish-svc')).toBeTruthy());

    // 内置固定项只读；令牌掩码展示、明文不出现
    expect(screen.getAllByText('默认配置')).toHaveLength(1);
    expect(screen.getByText('已带令牌')).toBeTruthy();
    expect(screen.getByText(/6UuE…3Z/)).toBeTruthy();
    expect(screen.queryByText(new RegExp(PUBLISH_TOKEN))).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /选\s*择/ }));
    await waitFor(() => expect(agentApi.testMCPConnection)
      .toHaveBeenCalledWith('http://h:8021/mcp', { 'X-MCP-Token': PUBLISH_TOKEN }));
  });
});
