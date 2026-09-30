/**
 * 规则纯逻辑（自 RuleTable.tsx 抽取；2026-09-30 随条件树退役精简）。
 *
 * 规则条件树已退役：规则约束逻辑统一由「关联函数」承载——本体且
 * type=VALIDATION 者为判断函数（返回统一信封 data.pass/reason，运行期由规则闸真阻断）。
 * 因此本模块只保留「数据补充自动推导」。
 */

/**
 * 数据补充自动推导：关联函数声明的关联概念 → 覆盖这些概念的 query 行为
 * （排除规则自身绑定的行为），作为规则判断所需的额外数据来源。
 */
export function deriveDataSupplements(opts: {
  behavior: string;
  relatedFunctions: string[];
  funcs: any[];
  behaviors: any[];
}): string[] {
  const { behavior, relatedFunctions, funcs, behaviors } = opts;
  const usedConcepts = new Set<string>();
  for (const fname of relatedFunctions || []) {
    const fn = funcs.find(f => f.name === fname);
    for (const c of fn?.related_concepts || []) usedConcepts.add(c);
  }
  if (usedConcepts.size === 0) return [];
  return behaviors
    .filter(b => b.op_type === 'query' && b.name !== behavior && !!b.concept && usedConcepts.has(b.concept))
    .map(b => b.name);
}
