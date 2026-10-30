'use client';

/**
 * 概念属性编辑弹窗（spec 005）：自有属性全编辑；继承属性只读，
 * 仅枚举（只能删）、取值范围（不超父）、匹配模式（任意）可收窄。
 */
import { useEffect, useState } from 'react';
import { Button, Input, InputNumber, Modal, message, Tag, Space, Table, Select } from 'antd';
import { PlusOutlined, DeleteOutlined, UndoOutlined } from '@ant-design/icons';
import {
  updateAttributes, Attribute, AttributeConstraint, AttributeRestriction, Concept, InheritedAttribute,
} from '@/api/client';
import { canEnum, canRange, canPattern, normalizeRestriction, validateRestriction } from './concept-inheritance';

const ATTR_TYPES = ['string', 'number', 'integer', 'boolean', 'object', 'array'];
const BOOL_OPTS = [{ value: 'false', label: '否' }, { value: 'true', label: '是' }];

const patternInvalid = (p?: string) => {
  if (!p?.trim()) return false;
  try { new RegExp(p); return false; } catch { return true; }
};

interface Props {
  open: boolean;
  concept: Concept | null;
  /** 父概念的有效属性（收窄边界来源） */
  parentAttrs: Attribute[];
  ontologyId: number;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}

type AttrRow = Attribute & {
  _idx: number;
  _kind: 'own' | 'inherited';
  inherited_from?: string;
  restricted?: boolean;
};

