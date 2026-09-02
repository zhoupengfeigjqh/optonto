'use client';

import { useEffect, useState, useRef, useMemo } from 'react';
import { Button, Input, Modal, message, Space, Spin, Switch, Tooltip } from 'antd';
import { ArrowLeftOutlined, SendOutlined, ClearOutlined, RobotOutlined, UserOutlined, FileTextOutlined, FileSearchOutlined, CheckCircleFilled, CheckCircleOutlined, AuditOutlined } from '@ant-design/icons';
import { getThread, chatStream, clearChat, exportThread, validateAnalysis, ThreadMessage } from '@/api/client';
import { renderMarkdown } from '@/lib/markdown';

interface Props {
  threadId: string;
  onBack: () => void;
  scenarioName?: string;
  ontologyName?: string;
}

export default function ConversationChat({ threadId, onBack, scenarioName, ontologyName }: Props) {
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [title, setTitle] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const [showTitleModal, setShowTitleModal] = useState(false);
  const [exportOntoName, setExportOntoName] = useState('');
  const [exportContent, setExportContent] = useState('');
  const [exportVersion, setExportVersion] = useState('');
  const [validating, setValidating] = useState(false);
  const [validateResult, setValidateResult] = useState('');
  const [showValidateModal, setShowValidateModal] = useState(false);
  const [validateTime, setValidateTime] = useState('');
  const [savedValidate, setSavedValidate] = useState<{ result: string; updated_at: string } | null>(null);
  const [grilling, setGrilling] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const thread = await getThread(threadId, scenarioName, ontologyName);
      setTitle(thread.title);
      setMessages(thread.messages || []);
      setSavedValidate(thread.validate_result || null);
    } catch (e: any) {
      message.error('加载对话失败: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [threadId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
  }, [messages]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput('');
    setSending(true);

    const userMsg: ThreadMessage = { role: 'user', content: text, timestamp: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg]);

    const assistantMsg: ThreadMessage = { role: 'assistant', content: '', timestamp: '' };
    setMessages(prev => [...prev, assistantMsg]);

    abortRef.current = new AbortController();
    try {
      const response = await chatStream(threadId, text, grilling);
      if (!response.ok) throw new Error(await response.text());

      const reader = response.body?.getReader();
      if (!reader) throw new Error('无法获取响应流');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.done) break;
            setMessages(prev => {
              const updated = [...prev];
              const last = updated[updated.length - 1];
              if (last.role === 'assistant') {
                updated[updated.length - 1] = { ...last, content: last.content + (data.token || '') };
              }
              return updated;
            });
          } catch { /* skip parse errors */ }
        }
      }
    } catch (e: any) {
      if (e.name !== 'AbortError') {
        setMessages(prev => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last.role === 'assistant' && !last.content) {
            updated[updated.length - 1] = { ...last, content: `\n\n[错误: ${e.message}]` };
          }
          return updated;
        });
      }
    } finally {
      setSending(false);
      abortRef.current = null;
    }
  };

  const toggleSelect = (idx: number, isAssistant: boolean) => {
    if (!isAssistant) return;
    setSelectedIndex(prev => prev === idx ? null : idx);
  };

  const handleExport = () => {
    setExportOntoName(ontologyName || '');
    setExportContent('');
    setExportVersion('');
    setShowTitleModal(true);
  };

  const handleConfirmExport = async () => {
    if (!exportOntoName.trim()) { message.warning('请输入本体名'); return; }
    if (!exportContent.trim()) { message.warning('请输入内容'); return; }
    if (!exportVersion.trim()) { message.warning('请输入版本'); return; }
    setShowTitleModal(false);
    setExporting(true);
    try {
      const selectedList = selectedIndex !== null ? [selectedIndex] : [];
      const result = await exportThread(threadId, exportOntoName.trim(), exportContent.trim(), exportVersion.trim(), selectedList);
      message.success(`文档已生成: ${result.filename}`);
      setSelectedIndex(null);
    } catch (e: any) {
      message.error('导出失败: ' + e.message);
    } finally {
      setExporting(false);
    }
  };

  const handleValidate = async () => {
    setValidating(true);
    setValidateResult('');
    setValidateTime('');
    setShowValidateModal(true);
    try {
      const selectedList = selectedIndex !== null ? [selectedIndex] : [];
      const result = await validateAnalysis(threadId, selectedList);
      setValidateResult(result.result);
      // 后端已临时保存最新结果，前端同步缓存（时间以本地近似即可，仅展示用）
      const saved = { result: result.result, updated_at: new Date().toISOString() };
      setSavedValidate(saved);
      setValidateTime(saved.updated_at);
    } catch (e: any) {
      setValidateResult(`验证失败: ${e.message}`);
    } finally {
      setValidating(false);
    }
  };

  // 「分析结果」：回看最近一次已保存的验证结果，不重新触发验证
  const handleViewValidate = () => {
    if (!savedValidate) return;
    setValidating(false);
    setValidateResult(savedValidate.result);
    setValidateTime(savedValidate.updated_at);
    setShowValidateModal(true);
  };

  const handleClear = () => {
    Modal.confirm({
      title: <span style={{color:'#fff'}}>确认清空</span>,
      content: <span className="text-text-secondary">清空当前对话的所有消息，此操作不可恢复。</span>,
      okText: '确认清空', cancelText: '取消', okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await clearChat(threadId);
          setMessages([]);
          setSelectedIndex(null);
          message.success('对话已清空');
        } catch (e: any) { message.error(e.message); }
      },
    });
  };

  const hasSelected = selectedIndex !== null;

  // 消息列表用 useMemo 缓存，避免输入框按键时重新渲染 renderMarkdown
  const messagesContent = useMemo(() => messages.map((msg, idx) => {
    const isAssistant = msg.role === 'assistant';
    const isSelected = selectedIndex === idx;
    const hasContent = !!msg.content.trim();

    return (
      <div key={idx} className={`flex gap-3 ${isAssistant ? 'justify-start' : 'justify-end'}`}>
        {isAssistant && (
          <div className="w-8 h-8 rounded-full bg-accent-blue/20 flex items-center justify-center shrink-0">
            <RobotOutlined style={{ color: '#3b82f6', fontSize: 16 }} />
          </div>
        )}
        <div className={`relative max-w-[75%] rounded-xl px-4 py-2.5 text-sm ${
          isAssistant
            ? 'bg-dark-card border border-dark-border text-text-primary'
            : 'bg-accent-blue text-white'
        }`}>
          {isAssistant && msg.content ? (
            sending && idx === messages.length - 1 ? (
              <div className="whitespace-pre-wrap break-words text-sm">{msg.content}</div>
            ) : (
              <div className="prose prose-invert max-w-none text-sm" dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }} />
            )
          ) : (
            <div className="whitespace-pre-wrap break-words">{msg.content || (idx === messages.length - 1 && isAssistant ? <Spin size="small" /> : '')}</div>
          )}
          {msg.timestamp && (
            <div className={`text-xs mt-1 ${isAssistant ? 'text-text-muted' : 'text-white/60'}`}>
              {new Date(msg.timestamp).toLocaleTimeString()}
            </div>
          )}
          {isAssistant && hasContent && (
            <div
              className="absolute -bottom-2 -right-2 cursor-pointer transition-colors"
              onClick={(e) => { e.stopPropagation(); toggleSelect(idx, isAssistant); }}
            >
              {isSelected ? (
                <CheckCircleFilled style={{ color: '#3b82f6', fontSize: 18, background: '#0a0a0f', borderRadius: '50%' }} />
              ) : (
                <CheckCircleOutlined style={{ color: '#64748b', fontSize: 18, background: '#0a0a0f', borderRadius: '50%' }} />
              )}
            </div>
          )}
        </div>
        {!isAssistant && (
          <div className="w-8 h-8 rounded-full bg-accent-green/20 flex items-center justify-center shrink-0">
            <UserOutlined style={{ color: '#10b981', fontSize: 16 }} />
          </div>
        )}
      </div>
    );
  }), [messages, selectedIndex, sending]);

  if (loading) {
    return <div className="flex items-center justify-center h-64"><Spin /></div>;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <Button type="text" icon={<ArrowLeftOutlined />} onClick={onBack} className="text-text-muted hover:text-text-primary" />
          <h3 className="text-base font-semibold text-text-primary truncate max-w-md">{title || '新对话'}</h3>
        </div>
        <Space>
          <Tooltip title={hasSelected ? '对选中的助手回复做一致性和逻辑自洽性检查' : '请先点击助手回复右下角的 ○ 选中内容'}>
            <Button icon={<AuditOutlined />} onClick={handleValidate} disabled={!hasSelected} size="small">验证</Button>
          </Tooltip>
          <Tooltip title={savedValidate ? '查看最近一次验证的分析结果' : '暂无分析结果，请先选中助手回复并点击「验证」'}>
            <Button icon={<FileSearchOutlined />} onClick={handleViewValidate} disabled={!savedValidate} size="small">分析结果</Button>
          </Tooltip>
          <Tooltip title={hasSelected ? '将选中的助手回复导出为需求文档（保存到需求汇总）' : '请先点击助手回复右下角的 ○ 选中内容'}>
            <Button icon={<FileTextOutlined />} onClick={handleExport} disabled={!hasSelected} size="small">导出需求</Button>
          </Tooltip>
          <Tooltip title="清空当前对话的所有消息，此操作不可恢复">
            <Button icon={<ClearOutlined />} onClick={handleClear} disabled={messages.length === 0} size="small">清空对话</Button>
          </Tooltip>
        </Space>
      </div>

      {/* Messages */}
      {/* Messages：flex-1 撑满，顶满可用高度；输入框贴底 */}
      <div className="flex-1 min-h-0 overflow-y-auto space-y-4 mb-3 pr-2">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-text-muted">
            <RobotOutlined style={{ fontSize: 48, marginBottom: 16 }} />
            <p className="text-sm">开始一段新的需求探索对话</p>
            <p className="text-xs mt-1">输入您的问题或需求描述，如DB schema、API 文档和业务需求等，AI 将协助您梳理</p>
          </div>
        ) : messagesContent}
        <div ref={messagesEndRef} />
      </div>

      {/* Footer hint */}
      {messages.length > 0 && !hasSelected && (
        <div className="text-center text-text-muted text-xs mb-2">
          点击助手回复右下角的 ○ 选中内容，然后点击「导出需求」
        </div>
      )}

      {/* Input */}
      <div className="flex gap-2 items-end border-t border-dark-border pt-3">
        <div className="flex-1">
          <div className="flex items-center gap-1 mb-1 px-0.5">
            <Tooltip title="开启后，助手会先对模糊点、矛盾点和关键决策逐个发问（每题附推荐答案），收敛后再输出；同一小问题最多追问 3 轮">
              <span className="text-xs text-text-muted select-none">拷问模式</span>
            </Tooltip>
            <Switch size="small" checked={grilling} onChange={setGrilling} />
          </div>
          <Input.TextArea
            value={input}
            onChange={e => setInput(e.target.value)}
            onPressEnter={e => { if (!e.shiftKey) { e.preventDefault(); handleSend(); } }}
            placeholder="输入您的需求或问题... (Shift+Enter 换行)"
            rows={2}
            className="bg-dark-bg border-dark-border text-text-primary"
            disabled={sending}
          />
        </div>
        <Button
          type="primary"
          icon={<SendOutlined />}
          onClick={handleSend}
          loading={sending}
          disabled={!input.trim()}
          className="mb-0.5"
        >
          发送
        </Button>
      </div>

      {/* Export modal */}
      <Modal
        title="导出需求文档"
        open={showTitleModal}
        onOk={handleConfirmExport}
        onCancel={() => setShowTitleModal(false)}
        okText="确认导出"
        cancelText="取消"
      >
        <div className="py-3">
          <label className="text-text-secondary text-sm block mb-2">本体名</label>
          <Input
            value={exportOntoName}
            readOnly
            className="bg-dark-bg border-dark-border text-text-primary mb-4"
          />
          <label className="text-text-secondary text-sm block mb-2">内容</label>
          <Input
            placeholder="例如：行为"
            value={exportContent}
            onChange={e => setExportContent(e.target.value)}
            className="bg-dark-bg border-dark-border text-text-primary mb-4"
            autoFocus
          />
          <label className="text-text-secondary text-sm block mb-2">版本</label>
          <Input
            placeholder="例如：v1.0"
            value={exportVersion}
            onChange={e => setExportVersion(e.target.value)}
            onPressEnter={handleConfirmExport}
            className="bg-dark-bg border-dark-border text-text-primary"
          />
          <p className="text-text-muted text-xs mt-2">已选中 1 条助手回复 · 同名文件将覆盖 · 导出后请到需求汇总查看</p>
        </div>
      </Modal>

      {/* Exporting modal */}
      <Modal
        title="导出文档"
        open={exporting}
        footer={null}
        closable={false}
        centered
        width={300}
      >
        <div className="flex flex-col items-center py-6 gap-3">
          <Spin size="large" />
          <p className="text-text-secondary text-sm">正在保存文档...</p>
        </div>
      </Modal>

      {/* Validation result modal */}
      <Modal
        title="需求分析验证结果"
        open={showValidateModal}
        onCancel={() => setShowValidateModal(false)}
        footer={<Button onClick={() => setShowValidateModal(false)}>关闭</Button>}
        width={700}
      >
        <div className="py-3">
          {validating ? (
            <div className="flex flex-col items-center py-6 gap-3">
              <Spin size="large" />
              <p className="text-text-secondary text-sm">正在进行一致性和逻辑自洽性检查...</p>
              <p className="text-text-muted text-xs">从本体建模角度检查概念重叠、规则冲突等问题</p>
            </div>
          ) : (
            <div>
              {validateTime && (
                <div className="text-text-muted text-xs mb-2">分析时间：{new Date(validateTime).toLocaleString()}</div>
              )}
              <div className="text-text-secondary text-sm whitespace-pre-wrap max-h-96 overflow-y-auto">
                {validateResult || '无验证结果'}
              </div>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
}
