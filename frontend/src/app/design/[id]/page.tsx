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
  ApiOutlined,
  RobotOutlined,
} from '@ant-design/icons';
import { getOntology, Ontology } from '@/api/client';
import ConceptTable from '@/components/Design/ConceptTable';
import RelationTable from '@/components/Design/RelationTable';
import FunctionTable from '@/components/Design/FunctionTable';
import BehaviorTable from '@/components/Design/BehaviorTable';
import RuleTable from '@/components/Design/RuleTable';
import EventTable from '@/components/Design/EventTable';
import ProcessTable from '@/components/Design/ProcessTable';
import SecurityTable from '@/components/Design/SecurityTable';
import FileViewer from '@/components/Design/FileViewer';
import ConversationManager from '@/components/Design/ConversationManager';
import RequirementConfirm from '@/components/Design/RequirementConfirm';
import OntologyGraph from '@/components/View/OntologyGraph';
import DataEngineTable from '@/components/Design/DataEngineTable';
import DBMappingTable from '@/components/Design/DBMappingTable';
import MCPService from '@/components/Design/MCPService';
import SkillManagement from '@/components/Design/SkillManagement';

const DESIGN_TABS = [
  { key: 'concepts', label: '概念' },
  { key: 'relations', label: '关系' },
  { key: 'functions', label: '函数' },
  { key: 'behaviors', label: '行为' },
  { key: 'rules', label: '规则' },
  { key: 'processes', label: '流程' },
  { key: 'events', label: '事件' },
  { key: 'securities', label: '安全' },
];

