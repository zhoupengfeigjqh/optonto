import { readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.js';

/** 公共函数定义（.data/common_functions/functions.json 单条，含参数声明 inputSchema）。 */
export interface CommonFunction {
  name: string;
  display_name?: string;
  description?: string;
  /** 标准 JSON Schema：{type, properties, required:[数组]}，与本体函数"内联 required:boolean"的源形式不同 */
  inputSchema?: { type: string; properties?: Record<string, any>; required?: string[] };
}

/**
 * 把公共函数的 inputSchema（标准 JSON Schema）转换为与本体函数 params 一致的声明形状
 * {k: {type, required:boolean, ...}}，让 validateParamStructure 统一校验本体函数与公共函数。
 * 转换规则是 params_to_input_schema 的逆过程：
 * - 顶层 required:[数组] → 每个参数的 required:boolean（本体函数源形式即内联布尔）
 * - array 参数：items 递归还原为 {type:"object", properties, required:[数组]}（内层 required 保留数组，同本体函数 items 写法）
 * - object 参数：properties 递归
 * 注意：validateParamStructure 当前只消费顶层 required+type；嵌套结构还原仅为保持与本体函数 params 形状一致、便于未来深化校验。
 */
export function schemaToDeclaredParams(schema: any): Record<string, any> {
  const out: Record<string, any> = {};
  const requiredSet = new Set<string>((schema?.required || []).map(String));
  // JSON Schema 结构不透明，props 显式声明为 Record<string, any>，避免 Object.entries 把元素推断成 object
  const props: Record<string, any> = (schema?.properties || {}) as Record<string, any>;
  for (const [k, v] of Object.entries(props)) {
    if (!v || typeof v !== 'object') continue;
    const spec: Record<string, any> = { type: v.type };
    if (typeof v.description === 'string' && v.description) spec.description = v.description;
    if (v.example !== undefined && v.example !== '') spec.example = v.example;
    if (v.type === 'array' && v.items && typeof v.items === 'object') {
      spec.items = { type: v.items.type };
      if (v.items.properties && typeof v.items.properties === 'object') {
        spec.items.properties = schemaToDeclaredParams(v.items);
      }
      if (Array.isArray(v.items.required)) spec.items.required = [...v.items.required];
    } else if (v.type === 'object' && v.properties && typeof v.properties === 'object') {
      spec.properties = schemaToDeclaredParams(v);
    }
    spec.required = requiredSet.has(k);
    out[k] = spec;
  }
  return out;
}

/**
 * 读取公共函数定义（.data/common_functions/functions.json，与 core-backend 同一份数据源）。
 * mtime 缓存：文件变化自动重读，与 OntologyGateway 的 ontology.yaml 缓存语义一致——
 * 此前 import 期冻结（COMMON_FUNCTIONS 常量），改 functions.json 必须重启进程，与网关热加载不一致。
 * 文件缺失/解析失败时返回空数组（此时 core-backend 也不会注册这些工具，白名单空是自洽的）。
 * 单一事实源：AgentFactory（listAllMcpFunctions 目录分类 / 子 Agent 挂载）、OntologyGateway（函数子任务名校验 / 参数结构校验）共用。
 */
let cache: { data: CommonFunction[]; mtimeMs: number } | null = null;

function loadCommonFunctions(): CommonFunction[] {
  const file = join(config.dataDir, 'common_functions', 'functions.json');
  try {
    if (!existsSync(file)) {
      if (!cache) console.warn(`[CommonFunctions] 未找到 ${file}，公共函数列表为空`);
      cache = null; // 文件被删除也要失效旧缓存
      return [];
    }
    const mtimeMs = statSync(file).mtimeMs;
    if (cache && cache.mtimeMs === mtimeMs) return cache.data;
    const raw: unknown = JSON.parse(readFileSync(file, 'utf-8'));
    if (!Array.isArray(raw)) throw new Error('顶层应为数组');
    const data = raw.filter((f): f is CommonFunction => !!f && typeof f === 'object');
    cache = { data, mtimeMs };
    return data;
  } catch (e: any) {
    console.warn(`[CommonFunctions] 读取 ${file} 失败: ${e.message}`);
    return cache?.data ?? []; // 解析失败时沿用上一份成功快照，避免一次写坏文件清空全部白名单
  }
}

/** 公共函数定义（惰性加载 + mtime 缓存；子/父 Agent 共用同一数据源，新增/改名公共函数无需改代码、无需重启）。 */
export function getCommonFunctions(): CommonFunction[] {
  return loadCommonFunctions();
}

/** 公共函数名（AgentFactory 工具分类 / 子 Agent 挂载、OntologyGateway 函数子任务名校验共用）。 */
export function getCommonFunctionNames(): string[] {
  return loadCommonFunctions().map(f => f.name);
}

/**
 * 取公共函数的参数结构（inputSchema 经 schemaToDeclaredParams 转成与本体函数 params 同形的声明形状）。
 * 函数不在 functions.json 或未声明 inputSchema → 返回 null（"无声明"语义，与 getFunctionParams 的 null 分支一致）。
 */
export function getCommonFunctionParams(functionName: string): Record<string, any> | null {
  const fn = loadCommonFunctions().find(f => f.name === functionName);
  if (!fn || !fn.inputSchema || typeof fn.inputSchema !== 'object') return null;
  return schemaToDeclaredParams(fn.inputSchema);
}

/**
 * 取公共函数的展示元信息（中文显示名 + 描述），工具调用展示用。
 * 函数不在 functions.json → 返回空（让上层用子任务描述兜底，与 getFunctionMeta 语义一致）。
 */
export function getCommonFunctionMeta(functionName: string): { display_name: string; description?: string } {
  const fn = loadCommonFunctions().find(f => f.name === functionName);
  return {
    display_name: fn?.display_name || fn?.description || '',
    description: fn?.description,
  };
}
