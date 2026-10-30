/**
 * AgentFactory 单元测试。
 *
 * 覆盖：createParentAgent 历史映射（summary → assistant +【历史摘要】前缀）、
 * submit_plan 互斥门与键省略容忍、父/子 Agent 工具职责边界（2026-09 行为工具化后：
 * 本体行为是一等 MCP 工具，子 Agent 按 legalCalls.behaviors（工具名即行为裸名）挂载，
 * 挂载期过滤即白名单）、子 Agent 三道安全闸（闸1 disable / 闸2 前置规则留痕 /
 * 闸2.5 判断函数）、toMountableToolInfo 发布方标记分类。
 *
 * 2026-10-06 说明：本文件超宪法 II 的 500 行上限，曾尝试按关注点拆分，
 * 但**拆分在技术上不干净**——`mcpCalls` 等 vi.hoisted 变量无法跨模块导出
 * （"Cannot export hoisted variable"），而 vi.mock 工厂必须与它在同一文件。
 * 强行拆分的唯一办法是把 180 行 mock 装配复制 2-3 份，而 mock 漏改会**静默失效**
 * （测试照跑、断言作用在错误替身上），代价高于收益。故保留单文件并在此记录原因。
 * 若将来要拆，前置条件是先把这套 vi.mock 替身改造成依赖注入。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Agent } from '@earendil-works/pi-agent-core';
import { assertToolProtocol, toMountableToolInfo } from './tool-catalog.js';
import { AgentFactory } from './agent-factory.js';
import { MCPConfigStore } from '../services/mcp-config-store.js';
import { SkillLoader } from '../services/skill-loader.js';
import { createSecurityGate } from './security-policy.js';
import type { ChildSecurityCtx } from './security-policy.js';
import { createToolErrorBudget } from './error-budget.js';
import type { SubtaskPolicy, RuleGate, LegalCalls } from './execution-policy.js';
import type { ThreadMessage, ConversationScope } from '../types.js';
vi.mock('@earendil-works/pi-agent-core', () => ({ Agent: vi.fn() }));

/** MCP callTool 调用记录（验证参数原样透传：agent 不再注入/覆盖 ontology_id）；
 *  responses 可按工具名注入自定义返回（闸2.5 判断用例：信封 data.pass=false） */
const mcpCalls = vi.hoisted(() => ({
  list: [] as { name: string; args: any }[],
  responses: {} as Record<string, (name: string, args: any) => any>,
}));

// MCP 配置：一个启用的内置本体 MCP server（供 discoverTools 发现工具）
vi.mock('../services/mcp-config-store.js', () => ({
  MCPConfigStore: class { getConfig() { return { servers: [{ name: '本体MCP', url: 'http://mcp-test/sse', enabled: true, builtin: true }] }; } },
  // 业务数据闸判定（真实实现的同口径：严格 === true，缺省=否）。本装配的服务均未声明该字段 → 闸不生效
  isBusinessDataServer: (s: any) => s?.business_data === true,
}));

/**
 * 发布形态 schema 构造（与 mcp-shared/tool_contract.py 契约一致）：
 * 分类标记 = 顶层 x-category / x-title；本体上下文 = 顶层 x-ontology-scope（元数据，非参数）；
 * ontology_id 是必填业务参数（由 LLM 填写）。
 */
function ontoTool(category: string, _bareName: string, title: string, ontologyId: number,
                ontologyName: string, props: Record<string, any>, required: string[]) {
  return { type: 'object',
    'x-category': category,
    'x-title': title,
    'x-ontology-scope': {
      ontology_id: ontologyId, scenario_id: 1,
      scenario_name: '生产调度', ontology_name: ontologyName,
    },
    properties: {
      ontology_id: { type: 'integer' },
      ...props,
    },
    required };
}

/** 元数据查询工具（父 Agent 专用；x-category=本体查询） */
function queryTool(title: string, props: Record<string, any> = {}) {
  return { type: 'object',
    'x-category': '本体查询',
    'x-title': title,
    properties: { ontology_id: { type: 'integer' }, ...props },
    required: ['ontology_id'] };
}
// MCPClient 假实现：listTools 返回混合工具集（本体行为工具 + 本体函数 + 本体查询 + 公共函数 + 外部工具）。
// 不连真实网络——discoverTools 会 new MCPClient(url) 并 connect/listTools。
vi.mock('../services/mcp-client.js', () => ({
  MCPClient: class {
    async connect() {}
    async close() {}
    async listTools() {
      return { tools: [
        // 本体行为工具（工具名即行为名；编译 inputSchema 含约束）
        { name: 'CreatePurchaseRecord', description: '创建采购记录',
          inputSchema: ontoTool('本体行为', 'CreatePurchaseRecord', '创建采购记录', 1, '原材料采购和库存',
            { rawMaterialId: { type: 'string', minLength: 1 }, qty: { type: 'integer', minimum: 1, maximum: 100 } },
            ['ontology_id', 'rawMaterialId']) },
        { name: 'QuerySupplier', description: '查询供应商',
          inputSchema: ontoTool('本体行为', 'QuerySupplier', '查询供应商', 1, '原材料采购和库存',
            { supplierName: { type: 'string' } }, ['ontology_id']) },
        // 另一本体的行为（不在合法集合 → 不挂载）
        { name: 'DeleteInventory', description: '删除库存',
          inputSchema: ontoTool('本体行为', 'DeleteInventory', '删除库存', 2, '订单排程', {}, ['ontology_id']) },
        // 本体函数
        { name: 'calcSafetyStock', description: '计算安全库存',
          inputSchema: ontoTool('本体函数', 'calcSafetyStock', '计算安全库存', 1, '原材料采购和库存',
            { currentStock: { type: 'number' }, safetyStock: { type: 'number' } }, ['ontology_id']) },
        { name: 'sumRawNotArrivalQty', description: '未到位数求和',
          inputSchema: ontoTool('本体函数', 'sumRawNotArrivalQty', '未到位数求和', 2, '订单排程',
            { purchaseRecordSet: { type: 'array' } }, ['ontology_id']) },
        // 本体查询工具（父 Agent 专属）
        { name: 'listOntoBehaviors', description: '列出本体行为', inputSchema: queryTool('查询行为清单') },
        { name: 'listOntoFunctions', description: '列出本体函数（元数据查询）',
          inputSchema: queryTool('查询函数清单', { keyword: { type: 'string' } }) },
        { name: 'listOntoProcesses', description: '列出本体业务流程', inputSchema: queryTool('查询流程清单') },
        // 公共函数（x-category 扩展键标记）
        { name: 'getCurrentDate', description: '当前日期', inputSchema: { type: 'object', properties: {}, 'x-category': '公共函数', 'x-title': '当前日期' } },
        // 外部 MCP 工具（无标记，排除法归类）
        { name: 'weatherQuery', description: '外部天气查询', inputSchema: { type: 'object', properties: { city: { type: 'string' } } } },
      ] };
    }
    async callTool(name: string, args: any) {
      mcpCalls.list.push({ name, args });
      const override = mcpCalls.responses[name];
      if (override) return override(name, args);
      return { content: [{ type: 'text', text: '{"ok":true}' }], isError: false };
    }
  },
}));

