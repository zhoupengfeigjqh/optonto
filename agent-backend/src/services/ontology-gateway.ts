/**
 * OntologyGateway — 从 ontology.yaml 提取行为关联的元信息。
 *
 * 提取内容：
 *   - 行为的参数结构
 *   - 关联的规则（含 related_functions / judge_functions、data_supplements）
 *   - 安全管控
 *   - 关联的概念属性
 */

import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';
import { PathAccessController } from '../security/path-access-controller.js';
import { getCommonFunctionNames, getCommonFunctionInfo } from './common-functions.js';
import type { BehaviorMeta, RuleDetail, ConceptInfo, FunctionMeta } from '../types.js';

export class OntologyGateway {
  /** 按 (scenario, ontology) 缓存解析结果，用文件 mtime 失效（ontology.yaml + data_engines.yaml + securities.yaml 三 mtime），避免编排中反复读盘 */
  private cache = new Map<string, { data: any; mtimeMs: number; enginesMtimeMs: number; securitiesMtimeMs: number }>();

  constructor(private pac: PathAccessController) {}

  /** 读取并缓存本体配置；ontology.yaml / data_engines.yaml / securities.yaml 任一 mtime 变化时自动重读。
   *  数据引擎与安全管控已剥离为独立文件：存在则覆盖 data.data_engines / data.securities，不存在回退 ontology.yaml 旧段（读时兼容）。 */
  private loadOntologyData(scenario: string, ontology: string): any | null {
    const key = `${scenario}\u0000${ontology}`;
    const yamlPath = join(this.pac.resolveConfigDir(scenario, ontology), 'ontology.yaml');
    const enginesPath = join(this.pac.resolveConfigDir(scenario, ontology), 'data_engines.yaml');
    const securitiesPath = join(this.pac.resolveConfigDir(scenario, ontology), 'securities.yaml');
    if (!existsSync(yamlPath)) return null;
    try {
      const mtimeMs = statSync(yamlPath).mtimeMs;
      const enginesMtimeMs = existsSync(enginesPath) ? statSync(enginesPath).mtimeMs : 0;
      const securitiesMtimeMs = existsSync(securitiesPath) ? statSync(securitiesPath).mtimeMs : 0;
      const hit = this.cache.get(key);
      if (hit && hit.mtimeMs === mtimeMs && hit.enginesMtimeMs === enginesMtimeMs && hit.securitiesMtimeMs === securitiesMtimeMs) return hit.data;
      const data = load(readFileSync(yamlPath, 'utf-8'));
      if (enginesMtimeMs && data && typeof data === 'object') {
        const enginesDoc: any = load(readFileSync(enginesPath, 'utf-8'));
        (data as any).data_engines = Array.isArray(enginesDoc) ? enginesDoc : (enginesDoc?.data_engines ?? []);
      }
      if (securitiesMtimeMs && data && typeof data === 'object') {
        const securitiesDoc: any = load(readFileSync(securitiesPath, 'utf-8'));
        (data as any).securities = Array.isArray(securitiesDoc) ? securitiesDoc : (securitiesDoc?.securities ?? []);
      }
      this.cache.set(key, { data, mtimeMs, enginesMtimeMs, securitiesMtimeMs });
      return data;
    } catch {
      return null;
    }
  }

  /**
   * 获取指定本体下所有行为名称列表（用于校验）。
   */
  getBehaviorNames(scenario: string, ontology: string): string[] {
    const data = this.loadOntologyData(scenario, ontology);
    return (data?.behaviors || []).map((b: any) => b.name).filter(Boolean);
  }

  /** 按关联概念名解析概念属性（含 constraint）。行为 related_concepts 与函数 related_concepts 同源共用。 */
  private resolveConcepts(data: any, relatedNames: string[]): ConceptInfo[] {
    return (data?.concepts || [])
      .filter((c: any) => relatedNames.includes(c.name))
      .map((c: any) => ({
        name: c.name,
        display_name: c.display_name || c.name,
        attributes: (c.attributes || []).map((a: any) => ({
          name: a.name,
          type: a.type || 'string',
          display_name: a.display_name || a.name,
          constraint: a.constraint ?? null,
        })),
      }));
  }

