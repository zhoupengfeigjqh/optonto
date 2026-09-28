'use client';

import { useEffect, useState } from 'react';
import { PlusOutlined, FolderOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import { message, Button, Empty } from 'antd';
import {
  getScenarios, createScenario, updateScenario,
  getOntologies, createOntology, updateOntology, deleteOntology,
  getOntologyData,
  Scenario, Ontology,
} from '@/api/client';
import DeployedVersionBadge from '@/components/DeployedVersionBadge';
import HomeDialogs from './home-dialogs';

export default function HomePage() {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [selectedScenarioId, setSelectedScenarioId] = useState<number | null>(null);
  const [ontologies, setOntologies] = useState<Ontology[]>([]);
  const [ontoCounts, setOntoCounts] = useState<Record<number, {concepts:number; relations:number; behaviors:number; rules:number}>>({});

  // Dialogs
  const [showNewScenario, setShowNewScenario] = useState(false);
  const [showEditScenario, setShowEditScenario] = useState<Scenario | null>(null);
  const [showNewOntology, setShowNewOntology] = useState(false);
  const [showEditOntology, setShowEditOntology] = useState<Ontology | null>(null);
  const [showDeleteOntology, setShowDeleteOntology] = useState<Ontology | null>(null);

  // Form fields
  const [newScName, setNewScName] = useState('');
  const [newScDesc, setNewScDesc] = useState('');
  const [editScName, setEditScName] = useState('');
  const [editScDesc, setEditScDesc] = useState('');
  const [newOnName, setNewOnName] = useState('');
  const [newOnDesc, setNewOnDesc] = useState('');
  const [newOnCreator, setNewOnCreator] = useState('');
  const [editOnName, setEditOnName] = useState('');
  const [editOnDesc, setEditOnDesc] = useState('');
  const [editOnCreator, setEditOnCreator] = useState('');
  const [deleteConfirmText, setDeleteConfirmText] = useState('');

  const loadScenarios = async () => {
    try {
      const list = await getScenarios();
      setScenarios(list);
      if (list.length > 0 && !selectedScenarioId) {
        setSelectedScenarioId(list[0].id);
      }
    } catch (e: any) {
      message.error('加载业务场景失败: ' + e.message);
    }
  };

  const loadOntologies = async () => {
    if (!selectedScenarioId) return;
    try {
      const list = await getOntologies(selectedScenarioId);
      setOntologies(list);
      const dataList = await Promise.allSettled(list.map(o => getOntologyData(o.id)));
      const counts: Record<number, {concepts:number; relations:number; behaviors:number; rules:number}> = {};
      list.forEach((o, i) => {
        const r = dataList[i];
        if (r.status === 'fulfilled') {
          const d = r.value;
          counts[o.id] = {
            concepts: d.concepts?.length || 0,
            relations: d.relations?.length || 0,
            behaviors: d.behaviors?.length || 0,
            rules: d.rules?.length || 0,
          };
        } else {
          counts[o.id] = { concepts: 0, relations: 0, behaviors: 0, rules: 0 };
        }
      });
      setOntoCounts(counts);
    } catch (e: any) {
      message.error('加载本体列表失败: ' + e.message);
    }
  };

  useEffect(() => { loadScenarios(); }, []);
  useEffect(() => { loadOntologies(); }, [selectedScenarioId]);

  const selectedScenario = scenarios.find(s => s.id === selectedScenarioId);

  // ── New Scenario ──
  const handleCreateScenario = async () => {
    if (!newScName.trim()) { message.warning('请输入业务场景名称'); return; }
    try {
      await createScenario({ name: newScName.trim(), description: newScDesc.trim() });
      message.success('业务场景创建成功');
      setShowNewScenario(false);
      setNewScName('');
      setNewScDesc('');
      await loadScenarios();
    } catch (e: any) {
      message.error(e.message);
    }
  };

  // ── Delete Scenario ──

  // ── Edit Scenario ──
  const handleEditScenario = async () => {
    if (!showEditScenario) return;
    if (!editScName.trim()) { message.warning('请输入业务场景名称'); return; }
    try {
      await updateScenario(showEditScenario.id, { name: editScName.trim(), description: editScDesc.trim() });
      message.success('业务场景已更新');
      setShowEditScenario(null);
      await loadScenarios();
    } catch (e: any) {
      message.error(e.message);
    }
  };

  // ── Edit Ontology ──
  const handleEditOntology = async () => {
    if (!showEditOntology) return;
    if (!editOnName.trim()) { message.warning('请输入本体名称'); return; }
    try {
      await updateOntology(showEditOntology.id, { name: editOnName.trim(), description: editOnDesc.trim(), creator: editOnCreator.trim() });
      message.success('本体已更新');
      setShowEditOntology(null);
      await loadOntologies();
    } catch (e: any) {
      message.error(e.message);
    }
  };

  // ── New Ontology ──
  const handleCreateOntology = async () => {
    if (!newOnName.trim()) { message.warning('请输入本体名称'); return; }
    if (!selectedScenarioId) { message.warning('请先选择业务场景'); return; }
    try {
      const onto = await createOntology({
        scenario_id: selectedScenarioId,
        name: newOnName.trim(),
        description: newOnDesc.trim(),
        creator: newOnCreator.trim(),
      });
      message.success('本体创建成功');
      setShowNewOntology(false);
      setNewOnName('');
      setNewOnDesc('');
      setNewOnCreator('');
      await loadOntologies();
      // Navigate to design page
      window.open(`/design/${onto.id}`, `design_${onto.id}`);
    } catch (e: any) {
      message.error(e.message);
    }
  };

  // ── Delete Ontology ──
  const handleDeleteOntology = async () => {
    if (!showDeleteOntology) return;
    if (deleteConfirmText !== showDeleteOntology.name) {
      message.warning('输入的本体名称不匹配');
      return;
    }
    try {
      await deleteOntology(showDeleteOntology.id);
      message.success('本体已删除');
      setShowDeleteOntology(null);
      setDeleteConfirmText('');
      await loadOntologies();
    } catch (e: any) {
      message.error(e.message);
    }
  };

  return (
    <div className="flex h-screen overflow-hidden">
      {/* ── Left Sidebar ── */}
      <aside className="w-64 bg-dark-card border-r border-dark-border flex flex-col shrink-0">
        {/* Header */}
        <div className="p-4 border-b border-dark-border">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider">业务场景</h2>
            <Button
              type="primary"
              size="small"
              icon={<PlusOutlined />}
              onClick={() => setShowNewScenario(true)}
            />
          </div>
        </div>

        {/* Scenario list */}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {scenarios.map(sc => (
            <div
              key={sc.id}
              className={`group flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                selectedScenarioId === sc.id
                  ? 'bg-accent-blue/10 text-accent-blue border border-accent-blue/30'
                  : 'text-text-secondary hover:bg-dark-hover hover:text-text-primary border border-transparent'
              }`}
              onClick={() => setSelectedScenarioId(sc.id)}
            >
              <div className="flex items-center gap-2 min-w-0">
                <FolderOutlined className="shrink-0" />
                <span className="truncate text-sm">{sc.name}</span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <EditOutlined
                  className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-accent-blue transition-all text-xs"
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditScName(sc.name);
                    setEditScDesc(sc.description);
                    setShowEditScenario(sc);
                  }}
                />
              </div>
            </div>
          ))}
          {scenarios.length === 0 && (
            <p className="text-text-muted text-xs text-center py-4">暂无业务场景，点击 + 新建</p>
          )}
        </div>
      </aside>

      {/* ── Main Content ── */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="h-14 border-b border-dark-border flex items-center justify-center shrink-0">
          <h1 className="text-xl font-bold tracking-widest text-text-primary">
            <span className="text-accent-blue">OPTONTO</span>
            <span className="text-text-muted ml-2">本体市场</span>
          </h1>
        </header>

        {/* Content area */}
        <div className="flex-1 overflow-y-auto p-6">
          {selectedScenario ? (
            <>
              {/* Scenario header */}
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-lg font-semibold text-text-primary">{selectedScenario.name}</h2>
                  {selectedScenario.description && (
                    <p className="text-text-muted text-sm mt-1">{selectedScenario.description}</p>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button
                    type="primary"
                    icon={<PlusOutlined />}
                    onClick={() => { setNewOnName(''); setNewOnDesc(''); setNewOnCreator(''); setShowNewOntology(true); }}
                  >
                    新建本体
                  </Button>
                </div>
              </div>

              {/* Ontology card list */}
              {ontologies.length === 0 ? (
                <Empty
                  description={<span className="text-text-muted">该业务场景下暂无本体</span>}
                  className="mt-20"
                />
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                  {ontologies.map(onto => (
                    <div
                      key={onto.id}
                      className="group bg-dark-card border border-dark-border rounded-xl p-5 hover:border-accent-blue/40 hover:bg-dark-hover transition-all cursor-pointer relative"
                      onClick={() => window.open(`/design/${onto.id}`, `design_${onto.id}`)}
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <h3 className="text-base font-medium text-text-primary truncate">{onto.name}</h3>
                          <DeployedVersionBadge ontologyId={onto.id} deployedVersion={onto.deployed_version || ''} compact />
                        </div>
                        <div className="flex gap-2 shrink-0">
                          <EditOutlined
                            className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-accent-blue transition-all"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditOnName(onto.name);
                              setEditOnDesc(onto.description);
                              setEditOnCreator(onto.creator);
                              setShowEditOntology(onto);
                            }}
                          />
                          <DeleteOutlined
                            className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-red-400 transition-all"
                            onClick={(e) => {
                              e.stopPropagation();
                              setShowDeleteOntology(onto);
                              setDeleteConfirmText('');
                            }}
                          />
                        </div>
                      </div>
                      <p className="text-text-muted text-sm mb-4 line-clamp-2 min-h-[2.5rem]">
                        {onto.description || '暂无描述'}
                      </p>
                      {onto.creator && (
                        <p className="text-text-muted text-xs mb-3">创建人: {onto.creator}</p>
                      )}
                      <div className="flex flex-nowrap gap-1 text-xs">
                        <span className="px-1.5 py-0.5 rounded bg-accent-blue/10 text-accent-blue whitespace-nowrap">
                          Concept:{ontoCounts[onto.id]?.concepts ?? 0}
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-accent-purple/10 text-accent-purple whitespace-nowrap">
                          Relation:{ontoCounts[onto.id]?.relations ?? 0}
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 whitespace-nowrap">
                          Rule:{ontoCounts[onto.id]?.rules ?? 0}
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-accent-green/10 text-accent-green whitespace-nowrap">
                          Action:{ontoCounts[onto.id]?.behaviors ?? 0}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="flex items-center justify-center h-full">
              <Empty
                description={<span className="text-text-muted">请从左侧选择一个业务场景</span>}
              />
            </div>
          )}
        </div>
      </main>

      <HomeDialogs
        newScenario={{
          open: showNewScenario, name: newScName, desc: newScDesc,
          setName: setNewScName, setDesc: setNewScDesc,
          close: () => setShowNewScenario(false), submit: handleCreateScenario,
        }}
        newOntology={{
          open: showNewOntology, name: newOnName, desc: newOnDesc, creator: newOnCreator,
          setName: setNewOnName, setDesc: setNewOnDesc, setCreator: setNewOnCreator,
          close: () => setShowNewOntology(false), submit: handleCreateOntology,
        }}
        editScenario={{
          open: !!showEditScenario, name: editScName, desc: editScDesc,
          setName: setEditScName, setDesc: setEditScDesc,
          close: () => setShowEditScenario(null), submit: handleEditScenario,
        }}
        editOntology={{
          open: !!showEditOntology, name: editOnName, desc: editOnDesc, creator: editOnCreator,
          setName: setEditOnName, setDesc: setEditOnDesc, setCreator: setEditOnCreator,
          close: () => setShowEditOntology(null), submit: handleEditOntology,
        }}
        deleteOntology={{
          open: !!showDeleteOntology, name: showDeleteOntology?.name || '', confirmText: deleteConfirmText,
          setConfirmText: setDeleteConfirmText,
          close: () => { setShowDeleteOntology(null); setDeleteConfirmText(''); }, submit: handleDeleteOntology,
        }}
      />
    </div>
  );
}
