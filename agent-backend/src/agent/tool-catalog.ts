/**
 * 工具目录装配 —— MCP 工具 → 可挂载目录条目的转形知识单点（深 module 的装配侧）。
 *
 * 与发布端的契约（单一权威在 mcp-shared/tool_contract.py 模块 docstring，本文件是其消费实现）：
 *  - **分类标记**：顶层扩展键 `x-category`（五类）+ `x-title`（发布方权威中文名）。
 *    category 不再从 scope 内读取——同一语义只允许一种表达。
 *  - **本体上下文** `x-ontology-scope`：仅「本体执行类」（本体行为 / 本体函数）携带，是
 *    **发布时固化的工具元数据**（ontology_id + 场景/本体真实值），不是参数。它只给平台内部
 *    做归属过滤/挂载/执行校验，**不进 LLM 参数面**（发现期即提升为 `ontologyScope` 字段）。
 *  - **ontology_id**：本体执行类的**必填业务参数**，由调用方（LLM）填写；执行底座用发布声明
 *    校验其一致（agent 不做注入/覆盖——覆盖会掩盖调用方填错的本体）。
 *  - **协议不变式**（不符即发布端与 agent 版本错配 → assertToolProtocol 快速失败，
 *    绝不静默降级为"外部工具"而丢掉本体归属）。
 *
 * 收拢原先三处分散的目录知识：
 *  - MountableToolInfo：目录条目类型（原 agent-ports.ts，与端口定义同居导致概念漂移）
 *  - toMountableToolInfo：发布方标记分类 + 元数据提升 + 参数声明/编译 schema 双投影
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
export const TITLE_KEY = 'x-title';

/** 本体执行类：工具归属某个本体（本体上下文 + ontology_id 必填参数） */
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

/** 本体上下文键（发布时固化在 schema 顶层，**不进 properties**，因此不是可填写参数） */
export const SCOPE_KEY = 'x-ontology-scope';

/** 本体归属（发布时固化的工具元数据）——平台内部判定用，LLM 不可见。工具名即裸名，故不含 name。 */
export interface OntologyScope {
  ontology_id: number | string;
  scenario_id?: number | string;
  scenario_name?: string;
  ontology_name?: string;
}

/** 从发布 schema 读取本体上下文（顶层 `x-ontology-scope`，发布即冻结）。 */
export function readOntologyScope(schema?: any): OntologyScope | undefined {
  const meta = schema?.[SCOPE_KEY];
  if (meta && typeof meta === 'object' && meta.ontology_id !== undefined) {
    return { ...meta } as OntologyScope;
  }
  return undefined;
}

/** 剥掉本体上下文元数据，得到**LLM 可见的**参数 schema（元数据只是顶层键，参数面原样保留）。 */
export function stripOntologyScope(schema?: any): Record<string, any> {
  const out: Record<string, any> = { ...(schema || {}) };
  delete out[SCOPE_KEY];
  return out;
}

/**
 * 协议不变式校验（消费边界单点调用；不符即抛——发布端与 agent 必须同版本部署）：
 *  ① 带本体上下文的工具必须是本体执行类：否则该元数据无人消费，继续按"外部工具"处理会**丢掉本体归属**；
 *  ② 本体执行类必须带本体上下文：否则拿不到 ontology_id，归属过滤/挂载/执行校验都无从谈起。
 */
export function assertToolProtocol(name: string, schema?: any): void {
  const category = publishedCategory(schema);
  const scope = readOntologyScope(schema);
  const hasScopeBlock = !!schema?.[SCOPE_KEY];
  if (hasScopeBlock && !isOntologyExec(category)) {
    throw new Error(
      `[工具协议] ${name} 带本体上下文但 x-category=${category ?? '缺失'}——发布端与 agent 版本不匹配，请同步升级 MCP 服务`);
  }
  if (!scope && isOntologyExec(category)) {
    throw new Error(
      `[工具协议] ${name} 标为「${category}」但缺本体上下文 ${SCOPE_KEY}——发布端与 agent 版本不匹配，请同步升级 MCP 服务`);
  }
}

/** 可挂载工具目录条目（getMountableToolCatalog 返回）。类别见 CATEGORY */
export interface MountableToolInfo {
  name: string;
  category: ToolCategory;
  description: string;
  /** 中文显示名（发布方权威标记 x-title），无则由上层兜底 */
  title?: string;
  /** 参数声明结构（inputSchema 经 schemaToDeclaredParams 转形，已剥离本体元数据；ontology_id 是
   *  本体执行类的必填参数，保留），与子任务 params 填法同形 */
  params: Record<string, any>;
  /** 编译 inputSchema 原文（已剥本体元数据；required 同步剔除被剥键，不留"required 引用未声明键"
   *  的自相矛盾）：规划期参数校验（TypeBox）的数据源 */
  schema?: Record<string, any>;
  /** 本体执行类独有：所属场景/本体真实值——来自发布时固化的 x-ontology-scope，非输入参数 */
  scope?: Record<string, any>;
}

/**
 * 父 Agent 查询工具的**展示名映射**（执行记录用"中文（英文）"格式）。
 * 仅展示用途：成员资格由发布端 x-category=本体查询 决定（见 isQueryTool），
 * 文案与发布端 x-title 保持一致。
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
 * ontology_id 参数的外部工具误判为本体工具。版本错配由 assertToolProtocol 拦。
 *
 * 入参的 `parameters` 通常已在发现期剥掉本体元数据（`ontologyScope` 单独携带）；这里仍兜底
 * 读一次 schema，保证单测/直调也成立。**不再删 ontology_id**：它是本体执行类的必填参数。
 */
export function toMountableToolInfo(tool: {
  name: string; description?: string; label?: string; parameters?: any; ontologyScope?: OntologyScope;
}): MountableToolInfo {
  const raw = tool.parameters || {};
  const category = (publishedCategory(raw) ?? CATEGORY.EXTERNAL) as ToolCategory;
  const ontoExec = isOntologyExec(category);
  const scope = tool.ontologyScope ?? readOntologyScope(raw);
  // 交给规划/校验的 schema 只含参数面：本体元数据剥掉（它不是参数）
  const visibleSchema = stripOntologyScope(raw);
  const entry: MountableToolInfo = {
    name: tool.name,
    category,
    description: tool.description || tool.label || '',
    title: raw[TITLE_KEY] ?? undefined,
    // 完整参数结构：类型/必填/描述（本体工具示例拼在描述里，公共函数有 example 字段）
    params: schemaToDeclaredParams(visibleSchema),
    // 编译 inputSchema 原文：规划期参数校验（TypeBox）的数据源
    schema: visibleSchema,
  };
  // 本体执行类：元数据 → 独立 scope 字段。工具名即行为名/函数名，
  // 故挂载过滤/disable 闸/展示回溯统一用 entry.name。
  if (ontoExec && scope) entry.scope = { ...scope };
  return entry;
}
