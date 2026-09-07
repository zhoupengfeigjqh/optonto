'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button, Modal, Select, Spin, message } from 'antd';
import { CloudUploadOutlined } from '@ant-design/icons';
import CodeMirror from '@uiw/react-codemirror';
import { yaml as yamlLang } from '@codemirror/lang-yaml';
import { dump as dumpYaml } from 'js-yaml';
import { getDeployVersions, getDeployPreview, deployOntology, getDeployedOntology, DeployDoc } from '@/api/client';
import { splitDoc, ALL, KEY_LABELS } from '@/utils/yaml-segments';

interface Props {
  ontologyId: number;
  activeTab?: string;
}

const STAT_LABELS: Record<string, string> = {
  concepts: '概念', relations: '关系', functions: '函数',
  behaviors: '行为', rules: '规则', processes: '流程',
};

export default function OntologyDeployer({ ontologyId, activeTab }: Props) {
  const [versions, setVersions] = useState<{ version: string; docs: DeployDoc[]; count: number }[]>([]);
  const [version, setVersion] = useState<string>('');
  const [preview, setPreview] = useState<{ content: string; stats: Record<string, number> } | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [loadingVersions, setLoadingVersions] = useState(true);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [activeKey, setActiveKey] = useState<string>(ALL);

  const loadVersions = async () => {
    setLoadingVersions(true);
    try {
      const res = await getDeployVersions(ontologyId);
      setVersions(res.versions);
      if (res.versions.length && !res.versions.some(v => v.version === version)) {
        setVersion(res.versions[0].version);
      }
    } catch (e: any) {
      message.error('加载版本失败: ' + e.message);
    } finally {
      setLoadingVersions(false);
    }
  };

  const loadPreview = async (v: string) => {
    setLoadingPreview(true);
    setPreview(null);
    setActiveKey(ALL);
    try {
      const res = await getDeployPreview(ontologyId, v);
      const content = dumpYaml(res.merged, { noRefs: true, lineWidth: -1 });
      setPreview({ content, stats: res.stats });
    } catch (e: any) {
      message.error('合并预览失败: ' + e.message);
    } finally {
      setLoadingPreview(false);
    }
  };

  useEffect(() => { if (activeTab === 'deployment') loadVersions(); }, [ontologyId, activeTab]);
  useEffect(() => { if (version) loadPreview(version); }, [version, ontologyId]);

  const currentDocs = useMemo(
    () => versions.find(v => v.version === version)?.docs ?? [],
    [versions, version],
  );

  const yamlDoc = useMemo(() => (preview ? splitDoc(preview.content) : null), [preview]);

  const statsText = preview
    ? Object.entries(preview.stats).filter(([, n]) => n > 0).map(([k, n]) => `${STAT_LABELS[k] ?? k}:${n}`).join(' ')
    : '';

  const handleDeploy = () => {
    if (!preview) return;
    Modal.confirm({
      title: <span style={{ color: '#fff' }}>确认部署</span>,
      content: (
        <div className="text-text-secondary text-sm space-y-1">
          <p>将把版本 <strong className="text-accent-blue">{version}</strong> 合并后的本体（{statsText}）部署为：</p>
          <p className="font-mono text-xs bg-dark-card border border-dark-border rounded px-2 py-1">onto_market/…/ontology.yaml</p>
          <p className="text-amber-400">请注意，此操作会覆盖本体文件，并且需要重新配置设置安全和数据引擎。</p>
        </div>
      ),
      okText: '确认部署', cancelText: '取消', okButtonProps: { danger: true },
      onOk: async () => {
        setDeploying(true);
        try {
          const res = await deployOntology(ontologyId, version);
          if (res.already_deployed) {
            message.info(res.message);
          } else {
            message.success(res.message);
            loadVersions();
          }
        } catch (e: any) {
          message.error('部署失败: ' + e.message);
        } finally {
          setDeploying(false);
        }
      },
    });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-text-primary">本体部署</h3>
        <div className="flex items-center gap-2">
          <Select
            style={{ minWidth: 260 }}
            placeholder="选择版本"
            value={version || undefined}
            onChange={setVersion}
            loading={loadingVersions}
            options={versions.map(v => ({ value: v.version, label: `${v.version || '（无版本）'} · ${v.count} 个分片` }))}
          />
          <Button
            type="primary"
            danger
            icon={<CloudUploadOutlined />}
            onClick={handleDeploy}
            loading={deploying}
            disabled={!preview}
          >
            部署
          </Button>
        </div>
      </div>

      <p className="text-text-muted text-xs mb-3">
        选择后自动拼接该版本下所有已生成的本体分片（一级目录按名字去重），确认后部署后将初始化本体文件，后续可在本体明细中进一步修改和调整。
      </p>

      {loadingVersions || loadingPreview ? (
        <div className="flex items-center justify-center h-64"><Spin /></div>
      ) : !preview ? (
        <div className="py-10 text-center text-text-muted text-sm">
          {versions.length === 0
            ? '当前本体还没有已生成的版本，请先在「需求汇总」中对需求文档执行「本体生成」。'
            : '请选择一个版本查看合并结果。'}
        </div>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {currentDocs.map(d => (
              <span key={d.md} className="px-2 py-0.5 text-xs rounded bg-dark-card border border-dark-border text-text-secondary">
                {d.md} <span className="text-text-muted">→ {d.yaml}</span>
              </span>
            ))}
            <span className="text-xs text-text-muted ml-auto">{statsText}</span>
          </div>
          <div className="flex flex-1 min-h-0 border border-dark-border rounded-lg overflow-hidden bg-dark-bg">
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
                    ? preview.content
                    : (yamlDoc?.segs.find(s => s.key === activeKey)?.text ?? '')
                }
                extensions={[yamlLang()]}
                theme="dark"
                height="calc(100vh - 320px)"
                editable={false}
                style={{ fontSize: 13 }}
                basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: true, autocompletion: false }}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
