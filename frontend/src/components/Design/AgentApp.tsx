'use client';

import { useEffect, useState, useRef } from 'react';
import { Button, Input, Modal, message, Space, Spin, Select, Table, Tooltip } from 'antd';
import {
  PlusOutlined, DeleteOutlined, ArrowLeftOutlined,
  SendOutlined, RobotOutlined, UserOutlined,
  MessageOutlined, CopyOutlined,
} from '@ant-design/icons';
import {
  listAgentThreads, createAgentThread, deleteAgentThread,
  getAgentThread, agentChatStream,
  listSkills,
  AgentThreadSummary, AgentMessage, SkillInfo,
} from '@/api/agent-client';
import { renderMarkdown } from '@/lib/markdown';

// ─── Agent Conversation 子组件（聊天界面） ─────────────────

function AgentConversation({
  threadId, scenarioName, ontologyName, ontologyId, onBack,
}: {
  threadId: string;
  scenarioName: string;
  ontologyName: string;
  ontologyId?: number;
  onBack: () => void;
}) {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [toolCalls, setToolCalls] = useState<{name: string; done: boolean; result?: string}[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // 加载历史消息
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const thread = await getAgentThread(scenarioName, ontologyName, threadId);
        setMessages(thread.messages || []);
      } catch (e: any) {
        message.error('加载对话失败: ' + e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [threadId, scenarioName, ontologyName]);

  // 自动滚动
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput('');
    setSending(true);

    // 添加用户消息
    const userMsg: AgentMessage = { role: 'user', content: text, timestamp: new Date().toISOString() };
    setMessages(prev => [...prev, userMsg]);

    // 添加空助手消息用于流式填充
    const assistantMsg: AgentMessage = { role: 'assistant', content: '', timestamp: '' };
    setMessages(prev => [...prev, assistantMsg]);

    abortRef.current = new AbortController();
    setToolCalls([]);

    try {
      const response = await agentChatStream(scenarioName, ontologyName, threadId, text, ontologyId);
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
            if (data.type === 'done') break;
            if (data.type === 'error') {
              setMessages(prev => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last.role === 'assistant' && !last.content) {
                  updated[updated.length - 1] = { ...last, content: `\n\n[错误: ${data.message}]` };
                }
                return updated;
              });
              break;
            }
            if (data.type === 'tool_start') {
              setToolCalls(prev => [...prev, { name: data.name, done: false }]);
            }
            if (data.type === 'tool_end') {
              setToolCalls(prev => prev.map(t => t.name === data.name ? { ...t, done: true, result: data.result || '' } : t));
            }
            if (data.type === 'token') {
              setMessages(prev => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last.role === 'assistant') {
                  updated[updated.length - 1] = { ...last, content: last.content + (data.token || '') };
                }
                return updated;
              });
            }
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
      setToolCalls([]);
      abortRef.current = null;
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64"><Spin /></div>;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center mb-4">
        <Button type="text" icon={<ArrowLeftOutlined />} onClick={onBack} className="text-text-muted hover:text-text-primary" />
        <h3 className="text-base font-semibold text-text-primary ml-2">智能体对话</h3>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-4 mb-4 pr-2" style={{ maxHeight: 'calc(100vh - 380px)' }}>
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-48 text-text-muted">
            <RobotOutlined style={{ fontSize: 48, marginBottom: 16 }} />
            <p className="text-sm">开始一段新的智能体对话</p>
            <p className="text-xs mt-1">输入您的问题，AI Agent 将基于加载的技能为您解答</p>
          </div>
        )}
        {messages.map((msg, idx) => {
          const isAssistant = msg.role === 'assistant';
          const isToolResult = msg.role === 'toolResult';
          const isLast = idx === messages.length - 1;
          return (
            <div key={idx}>
              {/* User message */}
              {msg.role === 'user' && (
                <div className="flex gap-3 justify-end mb-2">
                  <div className="relative max-w-[75%] rounded-xl px-4 py-2.5 text-sm bg-accent-blue text-white">
                    <div className="whitespace-pre-wrap break-words">{msg.content}</div>
                    {msg.timestamp && (
                      <div className="text-xs mt-1 text-white/60">
                        {new Date(msg.timestamp).toLocaleTimeString()}
                      </div>
                    )}
                  </div>
                  <div className="w-8 h-8 rounded-full bg-accent-green/20 flex items-center justify-center shrink-0">
                    <UserOutlined style={{ color: '#10b981', fontSize: 16 }} />
                  </div>
                </div>
              )}

              {/* Tool result (from history) */}
              {isToolResult && (
                <div className="flex gap-3 justify-start mb-2 ml-10">
                  <div className="max-w-[75%] text-xs text-text-muted bg-dark-bg border border-dark-border rounded px-3 py-1.5 cursor-pointer hover:bg-dark-hover"
                    onClick={(e) => {
                      const target = e.currentTarget.nextElementSibling as HTMLElement;
                      if (target) target.classList.toggle('hidden');
                    }}>
                    🔧 工具返回数据 <span className="text-accent-blue">▼</span>
                    <pre className="hidden mt-1 text-xs text-text-secondary whitespace-pre-wrap max-h-40 overflow-y-auto">{msg.content}</pre>
                  </div>
                </div>
              )}

              {/* Tool calls (only for the last assistant turn when sending) */}
              {isAssistant && isLast && sending && toolCalls.length > 0 && (
                <div className="flex gap-3 mb-2">
                  <div className="w-8 h-8 rounded-full bg-accent-blue/20 flex items-center justify-center shrink-0">
                    <RobotOutlined style={{ color: '#3b82f6', fontSize: 16 }} />
                  </div>
                  <div className="flex flex-col gap-1">
                    {toolCalls.map((tc, ti) => (
                      <div key={ti} className="flex flex-col gap-1 text-xs text-text-muted bg-dark-card border border-dark-border rounded px-3 py-1.5">
                        <div className="flex items-center gap-2">
                          {tc.done ? <span className="text-green-500">✓</span> : <Spin size="small" />}
                          <span>调用了 <code className="text-accent-blue">{tc.name}</code></span>
                        </div>
                        {tc.done && tc.result && (
                          <pre className="mt-1 p-2 bg-dark-bg rounded text-xs text-text-secondary max-h-32 overflow-y-auto whitespace-pre-wrap">{tc.result}</pre>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Assistant message */}
              {isAssistant && (
                <div className="flex gap-3 justify-start mb-2">
                  <div className="w-8 h-8 rounded-full bg-accent-blue/20 flex items-center justify-center shrink-0">
                    <RobotOutlined style={{ color: '#3b82f6', fontSize: 16 }} />
                  </div>
                  <div className="relative max-w-[75%] rounded-xl px-4 py-2.5 text-sm bg-dark-card border border-dark-border text-text-primary">
                    {isAssistant && msg.content ? (
                      sending && isLast ? (
                        <div>
                          <div className="whitespace-pre-wrap break-words text-sm">{msg.content}</div>
                          <div className="flex items-center gap-2 text-xs text-text-muted mt-2">
                            <Spin size="small" />
                            <span>正在输出...</span>
                          </div>
                        </div>
                      ) : (
                        <div>
                          <div className="prose prose-invert max-w-none text-sm" dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.content) }} />
                          <div className="flex items-center justify-end gap-2 mt-2">
                            <Tooltip title="复制内容">
                              <Button
                                type="text"
                                size="small"
                                icon={<CopyOutlined />}
                                className="text-text-muted hover:text-text-primary opacity-0 hover:opacity-100 transition-opacity"
                                onClick={() => {
                                  navigator.clipboard.writeText(msg.content);
                                  message.success('已复制');
                                }}
                              />
                            </Tooltip>
                            {msg.timestamp && (
                              <span className="text-xs text-text-muted">
                                {new Date(msg.timestamp).toLocaleTimeString()}
                              </span>
                            )}
                          </div>
                        </div>
                      )
                    ) : (
                      <div className="whitespace-pre-wrap break-words">{msg.content || (isLast && isAssistant ? <Spin size="small" /> : '')}</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="flex gap-2 items-end border-t border-dark-border pt-3">
        <Input.TextArea
          value={input}
          onChange={e => setInput(e.target.value)}
          onPressEnter={e => { if (!e.shiftKey) { e.preventDefault(); handleSend(); } }}
          placeholder="输入您的问题... (Shift+Enter 换行)"
          rows={2}
          className="bg-dark-bg border-dark-border text-text-primary"
          disabled={sending}
        />
        <Button
          type="primary"
          icon={<SendOutlined />}
          onClick={handleSend}
          loading={sending}
          disabled={!input.trim()}
        >
          发送
        </Button>
      </div>
    </div>
  );
}

// ─── Agent Thread List 子组件（线程列表） ─────────────────

export default function AgentApp({
  ontologyId,
  scenarioName,
  ontologyName,
}: {
  ontologyId?: number;
  scenarioName?: string;
  ontologyName?: string;
}) {
  const [threads, setThreads] = useState<AgentThreadSummary[]>([]);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);

  // 加载线程列表和技能列表
  const load = async () => {
    if (!scenarioName || !ontologyName) return;
    setLoading(true);
    try {
      const [threadList, skillList] = await Promise.all([
        listAgentThreads(scenarioName, ontologyName),
        listSkills(scenarioName, ontologyName),
      ]);
      setThreads(threadList);
      setSkills(skillList);
    } catch (e: any) {
      message.error('加载失败: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [scenarioName, ontologyName]);

  // 新建线程
  const handleNew = async () => {
    if (!scenarioName || !ontologyName) return;
    try {
      const thread = await createAgentThread(
        scenarioName,
        ontologyName,
        newTitle || '新对话',
        selectedSkills
      );
      setShowNewDialog(false);
      setNewTitle('');
      setSelectedSkills([]);
      setActiveThreadId(thread.id);
    } catch (e: any) {
      message.error('创建失败: ' + e.message);
    }
  };

  // 删除线程
  const handleDelete = (id: string) => {
    if (!scenarioName || !ontologyName) return;
    Modal.confirm({
      title: <span style={{ color: '#fff' }}>确认删除</span>,
      content: <span style={{ color: '#ef4444' }}>删除后不可恢复，确定要删除吗？</span>,
      okText: '确认删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await deleteAgentThread(scenarioName, ontologyName, id);
          message.success('已删除');
          await load();
        } catch (e: any) {
          message.error(e.message);
        }
      },
    });
  };

  // 进入对话后显示聊天界面
  if (activeThreadId) {
    return (
      <AgentConversation
        threadId={activeThreadId}
        scenarioName={scenarioName || ''}
        ontologyName={ontologyName || ''}
        ontologyId={ontologyId}
        onBack={() => { setActiveThreadId(null); load(); }}
      />
    );
  }

  const columns = [
    {
      title: '会话标题',
      dataIndex: 'title',
      key: 'title',
      render: (v: string, r: AgentThreadSummary) => (
        <span
          className="text-text-primary cursor-pointer hover:text-accent-blue"
          onClick={() => setActiveThreadId(r.id)}
        >
          {v || '未命名对话'}
        </span>
      ),
    },
    {
      title: '消息数',
      dataIndex: 'message_count',
      key: 'message_count',
      width: 100,
      render: (v: number) => <span className="text-text-secondary text-sm">{v}</span>,
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 200,
      render: (v: string) => (
        <span className="text-text-secondary text-sm">
          {v ? new Date(v).toLocaleString() : '-'}
        </span>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 120,
      render: (_: any, r: AgentThreadSummary) => (
        <Space>
          <Button type="link" size="small" icon={<MessageOutlined />} onClick={() => setActiveThreadId(r.id)}>
            对话
          </Button>
          <Button type="link" size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(r.id)} />
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-text-primary">智能体应用</h3>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setShowNewDialog(true)}>
          新建对话
        </Button>
      </div>
      <p className="text-text-muted text-xs mb-3">
        与 AI Agent 进行对话，它将基于加载的技能文件为您提供领域知识解答。
      </p>

      <Table
        dataSource={threads}
        columns={columns}
        rowKey="id"
        loading={loading}
        pagination={false}
        className="bg-transparent"
      />

      {/* 新建对话弹窗 */}
      <Modal
        title="新建智能体对话"
        open={showNewDialog}
        onOk={handleNew}
        onCancel={() => {
          setShowNewDialog(false);
          setNewTitle('');
          setSelectedSkills([]);
        }}
        okText="创建"
        cancelText="取消"
      >
        <div className="py-3 space-y-4">
          <div>
            <label className="text-text-secondary text-sm block mb-1">对话标题</label>
            <Input
              placeholder="输入对话标题（可选）"
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              className="bg-dark-bg border-dark-border text-text-primary"
            />
          </div>
          <div>
            <label className="text-text-secondary text-sm block mb-1">选择加载的技能</label>
            <Select
              mode="multiple"
              placeholder="选择该对话要加载的技能文件"
              value={selectedSkills}
              onChange={setSelectedSkills}
              options={skills.map(s => ({
                label: s.name,
                value: s.name,
              }))}
              className="w-full"
              style={{ background: '#1a1a2e' }}
              popupClassName="bg-dark-card"
            />
            <p className="text-text-muted text-xs mt-1">
              选中的技能将作为 AI Agent 的知识来源
            </p>
          </div>
        </div>
      </Modal>
    </div>
  );
}
