'use client';

import { useEffect, useState } from 'react';
import { Modal, message } from 'antd';
import CodeMirror from '@uiw/react-codemirror';
import { yaml as yamlLang } from '@codemirror/lang-yaml';
import { getDeployedOntology } from '@/api/client';
import { splitDoc, ALL, KEY_LABELS } from '@/utils/yaml-segments';

interface Props {
  ontologyId: number;
  deployedVersion: string;
  /** 小尺寸（用于卡片） */
  compact?: boolean;
}

/** 已部署版本标签：绿色可点击，点击查看已部署 ontology.yaml 内容（分节展示） */
export default function DeployedVersionBadge({ ontologyId, deployedVersion, compact }: Props) {
  const [content, setContent] = useState('');
  const [show, setShow] = useState(false);
  const [activeKey, setActiveKey] = useState<string>(ALL);

  const yamlDoc = content ? splitDoc(content) : null;

  const load = async () => {
    try {
      const res = await getDeployedOntology(ontologyId);
      setContent(res.content);
      setShow(true);
      setActiveKey(ALL);
    } catch (e: any) {
      message.error('加载已部署内容失败: ' + e.message);
    }
  };

  if (!deployedVersion) {
    return (
      <span className={`px-2 py-0.5 text-xs rounded-full bg-gray-500/15 text-gray-400 border border-gray-500/30 ${compact ? '' : ''}`}>
        未部署
      </span>
    );
  }

  return (
    <>
      <button
        className={`px-2 py-0.5 text-xs rounded-full bg-green-500/15 text-green-400 border border-green-500/30 hover:bg-green-500/25 transition-colors ${compact ? 'text-[11px] px-1.5' : ''}`}
        onClick={(e) => { e.stopPropagation(); load(); }}
        title="点击查看已部署的本体内容"
      >
        {compact ? deployedVersion : `已部署: ${deployedVersion}`}
      </button>

      <Modal
        open={show}
        title={<span style={{ color: '#fff' }}>已部署本体{deployedVersion ? ` · ${deployedVersion}` : ''}</span>}
        onCancel={() => setShow(false)}
        footer={null}
        width="75vw"
        style={{ top: 24 }}
        styles={{ body: { background: '#1a1a1a', borderRadius: 8, height: '75vh' } }}
      >
        <div className="flex h-full" style={{ height: 'calc(75vh - 24px)' }}>
          <div className="w-28 shrink-0 border-r border-dark-border flex flex-col bg-dark-card">
            <div className="px-3 py-2 text-xs text-text-muted border-b border-dark-border">一级目录</div>
            <div className="flex-1 overflow-y-auto p-1">
              <div
                className={`px-2 py-1.5 rounded cursor-pointer text-sm mb-0.5 transition-colors ${
                  activeKey === ALL ? 'bg-accent-blue/15 text-accent-blue' : 'text-text-secondary hover:bg-dark-hover'
                }`}
                onClick={() => setActiveKey(ALL)}
              >
                全部
              </div>
              {(yamlDoc?.segs ?? []).map(s => (
                <div
                  key={s.key}
                  className={`px-2 py-1.5 rounded cursor-pointer text-sm mb-0.5 transition-colors ${
                    activeKey === s.key ? 'bg-accent-blue/15 text-accent-blue' : 'text-text-secondary hover:bg-dark-hover'
                  }`}
                  onClick={() => setActiveKey(s.key)}
                >
                  {KEY_LABELS[s.key] ?? s.key}
                </div>
              ))}
            </div>
          </div>
          <div className="flex-1 min-w-0 flex flex-col">
            <CodeMirror
              value={
                activeKey === ALL
                  ? content
                  : (yamlDoc?.segs.find(s => s.key === activeKey)?.text ?? '')
              }
              extensions={[yamlLang()]}
              theme="dark"
              height="calc(75vh - 24px)"
              editable={false}
              style={{ fontSize: 13 }}
              basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: true, autocompletion: false }}
            />
          </div>
        </div>
      </Modal>
    </>
  );
}
