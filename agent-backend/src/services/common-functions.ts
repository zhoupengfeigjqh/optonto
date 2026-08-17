import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.js';

/**
 * 运行时读取公共函数定义（.data/common_functions/functions.json，与 core-backend 同一份数据源）。
 * 返回函数名数组。文件缺失/解析失败时返回空数组（此时 core-backend 也不会注册这些工具，白名单空是自洽的）。
 * 单一事实源：AgentFactory（list_mcp_tools 分类 / 子 Agent 挂载）与 OntologyGateway（函数子任务名校验）共用。
 */
function loadCommonFunctionNames(): string[] {
  const file = join(config.dataDir, 'common_functions', 'functions.json');
  try {
    if (!existsSync(file)) {
      console.warn(`[CommonFunctions] 未找到 ${file}，公共函数列表为空`);
      return [];
    }
    const raw: unknown = JSON.parse(readFileSync(file, 'utf-8'));
    if (!Array.isArray(raw)) throw new Error('顶层应为数组');
    return raw
      .map((f: any) => (f && typeof f.name === 'string' ? f.name : ''))
      .filter((n: string) => n.length > 0);
  } catch (e: any) {
    console.warn(`[CommonFunctions] 读取 ${file} 失败: ${e.message}，公共函数列表为空`);
    return [];
  }
}

/** 运行时读出的公共函数名（子/父 Agent 共用同一数据源，新增/改名公共函数无需改代码）。 */
export const COMMON_FUNCTION_NAMES = loadCommonFunctionNames();
