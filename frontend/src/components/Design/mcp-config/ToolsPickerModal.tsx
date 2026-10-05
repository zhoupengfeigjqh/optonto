'use client';

/**
 * 「MCP 工具列表」弹窗：查看某服务下的工具，并勾选要注册给 Agent 的工具。
 *
 * 选择状态与保存副作用留在容器（`MCPConfigPanel`），本组件只做渲染 + **单一交互回调**
 * `onSelectionChange`（全选 / 取消全选 / 单个勾选都归一到它）；「展开参数详情」是纯视图状态，
 * 故收在组件内，关闭即重置。
 */
import { useEffect, useState } from 'react';
import { Button, Modal } from 'antd';
import { clickableProps, checkboxProps } from '@/utils/a11y';
import type { MCPServerConfig, MCPToolInfo } from '@/api/agent-client';

interface Props {
  /** null = 关闭 */
  server: MCPServerConfig | null;
  loading: boolean;
  error: string | null;
  tools: MCPToolInfo[];
  /** 已勾选工具名（空集 = 注册全部） */
  selected: Set<string>;
  onSelectionChange: (names: Set<string>) => void;
  onConfirm: () => void;
  onClose: () => void;
}

export function ToolsPickerModal({
  server, loading, error, tools, selected, onSelectionChange, onConfirm, onClose,
}: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);

  // 关闭即清展开态：下次打开从收起开始（避免沿用上次的展开项）
  useEffect(() => { if (!server) setExpanded(null); }, [server]);

  const toggle = (name: string) => {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    onSelectionChange(next);
  };

  return (
    <Modal
      title={`MCP 工具列表 - ${server?.name || ''}`}
      open={!!server}
      onCancel={onClose}
      footer={
        !loading && !error && tools.length > 0 ? (
          <div className="flex items-center justify-between">
            <span className="text-text-muted text-xs">
              {selected.size === 0
                ? '当前未选择任何工具，将注册全部工具'
                : `已选择 ${selected.size}/${tools.length} 个工具，仅注册选中的工具`}
            </span>
            <Button type="primary" onClick={onConfirm}>确认</Button>
          </div>
        ) : null
      }
      width={650}
    >
      {loading ? (
        <p className="text-text-muted text-sm py-8 text-center">正在连接 MCP 服务...</p>
      ) : error ? (
        <p className="text-red-400 text-sm py-4">连接失败: {error}</p>
      ) : tools.length === 0 ? (
        <p className="text-text-muted text-sm py-8 text-center">暂无工具信息</p>
      ) : (
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Button size="small" onClick={() => onSelectionChange(new Set(tools.map(t => t.name)))}>全选</Button>
            <Button size="small" onClick={() => onSelectionChange(new Set())}>取消全选</Button>
            <span className="text-text-muted text-xs ml-2">勾选需要注册给 Agent 的工具，不勾选则注册全部</span>
          </div>
          <div className="max-h-96 overflow-y-auto -mx-6 -mb-4 px-6 pb-4">
            {tools.map(t => {
              const isOpen = expanded === t.name;
              const props = t.inputSchema?.properties || {};
              const required = t.inputSchema?.required || [];
              const checked = selected.has(t.name);
              return (
                <div key={t.name}>
                  <div className="py-3 border-b border-dark-border last:border-b-0 cursor-pointer hover:bg-dark-hover -mx-6 px-6 flex items-start gap-3" {...clickableProps(() => setExpanded(isOpen ? null : t.name), `${t.name} 工具详情`)}>
                    <div className="pt-0.5" {...checkboxProps(checked, () => toggle(t.name), `注册工具 ${t.name}`)}>
                      <div className={`w-4 h-4 rounded border ${checked ? 'bg-accent-blue border-accent-blue' : 'bg-white border-gray-300'} flex items-center justify-center transition-colors`}>
                        {checked && <span className="text-white text-xs leading-none">✓</span>}
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-text-primary text-sm font-medium">{t.name}</div>
                      <div className="text-text-muted text-xs mt-0.5">{t.description}</div>
                      {Object.keys(props).length > 0 && <div className="text-accent-blue text-xs mt-1">{Object.keys(props).length} 个参数 {isOpen ? '▲' : '▼'}</div>}
                    </div>
                  </div>
                  {isOpen && Object.keys(props).length > 0 && (
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
        </div>
      )}
    </Modal>
  );
}
