'use client';

/**
 * 行为参数/返回结构编辑弹窗（自 DataEngineTable.tsx 抽取）。
 *
 * 纯展示组件：JSON 文本与保存动作均由父组件持有（保存会写回本体行为定义）。
 */
import { Modal } from 'antd';
import JsonEditor from '@/components/JsonEditor';

interface Props {
  open: boolean;
  title: string;
  /** 输入参数 JSON 文本 */
  paramsStr: string;
  /** 返回结构 JSON 文本 */
  responseStr: string;
  loading: boolean;
  onParamsChange: (value: string) => void;
  onResponseChange: (value: string) => void;
  onSave: () => void;
  onCancel: () => void;
}

export default function BehaviorEditModal({
  open, title, paramsStr, responseStr, loading, onParamsChange, onResponseChange, onSave, onCancel,
}: Props) {
  return (
    <Modal
      title={title}
      open={open}
      onOk={onSave}
      onCancel={onCancel}
      okText="保存"
      cancelText="取消"
      width={800}
      confirmLoading={loading}
    >
      <div className="flex gap-3" style={{ minHeight: 320 }}>
        <div className="flex-1">
          <span className="text-text-muted text-xs mb-1 block">输入参数 (JSON)</span>
          <div className="border border-dark-border rounded overflow-hidden" style={{ minHeight: 280 }}>
            <JsonEditor value={paramsStr} onChange={onParamsChange} />
          </div>
        </div>
        <div className="flex-1">
          <span className="text-text-muted text-xs mb-1 block">返回结构 (JSON)</span>
          <div className="border border-dark-border rounded overflow-hidden" style={{ minHeight: 280 }}>
            <JsonEditor value={responseStr} onChange={onResponseChange} />
          </div>
        </div>
      </div>
    </Modal>
  );
}
