'use client';

/**
 * 安全管控确认弹窗（自 AgentApp.tsx 抽取，行为不变）。
 * 纯知情确认：结构化展示行为 + 说明/审核要求 + 参数表，参数不可修改。
 */
import { Button, Modal } from 'antd';
import { buildConfirmRows, parseConfirmContent } from './security-confirm-content';

/** 安全管控确认弹窗：结构化展示行为 + 说明/审核要求 + 参数表，纯知情确认（不可改参） */
export default function SecurityConfirmModal({
  confirmModal, countdown, onReject, onApprove,
}: {
  confirmModal: { confirmId: string; behavior: string; content: string; params: Record<string, any> };
  countdown: number | null;
  onReject: () => void;
  onApprove: () => void;
}) {
  const rows = buildConfirmRows(confirmModal.params);
  const emptyCount = rows.filter(r => r.empty).length;
  const { description, audit } = parseConfirmContent(confirmModal.content);
  return (
    <Modal
      title={
        <span style={{ color: '#fff' }}>
          🔒 安全管控确认
          <span className="text-amber-400 text-xs border border-amber-500/40 rounded px-1.5 py-0.5 ml-2">写操作</span>
          {countdown !== null && countdown > 0 && (
            <span className="text-text-muted text-xs ml-2">（{countdown} 秒后自动取消）</span>
          )}
        </span>
      }
      open
      width={620}
      destroyOnClose
      onCancel={onReject}
      footer={
        <div className="flex justify-end gap-2">
          <Button danger onClick={onReject}>拒绝</Button>
          <Button type="primary" onClick={onApprove}>批准执行</Button>
        </div>
      }
    >
      <div className="space-y-3">
        {/* 警示条 */}
        <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/30 px-3 py-2">
          <span className="text-amber-400 text-sm leading-6">⚠️</span>
          <span className="text-amber-200 text-sm leading-6">
            批准后该写操作将<span className="font-semibold">立即执行</span>
            {emptyCount > 0 && `；其中 ${emptyCount} 项参数待补充，将由 AI 自动推断`}
          </span>
        </div>

        {/* 行为 */}
        <div className="rounded-lg border border-dark-border px-3 py-2">
          <div className="text-text-muted text-xs mb-1">行为</div>
          <div className="text-text-primary text-sm font-medium font-mono">{confirmModal.behavior}</div>
        </div>

        {/* 说明 */}
        {description && (
          <div className="rounded-lg border border-dark-border px-3 py-2">
            <div className="text-text-muted text-xs mb-1">说明</div>
            <div className="text-text-primary text-sm whitespace-pre-wrap">{description}</div>
          </div>
        )}

        {/* 审核要求 */}
        {audit && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2">
            <div className="text-amber-400 text-xs mb-1">审核要求</div>
            <div className="text-amber-200/90 text-sm whitespace-pre-wrap">{audit}</div>
          </div>
        )}

        {/* 参数表 */}
        {rows.length > 0 ? (
          <div className="rounded-lg border border-dark-border overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-dark-border bg-dark-bg/60">
              <span className="text-text-muted text-xs">本次将写入/修改/删除的数据</span>
              <span className="text-text-muted text-xs">共 {rows.length} 项</span>
            </div>
            <div className="divide-y divide-dark-border/60">
              {rows.map(row => (
                <div key={row.key} className="flex items-center gap-3 px-3 py-2">
                  <div className="w-44 shrink-0">
                    <div className="text-text-primary text-sm leading-5 truncate">{row.name}</div>
                    <div className="text-text-muted text-xs font-mono leading-4">{row.key}</div>
                  </div>
                  <div className="w-12 shrink-0">
                    {row.required ? (
                      <span className="text-red-400 text-xs border border-red-500/40 rounded px-1.5 py-0.5">必填</span>
                    ) : (
                      <span className="text-text-muted text-xs border border-dark-border rounded px-1.5 py-0.5">选填</span>
                    )}
                  </div>
                  <div className={`flex-1 text-sm truncate ${row.empty ? 'text-amber-400' : 'text-text-primary'}`}>
                    {row.empty ? '（待补充）' : row.value}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="text-text-secondary text-sm whitespace-pre-wrap rounded-lg border border-dark-border px-3 py-2">{confirmModal.content}</div>
        )}

        <div className="text-text-muted text-xs">ℹ️ 参数已在规划阶段确定，此处仅作知情确认，不可修改</div>
      </div>
    </Modal>
  );
}
