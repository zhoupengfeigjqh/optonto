'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { message, Spin } from 'antd';
import {
  DatabaseOutlined,
  NodeIndexOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  ArrowLeftOutlined,
  CompassOutlined,
  UnorderedListOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons';
import { getOntology, Ontology } from '@/api/client';
import ConceptTable from '@/components/Design/ConceptTable';
import RelationTable from '@/components/Design/RelationTable';
import BehaviorTable from '@/components/Design/BehaviorTable';
import RuleTable from '@/components/Design/RuleTable';
import EventTable from '@/components/Design/EventTable';
import FileViewer from '@/components/Design/FileViewer';
import ConversationManager from '@/components/Design/ConversationManager';
import RequirementConfirm from '@/components/Design/RequirementConfirm';
import OntologyGraph from '@/components/View/OntologyGraph';

const DESIGN_TABS = [
  { key: 'concepts', label: '概念' },
  { key: 'relations', label: '关系' },
  { key: 'behaviors', label: '行为' },
  { key: 'rules', label: '规则' },
  { key: 'events', label: '事件' },
{ key: 'files', label: '文件浏览' },
];

export default function DesignPage() {
  const params = useParams();
  const router = useRouter();
  const ontologyId = Number(params.id);

  const [ontology, setOntology] = useState<Ontology | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState<'design' | 'view' | 'requirements'>('design');
  const [activeTab, setActiveTab] = useState('concepts');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [threadParam, setThreadParam] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const onto = await getOntology(ontologyId);
        setOntology(onto);
        document.title = `${onto.name} - OPTONTO`;
        setLoading(false);
      } catch (e: any) {
        message.error('加载本体失败: ' + e.message);
        setLoading(false);
      }
    })();
    // Check for ?thread=xxx query param to switch to requirements tab
    const params = new URLSearchParams(window.location.search);
    const tid = params.get('thread');
    if (tid) {
      setThreadParam(tid);
      setActiveSection('requirements');
      setActiveTab('requirements');
    }
  }, [ontologyId]);

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-dark-bg">
        <Spin size="large" />
      </div>
    );
  }

  if (!ontology) {
    return (
      <div className="h-screen flex items-center justify-center bg-dark-bg">
        <p className="text-text-muted">本体不存在</p>
      </div>
    );
  }

  const renderContent = () => {
    if (activeSection === 'view') {
      return <OntologyGraph ontologyId={ontologyId} />;
    }
    if (activeSection === 'requirements') {
      return (
        <div>
          <div style={{ display: activeTab === 'requirements' ? '' : 'none' }}><ConversationManager ontologyId={ontologyId} activeTab={activeTab} initialThreadId={threadParam} scenarioName={ontology?.scenario_name} ontologyName={ontology?.name} /></div>
          <div style={{ display: activeTab === 'requirement-confirm' ? '' : 'none' }}><RequirementConfirm ontologyId={ontologyId} activeTab={activeTab} /></div>
        </div>
      );
    }

    return (
      <div>
        <div style={{ display: activeTab === 'concepts' ? '' : 'none' }}><ConceptTable ontologyId={ontologyId} activeTab={activeTab} /></div>
        <div style={{ display: activeTab === 'relations' ? '' : 'none' }}><RelationTable ontologyId={ontologyId} activeTab={activeTab} /></div>
        <div style={{ display: activeTab === 'behaviors' ? '' : 'none' }}><BehaviorTable ontologyId={ontologyId} activeTab={activeTab} /></div>
        <div style={{ display: activeTab === 'rules' ? '' : 'none' }}><RuleTable ontologyId={ontologyId} activeTab={activeTab} /></div>
        <div style={{ display: activeTab === 'events' ? '' : 'none' }}><EventTable ontologyId={ontologyId} activeTab={activeTab} /></div>
        <div style={{ display: activeTab === 'files' ? '' : 'none' }}><FileViewer ontologyId={ontologyId} activeTab={activeTab} /></div>
      </div>
    );
  };

  return (
    <div className="flex h-screen overflow-hidden bg-dark-bg">
      {/* ── Left Sidebar ── */}
      <aside className={`${sidebarCollapsed ? 'w-12' : 'w-56'} bg-dark-card border-r border-dark-border flex flex-col shrink-0 transition-all duration-200`}>
        {/* Toggle button */}
        <div className="flex items-center justify-between p-3 border-b border-dark-border">
          {!sidebarCollapsed && (
            <h2 className="text-sm font-semibold text-text-primary truncate">{ontology.name}</h2>
          )}
          <button
            className="text-text-muted hover:text-text-primary transition-colors mx-auto"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          >
            {sidebarCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
          </button>
        </div>

        {/* Main nav */}
        <nav className="flex-1 overflow-y-auto p-2 space-y-1">
          {/* 业务分析 */}
          <div>
            <button
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${sidebarCollapsed ? 'justify-center' : 'justify-start'} ${
                activeSection === 'requirements'
                  ? 'bg-accent-blue/10 text-accent-blue border border-accent-blue/30'
                  : 'text-text-secondary hover:bg-dark-hover hover:text-text-primary border border-transparent'
              }`}
              onClick={() => setActiveSection('requirements')}
              title="业务分析"
            >
              <CompassOutlined />
              {!sidebarCollapsed && <span>业务分析</span>}
            </button>

            {!sidebarCollapsed && activeSection === 'requirements' && (
              <div className="ml-4 mt-1 space-y-0.5">
                <button
                  className={`w-full text-left px-3 py-1.5 rounded-lg text-sm transition-colors flex items-center gap-2 ${
                    activeTab === 'requirements'
                      ? 'text-accent-blue bg-accent-blue/5'
                      : 'text-text-muted hover:text-text-secondary'
                  }`}
                  onClick={() => { setActiveTab('requirements'); }}
                >
                  <UnorderedListOutlined style={{ fontSize: 12 }} />
                  <span>对话管理</span>
                </button>
                <button
                  className={`w-full text-left px-3 py-1.5 rounded-lg text-sm transition-colors flex items-center gap-2 ${
                    activeTab === 'requirement-confirm'
                      ? 'text-accent-blue bg-accent-blue/5'
                      : 'text-text-muted hover:text-text-secondary'
                  }`}
                  onClick={() => { setActiveTab('requirement-confirm'); }}
                >
                  <CheckCircleOutlined style={{ fontSize: 12 }} />
                  <span>需求确认</span>
                </button>
              </div>
            )}
          </div>

          {/* 本体明细 */}
          <div>
            <button
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${sidebarCollapsed ? 'justify-center' : 'justify-start'} ${
                activeSection === 'design'
                  ? 'bg-accent-blue/10 text-accent-blue border border-accent-blue/30'
                  : 'text-text-secondary hover:bg-dark-hover hover:text-text-primary border border-transparent'
              }`}
              onClick={() => setActiveSection('design')}
              title="本体明细"
            >
              <DatabaseOutlined />
              {!sidebarCollapsed && <span>本体明细</span>}
            </button>

            {/* Sub-items */}
            {!sidebarCollapsed && activeSection === 'design' && (
              <div className="ml-4 mt-1 space-y-0.5">
                {DESIGN_TABS.map(tab => (
                  <button
                    key={tab.key}
                    className={`w-full text-left px-3 py-1.5 rounded-lg text-sm transition-colors ${
                      activeTab === tab.key
                        ? 'text-accent-blue bg-accent-blue/5'
                        : 'text-text-muted hover:text-text-secondary'
                    }`}
                    onClick={() => setActiveTab(tab.key)}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 本体视图 */}
          <button
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${sidebarCollapsed ? 'justify-center' : 'justify-start'} ${
              activeSection === 'view'
                ? 'bg-accent-blue/10 text-accent-blue border border-accent-blue/30'
                : 'text-text-secondary hover:bg-dark-hover hover:text-text-primary border border-transparent'
            }`}
            onClick={() => setActiveSection('view')}
            title="本体视图"
          >
            <NodeIndexOutlined />
            {!sidebarCollapsed && <span>本体视图</span>}
          </button>
        </nav>
      </aside>

      {/* ── Main Content ── */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="h-12 border-b border-dark-border flex items-center justify-between px-6 shrink-0 bg-dark-card">
          <span className="text-text-muted text-sm">
            {ontology.name}
            <span className="mx-2">/</span>
            {activeSection === 'design'
              ? DESIGN_TABS.find(t => t.key === activeTab)?.label
              : activeSection === 'requirements'
              ? activeTab === 'requirements' ? '对话管理' : '需求确认'
              : '本体视图'}
          </span>
          <button
            className="flex items-center gap-1 text-text-muted hover:text-accent-blue transition-colors text-sm"
            onClick={() => router.push('/')}
            title="返回本体市场"
          >
            <ArrowLeftOutlined />
            <span>返回本体市场</span>
          </button>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          {renderContent()}
        </div>
      </main>
    </div>
  );
}
