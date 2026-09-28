'use client';

/**
 * 规划确认弹窗（自 AgentApp.tsx 的 AgentConversation 抽取）。
 *
 * 默认只读预览；「高级选项」展开后可改参数、删子任务、调依赖（参数留空由 AI 自动补充）。
 * 拒绝时可选择「退出」或「重规划 + 调整建议」。
 *
 * 纯展示 + 局部展开态回传：plan 的编辑（改参/删任务/调依赖）由父组件经
 * `plan-editing.ts` 的纯函数完成，本组件不持有计划数据。
 */
import { Button, Dropdown, Input, Modal, Select } from 'antd';
import { DeleteOutlined } from '@ant-design/icons';
import { clickableProps } from '@/utils/a11y';

interface Props {
  open: boolean;
  /** 当前（可能已被编辑的）规划 */
  plan: any;
  /** 自动取消倒计时（秒）；null = 不显示 */
  countdown: number | null;
  /** 结构校验错误（非空时在弹窗内提示且不提交） */
  error: string;
  /** 是否展开高级编辑 */
  showAdvanced: boolean;
  /** 调整建议（拒绝并重规划时提交给后端） */
  suggestion: string;
  /** 已展开详情的参数键（`${seq}:${paramKey}`） */
  expandedParams: Set<string>;
  onToggleAdvanced: () => void;
  onSuggestionChange: (value: string) => void;
  /** 关闭（X / 遮罩）= 拒绝并退出 */
  onCancel: () => void;
  onReject: (action: 'exit' | 'replan') => void;
  onConfirm: () => void;
  onUpdateParam: (seq: number, key: string, value: string) => void;
  onDeleteSubtask: (seq: number) => void;
  onUpdateDeps: (seq: number, deps: number[]) => void;
  onToggleParamExpand: (expandKey: string) => void;
}

