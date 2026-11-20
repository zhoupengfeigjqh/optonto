'use client';

/**
 * 对话 Header 的存量本体引用标签组（spec 010）。
 *
 * 单独成组件的两个原因：
 * 1. `ConversationChat.tsx` 已接近 500 行硬上限（章程 I），不得再往父组件堆 JSX；
 * 2. 逻辑（缺失判定 / 时间格式化）已在 `conversation-ontology-refs.ts`，此处只做展示。
 */
import { Tag, Tooltip } from 'antd';
import type { OntologyRefSnapshot } from '@/api/client';
import { formatSnapshotTime, missingRefIds, refIdentityKey } from './conversation-ontology-refs';

interface Props {
  snapshot: OntologyRefSnapshot;
  /** 当前仍存在的本体身份 key 集合；缺省表示无法判定（不显示缺失态） */
  candidateKeys?: ReadonlySet<string>;
}

export default function OntologyRefTags({ snapshot, candidateKeys }: Props) {
  const refs = snapshot?.refs ?? [];
  if (refs.length === 0) return null;

  const missing = candidateKeys ? missingRefIds(refs, candidateKeys) : new Set<string>();

  return (
    <div className="flex items-center gap-1 flex-wrap" aria-label="已引用的存量本体">
      {refs.map((ref) => {
        const key = refIdentityKey(ref);
        const isMissing = missing.has(key);
        return (
          <Tooltip
            key={key}
            title={isMissing
              ? '原本体已不存在；本对话仍按创建时的快照生效，内容不会缺失'
              : `概念 ${ref.counts.concepts} / 函数 ${ref.counts.functions} / 行为 ${ref.counts.behaviors}`}
          >
            <Tag color={isMissing ? undefined : 'blue'} style={isMissing ? { opacity: 0.55 } : undefined}>
              {ref.scenario_name} - {ref.ontology_name}
              {isMissing ? '（原本体已不存在）' : ''}
            </Tag>
          </Tooltip>
        );
      })}
      <Tooltip title={`引用内容约 ${snapshot.token_estimate} / ${snapshot.max_tokens} tokens`}>
        <Tag>快照 {formatSnapshotTime(snapshot.snapshot_at)}</Tag>
      </Tooltip>
    </div>
  );
}
