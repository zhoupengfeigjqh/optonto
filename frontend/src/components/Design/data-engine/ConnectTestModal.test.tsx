/**
 * ConnectTestModal 单测（章程 III：属性传递 / 事件触发 / 边界条件）。
 *
 * 覆盖：目标接口两种展示形态（MCP / 旧 HTTP）、必填标记与参数展示名、
 * 按值形态选择输入控件、发送与关闭、引擎缺失与结果缺失时的空态。
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ConnectTestModal from './ConnectTestModal';
import type { DataEngine } from '@/api/client';

const mcpEngine = {
  name: 'QueryInventory', behavior_name: 'QueryInventory', display_name: '',
  target: { server_url: 'http://biz:8004/mcp', tool_name: 'query_inventories', params: {}, response: {} },
  input_mapping: {}, output_mapping: {},
} as unknown as DataEngine;

const legacyEngine = {
  name: 'Old', behavior_name: 'Old', display_name: '',
  target: { method: 'POST', url: 'http://legacy/api', params: {}, response: {} },
  input_mapping: {}, output_mapping: {},
} as unknown as DataEngine;

function setup(overrides: Record<string, unknown> = {}) {
  const props = {
    open: true,
    engine: mcpEngine,
    behaviorLabel: '查询库存',
    params: { 原材料编号: '' },
    required: { 原材料编号: true },
    result: null,
    loading: false,
    paramLabel: (k: string) => (k === '原材料编号' ? '原材料编号（中文名）' : k),
    onParamChange: vi.fn(),
    onSend: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<ConnectTestModal {...(props as any)} />);
  return props;
}

describe('ConnectTestModal — 属性传递', () => {
  it('标题带行为展示名', () => {
    setup();
    expect(screen.getByText('连接测试 - 查询库存')).toBeInTheDocument();
  });

  it('MCP 形态展示「MCP 工具名 @ 服务地址」', () => {
    setup();
    // 用正则：Testing Library 默认 normalizer 会把连续空格折叠为单个
    expect(screen.getByText(/MCP\s+query_inventories @ http:\/\/biz:8004\/mcp/)).toBeInTheDocument();
  });

  it('旧 HTTP 形态展示「方法 地址」', () => {
    setup({ engine: legacyEngine });
    expect(screen.getByText('POST http://legacy/api')).toBeInTheDocument();
  });

  it('必填参数加星号，并用 paramLabel 展示中文名', () => {
    setup();
    expect(screen.getByText('原材料编号（中文名）')).toBeInTheDocument();
    expect(screen.getByText('*')).toBeInTheDocument();
  });

  it('非必填参数不加星号', () => {
    setup({ required: { 原材料编号: false } });
    expect(screen.queryByText('*')).not.toBeInTheDocument();
  });

  it('响应结果有 error 字段时按错误色展示', () => {
    setup({ result: { error: '下游不可达' } });
    expect(screen.getByText('下游不可达')).toBeInTheDocument();
  });

  it('响应成功时展示 JSON 全文', () => {
    setup({ result: { data: [{ rawMaterialId: 'RM-001' }] } });
    expect(screen.getByText(/RM-001/)).toBeInTheDocument();
  });
});

describe('ConnectTestModal — 事件触发', () => {
  it('普通字符串参数用单行输入，改动回传参数名与新值', () => {
    const props = setup();
    const input = document.querySelector('input.ant-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'RM-002' } });
    expect(props.onParamChange).toHaveBeenCalledWith('原材料编号', 'RM-002');
  });

  it('JSON 形态参数用多行输入（对象以 { 开头）', () => {
    setup({ params: { 明细: '{"a":1}' } });
    expect(document.querySelector('textarea.ant-input')).toBeTruthy();
  });

  it('点击发送触发 onSend', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: /发送请求/ }));
    expect(props.onSend).toHaveBeenCalledTimes(1);
  });

  it('关闭弹窗触发 onClose', () => {
    const props = setup();
    fireEvent.click(document.querySelector('.ant-modal-close') as HTMLElement);
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('loading 时发送按钮进入加载态', () => {
    setup({ loading: true });
    expect(document.querySelector('.ant-btn-loading')).toBeTruthy();
  });
});

describe('ConnectTestModal — 边界条件', () => {
  it('engine 为 null 时不渲染内容（仅空壳弹窗）', () => {
    setup({ engine: null });
    expect(screen.queryByText(/目标接口：/)).not.toBeInTheDocument();
    expect(screen.queryByText(/发送请求/)).not.toBeInTheDocument();
  });

  it('无请求参数时不渲染「请求参数」区块', () => {
    setup({ params: {} });
    expect(screen.queryByText('请求参数')).not.toBeInTheDocument();
  });

  it('无响应结果时不渲染「响应结果」区块', () => {
    setup({ result: null });
    expect(screen.queryByText('响应结果')).not.toBeInTheDocument();
  });

  it('boolean 参数不渲染输入控件（避免用户改出非法值）', () => {
    setup({ params: { 是否加急: false } });
    expect(document.querySelectorAll('input.ant-input').length).toBe(0);
  });

  it('目标未配置时地址回退为 (未配置) 占位', () => {
    setup({ engine: { ...legacyEngine, target: { method: '', url: '', params: {}, response: {} } } });
    expect(screen.getByText(/\(未配置\)/)).toBeInTheDocument();
  });

  it('多行（JSON 形态）参数改动同样回传参数名与新值', () => {
    const props = setup({ params: { 明细: '{"a":1}' } });
    const textarea = document.querySelector('textarea.ant-input') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '{"a":2}' } });
    expect(props.onParamChange).toHaveBeenCalledWith('明细', '{"a":2}');
  });

  it('空白引擎对象下不渲染任何内容（防御空 target）', () => {
    setup({ engine: { ...legacyEngine, target: undefined } });
    expect(screen.getByText(/POST \(未配置\)/)).toBeInTheDocument();
  });
});
