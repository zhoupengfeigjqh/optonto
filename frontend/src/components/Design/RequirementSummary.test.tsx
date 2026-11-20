/**
 * RequirementSummary 单测（章程 III / IV：属性传递、事件触发、边界条件、键盘可达）。
 *
 * 本轮新增职责是「按版本号筛选」：断言的是**行集合**而非表格实现细节，
 * 同时锁住三条不能破的红线：
 * 1. 不做筛选时与改动前一致（行数、列文本、本体生成标签）；
 * 2. 切换筛选不重新请求数据，且请求入参与当前上下文一致；
 * 3. 删除当前版本最后一条后自动回到「全部」并提示，且不出现空表中间帧。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

vi.mock('@/api/client', () => ({
  listRequirements: vi.fn(),
  deleteRequirementFile: vi.fn(),
}));
// 详情页与本主题无关，用探针替换（只保留返回入口）
vi.mock('./RequirementViewer', () => ({
  default: ({ onBack }: { onBack: () => void }) => (
    <button onClick={onBack}>返回列表</button>
  ),
}));

import RequirementSummary from './RequirementSummary';
import * as api from '@/api/client';
import { openSelect, selectOption, optionTexts } from '@/test/antd';

const doc = (over: Record<string, unknown>) => ({
  filename: 'a.md',
  thread_id: 't1',
  onto_name: '原材料采购和库存',
  content_name: '内容A',
  version: 'v1.9',
  thread_title: '会话A',
  created_at: '',
  updated_at: '',
  has_ontology: true,
  ontology_file: 'a.yaml',
  scenario_name: '生产调度',
  ontology_name: '原材料采购和库存',
  ...over,
});

const docs = [
  doc({ filename: 'a.md', thread_id: 't1', content_name: '内容A', version: 'v1.9', has_ontology: true }),
  doc({ filename: 'b.md', thread_id: 't2', content_name: '内容B', version: 'v1.10', has_ontology: false }),
  doc({ filename: 'c.md', thread_id: 't3', content_name: '内容C', version: 'v2.0', has_ontology: true }),
  doc({ filename: 'd.md', thread_id: 't4', content_name: '内容D', version: '', has_ontology: false }),
  doc({ filename: 'e.md', thread_id: 't5', content_name: '内容E', version: 'v1.9', has_ontology: false }),
];

function renderSummary() {
  return render(
    <RequirementSummary ontologyId="1" activeTab="requirement-summary" scenarioName="生产调度" ontologyName="原材料采购和库存" />,
  );
}

/** 当前表格里可见的「内容X」标签集合（按出现顺序） */
function visibleRows(): string[] {
  return Array.from(document.querySelectorAll('tbody tr'))
    .map(tr => tr.textContent || '')
    .filter(text => /内容[A-E]/.test(text))
    .map(text => (text.match(/内容[A-E]/) as RegExpMatchArray)[0]);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.listRequirements).mockResolvedValue(docs as any);
  vi.mocked(api.deleteRequirementFile).mockResolvedValue(undefined as any);
});

describe('默认状态（零回归）', () => {
  it('下拉默认「全部」，表格显示全部行，请求入参为当前场景/本体', async () => {
    renderSummary();

    expect(await screen.findByText('内容A')).toBeInTheDocument();
    expect(visibleRows()).toEqual(['内容A', '内容B', '内容C', '内容D', '内容E']);
    expect(api.listRequirements).toHaveBeenCalledWith('生产调度', '原材料采购和库存');
    expect(screen.getByText('全部')).toBeInTheDocument();
  });

  it('筛选前后表头列文本完全一致，本体生成标签不变', async () => {
    renderSummary();
    await screen.findByText('内容A');

    const headersBefore = Array.from(document.querySelectorAll('thead th')).map(th => th.textContent);
    expect(headersBefore).toEqual(['本体名', '内容', '版本', '会话名称', '创建时间', '更新时间', '本体生成', '操作']);

    selectOption('v1.9');

    const headersAfter = Array.from(document.querySelectorAll('thead th')).map(th => th.textContent);
    expect(headersAfter).toEqual(headersBefore);
    // 同一文档的生成状态不因筛选重算
    const rowA = Array.from(document.querySelectorAll('tbody tr')).find(tr => tr.textContent?.includes('内容A'));
    expect(rowA?.textContent).toContain('已生成');
  });

  it('下拉具备可读名称（读屏可播报）', async () => {
    renderSummary();
    await screen.findByText('内容A');
    const input = document.querySelector('.ant-select-selection-search-input');
    expect(input?.getAttribute('aria-label')).toBe('按版本号筛选');
  });
});

