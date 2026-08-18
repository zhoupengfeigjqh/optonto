/**
 * FunctionCatalog —— 函数元数据三源合一的深 module。
 *
 * "有哪些函数、参数长什么样" 原本分散在三个数据源，每种消费方自己 join：
 *  ① 本体函数：ontology.yaml functions[]（OntologyGateway，mtime 缓存）
 *  ② 公共函数：.data/common_functions/functions.json（getCommonFunctions()，inputSchema 转形）
 *  ③ 其他MCP工具：AgentFactory.discoverTools() 清单（getMountableToolCatalog，run 级缓存）
 *
 * 本模块把 join 收进一处，对外只暴露一个方法 view()：
 * 规划校验（validateFunctionNames / validateParamsStructure）不再各自接收
 * mcpToolNames / mcpToolParams 手工拼接参数，统一消费 FunctionCatalogView。
 *
 * view() 是 async 快照：MCP 目录发现是 async（其内部 run 级缓存保证重复调用代价可忽略），
 * 快照建好后所有查询同步进行——校验器得以保持纯同步函数（repairPlan 的 isClean/detailOf 闭包直接调）。
 */
import type { MountableToolInfo, OntologyGatewayPort } from './agent-ports.js';

/**
 * 函数目录视图（同步快照）：规划校验的函数侧数据源。
 * 本体函数/公共函数由 gateway 按子任务所属本体覆盖（保留跨本体函数名拦截）；
 * 其他MCP工具是无本体归属的全局工具，由 MCP 目录补充。
 */
export interface FunctionCatalogView {
  /** 合法函数名 = 本体函数 ∪ 公共函数（gateway）∪ 其他MCP工具（目录） */
  functionNames(scenario: string, ontology: string): string[];
  /**
   * 函数参数声明（与 validateParamStructure 消费的形状一致），按序取源：
   * 本体函数 functions[].params → 公共函数 functions.json inputSchema（均由 gateway 覆盖）
   * → 其他MCP工具 inputSchema（目录，已 schemaToDeclaredParams 转形）。
   * 三源都没有 → null（结构无从比对，参数正确性由 MCP 工具 schema 兜底）。
   */
  functionParams(scenario: string, ontology: string, functionName: string): Record<string, any> | null;
}

export class FunctionCatalog {
  constructor(
    private gateway: OntologyGatewayPort,
    /** 可挂载工具目录（三类函数合一），AgentFactory.getMountableToolCatalog 注入 */
    private mcpCatalog: () => Promise<MountableToolInfo[]>,
  ) {}

  /** 构建同步视图快照：本体∪公共函数查询委托 gateway，其他MCP工具一次性滤出后闭包查询 */
  async view(): Promise<FunctionCatalogView> {
    const catalog = await this.mcpCatalog();
    const others = new Map(
      catalog.filter(t => t.category === '其他MCP工具').map(t => [t.name, t]),
    );
    const gateway = this.gateway;
    return {
      functionNames: (scenario, ontology) =>
        [...new Set([...gateway.getFunctionNames(scenario, ontology), ...others.keys()])],
      functionParams: (scenario, ontology, functionName) =>
        gateway.getFunctionParams(scenario, ontology, functionName)
          ?? (others.has(functionName) ? others.get(functionName)!.params : null),
    };
  }
}
