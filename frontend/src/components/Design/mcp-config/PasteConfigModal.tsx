'use client';

/**
 * 「粘贴配置」弹窗：把自建发布「查看配置」给出的片段（含令牌请求头）一粘贴即导入。
 *
 * 组件只管输入与展示；**解析与校验的唯一实现在 `server-config.importServerSnippet`**，
 * 由容器（MCPConfigPanel）调用后把 `error` 回灌进来——避免同一套解析出现两份实现。
 */
import { useEffect, useState } from 'react';
import { Input, Modal } from 'antd';

interface Props {
  open: boolean;
  /** 容器解析后回灌的错误（null = 无错） */
  error: string | null;
  onCancel: () => void;
  onImport: (text: string) => void;
}

export function PasteConfigModal({ open, error, onCancel, onImport }: Props) {
  const [text, setText] = useState('');

  // 每次打开都从空白开始：避免上次残留片段被误导入
  useEffect(() => { if (open) setText(''); }, [open]);

  return (
    <Modal
      title="粘贴 MCP 配置"
      open={open}
      onCancel={onCancel}
      onOk={() => onImport(text)}
      okText="导入"
      cancelText="取消"
      width={620}
    >
      <p className="text-text-muted text-xs mb-2">
        把「MCP发布 → 自建发布卡片 → 查看配置」里的整段 JSON 粘进来（含
        <code className="text-accent-blue"> X-MCP-Token </code>请求头）；也可只粘条目
        <code className="text-accent-blue"> {'{"name":"…","url":"…","headers":{…}}'} </code>。
      </p>
      <Input.TextArea
        value={text}
        onChange={e => setText(e.target.value)}
        rows={8}
        className="font-mono text-xs"
        placeholder={'{\n  "mcpServers": {\n    "my-service": { "type": "http", "url": "http://…:8021/mcp", "headers": { "X-MCP-Token": "…" } }\n  }\n}'}
      />
      {error && <p className="text-red-400 text-xs mt-2">{error}</p>}
    </Modal>
  );
}
