/**
 * 工具目录装配 —— MCP 工具 → 可挂载目录条目的转形知识单点（深 module 的装配侧）。
 *
 * 收拢原先三处分散的目录知识：
 *  - MountableToolInfo：目录条目类型（原 agent-ports.ts，与端口定义同居导致概念漂移）
 *  - toMountableToolInfo：发布方标记分类 + scope/ontology_id 剥离 + 参数声明/编译 schema 双投影
 *    （原 agent-factory.ts，工厂被迫承载装配细节）
 *  - PARENT_TOOL_LABELS：父 Agent 本体查询工具的中文标签（原 agent-factory.ts，
 *    orchestrator 反向 import 工厂拿展示名——装配知识不该由工厂持有）
 *
 * 与 FunctionCatalog 的分工：本模块回答"一个 MCP 工具长什么样"（逐条转形，纯函数）；
 * FunctionCatalog 回答"这次 run 有哪些函数/行为可用"（整表快照 + 三源过滤）。
 * schemaToDeclaredParams 留在 services/common-functions.ts：它是 functions.json 读取器
 * 与 agent 层共享的形状转换 kernel（services → agent 反向依赖不可取），本模块单向 import 它。
 */
import { schemaToDeclaredParams } from '../services/common-functions.js';

/** 可挂载工具目录条目（getMountableToolCatalog 返回）。四类：本体行为 / 本体函数 / 公共函数 / 其他MCP工具 */
export interface MountableToolInfo {
  name: string;
  category: '本体行为' | '本体函数' | '公共函数' | '其他MCP工具';
  description: string;
  /** 中文显示名（发布方结构化标记：本体工具 scope.display_name / 公共函数 x-display_name），无则由上层兜底 */
  displayName?: string;
  /** 参数声明结构（inputSchema 经 schemaToDeclaredParams 转形，已剥离 scope/ontology_id），与子任务 params 填法同形 */
  params: Record<string, any>;
  /** 编译 inputSchema 原文（已剥离 scope；本体工具已剥 ontology_id）：规划期参数校验（TypeBox）的数据源 */
  schema?: Record<string, any>;
  /** 本体行为/函数独有：所属场景/本体真实值（ontology_id/scenario_id/scenario_name/ontology_name/name 裸名） */
  scope?: Record<string, any>;
}

/**
 * 本体函数工具 schema 前置的作用域块键（MCP server 在 inputSchema.properties.scope 注入所属场景/本体的真实值）。
 * 非函数输入参数：listAllMcpFunctions 读出 scope 展示给父 Agent；scopeToOntology/callFunctionTool 调用前剥离。
 */
export const SCOPE_KEY = 'scope';

/**
 * 行为工具名 → 行为裸名（剥 onto{ontology_id}__ 跨本体重名前缀；无前缀原样返回）。
 * 前缀规则见 core /api/ontologies/behaviors/all 的全局命名；裸名是挂载过滤 / disable 闸 / 展示回溯的统一匹配键
 * （优先用工具 scope.name const，本函数是 scope 缺失场景（展示回退、按名匹配）的唯一剥前缀点）。
 */
export function bareBehaviorName(toolName: string): string {
  return toolName.replace(/^onto\d+__/, '');
}

/**
 * 父 Agent 可挂载的本体查询工具（只读元数据，规划时了解场景/本体/行为/概念/关系/函数/安全/流程）。
 * 父 Agent 工具职责边界：load_skill + 本体查询 list* + listAllMcpFunctions（本地内部工具：函数/工具清单）+ submit_plan，【不挂执行工具、不挂函数/外部工具】。
 * 函数/外部工具由 listAllMcpFunctions 实时发现（本体函数/公共函数/其他MCP工具三类，本体行为不在其列——
 * 行为规划走 listOntoBehaviors），父 Agent 选定后经 related_functions 下放子 Agent、或直接规划为函数子任务；
 * 本体行为是一等 MCP 工具（facade，工具名即行为名），由子 Agent 按 legalCalls.behaviors 挂载。
 * 注：load_skill / submit_plan / listAllMcpFunctions 是 agent-backend 本地内部工具，只挂父 Agent，
 * 不注册进任何 MCP server、不暴露给子 Agent 与外部消费方。
 * 单源形态 = 工具名 → 中文标签：agent-factory 用作挂载/剔除白名单（keys），
 * orchestrator 用作执行记录展示名（"中文（英文）"格式）。
 */