export default function DesignPage() {
  const params = useParams();
  const router = useRouter();
  const ontologyId = Number(params.id);

  const [ontology, setOntology] = useState<Ontology | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState<'design' | 'view' | 'requirements' | 'data-engine' | 'agent'>('design');
  const [activeTab, setActiveTab] = useState('concepts');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [expandedSection, setExpandedSection] = useState<string | null>('design');
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
      setExpandedSection('requirements');
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

  const renderContent = () => (
    <div className="h-full">
      {/* ── 本体展示：轻量，保留 display:none ── */}
      <div style={{ display: activeSection === 'view' && activeTab === 'view' ? '' : 'none' }} className="h-full"><OntologyGraph ontologyId={ontologyId} /></div>
      <div style={{ display: activeSection === 'view' && activeTab === 'instance' ? '' : 'none' }}>
        <div className="flex items-center justify-center h-48 text-text-muted"><p>实例视图 — 开发中</p></div>
      </div>

      {/* ── 本体构建（需求）：条件渲染，避免常驻内存 ── */}
      {activeSection === 'requirements' && activeTab === 'requirements' && (
        <ConversationManager activeTab={activeTab} initialThreadId={threadParam} scenarioName={ontology?.scenario_name} ontologyName={ontology?.name} />
      )}
      {activeSection === 'requirements' && activeTab === 'requirement-confirm' && (
        <RequirementConfirm ontologyId={ontologyId} activeTab={activeTab} scenarioName={ontology?.scenario_name || ''} ontologyName={ontology?.name || ''} />
      )}
      {activeSection === 'requirements' && activeTab === 'files' && (
        <FileViewer ontologyId={ontologyId} activeTab={activeTab} />
      )}

      {/* ── 本体明细（设计）：display:none，保留编辑状态 ── */}
      <div style={{ display: activeSection === 'design' && activeTab === 'concepts' ? '' : 'none' }}><ConceptTable ontologyId={ontologyId} activeTab={activeTab} /></div>
      <div style={{ display: activeSection === 'design' && activeTab === 'relations' ? '' : 'none' }}><RelationTable ontologyId={ontologyId} activeTab={activeTab} /></div>
      <div style={{ display: activeSection === 'design' && activeTab === 'functions' ? '' : 'none' }}><FunctionTable ontologyId={ontologyId} activeTab={activeTab} /></div>
      <div style={{ display: activeSection === 'design' && activeTab === 'behaviors' ? '' : 'none' }}><BehaviorTable ontologyId={ontologyId} activeTab={activeTab} /></div>
      <div style={{ display: activeSection === 'design' && activeTab === 'rules' ? '' : 'none' }}><RuleTable ontologyId={ontologyId} activeTab={activeTab} /></div>
      <div style={{ display: activeSection === 'design' && activeTab === 'processes' ? '' : 'none' }}><ProcessTable ontologyId={ontologyId} activeTab={activeTab} /></div>
      <div style={{ display: activeSection === 'design' && activeTab === 'events' ? '' : 'none' }}><EventTable ontologyId={ontologyId} activeTab={activeTab} /></div>
      <div style={{ display: activeSection === 'design' && activeTab === 'securities' ? '' : 'none' }}><SecurityTable ontologyId={ontologyId} activeTab={activeTab} /></div>

      {/* ── 数据引擎 & 智能体：条件渲染 ── */}
      {activeSection === 'data-engine' && activeTab === 'data-engines' && (
        <DataEngineTable ontologyId={ontologyId} activeTab={activeTab} />
      )}
      {activeSection === 'data-engine' && activeTab === 'instance-collection' && (
        <div className="flex items-center justify-center h-48 text-text-muted"><p>实例集合 — 开发中</p></div>
      )}
      {activeSection === 'data-engine' && activeTab === 'db-mapping' && (
        <DBMappingTable ontologyId={ontologyId} activeTab={activeTab} />
      )}
      {activeSection === 'data-engine' && activeTab === 'mcp-service' && (
        <MCPService />
      )}
      {activeSection === 'agent' && activeTab === 'skill-management' && (
        <SkillManagement ontologyId={ontologyId} activeTab={activeTab} />
      )}
      {activeSection === 'agent' && activeTab === 'agent-app' && (
        <div className="flex items-center justify-center h-48 text-text-muted"><p>智能体应用 — 开发中</p></div>
      )}
    </div>
  );

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
          {/* 本体构建 */}
          <div>
            <button
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${sidebarCollapsed ? 'justify-center' : 'justify-start'} ${
                expandedSection === 'requirements'
                  ? 'bg-accent-blue/10 text-accent-blue border border-accent-blue/30'
                  : 'text-text-secondary hover:bg-dark-hover hover:text-text-primary border border-transparent'
              }`}
              onClick={() => {
                  setExpandedSection(expandedSection === 'requirements' ? null : 'requirements');
                }}
              title="本体构建"
            >
              <CompassOutlined />
              {!sidebarCollapsed && <span>本体构建</span>}
            </button>

            {!sidebarCollapsed && expandedSection === 'requirements' && (
              <div className="ml-4 mt-1 space-y-0.5">
                <button
                  className={`w-full text-left px-3 py-1.5 rounded-lg text-sm transition-colors flex items-center gap-2 ${
                    activeTab === 'requirements'
                      ? 'text-accent-blue bg-accent-blue/5'
                      : 'text-text-muted hover:text-text-secondary'
                  }`}
                  onClick={() => { setActiveSection('requirements'); setActiveTab('requirements'); setThreadParam(null); }}
                >
                  <span>需求对话</span>
                </button>
                <button
                  className={`w-full text-left px-3 py-1.5 rounded-lg text-sm transition-colors flex items-center gap-2 ${
                    activeTab === 'requirement-confirm'
                      ? 'text-accent-blue bg-accent-blue/5'
                      : 'text-text-muted hover:text-text-secondary'
                  }`}
                  onClick={() => { setActiveSection('requirements'); setActiveTab('requirement-confirm'); }}
                >
                  <span>本体输出</span>
                </button>
                <button
                  className={`w-full text-left px-3 py-1.5 rounded-lg text-sm transition-colors flex items-center gap-2 ${
                    activeTab === 'files'
                      ? 'text-accent-blue bg-accent-blue/5'
                      : 'text-text-muted hover:text-text-secondary'
                  }`}
                  onClick={() => { setActiveSection('requirements'); setActiveTab('files'); }}
                >
                  <span>本体文件</span>
                </button>
              </div>
            )}
          </div>

          {/* 本体明细 */}
          <div>
            <button
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${sidebarCollapsed ? 'justify-center' : 'justify-start'} ${
                expandedSection === 'design'
                  ? 'bg-accent-blue/10 text-accent-blue border border-accent-blue/30'
                  : 'text-text-secondary hover:bg-dark-hover hover:text-text-primary border border-transparent'
              }`}
              onClick={() => {
                  setExpandedSection(expandedSection === 'design' ? null : 'design');
                }}
              title="本体明细"
            >
              <DatabaseOutlined />
              {!sidebarCollapsed && <span>本体明细</span>}
            </button>

            {/* Sub-items */}
            {!sidebarCollapsed && expandedSection === 'design' && (
              <div className="ml-4 mt-1 space-y-0.5">
                {DESIGN_TABS.map(tab => (
                  <button
                    key={tab.key}
                    className={`w-full text-left px-3 py-1.5 rounded-lg text-sm transition-colors ${
                      activeTab === tab.key
                        ? 'text-accent-blue bg-accent-blue/5'
                        : 'text-text-muted hover:text-text-secondary'
                    }`}
                    onClick={() => { setActiveSection('design'); setActiveTab(tab.key); }}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 本体展示 */}
          <div>
            <button
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${sidebarCollapsed ? 'justify-center' : 'justify-start'} ${
                expandedSection === 'view'
                  ? 'bg-accent-blue/10 text-accent-blue border border-accent-blue/30'
                  : 'text-text-secondary hover:bg-dark-hover hover:text-text-primary border border-transparent'
              }`}
              onClick={() => {
                  setExpandedSection(expandedSection === 'view' ? null : 'view');
                }}
              title="本体展示"
            >
              <NodeIndexOutlined />
              {!sidebarCollapsed && <span>本体展示</span>}
            </button>

            {!sidebarCollapsed && expandedSection === 'view' && (
              <div className="ml-4 mt-1 space-y-0.5">
                <button
                  className={`w-full text-left px-3 py-1.5 rounded-lg text-sm transition-colors ${
                    activeTab === 'view'
                      ? 'text-accent-blue bg-accent-blue/5'
                      : 'text-text-muted hover:text-text-secondary'
                  }`}
                  onClick={() => { setActiveSection('view'); setActiveTab('view'); }}
                >
                  本体视图
                </button>
                <button
                  className={`w-full text-left px-3 py-1.5 rounded-lg text-sm transition-colors ${
                    activeTab === 'instance'
                      ? 'text-accent-blue bg-accent-blue/5'
                      : 'text-text-muted hover:text-text-secondary'
                  }`}
                  onClick={() => { setActiveSection('view'); setActiveTab('instance'); }}
                >
                  实例视图
                </button>
              </div>
            )}
          </div>

          {/* 数据引擎 */}
          <div>
            <button
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${sidebarCollapsed ? 'justify-center' : 'justify-start'} ${
                expandedSection === 'data-engine'
                  ? 'bg-accent-blue/10 text-accent-blue border border-accent-blue/30'
                  : 'text-text-secondary hover:bg-dark-hover hover:text-text-primary border border-transparent'
              }`}
              onClick={() => {
                  setExpandedSection(expandedSection === 'data-engine' ? null : 'data-engine');
                }}
              title="数据引擎"
            >
              <ApiOutlined />
              {!sidebarCollapsed && <span>数据引擎</span>}
            </button>

            {!sidebarCollapsed && expandedSection === 'data-engine' && (
              <div className="ml-4 mt-1 space-y-0.5">
                <button
                  className={`w-full text-left px-3 py-1.5 rounded-lg text-sm transition-colors flex items-center gap-2 ${
                    activeTab === 'data-engines'
                      ? 'text-accent-blue bg-accent-blue/5'
                      : 'text-text-muted hover:text-text-secondary'
                  }`}
                  onClick={() => { setActiveSection('data-engine'); setActiveTab('data-engines'); }}
                >
                  <span>API映射</span>
                </button>
                <button
                  className={`w-full text-left px-3 py-1.5 rounded-lg text-sm transition-colors flex items-center gap-2 ${
                    activeTab === 'db-mapping'
                      ? 'text-accent-blue bg-accent-blue/5'
                      : 'text-text-muted hover:text-text-secondary'
                  }`}
                  onClick={() => { setActiveSection('data-engine'); setActiveTab('db-mapping'); }}
                >
                  <span>DB映射</span>
                </button>
                <button
                  className={`w-full text-left px-3 py-1.5 rounded-lg text-sm transition-colors flex items-center gap-2 ${
                    activeTab === 'mcp-service'
                      ? 'text-accent-blue bg-accent-blue/5'
                      : 'text-text-muted hover:text-text-secondary'
                  }`}
                  onClick={() => { setActiveSection('data-engine'); setActiveTab('mcp-service'); }}
                >
                  <span>MCP服务</span>
                </button>
                <button
                  className={`w-full text-left px-3 py-1.5 rounded-lg text-sm transition-colors flex items-center gap-2 ${
                    activeTab === 'instance-collection'
                      ? 'text-accent-blue bg-accent-blue/5'
                      : 'text-text-muted hover:text-text-secondary'
                  }`}
                  onClick={() => { setActiveSection('data-engine'); setActiveTab('instance-collection'); }}
                >
                  <span>实例集合</span>
                </button>
              </div>
            )}
          </div>

          {/* 智能体 */}
          <div>
            <button
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${sidebarCollapsed ? 'justify-center' : 'justify-start'} ${
                expandedSection === 'agent'
                  ? 'bg-accent-blue/10 text-accent-blue border border-accent-blue/30'
                  : 'text-text-secondary hover:bg-dark-hover hover:text-text-primary border border-transparent'
              }`}
              onClick={() => {
                  setExpandedSection(expandedSection === 'agent' ? null : 'agent');
                }}
              title="智能体"
            >
              <RobotOutlined />
              {!sidebarCollapsed && <span>智能体</span>}
            </button>

            {!sidebarCollapsed && expandedSection === 'agent' && (
              <div className="ml-4 mt-1 space-y-0.5">
                <button
                  className={`w-full text-left px-3 py-1.5 rounded-lg text-sm transition-colors flex items-center gap-2 ${
                    activeTab === 'skill-management'
                      ? 'text-accent-blue bg-accent-blue/5'
                      : 'text-text-muted hover:text-text-secondary'
                  }`}
                  onClick={() => { setActiveSection('agent'); setActiveTab('skill-management'); }}
                >
                  <span>技能管理</span>
                </button>
                <button
                  className={`w-full text-left px-3 py-1.5 rounded-lg text-sm transition-colors flex items-center gap-2 ${
                    activeTab === 'agent-app'
                      ? 'text-accent-blue bg-accent-blue/5'
                      : 'text-text-muted hover:text-text-secondary'
                  }`}
                  onClick={() => { setActiveSection('agent'); setActiveTab('agent-app'); }}
                >
                  <span>智能体应用</span>
                </button>
              </div>
            )}
          </div>

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
              ? activeTab === 'requirements' ? '需求对话' : activeTab === 'requirement-confirm' ? '本体输出' : '本体文件'
              : activeSection === 'data-engine'
              ? activeTab === 'instance-collection' ? '实例集合' : activeTab === 'db-mapping' ? 'DB映射' : activeTab === 'mcp-service' ? 'MCP服务' : 'API映射'
              : activeSection === 'agent'
              ? activeTab === 'skill-management' ? '技能管理' : '智能体应用'
              : activeTab === 'instance' ? '实例视图' : '本体视图'}
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
        <div className={`flex-1 overflow-auto ${activeSection === 'view' ? 'p-0' : 'p-6'}`}>
          {renderContent()}
        </div>
      </main>
    </div>
  );
}
