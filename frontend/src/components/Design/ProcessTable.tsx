'use client';

import { useEffect, useState } from 'react';
import { Button, Input, Select, Modal, message, Space, Tag } from 'antd';
import { PlusOutlined, DeleteOutlined, EditOutlined } from '@ant-design/icons';
import { getProcesses, createProcess, updateProcess, deleteProcess, getBehaviors, Process, ProcessStep, Behavior } from '@/api/client';
import ResizableTable from '@/components/ResizableTable';

interface Props { ontologyId: number; activeTab?: string; }

const CONNECTION_OPTIONS = [
  { label: '串行', value: '串行' },
  { label: '并行', value: '并行' },
];

const EMPTY_STEP: ProcessStep = { current_step: '', previous_step: '', name: '', display_name: '', description: '', related_action: '', connection_type: '串行' };

export default function ProcessTable({ ontologyId, activeTab }: Props) {
  const [processes, setProcesses] = useState<Process[]>([]);
  const [behaviors, setBehaviors] = useState<Behavior[]>([]);
  const [loading, setLoading] = useState(false);

  // Edit modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editProcess, setEditProcess] = useState<Process>({ name: '', display_name: '', goal: '', description: '', steps: [] });
  const [steps, setSteps] = useState<ProcessStep[]>([]);
  const [isNew, setIsNew] = useState(false);
  const [origName, setOrigName] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [procList, behList] = await Promise.all([getProcesses(ontologyId), getBehaviors(ontologyId)]);
      setProcesses(procList); setBehaviors(behList);
    } catch (e: any) { message.error('加载失败: ' + e.message); } finally { setLoading(false); }
  };

  useEffect(() => { if (activeTab === 'processes') load(); }, [ontologyId, activeTab]);

  const behaviorOptions = behaviors.map(b => ({ label: b.name, value: b.name }));

  const openAdd = () => {
    setEditProcess({ name: '', display_name: '', goal: '', description: '', steps: [] });
    setSteps([]);
    setIsNew(true);
    setOrigName('');
    setModalOpen(true);
  };

  const openEdit = (p: Process) => {
    setEditProcess({ ...p });
    setSteps(p.steps ? [...p.steps] : []);
    setIsNew(false);
    setOrigName(p.name);
    setModalOpen(true);
  };

  const handleDelete = (name: string) => {
    Modal.confirm({
      title: <span style={{color:'#fff'}}>确认删除</span>, content: <span style={{color:'#ef4444'}}>删除流程「<strong>{name}</strong>」后不可恢复，确定要删除吗？</span>,
      okText: '确认删除', cancelText: '取消', okButtonProps: { danger: true },
      onOk: async () => { try { await deleteProcess(ontologyId, name); message.success('流程已删除'); await load(); } catch (e: any) { message.error(e.message); } },
    });
  };

  const handleStepChange = (idx: number, field: keyof ProcessStep, value: string) => {
    const n = [...steps];
    n[idx] = { ...n[idx], [field]: value };
    setSteps(n);
  };

  const handleAddStep = () => {
    if (!steps.some(s => !s.name)) {
      setSteps([...steps, { ...EMPTY_STEP }]);
    }
  };

  const handleDeleteStep = (idx: number) => setSteps(steps.filter((_, i) => i !== idx));

  const handleSave = async () => {
    if (!editProcess.name?.trim()) { message.warning('请输入流程名称'); return; }
    const data: Process = { ...editProcess, name: editProcess.name.trim(), steps };
    try {
      if (isNew) {
        if (processes.some(p => p.name === data.name)) { message.warning('流程名称已存在'); return; }
        await createProcess(ontologyId, data); message.success('流程已添加');
      } else {
        await updateProcess(ontologyId, origName, data); message.success('流程已更新');
      }
      setModalOpen(false); await load();
    } catch (e: any) { message.error(e.message); }
  };

  const columns = [
    { title: '名称', dataIndex: 'name', key: 'name', width: 100 },
    { title: '展示名称', dataIndex: 'display_name', key: 'display_name', width: 120, render: (v: string) => v || '-' },
    { title: '流程目标', dataIndex: 'goal', key: 'goal', width: 150, ellipsis: true, render: (v: string) => v || '-' },
    { title: '描述', dataIndex: 'description', key: 'description', width: 200, ellipsis: true, render: (v: string) => v || '-' },
    { title: '步骤数', key: 'steps_count', width: 70, render: (_: any, r: Process) => <Tag color="blue">{r.steps?.length || 0}</Tag> },
    {
      title: '操作', key: 'actions', width: 120,
      render: (_: any, record: Process) => (
        <Space>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(record)}>编辑</Button>
          <Button type="link" size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(record.name)} />
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-text-primary">流程管理</h3>
        <Button type="primary" icon={<PlusOutlined />} onClick={openAdd}>新增流程</Button>
      </div>

      <ResizableTable dataSource={processes.map(p => ({ ...p, _key: p.name }))} columns={columns} rowKey="_key" loading={loading} pagination={false} />

      <Modal
        title={isNew ? '新增流程' : `编辑流程 - ${origName}`}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        width={950}
        footer={
          <div className="flex justify-start gap-2">
            <Button onClick={() => setModalOpen(false)}>取消</Button>
            <Button type="primary" onClick={handleSave}>保存</Button>
          </div>
        }
      >
        {/* Basic fields */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className="text-text-muted text-xs mb-1 block">名称</label>
            <Input value={editProcess.name} onChange={e => setEditProcess(p => ({...p, name: e.target.value}))} className="bg-dark-bg border-dark-border text-text-primary" placeholder="流程英文名称" />
          </div>
          <div>
            <label className="text-text-muted text-xs mb-1 block">展示名称</label>
            <Input value={editProcess.display_name || ''} onChange={e => setEditProcess(p => ({...p, display_name: e.target.value}))} className="bg-dark-bg border-dark-border text-text-primary" placeholder="流程展示名称" />
          </div>
          <div>
            <label className="text-text-muted text-xs mb-1 block">流程目标</label>
            <Input value={editProcess.goal || ''} onChange={e => setEditProcess(p => ({...p, goal: e.target.value}))} className="bg-dark-bg border-dark-border text-text-primary" placeholder="流程目标" />
          </div>
          <div>
            <label className="text-text-muted text-xs mb-1 block">描述</label>
            <Input value={editProcess.description || ''} onChange={e => setEditProcess(p => ({...p, description: e.target.value}))} className="bg-dark-bg border-dark-border text-text-primary" placeholder="流程描述" />
          </div>
        </div>

        {/* Steps section */}
        <div className="border-t border-dark-border pt-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-text-primary">流程步骤</span>
            <Button size="small" icon={<PlusOutlined />} onClick={handleAddStep}>添加步骤</Button>
          </div>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {steps.map((step, idx) => (
              <div key={idx} className="flex items-center gap-1.5">
                <Input size="small" value={step.current_step} onChange={e => handleStepChange(idx, 'current_step', e.target.value)} className="w-20 bg-dark-bg border-dark-border text-text-primary" placeholder="当前步骤" />
                <Input size="small" value={step.previous_step} onChange={e => handleStepChange(idx, 'previous_step', e.target.value)} className="w-20 bg-dark-bg border-dark-border text-text-primary" placeholder="上一步骤" />
                <Input size="small" value={step.name} onChange={e => handleStepChange(idx, 'name', e.target.value)} className="w-24 bg-dark-bg border-dark-border text-text-primary" placeholder="步骤名称" />
                <Input size="small" value={step.display_name || ''} onChange={e => handleStepChange(idx, 'display_name', e.target.value)} className="w-24 bg-dark-bg border-dark-border text-text-primary" placeholder="展示名" />
                <Input size="small" value={step.description || ''} onChange={e => handleStepChange(idx, 'description', e.target.value)} className="w-28 bg-dark-bg border-dark-border text-text-primary" placeholder="描述" />
                <Select size="small" value={step.related_action || undefined} onChange={v => handleStepChange(idx, 'related_action', v || '')} options={behaviorOptions} className="w-28" placeholder="关联动作" popupClassName="!bg-dark-card" allowClear />
                <Select size="small" value={step.connection_type || '串行'} onChange={v => handleStepChange(idx, 'connection_type', v)} options={CONNECTION_OPTIONS} className="w-20" popupClassName="!bg-dark-card" />
                <Button danger size="small" icon={<DeleteOutlined />} onClick={() => handleDeleteStep(idx)} />
              </div>
            ))}
            {steps.length === 0 && <p className="text-text-muted text-xs py-2">暂无步骤，点击"添加步骤"添加</p>}
          </div>
        </div>
      </Modal>
    </div>
  );
}