// SkillLoader 只用到 getSkillDescriptions（tools 的 execute 不在此路径触发）
vi.mock('../services/skill-loader.js', () => ({
  SkillLoader: class {
    getSkillDescriptions() { return []; }
  },
}));

// 模型解析：返回假模型，避免真实解析
vi.mock('../services/llm.js', () => ({
  resolveDeepSeekModel: () => ({ id: 'deepseek-v4-flash', provider: 'deepseek' }),
}));

const mockedAgent = vi.mocked(Agent);

/**
 * 捕获到的 Agent 构造配置（**测试边界的一次性类型收敛**，2026-10-05）。
 *
 * pi-agent-core 的 `Agent` 构造参数里 `initialState` / `transformContext` 等在 SDK 类型上
 * 大量是可选的，而 AgentFactory 必定传全；直接 `mockedAgent.mock.calls[0][0].initialState.x`
 * 会在每个调用处重复触发 "possibly undefined"。这里统一收敛为 `any`，
 * 调用处不再散落非空断言——**一处收敛，噪声归零**。
 */
function capturedConfig(): any {
  return mockedAgent.mock.calls[0][0];
}
/** 捕获的 Agent 初始状态（tools / systemPrompt 等） */
function capturedState(): any {
  return capturedConfig().initialState;
}
/** 捕获的工具清单（测试按工具名检索，统一 any[] 免去逐处断言） */
function capturedTools(): any[] {
  return capturedState().tools as any[];
}
/** transformContext 的产物：测试按「有 role/content 字段」的消息形态访问 */
type CapturedMsg = { role: string; content: any };

/** 测试对话作用域：本体 1（允许集 = {1}） */
const SCOPE: ConversationScope = {
  contexts: [{ scenario_name: '生产调度', scenario_id: 1, ontology_name: '原材料采购和库存', ontology_id: 1 }],
  skills: [],
};
/** 通用问答模式（零本体） */
const GENERAL: ConversationScope = { contexts: [], skills: [] };

function mkHistory(): ThreadMessage[] {
  const t = (n: number) => new Date(Date.now() - (5 - n) * 60_000).toISOString();
  return [
    { role: 'summary', content: '用户确认采购高强度钢板 0.1 吨，供应商宝钢，尚未下单。', timestamp: t(1) },
    { role: 'user', content: '请帮我查一下库存', timestamp: t(2) },
    { role: 'assistant', content: '好的，我来查询。', timestamp: t(3) },
    { role: 'toolResult', content: '{inventory: 5}', timestamp: t(4) },
  ];
}
/** 造一个工厂实例（依赖均为上述 mock 替身，不触真实磁盘/网络/LLM） */
function mkFactory(): AgentFactory {
  return new AgentFactory(new MCPConfigStore('' as any) as any, new SkillLoader({} as any) as any);
}

export async function captureTransformContext(): Promise<{ config: any; transformed: CapturedMsg[] }> {
  const factory = mkFactory();
  await factory.createParentAgent(SCOPE, mkHistory(), () => {});
  expect(mockedAgent).toHaveBeenCalledTimes(1);
  const config = capturedConfig();
  const transformed = (await config.transformContext([])) as CapturedMsg[];
  return { config, transformed };
}

/**
 * 捕获子 Agent 配置中的工具列表（createChildAgent → discoverTools → guardExecution）。
 * 走公开路径而非直接调私有 guardExecution，保证测试覆盖的是真实装配链路。
 * policy 完整策略对象直造（生产路径由 buildSubtaskPolicy 派生；工厂只消费不派生）：
 * legalCalls 默认含主行为 + 一个规则关联行为 + 关联函数。
 */
function mkPolicy(over?: { legalCalls?: LegalCalls; security?: ChildSecurityCtx; ruleGate?: RuleGate }): SubtaskPolicy {
  return {
    legalCalls: over?.legalCalls ?? { behaviors: ['CreatePurchaseRecord', 'QuerySupplier'], functions: ['calcSafetyStock', 'getCurrentDate'] },
    errorBudget: createToolErrorBudget(),
    security: over?.security ?? { disabled: new Map<string, string>(), gate: createSecurityGate() },
    ruleGate: over?.ruleGate ?? { mainBehavior: 'CreatePurchaseRecord', pre: [], post: [], succeeded: new Set(), verdicts: new Map() },
  };
}

async function captureChildTools(legalCalls?: LegalCalls, security?: ChildSecurityCtx, ruleGate?: RuleGate) {
  const factory = new AgentFactory(new MCPConfigStore('' as any) as any, new SkillLoader({} as any) as any);
  await factory.createChildAgent(
    { scenario_name: '生产调度', scenario_id: 1, ontology_name: '原材料采购和库存', ontology_id: 1 },
    mkPolicy({ legalCalls, security, ruleGate }),
  );
  expect(mockedAgent).toHaveBeenCalledTimes(1);
  return capturedTools();
}

/**
 * 捕获父 Agent 工具列表（createParentAgent → discoverTools → PARENT_ONTOLOGY_QUERY_TOOLS 白名单过滤）。
 * 走公开路径，验证父 Agent 从机制上不挂执行工具（工具职责边界）。
 */
async function captureParentTools() {
  const factory = new AgentFactory(new MCPConfigStore('' as any) as any, new SkillLoader({} as any) as any);
  await factory.createParentAgent(SCOPE, [], () => {});
  expect(mockedAgent).toHaveBeenCalledTimes(1);
  return capturedTools();
}

