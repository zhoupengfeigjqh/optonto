'use client';

import { useState } from 'react';
import { Modal, message } from 'antd';
import { load as parseYaml } from 'js-yaml';
import { getDeployedOntology } from '@/api/client';

interface Props {
  ontologyId: number;
  deployedVersion: string;
  /** 小尺寸（用于卡片） */
  compact?: boolean;
}

/** 弹窗只展示的部署元数据字段（顺序即展示顺序） */
const META_FIELDS: Array<[string, string]> = [
  ['deployed_version', '部署版本'],
  ['ontology_name', '本体名称'],
  ['ontology_id', '本体 ID'],
  ['scenario_name', '所属场景'],
  ['scenario_id', '场景 ID'],
  ['created_at', '创建时间'],
  ['source_file', '来源文件'],
  ['source_thread', '来源会话'],
];

/** 已部署版本标签：绿色可点击，点击弹出已部署本体的基本元数据（不展示完整 YAML） */
export default function DeployedVersionBadge({ ontologyId, deployedVersion, compact }: Props) {
  const [meta, setMeta] = useState<Record<string, unknown>>({});
  const [show, setShow] = useState(false);

  const openMetadata = async () => {
    try {
      const res = await getDeployedOntology(ontologyId);
      let parsed: Record<string, unknown> = {};
      try {
        const doc = parseYaml(res.content);
        const raw = doc && typeof doc === 'object' ? (doc as any).metadata : null;
        if (raw && typeof raw === 'object') parsed = raw as Record<string, unknown>;
      } catch {
        // YAML 解析失败时仍展示版本号，其余字段留空，避免整个入口不可用
      }
      setMeta(parsed);
      setShow(true);
    } catch (e: any) {
      message.error('加载部署元数据失败: ' + e.message);
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
        onClick={(e) => { e.stopPropagation(); openMetadata(); }}
        title="点击查看本体部署元数据"
      >
        {compact ? deployedVersion : `已部署: ${deployedVersion}`}
      </button>

      <Modal
        open={show}
        title={<span style={{ color: '#fff' }}>本体部署元数据</span>}
        onCancel={() => setShow(false)}
        footer={null}
        width={560}
        styles={{ body: { paddingTop: 12 } }}
      >
        <dl className="grid grid-cols-[96px_1fr] gap-x-4 gap-y-3 text-sm">
          {META_FIELDS.map(([key, label]) => {
            const raw = key === 'deployed_version' ? (meta[key] || deployedVersion) : meta[key];
            const value = raw === undefined || raw === null || raw === '' ? '-' : String(raw);
            return (
              <div key={key} className="contents">
                <dt className="text-text-muted">{label}</dt>
                <dd className="text-text-primary break-all m-0">{value}</dd>
              </div>
            );
          })}
        </dl>
      </Modal>
    </>
  );
}
