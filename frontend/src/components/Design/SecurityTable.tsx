'use client';

import { useEffect, useState } from 'react';
import { Button, Input, Select, message, Space, Tag } from 'antd';
import { EditOutlined, CheckOutlined, CloseOutlined } from '@ant-design/icons';
import {
  getSecurities, createSecurity, updateSecurity, deleteSecurity,
  getPermissions, createPermission, updatePermission, deletePermission,
  getBehaviors, getDataEngines,
  Security, Permission, Behavior, DataEngine,
} from '@/api/client';
import ResizableTable from '@/components/ResizableTable';

interface Props { ontologyId: number; activeTab?: string; }

/** 权限范围特殊值：everyone=所有用户（默认，不落盘）、disable=全部禁用。将来用户表落地后追加用户/组织选项。 */
const SCOPE_OPTIONS = [
  { label: '所有用户（默认）', value: 'everyone' },
  { label: '全部禁用', value: 'disable' },
];
const SCOPE_LABELS: Record<string, string> = { everyone: '所有用户', disable: '全部禁用' };

const CONFIRM_OPTIONS = [
  { label: '是', value: '是' },
  { label: '否', value: '否' },
];

/** 与 agent 端 ontology-gateway 的 isWrite 推导保持一致：op_type 优先，空则按数据引擎 HTTP method 兜底（SQL 推不出写，视为读）。 */
const WRITE_METHODS = ['POST', 'PATCH', 'DELETE', 'PUT'];
const resolveOpType = (b: Behavior, engines: DataEngine[]): { type: 'command' | 'query'; derived: boolean } => {
  if (b.op_type === 'command' || b.op_type === 'query') return { type: b.op_type, derived: false };
  const eng = engines.find(d => d.behavior_name === b.name);
  const isWrite = !!eng && eng.engine_type !== 'SQL'
    && WRITE_METHODS.includes((eng.target?.method || '').toUpperCase());
  return { type: isWrite ? 'command' : 'query', derived: true };
};

const scopeOf = (perm?: Permission): string[] =>
  perm ? (Array.isArray(perm.scope) ? perm.scope : [perm.scope]) : ['everyone'];