export default function PlanConfirmModal({
  open, plan, countdown, error, showAdvanced, suggestion, expandedParams,
  onToggleAdvanced, onSuggestionChange, onCancel, onReject, onConfirm,
  onUpdateParam, onDeleteSubtask, onUpdateDeps, onToggleParamExpand,
}: Props) {
  return (
    <Modal
      title={
        <span style={{ color: '#fff' }}>
          📋 规划确认
          {countdown !== null && countdown > 0 && (
            <span className="text-text-muted text-xs ml-2">（{countdown} 秒后自动取消）</span>
          )}
        </span>
      }
      open={open}
      width={560}
      onCancel={onCancel}
      footer={
        <div className="flex items-center justify-between gap-2">
          <Dropdown
            menu={{
              items: [
                { key: 'exit', label: '拒绝并退出' },
                { key: 'replan', label: '拒绝并重规划' },
              ],
              onClick: ({ key }) => onReject(key === 'replan' ? 'replan' : 'exit'),
            }}
          >
            <Button danger>拒绝</Button>
          </Dropdown>
          <Button type="primary" onClick={onConfirm}>确认执行</Button>
        </div>
      }
    >
      <div className="space-y-3 max-h-96 overflow-y-auto">
        {/* 顶部信息条（info 色调，类比安全确认的警示条） */}
        <div className="flex items-center justify-between gap-2 rounded-lg bg-accent-blue/10 border border-accent-blue/30 px-3 py-2">
          <div className="flex items-start gap-2 min-w-0">
            <span className="text-accent-blue text-sm leading-6 shrink-0">📋</span>
            <span className="text-text-primary text-sm leading-6">
              规划已就绪，共 {plan?.subtasks?.length ?? 0} 个操作；写操作会在执行前另行确认
            </span>
          </div>
          <Button
            size="small" type="text"
            className="text-accent-blue hover:text-accent-blue shrink-0"
            onClick={onToggleAdvanced}
          >
            {showAdvanced ? '收起高级选项' : '⚙️ 高级选项'}
          </Button>
        </div>
        {error && (
          <div className="text-red-400 text-xs border border-red-500/30 rounded px-3 py-2">{error}</div>
        )}
        {!showAdvanced && (
          <div className="text-text-muted text-xs">ℹ️ 默认只读预览；展开「高级选项」可编辑参数、删除子任务或调整依赖（参数留空由 AI 自动补充）。拒绝后可选择「退出」或填写下方建议重新规划。</div>
        )}
        {plan?.subtasks?.map((st: any, idx: number) => (
          <div key={st.seq} className="rounded-lg border border-dark-border overflow-hidden">
            {/* 子任务头：header 背景 + 序号/中文名/英文名/描述 */}
            <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-dark-border bg-dark-bg/60">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-accent-blue text-xs font-mono shrink-0">{idx + 1}.</span>
                <span className="text-text-primary text-sm font-medium truncate">{st.display_name || st.behavior}</span>
                {st.display_name && (
                  <span className="text-text-muted text-xs font-mono shrink-0">{st.behavior}</span>
                )}
                {st.description && (
                  <span className="text-text-muted text-xs truncate">— {st.description}</span>
                )}
              </div>
              {showAdvanced && (
                <Button
                  size="small" type="text" danger icon={<DeleteOutlined />}
                  className="shrink-0"
                  onClick={() => onDeleteSubtask(st.seq)}
                />
              )}
            </div>
            {/* 参数表：与安全确认弹窗一致的 divide 行 */}
            <div className="divide-y divide-dark-border/60">
              {st.params && Object.keys(st.params).length > 0 && Object.entries(st.params).map(([key, val]: [string, any]) => {
                const pDesc = val !== null && typeof val === 'object' && val?.description ? val.description : '';
                const label = pDesc || key;
                const rawVal = val !== null && typeof val === 'object' ? (val.value ?? '') : String(val ?? '');
                const required = val !== null && typeof val === 'object' && val.required;
                const expandKey = `${st.seq}:${key}`;
                const isExpanded = expandedParams.has(expandKey);
                const toggleExpand = () => onToggleParamExpand(expandKey);

                // 格式化参数值展示：数组/对象显示摘要+可展开详情，普通字符串直接显示
                const renderValue = (editable: boolean) => {
                  // 空值
                  if (rawVal === '' || rawVal === null || rawVal === undefined) {
                    return <span className="text-amber-400">（待补充）</span>;
                  }

                  // 数组 → 显示 "数组, 共 N 项"，可展开查看完整 JSON
                  if (Array.isArray(rawVal)) {
                    const summary = `数组, 共 ${rawVal.length} 项`;
                    if (editable) {
                      return (
                        <Input
                          size="small"
                          value={JSON.stringify(rawVal)}
                          onChange={(e) => onUpdateParam(st.seq, key, e.target.value)}
                          className="bg-dark-bg border-dark-border text-text-primary flex-1 font-mono text-xs"
                        />
                      );
                    }
                    if (isExpanded) {
                      return (
                        <div className="w-full">
                          <div className="text-text-muted text-xs mb-1 cursor-pointer hover:text-accent-blue select-none" {...clickableProps(toggleExpand, '展开/收起参数详情')}>
                            ▼ {summary}
                          </div>
                          <pre className="text-xs text-text-secondary font-mono whitespace-pre-wrap max-h-32 overflow-y-auto bg-dark-bg rounded p-2 border border-dark-border">{JSON.stringify(rawVal, null, 2)}</pre>
                        </div>
                      );
                    }
                    return (
                      <span className="cursor-pointer hover:text-accent-blue select-none" {...clickableProps(toggleExpand, '展开/收起参数详情')}>
                        ▶ {summary}
                      </span>
                    );
                  }

                  // 对象 → 显示 "对象, 共 N 个字段"，可展开查看完整 JSON
                  if (typeof rawVal === 'object' && rawVal !== null) {
                    const keys = Object.keys(rawVal);
                    const summary = `对象, 共 ${keys.length} 个字段`;
                    if (editable) {
                      return (
                        <Input
                          size="small"
                          value={JSON.stringify(rawVal)}
                          onChange={(e) => onUpdateParam(st.seq, key, e.target.value)}
                          className="bg-dark-bg border-dark-border text-text-primary flex-1 font-mono text-xs"
                        />
                      );
                    }
                    if (isExpanded) {
                      return (
                        <div className="w-full">
                          <div className="text-text-muted text-xs mb-1 cursor-pointer hover:text-accent-blue select-none" {...clickableProps(toggleExpand, '展开/收起参数详情')}>
                            ▼ {summary}
                          </div>
                          <pre className="text-xs text-text-secondary font-mono whitespace-pre-wrap max-h-32 overflow-y-auto bg-dark-bg rounded p-2 border border-dark-border">{JSON.stringify(rawVal, null, 2)}</pre>
                        </div>
                      );
                    }
                    return (
                      <span className="cursor-pointer hover:text-accent-blue select-none" {...clickableProps(toggleExpand, '展开/收起参数详情')}>
                        ▶ {summary}
                      </span>
                    );
                  }

                  // 普通字符串（含 JSON 字符串）
                  const strVal = String(rawVal);
                  // 过长字符串截断 + 可展开
                  if (strVal.length > 120) {
                    if (editable) {
                      return (
                        <Input
                          size="small"
                          value={strVal}
                          onChange={(e) => onUpdateParam(st.seq, key, e.target.value)}
                          className="bg-dark-bg border-dark-border text-text-primary flex-1 font-mono text-xs"
                        />
                      );
                    }
                    if (isExpanded) {
                      return (
                        <div className="w-full">
                          <div className="text-text-muted text-xs mb-1 cursor-pointer hover:text-accent-blue select-none" {...clickableProps(toggleExpand, '展开/收起参数详情')}>
                            ▼ 收起
                          </div>
                          <span className="break-all text-xs">{strVal}</span>
                        </div>
                      );
                    }
                    return (
                      <span className="cursor-pointer hover:text-accent-blue select-none break-all" {...clickableProps(toggleExpand, '展开/收起参数详情')}>
                        {strVal.slice(0, 120)}...
                      </span>
                    );
                  }

                  // 普通短字符串
                  if (editable) {
                    return (
                      <Input
                        size="small"
                        value={strVal}
                        onChange={(e) => onUpdateParam(st.seq, key, e.target.value)}
                        className="bg-dark-bg border-dark-border text-text-primary flex-1"
                      />
                    );
                  }
                  return <span className="break-all">{strVal}</span>;
                };

                if (!showAdvanced) {
                  return (
                    <div key={key} className="flex items-center gap-3 px-3 py-2">
                      <div className="w-40 shrink-0">
                        <div className="text-text-primary text-sm truncate">{label}</div>
                        <div className="text-text-muted text-xs font-mono truncate">{key}</div>
                      </div>
                      <div className="w-12 shrink-0">
                        {required ? (
                          <span className="text-red-400 text-xs border border-red-500/40 rounded px-1.5 py-0.5">必填</span>
                        ) : (
                          <span className="text-text-muted text-xs border border-dark-border rounded px-1.5 py-0.5">选填</span>
                        )}
                      </div>
                      <div className={`flex-1 text-sm ${rawVal === '' || rawVal === null || rawVal === undefined ? 'text-amber-400' : 'text-text-primary'}`}>
                        {renderValue(false)}
                      </div>
                    </div>
                  );
                }
                return (
                  <div key={key} className="flex items-center gap-2 px-3 py-2">
                    <div className="w-40 shrink-0">
                      <div className="text-text-primary text-sm truncate">{label}</div>
                      <div className="text-text-muted text-xs font-mono truncate">{key}</div>
                    </div>
                    {renderValue(true)}
                  </div>
                );
              })}
              {showAdvanced && (
                <div className="flex items-center gap-2 px-3 py-2">
                  <span className="text-text-muted text-xs w-40 shrink-0">依赖</span>
                  <Select
                    size="small"
                    mode="multiple"
                    allowClear
                    placeholder="选择前置子任务"
                    value={st.depends_on ?? []}
                    options={plan?.subtasks
                      ?.filter((o: any) => o.seq !== st.seq)
                      ?.map((o: any) => ({ value: o.seq, label: `子任务 ${o.seq}` })) ?? []}
                    onChange={(v) => onUpdateDeps(st.seq, v)}
                    className="flex-1"
                  />
                </div>
              )}
            </div>
          </div>
        ))}
        <div className="rounded-lg border border-dark-border px-3 py-2">
          <div className="text-text-muted text-xs mb-1">调整建议（拒绝并重规划时填写）</div>
          <Input.TextArea
            value={suggestion}
            onChange={e => onSuggestionChange(e.target.value)}
            placeholder="例如：去掉第 2 个操作、把参数 XXX 改为 YYY…"
            rows={2}
            className="bg-dark-bg border-dark-border text-text-primary"
          />
        </div>
      </div>
    </Modal>
  );
}
