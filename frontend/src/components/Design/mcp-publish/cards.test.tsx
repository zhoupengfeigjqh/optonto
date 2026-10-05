/** MCP发布卡片单测（章程 III：属性传递 / 事件触发 / 边界条件）。 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FixedServiceCard, PublishedServiceCard } from './cards';
import { FIXED_SERVICES, INIT } from './catalog';
import type { PublishedService } from '@/api/client';

const ontologyQuery = FIXED_SERVICES.find(d => d.key === 'ontologyQuery')!;

describe('FixedServiceCard', () => {
  it('渲染标题/运行态/端点，并按点击回调对应动作；刷新不在卡片上', () => {
    const onOpenConfig = vi.fn();
    const onToggle = vi.fn();
    const onShowTools = vi.fn();
    render(
      <FixedServiceCard
        def={ontologyQuery}
        card={{ ...INIT, checking: false, running: true, tools: [{ name: 'listOntoConcepts', description: 'd' }] }}
        host="example.com"
        onOpenConfig={onOpenConfig}
        onToggle={onToggle}
        onShowTools={onShowTools}
      />,
    );
    expect(screen.getByText('本体查询 MCP 服务')).toBeTruthy();
    expect(screen.getByText('运行中')).toBeTruthy();
    expect(screen.getByText('http://example.com:8002/mcp')).toBeTruthy();
    // 传输模式必须上卡片（与自建发布卡片同一套叫法；展示名用 MCP 规范名 streamable-http）
    expect(screen.getByText('streamable-http（/mcp 单端点）')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '查看配置' }));
    expect(onOpenConfig).toHaveBeenCalledWith(ontologyQuery);
    fireEvent.click(screen.getByRole('button', { name: '停 止' }));
    expect(onToggle).toHaveBeenCalledWith(ontologyQuery);
    fireEvent.click(screen.getByRole('button', { name: '查看工具' }));
    expect(onShowTools).toHaveBeenCalledWith(ontologyQuery);
    // 刷新统一在区块右上角（与自建发布同构）：卡片上不得再有刷新按钮
    expect(screen.queryByRole('button', { name: /刷\s*新/ })).toBeNull();
  });

  it('内网执行底座：显示检查中、零工具说明，但**不暴露传输模式**', () => {
    const fn = vi.fn();
    const executor = FIXED_SERVICES.find(d => d.key === 'functionExecutor')!;
    render(
      <FixedServiceCard
        def={executor}
        card={{ ...INIT }}
        host="h"
        onOpenConfig={fn} onToggle={fn} onShowTools={fn}
      />,
    );
    expect(screen.getByText('检查中...')).toBeTruthy();
    // 「零工具」在卡片正文与角色说明各出现一次，故按出现次数断言
    expect(screen.getAllByText(/零工具/).length).toBeGreaterThan(0);
    // 内网执行底座不对外，传输模式不上卡片（只对对外工具面展示）
    expect(screen.queryByText(/传输模式/)).toBeNull();
    expect(screen.queryByRole('button', { name: '查看工具' })).toBeNull();
  });

  it('数据引擎执行服务：传输模式不上卡片，且不得谎称「零工具」', () => {
    const fn = vi.fn();
    const engine = FIXED_SERVICES.find(d => d.key === 'dataEngine')!;
    render(
      <FixedServiceCard
        def={engine}
        card={{ ...INIT }}
        host="h"
        onOpenConfig={fn} onToggle={fn} onShowTools={fn}
      />,
    );
    // 它有 /mcp 工具面（已就绪行为，仅内网挂载），不是零工具
    expect(screen.getByText('工具面仅内网（供平台 Agent 挂载），不对外提供')).toBeTruthy();
    expect(screen.queryByText(/零工具/)).toBeNull();
    expect(screen.queryByText(/传输模式/)).toBeNull();
  });
});

describe('PublishedServiceCard', () => {
  const svc = {
    name: 'order-query', kind: 'behavior', ontology_id: 2, ontology_name: '订单排程',
    items: ['QueryOrder'], tool_count: 1, host_port: 8030, transport: 'streamable',
    token: 'tk', container_name: 'c', created_at: '', status: 'running', running: true,
  } as PublishedService;

  it('渲染类型/本体/地址与令牌，并回调启停、删除、配置', () => {
    const onShowConfig = vi.fn();
    const onToggle = vi.fn();
    const onRemove = vi.fn();
    render(<PublishedServiceCard svc={svc} host="h" onShowConfig={onShowConfig} onToggle={onToggle} onRemove={onRemove} />);
    expect(screen.getByText('order-query')).toBeTruthy();
    expect(screen.getByText(/订单排程/)).toBeTruthy();
    expect(screen.getByText('http://h:8030/mcp')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '查看配置' }));
    expect(onShowConfig).toHaveBeenCalledWith(svc);
    fireEvent.click(screen.getByRole('button', { name: '停 止' }));
    expect(onToggle).toHaveBeenCalledWith(svc);
    fireEvent.click(screen.getByRole('button', { name: '删 除' }));
    expect(onRemove).toHaveBeenCalledWith(svc);
  });

  it('列表读取中（刷新）状态位显示「检查中...」，完成后回到真实状态', () => {
    const fn = vi.fn();
    const { rerender } = render(
      <PublishedServiceCard svc={svc} host="h" checking onShowConfig={fn} onToggle={fn} onRemove={fn} />,
    );
    expect(screen.getByText('检查中...')).toBeTruthy();
    expect(screen.queryByText('运行中')).toBeNull();

    rerender(<PublishedServiceCard svc={svc} host="h" onShowConfig={fn} onToggle={fn} onRemove={fn} />);
    expect(screen.getByText('运行中')).toBeTruthy();
  });

  it('停止且容器缺失时显示「容器缺失」', () => {
    const fn = vi.fn();
    render(<PublishedServiceCard svc={{ ...svc, running: false, status: 'not_found' }} host="h" onShowConfig={fn} onToggle={fn} onRemove={fn} />);
    expect(screen.getByText('容器缺失')).toBeTruthy();
    expect(screen.getByRole('button', { name: '启 动' })).toBeTruthy();
  });
});
