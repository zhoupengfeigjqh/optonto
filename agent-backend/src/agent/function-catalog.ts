/**
 * FunctionCatalog —— 函数/行为工具信息三源合一的深 module（单出口）。
 *
 * 函数信息（名单 / 参数声明 / 中文名）原先分散两条链：params 链三源齐全、meta 链只有文件两源
 * （第三源其他MCP工具漏接），且①②在文件与 MCP schema 双投影。本模块收口为唯一出口 functionInfo：
 *
 *  正常模式（MCP 目录为准，发布方标记分类，见 toMountableToolInfo）：
 *   ① 本体函数：目录 category='本体函数'，按 scope.scenario_name/ontology_name 过滤到子任务所属本体
 *   ② 公共函数：目录 category='公共函数'（x-category 标记），全局
 *   ③ 其他MCP工具：目录无标记条目，全局
 *  文件兜底模式：目录中①②全缺（= 我方 MCP server 未连接）→ ①②回落 gateway 文件声明
 *   （yaml functions[] ∪ functions.json），③仍走目录。校验可用性不绑死 MCP 连接。
 *
 * 行为侧（2026-09 facade 化）：行为已是一等 MCP 工具（category='本体行为'），其编译 inputSchema
 * （含约束）是规划期参数校验的唯一数据源——behaviorSchema 按 scope（场景/本体/裸名）回溯。
 * 行为不进函数三源（functionNames/functionInfo 自然不含），也不设文件兜底：
 * MCP 目录缺行为工具 = 我方 MCP server 未连接，此时行为根本无法执行，校验跳过即可。
 *
 * view() 是 async 快照：MCP 目录发现是 async（其内部 run 级缓存保证重复调用代价可忽略），
 * 快照建好后所有查询同步进行——校验器得以保持纯同步函数（repairPlan 的 isClean/detailOf 闭包直接调）。
 * 一次 run 建一次快照（orchestrator 存 session.catalogView）：规划校验与执行展示同源同时刻。
 */
import type { MountableToolInfo, OntologyGatewayPort } from './agent-ports.js';

/** 函数信息（单出口返回单元）。params 恒为对象：{} = 无声明可比对（校验自然零错误，等价跳过） */
export interface FunctionInfo {
  /** 中文显示名（发布方标记 / 文件 display_name），无则空串（上层用子任务描述兜底） */
  displayName: string;
  description?: string;
  params: Record<string, any>;
  /** 编译 inputSchema 原文（已剥离 scope/ontology_id）：规划期参数校验（TypeBox）的数据源；文件兜底模式无 */
  schema?: Record<string, any>;
}

/**
 * 函数目录视图（同步快照）：规划校验与执行展示的函数/行为侧唯一数据源。
 * functionInfo 返回 null = 函数不在任何源（校验跳过，合法性由 functionNames 名单先行拦截）。
 */
export interface FunctionCatalogView {
  /** 合法函数名 = 本体函数（按本体过滤）∪ 公共函数 ∪ 其他MCP工具 */
  functionNames(scenario: string, ontology: string): string[];
  /** 函数信息（中文名/描述/参数声明），三源按序：本体函数（限定本体）→ 公共函数 → 其他MCP工具 */
  functionInfo(scenario: string, ontology: string, functionName: string): FunctionInfo | null;
  /** 行为的编译 inputSchema（按 scope 场景/本体 + 裸名回溯）；无（MCP 未连接/行为不存在）→ null（校验跳过） */
  behaviorSchema(scenario: string, ontology: string, behaviorName: string): Record<string, any> | null;
}

export class FunctionCatalog {
  constructor(
    private gateway: OntologyGatewayPort,
    /** 可挂载工具目录（四类合一），AgentFactory.getMountableToolCatalog 注入 */
    private mcpCatalog: () => Promise<MountableToolInfo[]>,
  ) {}

  /** 构建同步视图快照：正常模式以 MCP 目录为准，目录缺①②时整体回落文件声明（gateway） */
  async view(): Promise<FunctionCatalogView> {
    const catalog = await this.mcpCatalog();
    const behaviors = catalog.filter(t => t.category === '本体行为');
    const onto = catalog.filter(t => t.category === '本体函数');
    const common = catalog.filter(t => t.category === '公共函数');
    const others = new Map(
      catalog.filter(t => t.category === '其他MCP工具').map(t => [t.name, t]),
    );
    // 兜底判定：①②两类全缺 = 我方 MCP server 未连上（外部 server 的③可能还在）→ ①②走文件声明
    const fileFallback = onto.length === 0 && common.length === 0;
    if (fileFallback) {
      console.warn('[FunctionCatalog] MCP 目录中无本体函数/公共函数（我方 MCP server 未连接？），①② 回落文件声明兜底');
    }
    const gateway = this.gateway;
    // 本体过滤按 scope 场景/本体名匹配（与子任务的 scenario_name/ontology_name 同口径）
    const inOnto = (t: MountableToolInfo, scenario: string, ontology: string) =>
      t.scope?.scenario_name === scenario && t.scope?.ontology_name === ontology;
    const fromEntry = (t: MountableToolInfo): FunctionInfo => ({
      displayName: t.displayName ?? '', description: t.description, params: t.params, schema: t.schema,
    });
    return {
      functionNames: (scenario, ontology) => fileFallback
        ? [...new Set([...gateway.getFunctionNames(scenario, ontology), ...others.keys()])]
        : [...new Set([
            ...onto.filter(t => inOnto(t, scenario, ontology)).map(t => t.name),
            ...common.map(t => t.name),
            ...others.keys(),
          ])],
      functionInfo: (scenario, ontology, functionName) => {
        if (fileFallback) {
          const f = gateway.getFunctionInfo(scenario, ontology, functionName);
          if (f) return { displayName: f.display_name, description: f.description, params: f.params };
        } else {
          const entry = onto.find(t => t.name === functionName && inOnto(t, scenario, ontology))
            ?? common.find(t => t.name === functionName);
          if (entry) return fromEntry(entry);
        }
        const ext = others.get(functionName);
        return ext ? fromEntry(ext) : null;
      },
      // 行为工具可能带 onto{ontology_id}__ 前缀（跨本体重名），匹配用 scope.name 裸名，不用工具名
      behaviorSchema: (scenario, ontology, behaviorName) =>
        behaviors.find(t => inOnto(t, scenario, ontology) && t.scope?.name === behaviorName)?.schema ?? null,
    };
  }
}
