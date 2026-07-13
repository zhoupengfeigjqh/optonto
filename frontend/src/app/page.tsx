'use client';

import { useEffect, useState } from 'react';
import { PlusOutlined, DeleteOutlined, FolderOutlined, EditOutlined } from '@ant-design/icons';
import { Modal, Input, message, Button, Empty } from 'antd';
import {
  getScenarios, createScenario, updateScenario, deleteScenario,
  getOntologies, createOntology, updateOntology, deleteOntology,
  getOntologyData,
  Scenario, Ontology, OntologyData,
} from '@/api/client';

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
  const [showDeleteScenario, setShowDeleteScenario] = useState(false);
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
      message.error('加载场景失败: ' + e.message);
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
    if (!newScName.trim()) { message.warning('请输入场景名称'); return; }
    try {
      await createScenario({ name: newScName.trim(), description: newScDesc.trim() });
      message.success('场景创建成功');
      setShowNewScenario(false);
      setNewScName('');
      setNewScDesc('');
      await loadScenarios();
    } catch (e: any) {
      message.error(e.message);
    }
  };

  // ── Delete Scenario ──
  const handleDeleteScenario = async () => {
    if (!selectedScenarioId) return;
    if (deleteConfirmText !== selectedScenario?.name) {
      message.warning('输入的场景名称不匹配');
      return;
    }
    try {
      await deleteScenario(selectedScenarioId);
      message.success('场景已删除');
      setShowDeleteScenario(false);
      setDeleteConfirmText('');
      setSelectedScenarioId(null);
      await loadScenarios();
    } catch (e: any) {
      message.error(e.message);
    }
  };

  // ── Edit Scenario ──
  const handleEditScenario = async () => {
    if (!showEditScenario) return;
    if (!editScName.trim()) { message.warning('请输入场景名称'); return; }
    try {
      await updateScenario(showEditScenario.id, { name: editScName.trim(), description: editScDesc.trim() });
      message.success('场景已更新');
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
    if (!selectedScenarioId) { message.warning('请先选择场景'); return; }
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
            <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider">场景</h2>
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
                <DeleteOutlined
                  className="opacity-0 group-hover:opacity-100 text-text-muted hover:text-red-400 transition-all text-xs"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedScenarioId(sc.id);
                    setDeleteConfirmText('');
                    setShowDeleteScenario(true);
                  }}
                />
              </div>
            </div>
          ))}
          {scenarios.length === 0 && (
            <p className="text-text-muted text-xs text-center py-4">暂无场景，点击 + 新建</p>
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
                  <Button
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => { setDeleteConfirmText(''); setShowDeleteScenario(true); }}
                  >
                    删除场景
                  </Button>
                </div>
              </div>

              {/* Ontology card list */}
              {ontologies.length === 0 ? (
                <Empty
                  description={<span className="text-text-muted">该场景下暂无本体</span>}
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
                        <h3 className="text-base font-medium text-text-primary truncate">{onto.name}</h3>
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
                description={<span className="text-text-muted">请从左侧选择一个场景</span>}
              />
            </div>
          )}
        </div>
      </main>

      {/* ─── Dialogs ─── */}

      {/* New Scenario */}
      <Modal
        title="新建场景"
        open={showNewScenario}
        onOk={handleCreateScenario}
        onCancel={() => setShowNewScenario(false)}
        okText="创建"
        cancelText="取消"
      >
        <div className="space-y-3 pt-2">
          <div>
            <label className="text-text-secondary text-sm block mb-1">场景名称 *</label>
            <Input
              placeholder="请输入场景名称"
              value={newScName}
              onChange={e => setNewScName(e.target.value)}
              className="bg-dark-bg border-dark-border text-text-primary"
            />
          </div>
          <div>
            <label className="text-text-secondary text-sm block mb-1">场景描述</label>
            <Input.TextArea
              placeholder="请输入场景描述（可选）"
              value={newScDesc}
              onChange={e => setNewScDesc(e.target.value)}
              rows={3}
              className="bg-dark-bg border-dark-border text-text-primary"
            />
          </div>
        </div>
      </Modal>

      {/* New Ontology */}
      <Modal
        title="新建本体"
        open={showNewOntology}
        onOk={handleCreateOntology}
        onCancel={() => setShowNewOntology(false)}
        okText="创建并设计"
        cancelText="取消"
      >
        <div className="space-y-3 pt-2">
          <div>
            <label className="text-text-secondary text-sm block mb-1">本体名称 *</label>
            <Input
              placeholder="请输入本体名称"
              value={newOnName}
              onChange={e => setNewOnName(e.target.value)}
              className="bg-dark-bg border-dark-border text-text-primary"
            />
          </div>
          <div>
            <label className="text-text-secondary text-sm block mb-1">本体描述</label>
            <Input.TextArea
              placeholder="请输入本体描述（可选）"
              value={newOnDesc}
              onChange={e => setNewOnDesc(e.target.value)}
              rows={3}
              className="bg-dark-bg border-dark-border text-text-primary"
            />
          </div>
          <div>
            <label className="text-text-secondary text-sm block mb-1">创建人</label>
            <Input
              placeholder="请输入创建人（可选）"
              value={newOnCreator}
              onChange={e => setNewOnCreator(e.target.value)}
              className="bg-dark-bg border-dark-border text-text-primary"
            />
          </div>
        </div>
      </Modal>

      {/* Edit Scenario */}
      <Modal
        title="编辑场景"
        open={!!showEditScenario}
        onOk={handleEditScenario}
        onCancel={() => setShowEditScenario(null)}
        okText="保存"
        cancelText="取消"
      >
        <div className="space-y-3 pt-2">
          <div>
            <label className="text-text-secondary text-sm block mb-1">场景名称 *</label>
            <Input
              placeholder="请输入场景名称"
              value={editScName}
              onChange={e => setEditScName(e.target.value)}
              className="bg-dark-bg border-dark-border text-text-primary"
            />
          </div>
          <div>
            <label className="text-text-secondary text-sm block mb-1">场景描述</label>
            <Input.TextArea
              placeholder="请输入场景描述"
              value={editScDesc}
              onChange={e => setEditScDesc(e.target.value)}
              rows={3}
              className="bg-dark-bg border-dark-border text-text-primary"
            />
          </div>
        </div>
      </Modal>

      {/* Edit Ontology */}
      <Modal
        title="编辑本体"
        open={!!showEditOntology}
        onOk={handleEditOntology}
        onCancel={() => setShowEditOntology(null)}
        okText="保存"
        cancelText="取消"
      >
        <div className="space-y-3 pt-2">
          <div>
            <label className="text-text-secondary text-sm block mb-1">本体名称 *</label>
            <Input
              placeholder="请输入本体名称"
              value={editOnName}
              onChange={e => setEditOnName(e.target.value)}
              className="bg-dark-bg border-dark-border text-text-primary"
            />
          </div>
          <div>
            <label className="text-text-secondary text-sm block mb-1">本体描述</label>
            <Input.TextArea
              placeholder="请输入本体描述"
              value={editOnDesc}
              onChange={e => setEditOnDesc(e.target.value)}
              rows={3}
              className="bg-dark-bg border-dark-border text-text-primary"
            />
          </div>
          <div>
            <label className="text-text-secondary text-sm block mb-1">创建人</label>
            <Input
              placeholder="请输入创建人"
              value={editOnCreator}
              onChange={e => setEditOnCreator(e.target.value)}
              className="bg-dark-bg border-dark-border text-text-primary"
            />
          </div>
        </div>
      </Modal>

      {/* Confirm Delete Scenario */}
      <Modal
        title="确认删除场景"
        open={showDeleteScenario}
        onOk={handleDeleteScenario}
        onCancel={() => { setShowDeleteScenario(false); setDeleteConfirmText(''); }}
        okText="确认删除"
        cancelText="取消"
        okButtonProps={{ danger: true }}
      >
        <div className="space-y-3 pt-2">
          <p className="text-text-secondary text-sm">
            删除场景 <strong className="text-red-400">{selectedScenario?.name}</strong> 将同时删除该场景下所有本体，
            且该场景下的本体必须为空才能删除。请输入场景名称以确认：
          </p>
          <Input
            placeholder={`请输入 "${selectedScenario?.name || ''}" 确认删除`}
            value={deleteConfirmText}
            onChange={e => setDeleteConfirmText(e.target.value)}
            className="bg-dark-bg border-dark-border text-text-primary"
          />
        </div>
      </Modal>

      {/* Confirm Delete Ontology */}
      <Modal
        title="确认删除本体"
        open={!!showDeleteOntology}
        onOk={handleDeleteOntology}
        onCancel={() => { setShowDeleteOntology(null); setDeleteConfirmText(''); }}
        okText="确认删除"
        cancelText="取消"
        okButtonProps={{ danger: true }}
      >
        <div className="space-y-3 pt-2">
          <p className="text-text-secondary text-sm">
            删除本体 <strong className="text-red-400">{showDeleteOntology?.name}</strong> 将同时删除其所有数据，
            此操作不可撤回。请输入本体名称以确认：
          </p>
          <Input
            placeholder={`请输入 "${showDeleteOntology?.name || ''}" 确认删除`}
            value={deleteConfirmText}
            onChange={e => setDeleteConfirmText(e.target.value)}
            className="bg-dark-bg border-dark-border text-text-primary"
          />
        </div>
      </Modal>
    </div>
  );
}
