'use client';

/**
 * 设计页内容区（自 `app/design/[id]/page.tsx` 抽取，行为不变）。
 *
 * 依据「一级栏目 + 页签」渲染对应组件：
 * - 本体展示与本体明细用 `display:none` 常驻，保留其编辑状态；
 * - 需求、权限、数据引擎、智能体用条件渲染，避免常驻内存。
 */
import OntologyGraph from '@/components/View/OntologyGraph';
import InstanceGraph from '@/components/View/InstanceGraph';
import ConversationManager from './ConversationManager';
import RequirementSummary from './RequirementSummary';
import OntologyDeployer from './OntologyDeployer';
import ConceptTable from './ConceptTable';
import RelationTable from './RelationTable';
import FunctionTable from './FunctionTable';
import BehaviorTable from './BehaviorTable';
import RuleTable from './RuleTable';
import ProcessTable from './ProcessTable';
import SecurityTable from './SecurityTable';
import DataEngineTable from './DataEngineTable';
import MCPService from './MCPService';
import SkillManagement from './SkillManagement';
import AgentApp from './AgentApp';
import MCPConfigPanel from './MCPConfig';

export interface DesignContentProps {
  ontologyId: number;
  activeSection: string;
  activeTab: string;
  /** 从对话链接进入时预选的线程 id */
  threadParam: string | null;
  scenarioName?: string;
  ontologyName?: string;
}

export default function DesignContent({
  ontologyId, activeSection, activeTab, threadParam, scenarioName, ontologyName,
}: DesignContentProps) {
  return (
    <div className="h-full">
      {/* ── 本体展示：轻量，保留 display:none ── */}
      <div style={{ display: activeSection === 'view' && activeTab === 'view' ? '' : 'none' }} className="h-full"><OntologyGraph ontologyId={ontologyId} /></div>
      <div style={{ display: activeSection === 'view' && activeTab === 'instance' ? '' : 'none' }} className="h-full">
        <InstanceGraph ontologyId={ontologyId} />
      </div>

      {/* ── 本体构建（需求）：条件渲染，避免常驻内存 ── */}
      {activeSection === 'requirements' && activeTab === 'requirements' && (
        <ConversationManager activeTab={activeTab} initialThreadId={threadParam} scenarioName={scenarioName} ontologyName={ontologyName} />
      )}
      {activeSection === 'requirements' && activeTab === 'requirement-summary' && (
        <RequirementSummary ontologyId={ontologyId} activeTab={activeTab} scenarioName={scenarioName || ''} ontologyName={ontologyName || ''} />
      )}
      {activeSection === 'requirements' && activeTab === 'deployment' && (
        <OntologyDeployer ontologyId={ontologyId} activeTab={activeTab} />
      )}

      {/* ── 本体明细（设计）：display:none，保留编辑状态 ── */}
      <div style={{ display: activeSection === 'design' && activeTab === 'concepts' ? '' : 'none' }}><ConceptTable ontologyId={ontologyId} activeTab={activeTab} /></div>
      <div style={{ display: activeSection === 'design' && activeTab === 'relations' ? '' : 'none' }}><RelationTable ontologyId={ontologyId} activeTab={activeTab} /></div>
      <div style={{ display: activeSection === 'design' && activeTab === 'functions' ? '' : 'none' }}><FunctionTable ontologyId={ontologyId} activeTab={activeTab} /></div>
      <div style={{ display: activeSection === 'design' && activeTab === 'behaviors' ? '' : 'none' }}><BehaviorTable ontologyId={ontologyId} activeTab={activeTab} /></div>
      <div style={{ display: activeSection === 'design' && activeTab === 'rules' ? '' : 'none' }}><RuleTable ontologyId={ontologyId} activeTab={activeTab} /></div>
      <div style={{ display: activeSection === 'design' && activeTab === 'processes' ? '' : 'none' }}><ProcessTable ontologyId={ontologyId} activeTab={activeTab} /></div>

      {/* ── 权限控制：独立一级栏目，条件渲染 ── */}
      {activeSection === 'security' && (
        <SecurityTable ontologyId={ontologyId} activeTab={activeTab} />
      )}

      {/* ── 数据引擎 & 智能体：条件渲染 ── */}
      {activeSection === 'data-engine' && activeTab === 'api-mapping' && (
        <DataEngineTable ontologyId={ontologyId} activeTab={activeTab} />
      )}
      {activeSection === 'data-engine' && activeTab === 'instance-collection' && (
        <div className="flex items-center justify-center h-48 text-text-muted"><p>实例集合 — 开发中</p></div>
      )}
      {activeSection === 'data-engine' && activeTab === 'mcp-service' && (
        <MCPService />
      )}
      {activeSection === 'agent' && activeTab === 'skill-management' && (
        <SkillManagement ontologyId={ontologyId} activeTab={activeTab} />
      )}
      {activeSection === 'agent' && activeTab === 'agent-app' && (
        <AgentApp
          scenarioName={scenarioName}
          ontologyName={ontologyName}
        />
      )}
      {activeSection === 'agent' && activeTab === 'mcp-config' && (
        <MCPConfigPanel />
      )}
    </div>
  );
}
