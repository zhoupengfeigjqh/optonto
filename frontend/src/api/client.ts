/**
 * API client for OPTONTO backend —— 领域模块聚合出口（barrel）。
 *
 * 章程 I 要求单文件 ≤500 行：原 625 行的 `client.ts` 已按领域拆分为
 * `http` / `scenarios` / `ontologies` / `design` / `data-engines` / `threads` / `deploy` / `skills` / `mcp`，
 * 本文件仅做再导出，**既有 `from '@/api/client'` 的导入路径与符号保持不变**。
 *
 * 新增接口时：写到对应领域模块，无需改动本文件。
 */

export * from './http';
export * from './scenarios';
export * from './ontologies';
export * from './design';
export * from './data-engines';
export * from './threads';
export * from './deploy';
export * from './skills';
export * from './mcp';