/**
 * 取消息纯文本：assistant 形态的 content 是块数组 `[{ type:'text', text }]`，
 * user 形态是裸字符串——两种都要能读（这是本组用例最容易写错的地方）。
 */
function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((c: any) => c?.text ?? '').join('');
  return '';
}

describe('AgentFactory.createParentAgent 历史映射', () => {
  beforeEach(() => mockedAgent.mockClear());

  it('summary → assistant 角色并加【历史摘要】前缀（避免模型当成自己上一轮真实发言）', async () => {
    const { transformed } = await captureTransformContext();
    //summary 已被改写为 assistant，故只能在 assistant 里找带前缀的那条
    const prefixed = transformed
      .filter(m => m.role === 'assistant')
      .map(m => textOf(m.content))
      .filter(t => t.startsWith('【历史摘要】'));
    expect(prefixed).toHaveLength(1);
    expect(prefixed[0]).toContain('高强度钢板');
  });

  it('不残留 summary 角色（下游只按 assistant/user 消费）', async () => {
    const { transformed } = await captureTransformContext();
    expect(transformed.some(m => m.role === 'summary')).toBe(false);
  });

  it('user 消息保持 user 角色且 content 为裸字符串（只有 assistant 走块数组）', async () => {
    const { transformed } = await captureTransformContext();
    const users = transformed.filter(m => m.role === 'user');
    expect(users).toHaveLength(1);
    expect(users[0].content).toBe('请帮我查一下库存');
    expect(typeof users[0].content).toBe('string');
  });

  it('toolResult 也映射为 assistant（toHistoryMessages 只对 user 特判，其余一律 assistant）', async () => {
    // 这条固化的是**真实行为**而非期望：工具返回与历史摘要同归assistant，
    // 上下文里不再有 toolResult 角色。若将来要保留该角色，此用例会提醒同步更新实现。
    const { transformed } = await captureTransformContext();
    expect(transformed.some(m => m.role === 'toolResult')).toBe(false);
    expect(transformed.map(m => textOf(m.content)).join('')).toContain('{inventory: 5}');
  });

  it('transformContext = 历史 + 本轮消息拼接（历史在前）', async () => {
    const { config, transformed } = await captureTransformContext();
    // 本轮传入空消息数组 → 结果应恰好等于历史条数（拼接而非替换）
    expect(transformed).toHaveLength(mkHistory().length);
    // 拼接而非替换：历史里user 与 assistant 都还在
    expect(transformed.some(m => m.role === 'user')).toBe(true);
    expect(transformed.some(m => m.role === 'assistant')).toBe(true);
  });

  it('本轮消息追加在历史之后（顺序即上下文顺序，不可倒置）', async () => {
    const { config } = await captureTransformContext();
    const real = config.transformContext as (m: unknown[]) => Promise<CapturedMsg[]>;
    const current = { role: 'user', content: '本轮提问', timestamp: Date.now() };
    const merged = await real([current] as any);
    // 末位是本轮消息；前面紧邻的是历史最后一条（toolResult→assistant）
    expect(merged).toHaveLength(mkHistory().length + 1);
    expect(textOf(merged[merged.length - 1].content)).toBe('本轮提问');
    expect(textOf(merged[merged.length - 2].content)).toContain('{inventory: 5}');
  });
});

describe('AgentFactory.submit_plan 互斥门与键省略容忍', () => {
  beforeEach(() => mockedAgent.mockClear());

  const baseSub = () => ({
    seq: 1, params: {}, description: 'd', guidance: 'g',
    scenario_name: '生产调度', scenario_id: 1, ontology_name: '原材料采购和库存', ontology_id: 1,
  });

  it('schema 层不再强制 behavior 键（LLM 对函数子任务本能省略该键，不应在 schema 层被拒）', async () => {
    const tool = (await captureParentTools()).find(t => t.name === 'submit_plan');
    const required: string[] = (tool.parameters as any).properties.subtasks.items.required ?? [];
    expect(required).not.toContain('behavior');
    expect(required).not.toContain('function');
  });

  it('函数子任务省略 behavior 键 → 正常提交，behavior 规整为空串', async () => {
    let received: any = null;
    const factory = new AgentFactory(new MCPConfigStore('' as any) as any, new SkillLoader({} as any) as any);
    await factory.createParentAgent(SCOPE, [], () => {}, (plan) => { received = plan; });
    const sp = capturedTools().find(t => t.name === 'submit_plan');
    const sub = { ...baseSub(), function: 'sumRawNotArrivalQty' }; // 无 behavior 键
    const res = await sp.execute('c1', { subtasks: [sub] });
    expect(res.details.submitted).toBe(true);
    expect(received.subtasks[0].behavior).toBe('');
    expect(received.subtasks[0].function).toBe('sumRawNotArrivalQty');
  });

  it('behavior/function 都省略 → 互斥门抛错（语义校验在 execute，不依赖 schema）', async () => {
    const tool = (await captureParentTools()).find(t => t.name === 'submit_plan');
    await expect(tool.execute('c2', { subtasks: [baseSub()] }))
      .rejects.toThrow('必须且只能填写 behavior 或 function 之一');
  });

  it('behavior 填纯空白串 + function 正常 → 空白规整为空串，按函数子任务放行（下游裸真值判别不再被骗）', async () => {
    const tool = (await captureParentTools()).find(t => t.name === 'submit_plan');
    const plan: any = { subtasks: [{ ...baseSub(), behavior: '  ', function: 'sumRawNotArrivalQty' }] };
    const res = await tool.execute('c3', plan);
    expect(res.details.submitted).toBe(true);
    expect(plan.subtasks[0].behavior).toBe(''); // 规整已回写
  });

  it('函数子任务填了 related_functions → 硬门抛错（该字段仅用于行为子任务）', async () => {
    const tool = (await captureParentTools()).find(t => t.name === 'submit_plan');
    await expect(tool.execute('c4', { subtasks: [{ ...baseSub(), function: 'sumRawNotArrivalQty', related_functions: ['getCurrentDate'] }] }))
      .rejects.toThrow('related_functions 必须为空');
  });

  it('行为子任务可填可不填 related_functions → 均放行；填了则规整回写（剔除空白项）', async () => {
    const tool = (await captureParentTools()).find(t => t.name === 'submit_plan');
    // 不填 → 放行
    const res1 = await tool.execute('c5', { subtasks: [{ ...baseSub(), behavior: 'CreatePurchaseRecord' }] });
    expect(res1.details.submitted).toBe(true);
    // 填了（含空白项）→ 放行且规整
    const plan: any = { subtasks: [{ ...baseSub(), behavior: 'CreatePurchaseRecord', related_functions: ['getCurrentDate', ' '] }] };
    const res2 = await tool.execute('c6', plan);
    expect(res2.details.submitted).toBe(true);
    expect(plan.subtasks[0].related_functions).toEqual(['getCurrentDate']);
  });

  it('函数子任务 related_functions 缺省或空数组 → 放行（规整后为空视同未填）', async () => {
    const tool = (await captureParentTools()).find(t => t.name === 'submit_plan');
    const res1 = await tool.execute('c7', { subtasks: [{ ...baseSub(), function: 'sumRawNotArrivalQty' }] });
    expect(res1.details.submitted).toBe(true);
    const res2 = await tool.execute('c8', { subtasks: [{ ...baseSub(), function: 'sumRawNotArrivalQty', related_functions: ['  '] }] });
    expect(res2.details.submitted).toBe(true);
  });
});

