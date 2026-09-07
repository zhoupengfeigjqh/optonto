'use client';

import { useEffect, useState } from 'react';
import { Button, Input, Select, message, Space, Tag } from 'antd';
import { EditOutlined, CheckOutlined, CloseOutlined } from '@ant-design/icons';
import {
  getSecurities, createSecurity, updateSecurity,
  getBehaviors, getDataEngines,
  Security, Behavior, DataEngine,
} from '@/api/client';
import ResizableTable from '@/components/ResizableTable';

interface Props { ontologyId: number; activeTab?: string; }

/** 权限范围特殊值：everyone=所有用户（默认）、disable=全部禁用。将来用户表落地后追加用户/组织选项。 */
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

const scopeOf = (sec?: Security): string[] =>
  sec?.scope ? (Array.isArray(sec.scope) ? sec.scope : [sec.scope]) : ['everyone'];

export default function SecurityTable({ ontologyId, activeTab }: Props) {
  const [securities, setSecurities] = useState<Security[]>([]);
  const [behaviors, setBehaviors] = useState<Behavior[]>([]);
  const [dataEngines, setDataEngines] = useState<DataEngine[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingKey, setEditingKey] = useState('');
  const [editData, setEditData] = useState<Record<string, any>>({});

  const load = async () => {
    setLoading(true);
    try {
      const [secList, behList, engList] = await Promise.all([
        getSecurities(ontologyId), getBehaviors(ontologyId), getDataEngines(ontologyId),
      ]);
      setSecurities(secList); setBehaviors(behList); setDataEngines(engList);
    } catch (e: any) { message.error('加载失败: ' + e.message); } finally { setLoading(false); }
  };

  useEffect(() => { if (activeTab === 'securities') load(); }, [ontologyId, activeTab]);

  const isEditing = (name: string) => name === editingKey;

  const handleEdit = (b: Behavior) => {
    const sec = securities.find(s => s.action_name === b.name);
    const { type } = resolveOpType(b, dataEngines);
    setEditData({
      scope: scopeOf(sec),
      // command 默认是；sec.confirm === false 为显式关闭。query 行锁定否（不可编辑）。
      confirm: type === 'command' ? (sec?.confirm === false ? '否' : '是') : '否',
      confirm_content: sec?.confirm_content || '',
    });
    setEditingKey(b.name);
  };
  const handleCancel = () => { setEditingKey(''); setEditData({}); };

  const handleSave = async (b: Behavior) => {
    const sec = securities.find(s => s.action_name === b.name);
    const { type } = resolveOpType(b, dataEngines);
    try {
      // 全字段恒落盘：界面填什么 yaml 存什么（scope 恒数组；query 行确认锁定否）
      const vals: string[] = editData.scope?.length ? editData.scope : ['everyone'];
      const payload: Security = {
        action_name: b.name,
        scope: vals,
        confirm: type === 'command' ? editData.confirm === '是' : false,
        confirm_content: type === 'command' ? (editData.confirm_content || '').trim() : '',
      };
      if (sec) await updateSecurity(ontologyId, b.name, payload);
      else await createSecurity(ontologyId, payload);

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
    { title: '英文名称', dataIndex: 'name', key: 'name', width: 180, render: (v: any) => v || '-' },
    { title: '中文名称', dataIndex: 'display_name', key: 'display_name', width: 150, render: (v: any) => v || '-' },
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
      return renderScope(scopeOf(securities.find(s => s.action_name === r.name)));
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
    { title: '确认内容', dataIndex: 'confirm_content', key: 'confirm_content', width: 240, ellipsis: true, render: (_: any, r: Behavior) => {
      const { type } = resolveOpType(r, dataEngines);
      if (type !== 'command') return <span className="text-text-muted">-</span>;
      const sec = securities.find(s => s.action_name === r.name);
      if (isEditing(r.name)) {
        // 人工确认=否时内容保留但不生效（置灰），重新开启时不丢
        return <Input size="small" value={editData.confirm_content || ''} disabled={editData.confirm === '否'}
          placeholder="弹窗确认时展示的提示内容；留空则用通用文案"
          onChange={e => setEditData(p => ({ ...p, confirm_content: e.target.value }))}
          className="bg-dark-bg border-dark-border text-text-primary" />;
      }
      if (sec?.confirm === false) return <span className="text-text-muted">{sec?.confirm_content || '-'}</span>;
      return sec?.confirm_content || '-';
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
      <p className="text-text-muted text-xs mb-1">对本体的所有行为设置权限范围与人工确认。权限范围：所有用户=默认可用、全部禁用=禁止使用（运行面过滤待后续实施）。人工确认：command 默认「是」，可配「否」（配否后执行不再弹确认窗）；query 无需确认。保存即将本行全部配置写入 ontology.yaml。</p>
      <ResizableTable dataSource={dataSource} columns={columns} rowKey="_key" loading={loading} pagination={false} />
    </div>
  );
}
