/** 粘贴配置弹窗单测：输入透传、错误展示、重开清空。 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PasteConfigModal } from './PasteConfigModal';

const setup = (props: Partial<Parameters<typeof PasteConfigModal>[0]> = {}) => {
  const onImport = vi.fn();
  const onCancel = vi.fn();
  render(
    <PasteConfigModal open error={null} onCancel={onCancel} onImport={onImport} {...props} />,
  );
  return { onImport, onCancel };
};

describe('PasteConfigModal', () => {
  it('把粘贴文本原样交给容器解析（解析唯一实现不在本组件）', () => {
    const { onImport } = setup();
    const textarea = screen.getByPlaceholderText(/mcpServers/);
    fireEvent.change(textarea, { target: { value: '{"mcpServers":{}}' } });
    fireEvent.click(screen.getByRole('button', { name: /导\s*入/ }));
    expect(onImport).toHaveBeenCalledWith('{"mcpServers":{}}');
  });

  it('回灌的解析错误就地展示', () => {
    setup({ error: '配置片段缺少 url' });
    expect(screen.getByText('配置片段缺少 url')).toBeTruthy();
  });

  it('每次打开清空上次残留片段', () => {
    const { rerender } = render(
      <PasteConfigModal open error={null} onCancel={vi.fn()} onImport={vi.fn()} />,
    );
    fireEvent.change(screen.getByPlaceholderText(/mcpServers/), { target: { value: 'old' } });
    expect((screen.getByPlaceholderText(/mcpServers/) as HTMLTextAreaElement).value).toBe('old');

    rerender(<PasteConfigModal open={false} error={null} onCancel={vi.fn()} onImport={vi.fn()} />);
    rerender(<PasteConfigModal open error={null} onCancel={vi.fn()} onImport={vi.fn()} />);
    expect((screen.getByPlaceholderText(/mcpServers/) as HTMLTextAreaElement).value).toBe('');
  });

  it('取消不触发导入', () => {
    const { onImport, onCancel } = setup();
    fireEvent.click(screen.getByRole('button', { name: /取\s*消/ }));
    expect(onCancel).toHaveBeenCalled();
    expect(onImport).not.toHaveBeenCalled();
  });
});
