'use client';

/**
 * MCP发布页的两类卡片（展示组件，状态与副作用全由容器 MCPPublish 持有）。
 *
 * **两块同构**：固定服务（compose 常驻）与自建发布（动态容器）在页面上同权并列，
 * 因此信息层级与状态表达共用同一套原子（`StatusBadge` / `InfoRow`）：
 * 标题 + 标签 → 状态位 → 端点 → 传输模式 → 可用工具（数量 + 查看入口）→ 领域信息 → 操作按钮。
 * 差异只体现为“谁有令牌/本体/依赖”这几行领域信息，而不是两套排版——
 * 复制一份 JSX 出来就会漂移，这正是本次统一要消除的问题。
 *
 * 传输模式只对「对外」固定服务展示：两个内网执行底座（8006 / 8005）是平台自己的运行时，
 * 且都是零工具（2026-10-19 方案 B），摆出传输细节只会让人误以为可以直接连。
 *
 * **刷新不在卡片上**：两块（固定发布 / 自建发布）的刷新一律由区块右上角的那一个按钮承担，
 * 卡片只做「单张服务」的查看与启停——两块同构，避免同一动作两处入口。
 *
 * 全部文案与端点来自 `catalog.ts`（固定服务声明的唯一来源）。
 */
import type { ReactNode } from 'react';
import { Button, Tag } from 'antd';
import type { PublishedService } from '@/api/client';
import type { CardState, FixedServiceDef } from './catalog';
import { FIXED_TRANSPORT_LABEL, KIND_LABEL, TRANSPORT_LABEL } from './catalog';

/** 卡片状态位：四态同口径（自建发布多一个「容器缺失」，与「已停止」明确区分） */
type ServiceStatus = 'checking' | 'running' | 'stopped' | 'missing';

const STATUS_TEXT: Record<ServiceStatus, string> = {
  checking: '检查中...', running: '运行中', stopped: '已停止', missing: '容器缺失',
};

const STATUS_DOT: Record<ServiceStatus, string> = {
  checking: 'bg-gray-500', running: 'bg-green-500', stopped: 'bg-red-500', missing: 'bg-yellow-500',
};

/** 状态位（两块共用）：圆点 + 文本，语义与颜色一一对应 */
function StatusBadge({ state }: { state: ServiceStatus }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <span className={`w-3 h-3 rounded-full ${STATUS_DOT[state]}`} />
      <span className="text-text-primary text-sm">{STATUS_TEXT[state]}</span>
    </div>
  );
}

/** 信息行（两块共用）：`标签：值`，值允许是 <code> 等节点 */
function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      {label}：<span className="text-text-secondary break-all">{children}</span>
    </div>
  );
}

interface FixedCardProps {
  def: FixedServiceDef;
  card: CardState;
  host: string;
  onOpenConfig: (def: FixedServiceDef) => void;
  onToggle: (def: FixedServiceDef) => void;
  onShowTools: (def: FixedServiceDef) => void;
}

export function FixedServiceCard({ def, card, host, onOpenConfig, onToggle, onShowTools }: FixedCardProps) {
  const status: ServiceStatus = card.checking ? 'checking' : card.running ? 'running' : 'stopped';
  return (
    <div className="bg-dark-card border border-dark-border rounded-lg p-5 w-96 flex flex-col">
      <div className="flex items-start justify-between mb-3 gap-2">
        <span className="text-text-primary text-sm font-semibold">{def.title}</span>
        <div className="flex items-center gap-1.5 shrink-0">
          <Tag color={def.publishTools ? 'blue' : 'default'} className="m-0">
            {def.publishTools ? '对外提供工具' : '不对外提供工具'}
          </Tag>
          <Tag color={def.exposure === '对外' ? 'green' : 'default'} className="m-0">{def.exposure}</Tag>
        </div>
      </div>
      <StatusBadge state={status} />
      <div className="text-xs text-text-muted space-y-1 mb-4 flex-1">
        <InfoRow label="端点">
          <code className="text-yellow-400 break-all">{def.endpoint.replace('{host}', host)}</code>
        </InfoRow>
        {def.exposure === '对外' && (
          <InfoRow label="传输模式">{FIXED_TRANSPORT_LABEL[def.transport]}</InfoRow>
        )}
        {def.publishTools ? (
          <div className="flex items-center gap-2">
            <span>可用工具：</span>
            <span className="text-accent-green font-semibold">{card.tools.length}</span>
            {card.tools.length > 0 && (
              <Button type="link" size="small" onClick={() => onShowTools(def)}>
                查看工具
              </Button>
            )}
          </div>
        ) : (
          // 两个执行底座（8006 / 8005）都是零工具：只提供内网 REST 执行端点，不挂 MCP 协议面
          <InfoRow label="工具面">只提供内部执行端点</InfoRow>
        )}
        <div className="leading-relaxed">{def.role}</div>
      </div>
      <div className="flex gap-2">
        <Button onClick={() => onOpenConfig(def)}>查看配置</Button>
        <Button
          loading={card.toggling}
          danger={card.running}
          style={card.running ? { color: '#fff', background: '#ef4444', borderColor: '#ef4444' } : undefined}
          onClick={() => onToggle(def)}
        >
          {card.running ? '停止' : '启动'}
        </Button>
      </div>
    </div>
  );
}

