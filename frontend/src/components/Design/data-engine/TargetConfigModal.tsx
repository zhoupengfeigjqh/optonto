'use client';

/**
 * 目标接口设置弹窗（自 DataEngineTable.tsx 抽取）。
 *
 * 设计：把「表单状态」整体收进本组件，对外只暴露窄接口（初值 + 保存回调），
 * 使父组件不再持有 10 余个只与弹窗相关的 state，也不再关心 MCP 服务/工具的拉取细节。
 *
 * 目标接口 = 「已配置的手工（非内置）MCP 服务」+「该服务下的工具」（文档 §八.1/§八.2）。
 * 选中工具后按 schema 自动提取输入/输出结构；工具未声明 outputSchema 时，
 * 走降级链 §九.2：试调提取（真实调一次反推字段）或手工编辑。
 *
 * 持久化（ensureEngine / updateDataEngine / 行为落盘）由父组件经 onSave 完成，
 * 本组件只负责组装出编辑后的 TargetApiConfig。
 */
import { useCallback, useEffect, useState } from 'react';
import { Button, Input, Modal, Select, message } from 'antd';
import { CodeOutlined } from '@ant-design/icons';
import type { MCPServerConfig, MCPToolInfo } from '@/api/agent-client';
import { getMCPConfig, listMCPTools, callMCPTool } from '@/api/agent-client';
import type { TargetApiConfig } from '@/api/client';
import JsonEditor from '@/components/JsonEditor';
import {
  emptyTarget, schemaToParams, inferFromSample, seedArgsFromParamSchema,
} from './data-engine-helpers';

interface Props {
  open: boolean;
  /** 标题中的行为展示名 */
  behaviorLabel: string;
  /** 打开时的回显初值（当前引擎的 target） */
  initialTarget: TargetApiConfig;
  onCancel: () => void;
  /** 保存：编辑后的 target + 所选 MCP 服务（父组件用其 headers 做鉴权快照） */
  onSave: (target: TargetApiConfig, server?: MCPServerConfig) => Promise<void>;
}

