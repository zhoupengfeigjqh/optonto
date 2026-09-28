'use client';

/**
 * 连接测试弹窗（自 DataEngineTable.tsx 抽取）。
 *
 * 纯展示组件：请求参数表单与响应结果全部由父组件持有，
 * 本组件只负责渲染与把用户输入回传（参数值变更 / 发送 / 关闭）。
 */
import { Button, Input, Modal } from 'antd';
import { SendOutlined } from '@ant-design/icons';
import type { DataEngine } from '@/api/client';

interface Props {
  open: boolean;
  /** 被测试的引擎（null 时不渲染内容） */
  engine: DataEngine | null;
  /** 行为显示名解析（本体行为名 → 展示名） */
  behaviorLabel: string;
  /** 请求参数初值：本体参数名 → 值 */
  params: Record<string, any>;
  /** 必填标记：本体参数名 → 是否必填 */
  required: Record<string, boolean>;
  /** 响应结果（含 error 字段表示失败） */
  result: any;
  loading: boolean;
  /** 参数展示名解析（本体参数名 → 中文展示名） */
  paramLabel: (paramKey: string) => string;
  onParamChange: (paramKey: string, value: string) => void;
  onSend: () => void;
  onClose: () => void;
}

export default function ConnectTestModal({
  open, engine, behaviorLabel, params, required, result, loading, paramLabel, onParamChange, onSend, onClose,
}: Props) {
  return (
    <Modal
      title={engine ? `连接测试 - ${behaviorLabel}` : '连接测试'}
      open={open} onCancel={onClose} width={700} footer={null}
    >
      {engine && (
        <div className="space-y-4">
          <div>
            <span className="text-text-muted text-xs">目标接口：</span>
            <code className="text-accent-green text-xs ml-1">
              {engine.target?.server_url
                ? `MCP  ${engine.target.tool_name} @ ${engine.target.server_url}`
                : `${engine.target?.method || 'POST'} ${engine.target?.url || '(未配置)'}`}
            </code>
          </div>
          {Object.keys(params).length > 0 && (
            <div>
              <span className="text-text-muted text-xs mb-2 block">请求参数</span>
              <div className="space-y-1.5">
                {Object.entries(params).map(([k, v]) => (
                  <div key={k} className="flex items-center gap-2">
                    <span className="w-28 text-text-secondary text-xs shrink-0">
                      {required[k] && <span className="text-red-400 mr-0.5">*</span>}{paramLabel(k)}
                    </span>
                    {typeof v === 'boolean' ? null : typeof v === 'string' && (v.startsWith('{') || v.startsWith('[')) ? (
                      <Input.TextArea size="small" value={v} onChange={e => onParamChange(k, e.target.value)} rows={3}
                        className="flex-1 bg-dark-bg border-dark-border text-text-primary font-mono text-xs" />
                    ) : (
                      <Input size="small" value={v as string} onChange={e => onParamChange(k, e.target.value)}
                        className="flex-1 bg-dark-bg border-dark-border text-text-primary" />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <Button type="primary" icon={<SendOutlined />} onClick={onSend} loading={loading} block>发送请求</Button>

          {result && (
            <div>
              <span className="text-text-muted text-xs mb-1 block">响应结果</span>
              <pre className="bg-dark-bg border border-dark-border rounded p-3 text-xs font-mono max-h-64 overflow-y-auto whitespace-pre-wrap">
                {result.error ? (
                  <span className="text-red-400">{result.error}</span>
                ) : (
                  <span className="text-accent-green">{JSON.stringify(result, null, 2)}</span>
                )}
              </pre>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
