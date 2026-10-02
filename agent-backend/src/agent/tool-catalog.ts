/**
 * 工具目录装配 —— MCP 工具 → 可挂载目录条目的转形知识单点（深 module 的装配侧）。
 *
 * 与发布端的契约（单一权威在 mcp-shared/tool_contract.py 模块 docstring，本文件是其消费实现）：
 *  - **分类标记**：顶层扩展键 `x-category`（五类）+ `x-display_name`（发布方权威中文名）。
 *    category 不再从 scope 内读取——同一语义只允许一种表达。
 *  - **本体上下文块** `scope`：仅「本体执行类」（本体行为 / 本体函数）携带，只含上下文键
 *    （name + 场景/本体真实值），承载"该工具是本体的执行入口，调用时必须锁定到该本体"。
 *  - **协议不变式**（不符即发布端与 agent 版本错配 → assertToolProtocol 快速失败，
 *    绝不静默降级为"外部工具"而丢掉本体锁定）。
 *
 * 收拢原先三处分散的目录知识：
 *  - MountableToolInfo：目录条目类型（原 agent-ports.ts，与端口定义同居导致概念漂移）
 *  - toMountableToolInfo：发布方标记分类 + scope/ontology_id 剥离 + 参数声明/编译 schema 双投影
 *  - PARENT_TOOL_LABELS：父 Agent 查询工具的**展示名映射**（仅执行记录展示用；
 *    工具成员资格由 x-category=本体查询 判定，两者不互相推导）
 *
 * 与 FunctionCatalog 的分工：本模块回答"一个 MCP 工具长什么样"（逐条转形，纯函数）；
 * FunctionCatalog 回答"这次 run 有哪些函数/行为可用"（整表快照 + 三源过滤）。
 * schemaToDeclaredParams 留在 services/common-functions.ts：它是 functions.json 读取器
 * 与 agent 层共享的形状转换 kernel（services → agent 反向依赖不可取），本模块单向 import 它。
 */
import { schemaToDeclaredParams } from '../services/common-functions.js';

// ─── 分类标记（与发布端契约同源；值域变更必须两端同步）─────────────────────────────

/** 工具类别（发布方 x-category 标记） */
export const CATEGORY = {
  /** 本体·执行：外部系统集成（走映射翻译 + 下游 MCP） */
  BEHAVIOR: '本体行为',
  /** 本体·执行：本地沙箱（可作判断函数，返回统一信封） */
  FUNCTION: '本体函数',
  /** 元数据查询（父 Agent 专用；不进子任务可规划清单） */
  QUERY: '本体查询',
  /** 全局·执行：本地沙箱 */
  COMMON: '公共函数',
  /** 消费端兜底：无标记的外部 MCP 工具（发布端不使用该值） */
  EXTERNAL: '其他MCP工具',
} as const;
export type ToolCategory = (typeof CATEGORY)[keyof typeof CATEGORY];

/** 分类标记键（JSON Schema 扩展键，协议透传） */
export const CATEGORY_KEY = 'x-category';
export const DISPLAY_NAME_KEY = 'x-display_name';

/** 本体执行类：调用时必须锁定到当前本体（挂载期删 scope/ontology_id，执行期强制注入 ontology_id） */
export function isOntologyExec(category: string | undefined): boolean {
  return category === CATEGORY.BEHAVIOR || category === CATEGORY.FUNCTION;
}

/** 读取发布方分类标记（无标记 = 外部工具，由调用方按 CATEGORY.EXTERNAL 兜底） */
export function publishedCategory(schema?: any): string | undefined {
  return schema?.[CATEGORY_KEY];
}

/** 元数据查询工具（父 Agent 专用，不得下放子 Agent、不进子任务可规划清单） */
export function isQueryTool(schema?: any): boolean {
  return publishedCategory(schema) === CATEGORY.QUERY;
}

/** 本体函数工具 schema 前置的作用域块键（MCP server 在 inputSchema.properties.scope 注入本体上下文）。 */
export const SCOPE_KEY = 'scope';

/**
 * 协议不变式校验（消费边界单点调用；不符即抛——发布端与 agent 必须同版本部署）：
 *  ① 带 scope 块的工具必须是本体执行类：否则该 scope 是旧版形态（分类曾内置在 scope.category），
 *     继续按"外部工具"处理会**丢掉本体锁定**；
 *  ② 本体执行类必须带 scope 块：否则拿不到 scope.name/ontology_id，挂载过滤与锁定都无从谈起。
 */