describe('AgentFactory 父 Agent 工具职责边界', () => {
  beforeEach(() => mockedAgent.mockClear());

  it('父 Agent 挂 load_skill 与 submit_plan', async () => {
    const names = (await captureParentTools()).map(t => t.name);
    expect(names).toContain('load_skill');
    expect(names).toContain('submit_plan');
  });

  it('父 Agent system prompt 含本次对话本体范围列表（scenario/ontology 四元组 + 硬约束标注）', async () => {
    const factory = new AgentFactory(new MCPConfigStore('' as any) as any, new SkillLoader({} as any) as any);
    await factory.createParentAgent(SCOPE, mkHistory(), () => {});
    const prompt = capturedConfig().initialState.systemPrompt as string;
    expect(prompt).toContain('## 本次对话本体范围');
    expect(prompt).toContain('场景：生产调度（scenario_id=1）｜本体：原材料采购和库存（ontology_id=1）');
  });

  it('通用问答模式（未选本体）→ 零业务工具，prompt 声明无业务能力', async () => {
    const factory = new AgentFactory(new MCPConfigStore('' as any) as any, new SkillLoader({} as any) as any);
    await factory.createParentAgent(GENERAL, mkHistory(), () => {});
    const state = capturedState();
    expect(state.tools).toEqual([]); // load_skill / submit_plan / list* 一律不挂
    expect(state.systemPrompt).toContain('未关联任何业务本体');
  });

  it('list* 工具本体范围硬闸：范围外 ontology_id 直接报错，范围内透传执行', async () => {
    mcpCalls.list.length = 0;
    const tools = await captureParentTools();
    const tool = tools.find(t => t.name === 'listOntoBehaviors');
    // 范围外（ontology_id=2）→ 抛错（LLM 自纠），真实 MCP 调用零发生
    await expect(tool.execute('q1', { ontology_id: 2 })).rejects.toThrow('不在本次对话的本体范围内');
    expect(mcpCalls.list).toHaveLength(0);
    // 范围内（ontology_id=1）→ 透传执行
    await tool.execute('q2', { ontology_id: 1 });
    expect(mcpCalls.list).toEqual([{ name: 'listOntoBehaviors', args: { ontology_id: 1 } }]);
  });

  it('父 Agent 挂只读 listPlannableFunctions：函数/工具三类清单（本体行为不在其列——行为规划走 listOntoBehaviors）', async () => {
    const tools = await captureParentTools();
    const tool = tools.find(t => t.name === 'listPlannableFunctions');
    expect(tool).toBeTruthy();
    const result = await tool.execute('call-list', {});
    const parsed = JSON.parse(result.content[0].text);
    const names = parsed.map((t: any) => t.name);
    expect(names).toContain('weatherQuery'); // 其他 MCP 工具可见（可规划为函数子任务 / related_functions）
    expect(names).toContain('calcSafetyStock'); // 范围内本体函数可见
    expect(names).toContain('getCurrentDate'); // 公共函数可见（全局工具）
    expect(names).not.toContain('sumRawNotArrivalQty'); // 范围外本体（oid=2）的函数被硬过滤
    expect(names).not.toContain('CreatePurchaseRecord'); // 本体行为不进函数清单（规划走 listOntoBehaviors）
    expect(names).not.toContain('QuerySupplier');
    expect(names).not.toContain('listOntoBehaviors'); // 本体浏览不属可规划域
    expect(names).not.toContain('listOntoFunctions'); // MCP 版函数元数据查询工具不属可规划域（与本地清单工具共存不串扰）
    expect(names).not.toContain('executeOntoBehavior'); // 分发器已彻底退役
    // 分类正确
    const byName = Object.fromEntries(parsed.map((t: any) => [t.name, t]));
    expect(byName['calcSafetyStock'].category).toBe('本体函数');
    expect(byName['getCurrentDate'].category).toBe('公共函数');
    expect(byName['weatherQuery'].category).toBe('其他MCP工具');
    // 完整参数结构（type/required/description/example）
    expect(byName['getCurrentDate'].params).toEqual({});
    expect(byName['weatherQuery'].params).toEqual({ city: { type: 'string', required: false } });
    // 本体函数：本体元数据不进参数面；ontology_id 是必填参数（由调用方填写）
    expect(byName['calcSafetyStock'].params.ontology_id).toMatchObject({ type: 'integer', required: true });
    expect(byName['calcSafetyStock'].params.currentStock).toEqual({ type: 'number', required: false });
    expect(byName['calcSafetyStock'].params.safetyStock).toEqual({ type: 'number', required: false });
    expect(byName['calcSafetyStock'].params.scope).toBeUndefined();
    // 归属元数据另附（父 Agent 填子任务场景/本体字段用），且不含冗余的 name（工具名即裸名）
    expect(byName['calcSafetyStock'].scope).toEqual({
      ontology_id: 1, scenario_id: 1, scenario_name: '生产调度', ontology_name: '原材料采购和库存',
    });
    expect(byName['weatherQuery'].scope).toBeUndefined(); // 非本体函数无 scope
  });

  it('listPlannableFunctions 按 ontology_id 过滤：只滤本体函数（按 scope 匹配），全局工具（公共/其他MCP）保留；范围外本体直接报错', async () => {
    const tools = await captureParentTools();
    const tool = tools.find(t => t.name === 'listPlannableFunctions');
    const parsed = JSON.parse((await tool.execute('call-f1', { ontology_id: 1 })).content[0].text);
    const names = parsed.map((t: any) => t.name);
    expect(names).toContain('calcSafetyStock'); // scope.ontology_id=1 命中
    expect(names).not.toContain('sumRawNotArrivalQty'); // 本体函数但无匹配 scope → 被过滤
    expect(names).toContain('getCurrentDate'); // 公共函数是全局工具，保留
    expect(names).toContain('weatherQuery'); // 其他MCP工具是全局工具，保留
    // 范围外本体：不静默返空，直接报错（避免 LLM 误判"该本体无函数"）
    await expect(tool.execute('call-f1b', { ontology_id: 2 })).rejects.toThrow('不在本次对话的本体范围内');
  });

  it('listPlannableFunctions 按 keyword 过滤：模糊匹配名称/描述（大小写不敏感）', async () => {
    const tools = await captureParentTools();
    const tool = tools.find(t => t.name === 'listPlannableFunctions');
    const byKw = JSON.parse((await tool.execute('call-f2', { keyword: 'WEATHER' })).content[0].text);
    expect(byKw.map((t: any) => t.name)).toEqual(['weatherQuery']);
    const byDesc = JSON.parse((await tool.execute('call-f3', { keyword: '安全库存' })).content[0].text);
    expect(byDesc.map((t: any) => t.name)).toEqual(['calcSafetyStock']);
  });

  it('listPlannableFunctions 双过滤为与关系；ontology_id 接受字符串数字', async () => {
    const tools = await captureParentTools();
    const tool = tools.find(t => t.name === 'listPlannableFunctions');
    // ontology_id='1'（字符串）AND keyword='库存' → 只剩 calcSafetyStock（全局工具不含关键词也被滤掉）
    const parsed = JSON.parse((await tool.execute('call-f4', { ontology_id: '1', keyword: '库存' })).content[0].text);
    expect(parsed.map((t: any) => t.name)).toEqual(['calcSafetyStock']);
  });

  it('父 Agent 只挂本体查询工具（list*），不挂函数/外部工具', async () => {
    const names = (await captureParentTools()).map(t => t.name);
    expect(names).toContain('listOntoBehaviors');
    expect(names).toContain('listOntoFunctions'); // MCP 版本体函数元数据查询工具（恢复挂载，判断3 用）
    expect(names).toContain('listOntoProcesses'); // 本体业务流程查询工具
    expect(names).toContain('listPlannableFunctions'); // 本地内部工具：可规划函数/工具清单（只读）
    expect(names).not.toContain('getCurrentDate'); // 公共函数不挂父 Agent（由 listPlannableFunctions 发现）
  });

  it('父 Agent 不挂任何执行工具（行为工具 / 本体函数 / 外部工具）', async () => {
    const names = (await captureParentTools()).map(t => t.name);
    expect(names).not.toContain('CreatePurchaseRecord'); // 行为工具不挂父 Agent（业务执行由子 Agent 独占）
    expect(names).not.toContain('executeOntoBehavior'); // 分发器已退役
    expect(names).not.toContain('calcSafetyStock'); // 本体函数不挂父 Agent
    expect(names).not.toContain('sumRawNotArrivalQty');
    expect(names).not.toContain('weatherQuery'); // 外部工具不挂父 Agent
  });
});

