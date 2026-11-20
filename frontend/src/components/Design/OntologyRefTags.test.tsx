/**
 * OntologyRefTags 单测（章程 III：抽出的展示组件必须同时补测并纳入覆盖率门禁）。
 *
 * 断言的是「引用清单可见」与「原本体已不存在」两件事——
 * 快照内容本身不在此重渲染（提示词用的是后端落盘的 prompt_text）。
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { OntologyRefEntry, OntologyRefSnapshot } from '@/api/client';
import OntologyRefTags from './OntologyRefTags';
import { refIdentityKey } from './conversation-ontology-refs';

const refEntry = (over: Partial<OntologyRefEntry> = {}): OntologyRefEntry => ({
  ontology_id: '12',
  scenario_id: '3',
  scenario_name: '订单场景',
  ontology_name: '货品BOM及工艺',
  counts: { concepts: 6, functions: 4, behaviors: 11 },
  items: { concepts: [], functions: [], behaviors: [] },
  ...over,
});

const snapshot = (refs: OntologyRefEntry[] = [refEntry()]): OntologyRefSnapshot => ({
  snapshot_at: '2026-11-20T06:05:00.000Z',
  max_tokens: 20000,
  token_estimate: 4210,
  refs,
  prompt_text: '=== 存量本体参考（既有约定，硬约束）===',
});

describe('OntologyRefTags', () => {
  it('renders nothing when there is no ref', () => {
    const { container } = render(<OntologyRefTags snapshot={snapshot([])} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders one tag per ref plus the snapshot time', () => {
    render(<OntologyRefTags snapshot={snapshot([
      refEntry(),
      refEntry({ scenario_id: '4', scenario_name: '仓储场景', ontology_id: '13', ontology_name: '库存模型' }),
    ])} />);
    expect(screen.getByText('订单场景 - 货品BOM及工艺')).toBeInTheDocument();
    expect(screen.getByText('仓储场景 - 库存模型')).toBeInTheDocument();
    expect(screen.getByText(/快照 /)).toBeInTheDocument();
    expect(screen.getByLabelText('已引用的存量本体')).toBeInTheDocument();
  });

  it('does not mark missing when candidate keys are unknown', () => {
    render(<OntologyRefTags snapshot={snapshot()} />);
    expect(screen.queryByText(/原本体已不存在/)).not.toBeInTheDocument();
  });

  it('marks missing when the ontology is gone', () => {
    render(<OntologyRefTags snapshot={snapshot()} candidateKeys={new Set(['3/99'])} />);
    expect(screen.getByText(/原本体已不存在/)).toBeInTheDocument();
  });

  it('does not mark missing when identity matches', () => {
    const keys = new Set([refIdentityKey({ scenario_id: '3', ontology_id: '12' })]);
    render(<OntologyRefTags snapshot={snapshot()} candidateKeys={keys} />);
    expect(screen.queryByText(/原本体已不存在/)).not.toBeInTheDocument();
  });

  it('does not confuse the same ontology id in another scenario', () => {
    const keys = new Set([refIdentityKey({ scenario_id: '4', ontology_id: '12' })]);
    render(<OntologyRefTags snapshot={snapshot()} candidateKeys={keys} />);
    expect(screen.getByText(/原本体已不存在/)).toBeInTheDocument();
  });
});