export function assertToolProtocol(name: string, schema?: any): void {
  const category = publishedCategory(schema);
  const scopeProp = schema?.properties?.[SCOPE_KEY];
  if (scopeProp && !isOntologyExec(category)) {
    throw new Error(
      `[工具协议] ${name} 带 scope 上下文块但 x-category=${category ?? '缺失'}——发布端与 agent 版本不匹配，请同步升级 MCP 服务`);
  }
  if (!scopeProp && isOntologyExec(category)) {
    throw new Error(
      `[工具协议] ${name} 标为「${category}」但缺 scope 上下文块——发布端与 agent 版本不匹配，请同步升级 MCP 服务`);
  }
}

/** 可挂载工具目录条目（getMountableToolCatalog 返回）。类别见 CATEGORY */
export interface MountableToolInfo {
  name: string;
  category: ToolCategory;
  description: string;
  /** 中文显示名（发布方权威标记 x-display_name），无则由上层兜底 */
  displayName?: string;
  /** 参数声明结构（inputSchema 经 schemaToDeclaredParams 转形，已剥离 scope/ontology_id），与子任务 params 填法同形 */
  params: Record<string, any>;
  /** 编译 inputSchema 原文（已剥离 scope；本体执行类已剥 ontology_id；required 同步剔除被剥键，
   *  不留"required 引用未声明键"的自相矛盾）：规划期参数校验（TypeBox）的数据源 */
  schema?: Record<string, any>;
  /** 本体执行类独有：所属场景/本体真实值（name 裸名 + ontology_id/scenario_id/scenario_name/ontology_name） */
  scope?: Record<string, any>;
}

/**
 * 父 Agent 查询工具的**展示名映射**（执行记录用"中文（英文）"格式）。
 * 仅展示用途：成员资格由发布端 x-category=本体查询 决定（见 isQueryTool），
 * 文案与发布端 x-display_name 保持一致。
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
 * 分类唯一依据：发布方 x-category 标记；无标记 = 外部 MCP 工具（排除法）。
 * core/agent 同仓库整栈部署，不设旧启发式兼容层——特征猜测（hasOntologyId）会把碰巧带
 * ontology_id 参数的外部工具误判为本体工具并误删其参数。版本错配由 assertToolProtocol 拦。
 */
export function toMountableToolInfo(tool: { name: string; description?: string; label?: string; parameters?: any }): MountableToolInfo {
  const schema = tool.parameters || {};
  const scopeProp = schema.properties?.[SCOPE_KEY];
  const category = (publishedCategory(schema) ?? CATEGORY.EXTERNAL) as ToolCategory;
  const ontoExec = isOntologyExec(category);
  // scope 上下文块一律剥离（规划元数据，非输入参数）；ontology_id 仅对本体内工具剥离
  //（发布方标记判定，执行时自动注入，见 entry.scope）。
  const baseProps = { ...(schema.properties || {}) };
  delete baseProps[SCOPE_KEY];
  // ontology_id：本体执行类由 harness 强制注入（从可见 schema 剥离）；查询类它是父 Agent 真实填写的参数，保留
  if (ontoExec) delete baseProps.ontology_id;
  // required 同步剔除已剥键：properties 里不存在的键不该留在 required——否则对外 schema 自相矛盾
  //（required 引用了没有声明的键）。消费端 param-contract 本就防御性跳过，这里让形状本身自洽，
  // 也顺带消除"LLM 照 required 填出 ontology_id/scope 污染子任务 params"的可能。
  const visibleSchema: Record<string, any> = { ...schema, properties: baseProps };
  if (Array.isArray(schema.required)) {
    visibleSchema.required = schema.required
      .map(String)
      .filter((k: string) => Object.prototype.hasOwnProperty.call(baseProps, k));
  }
  const entry: MountableToolInfo = {
    name: tool.name,
    category,
    description: tool.description || tool.label || '',
    displayName: schema[DISPLAY_NAME_KEY] ?? undefined,
    // 完整参数结构：类型/必填/描述（本体工具示例拼在描述里，公共函数有 example 字段）
    params: schemaToDeclaredParams(visibleSchema),
    // 编译 inputSchema 原文（剥 scope/ontology_id + required 同步剔除后）：规划期参数校验（TypeBox）的数据源
    schema: visibleSchema,
  };
  // 本体执行类：scope 块（const 真实值）→ 独立 scope 字段，
  // name 保留——工具名即行为名/函数名，scope.name 是挂载过滤 / disable 闸 / 展示回溯的统一匹配键
  // （父 Agent 填子任务 scenario/ontology 字段用）
  if (ontoExec && scopeProp?.properties) {
    entry.scope = Object.fromEntries(
      Object.entries(scopeProp.properties)
        .map(([k, v]: [string, any]) => [k, v?.const ?? v?.description ?? null]),
    );
  }
  return entry;
}
