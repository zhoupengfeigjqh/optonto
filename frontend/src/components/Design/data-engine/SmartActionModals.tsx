'use client';

/**
 * 智能动作相关弹窗（自 DataEngineTable.tsx 抽取）。
 *
 * 三个弹窗同属「智能对齐 / 智能映射」这一组能力，逻辑上内聚，故收在一个模块：
 * - AnalyzeResultModal：智能映射的分析结论（状态标签 + 结论 + 问题清单）
 * - SmartMappingConfirmModal：智能映射前的确认说明
 * - SmartAlignConfirmModal：智能对齐前的确认说明
 *
 * 均为纯展示组件：结果与 loading 由父组件持有。
 */
import { Modal, Tag } from 'antd';

interface AnalyzeResultModalProps {
  open: boolean;
  title: string;
  result: any;
  onClose: () => void;
}

/** 智能映射分析结论：状态 → 文案与颜色（ok 可映射 / warning 需注意 / 其他 不可映射）。 */
export function AnalyzeResultModal({ open, title, result, onClose }: AnalyzeResultModalProps) {
  const statusLabel = result?.status === 'ok' ? '可映射' : result?.status === 'warning' ? '需注意' : '不可映射';
  const statusColor = result?.status === 'ok' ? 'green' : result?.status === 'warning' ? 'orange' : 'red';

  return (
    <Modal title={title} open={open} onCancel={onClose} footer={null} width={600}>
      {result && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-text-muted text-sm">状态：</span>
            <Tag color={statusColor}>{statusLabel}</Tag>
          </div>
          <div>
            <span className="text-text-muted text-sm">分析结论：</span>
            <p className="text-text-primary text-sm mt-1">{result.message}</p>
          </div>
          {result.issues?.length > 0 && (
            <div>
              <span className="text-text-muted text-sm">问题：</span>
              <ul className="list-disc list-inside text-sm mt-1 space-y-0.5">
                {result.issues.map((issue: string, i: number) => (
                  <li key={i} className={result.status === 'error' ? 'text-red-400' : 'text-yellow-400'}>{issue}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

interface ConfirmModalProps {
  open: boolean;
  title: string;
  /** 确认按钮文案 */
  okText: string;
  loading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children: React.ReactNode;
}

/** 智能动作的确认弹窗（说明文案 + 确认/取消），智能映射与智能对齐共用。 */
export function SmartActionConfirmModal({
  open, title, okText, loading, onConfirm, onCancel, children,
}: ConfirmModalProps) {
  return (
    <Modal
      title={title}
      open={open}
      onOk={onConfirm}
      onCancel={onCancel}
      okText={okText}
      cancelText="取消"
      width={500}
      confirmLoading={loading}
    >
      {children}
    </Modal>
  );
}
