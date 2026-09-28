'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { Button, Modal, Select, Spin, message } from 'antd';
import { CloudUploadOutlined, MergeCellsOutlined } from '@ant-design/icons';
import CodeMirror from '@uiw/react-codemirror';
import { yaml as yamlLang } from '@codemirror/lang-yaml';
import { dump as dumpYaml } from 'js-yaml';
import {
  getDeployVersions, getDeployPreview, deployOntology,
  getDeployedOntology, checkVersionExists, getVersionPreview,
  saveVersionToDisk, getDeployedVersion, DeployDoc,
} from '@/api/client';
import { splitDoc, ALL, KEY_LABELS } from '@/utils/yaml-segments';

interface Props {
  ontologyId: number;
  activeTab?: string;
}

type PreviewSource = 'thread' | 'version-dir' | 'deployed';

const STAT_LABELS: Record<string, string> = {
  concepts: '概念', relations: '关系', functions: '函数',
  behaviors: '行为', rules: '规则', processes: '流程',
};

export default function OntologyDeployer({ ontologyId, activeTab }: Props) {
  const [versions, setVersions] = useState<{ version: string; docs: DeployDoc[]; count: number }[]>([]);
  const [version, setVersion] = useState<string>('');
  const [deployedVersion, setDeployedVersion] = useState<string>('');
  const [versionExists, setVersionExists] = useState(false); // 是否已存档到 ontology_versions
  const [versionExistsLoading, setVersionExistsLoading] = useState(false);

  const [preview, setPreview] = useState<{ content: string; stats: Record<string, number> } | null>(null);
  const [previewSource, setPreviewSource] = useState<PreviewSource>('thread');
  const [deploying, setDeploying] = useState(false);
  const [merging, setMerging] = useState(false);
  const [loadingVersions, setLoadingVersions] = useState(true);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [activeKey, setActiveKey] = useState<string>(ALL);

  // ── 加载版本列表 ──
  const loadVersions = useCallback(async () => {
    setLoadingVersions(true);
    try {
      const [verRes, depRes] = await Promise.all([
        getDeployVersions(ontologyId),
        getDeployedVersion(ontologyId),
      ]);
      setVersions(verRes.versions);
      setDeployedVersion(depRes.deployed_version || '');
      if (verRes.versions.length && !verRes.versions.some(v => v.version === version)) {
        setVersion(verRes.versions[0].version);
      }
    } catch (e: any) {
      message.error('加载版本失败: ' + e.message);
    } finally {
      setLoadingVersions(false);
    }
  }, [ontologyId, version]);

  // ── 检查版本是否已存档 ──
  const checkVersion = useCallback(async (v: string) => {
    if (!v) return;
    setVersionExistsLoading(true);
    try {
      const res = await checkVersionExists(ontologyId, v);
      setVersionExists(res.exists);
    } catch {
      setVersionExists(false);
    } finally {
      setVersionExistsLoading(false);
    }
  }, [ontologyId]);

  // ── 加载预览（根据情况选择来源） ──
  const loadPreview = useCallback(async (v: string) => {
    if (!v) return;
    setLoadingPreview(true);
    setPreview(null);
    setActiveKey(ALL);
    try {
      // 情况 1：选中版本 = 当前部署版本 → 展示部署目录下的 yaml
      if (v === deployedVersion) {
        const res = await getDeployedOntology(ontologyId);
        const raw = dumpYaml({ content: res.content }, { noRefs: true, lineWidth: -1 });
        // 直接用部署目录的原始 yaml 内容
        setPreview({ content: res.content, stats: {} });
        setPreviewSource('deployed');
        return;
      }

      // 情况 2：版本已存档 → 从 version 目录读取
      const { exists } = await checkVersionExists(ontologyId, v);
      setVersionExists(exists);
      if (exists) {
        const res = await getVersionPreview(ontologyId, v);
        const content = dumpYaml(res.merged, { noRefs: true, lineWidth: -1 });
        setPreview({ content, stats: res.stats });
        setPreviewSource('version-dir');
        return;
      }

      // 情况 3：版本未存档 → 从 thread 合并
      const res = await getDeployPreview(ontologyId, v);
      const content = dumpYaml(res.merged, { noRefs: true, lineWidth: -1 });
      setPreview({ content, stats: res.stats });
      setPreviewSource('thread');
    } catch (e: any) {
      message.error('加载预览失败: ' + e.message);
      setPreview(null);
    } finally {
      setLoadingPreview(false);
    }
  }, [ontologyId, deployedVersion]);

  // 版本变化时重新加载
  useEffect(() => {
    if (version) {
      checkVersion(version);
      loadPreview(version);
    }
  }, [version, ontologyId, deployedVersion]);

  // 首次加载
  useEffect(() => {
    if (activeTab === 'deployment') loadVersions();
  }, [ontologyId, activeTab]);

  const currentDocs = useMemo(
    () => versions.find(v => v.version === version)?.docs ?? [],
    [versions, version],
  );

  const yamlDoc = useMemo(() => (preview ? splitDoc(preview.content) : null), [preview]);

  const statsText = preview
    ? Object.entries(preview.stats).filter(([, n]) => n > 0).map(([k, n]) => `${STAT_LABELS[k] ?? k}:${n}`).join(' ')
    : '';

  // ── 按钮状态 ──
  const isCurrentDeployed = version === deployedVersion && !!deployedVersion;
  const canMerge = !isCurrentDeployed && !versionExists && !!preview && !versionExistsLoading;
  const canDeploy = !isCurrentDeployed && versionExists && !!preview && !versionExistsLoading;

  // ── 本体合并 ──
  const handleMerge = async () => {
    if (!version) return;
    Modal.confirm({
      title: <span style={{ color: '#fff' }}>确认本体合并</span>,
      content: (
        <div className="text-text-secondary text-sm space-y-1">
          <p>将把版本 <strong className="text-accent-blue">{version}</strong> 的所有 thread 分片合并后，输出到：</p>
          <p className="font-mono text-xs bg-dark-card border border-dark-border rounded px-2 py-1">
            ontology_versions/{version}/
          </p>
          <p className="text-text-muted">合并内容包括：ontology.yaml、securities.yaml、data_engines.yaml 三个文件。</p>
        </div>
      ),
      okText: '确认合并', cancelText: '取消',
      onOk: async () => {
        setMerging(true);
        try {
          const res = await saveVersionToDisk(ontologyId, version);
          message.success(res.message);
          setVersionExists(true);
          // 重新从 version 目录加载预览
          setLoadingPreview(true);
          try {
            const vp = await getVersionPreview(ontologyId, version);
            const content = dumpYaml(vp.merged, { noRefs: true, lineWidth: -1 });
            setPreview({ content, stats: vp.stats });
            setPreviewSource('version-dir');
          } catch (e2: any) {
            message.error('加载版本预览失败: ' + e2.message);
          } finally {
            setLoadingPreview(false);
          }
        } catch (e: any) {
          message.error('合并失败: ' + e.message);
        } finally {
          setMerging(false);
        }
      },
    });
  };

  // ── 部署 ──
  const handleDeploy = () => {
    if (!preview) return;
    Modal.confirm({
      title: <span style={{ color: '#fff' }}>确认部署</span>,
      content: (
        <div className="text-text-secondary text-sm space-y-1">
          <p>将把版本 <strong className="text-accent-blue">{version}</strong> 的本体部署到：</p>
          <p className="font-mono text-xs bg-dark-card border border-dark-border rounded px-2 py-1">onto_market/…/ontology.yaml</p>
          <p className="text-amber-400">
            部署前会自动备份当前部署到版本目录。此操作会覆盖本体文件。
          </p>
        </div>
      ),
      okText: '确认部署', cancelText: '取消', okButtonProps: { danger: true },
      onOk: async () => {
        setDeploying(true);
        try {
          const res = await deployOntology(ontologyId, version);
          message.success(res.message);
          setDeployedVersion(version);
          // 重新检查版本状态
          await checkVersion(version);
          // 以 deployed 来源重新加载预览
          setLoadingPreview(true);
          try {
            const depRes = await getDeployedOntology(ontologyId);
            setPreview({ content: depRes.content, stats: res.stats || {} });
            setPreviewSource('deployed');
          } catch (e2: any) {
            message.error('重新加载部署内容失败: ' + e2.message);
          } finally {
            setLoadingPreview(false);
          }
        } catch (e: any) {
          message.error('部署失败: ' + e.message);
        } finally {
          setDeploying(false);
        }
      },
    });
  };

  // ── 渲染提示文本 ──
  const renderHint = () => {
    if (!version) return '';
    if (isCurrentDeployed) {
      return `当前部署版本「${deployedVersion}」，展示已部署的本体内容。如需部署其他版本，请选择其他版本。`;
    }
    if (versionExists) {
      return `版本「${version}」已存档，展示已保存的本体内容。点击「部署」将其部署为当前版本。`;
    }
    return `版本「${version}」尚未存档，展示 thread 合并后的预览。点击「本体合并」将结果保存到版本目录。`;
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
            options={versions.map(v => ({
              value: v.version,
              label: `${v.version || '（无版本）'}${v.version === deployedVersion ? ' ✅ 当前部署' : ''} · ${v.count} 个分片`,
            }))}
          />
          <Button
            icon={<MergeCellsOutlined />}
            onClick={handleMerge}
            loading={merging}
            disabled={!canMerge}
          >
            本体合并
          </Button>
          <Button
            type="primary"
            danger
            icon={<CloudUploadOutlined />}
            onClick={handleDeploy}
            loading={deploying}
            disabled={!canDeploy}
          >
            部署
          </Button>
        </div>
      </div>

      <p className="text-text-muted text-xs mb-3">{renderHint()}</p>

      {loadingVersions || loadingPreview || versionExistsLoading ? (
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
            {previewSource === 'thread' && currentDocs.map(d => (
              <span key={d.md} className="px-2 py-0.5 text-xs rounded bg-dark-card border border-dark-border text-text-secondary">
                {d.md} <span className="text-text-muted">→ {d.yaml}</span>
              </span>
            ))}
            <span className="text-xs text-text-muted ml-auto">
              {previewSource === 'deployed' && `📦 已部署${deployedVersion ? ` · ${deployedVersion}` : ''}`}
              {previewSource === 'version-dir' && `📁 已存档 · ${version}`}
              {previewSource === 'thread' && '🔄 合并预览'}
              {statsText ? ` · ${statsText}` : ''}
            </span>
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