describe('AgentFactory 子 Agent 工具职责边界与挂载期过滤（机制即白名单）', () => {
  beforeEach(() => { mockedAgent.mockClear(); mcpCalls.list.length = 0; });

  it('子 Agent 挂合法行为工具 + 合法函数，不挂本体浏览工具/非法行为/分发器', async () => {
    const names = (await captureChildTools()).map(t => t.name);
    expect(names).toContain('CreatePurchaseRecord'); // legalCalls.behaviors 主行为
    expect(names).toContain('QuerySupplier');        // legalCalls.behaviors 规则关联行为
    expect(names).toContain('calcSafetyStock');      // legalCalls.functions 声明的本体函数
    expect(names).toContain('getCurrentDate');       // legalCalls.functions 声明的公共函数
    expect(names).not.toContain('DeleteInventory');  // 未声明的行为不挂（挂载期过滤）
    expect(names).not.toContain('listOntoBehaviors');
    expect(names).not.toContain('listOntoFunctions');
    expect(names).not.toContain('executeOntoBehavior'); // 分发器已退役
  });

  it('行为工具挂载：工具名即行为名（无本体前缀），非合法集合的行为不挂', async () => {
    const names = (await captureChildTools()).map(t => t.name);
    expect(names).toContain('CreatePurchaseRecord'); // 合法集合内的行为，裸名挂载
    mockedAgent.mockClear();
    const names2 = (await captureChildTools({ behaviors: ['CreatePurchaseRecord'], functions: [] })).map(t => t.name);
    expect(names2).not.toContain('QuerySupplier'); // 不在合法集合 → 不挂载
  });

  it('本体函数/公共函数按挂载期过滤：只挂 legalCalls.functions 声明的', async () => {
    const tools = await captureChildTools();
    const names = tools.map(t => t.name);
    expect(names).toContain('calcSafetyStock');
    expect(names).not.toContain('sumRawNotArrivalQty'); // 未声明的本体函数不挂
    mockedAgent.mockClear();
    const names2 = (await captureChildTools({ behaviors: ['CreatePurchaseRecord'], functions: ['calcSafetyStock'] })).map(t => t.name);
    expect(names2).not.toContain('getCurrentDate'); // 公共函数未声明 → 不挂（不再恒挂全部）
  });

  it('其他 MCP 工具默认不挂，父 Agent 经 related_functions 指定才挂', async () => {
    const defaultTools = await captureChildTools();
    expect(defaultTools.map(t => t.name)).not.toContain('weatherQuery');
    mockedAgent.mockClear();
    const withExternal = await captureChildTools({ behaviors: ['CreatePurchaseRecord'], functions: ['weatherQuery'] });
    expect(withExternal.map(t => t.name)).toContain('weatherQuery');
  });

  it('行为/函数工具：LLM 看不到本体元数据，ontology_id 是必填参数且调用方值原样透传', async () => {
    const tools = await captureChildTools();
    const behTool = tools.find(t => t.name === 'CreatePurchaseRecord');
    const behSchema = behTool.parameters as any;
    const behProps = behSchema.properties ?? {};
    expect(behProps.ontology_id).toEqual({ type: 'integer' }); // 必填参数，LLM 可见可填
    expect(behSchema.required).toContain('ontology_id');
    expect('scope' in behProps).toBe(false);                   // scope 不是参数
    expect('x-ontology-scope' in behSchema).toBe(false);       // 元数据不交给 LLM
    expect(behTool.ontologyScope).toEqual({                    // 元数据留在平台内部
      ontology_id: 1, scenario_id: 1, scenario_name: '生产调度', ontology_name: '原材料采购和库存',
    });
    // 编译 schema 的参数与约束原样保留（harness 校验依据）
    expect(behProps.qty).toEqual({ type: 'integer', minimum: 1, maximum: 100 });
    await behTool.execute('call-1', { ontology_id: 1, rawMaterialId: 'RM-1', qty: 10 });
    expect(mcpCalls.list[0].name).toBe('CreatePurchaseRecord');
    expect(mcpCalls.list[0].args).toEqual({ ontology_id: 1, rawMaterialId: 'RM-1', qty: 10 });

    const fnTool = tools.find(t => t.name === 'calcSafetyStock');
    expect((fnTool.parameters as any).properties.ontology_id).toEqual({ type: 'integer' });
    await fnTool.execute('call-2', { ontology_id: 1, currentStock: 10, safetyStock: 5 });
    expect(mcpCalls.list[1].args).toEqual({ ontology_id: 1, currentStock: 10, safetyStock: 5 });
  });

  it('ontology_id 由调用方（LLM）填写并原样透传——agent 不覆盖（覆盖会掩盖填错的本体，校验形同虚设）', async () => {
    const tools = await captureChildTools();
    const behavior = tools.find(t => t.name === 'QuerySupplier');
    await behavior.execute('call-3', { ontology_id: 999 });
    expect(mcpCalls.list[0].args.ontology_id).toBe(999);
  });
});