describe('按版本过滤', () => {
  it('选择某版本后只剩该版本，且不重新请求数据', async () => {
    renderSummary();
    await screen.findByText('内容A');

    selectOption('v1.9');

    await waitFor(() => expect(visibleRows()).toEqual(['内容A', '内容E']));
    expect(api.listRequirements).toHaveBeenCalledTimes(1);
  });

  it('选项来自真实数据且按自然降序，未填写版本置末', async () => {
    renderSummary();
    await screen.findByText('内容A');

    openSelect();

    expect(optionTexts()).toEqual(['全部', 'v2.0', 'v1.10', 'v1.9', '未填写版本']);
  });

  it('「未填写版本」可筛出空版本的历史文档', async () => {
    renderSummary();
    await screen.findByText('内容A');

    selectOption('未填写版本');

    await waitFor(() => expect(visibleRows()).toEqual(['内容D']));
  });

  it('切回「全部」恢复所有行', async () => {
    renderSummary();
    await screen.findByText('内容A');

    selectOption('v2.0');
    await waitFor(() => expect(visibleRows()).toEqual(['内容C']));

    selectOption('全部');
    await waitFor(() => expect(visibleRows()).toHaveLength(5));
  });

  it('没有任何文档时下拉禁用但仍可见', async () => {
    vi.mocked(api.listRequirements).mockResolvedValue([] as any);
    renderSummary();

    expect(await screen.findByText('暂无导出的需求文档，请先在对话中导出文档')).toBeInTheDocument();
    expect(document.querySelector('.ant-select-disabled')).not.toBeNull();
  });
});

describe('删除与回落', () => {
  it('删除某版本最后一条后自动回到「全部」并提示，且不再残留该版本选项', async () => {
    renderSummary();
    await screen.findByText('内容A');

    selectOption('v2.0');
    await waitFor(() => expect(visibleRows()).toEqual(['内容C']));

    // 让下一次 load 返回剔除「内容C」的列表
    vi.mocked(api.listRequirements).mockResolvedValue(docs.filter(d => d.filename !== 'c.md') as any);
    fireEvent.click(document.querySelector('.anticon-delete')!.closest('button')!);

    const confirmButton = await screen.findByRole('button', { name: '确认删除' });
    fireEvent.click(confirmButton);

    expect(await screen.findByText('当前版本已无需求文档，已显示全部')).toBeInTheDocument();
    await waitFor(() => expect(visibleRows()).toEqual(['内容A', '内容B', '内容D', '内容E']));

    openSelect();
    expect(optionTexts()).not.toContain('v2.0');
  });

  it('删除失败时保留原列表并提示错误', async () => {
    vi.mocked(api.deleteRequirementFile).mockRejectedValue(new Error('删除失败'));
    renderSummary();
    await screen.findByText('内容A');

    fireEvent.click(document.querySelector('.anticon-delete')!.closest('button')!);
    fireEvent.click(await screen.findByRole('button', { name: '确认删除' }));

    expect(await screen.findByText('删除失败')).toBeInTheDocument();
    await waitFor(() => expect(visibleRows()).toHaveLength(5));
  });
});

describe('筛选状态的生命周期', () => {
  it('进入详情再返回时保持原筛选', async () => {
    renderSummary();
    await screen.findByText('内容A');

    selectOption('v1.10');
    await waitFor(() => expect(visibleRows()).toEqual(['内容B']));

    fireEvent.click(screen.getByRole('button', { name: /查\s*看/ }));
    const back = await screen.findByRole('button', { name: '返回列表' });
    fireEvent.click(back);

    await waitFor(() => expect(visibleRows()).toEqual(['内容B']));
  });

  it('组件重挂载后回到「全部」（不持久化）', async () => {
    const first = renderSummary();
    await screen.findByText('内容A');
    selectOption('v1.9');
    await waitFor(() => expect(visibleRows()).toEqual(['内容A', '内容E']));

    first.unmount();
    renderSummary();

    await waitFor(() => expect(visibleRows()).toHaveLength(5));
  });
});
