/**
 * 关系页容器 + 概念关系表单测（章程 III：属性传递 / 事件触发 / 边界条件）。
 *
 * 覆盖：右上角 Segmented 切换、SubClassOf 行置灰且无删除、等价/互斥行可删除、
 * 概念视图新增行默认类型为 EquivalentClass、切回对象关系仍走原接口。
 * 依赖 API 一律打桩（测试禁止真实网络）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

vi.mock('@/api/client', () => ({
  getRelations: vi.fn(),
  createRelation: vi.fn(),
  updateRelation: vi.fn(),
  deleteRelation: vi.fn(),
  getConcepts: vi.fn(),
  getConceptRelations: vi.fn(),
  createConceptRelation: vi.fn(),
  updateConceptRelation: vi.fn(),
  deleteConceptRelation: vi.fn(),
  effectiveAttributes: (c: any) => [...(c?.attributes || []), ...(c?.inherited_attributes || [])],
}));

import RelationTable from './RelationTable';
import * as api from '@/api/client';

const concepts = [
  { name: 'Document', title: '单据', description: '', attributes: [{ name: 'docNo', type: 'string' }] },
  { name: 'PurchaseOrder', title: '采购单', description: '', sub_class_of: 'Document', attributes: [{ name: 'poId', type: 'string' }] },
  { name: 'DraftOrder', title: '草稿订单', description: '', attributes: [{ name: 'docNo', type: 'string' }] },
];

const conceptRelations = [
  {
    name: 'PurchaseOrderSubClassOfDocument', title: '采购单 是一种 单据',
    relation_type: 'SubClassOf', source: 'PurchaseOrder', target: 'Document',
    source_attr: 'poId', target_attr: 'docNo', description: '由概念设计自动同步',
  },
  {
    name: 'DraftOrderDisjointWithPurchaseOrder', title: '草稿订单与采购单互斥',
    relation_type: 'DisjointWith', source: 'DraftOrder', target: 'PurchaseOrder',
    source_attr: '', target_attr: '', description: '互斥',
  },
];

const switchTo = (label: '概念关系' | '对象关系') =>
  fireEvent.click(screen.getByRole('radio', { name: new RegExp(`^${label}`) }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getConcepts).mockResolvedValue(concepts as any);
  vi.mocked(api.getRelations).mockResolvedValue([] as any);
  vi.mocked(api.getConceptRelations).mockResolvedValue(conceptRelations as any);
});

describe('RelationTable', () => {
  it('默认展示对象关系（沿用原表），右上角提供两类关系切换', async () => {
    render(<RelationTable ontologyId={1} activeTab="relations" />);

    await waitFor(() => expect(api.getRelations).toHaveBeenCalledWith(1));
    expect(screen.getByRole('radio', { name: /^概念关系/ })).toBeTruthy();
    expect(screen.getByRole('radio', { name: /^对象关系/ })).toBeTruthy();
    expect(screen.getByText('新增关系')).toBeTruthy();
    expect(api.getConceptRelations).not.toHaveBeenCalled();
  });

  it('切到概念关系：拉取概念关系，SubClassOf 行置灰且无删除按钮', async () => {
    const { container } = render(<RelationTable ontologyId={1} activeTab="relations" />);
    switchTo('概念关系');

    await waitFor(() => expect(api.getConceptRelations).toHaveBeenCalledWith(1));
    expect(await screen.findByText('采购单 是一种 单据')).toBeTruthy();
    expect(screen.getByText('SubClassOf')).toBeTruthy();
    expect(screen.getByText('DisjointWith')).toBeTruthy();

    // 派生行整行置灰
    expect(container.querySelector('tr.opacity-60')).toBeTruthy();
    // 只有用户登记的互斥行可删除（SubClassOf 行没有删除按钮）
    expect(container.querySelectorAll('.anticon-delete')).toHaveLength(1);
  });

  it('概念视图新增：只能新增等价/互斥，默认类型为 EquivalentClass', async () => {
    render(<RelationTable ontologyId={1} activeTab="relations" />);
    switchTo('概念关系');
    await waitFor(() => expect(api.getConceptRelations).toHaveBeenCalled());

    fireEvent.click(screen.getByText('新增关系'));
    expect(await screen.findByPlaceholderText(/DraftOrderDisjointWithSubmittedOrder/)).toBeTruthy();
    expect(screen.getByText('等价 (EquivalentClass)')).toBeTruthy();
    expect(screen.queryByText('子类 (SubClassOf)')).toBeNull();
  });

  it('切回对象关系仍走原接口', async () => {
    render(<RelationTable ontologyId={1} activeTab="relations" />);
    switchTo('概念关系');
    await waitFor(() => expect(api.getConceptRelations).toHaveBeenCalled());
    switchTo('对象关系');
    await waitFor(() => expect(api.getRelations).toHaveBeenCalledWith(1));
    expect(screen.getByText('新增关系')).toBeTruthy();
  });

  it('对象关系每页只展示 5 行，超出出现分页；新增行自动跳到所在页', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      name: `Rel${i + 1}`, title: `关系${i + 1}`, source: 'Document', target: 'DraftOrder',
      cardinality: '1:N', relation_type: [], source_attr: 'docNo', target_attr: 'docNo', description: '',
    }));
    vi.mocked(api.getRelations).mockResolvedValue(many as any);

    const { container } = render(<RelationTable ontologyId={1} activeTab="relations" />);
    await waitFor(() => expect(api.getRelations).toHaveBeenCalled());
    await screen.findByText('Rel1');

    expect(container.querySelectorAll('.ant-table-tbody tr.ant-table-row')).toHaveLength(5);
    expect(container.querySelector('.ant-pagination')).toBeTruthy();

    // 第 6 行起在后续页，新增行会落在最后一页：点击新增必须能立刻看到编辑行
    fireEvent.click(screen.getByText('新增关系'));
    expect(await screen.findByPlaceholderText('如 HasDetail')).toBeTruthy();
  });

  it('概念关系每页只展示 5 行，超出出现分页', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      name: `Pair${i + 1}DisjointWithOther${i + 1}`, title: `互斥${i + 1}`,
      relation_type: 'DisjointWith', source: 'DraftOrder', target: 'PurchaseOrder',
      source_attr: '', target_attr: '', description: '',
    }));
    vi.mocked(api.getConceptRelations).mockResolvedValue(many as any);

    const { container } = render(<RelationTable ontologyId={1} activeTab="relations" />);
    switchTo('概念关系');
    await waitFor(() => expect(api.getConceptRelations).toHaveBeenCalled());
    await screen.findByText('互斥1');

    expect(container.querySelectorAll('.ant-table-tbody tr.ant-table-row')).toHaveLength(5);
    expect(container.querySelector('.ant-pagination')).toBeTruthy();
  });
});
