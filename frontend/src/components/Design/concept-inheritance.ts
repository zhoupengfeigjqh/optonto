/**
 * 概念继承（subClassOf）的前端纯函数（spec 005）。
 *
 * 合成后的有效属性由服务端下发（`concept.inherited_attributes`），前端只负责：
 * - 父概念选择器防环（排除自身与全部后代）；
 * - 继承行收窄（enum 只删不增 / min-max 不超父 / pattern 任意）的规范化与前端预校验。
 */
import type { Attribute, AttributeRestriction, Concept } from '@/api/client';

const ENUM_TYPES = ['string', 'number', 'integer'];
const RANGE_TYPES = ['number', 'integer'];

export const canEnum = (type?: string) => !!type && ENUM_TYPES.includes(type);
export const canRange = (type?: string) => !!type && RANGE_TYPES.includes(type);
export const canPattern = (type?: string) => type === 'string';

/** 某概念的全部后代（含多级）；父概念选择器据此排除，避免形成环。 */
export function descendantNames(concepts: Concept[], name?: string | null): Set<string> {
  const out = new Set<string>();
  if (!name) return out;
  const children = new Map<string, string[]>();
  for (const c of concepts) {
    const p = c.sub_class_of;
    if (p) children.set(p, [...(children.get(p) || []), c.name]);
  }
  const queue = [...(children.get(name) || [])];
  while (queue.length) {
    const cur = queue.pop() as string;
    if (cur === name || out.has(cur)) continue;
    out.add(cur);
    queue.push(...(children.get(cur) || []));
  }
  return out;
}

/** 可作为父概念的概念列表（排除自身与后代）。 */
export function parentCandidates(concepts: Concept[], currentName?: string | null): Concept[] {
  const blocked = descendantNames(concepts, currentName);
  return concepts.filter(c => c.name !== currentName && !blocked.has(c.name));
}

export const sameEnum = (a: (string | number)[], b: (string | number)[]) =>
  a.length === b.length && new Set(a.map(String)).size === new Set(b.map(String)).size &&
  a.every(v => b.some(x => String(x) === String(v)));

/**
 * 规范化一条收窄：与父定义等价的维度直接丢弃（= 完全继承），避免落盘噪音。
 * pattern 的 `""` 是**显式清除父模式**，与 undefined（继承）语义不同，不能丢。
 */
export function normalizeRestriction(base: Attribute, r: AttributeRestriction): AttributeRestriction | undefined {
  const baseEnum = base.constraint?.enum || [];
  const baseMin = base.constraint?.min;
  const baseMax = base.constraint?.max;
  const basePattern = base.constraint?.pattern || '';
  const out: AttributeRestriction = {};

  if (r.enum !== undefined) {
    const narrowed = r.enum;
    if (narrowed.length && baseEnum.length && !sameEnum(narrowed, baseEnum)) out.enum = narrowed;
  }
  if (r.min !== undefined && r.min !== null && r.min !== baseMin) out.min = r.min;
  if (r.max !== undefined && r.max !== null && r.max !== baseMax) out.max = r.max;
  if (r.pattern !== undefined && r.pattern !== basePattern) out.pattern = r.pattern;

  return Object.keys(out).length ? out : undefined;
}

/** 前端预校验（后端仍会强校验并返回 400）：返回错误文案，null = 通过。 */
export function validateRestriction(base: Attribute, r?: AttributeRestriction): string | null {
  if (!r) return null;
  if (r.enum !== undefined && canEnum(base.type)) {
    const baseEnum = base.constraint?.enum || [];
    if (!baseEnum.length) return `属性「${base.name}」的父定义没有枚举值，不能新增枚举`;
    if (!r.enum.length) return `属性「${base.name}」的枚举限制不能为空（空 = 完全继承，请点“恢复继承”）`;
    if (r.enum.some(v => !baseEnum.some(x => String(x) === String(v)))) {
      return `属性「${base.name}」的枚举只能从父概念枚举中删除，不能新增`;
    }
  }
  if (canRange(base.type)) {
    const baseMin = base.constraint?.min;
    const baseMax = base.constraint?.max;
    if (baseMin !== undefined && r.min !== undefined && r.min < baseMin) {
      return `属性「${base.name}」的最小值不能小于父概念的 ${baseMin}`;
    }
    if (baseMax !== undefined && r.max !== undefined && r.max > baseMax) {
      return `属性「${base.name}」的最大值不能大于父概念的 ${baseMax}`;
    }
    if (r.min !== undefined && r.max !== undefined && r.min > r.max) {
      return `属性「${base.name}」的取值范围最小值不能大于最大值`;
    }
  }
  if (r.pattern && canPattern(base.type)) {
    try { new RegExp(r.pattern); } catch { return `属性「${base.name}」的匹配模式不是合法正则`; }
  }
  return null;
}