export default function TargetConfigModal({ open, behaviorLabel, initialTarget, onCancel, onSave }: Props) {
  const [targetData, setTargetData] = useState<TargetApiConfig>({ ...emptyTarget });
  const [paramsStr, setParamsStr] = useState('{}');
  const [responseStr, setResponseStr] = useState('{}');
  const [paramsOpen, setParamsOpen] = useState(false);
  const [responseOpen, setResponseOpen] = useState(false);

  const [mcpServers, setMcpServers] = useState<MCPServerConfig[]>([]);
  const [mcpTools, setMcpTools] = useState<MCPToolInfo[]>([]);
  const [mcpToolsLoading, setMcpToolsLoading] = useState(false);
  const [selectedServerUrl, setSelectedServerUrl] = useState('');
  const [selectedToolName, setSelectedToolName] = useState('');

  const [trialOpen, setTrialOpen] = useState(false);
  const [trialArgs, setTrialArgs] = useState('{}');
  const [trialLoading, setTrialLoading] = useState(false);

  const fetchToolList = useCallback(async (serverUrl: string, headers?: Record<string, string>) => {
    setMcpToolsLoading(true);
    try {
      const r = await listMCPTools(serverUrl, headers);
      if (r.success) setMcpTools(r.tools);
      else { setMcpTools([]); message.warning('拉取工具清单失败: ' + (r.error || '')); }
    } catch (e: any) {
      setMcpTools([]);
      message.warning('拉取工具清单失败: ' + e.message);
    } finally {
      setMcpToolsLoading(false);
    }
  }, []);

  // 每次打开按 initialTarget 重置表单，并拉取可选服务与（若已配过的）工具清单
  useEffect(() => {
    if (!open) return;
    const t = initialTarget || { ...emptyTarget };
    setTargetData({ ...emptyTarget, ...t });
    setParamsStr(JSON.stringify(t.params || {}, null, 2));
    setResponseStr(JSON.stringify(t.response || {}, null, 2));
    setSelectedServerUrl(t.server_url || '');
    setSelectedToolName(t.tool_name || '');
    setMcpTools([]);
    (async () => {
      try {
        const cfg = await getMCPConfig();
        setMcpServers(cfg.servers.filter(s => !s.builtin && s.enabled));
      } catch (e: any) {
        message.warning('读取 MCP 服务配置失败: ' + e.message);
      }
    })();
    if (t.server_url) fetchToolList(t.server_url, t.headers);
    // 仅在打开时重置：initialTarget 由父组件在打开前置好，避免编辑中被回写覆盖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /** 选中工具 → schema 自动提取（§八.6）：输入=inputSchema；输出降级链 outputSchema→试调→手工 */
  const handleSelectTool = (toolName: string) => {
    setSelectedToolName(toolName);
    const tool = mcpTools.find(t => t.name === toolName);
    if (!tool) return;
    const server = mcpServers.find(s => s.url === selectedServerUrl);
    setParamsStr(JSON.stringify(schemaToParams(tool.inputSchema), null, 2));
    if (tool.outputSchema) {
      setResponseStr(JSON.stringify(schemaToParams(tool.outputSchema), null, 2));
      message.success('已自动提取输入/输出 schema');
    } else {
      setResponseStr('{}');
      message.info('输入 schema 已提取；该工具未声明输出 schema，请用"试调提取"或手工编辑输出');
    }
    // 数据源/接口名称自动带入（仍可手改）
    setTargetData(p => ({
      ...p,
      data_source_name: p.data_source_name || server?.name || '',
      api_name: toolName,
    }));
  };

  const handleTrial = async () => {
    let args: Record<string, unknown>;
    try { args = JSON.parse(trialArgs || '{}'); } catch { message.warning('样例参数 JSON 格式错误'); return; }
    const server = mcpServers.find(s => s.url === selectedServerUrl);
    setTrialLoading(true);
    try {
      const r = await callMCPTool(selectedServerUrl, selectedToolName, args, server?.headers);
      if (!r.success) { message.error('试调失败: ' + (r.error || '')); return; }
      const inferred = inferFromSample(r.data);
      if (Object.keys(inferred).length === 0) {
        message.warning('响应不是对象/数组，无法反推字段，请手工编辑输出');
        return;
      }
      setResponseStr(JSON.stringify(inferred, null, 2));
      message.success('试调提取完成，请确认输出结构');
      setTrialOpen(false);
    } catch (e: any) {
      message.error('试调失败: ' + e.message);
    } finally {
      setTrialLoading(false);
    }
  };

  const handleSave = async () => {
    let params: Record<string, unknown>;
    let response: Record<string, unknown>;
    try { params = JSON.parse(paramsStr); } catch (e: any) { message.warning('输入 JSON 格式无效: ' + e.message); return; }
    try { response = JSON.parse(responseStr); } catch (e: any) { message.warning('输出 JSON 格式无效: ' + e.message); return; }
    const server = mcpServers.find(s => s.url === selectedServerUrl);
    // 引擎唯一形态=MCP（engine_type 字段已删出 schema）：方法选择/URL 录入已删除（文档 §八.3），
    // server_url+tool_name 落盘自包含；headers 快照自服务配置（远程鉴权，运行期 data-engine-mcp 透传）
    await onSave({
      ...targetData, params, response,
      url: '', method: '',
      server_url: selectedServerUrl,
      tool_name: selectedToolName,
      headers: server?.headers,
    }, server);
  };

  return (
    <Modal title={`目标接口设置 - ${behaviorLabel}`} open={open} onOk={handleSave} onCancel={onCancel}
      okText="保存" cancelText="取消" width={700}
      okButtonProps={{ disabled: !selectedServerUrl || !selectedToolName }}>
      <div className="space-y-3">
        <div className="flex gap-2">
          <div className="flex-1">
            <span className="text-text-muted text-xs">目标 MCP 服务</span>
            <Select
              value={selectedServerUrl || undefined}
              placeholder="选择已配置的 MCP 服务（在 MCP 配置页维护）"
              onChange={v => {
                setSelectedServerUrl(v);
                setSelectedToolName('');
                setMcpTools([]);
                const s = mcpServers.find(x => x.url === v);
                fetchToolList(v, s?.headers);
              }}
              options={mcpServers.map(s => ({ label: `${s.name}${s.enabled ? '' : '（已停用）'}`, value: s.url }))}
              style={{ width: '100%' }} popupClassName="!bg-dark-card"
            />
          </div>
          <div className="flex-1">
            <span className="text-text-muted text-xs">接口（该服务下的工具）</span>
            <Select
              value={selectedToolName || undefined}
              placeholder={selectedServerUrl ? '选择工具' : '先选择 MCP 服务'}
              loading={mcpToolsLoading}
              disabled={!selectedServerUrl}
              onChange={handleSelectTool}
              options={mcpTools.map(t => ({ label: `${t.name} — ${t.description || ''}`, value: t.name }))}
              style={{ width: '100%' }} popupClassName="!bg-dark-card"
              showSearch optionFilterProp="label"
            />
          </div>
        </div>
        {targetData.url && !targetData.server_url && !selectedServerUrl && (
          <p className="text-yellow-400 text-xs">⚠ 该行为仍是旧 HTTP 直连配置（{targetData.url}），已废弃待迁移：请重新选择 MCP 服务与工具，保存后自动转为 MCP 映射。</p>
        )}
        <div className="flex gap-2">
          <div className="flex-1">
            <span className="text-text-muted text-xs">数据源名称</span>
            <Input value={targetData.data_source_name}
              onChange={e => setTargetData(p => ({ ...p, data_source_name: e.target.value }))}
              className="bg-dark-bg border-dark-border text-text-primary" />
          </div>
          <div className="flex-1">
            <span className="text-text-muted text-xs">接口名称</span>
            <Input value={targetData.api_name}
              onChange={e => setTargetData(p => ({ ...p, api_name: e.target.value }))}
              className="bg-dark-bg border-dark-border text-text-primary" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-text-muted text-xs">输入参数 / 输出结构（选中工具自动提取 schema，可手工调整）</span>
          <Button size="small" icon={<CodeOutlined />} onClick={() => setParamsOpen(true)}>编辑输入</Button>
          <Button size="small" icon={<CodeOutlined />} onClick={() => setResponseOpen(true)}>编辑输出</Button>
          <Button size="small" disabled={!selectedToolName} onClick={() => {
            // 用已提取的输入 schema 预填一份样例参数（类型默认值），用户改值后真实试调
            setTrialArgs(JSON.stringify(seedArgsFromParamSchema(paramsStr), null, 2));
            setTrialOpen(true);
          }}><span style={{ color: '#f59e0b' }}>试调提取</span></Button>
        </div>
      </div>

      <Modal title="编辑输入参数" open={paramsOpen} onOk={() => setParamsOpen(false)} onCancel={() => setParamsOpen(false)}
        okText="确认" cancelText="取消" width={700}>
        <div className="border border-dark-border rounded overflow-hidden" style={{ minHeight: 350 }}>
          <JsonEditor value={paramsStr} onChange={setParamsStr} />
        </div>
      </Modal>
      <Modal title="编辑输出结构" open={responseOpen} onOk={() => setResponseOpen(false)} onCancel={() => setResponseOpen(false)}
        okText="确认" cancelText="取消" width={700}>
        <div className="border border-dark-border rounded overflow-hidden" style={{ minHeight: 350 }}>
          <JsonEditor value={responseStr} onChange={setResponseStr} />
        </div>
      </Modal>

      {/* ─── 试调提取 Modal（§九.2 降级链：无 outputSchema → 真实 callTool 反推字段） ─── */}
      <Modal title={`试调提取 - ${selectedToolName}`} open={trialOpen} onOk={handleTrial}
        onCancel={() => setTrialOpen(false)} okText="发送试调" cancelText="取消" width={700} confirmLoading={trialLoading}>
        <p className="text-text-muted text-xs mb-3">用样例参数真实调用一次该工具，从响应反推输出字段结构（查询类工具适用；写操作工具请手工编辑输出，避免试调产生真实数据）</p>
        <span className="text-text-muted text-xs mb-1 block">样例参数 (JSON)</span>
        <div className="border border-dark-border rounded overflow-hidden" style={{ minHeight: 260 }}>
          <JsonEditor value={trialArgs} onChange={setTrialArgs} />
        </div>
      </Modal>
    </Modal>
  );
}
