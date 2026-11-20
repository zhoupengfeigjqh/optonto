'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button, Table, Modal, message, Space, Tag, Input, Spin, Select, Alert } from 'antd';
import { PlusOutlined, DeleteOutlined, MessageOutlined, EditOutlined, CheckOutlined, CloseOutlined } from '@ant-design/icons';
import {
  getThreads, createThread, deleteThread, updateThread, ThreadSummary,
  listOntologyRefCandidates, precheckOntologyRefs,
} from '@/api/client';
import ConversationChat from './ConversationChat';
import {
  REF_EMPTY_TEXT, REF_HINT_TEXT, REF_LOAD_FAILED_TEXT,
  clampSelection, groupConflicts, toRefInputs, toSelectOptions,
  type ConflictGroup, type RefSelectOption,
} from './conversation-ontology-refs';

interface Props { activeTab?: string; initialThreadId?: string | null; scenarioName?: string; ontologyName?: string; }

export default function ConversationManager({ activeTab, initialThreadId, scenarioName, ontologyName }: Props) {
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [showVersionModal, setShowVersionModal] = useState(false);
  const [newVersion, setNewVersion] = useState('');
  const [creating, setCreating] = useState(false);

  // ─── 存量本体引用（spec 010） ──────────────────────────────────────────
  const [refOptions, setRefOptions] = useState<RefSelectOption[]>([]);
  const [refLoading, setRefLoading] = useState(false);
  const [refLoadFailed, setRefLoadFailed] = useState(false);
  const [maxRefCount, setMaxRefCount] = useState(20);
  const [selectedRefs, setSelectedRefs] = useState<string[]>([]);
  const [prechecking, setPrechecking] = useState(false);
  const [conflictGroups, setConflictGroups] = useState<ConflictGroup[] | null>(null);
  const [refTokens, setRefTokens] = useState<{ estimate: number; max: number; allowed: boolean } | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (scenarioName) params.set('scenario', scenarioName);
      if (ontologyName) params.set('ontology', ontologyName);
      const list = await getThreads(params.toString());
      setThreads(list);
    } catch (e: any) { message.error('加载对话列表失败: ' + e.message); } finally { setLoading(false); }
  };

  useEffect(() => { if (activeTab === 'requirements') load(); }, [activeTab, scenarioName, ontologyName]);

  // Auto-open thread from query param
  useEffect(() => {
    if (initialThreadId) setActiveThreadId(initialThreadId);
  }, [initialThreadId]);

  // 打开新建弹窗时拉候选清单：失败不阻断主流程（仍可只填版本号创建）
  useEffect(() => {
    if (!showVersionModal) return;
    let cancelled = false;
    setRefLoading(true);
    setRefLoadFailed(false);
    listOntologyRefCandidates({ excludeScenario: scenarioName, excludeOntology: ontologyName })
      .then((res) => {
        if (cancelled) return;
        const excluded = scenarioName && ontologyName
          ? { scenario_name: scenarioName, ontology_name: ontologyName }
          : undefined;
        setRefOptions(toSelectOptions(res.candidates, excluded));
        setMaxRefCount(res.max_count || 20);
      })
      .catch((e: any) => {
        if (cancelled) return;
        setRefOptions([]);
        setRefLoadFailed(true);
        message.error(`${REF_LOAD_FAILED_TEXT}: ${e.message}`);
      })
      .finally(() => { if (!cancelled) setRefLoading(false); });
    return () => { cancelled = true; };
  }, [showVersionModal, scenarioName, ontologyName]);

  const handleNew = () => {
    setNewVersion('');
    setSelectedRefs([]);
    setConflictGroups(null);
    setRefTokens(null);
    setShowVersionModal(true);
  };

  const doCreate = async () => {
    const refs = toRefInputs(selectedRefs);
    setShowVersionModal(false);
    setConflictGroups(null);
    setCreating(true);
    try {
      const thread = await createThread(
        '新对话', scenarioName || '', ontologyName || '', newVersion.trim(),
        refs.length ? refs : undefined,
      );
      setActiveThreadId(thread.id);
    } catch (e: any) { message.error('创建失败: ' + e.message); } finally { setCreating(false); }
  };

  /**
   * 预检 → 分支（spec 010 US3）：
   * - 超限：阻断并给出可操作提示，保持弹窗打开；
   * - 有冲突：弹第二层 Modal，取消后**保留**已选状态；
   * - 无冲突：直接创建。
   * 预检期间必须有加载态，禁止静默等待（章程 IV 三态）。
   */
  const handleConfirmNew = async () => {
    if (!newVersion.trim()) { message.warning('请输入版本号'); return; }
    if (selectedRefs.length === 0) { await doCreate(); return; }

    setPrechecking(true);
    try {
      const result = await precheckOntologyRefs(toRefInputs(selectedRefs));
      setRefTokens({ estimate: result.token_estimate, max: result.max_tokens, allowed: result.allowed });
      if (!result.allowed) {
        message.error(result.reason || '引用内容超出限制，请减少勾选');
        return;
      }
      if (result.conflicts.length > 0) {
        setConflictGroups(groupConflicts(result.conflicts));
        return;
      }
      await doCreate();
    } catch (e: any) {
      // 预检失败不自动创建：否则会绕过冲突与超限校验
      message.error('预检失败: ' + e.message);
    } finally {
      setPrechecking(false);
    }
  };

  const handleDelete = (id: string) => {
    Modal.confirm({
      title: <span style={{color:'#fff'}}>确认删除</span>,
      content: <span style={{color:'#ef4444'}}>删除后不可恢复，确定要删除吗？</span>,
      okText: '确认删除', cancelText: '取消', okButtonProps: { danger: true },
      onOk: async () => {
        try { await deleteThread(id); message.success('已删除'); await load(); } catch (e: any) { message.error(e.message); }
      },
    });
  };

  const handleCancelEdit = () => {
    setEditingTitle(null);
    setEditValue('');
  };

  const handleRename = async (id: string) => {
    if (!editValue.trim()) { setEditingTitle(null); return; }
    try {
      await updateThread(id, { title: editValue.trim() });
      message.success('已重命名');
      setEditingTitle(null);
      await load();
    } catch (e: any) { message.error(e.message); }
  };

  const selectOptions = useMemo(
    () => refOptions.map(option => ({ ...option })),
    [refOptions],
  );

  if (activeThreadId) {
    return <ConversationChat threadId={activeThreadId} onBack={() => { setActiveThreadId(null); load(); }} scenarioName={scenarioName} ontologyName={ontologyName} />;
  }

  const columns = [
    {
      title: '会话标题', dataIndex: 'title', key: 'title',
      render: (v: string, r: ThreadSummary) => {
        if (editingTitle === r.id) {
          return (
            <Space.Compact style={{ width: '100%' }}>
              <Input size="small" value={editValue} onChange={e => setEditValue(e.target.value)}
                onPressEnter={() => handleRename(r.id)}
                className="bg-dark-bg border-dark-border text-text-primary" autoFocus />
              <Button type="link" size="small" icon={<CheckOutlined />} onClick={() => handleRename(r.id)}
                style={{ color: '#10b981', height: 24, width: 24 }} />
              <Button type="link" size="small" icon={<CloseOutlined />} onClick={handleCancelEdit}
                style={{ color: '#ef4444', height: 24, width: 24 }} />
            </Space.Compact>
          );
        }
        return (
          <span className="text-text-primary cursor-pointer hover:text-accent-blue"
            onClick={() => setActiveThreadId(r.id)}>
            {v || '未命名对话'}
          </span>
        );
      },
    },
    { title: '创建时间', dataIndex: 'created_at', key: 'created_at', width: 200,
      render: (v: string) => <span className="text-text-secondary text-sm">{v ? new Date(v).toLocaleString() : '-'}</span> },
    { title: '最后更新', dataIndex: 'updated_at', key: 'updated_at', width: 200,
      render: (v: string) => <span className="text-text-secondary text-sm">{v ? new Date(v).toLocaleString() : '-'}</span> },
    { title: '状态', dataIndex: 'status', key: 'status', width: 180,
      render: (v: string) => <Tag color={v === 'documented' ? 'green' : 'blue'}>{v === 'documented' ? '已生成文档' : '探索中'}</Tag> },
    {
      title: '操作', key: 'actions', width: 180,
      render: (_: any, r: ThreadSummary) => (
        <Space>
          <Button type="link" size="small" icon={<MessageOutlined />} onClick={() => setActiveThreadId(r.id)}>对话</Button>
          <Button type="link" size="small" icon={<EditOutlined />}
            onClick={() => { setEditingTitle(r.id); setEditValue(r.title); }}>编辑</Button>
          <Button type="link" size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(r.id)} />
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-text-primary">对话管理</h3>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleNew}>新建对话</Button>
      </div>
      <p className="text-text-muted text-xs mb-3">管理和查看所有需求探索对话。点击「对话」或「会话标题」进入聊天，点击「新建对话」开始新的探索。通过对话探索，你可以对需求进行智能评估验证，并生成需求文档</p>
      <Table
        dataSource={threads}
        columns={columns}
        rowKey="id"
        loading={loading}
        pagination={false}
        className="bg-transparent"
      />

      {/* Version + 引用存量本体 modal for new conversation */}
      <Modal
        title="新建对话"
        open={showVersionModal}
        onOk={handleConfirmNew}
        onCancel={() => { if (!prechecking) setShowVersionModal(false); }}
        okText="确认创建"
        cancelText="取消"
        confirmLoading={prechecking}
        maskClosable={!prechecking}
        closable={!prechecking}
        cancelButtonProps={{ disabled: prechecking }}
      >
        <div className="py-3">
          <label className="text-text-secondary text-sm block mb-2">版本号</label>
          <Input
            placeholder="例如：v1.0"
            value={newVersion}
            onChange={e => setNewVersion(e.target.value)}
            onPressEnter={handleConfirmNew}
            className="bg-dark-bg border-dark-border text-text-primary"
            autoFocus
          />
          <p className="text-text-muted text-xs mt-2">请输入本对话的版本号，该版本号将在导出需求时自动填入且不可修改</p>
        </div>

        <div className="pb-1">
          <div className="flex items-center justify-between mb-2">
            <label className="text-text-secondary text-sm">引用存量本体（可选）</label>
            {selectedRefs.length > 0 && (
              <span className="text-text-muted text-xs">已选 {selectedRefs.length} / {maxRefCount}</span>
            )}
          </div>
          <Select
            mode="multiple"
            allowClear
            style={{ width: '100%' }}
            aria-label="引用存量本体"
            placeholder={refLoading ? '正在加载…' : '不选则与改动前一致'}
            loading={refLoading}
            disabled={refLoading}
            value={selectedRefs}
            onChange={(values: string[]) => {
              const { values: next, truncated } = clampSelection(values, maxRefCount);
              if (truncated) message.warning(`一次最多引用 ${maxRefCount} 个本体，请分批创建`);
              setSelectedRefs(next);
            }}
            options={selectOptions}
            optionRender={(option) => {
              const data = option.data as RefSelectOption;
              const secondary = data.disabled
                ? data.reason
                : [
                  data.description,
                  `概念 ${data.counts.concepts} / 函数 ${data.counts.functions} / 行为 ${data.counts.behaviors}`,
                  data.deployed_version ? `已部署 ${data.deployed_version}` : '',
                ].filter(Boolean).join(' · ');
              return (
                <div className="py-0.5">
                  <div className="text-text-primary text-sm">{data.label}</div>
                  <div className="text-text-muted text-xs">{secondary}</div>
                </div>
              );
            }}
          />
          <p className="text-text-muted text-xs mt-2">{REF_HINT_TEXT}</p>
          {refLoadFailed && !refLoading && (
            <p className="text-text-muted text-xs mt-1">{REF_EMPTY_TEXT}</p>
          )}
        </div>
      </Modal>

      {/* 冲突确认：第二层 Modal，取消后不关闭新建弹窗、不丢已选状态 */}
      <Modal
        title="引用本体存在命名冲突"
        open={conflictGroups !== null}
        onOk={() => { void doCreate(); }}
        onCancel={() => setConflictGroups(null)}
        okText="仍然创建"
        cancelText="返回调整"
        width={640}
      >
        <Alert
          type="warning"
          showIcon
          className="mb-3"
          message="冲突不阻止创建，但请确认这些命名为你有意为之"
        />
        {refTokens && (
          <p className="text-text-muted text-xs mb-3">
            引用内容约 {refTokens.estimate} tokens（上限 {refTokens.max}），仍在范围内
          </p>
        )}
        {conflictGroups?.map(group => (
          <div key={group.title} className="mb-3">
            <p className="text-text-primary text-sm font-medium mb-1">{group.title}</p>
            <ul className="list-disc pl-5">
              {group.items.map(item => (
                <li key={item.name} className="text-text-secondary text-sm mb-1">
                  <span className="text-text-primary">{item.name}</span>
                  {item.lines.length > 0 && (
                    <ul className="list-[circle] pl-4">
                      {item.lines.map(line => (
                        <li key={line} className="text-text-muted text-xs">{line}</li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </Modal>

      {/* Creating modal */}
      <Modal
        title="创建对话"
        open={creating}
        footer={null}
        closable={false}
        centered
        width={300}
      >
        <div className="flex flex-col items-center py-6 gap-3">
          <Spin size="large" />
          <p className="text-text-secondary text-sm">正在创建对话...</p>
        </div>
      </Modal>
    </div>
  );
}
