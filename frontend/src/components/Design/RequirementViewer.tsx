'use client';

import { useEffect, useState, useMemo } from 'react';
import { Button, Modal, Select, message, Spin } from 'antd';
import { ArrowLeftOutlined, SaveOutlined, RobotOutlined, EyeOutlined } from '@ant-design/icons';
import { getRequirementFile, saveRequirementFile, generateOntology, getOntologyTemplateSections } from '@/api/client';
import { renderMarkdown } from '@/lib/markdown';
import MarkdownEditor from '@/components/MarkdownEditor';
import CodeMirror from '@uiw/react-codemirror';
import { yaml as yamlLang } from '@codemirror/lang-yaml';
import { splitDoc, assemble, ALL, KEY_LABELS, Doc } from '@/utils/yaml-segments';

/** 生成范围（勾选的一级目录）记忆键 */
const SECTIONS_STORAGE_KEY = 'optonto.generate.sections';

interface Props {
  threadId: string;
  filename: string;
  onBack: () => void;
  scenarioName?: string;
  ontologyName?: string;
}

export default function RequirementViewer({ threadId, filename, onBack, scenarioName, ontologyName }: Props) {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const [ontologyDoc, setOntologyDoc] = useState<Doc | null>(null);
  const [activeKey, setActiveKey] = useState<string>(ALL);
  const [ontologyLoading, setOntologyLoading] = useState(false);
  const [sections, setSections] = useState<string[]>([]);
  const [selectedSections, setSelectedSections] = useState<string[]>([]);

  // 模板一级目录（后端动态解析）；默认全选，并用 localStorage 记忆上次勾选
  useEffect(() => {
    let cancelled = false;
    getOntologyTemplateSections()
      .then(res => {
        if (cancelled) return;
        const all = res.sections.filter(s => s !== 'metadata');
        setSections(all);
        let saved: string[] = [];
        try {
          const raw = localStorage.getItem(SECTIONS_STORAGE_KEY);
          if (raw) saved = (JSON.parse(raw) as string[]).filter(s => all.includes(s));
        } catch { /* ignore */ }
        setSelectedSections(saved.length ? saved : all);
      })
      .catch(() => { /* 模板不可用时静默降级为「不限」 */ });
    return () => { cancelled = true; };
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const result = await getRequirementFile(threadId, filename, scenarioName, ontologyName);
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

  // 目标 yaml 文件名（与本体生成输出到同一目录）
  const yamlFilename = filename.replace(/\.md$/, '.yaml');

  const handleGenerate = async () => {
    setShowConfirm(false);
    setGenerating(true);
    try {
      localStorage.setItem(SECTIONS_STORAGE_KEY, JSON.stringify(selectedSections));
    } catch { /* ignore */ }
    try {
      const result = await generateOntology(threadId, filename, selectedSections);
      const parts = Object.entries(result.stats)
        .filter(([, v]) => v > 0)
        .map(([k, v]) => `${KEY_LABELS[k] ?? k}:${v}`);
      const detail = parts.length ? `（${parts.join(' ')}）` : '（各一级目录均无内容）';
      message.success(`已生成 ${result.filename}${detail}`);
    } catch (e: any) {
      message.error('生成本体失败: ' + e.message);
    } finally {
      setGenerating(false);
    }
  };

  const handleViewOntology = async () => {
    // 查看当前需求文档生成的 yaml（与本体生成输出到同一 thread 目录）
    setViewOpen(true);
    setOntologyLoading(true);
    setOntologyDoc(null);
    setActiveKey(ALL);
    try {
      const file = await getRequirementFile(threadId, yamlFilename, scenarioName, ontologyName);
      setOntologyDoc(splitDoc(file.content));
    } catch (e: any) {
      if (e.message.includes('不存在')) {
        setOntologyDoc(null);
      } else {
        message.error('加载本体失败: ' + e.message);
      }
    } finally {
      setOntologyLoading(false);
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
          <Button
            type={previewMode ? 'default' : 'primary'}
            size="small"
            onClick={() => setPreviewMode(!previewMode)}
          >
            {previewMode ? '编辑模式' : '预览模式'}
          </Button>
          <Button icon={<RobotOutlined />} onClick={() => setShowConfirm(true)} loading={generating} size="small">本体生成</Button>
          <Button icon={<EyeOutlined />} onClick={handleViewOntology} size="small">本体文件</Button>
          {!previewMode && (
            <Button type="primary" icon={<SaveOutlined />} onClick={handleSave} loading={saving} disabled={!dirty} size="small">保存</Button>
          )}
        </div>
      </div>

      {/* Single view with toggle */}
      <div className="flex-1 overflow-hidden" style={{ minHeight: 0 }}>
        {previewMode ? (
          <div className="h-full flex flex-col">
            <div className="text-xs text-text-muted mb-1 font-semibold uppercase tracking-wider">预览（只读）</div>
            <div
              className="flex-1 bg-dark-card border border-dark-border rounded-lg p-4 overflow-y-auto"
              dangerouslySetInnerHTML={{ __html: renderedHtml }}
            />
          </div>
        ) : (
          <div className="h-full flex flex-col" style={{ minHeight: 0 }}>
            <div className="text-xs text-text-muted mb-1 font-semibold uppercase tracking-wider">编辑</div>
            <div className="flex-1 bg-dark-bg border border-dark-border rounded-lg overflow-hidden" style={{ minHeight: 0 }}>
              <MarkdownEditor
                value={content}
                onChange={v => { setContent(v); setDirty(true); }}
                className="w-full h-full"
              />
            </div>
          </div>
        )}
      </div>

      {/* Confirm generate ontology */}
      <Modal
        title="本体生成"
        open={showConfirm}
        onOk={handleGenerate}
        onCancel={() => setShowConfirm(false)}
        okText="确认生成"
        cancelText="取消"
        okButtonProps={{ danger: true, disabled: selectedSections.length === 0 }}
      >
        <div className="py-3 space-y-3">
          <p className="text-text-secondary text-sm">将根据当前需求文档，使用 AI 自动生成 <strong>{yamlFilename}</strong> 文件。</p>
          <div>
            <p className="text-text-secondary text-sm mb-1">
              生成范围（模板一级目录）<span className="text-text-muted text-xs"> · 只加载勾选的目录，避免生成与本文件无关的内容</span>
            </p>
            <Select
              mode="multiple"
              style={{ width: '100%' }}
              placeholder="选择要生成的一级目录"
              value={selectedSections}
              onChange={setSelectedSections}
              loading={sections.length === 0}
              maxTagCount="responsive"
              options={sections.map(s => ({ value: s, label: KEY_LABELS[s] ? `${KEY_LABELS[s]}（${s}）` : s }))}
            />
            <p className="text-text-muted text-xs mt-1">
              metadata（元数据）恒生成，无需勾选；至少选择一项（默认全选，等价加载完整模板）。
            </p>
          </div>
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3">
            <p className="text-amber-400 text-sm font-semibold">⚠ 警告</p>
            <p className="text-text-secondary text-sm mt-1">生成后将<strong className="text-red-400">覆盖替换</strong>当前目录下的 {yamlFilename} 文件，此操作不可恢复！</p>
          </div>
          <p className="text-text-muted text-xs">请确认需求文档内容已完成后再生成。</p>
        </div>
      </Modal>

      {/* Generating modal */}
      <Modal
        title="本体生成"
        open={generating}
        footer={null}
        closable={false}
        centered
        width={350}
      >
        <div className="flex flex-col items-center py-6 gap-3">
          <Spin size="large" />
          <p className="text-text-secondary text-sm">AI 正在根据需求文档生成本体...</p>
          <p className="text-text-muted text-xs">请稍候，生成完成后将自动覆盖 {yamlFilename}</p>
        </div>
      </Modal>

      {/* View ontology modal */}
      <Modal
        title="本体文件"
        open={viewOpen}
        onCancel={() => setViewOpen(false)}
        footer={null}
        centered
        width={900}
      >
        {ontologyLoading ? (
          <div className="flex flex-col items-center py-10 gap-3">
            <Spin />
            <p className="text-text-muted text-sm">正在加载本体 YAML...</p>
          </div>
        ) : ontologyDoc === null ? (
          <div className="py-10 text-center text-text-muted text-sm">
            当前本体尚未生成或文件不存在，请先点击「本体生成」。
          </div>
        ) : (
          <div className="flex border border-dark-border rounded-lg overflow-hidden bg-dark-bg">
            {ontologyDoc.segs.length > 0 && (
              <div className="w-28 shrink-0 border-r border-dark-border py-2 overflow-y-auto">
                {[ALL, ...ontologyDoc.segs.map(s => s.key)].map(k => (
                  <button
                    key={k}
                    onClick={() => setActiveKey(k)}
                    className={`w-full text-left px-3 py-1.5 text-sm transition-colors ${
                      activeKey === k
                        ? 'text-accent-blue bg-accent-blue/5 border-r-2 border-accent-blue'
                        : 'text-text-muted hover:text-text-secondary'
                    }`}
                  >
                    {k === ALL ? '全部' : (KEY_LABELS[k] || k)}
                  </button>
                ))}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <CodeMirror
                value={activeKey === ALL
                  ? assemble(ontologyDoc)
                  : (ontologyDoc.segs.find(s => s.key === activeKey)?.text ?? '')}
                extensions={[yamlLang()]}
                theme="dark"
                height="60vh"
                editable={false}
                style={{ fontSize: 13 }}
                basicSetup={{
                  lineNumbers: true,
                  foldGutter: true,
                  highlightActiveLine: true,
                  autocompletion: false,
                }}
              />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
