'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, Modal, message, Tag } from 'antd';
import { getMcpStatus, startMcp, stopMcp, getMcpTools } from '@/api/client';

export default function MCPService() {
  const [mcpRunning, setMcpRunning] = useState(false);
  const [mcpChecking, setMcpChecking] = useState(true);
  const [mcpToggling, setMcpToggling] = useState(false);
  const [mcpTools, setMcpTools] = useState<{ name: string; description: string; inputSchema?: any }[]>([]);
  const [toolsModalOpen, setToolsModalOpen] = useState(false);
  const [mcpSelectedTool, setMcpSelectedTool] = useState<string | null>(null);
  const [configModalOpen, setConfigModalOpen] = useState(false);
  const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost';

  const checkMcpStatus = useCallback(async () => {
    setMcpChecking(true);
    try {
      const [s, tools] = await Promise.all([getMcpStatus(), getMcpTools(host)]);
      setMcpRunning(s.running);
      setMcpTools(tools);
    } catch { setMcpRunning(false); }
    finally { setMcpChecking(false); }
  }, []);

  useEffect(() => { checkMcpStatus(); }, [checkMcpStatus]);

  const handleMcpToggle = async () => {
    setMcpToggling(true);
    try {
      const r = mcpRunning ? await stopMcp() : await startMcp();
      message.success(r.message);
      setMcpRunning(r.running);
      // Retry fetching tools until MCP is ready
      if (r.running) {
        for (let attempt = 0; attempt < 6; attempt++) {
          await new Promise(r => setTimeout(r, 1000));
          try {
            const tools = await getMcpTools(host);
            if (tools && tools.length > 0) { setMcpTools(tools); break; }
          } catch { /* retry */ }
        }
      } else {
        setMcpTools([]);
      }
    } catch (e: any) { message.error(e.message); }
    finally { setMcpToggling(false); }
  };

  const mcpConfigJson = JSON.stringify({
    mcpServers: {
      'optonto-api': { type: 'url', url: `http://${host}:8002/sse` },
    },
  }, null, 2);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-base font-semibold text-text-primary">MCP 服务</h3>
          <p className="text-text-muted text-xs mt-0.5">管理 Model Context Protocol 服务，供 AI 客户端连接使用。</p>
        </div>
      </div>

      <div className="bg-dark-card border border-dark-border rounded-lg p-5 max-w-xl">
        <div className="flex items-center gap-3 mb-4">
          <span className={`w-3 h-3 rounded-full ${mcpChecking ? 'bg-gray-500' : mcpRunning ? 'bg-green-500' : 'bg-red-500'}`} />
          <span className="text-text-primary text-sm font-medium">
            {mcpChecking ? '检查中...' : mcpRunning ? '运行中' : '已停止'}
          </span>
        </div>

        <div className="text-xs text-text-muted space-y-1 mb-5">
          <div>SSE 端点：<code className="text-yellow-400">http://{host}:8002/sse</code></div>
          <div>健康检查：<code className="text-yellow-400">http://{host}:8002/health</code></div>
          <div className="flex items-center gap-2">
            <span>可用工具：</span>
            <span className="text-accent-green font-semibold">{mcpTools.length}</span>
            <Button type="link" size="small" onClick={() => setToolsModalOpen(true)}>
              查看工具
            </Button>
          </div>
        </div>

        <div className="flex gap-2">
          <Button onClick={() => setConfigModalOpen(true)}>查看配置</Button>
          <Button loading={mcpToggling} onClick={handleMcpToggle}>
            {mcpRunning ? '停止' : '启动'}
          </Button>
          <Button onClick={() => {
            Modal.info({
              title: <span style={{color:'#fff'}}>MCP 测试</span>,
              content: <p className="text-text-secondary text-sm">请将 MCP 地址复制到其他平台用于测试，本平台暂不支持。</p>,
              okText: '知道了',
            });
          }}>测试</Button>
        </div>
      </div>

      {/* ─── Tools Modal (工具列表) ──────────────────────────────────── */}
      <Modal title="MCP 工具列表" open={toolsModalOpen} onCancel={() => { setToolsModalOpen(false); setMcpSelectedTool(null); }} footer={null} width={650}>
        {mcpTools.length === 0 ? (
          <p className="text-text-muted text-sm py-8 text-center">暂无工具信息</p>
        ) : (
          <div className="max-h-96 overflow-y-auto -mx-6 -mb-4 px-6 pb-4">
            {mcpTools.map(t => {
              const selected = mcpSelectedTool === t.name;
              const props = t.inputSchema?.properties || {};
              const required = t.inputSchema?.required || [];
              return (
              <div key={t.name}>
                <div className="py-3 border-b border-dark-border last:border-b-0 cursor-pointer hover:bg-dark-hover -mx-6 px-6" onClick={() => setMcpSelectedTool(selected ? null : t.name)}>
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

      {/* ─── Config Modal (MCP 配置) ──────────────────────────────────── */}
      <Modal title="MCP 服务配置" open={configModalOpen} onCancel={() => setConfigModalOpen(false)} footer={null} width={600}>
        <p className="text-text-muted text-xs mb-3">将以下配置添加到你的 agent 的 MCP 配置中，即可连接本体服务。</p>
        <div className="relative">
          <pre className="bg-dark-bg border border-dark-border rounded p-3 text-xs font-mono text-yellow-400 whitespace-pre-wrap overflow-x-auto">{mcpConfigJson}</pre>
          <Button size="small" className="absolute top-2 right-2" onClick={() => { navigator.clipboard.writeText(mcpConfigJson); message.success('MCP 配置已复制到剪贴板'); }}>复制</Button>
        </div>
        <div className="text-xs text-text-muted space-y-1 mt-4">
          <div>SSE 端点：<code className="text-yellow-400">http://{host}:8002/sse</code></div>
          <div>健康检查：<code className="text-yellow-400">http://{host}:8002/health</code></div>
        </div>
      </Modal>
    </div>
  );
}
