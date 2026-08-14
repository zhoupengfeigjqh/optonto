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
      security: security
        ? { audit_node: security.audit_node || '前置', audit_content: security.audit_content || '' }
        : undefined,
      concepts,
      isWrite,
    };
  }

  /**
   * 按函数名取本体函数的参数结构。
   * 函数定义在 functions[] 中才有 params（本体函数，走 executeOntoFunction 包装、参数不可见，需渲染）；
   * 不在则返回 null，表示共享函数（直接 MCP 工具，参数在工具 schema 可见，无需渲染）。
   */
  getFunctionParams(scenario: string, ontology: string, functionName: string): Record<string, any> | null {
    const data = this.loadOntologyData(scenario, ontology);
    const fn = (data?.functions || []).find((f: any) => f.name === functionName);
    if (!fn) return null;
    return fn?.params || {};
  }

  /**
   * 按函数名提取展示元信息（中文显示名 + 描述），工具调用展示用。
   * 不 fallback 到英文函数名：无中文名时返回空，让上层用子任务描述兜底。
   */
  getFunctionMeta(scenario: string, ontology: string, functionName: string): { display_name: string; description?: string } {
    const data = this.loadOntologyData(scenario, ontology);
    const fn = (data?.functions || []).find((f: any) => f.name === functionName);
    return {
      display_name: fn?.display_name || fn?.description || '',
      description: fn?.description,
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
