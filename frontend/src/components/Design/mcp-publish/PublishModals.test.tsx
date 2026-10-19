/** 配置片段弹窗单测：主片段 + 附加片段（自建发布的「容器内地址」）各自可复制。 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConfigModalView, ToolsModal } from './PublishModals';

const MAIN = '{"mcpServers":{"s":{"url":"http://host:8021/mcp"}}}';
const INNER = '{"mcpServers":{"s":{"url":"http://container:8100/mcp"}}}';

describe('ConfigModalView', () => {
  it('渲染主片段与附加片段，两段各有独立复制按钮', () => {
    render(
      <ConfigModalView
        data={{
          title: '自建发布「s」客户端配置',
          json: MAIN,
          note: '第一段给平台外的 AI 客户端',
          extra: [{ label: '本平台 Agent（容器内地址，粘进「MCP 配置」）', json: INNER }],
        }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/第一段给平台外/)).toBeTruthy();
    expect(screen.getByText(/本平台 Agent（容器内地址/)).toBeTruthy();
    expect(screen.getByText(/host:8021/)).toBeTruthy();
    expect(screen.getByText(/container:8100/)).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /复\s*制/ })).toHaveLength(2);
  });

  it('没有附加片段时只有一个复制按钮（固定服务配置片段不受影响）', () => {
    render(<ConfigModalView data={{ title: 't', json: MAIN }} onClose={vi.fn()} />);
    expect(screen.getAllByRole('button', { name: /复\s*制/ })).toHaveLength(1);
  });

  it('data 为空即关闭（不渲染内容）', () => {
    render(<ConfigModalView data={null} onClose={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /复\s*制/ })).toBeNull();
  });

  it('复制按钮写入剪贴板', () => {
    const writeText = vi.fn();
    Object.assign(navigator, { clipboard: { writeText } });
    render(<ConfigModalView data={{ title: 't', json: MAIN }} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /复\s*制/ }));
    expect(writeText).toHaveBeenCalledWith(MAIN);
  });
});

describe('ToolsModal', () => {
  const tool = { name: 'QueryOrder', description: '查询订单' };

  it('带 note（自建发布）时显示快照说明，并列出工具', () => {
    render(
      <ToolsModal
        data={{ title: '自建发布「order-query」', tools: [tool], note: '工具清单为发布时快照，修改本体后需重新发布才会更新（停机也可查看）。' }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/发布时快照/)).toBeTruthy();
    expect(screen.getByText('QueryOrder')).toBeTruthy();
    expect(screen.getByText('查询订单')).toBeTruthy();
  });

  it('0 个工具时给出明确空态（不是含糊的「暂无工具信息」）', () => {
    render(
      <ToolsModal
        data={{ title: '自建发布「empty」', tools: [], note: '工具清单为发布时快照。' }}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText('0 个工具（发布时未勾选任何工具）')).toBeTruthy();
    expect(screen.queryByText('暂无工具信息')).toBeNull();
  });

  it('固定服务（无 note）保持原有「暂无工具信息」口径', () => {
    render(<ToolsModal data={{ title: '本体查询 MCP 服务', tools: [] }} onClose={vi.fn()} />);
    expect(screen.getByText('暂无工具信息')).toBeTruthy();
  });

  it('切换服务后收起上一次的展开项（不残留上一个服务的参数）', () => {
    const withParams = {
      name: 'QueryOrder', description: '查询订单',
      inputSchema: { type: 'object', properties: { orderNo: { type: 'string', description: '订单号' } }, required: ['orderNo'] },
    };
    const { rerender } = render(<ToolsModal data={{ title: 'A', tools: [withParams] }} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /QueryOrder 工具详情/ }));
    expect(screen.getByText('orderNo')).toBeTruthy();

    // 换一个服务、同名工具：弹窗组件被复用，展开态必须重置
    rerender(<ToolsModal data={{ title: 'B', tools: [withParams], note: '工具清单为发布时快照。' }} onClose={vi.fn()} />);
    expect(screen.queryByText('orderNo')).toBeNull();
  });
});
