'use client';

import { useEffect, useState, useMemo } from 'react';
import { Button, Modal, message, Spin } from 'antd';
import { ArrowLeftOutlined, SaveOutlined, RobotOutlined } from '@ant-design/icons';
import { getRequirementFile, saveRequirementFile, generateOntology } from '@/api/client';
import { renderMarkdown } from '@/lib/markdown';

interface Props {
  threadId: string;
  filename: string;
  onBack: () => void;
}

export default function RequirementViewer({ threadId, filename, onBack }: Props) {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const result = await getRequirementFile(threadId, filename);
      setContent(result.content);
      setDirty(false);
    } catch (e: any) {
      message.error('加载失败: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [threadId, filename]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveRequirementFile(threadId, filename, content);
      message.success('文件已保存');
      setDirty(false);
    } catch (e: any) {
      message.error('保存失败: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleGenerate = async () => {
    setShowConfirm(false);
    setGenerating(true);
    try {
      const result = await generateOntology(threadId, filename);
      message.success(`本体已生成！概念:${result.concepts} 关系:${result.relations} 行为:${result.behaviors} 规则:${result.rules} 事件:${result.events}`);
    } catch (e: any) {
      message.error('生成本体失败: ' + e.message);
    } finally {
      setGenerating(false);
    }
  };

  const renderedHtml = useMemo(() => renderMarkdown(content), [content]);

  if (loading) {
    return <div className="flex items-center justify-center h-64"><Spin /></div>;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Button type="text" icon={<ArrowLeftOutlined />} onClick={onBack} className="text-text-muted hover:text-text-primary" />
          <h3 className="text-base font-semibold text-text-primary">{filename}</h3>
          <span className="text-text-muted text-xs">会话: {threadId.slice(0, 8)}...</span>
        </div>
        <div className="flex items-center gap-2">
          <Button icon={<RobotOutlined />} onClick={() => setShowConfirm(true)} loading={generating} size="small">本体智能生成</Button>
          <Button type="primary" icon={<SaveOutlined />} onClick={handleSave} loading={saving} disabled={!dirty} size="small">保存</Button>
        </div>
      </div>

      {/* Split view */}
      <div className="flex-1 flex gap-4 overflow-hidden">
        {/* Left: editable markdown source */}
        <div className="flex-1 flex flex-col">
          <div className="text-xs text-text-muted mb-1 font-semibold uppercase tracking-wider">Markdown 原文（可编辑）</div>
          <textarea
            value={content}
            onChange={e => { setContent(e.target.value); setDirty(true); }}
            className="flex-1 bg-dark-bg border border-dark-border rounded-lg p-4 text-text-primary font-mono text-sm resize-none outline-none"
            spellCheck={false}
          />
        </div>

        {/* Right: rendered preview */}
        <div className="flex-1 flex flex-col">
          <div className="text-xs text-text-muted mb-1 font-semibold uppercase tracking-wider">预览（只读）</div>
          <div
            className="flex-1 bg-dark-card border border-dark-border rounded-lg p-4 overflow-y-auto"
            dangerouslySetInnerHTML={{ __html: renderedHtml }}
          />
        </div>
      </div>

      {/* Confirm generate ontology */}
      <Modal
        title="本体智能生成"
        open={showConfirm}
        onOk={handleGenerate}
        onCancel={() => setShowConfirm(false)}
        okText="确认生成"
        cancelText="取消"
        okButtonProps={{ danger: true }}
      >
        <div className="py-3 space-y-3">
          <p className="text-text-secondary text-sm">将根据当前需求文档，使用 AI 自动生成 <strong>ontology.yaml</strong> 文件。</p>
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
            <p className="text-amber-400 text-sm font-semibold">⚠ 警告</p>
            <p className="text-text-secondary text-sm mt-1">生成后将<strong className="text-red-400">覆盖替换</strong>当前本体目录下的 ontology.yaml 文件，此操作不可恢复！</p>
          </div>
          <p className="text-text-muted text-xs">请确认需求文档内容已完成后再生成。</p>
        </div>
      </Modal>

      {/* Generating modal */}
      <Modal
        title="生成本体"
        open={generating}
        footer={null}
        closable={false}
        centered
        width={350}
      >
        <div className="flex flex-col items-center py-6 gap-3">
          <Spin size="large" />
          <p className="text-text-secondary text-sm">AI 正在根据需求文档生成本体...</p>
          <p className="text-text-muted text-xs">请稍候，生成完成后将自动覆盖原文件</p>
        </div>
      </Modal>
    </div>
  );
}
