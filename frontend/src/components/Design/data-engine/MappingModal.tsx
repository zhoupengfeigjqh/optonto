'use client';

/**
 * 输入/输出映射弹窗（自 DataEngineTable.tsx 抽取）。
 *
 * 输入映射与输出映射的界面与交互完全同构，仅文案与"遗漏提示"的方位词不同，
 * 因此收敛为同一个组件、在两处以不同 props 复用，避免两份近百行的重复 JSX。
 *
 * 纯展示组件：映射草稿由父组件持有（onMappingChange 回传单字段变更），
 * 保存动作也由父组件决定（落盘走 updateDataEngine / createDataEngine）。
 */
import { Modal, Select, Tag } from 'antd';
import { isTypeMismatch, unmappedTargetFields } from './data-engine-helpers';

interface Props {
  open: boolean;
  title: string;
  /** 本体侧字段（拍平路径），作为映射左侧 */
  ontoFields: string[];
  /** 目标侧字段（拍平路径），作为下拉选项 */
  targetFields: string[];
  /** 本体侧字段 → 类型（用于类型不符告警） */
  ontoFieldTypes: Record<string, string>;
  /** 目标侧字段 → 类型 */
  targetFieldTypes: Record<string, string>;
  /** 当前映射：本体字段 → 目标字段 */
  mapping: Record<string, string>;
  /** 本体侧无字段时的提示文案 */
  emptyHint: string;
  /** 目标字段下拉占位文案 */
  selectPlaceholder: string;
  /** 遗漏提示中的方位词（如「输入」/「输出」） */
  direction: string;
  onMappingChange: (ontoField: string, targetField: string) => void;
  onSave: () => void;
  onCancel: () => void;
}

export default function MappingModal({
  open, title, ontoFields, targetFields, ontoFieldTypes, targetFieldTypes,
  mapping, emptyHint, selectPlaceholder, direction, onMappingChange, onSave, onCancel,
}: Props) {
  const unmapped = unmappedTargetFields(targetFields, mapping);

  return (
    <Modal title={title} open={open} onOk={onSave} onCancel={onCancel}
      okText="保存" cancelText="取消" width={700}>
      {ontoFields.length === 0 && <p className="text-text-muted text-sm">{emptyHint}</p>}
      {ontoFields.length > 0 && (
        <div className="flex items-center gap-3 pb-1 border-b border-dark-border mb-1">
          <span className="w-1/2 text-text-muted text-xs font-semibold">本体字段</span>
          <span className="w-1/2 text-text-muted text-xs font-semibold">目标字段</span>
        </div>
      )}
      <div className="space-y-2 max-h-80 overflow-y-auto">
        {ontoFields.map(field => {
          const ontoType = ontoFieldTypes[field] || '';
          const targetVal = mapping[field] || '';
          const targetType = targetVal ? targetFieldTypes[targetVal] || '' : '';
          const mismatch = isTypeMismatch(ontoType, targetVal, targetType);
          return (
            <div key={field} className="flex items-center gap-3">
              <span className={`w-1/2 text-xs bg-dark-bg rounded px-2 py-1 font-mono ${mismatch ? 'text-yellow-400' : 'text-text-secondary'}`}>
                {field}<span className="text-text-muted ml-1">({ontoType})</span>
              </span>
              <Select size="small" allowClear placeholder={selectPlaceholder}
                value={mapping[field] || undefined}
                onChange={v => onMappingChange(field, v || '')}
                options={targetFields.map(f => ({ label: `${f}(${targetFieldTypes[f] || '?'})`, value: f }))}
                style={{ width: '50%' }} popupClassName="!bg-dark-card" />
            </div>
          );
        })}
      </div>
      {unmapped.length > 0 && (
        <div className="mt-3 pt-2 border-t border-dark-border">
          <span className="text-yellow-400 text-xs font-semibold">⚠ 以下目标字段在本体中没有对应的{direction}映射：</span>
          <div className="flex flex-wrap gap-1 mt-1">
            {unmapped.map(f => (
              <Tag key={f} color="orange">{f}<span className="text-text-muted ml-1 text-xs">({targetFieldTypes[f] || '?'})</span></Tag>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