describe('AgentFactory 子 Agent disable 硬闸（工具层单点，terminate + run 级共享闸）', () => {
  beforeEach(() => { mockedAgent.mockClear(); mcpCalls.list.length = 0; });

  const mkSecurity = (disabled: [string, string][] = []): ChildSecurityCtx => ({
    disabled: new Map<string, string>(disabled),
    gate: createSecurityGate(),
  });

  it('闸1：调用禁用行为工具 → 真实工具零执行，返回 terminate + 置 run 级 violation（不抛错、不走报错预算）', async () => {
    const security = mkSecurity([['CreatePurchaseRecord', '创建采购记录']]);
    const tools = await captureChildTools(undefined, security);
    const tool = tools.find(t => t.name === 'CreatePurchaseRecord');
    const result = await tool.execute('call-d1', { rawMaterialId: 'RM-1', qty: 10 });
    expect(result.terminate).toBe(true);                       // pi-agent 内层循环当场停
    expect(result.content[0].text).toContain('权限范围为 disable');
    expect(result.content[0].text).toContain('创建采购记录（CreatePurchaseRecord）');
    expect(security.gate.violation).toContain('权限范围为 disable'); // run 级信号已广播
    expect(mcpCalls.list).toHaveLength(0);                     // 真实 MCP 调用零发生
  });

  it('闸0 入口短路：violation 已置位 → 任意工具调用（行为/本体函数）一律 terminate，真实执行零发生', async () => {
    const security = mkSecurity();
    security.gate.violation = '🔒 行为已被禁用：其他子任务命中';
    const tools = await captureChildTools(undefined, security);
    const behTool = tools.find(t => t.name === 'QuerySupplier');
    const r1 = await behTool.execute('call-s1', { supplierName: '宝钢' });
    expect(r1.terminate).toBe(true);
    expect(r1.content[0].text).toContain('其他子任务命中');
    const fnTool = tools.find(t => t.name === 'calcSafetyStock');
    const r2 = await fnTool.execute('call-s2', { currentStock: 1, safetyStock: 2 });
    expect(r2.terminate).toBe(true);                           // 函数工具同样被短路
    expect(mcpCalls.list).toHaveLength(0);
  });

  it('first-writer-wins：violation 只记首次命中文案（后续调用走闸0 原样回显）', async () => {
    const security = mkSecurity([['CreatePurchaseRecord', '创建采购记录'], ['QuerySupplier', '查询供应商']]);
    const tools = await captureChildTools(undefined, security);
    await tools.find(t => t.name === 'CreatePurchaseRecord').execute('call-f1', {});
    const r2 = await tools.find(t => t.name === 'QuerySupplier').execute('call-f2', {});
    expect(security.gate.violation).toContain('CreatePurchaseRecord');
    expect(security.gate.violation).not.toContain('查询供应商');
    expect(r2.content[0].text).toContain('CreatePurchaseRecord'); // 闸0 回显首次文案
  });

  it('非禁用行为正常放行，gate 不置位', async () => {
    const security = mkSecurity([['CreatePurchaseRecord', '创建采购记录']]);
    const tools = await captureChildTools(undefined, security);
    const tool = tools.find(t => t.name === 'QuerySupplier');
    const result = await tool.execute('call-p1', { supplierName: '宝钢' });
    expect(result).toBeTruthy();
    expect(result.terminate).toBeUndefined();
    expect(security.gate.violation).toBeNull();
    expect(mcpCalls.list).toHaveLength(1); // 真实执行发生
  });
});

