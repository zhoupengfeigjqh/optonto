'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { message, Button, Spin } from 'antd';
import { SaveOutlined, CaretRightFilled, CaretDownFilled } from '@ant-design/icons';
import { getFileContent, saveFileContent } from '@/api/client';

interface Props {
  ontologyId: number;
  activeTab?: string;
}

const DEPTH_COLORS = [
  'text-blue-400',
  'text-green-400',
  'text-amber-400',
  'text-purple-400',
  'text-pink-400',
  'text-text-secondary',
];

const DEPTH_BORDER = [
  'border-l-blue-500/30',
  'border-l-green-500/30',
  'border-l-amber-500/30',
  'border-l-purple-500/30',
  'border-l-pink-500/30',
  'border-l-text-muted/20',
];

interface TreeLine {
  lineNumber: number;
  indent: number;
  text: string;
  collapsed: boolean;
  hasChildren: boolean;
}

export default function FileViewer({ ontologyId, activeTab }: Props) {
  const [rawLines, setRawLines] = useState<string[]>([]);
  const [tree, setTree] = useState<TreeLine[]>([]);
  const [collapsedSet, setCollapsedSet] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [editingLine, setEditingLine] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [metadata, setMetadata] = useState<{ name: string; source_file: string; source_thread: string; created_at: string } | null>(null);

  const parseMetadata = useCallback((lines: string[]) => {
    const meta: { name: string; source_file: string; source_thread: string; created_at: string } = { name: '', source_file: '', source_thread: '', created_at: '' };
    let inMeta = false;
    for (const line of lines) {
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

  const buildTree = useCallback((lines: string[]): TreeLine[] => {
    const result: TreeLine[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trimEnd();
      const indent = line.length - line.trimStart().length;
      const text = trimmed.substring(indent);

      // Determine if this line has children by looking ahead
      let hasChildren = false;
      for (let j = i + 1; j < lines.length; j++) {
        const nextIndent = lines[j].length - lines[j].trimStart().length;
        if (nextIndent <= indent) break;
        if (nextIndent > indent) { hasChildren = true; break; }
      }

      result.push({
        lineNumber: i,
        indent,
        text,
        collapsed: false,
        hasChildren,
      });
    }

    return result;
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const file = await getFileContent(ontologyId);
      const lines = file.content.split('\n');
      setRawLines([...lines]);
      setTree(buildTree(lines));
      setCollapsedSet(new Set());
      setDirty(false);
      setShowRaw(false);
      setMetadata(parseMetadata(lines));
    } catch (e: any) {
      if (e.message.includes('不存在')) {
        const placeholder = '# 本体 YAML 文件\n# 将在创建概念后自动生成\n';
        const lines = placeholder.split('\n');
        setRawLines([...lines]);
        setTree(buildTree(lines));
        setMetadata(null);
      } else {
        message.error('加载文件失败: ' + e.message);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (activeTab === 'files') load(); }, [ontologyId, activeTab]);

  const toggleCollapse = (lineNum: number) => {
    setCollapsedSet(prev => {
      const next = new Set(prev);
      if (next.has(lineNum)) next.delete(lineNum);
      else next.add(lineNum);
      return next;
    });
  };

  const isLineVisible = useCallback((lineNum: number, collapsed: Set<number>, treeLines: TreeLine[]): boolean => {
    // Walk backwards to find if any ancestor is collapsed
    const line = treeLines[lineNum];
    if (!line || lineNum === 0) return true;
    let indent = line.indent;
    for (let i = lineNum - 1; i >= 0; i--) {
      const prev = treeLines[i];
      if (prev.indent < indent && collapsed.has(i)) return false;
      if (prev.indent < indent) indent = prev.indent;
    }
    return true;
  }, []);

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newContent = e.target.value;
    const lines = newContent.split('\n');
    setRawLines([...lines]);
    setTree(buildTree(lines));
    setDirty(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const content = rawLines.join('\n');
      await saveFileContent(ontologyId, { path: '', content });
      message.success('文件已保存，数据已同步');
      setDirty(false);
    } catch (e: any) {
      message.error('保存失败: ' + e.message);
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (lineNum: number) => {
    const line = rawLines[lineNum];
    const trimmed = line.trimEnd();
    const indent = line.length - line.trimStart().length;
    const text = trimmed.substring(indent);
    const colonIdx = text.indexOf(':');
    if (colonIdx === -1) return;

    const val = text.substring(colonIdx + 1).trimStart();
    // Don't edit lines that have children (structure lines)
    if (tree[lineNum]?.hasChildren && !val) return;

    setEditingLine(lineNum);
    setEditValue(val);
  };

  const commitEdit = (lineNum: number) => {
    if (editingLine !== lineNum) return;
    const line = rawLines[lineNum];
    const trimmed = line.trimEnd();
    const indent = line.length - line.trimStart().length;
    const text = trimmed.substring(indent);
    const colonIdx = text.indexOf(':');

    if (colonIdx === -1) { setEditingLine(null); return; }

    const key = text.substring(0, colonIdx + 1);
    const newLine = ' '.repeat(indent) + key + ' ' + editValue;

    const updated = [...rawLines];
    updated[lineNum] = newLine;
    setRawLines(updated);
    setTree(buildTree(updated));
    setDirty(true);
    setEditingLine(null);
  };

  const handleEditKeyDown = (e: React.KeyboardEvent, lineNum: number) => {
    if (e.key === 'Enter') { e.preventDefault(); commitEdit(lineNum); }
    if (e.key === 'Escape') { setEditingLine(null); }
  };

  const visibleLines = tree.filter(l => isLineVisible(l.lineNumber, collapsedSet, tree));

  const renderTreeView = () => (
    <div className="font-mono text-sm overflow-auto" style={{ maxHeight: 'calc(100vh - 280px)' }}>
      {visibleLines.map((node, idx) => {
        const depth = Math.min(node.indent / 2, 5);
        const colorClass = DEPTH_COLORS[depth];
        const borderColor = DEPTH_BORDER[depth];
        const isCollapsed = collapsedSet.has(node.lineNumber);
        const isEditing = editingLine === node.lineNumber && !node.hasChildren;

        const colonIdx = node.text.indexOf(':');
        const key = colonIdx >= 0 ? node.text.substring(0, colonIdx + 1) : node.text;
        const val = colonIdx >= 0 ? node.text.substring(colonIdx + 1).trimStart() : '';

        return (
          <div
            key={node.lineNumber}
            className={`flex items-center gap-1 py-[1px] hover:bg-dark-hover/40 cursor-pointer border-l-2 ${borderColor}`}
            style={{ paddingLeft: `${node.indent * 8 + 8}px` }}
            onClick={() => {
              if (node.hasChildren) toggleCollapse(node.lineNumber);
              else if (colonIdx >= 0) startEdit(node.lineNumber);
            }}
          >
            {/* Collapse toggle */}
            <span className="w-4 shrink-0 inline-flex justify-center">
              {node.hasChildren ? (
                isCollapsed
                  ? <CaretRightFilled style={{ fontSize: 10, color: '#64748b' }} />
                  : <CaretDownFilled style={{ fontSize: 10, color: '#64748b' }} />
              ) : (
                <span className="w-4" />
              )}
            </span>

            {/* Key */}
            <span className={`${colorClass} shrink-0`}>{key}</span>

            {/* Value */}
            {isEditing ? (
              <input
                className="bg-dark-bg border border-accent-blue rounded px-1 py-0 text-text-primary outline-none flex-1 min-w-0"
                value={editValue}
                onChange={e => setEditValue(e.target.value)}
                onBlur={() => commitEdit(node.lineNumber)}
                onKeyDown={e => handleEditKeyDown(e, node.lineNumber)}
                autoFocus
                onClick={e => e.stopPropagation()}
              />
            ) : colonIdx >= 0 && val ? (
              <span className={`${colorClass} truncate flex-1 min-w-0`}>{val}</span>
            ) : null}

            {/* Collapsed count badge */}
            {node.hasChildren && isCollapsed && (
              <span className="text-xs text-text-muted ml-2 shrink-0">
                {countHidden(node.lineNumber, tree)} 项
              </span>
            )}
          </div>
        );
      })}
    </div>
  );

  const countHidden = (lineNum: number, treeLines: TreeLine[]): number => {
    let count = 0;
    const startIndent = treeLines[lineNum]?.indent ?? 0;
    for (let i = lineNum + 1; i < treeLines.length; i++) {
      if (treeLines[i].indent <= startIndent) break;
      count++;
    }
    return count;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spin />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h3 className="text-base font-semibold text-text-primary">文件浏览 / 编辑</h3>
          <label className="flex items-center gap-2 text-sm text-text-muted cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showRaw}
              onChange={e => setShowRaw(e.target.checked)}
              className="rounded border-dark-border bg-dark-bg"
            />
            显示原始文本
          </label>
        </div>
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
        {showRaw
          ? '编辑 YAML 文件后点击保存，修改将同步到前后端。'
          : '点击 ▶ 展开/收拢节点，点击值进行编辑。'}
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
            {metadata.created_at && (
              <span className="text-text-muted">
                创建日期：<span className="text-text-primary">{metadata.created_at}</span>
              </span>
            )}
          </div>
        </div>
      )}

      <div className="flex-1 border border-dark-border rounded-lg overflow-hidden bg-dark-bg">
        {showRaw ? (
          <textarea
            ref={textareaRef}
            value={rawLines.join('\n')}
            onChange={handleTextChange}
            className="w-full h-full min-h-[60vh] bg-dark-bg text-text-primary font-mono text-sm p-4 resize-none outline-none border-0"
            spellCheck={false}
          />
        ) : (
          <div className="p-3">
            {/* Tree legend */}
            <div className="flex flex-wrap gap-3 mb-3 pb-2 border-b border-dark-border text-xs">
              <span className="text-blue-400">顶层</span>
              <span className="text-green-400">第二层</span>
              <span className="text-amber-400">第三层</span>
              <span className="text-purple-400">第四层</span>
              <span className="text-pink-400">第五层</span>
              <span className="text-text-muted">编辑提示：点击值直接修改</span>
            </div>
            {renderTreeView()}
          </div>
        )}
      </div>
    </div>
  );
}
