'use client';

/**
 * MCP发布页的两类卡片（展示组件，状态与副作用全由容器 MCPPublish 持有）：
 * - FixedServiceCard：平台固定服务（compose 常驻），启停 + 查看配置 + 查看工具；
 *   **传输模式只对「对外」工具面展示**——两个内网执行底座（本体函数执行 8006 / 数据引擎执行 8005）
 *   是平台自己的运行时，不暴露传输细节；
 * - PublishedServiceCard：自建发布（动态容器），启停/删除/查看客户端配置。
 *
 * **刷新不在卡片上**：两块（固定发布 / 自建发布）的刷新一律由区块右上角的那一个按钮承担，
 * 卡片只做「单张服务」的查看与启停——两块同构，避免同一动作两处入口。
 *
 * 全部文案与端点来自 `catalog.ts`（固定服务声明的唯一来源）。
 */
import { Button, Tag } from 'antd';
import type { PublishedService } from '@/api/client';
import type { CardState, FixedServiceDef } from './catalog';
import { FIXED_TRANSPORT_LABEL, KIND_LABEL, TRANSPORT_LABEL } from './catalog';

interface FixedCardProps {
  def: FixedServiceDef;
  card: CardState;
  host: string;
  onOpenConfig: (def: FixedServiceDef) => void;
  onToggle: (def: FixedServiceDef) => void;
  onShowTools: (def: FixedServiceDef) => void;
}

export function FixedServiceCard({ def, card, host, onOpenConfig, onToggle, onShowTools }: FixedCardProps) {
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
      <div className="flex items-center gap-3 mb-3">
        <span className={`w-3 h-3 rounded-full ${card.checking ? 'bg-gray-500' : card.running ? 'bg-green-500' : 'bg-red-500'}`} />
        <span className="text-text-primary text-sm">
          {card.checking ? '检查中...' : card.running ? '运行中' : '已停止'}
        </span>
      </div>
      <div className="text-xs text-text-muted space-y-1 mb-4 flex-1">
        <div>端点：<code className="text-yellow-400 break-all">{def.endpoint.replace('{host}', host)}</code></div>
        {/* 传输模式只对**对外工具面**展示：两个内网执行底座（本体函数执行 8006 / 数据引擎执行 8005）
            是平台自己的运行时，摆出传输细节只会让人误以为可以直接连 */}
        {def.exposure === '对外' && (
          <div>传输模式：<span className="text-text-secondary">{FIXED_TRANSPORT_LABEL[def.transport]}</span></div>
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
        ) : def.transport === 'none' ? (
          <div className="text-text-muted">只提供内部执行端点</div>
        ) : (
          // 数据引擎执行服务不是"零工具"：它有 /mcp 工具面（已就绪行为），只是仅内网、不对外
          <div className="text-text-muted">只提供内部执行端点</div>
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
}

export function PublishedServiceCard({ svc, host, checking, onShowConfig, onToggle, onRemove }: PublishedCardProps) {
  return (
    <div className="bg-dark-card border border-dark-border rounded-lg p-5 w-96">
      <div className="flex items-center justify-between mb-3">
        <span className="text-text-primary text-sm font-semibold">{svc.name}</span>
        <Tag color={!checking && svc.running ? 'success' : 'default'} className="m-0">
          {checking ? '检查中...' : svc.running ? '运行中' : svc.status === 'not_found' ? '容器缺失' : '已停止'}
        </Tag>
      </div>
      <div className="text-xs text-text-muted space-y-1 mb-4">
        <div>类型：{KIND_LABEL[svc.kind]}（{svc.tool_count} 个：{svc.items.join('、')}）</div>
        <div>本体：{svc.ontology_name}（ontology_id={svc.ontology_id}）</div>
        <div>
          地址：<code className="text-yellow-400">http://{host}:{svc.host_port}{svc.transport === 'sse' ? '/sse' : '/mcp'}</code>
        </div>
        <div>传输模式：{TRANSPORT_LABEL[svc.transport]}</div>
        <div>访问令牌：<code className="text-accent-green">{svc.token}</code>（须带 X-MCP-Token 头）</div>
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
