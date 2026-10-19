/**
 * 概念属性继承（subClassOf）合成 —— 运行面镜像 core `services/inheritance.py`（spec 005）。
 *
 * 落盘只存 `sub_class_of` + `attribute_restrictions`；运行面直读 yaml，故在此按同一口径合成：
 * - 有效属性 = 自有（未被继承同名占用）+ 父概念有效属性（多级传递）；
 * - 同名继承优先（子概念只能通过 restrictions 收窄）；
 * - 收窄：enum 交集（只删不增）、min 取最大 / max 取最小、pattern 覆盖（null = 继承）；
 * - 环 / 悬空父概念 → 截断（运行面容错优先，不抛错）。
 */

const ENUM_TYPES = new Set(['string', 'number', 'integer']);
const RANGE_TYPES = new Set(['number', 'integer']);
const PATTERN_TYPES = new Set(['string']);

export interface ConceptLike {
  name: string;
  sub_class_of?: string | null;
  attributes?: any[];
  attribute_restrictions?: Record<string, any> | null;
}

function applyRestriction(rawAttr: any, r: any): { attr: any; changed: boolean } {
  const c: any = { ...(rawAttr?.constraint || {}) };
  const type = rawAttr?.type;
  let changed = false;

  if (Array.isArray(r?.enum) && r.enum.length && ENUM_TYPES.has(type) && Array.isArray(c.enum) && c.enum.length) {
    const allowed = new Set(r.enum.map((v: any) => String(v)));
    const narrowed = c.enum.filter((v: any) => allowed.has(String(v)));
    if (narrowed.length && narrowed.length !== c.enum.length) {
      c.enum = narrowed;
      changed = true;
    }
  }

  if (RANGE_TYPES.has(type)) {
    const lo = [c.min, r?.min].filter((v: any) => v !== null && v !== undefined);
    const hi = [c.max, r?.max].filter((v: any) => v !== null && v !== undefined);
    if (lo.length) {
      const next = Math.max(...lo);
      if (next !== c.min) { c.min = next; changed = true; }
    }
    if (hi.length) {
      const next = Math.min(...hi);
      if (next !== c.max) { c.max = next; changed = true; }
    }
  }

  if (r?.pattern !== null && r?.pattern !== undefined && PATTERN_TYPES.has(type)) {
    if ((c.pattern || '') !== r.pattern) {
      c.pattern = r.pattern;
      changed = true;
    }
  }

  return { attr: { ...rawAttr, constraint: Object.keys(c).length ? c : null }, changed };
}

/** 概念名 → 有效属性列表（自有在前，继承在后；同名继承优先）。 */
export function effectiveAttributes(concepts: ConceptLike[], name: string): any[] {
  const byName = new Map<string, ConceptLike>();
  for (const c of concepts || []) {
    if (c && c.name) byName.set(c.name, c);
  }
  const memo = new Map<string, any[]>();

  const walk = (current: string, stack: Set<string>): any[] => {
    const hit = memo.get(current);
    if (hit) return hit;
    const concept = byName.get(current);
    if (!concept) return [];
    if (stack.has(current)) return [];

    const parentName = String(concept.sub_class_of || '').trim();
    const parentEff = parentName && byName.has(parentName)
      ? walk(parentName, new Set(stack).add(current))
      : [];
    const inheritedNames = new Set(parentEff.map((a: any) => a?.name));
    const own = (concept.attributes || [])
      .filter((a: any) => a && a.name && !inheritedNames.has(a.name))
      .map((a: any) => ({ ...a }));
    const restrictions = concept.attribute_restrictions || {};
    const resolved = [...own];

    for (const base of parentEff) {
      const r = restrictions[base?.name];
      if (r && typeof r === 'object') {
        const { attr, changed } = applyRestriction(base, r);
        resolved.push({ ...attr, restricted: Boolean(base.restricted) || changed });
      } else {
        resolved.push(base);
      }
    }

    memo.set(current, resolved);
    return resolved;
  };

  return walk(name, new Set());
}
