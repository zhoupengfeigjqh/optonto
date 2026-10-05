/** 配置片段弹窗单测：主片段 + 附加片段（自建发布的「容器内地址」）各自可复制。 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConfigModalView } from './PublishModals';

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
