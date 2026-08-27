/**
 * OntologyGateway — 从 ontology.yaml 提取行为关联的元信息。
 *
 * 提取内容：
 *   - 行为的参数结构
 *   - 关联的规则（含 rule_detail、data_supplements）
 *   - 安全管控
 *   - 关联的概念属性
 */

import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';
import { PathAccessController } from '../security/path-access-controller.js';
import { getCommonFunctionNames, getCommonFunctionInfo } from './common-functions.js';
import type { BehaviorMeta, RuleDetail, ConceptInfo, FunctionInfo } from '../types.js';

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

    // 读取规则列表
    const allRules: RuleDetail[] = (data?.rules || []).map((r: any) => ({
      name: r.name || '',
      description: r.description || '',
      position: r.position || '前置',
      related_behaviors: r.related_behaviors || [],
      rule_detail: r.rule_detail || null,
      related_functions: r.related_functions || [],
      // 目前只采用 yaml 手写的 data_supplements；inferNeededApis 暂不启用（函数保留，待需要时再接回）
      data_supplements: [...(r.data_supplements || [])],
    }));

    const preRules = allRules.filter(
      r => r.position === '前置' && r.related_behaviors.includes(behaviorName),
    );
    const postRules = allRules.filter(
      r => r.position === '后置' && r.related_behaviors.includes(behaviorName),
    );

    // 安全管控
    const security = data?.securities?.find(
      (s: any) => s.action_name === behaviorName,
    );

    // 关联概念属性
    const concepts = this.resolveConcepts(data, behavior?.related_concepts || []);

    // 写操作判定：优先用 op_type（command=写/query=读，显式权威来源）；
    // op_type 为空时兜底到 data_engines 的 HTTP method 推导（防漏填导致写操作跳过安全审核）。
    const opType = behavior?.op_type;
    const writeMethods = new Set(['POST', 'PATCH', 'DELETE', 'PUT']);
    const dataEngine = (data?.data_engines || []).find((d: any) => d.behavior_name === behaviorName);
    const isWrite = opType
      ? opType === 'command'
      : (!!dataEngine && dataEngine.engine_type !== 'SQL'
        && writeMethods.has((dataEngine.target?.method || '').toUpperCase()));

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
   * 函数信息合一查询（中文名 + 描述 + 参数声明 + 关联概念）：本体函数 functions[] 优先，不在则回查公共函数；
   * 都不在 → null（函数不在任何文件声明源）。
   * FunctionCatalog 文件兜底模式的①②数据源（meta/params），以及规划期约束校验的声明源（concepts：
   * 本体函数按 related_concepts 解析属性 constraint，公共函数恒为 []——无概念关联，自然跳过校验）。
   */
  getFunctionInfo(scenario: string, ontology: string, functionName: string): FunctionInfo | null {
    const data = this.loadOntologyData(scenario, ontology);
    const fn = (data?.functions || []).find((f: any) => f.name === functionName);
    if (fn) {
      return {
        display_name: fn?.display_name || fn?.description || '',
        description: fn?.description,
        params: fn?.params || {},
        concepts: this.resolveConcepts(data, fn?.related_concepts || []),
      };
    }
    const common = getCommonFunctionInfo(functionName);
    return common ? { ...common, concepts: [] } : null;
  }

  /**
   * 从 rule_detail 中递归扫描 type:concept/instance 节点（instance 为 2026-08-26 改名后的新名，concept 为存量兼容），
   * 通过 related_concepts 反推需要调用的查询行为。
   */
  private inferNeededApis(ruleDetail: any, behaviors: any[]): string[] {
    if (!ruleDetail || typeof ruleDetail !== 'object') return [];
    const conceptNames = new Set<string>();
    const walk = (node: any) => {
      if (!node || typeof node !== 'object') return;
      if ((node.type === 'concept' || node.type === 'instance') && node.concept) {
        conceptNames.add(node.concept);
      }
      Object.values(node).forEach(v => walk(v));
    };
    walk(ruleDetail);

    // 匹配查询行为：related_concepts 包含该概念且 name 以 Query 开头
    const apis: string[] = [];
    for (const beh of behaviors) {
      if (typeof beh.name === 'string' && beh.name.startsWith('Query')) {
        const rc = (beh.related_concepts || []).map((s: any) => String(s));
        for (const cn of conceptNames) {
          if (rc.includes(cn)) {
            apis.push(beh.name);
            break;
          }
        }
      }
    }
    return apis;
  }
}