  /**
   * 按行为名称提取完整的元信息。
   */
  getBehaviorMeta(scenario: string, ontology: string, behaviorName: string): BehaviorMeta {
    const data = this.loadOntologyData(scenario, ontology);
    if (!data) {
      return { params: {}, preRules: [], postRules: [], concepts: [], isWrite: false };
    }


    // 行为定义 → 取 params 参数结构
    const behavior = data?.behaviors?.find((b: any) => b.name === behaviorName);

    // 判断函数判定依据（口径 B：类型即角色）：本体函数且 type=VALIDATION 者即判断函数
    // （公共函数无本体类型 → 恒不参与判断；本体 CALCULATION 等为计算函数，仅提供数据不拦执行）
    const fnTypeByName = new Map<string, string>(
      (data?.functions || [])
        .filter((f: any) => f && f.name)
        .map((f: any) => [f.name as string, String(f.type || '')]),
    );
    const judgeFnsOf = (related: string[]): string[] =>
      related.filter(n => fnTypeByName.get(n) === 'VALIDATION');

    // 读取规则列表（规则绑定行为唯一：标量 behavior；旧数据 related_behaviors 数组读时兼容取首个）
    const allRules: RuleDetail[] = (data?.rules || []).map((r: any) => {
      // 读时兼容：旧 check_functions（2026-09-30 口径 B 已取消的独立判断字段）并入 related_functions
      const related = [...new Set([
        ...(Array.isArray(r.related_functions) ? r.related_functions : []),
        ...(Array.isArray(r.check_functions) ? r.check_functions : []),
      ].filter(Boolean))] as string[];
      return {
        name: r.name || '',
        description: r.description || '',
        position: r.position || '前置',
        behavior: r.behavior ?? (Array.isArray(r.related_behaviors) ? (r.related_behaviors[0] || '') : (r.related_behaviors || '')),
        related_functions: related,
        judge_functions: judgeFnsOf(related),
        // 只采用 yaml 手写的 data_supplements
        data_supplements: [...(r.data_supplements || [])],
      };
    });

    const preRules = allRules.filter(
      r => r.position === '前置' && r.behavior === behaviorName,
    );
    const postRules = allRules.filter(
      r => r.position === '后置' && r.behavior === behaviorName,
    );

    // 安全管控
    const security = data?.securities?.find(
      (s: any) => s.action_name === behaviorName,
    );

    // 关联概念属性
    // 行为关联概念唯一（标量 concept；旧数据 related_concepts 数组读时兼容）
    const conceptNames: string[] = behavior?.concept
      ? [behavior.concept]
      : (Array.isArray(behavior?.related_concepts) ? behavior.related_concepts : []);
    const concepts = this.resolveConcepts(data, conceptNames);

    // 写操作判定：op_type 是唯一权威来源（command=写/query=读）；
    // 引擎唯一形态为 MCP（SQL/HTTP 已删除），无 method 语义可推导——空 op_type 一律按读处理。
    const opType = behavior?.op_type;
    const isWrite = opType === 'command';

    return {
      display_name: behavior?.display_name || behavior?.name || '',
      params: behavior?.params || {},
      // 每条规则只保留自己声明的 data_supplements（过滤私有 _ 前缀接口），不做跨规则并集
      preRules: preRules.map(r => ({ ...r, data_supplements: (r.data_supplements || []).filter(a => !a.startsWith('_')) })),
      postRules: postRules.map(r => ({ ...r, data_supplements: (r.data_supplements || []).filter(a => !a.startsWith('_')) })),
      // securities 新格式 {confirm, confirm_content, scope}；旧格式 audit_content 兼容读取（下次保存自动迁移）；
      // scope 恒数组（core 端 coerce 后落盘），旧标量形态这里同样兜底包成单元素数组
      security: security
        ? {
            confirm: security.confirm !== false,
            confirm_content: security.confirm_content ?? security.audit_content ?? '',
            scope: security.scope
              ? (Array.isArray(security.scope) ? security.scope : [security.scope])
              : ['everyone'],
          }
        : undefined,
      concepts,
      isWrite,
    };
  }

  /**
   * 获取函数子任务可用的函数名列表（本体函数 ∪ 公共函数），函数子任务名校验用。
   * 本体函数来自 ontology.yaml functions[]；公共函数来自全局 functions.json（与 AgentFactory 同源 getCommonFunctionNames）。
   */
  getFunctionNames(scenario: string, ontology: string): string[] {
    const data = this.loadOntologyData(scenario, ontology);
    const ontoFns = (data?.functions || []).map((f: any) => f.name).filter(Boolean);
    return [...new Set([...ontoFns, ...getCommonFunctionNames()])];
  }

  /**
   * 函数信息合一查询（中文名 + 描述 + 参数声明）：本体函数 functions[] 优先，不在则回查公共函数；
   * 都不在 → null（函数不在任何文件声明源）。
   * FunctionCatalog 文件兜底模式的①②数据源（meta/params）。
   */
  getFunctionInfo(scenario: string, ontology: string, functionName: string): FunctionMeta | null {
    const data = this.loadOntologyData(scenario, ontology);
    const fn = (data?.functions || []).find((f: any) => f.name === functionName);
    if (fn) {
      return {
        display_name: fn?.display_name || fn?.description || '',
        description: fn?.description,
        params: fn?.params || {},
        type: fn?.type || '',
      };
    }
    const common = getCommonFunctionInfo(functionName);
    // 公共函数无本体类型 → type 恒空串（不可能成为判断函数）
    return common ? { display_name: common.display_name, description: common.description, params: common.params, type: '' } : null;
  }
}
