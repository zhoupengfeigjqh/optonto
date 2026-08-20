'use client';

import { useEffect, useState, useCallback } from 'react';
import { message, Button, Spin } from 'antd';
import { SaveOutlined } from '@ant-design/icons';
import CodeMirror from '@uiw/react-codemirror';
import { yaml as yamlLang } from '@codemirror/lang-yaml';
import { load as parseYaml } from 'js-yaml';
import { getFileContent, saveFileContent } from '@/api/client';

interface Props {
  ontologyId: number;
  activeTab?: string;
}

/** 一级目录段：text 为该段原始文本（含段首 key 行，不含下一段） */
interface Seg { key: string; text: string }
interface Doc { header: string; segs: Seg[] }

const ALL = '__all__';

/** 顶层 key 中文映射（与本体明细页签命名一致），未映射的显示原 key */
const KEY_LABELS: Record<string, string> = {
  metadata: '元数据',
  concepts: '概念',
  relations: '关系',
  behaviors: '行为',
  functions: '函数',
  rules: '规则',
  processes: '流程',
  securities: '安全',
  data_engines: '数据引擎',
};

/** 按"0 缩进 + key: 形态"切分顶层段；第一个 key 之前的内容（如文件头注释）归入 header */
function splitDoc(content: string): Doc {
  const lines = content.split('\n');
  const boundaries: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l && !/^\s/.test(l) && !l.startsWith('#') && /^[A-Za-z_][\w-]*:/.test(l)) boundaries.push(i);
  }
  if (!boundaries.length) return { header: content, segs: [] };
  const header = lines.slice(0, boundaries[0]).join('\n');
  const segs: Seg[] = [];
  for (let b = 0; b < boundaries.length; b++) {
    const end = b + 1 < boundaries.length ? boundaries[b + 1] : lines.length;
    const segLines = lines.slice(boundaries[b], end);
    segs.push({ key: segLines[0].split(':')[0].trim(), text: segLines.join('\n') });
  }
  return { header, segs };
}

/** 段拼接回完整文档（split('\n')/join('\n') 对称，未编辑的段逐字节还原） */
function assemble(doc: Doc): string {
  return [doc.header, ...doc.segs.map(s => s.text)].filter(p => p !== '').join('\n');
}

/**
 * 本体文件浏览/编辑（CodeMirror 版）。
 * 左侧一级目录：点击只显示该顶层段的文本，编辑实时写回内存文档；
 * 保存时拼接全文整体提交——未查看的段保持原文，零改动风险。
 * 编辑器内核虚拟化渲染（只绘制可视区行），大文件不卡。
 */
export default function FileViewer({ ontologyId, activeTab }: Props) {
  const [doc, setDoc] = useState<Doc | null>(null);
  const [activeKey, setActiveKey] = useState<string>(ALL);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [metadata, setMetadata] = useState<{ name: string; source_file: string; source_thread: string; created_at: string; updated_at?: string } | null>(null);

  const parseMetadata = useCallback((text: string) => {
    const meta: { name: string; source_file: string; source_thread: string; created_at: string } = { name: '', source_file: '', source_thread: '', created_at: '' };
    let inMeta = false;
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (trimmed === 'metadata:') { inMeta = true; continue; }
      if (inMeta) {
        const indent = line.length - line.trimStart().length;
        if (indent < 2 || !trimmed.includes(':')) { inMeta = false; continue; }
        const colonIdx = trimmed.indexOf(':');
        const key = trimmed.substring(0, colonIdx).trim();
        const val = trimmed.substring(colonIdx + 1).trim().replace(/^['"]|['"]$/g, '');
        if (key in meta) (meta as any)[key] = val;
      }
    }
    return meta;
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const file = await getFileContent(ontologyId);
      setDoc(splitDoc(file.content));
      setActiveKey(ALL);
      setDirty(false);
      setMetadata({ ...parseMetadata(file.content), updated_at: file.updated_at });
    } catch (e: any) {
      if (e.message.includes('不存在')) {
        setDoc(splitDoc('# 本体 YAML 文件\n# 将在创建概念后自动生成\n'));
        setActiveKey(ALL);
        setMetadata(null);
      } else {
        message.error('加载文件失败: ' + e.message);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (activeTab === 'files') load(); }, [ontologyId, activeTab]);

  const handleSave = async () => {
    if (!doc) return;
    const content = assemble(doc);
    // 保存前 YAML 语法校验：分段编辑可能改坏缩进，拼回全文后先解析一道，避免写坏本体文件
    try {
      parseYaml(content);
    } catch (e: any) {
      message.error('YAML 语法错误，未保存：' + (e.reason || e.message));
      return;
    }
    setSaving(true);
    try {
      await saveFileContent(ontologyId, { path: '', content });
      message.success('文件已保存，数据已同步');
      setDirty(false);
      setMetadata({ ...parseMetadata(content), updated_at: metadata?.updated_at });
    } catch (e: any) {
      message.error('保存失败: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading || !doc) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spin />
      </div>
    );
  }

  const editorValue = activeKey === ALL
    ? assemble(doc)
    : (doc.segs.find(s => s.key === activeKey)?.text ?? '');

  const handleChange = (v: string) => {
    if (activeKey === ALL) {
      setDoc(splitDoc(v)); // 全文模式下编辑后直接重切段，保持单一数据源
    } else {
      setDoc({ ...doc, segs: doc.segs.map(s => s.key === activeKey ? { ...s, text: v } : s) });
    }
    setDirty(true);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-text-primary">文件浏览 / 编辑</h3>
        <Button
          type="primary"
          icon={<SaveOutlined />}
          onClick={handleSave}
          loading={saving}
          disabled={!dirty}
        >
          保存并同步
        </Button>
      </div>

      <p className="text-text-muted text-xs mb-3">
        左侧选择目录后仅显示该段内容；直接编辑 YAML（支持语法高亮、节点折叠、Ctrl-F 搜索），完成后点击保存，修改将同步到前后端。
      </p>

      {/* Metadata display */}
      {metadata && (metadata.source_file || metadata.created_at) && (
        <div className="flex justify-center mb-4">
          <div className="flex items-center gap-6 px-5 py-2 rounded-lg bg-dark-card border border-dark-border text-sm">
            {metadata.source_file && (
              <span className="text-text-muted">
                来源文件：<span className="text-text-primary font-medium">{metadata.source_file}</span>
              </span>
            )}
            {(metadata.updated_at || metadata.created_at) && (
              <span className="text-text-muted">
                更新日期：<span className="text-text-primary">{metadata.updated_at || metadata.created_at}</span>
              </span>
            )}
          </div>
        </div>
      )}

      <div className="flex-1 flex border border-dark-border rounded-lg overflow-hidden bg-dark-bg">
        {/* 一级目录（仅当文件存在顶层段时显示） */}
        {doc.segs.length > 0 && (
          <div className="w-28 shrink-0 border-r border-dark-border py-2 overflow-y-auto">
            {[ALL, ...doc.segs.map(s => s.key)].map(k => (
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
            value={editorValue}
            onChange={handleChange}
            extensions={[yamlLang()]}
            theme="dark"
            height="calc(100vh - 280px)"
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
    </div>
  );
}
