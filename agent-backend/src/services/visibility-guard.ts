/**
 * VisibilityGuard — 可见性管控"配映射即收编"（架构文档 §六，阶段三落地）。
 *
 * 问题：同一业务接口可能双边暴露（business-mcp/远程 MCP 的原始工具 + data-engine-mcp 的行为工具）。
 * Agent 直连原始工具将绕过映射、RuleGate 规则闸、安全管控（均按行为名匹配）。
 *
 * 策略：凡 data_engines 里配置了 target（server_url + tool_name）的引擎，
 * 该下游服务暴露给 Agent 时对应原始工具一律隐藏——行为工具是唯一入口。
 * （引擎唯一形态=MCP：engine_type 字段 2026-09-07 彻底删除，target 配置即收编依据。）
 * 清单由本守卫实时扫描 .data 自动生成（mtime 指纹缓存），零人工维护；
 * 即使用户手工配了 allowed_tools 白名单，收编照样生效（治理硬约束，不是提示）。
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';
import { PathAccessController } from '../security/path-access-controller.js';

/** URL 规范化：去首尾空白与末尾斜杠（配置两侧手工录入，容忍尾斜杠差异） */
export function normalizeServerUrl(url: string): string {
  return (url || '').trim().replace(/\/+$/, '');
}

export class VisibilityGuard {
  private cache: { fingerprint: string; index: Map<string, Set<string>> } | null = null;

  constructor(private pac: PathAccessController) {}

  /** 已映射接口的隐藏索引：规范化 server_url → 被收编的原始工具名集合 */
  getMappedToolIndex(): Map<string, Set<string>> {
    const ontoMarket = join(this.pac.getDataDir(), 'onto_market');
    const files: string[] = [];
    try {
      for (const sc of readdirSync(ontoMarket, { withFileTypes: true })) {
        if (!sc.isDirectory()) continue;
        for (const on of readdirSync(join(ontoMarket, sc.name), { withFileTypes: true })) {
          if (!on.isDirectory()) continue;
          const dir = join(ontoMarket, sc.name, on.name);
          // 与 OntologyGateway 同口径：data_engines.yaml 独立文件优先，不存在回退 ontology.yaml 旧段
          const enginesPath = join(dir, 'data_engines.yaml');
          files.push(existsSync(enginesPath) ? enginesPath : join(dir, 'ontology.yaml'));
        }
      }
    } catch {
      return new Map(); // onto_market 不存在：无收编
    }

    let count = 0, latest = -1;
    for (const f of files) {
      try {
        const st = statSync(f);
        count++;
        if (st.mtimeMs > latest) latest = st.mtimeMs;
      } catch { /* 文件在扫描间隙被删：跳过 */ }
    }
    const fingerprint = `${count}:${latest}`;
    if (this.cache && this.cache.fingerprint === fingerprint) return this.cache.index;

    const index = new Map<string, Set<string>>();
    for (const f of files) {
      let engines: any[] = [];
      try {
        const doc = load(readFileSync(f, 'utf-8')) as any;
        engines = Array.isArray(doc) ? doc : (doc?.data_engines ?? []);
      } catch { continue; }
      for (const de of engines || []) {
        // 缺省即 MCP（engine_type 已删出 schema，保存时不再落盘）；显式标其他已删除类型的旧配置跳过——
        // executor 会对它报错，收编也不应假装它已接管下游工具
        if (!de || (de.engine_type && de.engine_type !== 'MCP')) continue;
        const url = normalizeServerUrl(de.target?.server_url || '');
        const tool = de.target?.tool_name;
        if (!url || !tool) continue;
        if (!index.has(url)) index.set(url, new Set());
        index.get(url)!.add(tool);
      }
    }
    this.cache = { fingerprint, index };
    return index;
  }

  /** 该服务的该工具是否被收编（应对 Agent 隐藏） */
  isHidden(serverUrl: string, toolName: string): boolean {
    return this.getMappedToolIndex().get(normalizeServerUrl(serverUrl))?.has(toolName) ?? false;
  }
}
