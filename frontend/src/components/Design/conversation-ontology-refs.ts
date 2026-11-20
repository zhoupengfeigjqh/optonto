/**
 * 需求对话「引用存量本体」的纯逻辑（spec 010）—— 无 React 依赖，可穷举单测。
 *
 * 职责边界：
 * - 选项拼装（label / 置灰 / 置灰原因 / 供 `optionRender` 的第二行数据）；
 * - select value 与提交载荷之间的互转；
 * - 冲突分组与标题文案；
 * - 快照时间展示、「原本体已不存在」判定。
 *
 * 不在此处做任何校验判定（冲突、体量、可引用性全部以后端为准），避免第二套规则。
 */
import type {
  OntologyRefCandidate,
  OntologyRefInput,
  RefCandidateCounts,
  RefConflict,
  ConflictKind,
} from '@/api/ontology-refs';

/** 分隔符：场景名与本体名之间（比 `-` 安全，不会与名称内容混淆） */
const SEP = '\u0000';

export const REF_EMPTY_TEXT = '当前没有可引用的存量本体';
export const REF_LOAD_FAILED_TEXT = '加载可引用本体失败';
export const REF_HINT_TEXT = '引用后本次对话的概念 / 函数 / 行为不会与这些本体重名，同名概念属性保持一致';

export interface RefSelectOption {
  value: string;
  label: string;
  disabled: boolean;
  /** 不可选原因（= 后端 skip_reason） */
  reason?: string;
  /** 以下三项供 `optionRender` 渲染第二行 */
  description: string;
  counts: RefCandidateCounts;
  deployed_version: string;
}

export interface ConflictGroupItem {
  name: string;
  lines: string[];
}

export interface ConflictGroup {
  title: string;
  items: ConflictGroupItem[];
}

/**
 * 名称中的分隔符、控制字符与连续空白折叠为单个空格（与后端 `_clean` 口径一致，
 * 保证同一名称在前端 key 与后端渲染文本里是同一形态）。
 */
export function sanitizeRefName(name: string): string {
  return String(name ?? '')
    .replace(/[\u0000\r\n\t]/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
}

export function refKeyOf(ref: OntologyRefInput): string {
  return `${sanitizeRefName(ref.scenario_name)}${SEP}${sanitizeRefName(ref.ontology_name)}`;
}

export function parseRefKey(value: string): OntologyRefInput {
  const index = value.indexOf(SEP);
  if (index < 0) return { scenario_name: value, ontology_name: '' };
  return { scenario_name: value.slice(0, index), ontology_name: value.slice(index + 1) };
}

/**
 * 候选清单 → 下拉选项。
 * - 排除当前对话所属本体（避免自我引用，FR-002）；
 * - 同名项去重（后端已去重，此处防御）；
 * - 不可引用项置灰并带原因（FR-003）。
 */
export function toSelectOptions(
  candidates: readonly OntologyRefCandidate[],
  excluded?: OntologyRefInput,
): RefSelectOption[] {
  const seen = new Set<string>();
  const options: RefSelectOption[] = [];
  for (const candidate of candidates) {
    if (
      excluded
      && candidate.scenario_name === excluded.scenario_name
      && candidate.ontology_name === excluded.ontology_name
    ) {
      continue;
    }
    const value = refKeyOf(candidate);
    if (seen.has(value)) continue;
    seen.add(value);
    options.push({
      value,
      label: `${candidate.scenario_name} - ${candidate.ontology_name}`,
      disabled: !candidate.referenceable,
      reason: candidate.skip_reason ?? undefined,
      description: candidate.description ?? '',
      counts: candidate.counts,
      deployed_version: candidate.deployed_version ?? '',
    });
  }
  return options;
}

export function toRefInputs(values: readonly string[]): OntologyRefInput[] {
  return values.map(parseRefKey);
}

/** 快照时间 → 本地 `YYYY-MM-DD HH:mm`；非法输入返回 `-` */
export function formatSnapshotTime(iso: string): string {
  if (!iso) return '-';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '-';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 身份 key：只比 id 会在跨场景时碰撞，故用 `场景 id / 本体 id` 组合 */
export function refIdentityKey(ref: { scenario_id: string; ontology_id: string }): string {
  return `${ref.scenario_id}/${ref.ontology_id}`;
}

/** 被引用本体是否已不存在（候选清单里找不到即视为已删除，FR-016 / US4-场景2） */
export function missingRefIds(
  refs: readonly { scenario_id: string; ontology_id: string }[],
  candidateKeys: ReadonlySet<string>,
): Set<string> {
  const missing = new Set<string>();
  for (const ref of refs) {
    const key = refIdentityKey(ref);
    if (!candidateKeys.has(key)) missing.add(key);
  }
  return missing;
}

export function conflictKindLabel(kind: ConflictKind): string {
  return kind === 'cross_category_duplicate' ? '同一名称跨类目使用' : '同名概念属性不一致';
}

const KIND_ORDER: ConflictKind[] = ['concept_attribute_mismatch', 'cross_category_duplicate'];

/** 冲突按类型分组；差异为空时 `lines` 为空数组（渲染层据此不输出空行） */
export function groupConflicts(conflicts: readonly RefConflict[]): ConflictGroup[] {
  const groups: ConflictGroup[] = [];
  for (const kind of KIND_ORDER) {
    const items = conflicts
      .filter(conflict => conflict.kind === kind)
      .map(conflict => ({
        name: conflict.name,
        lines: (conflict.differences ?? []).filter(Boolean),
      }));
    if (items.length) groups.push({ title: conflictKindLabel(kind), items });
  }
  return groups;
}

/** 「已选 n / max」与达上限后的截断（max_count 的唯一消费点） */
export function clampSelection(
  values: readonly string[],
  maxCount: number,
): { values: string[]; truncated: boolean } {
  if (maxCount <= 0) return { values: [...values], truncated: false };
  if (values.length <= maxCount) return { values: [...values], truncated: false };
  return { values: values.slice(0, maxCount), truncated: true };
}
