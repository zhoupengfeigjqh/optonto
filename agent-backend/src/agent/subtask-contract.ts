/**
 * 子任务字段契约 —— submit_plan 子任务字段的单一事实源（深 module）。
 *
 * 一张声明表同时生成两个 LLM 可见面：
 *  ① 父 Agent 系统提示词的字段表（prompts.ts 2.2 节）——renderSubtaskFieldTable()
 *  ② submit_plan 工具的 TypeBox schema（agent-factory.createSubmitPlanTool）——subtaskFieldsSchema()
 *
 * 此前两处手写维护，guidance 的必填标记已发生漂移（提示词 ✅ vs schema Optional）；
 * 收拢后新增/修改字段只改这张表，提示词标记与 schema 必填性从机制上不可能再漂移。
 *
 * 字段说明：
 *  - required：schema 必填性（false → Type.Optional）。这是执行现实——runtime 是否容忍缺省。
 *  - marker：提示词"必填"列显示文本（缺省 = required ? '✅' : '❌'）。
 *    behavior/function 互斥对：schema 均 Optional（互斥是跨字段语义，由 execute 硬门判定），
 *    提示词 behavior 标 ✅、function 标 ❌，配合说明文本解释"有且只有一个非空"。
 */
import { Type } from '@sinclair/typebox';
import type { TSchema } from '@sinclair/typebox';

export interface SubtaskField {
  name: string;
  /** schema 必填性：false → Type.Optional（与 runtime 容忍度一致） */
  required: boolean;
  /** TypeBox schema 形状（required=false 时由 subtaskFieldsSchema 自动包 Optional） */
  schema: TSchema;
  /** 提示词"说明"列（markdown 单元格文本，单行） */
  prompt: string;
  /** 提示词"必填"列显示覆盖（仅互斥对等特殊字段用） */
  marker?: '✅' | '❌';
}

// 数值字段放宽为 number|string：TypeBox 不做字符串数字强转，
// 由 submit_plan 的 execute 回调统一规整为 number（规避 LLM 输出 "1" 导致校验失败的场景）
const numLike = (): TSchema => Type.Union([Type.Number(), Type.String()]);

export const SUBTASK_FIELDS: SubtaskField[] = [
  {
    name: 'seq', required: true, schema: numLike(),
    prompt: '执行序号（整数，从小到大）',
  },
  {
    // behavior/function 均为可选键：互斥是跨字段语义，由 execute 硬门判定；
    // 若 schema 强制 behavior 必填，LLM 对函数子任务会本能省略该键（而非填空串），schema 层直接拒绝
    name: 'behavior', required: false, marker: '✅', schema: Type.String(),
    prompt: '业务行为的**英文名**（如 CreatePurchaseRecord），**严禁**使用中文名或描述。与 function 互斥：本子任务是行为时填此字段、function 留空',
  },
  {
    name: 'function', required: false, marker: '❌', schema: Type.String(),
    prompt: '函数/工具的**英文名**（本体函数、公共函数或其他MCP工具，如 sumRawNotArrivalQty，可用 listAllMcpFunctions 查看）。本子任务是函数计算/外部工具调用时填此字段、behavior 填空字符串；二者互斥，有且只有一个非空',
  },
  {
    name: 'params', required: true, schema: Type.Record(Type.String(), Type.Any()),
    prompt: '包含该行为/函数所需的完整参数JSON结构，且每个参数必须有（type/required/description/value）。用户已提供的填入 value；缺失的 value 留空字符串。**类型严格遵守声明**：函数/工具的参数类型以 listAllMcpFunctions 返回的 params 为准、行为参数以 SKILL.md 声明为准，每个参数的 type 字段与 value 实际类型都必须与声明一致（如声明 integer 就必须填数字 30，严禁填字符串 "30"/"三十"；声明 array 就填数组）',
  },
  {
    name: 'description', required: true, schema: Type.String(),
    prompt: '该子任务的中文描述',
  },
  {
    // 统一前提示词标 ✅、schema 标 Optional——以执行现实为准：runtime 容忍缺省（subtask-runner 仅在有值时渲染），
    // 故 required=false；说明文本强调建议填写，保住提示词的引导强度
    name: 'guidance', required: false, schema: Type.String(),
    prompt: '指导说明，帮助子 Agent 理解执行关键逻辑和注意事项（建议始终填写：缺失时子 Agent 仅凭参数与规则执行）',
  },
  {
    name: 'scenario_name', required: true, schema: Type.String(),
    prompt: '所属场景名称',
  },
  {
    name: 'scenario_id', required: true, schema: numLike(),
    prompt: '所属场景 ID',
  },
  {
    name: 'ontology_name', required: true, schema: Type.String(),
    prompt: '所属本体名称',
  },
  {
    name: 'ontology_id', required: true, schema: numLike(),
    prompt: '所属本体 ID',
  },
  {
    name: 'depends_on', required: false, schema: Type.Array(numLike()),
    prompt: '声明依赖的前序子任务 seq 列表',
  },
  {
    name: 'related_functions', required: false, schema: Type.Array(Type.String()),
    prompt: '仅行为子任务可填：本子任务可能用到的函数/MCP 工具**英文名**列表（含公共函数与其他 MCP 工具）。规则已声明的关联函数系统会自动挂载，此处补充规则之外、本子任务计算/统计所需的函数或外部工具；可先调 listAllMcpFunctions 查看可用函数/工具清单。**函数子任务必须为空**（函数子任务是直连调用，无子 Agent，该字段无意义）',
  },
];

/** submit_plan 工具的子任务 schema 属性表：required=false 自动包 Type.Optional */
export function subtaskFieldsSchema(): Record<string, TSchema> {
  return Object.fromEntries(
    SUBTASK_FIELDS.map(f => [f.name, f.required ? f.schema : Type.Optional(f.schema)]),
  );
}

/** 父 Agent 提示词 2.2 节的字段表（markdown）：标记与 schema 必填性同源 */
export function renderSubtaskFieldTable(): string {
  const rows = SUBTASK_FIELDS.map(f => `| ${f.name} | ${f.marker ?? (f.required ? '✅' : '❌')} | ${f.prompt} |`);
  return `| 字段 | 必填 | 说明 |\n| :--- | :---: | :--- |\n${rows.join('\n')}`;
}
