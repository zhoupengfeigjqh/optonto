'use client';

import { useEffect, useState } from 'react';
import { Button, Input, Modal, message, Space, Tag, Table } from 'antd';
import { PlusOutlined, DeleteOutlined, RobotOutlined, EyeOutlined, EditOutlined, ArrowLeftOutlined, DownloadOutlined } from '@ant-design/icons';
import { getSkills, getSkillContent, saveSkillContent, deleteSkill, generateSkill, SkillSummary } from '@/api/client';
import MarkdownEditor from '@/components/MarkdownEditor';
import { renderMarkdown } from '@/lib/markdown';

interface Props { ontologyId: number; activeTab?: string; }

export default function SkillManagement({ ontologyId, activeTab }: Props) {
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [viewing, setViewing] = useState<{ name: string; content: string; saving: boolean } | null>(null);
  const [previewMode, setPreviewMode] = useState(false);
  const [genName, setGenName] = useState('');
  const [genDialogOpen, setGenDialogOpen] = useState(false);
  const [genLoading, setGenLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const list = await getSkills(ontologyId);
      setSkills(list);
    } catch (e: any) { message.error('加载失败: ' + e.message); }
    finally { setLoading(false); }
  };

  useEffect(() => { if (activeTab === 'skill-management') load(); }, [ontologyId, activeTab]);

  const handleView = async (name: string) => {
    try {
      const result = await getSkillContent(ontologyId, name);
      setViewing({ name: result.skill_name, content: result.content, saving: false });
      setPreviewMode(true);
    } catch (e: any) { message.error('加载失败: ' + e.message); }
  };

  const handleSave = async () => {
    if (!viewing) return;
    setViewing(p => p ? { ...p, saving: true } : null);
    try {
      await saveSkillContent(ontologyId, viewing.name, viewing.content);
      message.success('技能已保存');
      setViewing(p => p ? { ...p, saving: false } : null);
    } catch (e: any) { message.error('保存失败: ' + e.message); }
    finally { setViewing(p => p ? { ...p, saving: false } : null); }
  };

  const handleDownload = (name: string) => {
    const url = `/api/ontologies/${ontologyId}/skills/${encodeURIComponent(name)}/content`;
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}.md`;
    a.click();
  };

  const handleDelete = (name: string) => {
    Modal.confirm({
      title: <span style={{color:'#fff'}}>确认删除</span>,
      content: <span style={{color:'#ef4444'}}>删除技能「<strong>{name}</strong>」后不可恢复，确定要删除吗？</span>,
      okText: '确认删除', cancelText: '取消', okButtonProps: { danger: true },
      onOk: async () => { try { await deleteSkill(ontologyId, name); message.success('技能已删除'); await load(); } catch (e: any) { message.error(e.message); } },
    });
  };

  const handleGenerate = async () => {
    if (!genName.trim()) { message.warning('请输入技能名称'); return; }
    setGenLoading(true);
    try {
      const result = await generateSkill(ontologyId, genName.trim());
      setGenDialogOpen(false);
      setGenName('');
      // Auto-view the generated skill
      setViewing({ name: result.skill_name, content: result.content, saving: false });
      setPreviewMode(true);
      message.success('技能已生成');
    } catch (e: any) { message.error('生成失败: ' + e.message); }
    finally { setGenLoading(false); }
  };

  // Viewing mode
  if (viewing) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <Button icon={<ArrowLeftOutlined />} size="small" onClick={() => { setViewing(null); setPreviewMode(false); load(); }} />
            <h3 className="text-base font-semibold text-text-primary">{viewing.name}</h3>
          </div>
          <div className="flex items-center gap-2">
            <Button size="small" onClick={() => setPreviewMode(!previewMode)}>
              {previewMode ? '编辑' : '预览'}
            </Button>
            <Button size="small" loading={viewing.saving} onClick={handleSave}>保存</Button>
          </div>
        </div>

        {previewMode ? (
          <div className="flex-1 overflow-auto border border-dark-border rounded-lg bg-dark-bg p-6">
            <div className="prose prose-invert max-w-none text-text-primary"
              dangerouslySetInnerHTML={{ __html: renderMarkdown(viewing.content) }} />
          </div>
        ) : (
          <div className="flex-1 border border-dark-border rounded-lg overflow-hidden">
            <MarkdownEditor value={viewing.content} onChange={v => setViewing(p => p ? { ...p, content: v } : null)} className="h-full" />
          </div>
        )}
      </div>
    );
  }

  const columns = [
    { title: '技能名称', dataIndex: 'name', key: 'name', width: 160, render: (v: string) => <span className="text-text-primary">{v}</span> },
    { title: '状态', key: 'status', width: 80, render: (_: any, r: SkillSummary) => (
      <Tag color={r.has_skill ? 'green' : 'default'}>{r.has_skill ? '已生成' : '未生成'}</Tag>
    )},
      {
      title: '操作', key: 'actions', width: 140,
      render: (_: any, r: SkillSummary) => (
        <Space>
          {r.has_skill && <Button type="link" size="small" icon={<DownloadOutlined />} onClick={() => handleDownload(r.name)} />}
          <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => handleView(r.name)}>查看</Button>
          <Button type="link" size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(r.name)} />
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-text-primary">技能管理</h3>
        <Space>
          <Button icon={<PlusOutlined />} size="small" onClick={() => { setGenName(''); setGenDialogOpen(true); }}>新增技能</Button>
        </Space>
      </div>
      <p className="text-text-muted text-xs mb-3">管理和生成智能体技能文件（SKILL.md），用于指导智能体理解和使用本体。</p>

      <Table
        dataSource={skills}
        columns={columns}
        rowKey="name"
        loading={loading}
        locale={{ emptyText: '暂无技能，点击「新增技能」创建' }}
        pagination={false}
        className="bg-transparent"
      />

      {/* ─── Generate Dialog ──────────────────────────────────────────── */}
      <Modal
        title="新增技能"
        open={genDialogOpen}
        onOk={handleGenerate}
        onCancel={() => setGenDialogOpen(false)}
        okText="智能生成"
        cancelText="取消"
        confirmLoading={genLoading}
        width={500}
      >
        <div className="space-y-3">
          <div>
            <span className="text-text-muted text-xs">技能名称</span>
            <Input size="small" value={genName} disabled className="bg-dark-bg border-dark-border text-text-primary" />
          </div>
        </div>
      </Modal>
    </div>
  );
}