interface PublishedCardProps {
  svc: PublishedService;
  host: string;
  /** 列表读取中（区块「刷新」/ 首屏加载）：状态位显示「检查中...」——与固定卡片同一套反馈 */
  checking?: boolean;
  onShowConfig: (svc: PublishedService) => void;
  onToggle: (svc: PublishedService) => void;
  onRemove: (svc: PublishedService) => void;
  /** 查看发布时冻结的工具清单（0 个工具时不渲染入口，与固定卡片一致） */
  onShowTools?: (svc: PublishedService) => void;
}

export function PublishedServiceCard({
  svc, host, checking, onShowConfig, onToggle, onRemove, onShowTools,
}: PublishedCardProps) {
  const status: ServiceStatus = checking
    ? 'checking'
    : svc.running ? 'running' : svc.status === 'not_found' ? 'missing' : 'stopped';
  const path = svc.transport === 'sse' ? '/sse' : '/mcp';
  return (
    <div className="bg-dark-card border border-dark-border rounded-lg p-5 w-96 flex flex-col">
      <div className="flex items-start justify-between mb-3 gap-2">
        <span className="text-text-primary text-sm font-semibold break-all">{svc.name}</span>
        <div className="flex items-center gap-1.5 shrink-0">
          <Tag color="blue" className="m-0">{KIND_LABEL[svc.kind]}</Tag>
          <Tag color="green" className="m-0">对外</Tag>
        </div>
      </div>
      <StatusBadge state={status} />
      <div className="text-xs text-text-muted space-y-1 mb-4 flex-1">
        <InfoRow label="端点">
          <code className="text-yellow-400 break-all">http://{host}:{svc.host_port}{path}</code>
        </InfoRow>
        <InfoRow label="传输模式">{TRANSPORT_LABEL[svc.transport]}</InfoRow>
        <div className="flex items-center gap-2">
          <span>可用工具：</span>
          <span className="text-accent-green font-semibold">{svc.tool_count}</span>
          {svc.tool_count > 0 && onShowTools && (
            <Button type="link" size="small" onClick={() => onShowTools(svc)}>
              查看工具
            </Button>
          )}
        </div>
        {/* ── 领域信息：自建发布独有（令牌 / 本体 / 依赖），固定服务没有这几行 ── */}
        <InfoRow label="已选工具">{svc.items.join('、') || '—'}</InfoRow>
        <InfoRow label="本体">{svc.ontology_name}（ontology_id={svc.ontology_id}）</InfoRow>
        <InfoRow label="访问令牌">
          <code className="text-accent-green">{svc.token}</code>（须带 X-MCP-Token 头）
        </InfoRow>
        <div className="text-yellow-400/80">
          依赖 {svc.kind === 'ontology_function' ? '本体函数执行服务' : '数据引擎执行服务'} 运行中；工具清单为发布时快照
        </div>
      </div>
      <div className="flex gap-2">
        <Button onClick={() => onShowConfig(svc)}>查看配置</Button>
        <Button onClick={() => onToggle(svc)}>{svc.running ? '停止' : '启动'}</Button>
        <Button danger onClick={() => onRemove(svc)}>删除</Button>
      </div>
    </div>
  );
}
