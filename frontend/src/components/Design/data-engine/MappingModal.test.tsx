/**
 * MappingModal 单测（章程 III：属性传递 / 事件触发 / 边界条件）。
 *
 * 该组件由「输入映射 + 输出映射」两处同构 JSX 收敛而来，是拆分的核心收益点，
 * 因此重点验证：本体/目标字段两侧渲染、类型不符告警、遗漏目标字段提示、
 * 单字段变更回传、保存/取消触发。
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MappingModal from './MappingModal';
import { selectOption, optionTexts, openSelect } from '@/test/antd';

const ontoFields = ['原材料编号', '数量'];
const targetFields = ['rawMaterialId', 'qty'];
const ontoFieldTypes = { 原材料编号: 'string', 数量: 'integer' };
const targetFieldTypes = { rawMaterialId: 'string', qty: 'integer' };

function setup(overrides: Record<string, unknown> = {}) {
  const props = {
    open: true,
    title: '输入映射 - 查询库存',
    ontoFields,
    targetFields,
    ontoFieldTypes,
    targetFieldTypes,
    mapping: {} as Record<string, string>,
    emptyHint: '本体行为未定义输入参数',
    selectPlaceholder: '选择目标参数',
    direction: '输入',
    onMappingChange: vi.fn(),
    onSave: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
  render(<MappingModal {...(props as any)} />);
  return props;
}

describe('MappingModal — 属性传递', () => {
  it('渲染标题、两侧字段与类型标注', () => {
    setup();
    expect(screen.getByText('输入映射 - 查询库存')).toBeInTheDocument();
    expect(screen.getByText('本体字段')).toBeInTheDocument();
    expect(screen.getByText('目标字段')).toBeInTheDocument();
    expect(screen.getByText(/原材料编号/)).toBeInTheDocument();
    // 类型以 (string) / (integer) 形式跟随字段名展示。
    // 用 getAllByText：同一类型也可能出现在底部「未映射目标字段」的 Tag 里。
    expect(screen.getAllByText('(string)').length).toBeGreaterThan(0);
    expect(screen.getAllByText('(integer)').length).toBeGreaterThan(0);
  });

  it('已选目标字段时以「字段名(类型)」展示在选项里', () => {
    setup({ mapping: { 原材料编号: 'rawMaterialId' } });
    openSelect(0);
    expect(optionTexts().join(' ')).toContain('rawMaterialId(string)');
    expect(optionTexts().join(' ')).toContain('qty(integer)');
  });

  it('类型不符时本体字段标黄（属性传递到样式）', () => {
    // 本体 数量=integer 映射到 rawMaterialId=string → 不符
    setup({ mapping: { 数量: 'rawMaterialId' } });
    expect(screen.getByText(/^数量$/).className).toContain('text-yellow-400');
  });

  it('类型一致时不标黄', () => {
    setup({ mapping: { 数量: 'qty' } });
    expect(screen.getByText(/^数量$/).className).not.toContain('text-yellow-400');
  });

  it('方向词进入遗漏提示文案（输入/输出复用同一组件）', () => {
    setup({ mapping: {}, direction: '输出' });
    expect(screen.getByText(/在本体中没有对应的输出映射/)).toBeInTheDocument();
  });
});

describe('MappingModal — 事件触发', () => {
  it('选中目标字段回传该字段的映射变更（而非整体重写）', () => {
    const props = setup();
    selectOption('rawMaterialId', 0);
    expect(props.onMappingChange).toHaveBeenCalledWith('原材料编号', 'rawMaterialId');
  });

  it('第二行的选择器回传第二个本体字段', () => {
    const props = setup();
    selectOption('qty', 1);
    expect(props.onMappingChange).toHaveBeenCalledWith('数量', 'qty');
  });

  it('保存 / 取消分别触发对应回调', () => {
    const props = setup();
    fireEvent.click(screen.getByRole('button', { name: '保 存' }));
    expect(props.onSave).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '取 消' }));
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });
});

describe('MappingModal — 边界条件', () => {
  it('本体侧无字段时只显示提示，不渲染表头与映射行', () => {
    setup({ ontoFields: [] });
    expect(screen.getByText('本体行为未定义输入参数')).toBeInTheDocument();
    expect(screen.queryByText('本体字段')).not.toBeInTheDocument();
    expect(document.querySelectorAll('.ant-select-selector').length).toBe(0);
  });

  it('目标字段全部被映射覆盖时不显示遗漏提示', () => {
    setup({ mapping: { 原材料编号: 'rawMaterialId', 数量: 'qty' } });
    expect(screen.queryByText(/在本体中没有对应的输入映射/)).not.toBeInTheDocument();
  });

  it('存在未映射目标字段时逐个列出并带类型', () => {
    setup({ mapping: {} });
    expect(screen.getByText(/在本体中没有对应的输入映射/)).toBeInTheDocument();
    expect(screen.getByText(/rawMaterialId/)).toBeInTheDocument();
    expect(screen.getByText(/qty/)).toBeInTheDocument();
  });

  it('目标字段类型缺失时以 ? 占位（不渲染 undefined）', () => {
    setup({ targetFieldTypes: { rawMaterialId: 'string' }, mapping: {} });
    openSelect(0);
    expect(optionTexts().join(' ')).toContain('qty(?)');
  });
});