describe('AgentFactory 子 Agent 前置规则留痕闸（闸2：主行为调用前规则函数须已成功留痕）', () => {
  beforeEach(() => { mockedAgent.mockClear(); mcpCalls.list.length = 0; });

  /** 主行为 CreatePurchaseRecord 挂前置规则 V01（要求 getCurrentDate，纯留痕无判断函数）；无后置 */
  const mkRuleGate = (over?: Partial<RuleGate>): RuleGate => ({
    mainBehavior: 'CreatePurchaseRecord',
    pre: [{ name: 'V01', functions: ['getCurrentDate'], judgeFunctions: [] }],
    post: [],
    succeeded: new Set(),
    verdicts: new Map(),
    ...over,
  });

  it('前置规则函数未留痕 → 主行为调用抛错列出缺口（规则+函数），真实 MCP 零执行', async () => {
    const tools = await captureChildTools(undefined, undefined, mkRuleGate());
    const tool = tools.find(t => t.name === 'CreatePurchaseRecord');
    await expect(tool.execute('call-r1', { rawMaterialId: 'RM-1' })).rejects.toThrow('前置规则留痕缺失');
    await expect(tool.execute('call-r2', { rawMaterialId: 'RM-1' })).rejects.toThrow('规则 V01：函数 getCurrentDate');
    expect(mcpCalls.list).toHaveLength(0); // 真实执行零发生
  });

  it('函数成功调用后记入台账 → 主行为放行；失败调用不留痕仍拦截', async () => {
    const ruleGate = mkRuleGate();
    const tools = await captureChildTools(undefined, undefined, ruleGate);
    // 公共函数工具成功调用 → 台账留痕
    await tools.find(t => t.name === 'getCurrentDate').execute('call-r3', {});
    expect(ruleGate.succeeded.has('getCurrentDate')).toBe(true);
    const result = await tools.find(t => t.name === 'CreatePurchaseRecord').execute('call-r4', { rawMaterialId: 'RM-1' });
    expect(result.terminate).toBeUndefined();
    expect(mcpCalls.list).toHaveLength(2); // 函数 + 主行为都真实执行
  });

  it('只闸主行为：规则补充接口（QuerySupplier）不被前置闸拦截（否则规则取数无路）', async () => {
    const ruleGate = mkRuleGate();
    const tools = await captureChildTools(undefined, undefined, ruleGate);
    const result = await tools.find(t => t.name === 'QuerySupplier').execute('call-r5', { supplierName: '宝钢' });
    expect(result.terminate).toBeUndefined();
    expect(mcpCalls.list).toHaveLength(1); // 补充接口正常执行
  });

  it('前置规则无关联函数（pre 为空，派生期已剔除）→ 主行为不闸', async () => {
    const ruleGate = mkRuleGate({ pre: [] });
    const tools = await captureChildTools(undefined, undefined, ruleGate);
    const result = await tools.find(t => t.name === 'CreatePurchaseRecord').execute('call-r6', { rawMaterialId: 'RM-1' });
    expect(result.terminate).toBeUndefined();
    expect(mcpCalls.list).toHaveLength(1);
  });
});

describe('AgentFactory 子 Agent 前置判断函数判断闸（闸2.5：判断函数 data.pass=false → 拒绝主行为）', () => {
  beforeEach(() => {
    mockedAgent.mockClear();
    mcpCalls.list.length = 0;
    delete mcpCalls.responses.getCurrentDate;
  });

  /** 主行为挂前置规则 V01（判断函数 getCurrentDate，口径 B：本体且 type=VALIDATION）；无后置 */
  const mkRuleGate = (over?: Partial<RuleGate>): RuleGate => ({
    mainBehavior: 'CreatePurchaseRecord',
    pre: [{ name: 'V01', functions: ['getCurrentDate'], judgeFunctions: ['getCurrentDate'] }],
    post: [],
    succeeded: new Set(),
    verdicts: new Map(),
    ...over,
  });

  const envelopeResult = (data: unknown) => ({
    content: [{ type: 'text', text: JSON.stringify({ success: true, data, error: null }) }],
    isError: false,
  });

  it('判断函数返回 data.pass=false → 判断记入台账，主行为调用被拒且文案带 reason，重试仍拒', async () => {
    mcpCalls.responses.getCurrentDate = () => envelopeResult({ pass: false, reason: '单位不一致：采购单为 个，原材料定义为 吨' });
    const ruleGate = mkRuleGate();
    const tools = await captureChildTools(undefined, undefined, ruleGate);
    await tools.find(t => t.name === 'getCurrentDate').execute('call-v1', {});
    expect(ruleGate.verdicts.get('getCurrentDate')).toEqual({ pass: false, reason: '单位不一致：采购单为 个，原材料定义为 吨' });
    await expect(tools.find(t => t.name === 'CreatePurchaseRecord').execute('call-v2', { rawMaterialId: 'RM-1' }))
      .rejects.toThrow('前置规则 V01 判断不通过（函数 getCurrentDate）');
    await expect(tools.find(t => t.name === 'CreatePurchaseRecord').execute('call-v3', { rawMaterialId: 'RM-1' }))
      .rejects.toThrow('单位不一致');
    expect(mcpCalls.list.filter(c => c.name === 'CreatePurchaseRecord')).toHaveLength(0); // 主行为零执行
  });

  it('判断通过（data.pass=true）→ 主行为放行', async () => {
    mcpCalls.responses.getCurrentDate = () => envelopeResult({ pass: true, reason: '原材料存在且单位一致' });
    const ruleGate = mkRuleGate();
    const tools = await captureChildTools(undefined, undefined, ruleGate);
    await tools.find(t => t.name === 'getCurrentDate').execute('call-v4', {});
    const result = await tools.find(t => t.name === 'CreatePurchaseRecord').execute('call-v5', { rawMaterialId: 'RM-1' });
    expect(result.terminate).toBeUndefined();
    expect(mcpCalls.list.filter(c => c.name === 'CreatePurchaseRecord')).toHaveLength(1);
  });

  it('函数返回非信封（缺 data.pass）→ 不记判断，主行为按留痕缺失拦截（fail-closed 不静默放行）', async () => {
    const ruleGate = mkRuleGate();
    const tools = await captureChildTools(undefined, undefined, ruleGate);
    await tools.find(t => t.name === 'getCurrentDate').execute('call-v6', {}); // 默认 mock 返回 {"ok":true}
    expect(ruleGate.verdicts.size).toBe(0);
    await expect(tools.find(t => t.name === 'CreatePurchaseRecord').execute('call-v7', { rawMaterialId: 'RM-1' }))
      .rejects.toThrow('前置规则留痕缺失');
  });
});

// ─── toMountableToolInfo：发布方标记分类（纯函数，脱离 MCP 连接直测） ─────────────

