'use client';

/**
 * MCP发布页的只读弹窗：工具清单（可展开参数）与配置片段（可复制）。
 * 均为受控展示组件（`data` 为 null 即关闭），不持有业务状态。
 */
import { useState } from 'react';
import { Button, Modal, message } from 'antd';
import { clickableProps } from '@/utils/a11y';
import type { ToolInfo } from './catalog';
import type { ConfigModalContent } from './config-snippets';

interface ToolsModalProps {
  data: { title: string; tools: ToolInfo[] } | null;
  onClose: () => void;
}

export function ToolsModal({ data, onClose }: ToolsModalProps) {
  const [selectedTool, setSelectedTool] = useState<string | null>(null);
  return (
    <Modal
      title={`${data?.title || ''} 工具列表`}
      open={!!data}
      onCancel={() => { setSelectedTool(null); onClose(); }}
      footer={null}
      width={650}
    >
      {!data || data.tools.length === 0 ? (
        <p className="text-text-muted text-sm py-8 text-center">暂无工具信息</p>
      ) : (
        <div className="max-h-96 overflow-y-auto -mx-6 -mb-4 px-6 pb-4">
          {data.tools.map(t => {
            const selected = selectedTool === t.name;
            const props = t.inputSchema?.properties || {};
            const required = t.inputSchema?.required || [];
            return (
              <div key={t.name}>
                <div className="py-3 border-b border-dark-border last:border-b-0 cursor-pointer hover:bg-dark-hover -mx-6 px-6" {...clickableProps(() => setSelectedTool(selected ? null : t.name), `${t.name} 工具详情`)}>
                  <div className="text-text-primary text-sm font-medium">{t.name}</div>
                  <div className="text-text-muted text-xs mt-0.5">{t.description}</div>
                  {Object.keys(props).length > 0 && <div className="text-accent-blue text-xs mt-1">{Object.keys(props).length} 个参数 {selected ? '▲' : '▼'}</div>}
                </div>
                {selected && Object.keys(props).length > 0 && (
                  <div className="px-6 py-2 bg-dark-bg border-b border-dark-border space-y-1.5">
                    {Object.entries(props).map(([k, v]: any) => (
                      <div key={k} className="flex items-start gap-2 text-xs">
                        <span className="text-yellow-400 font-mono shrink-0 w-28">{k}</span>
                        <span className="text-text-muted shrink-0">({v.type || 'any'})</span>
                        {required.includes(k) && <span className="text-red-400 shrink-0">*必填</span>}
                        {v.description && <span className="text-text-secondary">— {v.description}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Modal>
  );
}

interface ConfigModalProps {
  data: ConfigModalContent | null;
  onClose: () => void;
}

export function ConfigModalView({ data, onClose }: ConfigModalProps) {
  return (
    <Modal title={data?.title || 'MCP 发布配置'} open={!!data} onCancel={onClose} footer={null} width={600}>
      {data?.note && <p className="text-text-muted text-xs mb-3 whitespace-pre-line">{data.note}</p>}
      <JsonBlock json={data?.json} />
      {data?.extra?.map(sec => (
        <div key={sec.label} className="mt-4">
          <div className="text-text-primary text-xs font-semibold mb-1">{sec.label}</div>
          <JsonBlock json={sec.json} />
        </div>
      ))}
    </Modal>
  );
}

/** 可复制 JSON 块（配置片段一律可整段复制后粘进「MCP 配置」） */
function JsonBlock({ json }: { json?: string }) {
  return (
    <div className="relative">
      <pre className="bg-dark-bg border border-dark-border rounded p-3 text-xs font-mono text-yellow-400 whitespace-pre-wrap overflow-x-auto">{json}</pre>
      <Button size="small" className="absolute top-2 right-2" onClick={() => { navigator.clipboard.writeText(json || ''); message.success('已复制到剪贴板'); }}>复制</Button>
    </div>
  );
}
