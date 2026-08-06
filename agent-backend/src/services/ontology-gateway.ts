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
import type { BehaviorMeta, RuleDetail, ConceptInfo } from '../types.js';

export class OntologyGateway {
  /** 按 (scenario, ontology) 缓存解析后的 ontology.yaml，用文件 mtime 失效，避免编排中反复读盘 */
  private cache = new Map<string, { data: any; mtimeMs: number }>();

  constructor(private pac: PathAccessController) {}

  /** 读取并缓存 ontology.yaml 的解析结果；文件 mtime 变化时自动重读 */
  private loadOntologyData(scenario: string, ontology: string): any | null {
    const key = `${scenario}\u0000${ontology}`;
    const yamlPath = join(this.pac.resolveConfigDir(scenario, ontology), 'ontology.yaml');
    if (!existsSync(yamlPath)) return null;
    try {
      const mtimeMs = statSync(yamlPath).mtimeMs;
      const hit = this.cache.get(key);
      if (hit && hit.mtimeMs === mtimeMs) return hit.data;
      const data = load(readFileSync(yamlPath, 'utf-8'));
      this.cache.set(key, { data, mtimeMs });
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
      data_supplements: [...(r.data_supplements || []), ...this.inferNeededApis(r.rule_detail, data?.behaviors || [])],
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
    const relatedConceptNames = behavior?.related_concepts || [];
    const concepts: ConceptInfo[] = (data?.concepts || [])
      .filter((c: any) => relatedConceptNames.includes(c.name))
      .map((c: any) => ({
        name: c.name,
        display_name: c.display_name || c.name,
        attributes: (c.attributes || []).map((a: any) => ({
          name: a.name,
          type: a.type || 'string',
          display_name: a.display_name || a.name,
        })),
      }));

    // 名称约定映射（去重 data_supplements + 过滤私有接口）
    const neededApis = new Set<string>();
    for (const rule of [...preRules, ...postRules]) {
      (rule.data_supplements || []).forEach((api: string) => neededApis.add(api));
    }

    // 写操作判定：API 引擎且 method 为 POST/PATCH/DELETE（SQL 引擎只读，SELECT only）
    const writeMethods = new Set(['POST', 'PATCH', 'DELETE']);
    const dataEngine = (data?.data_engines || []).find((d: any) => d.behavior_name === behaviorName);
    const isWrite = !!dataEngine && dataEngine.engine_type !== 'SQL'
      && writeMethods.has((dataEngine.target?.method || '').toUpperCase());

    return {
      display_name: behavior?.display_name || behavior?.name || '',
      params: behavior?.params || {},
      preRules: preRules.map(r => ({ ...r, data_supplements: [...neededApis].filter(a => !a.startsWith('_')) })),
      postRules: postRules.map(r => ({ ...r, data_supplements: [...neededApis].filter(a => !a.startsWith('_')) })),
      security: security
        ? { audit_node: security.audit_node || '前置', audit_content: security.audit_content || '' }
        : undefined,
      concepts,
      isWrite,
    };
  }

  /**
   * 从 rule_detail 中递归扫描 type:concept 节点，
   * 通过 related_concepts 反推需要调用的查询行为。
   */
  private inferNeededApis(ruleDetail: any, behaviors: any[]): string[] {
    if (!ruleDetail || typeof ruleDetail !== 'object') return [];
    const conceptNames = new Set<string>();
    const walk = (node: any) => {
      if (!node || typeof node !== 'object') return;
      if (node.type === 'concept' && node.concept) {
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