describe('toMountableToolInfo 标记分类', () => {
  const NEW_SCOPE = {
    ontology_id: 1, scenario_id: 1, scenario_name: '生产调度', ontology_name: '原材料采购和库存',
  };

  it('本体函数：元数据提升为 scope；ontology_id 保留为必填参数；参数面不含 scope', () => {
    const info = toMountableToolInfo({
      name: 'calcSafetyStock',
      description: '计算安全库存',
      parameters: {
        type: 'object',
        'x-category': '本体函数',
        'x-title': '计算安全库存',
        'x-ontology-scope': NEW_SCOPE,
        properties: { ontology_id: { type: 'integer' }, currentStock: { type: 'number' } },
        required: ['ontology_id'],
      },
    });
    expect(info.category).toBe('本体函数');
    expect(info.title).toBe('计算安全库存');
    // ontology_id 是调用方必填参数（不再被剥掉）；scope 元数据不是参数
    expect(info.params.ontology_id).toMatchObject({ type: 'integer', required: true });
    expect(info.params.currentStock).toEqual({ type: 'number', required: false });
    expect(info.params.scope).toBeUndefined();
    // 归属元数据独立携带（工具名即裸名，故无冗余 name）
    expect(info.scope).toEqual(NEW_SCOPE);
    // schema 原文（已剥元数据）随条目携带——规划期参数校验数据源
    expect(info.schema?.properties).toEqual({ ontology_id: { type: 'integer' }, currentStock: { type: 'number' } });
    expect(info.schema?.required).toEqual(['ontology_id']);
    expect(info.schema?.['x-ontology-scope']).toBeUndefined();
  });

  it('本体行为：工具名即行为名；约束随 schema 携带', () => {
    const info = toMountableToolInfo({
      name: 'CreatePurchaseRecord',
      description: '创建采购记录',
      parameters: {
        type: 'object',
        'x-category': '本体行为',
        'x-title': '创建采购记录',
        'x-ontology-scope': NEW_SCOPE,
        properties: { ontology_id: { type: 'integer' }, qty: { type: 'integer', minimum: 1, maximum: 100 } },
        required: ['ontology_id'],
      },
    });
    expect(info.category).toBe('本体行为');
    expect(info.name).toBe('CreatePurchaseRecord'); // 工具名（挂载键）
    expect(info.scope).toEqual(NEW_SCOPE);
    expect(info.params.qty).toEqual({ type: 'integer', required: false });
    expect(info.schema?.properties?.qty).toEqual({ type: 'integer', minimum: 1, maximum: 100 });
    expect(info.schema?.required).toEqual(['ontology_id']);
  });

  it('发现期已提升 ontologyScope 时直接复用（schema 里没有元数据也不影响）', () => {
    const lifted = toMountableToolInfo({
      name: 'calcSafetyStock', description: '',
      parameters: { type: 'object', 'x-category': '本体函数', properties: { ontology_id: { type: 'integer' } }, required: ['ontology_id'] },
      ontologyScope: NEW_SCOPE,
    });
    expect(lifted.scope).toEqual(NEW_SCOPE);
    expect(lifted.params.ontology_id).toBeTruthy(); // ontology_id 是参数，保留
  });

  it('公共函数：x-category 标记 → 归公共函数，x-title 进 title', () => {
    const info = toMountableToolInfo({
      name: 'getCurrentDate', description: '当前日期',
      parameters: { type: 'object', properties: {}, 'x-category': '公共函数', 'x-title': '当前日期' },
    });
    expect(info.category).toBe('公共函数');
    expect(info.title).toBe('当前日期');
    expect(info.scope).toBeUndefined();
  });

  it('无标记 → 归其他MCP工具（排除法）', () => {
    const info = toMountableToolInfo({
      name: 'weatherQuery', description: '天气',
      parameters: { type: 'object', properties: { city: { type: 'string' } } },
    });
    expect(info.category).toBe('其他MCP工具');
    expect(info.title).toBeUndefined();
  });

  it('本体查询类：ontology_id 是父 Agent 真实填写的参数 → 保留在 required', () => {
    const info = toMountableToolInfo({
      name: 'listOntoFunctions', description: '查询函数清单',
      parameters: { type: 'object', 'x-category': '本体查询', properties: {
        ontology_id: { type: 'integer' }, keyword: { type: 'string' },
      }, required: ['ontology_id'] },
    });
    expect(info.schema?.required).toEqual(['ontology_id']);
    expect(info.schema?.properties?.ontology_id).toEqual({ type: 'integer' });
  });

  it('回归：外部工具碰巧带 ontology_id 参数 → 仍归其他MCP工具，参数不被误删', () => {
    const info = toMountableToolInfo({
      name: 'externalReport', description: '外部报表',
      parameters: { type: 'object', properties: { ontology_id: { type: 'integer' }, title: { type: 'string' } }, required: ['ontology_id'] },
    });
    expect(info.category).toBe('其他MCP工具');
    expect(info.params.ontology_id).toBeTruthy();
    expect(info.scope).toBeUndefined();
  });

  it('协议不变式①：带本体上下文但缺 x-category → 快速失败（不得降级为外部工具）', () => {
    expect(() => assertToolProtocol('orphanFn',
      { type: 'object', 'x-ontology-scope': NEW_SCOPE, properties: {} })).toThrow('版本不匹配');
  });

  it('协议不变式②：标为本体行为/函数但缺本体上下文 → 快速失败（拿不到归属依据）', () => {
    expect(() => assertToolProtocol('CreatePurchaseRecord',
      { type: 'object', 'x-category': '本体行为', properties: {} })).toThrow('缺本体上下文');
    expect(() => assertToolProtocol('calcSafetyStock',
      { type: 'object', 'x-category': '本体函数', properties: {} })).toThrow('缺本体上下文');
  });

  it('协议不变式：本体查询 / 公共函数 / 外部工具（均无本体上下文）→ 校验通过', () => {
    expect(() => assertToolProtocol('listOntoBehaviors',
      { type: 'object', 'x-category': '本体查询', properties: {} })).not.toThrow();
    expect(() => assertToolProtocol('getCurrentDate',
      { type: 'object', 'x-category': '公共函数', properties: {} })).not.toThrow();
    expect(() => assertToolProtocol('weatherQuery',
      { type: 'object', properties: {} })).not.toThrow();
  });

  it('协议不变式：本体执行类带 x-ontology-scope → 校验通过', () => {
    expect(() => assertToolProtocol('calcSafetyStock',
      { type: 'object', 'x-category': '本体函数', 'x-ontology-scope': NEW_SCOPE, properties: {} })).not.toThrow();
  });
});