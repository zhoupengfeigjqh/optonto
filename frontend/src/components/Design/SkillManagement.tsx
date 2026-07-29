'use client';

import { useEffect, useState } from 'react';
import { Button, Input, Modal, message, Space, Tag, Table } from 'antd';
import { PlusOutlined, DeleteOutlined, EyeOutlined, EditOutlined, ArrowLeftOutlined, DownloadOutlined } from '@ant-design/icons';
import { getSkills, getSkillContent, saveSkillContent, deleteSkill, generateSkill, updateSkillMeta, SkillSummary } from '@/api/client';
import MarkdownEditor from '@/components/MarkdownEditor';
import { renderMarkdown } from '@/lib/markdown';

interface Props { ontologyId: number; activeTab?: string; }

export default function SkillManagement({ ontologyId, activeTab }: Props) {
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [viewing, setViewing] = useState<{ name: string; content: string; saving: boolean } | null>(null);
  const [previewMode, setPreviewMode] = useState(false);
  const [genName, setGenName] = useState('');
  const [genDesc, setGenDesc] = useState('');
  const [genDialogOpen, setGenDialogOpen] = useState(false);

  // edit dialog
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editSkill, setEditSkill] = useState<{ name: string; description: string }>({ name: '', description: '' });
  const [editLoading, setEditLoading] = useState(false);
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

  const handleView = (name: string) => {
    Modal.confirm({
      title: <span style={{color:'#fff'}}>技能文件说明</span>,
      content: (
        <div className="text-text-secondary text-sm space-y-2">
          <p>技能文件头部结构已固定，请勿修改：</p>
          <pre className="bg-dark-bg border border-dark-border rounded p-2 text-xs font-mono text-yellow-400">{`---
name: <英文名>
description: <技能描述>
---`}</pre>
          <p>修改内容时请保持 <code className="text-yellow-400">name</code> 为英文且头部结构不变。</p>
        </div>
      ),
      okText: '我知道了',
      cancelText: '取消',
      onOk: async () => {
        try {
          const result = await getSkillContent(ontologyId, name);
          setViewing({ name: result.skill_name, content: result.content, saving: false });
          setPreviewMode(true);
        } catch (e: any) { message.error('加载失败: ' + e.message); }
      },
    });
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

  const handleDownload = async (name: string) => {
    try {
      const result = await getSkillContent(ontologyId, name);
      const blob = new Blob([result.content], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${name}.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e: any) { message.error('下载失败: ' + e.message); }
  };

  const handleEdit = async () => {
    setEditLoading(true);
    try {
      await updateSkillMeta(ontologyId, editSkill.name, { description: editSkill.description });
      await load();
      setEditDialogOpen(false);
      message.success('技能已更新');
    } catch (e: any) { message.error('更新失败: ' + e.message); }
    finally { setEditLoading(false); }
  };

  const handleDelete = (name: string) => {
    Modal.confirm({
      title: <span style={{color:'#fff'}}>确认删除</span>,
      content: <span style={{color:'#ef4444'}}>删除技能「<strong>{name}</strong>」后不可恢复，确定要删除吗？</span>,
      okText: '确认删除', cancelText: '取消', okButtonProps: { danger: true },
      onOk: async () => { try { await deleteSkill(ontologyId, name); message.success('技能已删除'); await load(); } catch (e: any) { message.error(e.message); } },
    });
  };

  const isSkillNameValid = (v: string): { ok: boolean; msg: string } => {
    if (v.length < 1 || v.length > 64) return { ok: false, msg: '技能名称长度 1-64 个字符' };
    if (v !== v.toLowerCase()) return { ok: false, msg: '技能名称必须全部小写' };
    if (v.startsWith('-') || v.endsWith('-')) return { ok: false, msg: '连字符不能放在开头或结尾' };
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(v)) return { ok: false, msg: '只能使用小写字母 (a-z)、数字 (0-9) 和连字符 (-)' };
    if (v.includes('claude') || v.includes('anthropic')) return { ok: false, msg: '技能名称包含保留字 claude/anthropic' };
    return { ok: true, msg: '' };
  };

  const handleGenerate = async () => {
    const name = genName.trim();
    if (!name) { message.warning('请输入技能名称'); return; }
    const check = isSkillNameValid(name);
    if (!check.ok) { message.warning(check.msg); return; }
    setGenLoading(true);
    try {
      const result = await generateSkill(ontologyId, genName.trim(), genDesc.trim());
      setGenDialogOpen(false);
      setGenName('');
      setGenDesc('');
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
    { title: '技能名称', dataIndex: 'name', key: 'name', width: 140, render: (v: string) => <span className="text-text-primary">{v}</span> },
    { title: '技能简介', dataIndex: 'description', key: 'description', width: 200, ellipsis: true, render: (v: string) => <span className="text-text-secondary text-xs">{v || '-'}</span> },
    { title: '状态', key: 'status', width: 180, render: (_: any, r: SkillSummary) => {
      if (!r.has_skill) return <Tag color="default">未生成</Tag>;
      if (!r.format_ok) return <span className="text-red-400 text-xs">{r.format_error || '格式错误'}</span>;
      return <Tag color="green">已输出</Tag>;
    }},
      {
      title: '操作', key: 'actions', width: 180,
      render: (_: any, r: SkillSummary) => (
        <Space>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => { setEditSkill({ name: r.name, description: r.description || '' }); setEditDialogOpen(true); }}>编辑</Button>
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
          <Button icon={<PlusOutlined />} size="small" onClick={() => { setGenName(''); setGenDesc(''); setGenDialogOpen(true); }}>新增技能</Button>
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

      {/* ─── Edit Dialog ──────────────────────────────────────────────── */}
      <Modal title="编辑技能" open={editDialogOpen} onOk={handleEdit} onCancel={() => setEditDialogOpen(false)} okText="保存" cancelText="取消" confirmLoading={editLoading} width={500}>
        <div className="space-y-3">
          <div>
            <span className="text-text-muted text-xs">技能名称</span>
            <Input size="small" value={editSkill.name} disabled className="bg-dark-bg border-dark-border text-text-text-muted" />
          </div>
          <div>
            <span className="text-text-muted text-xs">技能简介</span>
            <Input size="small" value={editSkill.description} onChange={e => setEditSkill(p => ({...p, description: e.target.value}))} className="bg-dark-bg border-dark-border text-text-primary" />
          </div>
        </div>
      </Modal>

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
            <Input size="small" value={genName} onChange={e => setGenName(e.target.value)} disabled={genLoading} className="bg-dark-bg border-dark-border text-text-primary" placeholder="如 raw_material_skill" />
          </div>
          <div>
            <span className="text-text-muted text-xs">技能简介</span>
            <Input size="small" value={genDesc} onChange={e => setGenDesc(e.target.value)} className="bg-dark-bg border-dark-border text-text-primary" placeholder="简要描述该技能的用途" />
          </div>
        </div>
      </Modal>
    </div>
  );
}