export const PARENT_TOOL_LABELS: Record<string, string> = {
  listScenarios: '查询场景清单',
  listOntologies: '查询本体清单',
  listOntoBehaviors: '查询行为清单',
  listOntoConcepts: '查询概念清单',
  listOntoRelations: '查询关系清单',
  listOntoFunctions: '查询函数清单',
  listOntoSecurities: '查询安全清单',
  listOntoProcesses: '查询流程清单',
};

/**
 * MCP 工具 → 可挂载目录条目（纯函数，导出供单测直调，无需 MCP 连接）。
 * 分类唯一依据：发布方标记（本体行为/本体函数 = scope.category const，公共函数 = x-category 扩展键）；
 * 无标记 = 外部 MCP 工具（排除法）。core/agent 同仓库整栈部署，不设旧启发式兼容层——
 * 特征猜测（hasOntologyId）会把碰巧带 ontology_id 参数的外部工具误判为本体工具并误删其参数。
 */
export function toMountableToolInfo(tool: { name: string; description?: string; label?: string; parameters?: any }): MountableToolInfo {
  const schema = tool.parameters || {};
  const scopeProp = schema.properties?.[SCOPE_KEY];
  const category: MountableToolInfo['category'] =
    scopeProp?.properties?.category?.const ?? schema['x-category'] ?? '其他MCP工具';
  // 版本错配告警：带 scope 块但无 category 标记 = 连上了未打标记的旧版 core-backend
  if (scopeProp && !scopeProp.properties?.category) {
    console.warn(`[AgentFactory] 工具 ${tool.name} 带 scope 块但无 category 标记——core-backend 版本过旧，请同步升级`);
  }
  // scope 作用域块一律剥离（规划元数据，非输入参数）；ontology_id 仅对本体工具剥离
  // （发布方标记判定，执行时自动注入，见 entry.scope）。
  const ontoScoped = category === '本体函数' || category === '本体行为';
  const baseProps = { ...(schema.properties || {}) };
  delete baseProps[SCOPE_KEY];
  if (ontoScoped) delete baseProps.ontology_id;
  const entry: MountableToolInfo = {
    name: tool.name,
    category,
    description: tool.description || tool.label || '',
    // 中文显示名：发布方结构化字段（scope.display_name / x-display_name），无则留空由上层兜底
    displayName: scopeProp?.properties?.display_name?.const ?? schema['x-display_name'] ?? undefined,
    // 完整参数结构：类型/必填/描述（本体工具示例拼在描述里，公共函数有 example 字段）
    params: schemaToDeclaredParams({ ...schema, properties: baseProps }),
    // 编译 inputSchema 原文（剥 scope/ontology_id 后）：规划期参数校验（TypeBox）的数据源
    schema: { ...schema, properties: baseProps },
  };
  // 本体行为/函数：scope 块（const 真实值）→ 独立 scope 字段（剔除 category/display_name 标记；
  // name 保留——行为工具可能带 onto{id}__ 前缀，裸名是挂载过滤/disable 闸的匹配键），
  // 父 Agent 填子任务 scenario/ontology 字段用
  if (ontoScoped && scopeProp?.properties) {
    entry.scope = Object.fromEntries(
      Object.entries(scopeProp.properties)
        .filter(([k]) => k !== 'category' && k !== 'display_name')
        .map(([k, v]: [string, any]) => [k, v?.const ?? v?.description ?? null]),
    );
  }
  return entry;
}
