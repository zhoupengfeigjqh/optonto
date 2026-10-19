'use client';

/**
 * 「本体明细 → 关系」容器：右上角开关切换两类关系。
 *
 * - 概念关系（类级公理）：SubClassOf / EquivalentClass / DisjointWith，无基数；
 * - 对象关系（实例间有向边）：即原有关系表，行为不变（5 值关系类型已改为大驼峰）。
 */
import { useState } from 'react';
import { Segmented } from 'antd';
import ObjectRelationTable from './ObjectRelationTable';
import ConceptRelationTable from './ConceptRelationTable';

interface Props { ontologyId: number; activeTab?: string; }

type RelationView = 'concept' | 'object';

const VIEW_HINTS: Record<RelationView, string> = {
  concept: '概念关系描述类与类之间的公理：父子（SubClassOf）由概念设计自动同步，可补充互斥与等价关系',
  object: '对象关系描述实例之间的有向连接与基数约束',
};

export default function RelationTable({ ontologyId, activeTab }: Props) {
  const [view, setView] = useState<RelationView>('object');

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-semibold text-text-primary">关系管理</h3>
        <Segmented
          value={view}
          onChange={v => setView(v as RelationView)}
          options={[
            { label: '概念关系', value: 'concept' },
            { label: '对象关系', value: 'object' },
          ]}
        />
      </div>
      <p className="text-text-muted text-xs mb-3">{VIEW_HINTS[view]}</p>
      {view === 'concept'
        ? <ConceptRelationTable ontologyId={ontologyId} activeTab={activeTab} />
        : <ObjectRelationTable ontologyId={ontologyId} activeTab={activeTab} />}
    </div>
  );
}