export default function SecurityTable({ ontologyId, activeTab }: Props) {
  const [securities, setSecurities] = useState<Security[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [behaviors, setBehaviors] = useState<Behavior[]>([]);
  const [dataEngines, setDataEngines] = useState<DataEngine[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingKey, setEditingKey] = useState('');
  const [editData, setEditData] = useState<Record<string, any>>({});

  const load = async () => {
    setLoading(true);
    try {
      const [secList, permList, behList, engList] = await Promise.all([
        getSecurities(ontologyId), getPermissions(ontologyId), getBehaviors(ontologyId), getDataEngines(ontologyId),
      ]);
      setSecurities(secList); setPermissions(permList); setBehaviors(behList); setDataEngines(engList);
    } catch (e: any) { message.error('加载失败: ' + e.message); } finally { setLoading(false); }
  };

  useEffect(() => { if (activeTab === 'securities') load(); }, [ontologyId, activeTab]);

  const isEditing = (name: string) => name === editingKey;

  const handleEdit = (b: Behavior) => {
    const sec = securities.find(s => s.action_name === b.name);
    const perm = permissions.find(p => p.action_name === b.name);
    const { type } = resolveOpType(b, dataEngines);
    setEditData({
      scope: scopeOf(perm),
      // command 默认是；sec.confirm === false 为显式关闭。query 行锁定否（不可编辑）。
      confirm: type === 'command' ? (sec?.confirm === false ? '否' : '是') : '否',
      audit_content: sec?.audit_content || '',
    });
    setEditingKey(b.name);
  };
  const handleCancel = () => { setEditingKey(''); setEditData({}); };

  const handleSave = async (b: Behavior) => {
    const sec = securities.find(s => s.action_name === b.name);
    const perm = permissions.find(p => p.action_name === b.name);
    const { type } = resolveOpType(b, dataEngines);
    try {
      // ── 权限范围：everyone 为默认不落盘；非 everyone 落盘（稀疏）──
      const vals: string[] = (editData.scope || ['everyone']).filter((v: string) => v !== 'everyone');
      if (vals.length > 0) {
        const scope = vals.length === 1 ? vals[0] : vals;
        if (perm) await updatePermission(ontologyId, b.name, { action_name: b.name, scope });
        else await createPermission(ontologyId, { action_name: b.name, scope });
      } else if (perm) {
        await deletePermission(ontologyId, b.name);
      }

      // ── 人工确认（仅 command 可编辑；query 锁定否不落盘）──
      if (type === 'command') {
        if (editData.confirm === '否') {
          // 显式关闭：confirm=false 落盘（audit_content 保留，重新开启时不丢）
          const payload: Security = { action_name: b.name, audit_node: sec?.audit_node || '前置', audit_content: editData.audit_content || '', confirm: false };
          if (sec) await updateSecurity(ontologyId, b.name, payload);
          else await createSecurity(ontologyId, payload);
        } else if ((editData.audit_content || '').trim()) {
          // 是 + 有确认内容：条目落盘，confirm 置 null 清除可能的显式关闭
          const payload: Security = { action_name: b.name, audit_node: sec?.audit_node || '前置', audit_content: editData.audit_content.trim(), confirm: null };
          if (sec) await updateSecurity(ontologyId, b.name, payload);
          else await createSecurity(ontologyId, payload);
        } else if (sec) {
          // 是 + 无内容：删条目，回到默认（运行面 isWrite 强制确认 + 通用文案）
          await deleteSecurity(ontologyId, b.name);
        }
      }

      message.success('安全设置已保存');
      setEditingKey(''); setEditData({}); await load();
    } catch (e: any) { message.error(e.message); }
  };

  /** everyone/disable 与任何其他值互斥（将来用户选项之间可共存）；清空视为 everyone。 */
  const onScopeChange = (vals: string[]) => {
    let v = [...vals];
    if (v.length > 1) {
      const last = v[v.length - 1];
      if (last === 'everyone' || last === 'disable') v = [last];
      else v = v.filter(x => x !== 'everyone' && x !== 'disable');
    }
    if (v.length === 0) v = ['everyone'];
    setEditData(p => ({ ...p, scope: v }));
  };

  const renderScope = (vals: string[]) => (
    <Space size={4} wrap>
      {vals.map(v => (
        <Tag key={v} color={v === 'disable' ? 'red' : v === 'everyone' ? 'green' : 'blue'} style={{ marginInlineEnd: 0 }}>
          {SCOPE_LABELS[v] || v}
        </Tag>
      ))}
    </Space>
  );

  const dataSource = behaviors.map(b => ({ ...b, _key: b.name }));

  const columns = [
    { title: '名称', dataIndex: 'name', key: 'name', width: 180, render: (v: any) => v || '-' },
    { title: '展示名称', dataIndex: 'display_name', key: 'display_name', width: 150, render: (v: any) => v || '-' },
    { title: '操作类型', key: 'op_type', width: 110, render: (_: any, r: Behavior) => {
      const { type, derived } = resolveOpType(r, dataEngines);
      return (
        <span>
          <Tag color={type === 'command' ? 'orange' : 'cyan'}>{type}</Tag>
          {derived && <span className="text-text-muted text-xs">（推导）</span>}
        </span>
      );
    }},
    { title: '权限范围', key: 'scope', width: 200, render: (_: any, r: Behavior) => {
      if (isEditing(r.name)) {
        return <Select size="small" mode="multiple" placeholder="选择权限范围" options={SCOPE_OPTIONS}
          value={editData.scope} onChange={onScopeChange} style={{ width: '100%' }} popupClassName="!bg-dark-card" />;
      }
      return renderScope(scopeOf(permissions.find(p => p.action_name === r.name)));
    }},
    { title: '人工确认', key: 'confirm', width: 90, render: (_: any, r: Behavior) => {
      const { type } = resolveOpType(r, dataEngines);
      if (type !== 'command') return <span className="text-text-muted">否</span>;
      const sec = securities.find(s => s.action_name === r.name);
      if (isEditing(r.name)) {
        return <Select size="small" value={editData.confirm} options={CONFIRM_OPTIONS}
          onChange={v => setEditData(p => ({ ...p, confirm: v }))} style={{ width: '100%' }} popupClassName="!bg-dark-card" />;
      }
      return sec?.confirm === false ? <Tag color="default">否</Tag> : <Tag color="orange">是</Tag>;
    }},
    { title: '确认内容', dataIndex: 'audit_content', key: 'audit_content', width: 240, ellipsis: true, render: (_: any, r: Behavior) => {
      const { type } = resolveOpType(r, dataEngines);
      if (type !== 'command') return <span className="text-text-muted">-</span>;
      const sec = securities.find(s => s.action_name === r.name);
      if (isEditing(r.name)) {
        // 人工确认=否时内容保留但不生效（置灰），重新开启时不丢
        return <Input size="small" value={editData.audit_content || ''} disabled={editData.confirm === '否'}
          placeholder="弹窗确认时展示的提示内容；留空则用通用文案"
          onChange={e => setEditData(p => ({ ...p, audit_content: e.target.value }))}
          className="bg-dark-bg border-dark-border text-text-primary" />;
      }
      if (sec?.confirm === false) return <span className="text-text-muted">{sec?.audit_content || '-'}</span>;
      return sec?.audit_content || '-';
    }},
    {
      title: '操作', key: 'actions', width: 80,
      render: (_: any, r: Behavior) => {
        if (isEditing(r.name)) {
          return <Space><Button type="link" size="small" icon={<CheckOutlined />} onClick={() => handleSave(r)} /><Button type="link" size="small" icon={<CloseOutlined />} onClick={handleCancel} /></Space>;
        }
        return <Button type="link" size="small" icon={<EditOutlined />} onClick={() => handleEdit(r)} disabled={editingKey !== ''} />;
      },
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-text-primary">安全管控</h3>
      </div>
      <p className="text-text-muted text-xs mb-1">对本体的所有行为设置权限范围与人工确认。权限范围：所有用户=默认可用、全部禁用=禁止使用。</p>
      <ResizableTable dataSource={dataSource} columns={columns} rowKey="_key" loading={loading} pagination={false} />
    </div>
  );
}