export default function ConceptAttributeModal({ open, concept, parentAttrs, ontologyId, onClose, onSaved }: Props) {
  const [attributes, setAttributes] = useState<Attribute[]>([]);
  const [inheritedRows, setInheritedRows] = useState<InheritedAttribute[]>([]);
  const [restrictions, setRestrictions] = useState<Record<string, AttributeRestriction>>({});

  useEffect(() => {
    if (!open || !concept) return;
    setAttributes(concept.attributes || []);
    setInheritedRows(concept.inherited_attributes || []);
    setRestrictions(concept.attribute_restrictions || {});
  }, [open, concept]);

  const baseOf = (name?: string) => parentAttrs.find(a => a.name === name);

  const updateAttr = (idx: number, patch: Partial<Attribute>) => {
    const n = [...attributes];
    const next: Attribute = { ...n[idx], ...patch };
    if (patch.type !== undefined) {
      // 切换类型：清理不适用的约束项，避免脏数据
      const c: AttributeConstraint = { ...(next.constraint || {}) };
      if (!canEnum(next.type)) { delete c.unique; delete c.enum; }
      if (!canPattern(next.type)) { delete c.pattern; }
      if (!canRange(next.type)) { delete c.min; delete c.max; }
      next.constraint = Object.keys(c).length ? c : null;
    }
    if (patch.constraint !== undefined) {
      // 唯一 ⇒ 非空联动；取消唯一后非空保持原值但恢复可编辑
      const c: AttributeConstraint = { ...(n[idx].constraint || {}), ...patch.constraint };
      if (c.unique) c.required = true;
      next.constraint = c;
    }
    n[idx] = next;
    setAttributes(n);
  };

  const setRestriction = (name: string, draft: AttributeRestriction) => {
    const base = baseOf(name);
    setRestrictions(prev => {
      const next = { ...prev };
      const normalized = base ? normalizeRestriction(base, draft) : draft;
      if (normalized) next[name] = normalized; else delete next[name];
      return next;
    });
  };

  const clearRestriction = (name: string) => {
    setRestrictions(prev => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
  };

  const handleAddAttribute = () => setAttributes([...attributes, { name: '', type: 'string' }]);

  const handleDeleteAttribute = (idx: number) => setAttributes(attributes.filter((_, i) => i !== idx));

  const handleSave = async () => {
    if (!concept) return;
    const names = attributes.map(a => a.name.trim());
    if (names.some(n => !n)) { message.warning('属性名不能为空'); return; }
    if (new Set(names).size !== names.length) { message.warning('属性名重复'); return; }
    const inheritedNames = new Set(inheritedRows.map(a => a.name));
    const collide = names.filter(n => inheritedNames.has(n));
    if (collide.length) {
      message.warning(`以下属性继承自父概念，不可重复声明（请直接在继承行收窄）：${collide.join('、')}`);
      return;
    }
    // 生命周期状态属性（spec 003）：至多一个，且必须 string 类型 + 枚举非空（后端同样校验）
    const statusAttrs = attributes.filter(a => a.name.trim() === 'status');
    if (statusAttrs.length > 1) { message.warning('只能有一个 status（生命周期状态）属性'); return; }
    if (statusAttrs.length === 1) {
      if (statusAttrs[0].type !== 'string') { message.warning('status（生命周期状态）属性的类型必须是 string'); return; }
      if (!(statusAttrs[0].constraint?.enum || []).length) { message.warning('status（生命周期状态）属性必须填写枚举值（生命周期状态集合）'); return; }
    }
    for (const a of attributes) {
      if (patternInvalid(a.constraint?.pattern)) { message.error(`属性「${a.name}」的匹配模式不是合法正则`); return; }
      if (canEnum(a.type) && a.type !== 'string' && (a.constraint?.enum || []).some(v => isNaN(Number(v)))) {
        message.warning(`属性「${a.name}」的枚举值必须是数字`); return;
      }
      if (canRange(a.type) && a.constraint?.min != null && a.constraint?.max != null && a.constraint.min > a.constraint.max) {
        message.warning(`属性「${a.name}」的取值范围最小值不能大于最大值`); return;
      }
    }
    // 收窄校验 + 规范化（与父定义等价的维度不落盘）
    const cleanedRestrictions: Record<string, AttributeRestriction> = {};
    for (const row of inheritedRows) {
      const r = restrictions[row.name];
      if (!r) continue;
      const base = baseOf(row.name);
      if (!base) continue;
      const err = validateRestriction(base, r);
      if (err) { message.warning(err); return; }
      const norm = normalizeRestriction(base, r);
      if (norm) cleanedRestrictions[row.name] = norm;
    }
    // 收敛 constraint：清不适用项、数字枚举解析、全缺省置 null（不落盘）
    const payload = attributes.map(a => {
      const base = { name: a.name.trim(), type: a.type, title: a.title?.trim() || '', description: a.description?.trim() || '', example: a.example?.trim() || '' };
      const c = a.constraint;
      if (!c) return { ...base, constraint: null };
      const out: AttributeConstraint = {};
      if (canEnum(a.type) && c.unique) out.unique = true;
      if (c.required || out.unique) out.required = true;
      if (canEnum(a.type) && c.enum?.length) {
        out.enum = a.type === 'string' ? c.enum.map(String) : c.enum.map(Number);
      }
      if (canPattern(a.type) && c.pattern?.trim()) out.pattern = c.pattern.trim();
      if (canRange(a.type)) {
        // integer 兜底取整（InputNumber precision=0 已四舍五入，此处双保险）
        if (c.min != null) out.min = a.type === 'integer' ? Math.round(Number(c.min)) : Number(c.min);
        if (c.max != null) out.max = a.type === 'integer' ? Math.round(Number(c.max)) : Number(c.max);
      }
      return { ...base, constraint: Object.keys(out).length ? out : null };
    });
    try {
      await updateAttributes(ontologyId, concept.name, payload, cleanedRestrictions);
      message.success('属性已保存');
      onClose();
      await onSaved();
    } catch (e: any) { message.error(e.message); }
  };

  const attrRows: AttrRow[] = [
    ...attributes.map((a, i) => ({ ...a, _idx: i, _kind: 'own' as const })),
    ...inheritedRows.map((a, i) => ({ ...a, _idx: attributes.length + i, _kind: 'inherited' as const })),
  ];

  return (
    <Modal title={`管理属性 - ${concept?.title || concept?.name || ''}`} open={open} onCancel={onClose} width={1600}
      footer={
        <div className="flex justify-start gap-2">
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" onClick={handleSave}>保存</Button>
        </div>
      }
    >
      <p className="text-text-muted text-xs mb-2">
        每个概念应有一个 <span className="text-text-primary">name 为 status</span> 的生命周期状态属性：
        类型固定 <span className="text-text-primary">string</span>，且必须填写枚举值（该对象的生命周期状态集合）。
        写入行为的状态跃迁（源状态/目标状态）只能取该枚举内的值。
      </p>
      {inheritedRows.length > 0 && (
        <p className="text-text-muted text-xs mb-2">
          灰色行为继承父概念 <span className="text-text-primary">{concept?.sub_class_of}</span> 的属性，只读；
          仅 <span className="text-text-primary">枚举（只能从父枚举中删除）</span>、
          <span className="text-text-primary">取值范围（不能超过父范围）</span>、
          <span className="text-text-primary">匹配模式（可任意调整）</span> 可收窄。
        </p>
      )}
      <Table
        dataSource={attrRows}
        rowKey="_idx"
        size="small"
        pagination={false}
        scroll={{ x: 1750 }}
        columns={[
          { title: '来源', width: 110, render: (_: any, r: AttrRow) => (
            r._kind === 'inherited'
              ? <Tag color="cyan" style={{ marginInlineEnd: 0 }}>继承自 {r.inherited_from || concept?.sub_class_of}</Tag>
              : <Tag style={{ marginInlineEnd: 0 }}>自有</Tag>
          )},
          { title: '英文名称', width: 130, render: (_: any, r: AttrRow) => (
            <Input size="small" value={r.name} disabled={r._kind === 'inherited'} onChange={e => updateAttr(r._idx, { name: e.target.value })} placeholder="英文名称" className="bg-dark-bg border-dark-border text-text-primary" />
          )},
          { title: '中文名称', width: 110, render: (_: any, r: AttrRow) => (
            <Input size="small" value={r.title || ''} disabled={r._kind === 'inherited'} onChange={e => updateAttr(r._idx, { title: e.target.value })} placeholder="中文名称" className="bg-dark-bg border-dark-border text-text-primary" />
          )},
          { title: '描述', width: 160, render: (_: any, r: AttrRow) => (
            <Input size="small" value={r.description || ''} disabled={r._kind === 'inherited'} onChange={e => updateAttr(r._idx, { description: e.target.value })} placeholder="属性语义描述" className="bg-dark-bg border-dark-border text-text-primary" />
          )},
          { title: '类型', width: 100, render: (_: any, r: AttrRow) => (
            <Select size="small" value={r.type} disabled={r._kind === 'inherited'} onChange={v => updateAttr(r._idx, { type: v })} style={{ width: '100%' }}
              options={ATTR_TYPES.map(t => ({ value: t, label: t }))} />
          )},
          { title: '是否唯一', width: 80, render: (_: any, r: AttrRow) => canEnum(r.type) ? (
            <Select size="small" value={String(r.constraint?.unique ?? false)} disabled={r._kind === 'inherited'} style={{ width: '100%' }}
              onChange={v => updateAttr(r._idx, { constraint: { unique: v === 'true' } })} options={BOOL_OPTS} />
          ) : <span className="text-text-muted">-</span> },
          { title: '是否非空', width: 80, render: (_: any, r: AttrRow) => (
            <Select size="small" value={String(r.constraint?.required ?? false)} disabled={r._kind === 'inherited' || !!r.constraint?.unique} style={{ width: '100%' }}
              onChange={v => updateAttr(r._idx, { constraint: { required: v === 'true' } })} options={BOOL_OPTS} />
          )},
          { title: '枚举值', width: 190, render: (_: any, r: AttrRow) => {
            if (r._kind === 'own') {
              return canEnum(r.type) ? (
                <Select size="small" mode="tags" value={(r.constraint?.enum || []).map(String)} style={{ width: '100%' }}
                  open={false} suffixIcon={null} placeholder="回车新增"
                  onChange={vals => updateAttr(r._idx, { constraint: { enum: vals } })} />
              ) : <span className="text-text-muted">-</span>;
            }
            const base = baseOf(r.name);
            const baseEnum = base?.constraint?.enum || [];
            if (!base || !canEnum(base.type) || !baseEnum.length) return <span className="text-text-muted">-</span>;
            const current = restrictions[r.name]?.enum ?? baseEnum;
            return (
              <Select size="small" mode="multiple" style={{ width: '100%' }}
                value={current.map(String)}
                options={baseEnum.map(v => ({ value: String(v), label: String(v) }))}
                onChange={(vals: string[]) => {
                  if (!vals.length) { message.warning('继承属性的枚举不能删空（如需完全继承请点“恢复继承”）'); return; }
                  const next = baseEnum.filter(v => vals.includes(String(v)));
                  setRestriction(r.name, { ...(restrictions[r.name] || {}), enum: next });
                }} />
            );
          }},
          { title: '匹配模式', width: 170, render: (_: any, r: AttrRow) => {
            if (r._kind === 'own') {
              return canPattern(r.type) ? (
                <Input size="small" value={r.constraint?.pattern || ''} placeholder="^\d{4}-\d{2}-\d{2}$"
                  status={patternInvalid(r.constraint?.pattern) ? 'error' : ''}
                  onChange={e => updateAttr(r._idx, { constraint: { pattern: e.target.value } })}
                  className="bg-dark-bg border-dark-border text-text-primary" />
              ) : <span className="text-text-muted">-</span>;
            }
            const base = baseOf(r.name);
            if (!base || !canPattern(base.type)) return <span className="text-text-muted">-</span>;
            const value = restrictions[r.name]?.pattern !== undefined ? restrictions[r.name]?.pattern : (base.constraint?.pattern || '');
            return (
              <Input size="small" value={value || ''} placeholder="可任意调整（留空 = 清除父模式）"
                status={patternInvalid(value) ? 'error' : ''}
                onChange={e => setRestriction(r.name, { ...(restrictions[r.name] || {}), pattern: e.target.value })}
                className="bg-dark-bg border-dark-border text-text-primary" />
            );
          }},
          { title: '取值范围', width: 160, render: (_: any, r: AttrRow) => {
            if (r._kind === 'own') {
              return canRange(r.type) ? (
                <Space.Compact block>
                  <InputNumber size="small" placeholder="最小" style={{ width: '50%' }}
                    value={r.constraint?.min ?? null} precision={r.type === 'integer' ? 0 : undefined}
                    onChange={v => updateAttr(r._idx, { constraint: { min: v ?? undefined } })}
                    className="bg-dark-bg border-dark-border text-text-primary" />
                  <InputNumber size="small" placeholder="最大" style={{ width: '50%' }}
                    value={r.constraint?.max ?? null} precision={r.type === 'integer' ? 0 : undefined}
                    onChange={v => updateAttr(r._idx, { constraint: { max: v ?? undefined } })}
                    className="bg-dark-bg border-dark-border text-text-primary" />
                </Space.Compact>
              ) : <span className="text-text-muted">-</span>;
            }
            const base = baseOf(r.name);
            if (!base || !canRange(base.type)) return <span className="text-text-muted">-</span>;
            const cur = restrictions[r.name] || {};
            const min = cur.min !== undefined ? cur.min : base.constraint?.min;
            const max = cur.max !== undefined ? cur.max : base.constraint?.max;
            return (
              <Space.Compact block>
                <InputNumber size="small" placeholder={base.constraint?.min != null ? `≥${base.constraint.min}` : '最小'} style={{ width: '50%' }}
                  value={min ?? null} min={base.constraint?.min ?? undefined} precision={base.type === 'integer' ? 0 : undefined}
                  onChange={v => setRestriction(r.name, { ...cur, min: v ?? undefined })}
                  className="bg-dark-bg border-dark-border text-text-primary" />
                <InputNumber size="small" placeholder={base.constraint?.max != null ? `≤${base.constraint.max}` : '最大'} style={{ width: '50%' }}
                  value={max ?? null} max={base.constraint?.max ?? undefined} precision={base.type === 'integer' ? 0 : undefined}
                  onChange={v => setRestriction(r.name, { ...cur, max: v ?? undefined })}
                  className="bg-dark-bg border-dark-border text-text-primary" />
              </Space.Compact>
            );
          } },
          { title: '示例', width: 110, render: (_: any, r: AttrRow) => (
            <Input size="small" value={r.example || ''} disabled={r._kind === 'inherited'} onChange={e => updateAttr(r._idx, { example: e.target.value })} placeholder="示例" className="bg-dark-bg border-dark-border text-text-primary" />
          )},
          { title: '操作', width: 110, render: (_: any, r: AttrRow) => (
            r._kind === 'inherited'
              ? <Button size="small" icon={<UndoOutlined />} disabled={!restrictions[r.name]} onClick={() => clearRestriction(r.name)}>恢复继承</Button>
              : <Button danger size="small" icon={<DeleteOutlined />} onClick={() => handleDeleteAttribute(r._idx)} />
          )},
        ]}
      />
      <div className="pt-3">
        <Button type="dashed" icon={<PlusOutlined />} onClick={handleAddAttribute} block>新增属性</Button>
      </div>
    </Modal>
  );
}
