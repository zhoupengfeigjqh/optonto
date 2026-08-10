# 本体函数作为子任务节点 — 设计方案（实现级详细版）

> 状态：**设计已定，代码未动**（仅分析，符合"先不要改代码"约束）
> 日期：2026-08-10
> 基线：`4863a88`（branch `multiagent`，「chore: 保存【函数子任务改造前】基线锚点」，可回退）
> 关联记忆：`function-subtask-refactor-baseline`（含改造范围与回退方法）
>
> **已确认决策**：
> - **（2026-08-09）**：
>   - ① 方式B只给函数子任务（v1），行为参数沿用方式A（父Agent 反馈填值）；行为参数 `$ref` 延后 v2；
>   - ② `$ref` 解析失败：函数子任务一律硬失败（报错响亮，终止本 run）；
>   - ③ 行为输出 `data` 结构化捕获：做（函数子任务输入依赖它）；解析失败置 `data=null` 不抛错；
>   - ④ 函数子任务命名：复用 `behavior` 字段存函数名 + `kind` 判别。
> - **（2026-08-10）**：
>   - ⑤ `kind` 取两值 `'behavior' | 'function'`（'behavior' 为缺省，收规划时归一化 `??='behavior'`）；判别改为 **switch 分发**（`runSubtask`）留扩展接缝；
>   - ⑥ `kind` 为**开放联合**，未来新 kind 按"新增 kind 清单"（7 步协同）接入，判别式逐 kind 显式声明执行方式，不做"非行为子任务一律直调"的假设；
>   - ⑦ **函数子任务 v1 并行**：函数与同波读行为并入同一并行池（MAX_PARALLEL）真并发；写行为仍串行弹窗。
>
> 本文档为实施依据，所有"目标代码"均为草案，标注位置以基线 `4863a88` 为准。

---

## 〇、速览

| 项 | 值 |
|---|---|
| 一句话 | 给 `SubTask` 加 `kind:'behavior'\|'function'` 判别（switch 分发）；函数子任务编排器直调 MCP（零 LLM）；所有子任务输出存入 `Map<seq,data>`；函数子任务用 `$ref` 绑上游输出，执行前统一解析 |
| v1 做 | 函数子任务作为节点（规划/校验/确定性执行，**与同波行为并行**）；函数子任务 params 支持 `$ref`/`concat`；行为输出结构化捕获 `data`；函数子任务输出经波反馈进父Agent；kind 为开放联合 + switch 接缝 |
| v1 不做 | 行为参数 `$ref`（方式B进行为）→ v2；函数子任务的规则/安全/确认（函数是纯计算）；跨 run 数据持久化（`data` 纯内存） |
| 新增文件 | `agent-backend/src/agent/ref-resolver.ts`（纯函数） |
| 改动文件 | `types.ts` / `agent-ports.ts` / `ontology-gateway.ts` / `param-contract.ts` / `plan-validation.ts` / `agent-factory.ts` / `subtask-runner.ts` / `orchestrator.ts` / `prompts.ts` / 前端 `AgentApp.tsx` |
| 不改 | `CHILD_SYSTEM_PROMPT` / `createChildAgent` / `SubtaskRunner.run` 主体 / `mcp-client.ts` / `mcp-config-store.ts` / core-backend |
| 回退 | `git reset --hard 4863a88` |

---

## 一、目标与范围

### 1.1 目标

让本体的"函数"（如 `sumRawNotArrivalQty`）像"行为"一样成为可规划的子任务节点：
- 每个函数子任务**只调用 1 个本体函数**（客户约束）；
- 输入数据来自**上游依赖子任务**（行为或函数）的输出（`$ref` 绑定）；
- 执行时**不建子Agent、不走规则/安全检查、无确认弹窗**，只做参数校验后确定性直调；
- 函数输出可流入下游行为子任务（v1 经方式A：父Agent 波反馈读结果填值）。

### 1.2 v1 范围

**做**：函数子任务的规划（父Agent 可写 `kind:'function'`）、校验（函数名/函数参数/`$ref` 目标）、确定性执行（`callOntoFunction`）、`Map<seq,data>` 数据管道、行为输出 `data` 捕获、波反馈携带结构化输出、前端徽标、kind switch 分发接缝。

**不做**（明确挡在 v1 外）：
- 行为子任务参数用 `$ref`（方式B进行为）——v2，需加两道闸（见 7.4）；
- 函数子任务做"写操作/安全门"节点；
- `$ref` 算术/条件/通配表达式（path 只支持字段+下标）；
- 结构化 `data` 持久化（纯内存中转）；
- **新增第三个 kind**（本版只做 'behavior'/'function' 两个，接缝已留，见 3.5）。

### 1.3 已确认决策汇总

| # | 决策 | 定论 |
|---|---|---|
| ① | 行为子任务消费函数输出 | v1 方式A（父Agent 反馈填值）；行为参数 `$ref` 延后 v2 |
| ② | `$ref` 解析失败语义 | 函数子任务一律硬失败，终止本 run |
| ③ | 行为输出结构化捕获 `data` | 做；解析失败 `data=null` 不抛错 |
| ④ | 函数子任务命名 | 复用 `behavior` 字段存函数名 + `kind` 判别 |
| ⑤ | kind 取值 | `'behavior' \| 'function'`，'behavior' 缺省 + 归一化；switch 分发 |
| ⑥ | kind 扩展 | 开放联合；新增按 7 步清单，逐 kind 显式声明执行方式 |

---

## 二、现状梳理（代码级）

### 2.1 全链路图

```
┌──────────────────────── 父Agent（规划专家）─────────────────────────┐
│ ① load_skill 加载技能知识（SKILL.md: 行为/函数/规则/安全）          │
│ ② submit_plan 提交 SubTaskPlan（seq/kind/behavior/params/desc/…）  │
└──────────────────────────────────┬──────────────────────────────────┘
                                   ▼
              Orchestrator 阶段1：规划校验与确认
      ┌────────────────────────────────────────────────────┐
      │ 行为名/函数名校验 → 参数结构校验 → kind 归一化        │
      │ → $ref 目标校验 → 规划确认弹窗 → 依赖结构校验         │
      └────────────────────────────────────────────────────┘
                                   ▼
              Orchestrator 阶段2：按 depends_on 拓扑分波
      ┌────────────────────────────────────────────────────┐
      │ 每波就绪集 = 依赖已全部成功的子任务                    │
      │ runBatch: 函数+行为读并行(≤5) · 行为写串行         │
      │   └─ runSubtask（switch 分发，kind 接缝）            │
      │       ├ case 'function' → runFunctionSubtask（直调） │
      │       └ case 'behavior' → runBehaviorSubtask（现状路径）│
      └────────────────────────────────────────────────────┘
                                   ▼
   ┌─────────────── runBehaviorSubtask（行为子任务）──────────────┐
   │ ① 安全管控弹窗（security / isWrite → 用户确认）           │
   │ ② buildInstruction 组装指令（参数/规则/合法行为列表/函数）  │
   │ ③ createChildAgent → 子Agent（执行专家）                  │
   │    ├ 检查前置规则 → executeOntoBehavior(主行为)            │
   │    └ 后置规则推理 → 输出【状态】标记                       │
   │ ④ extractResult 提取 summary（文本）                      │
   └──────────────────────────────────────────────────────────┘
                                   ▼
            每波完成 → runWaveFeedback → 父Agent分析
      （数据中继 / 调整后续规划 / 提前终止 —— 文本级 r.summary + data JSON）
                                   ▼
             最终总结：父Agent 汇总全部子任务结果
```

### 2.2 关键代码点（基线 `4863a88`）

| 机制 | 位置 | 现状说明 |
|---|---|---|
| 规划提交 | [agent-factory.ts:255-294](agent-backend/src/agent/agent-factory.ts#L255) | `createSubmitPlanTool`，TypeBox schema，`params: Type.Record(Type.String(), Type.Any())` |
| 父Agent 无执行工具 | [agent-factory.ts:22](agent-backend/src/agent/agent-factory.ts#L22) | `PARENT_MCP_EXCLUDED = ['executeOntoBehavior','executeOntoFunction']` |
| 子Agent 工具白名单 | [agent-factory.ts:51](agent-backend/src/agent/agent-factory.ts#L51) | `CHILD_MCP_TOOL_NAMES` 含 executeOntoFunction |
| 必填参数硬检查 | [agent-factory.ts:205](agent-backend/src/agent/agent-factory.ts#L205) | `scopeToOntology` 内，主行为缺必填参数抛错 |
| 子任务类型 | [types.ts:73-84](agent-backend/src/types.ts#L73) | `SubTask` 无 kind 字段 |
| 子任务结果 | [types.ts:123-131](agent-backend/src/types.ts#L123) | `SubTaskResult` 无 `data` 字段 |
| 行为元信息 | [types.ts:110-120](agent-backend/src/types.ts#L110) | `BehaviorMeta` |
| 编排主循环 | [orchestrator.ts:144-468](agent-backend/src/agent/orchestrator.ts#L144) | `runExecute` |
| 分波/安全分流 | [orchestrator.ts:475-498](agent-backend/src/agent/orchestrator.ts#L475) | `runBatch` 用 `getBehaviorMeta` 判 secured/plain |
| 单子任务入口 | [orchestrator.ts:501-520](agent-backend/src/agent/orchestrator.ts#L501) | `runSubtaskEntry(st, meta, emit)` |
| 波反馈 | [orchestrator.ts:526-594](agent-backend/src/agent/orchestrator.ts#L526) | `runWaveFeedback` 只喂 `r.summary` 文本 |
| 拓扑排序 | [orchestrator.ts:597-610](agent-backend/src/agent/orchestrator.ts#L597) | `topologicalSort` |
| 规划修复循环 | [orchestrator.ts:659-682](agent-backend/src/agent/orchestrator.ts#L659) | `repairPlan`（行为名/参数/依赖共用） |
| 展示补全 | [orchestrator.ts:698-706](agent-backend/src/agent/orchestrator.ts#L698) | `enrichPlanDisplay` 用 getBehaviorMeta.display_name |
| 子任务执行 | [subtask-runner.ts:51-163](agent-backend/src/agent/subtask-runner.ts#L51) | `SubtaskRunner.run` |
| 工具结束事件 | [subtask-runner.ts:110-116](agent-backend/src/agent/subtask-runner.ts#L110) | `tool_execution_end` 只捕获文本 |
| 指令组装 | [subtask-runner.ts:229-315](agent-backend/src/agent/subtask-runner.ts#L229) | `buildInstruction` |
| 参数契约 | [param-contract.ts:1-63](agent-backend/src/agent/param-contract.ts#L1) | 必填/类型/缺值判定单一权威 |
| 规划校验 | [plan-validation.ts:15-63](agent-backend/src/agent/plan-validation.ts#L15) | 行为名/参数结构/依赖结构 |
| 函数参数结构 | [ontology-gateway.ts:124-129](agent-backend/src/agent/ontology-gateway.ts#L124) | `getFunctionParams`（functions[].params） |
| 行为名校验集合 | [ontology-gateway.ts:43-46](agent-backend/src/agent/ontology-gateway.ts#L43) | `getBehaviorNames` 只含 behaviors[] |
| 父Agent 提示词 | [prompts.ts:7-108](agent-backend/src/agent/prompts.ts#L7) | `PARENT_SYSTEM_PROMPT` |

### 2.3 现状缺陷清单（本方案要补的）

1. `SubTaskResult` 只有 `summary`（文本），**没有结构化 `data`**；
2. 波反馈 `runWaveFeedback` 只喂 `r.summary` 给父Agent，数据集跨子任务传播失真；
3. 函数名不在行为校验集合里（`getBehaviorNames` 只认 `behaviors[]`），规划函数子任务必挂；
4. 函数子任务无独立执行路径（`runBatch`/`runSubtaskEntry` 只认 `BehaviorMeta`，函数没有有意义的 meta）；
5. 父Agent 不知道能规划"函数子任务"（prompt 未教 `kind` 与 `$ref` 语法）。

---

## 三、设计核心：两类子任务

### 3.1 子任务判别（类型定义）

**现状** [types.ts:73-84](agent-backend/src/types.ts#L73)：

```ts
export interface SubTask {
  seq: number;
  behavior: string;
  params: Record<string, any>;
  description: string;
  guidance?: string;
  scenario_name: string;
  scenario_id?: number;
  ontology_name: string;
  ontology_id: number;
  depends_on?: number[];
}
```

**目标**（改动最小：加一个可空字段，老规划完全兼容）：

```ts
/**
 * 子任务执行策略键（开放联合，未来可加成员）：
 *   'behavior' → 行为子任务（缺省值，收规划时归一化），走子Agent 现状路径
 *   'function' → 函数子任务，编排器直调 executeOntoFunction，零 LLM
 * 未来（示例）：'validation' | 'decision' | 'approval' …（按 3.5 清单接入）
 */
type SubTaskKind = 'behavior' | 'function';

export interface SubTask {
  /** 执行策略键；缺省按 'behavior' 归一化 */
  kind?: SubTaskKind;
  /** 行为英文名（kind='behavior'）或 本体函数英文名（kind='function'） */
  behavior: string;
  params: Record<string, any>;
  // …其余字段不变
}

export interface SubTaskResult {
  seq: number;
  behavior: string;
  success: boolean;
  error?: string;
  aborted?: boolean;
  summary: string;
  /**
   * 结构化输出（kind 无关，任何 kind 可选）：
   * - 行为子任务 → executeOntoBehavior 返回体中 `data` 字段的 JSON.parse 结果；无 data 字段/解析失败 → null
   * - 函数子任务 → callOntoFunction 返回体整体（{result:…}）
   * v1 只被函数子任务的 $ref 消费；纯内存，不持久化。
   */
  data?: any;
}
```

> **归一化约定**：编排器在规划校验阶段执行 `st.kind ??= 'behavior'` 一次，此后所有下游（校验/分流/展示/SSE）直接读 `st.kind` 就是确定值，不再 `??` 兜底。老规划（无 kind）自动归一为 'behavior'，兼容不变。

### 3.2 两类子任务的差异对照

| 维度 | 行为子任务（kind:'behavior'） | 函数子任务（kind:'function'） |
|---|---|---|
| 执行载体 | 子Agent（LLM） | **直接 MCP 直调，无子Agent、零 LLM** |
| 调用工具 | `executeOntoBehavior` | `executeOntoFunction` |
| 规则（前/后置） | ✅ 子Agent 检查 | ❌ 无（函数是纯计算） |
| 安全管控/确认弹窗 | ✅（security / isWrite） | ❌ 无（函数不产生写入） |
| 参数检查 | 必填+类型结构校验 | **必填+类型结构校验 + `$ref` 目标校验** |
| 数据来源 | 用户/查询/上游输出 | **上游依赖子任务的输出（`$ref`）** |
| 失败处理 | 子Agent 自纠+预算 | `$ref` 解析失败/直调失败 → **硬失败**，终止本 run |
| 输出 | `summary`(文本) + `data`(v1 新增) | `summary`(生成) + `data`(返回体) |

### 3.3 函数子任务执行：`callOntoFunction`（实现草案）

**接口**（[agent-ports.ts](agent-backend/src/agent/agent-ports.ts) `AgentFactoryPort` 新增）：

```ts
callOntoFunction(ontologyId: number, functionName: string, params: Record<string, any>): Promise<any>;
```

**实现**（[agent-factory.ts](agent-backend/src/agent/agent-factory.ts) 新增方法，复用现有 `clientCache`）：

```ts
async callOntoFunction(ontologyId: number, functionName: string, params: Record<string, any>): Promise<any> {
  const cfg = this.mcpConfigStore.getConfig();
  const server = cfg.servers.find(s => s.builtin === true && s.enabled);
  if (!server) throw new Error('内置本体MCP未启用，无法执行函数');
  const client = this.getOrCreateClient(server.url);  // 复用缓存连接
  await client.connect();                              // 幂等
  const result = await client.callTool('executeOntoFunction', {
    ontology_id: ontologyId,
    function_name: functionName,
    params,
  });
  const text = toolResultToText(result.content);
  if (result.isError) throw new Error(text);           // 与 discoverTools 一致的错误传播
  try {
    return JSON.parse(text);                           // → { result: {...} }
  } catch {
    throw new Error(`函数 ${functionName} 返回非 JSON：${text.slice(0, 200)}`);
  }
}
```

要点：
- **不经过子Agent**：`MCPClient.callTool` 与 Agent 无关（[mcp-client.ts:30](agent-backend/src/services/mcp-client.ts#L30)）；
- 连接复用：与 `discoverTools` 同一 `clientCache`，一次 run 内不重连；
- `isError` 必须抛错（与 `discoverTools` 一致，pi-agent 返回 isError 会被吞掉）；
- `ontology_id` 由编排器传入（取自 `subTask.ontology_id`），函数子任务不做 scopeToOntology（没有子Agent 也就不存在"锁定"问题）。

### 3.4 执行分流：`runBatch` 波级分流 + `runSubtask` switch 分发

**波级（runBatch）**：函数子任务没有安全概念，先从行为分流里拆出；行为再按现状分 secured/plain：

```
runBatch(batch, emit)
  ├─ 安全分流（函数无安全，直接进普通并行池）：
  │    行为写（security/isWrite）→ secured[]       （串行，弹窗）
  │    其余（函数 + 行为读）→ plain[]               （可并行）
  ├─ plain 并行分块（MAX_PARALLEL，现状不变）：
  │    块内每项 → runSubtask(st, emit)   ← switch 分发
  │      function → runFunctionSubtask（直调，零LLM，廉价）
  │      behavior → runBehaviorSubtask（子Agent，昂贵）
  │    → 函数与同波读行为真并发：廉价直调与昂贵LLM重叠，省墙钟
  └─ secured 串行（安全弹窗，现状不变）
```

**单子任务（runSubtask，kind 接缝）**：这是未来扩展的**唯一分发点**——

```ts
/** 子任务统一入口：kind 接缝。未来新增 kind 在此加 case */
private async runSubtask(subTask: SubTask, emit: EventChannel): Promise<SubTaskResult> {
  switch (subTask.kind) {            // 规划阶段已归一化：undefined → 'behavior'
    case 'function':
      return this.runFunctionSubtask(subTask, emit);   // 直调，零 LLM，无弹窗
    case 'behavior':
    default:
      return this.runBehaviorSubtask(subTask, emit);     // 现状子Agent 路径
    // 未来：case 'validation': …   —— 注意逐 kind 显式声明执行方式，
    //       不要假设"非行为子任务一律确定性直调"（validation 可能需要子Agent/弹窗）
  }
}
```

**`runFunctionSubtask(st, emit)`**：

```
runFunctionSubtask(st, emit)
  ├─ resolveParams(st.params, resultDataMap)      ← 解析 $ref（v1 函数子任务专用）
  ├─ callOntoFunction(st.ontology_id, st.behavior, resolvedParams)
  ├─ success → SubTaskResult{success:true, data: body}
  └─ catch → SubTaskResult{success:false, error: 函数执行失败…}
```

`runBehaviorSubtask` = 现状 `runSubtaskEntry`（不改签名，v1 不调 resolveRefs——行为参数不含 `$ref`）。

### 3.5 kind 的扩展设计（开放联合 + switch 接缝）

> 决策 ⑥：`kind` 是**开放联合**，现在只有两个成员，但按"可扩展"的方式设计。

**为什么不能写死"非行为子任务一律直调"**：现在的 `st.kind === 'function'` 能用，是因为函数是唯一特例。未来 kind（如 `validation` 校验、`decision` 分支、`approval` 人工审批）**未必都走确定性直调**——可能也要子Agent、可能也要弹窗、可能失败语义不同（validation 失败可能该 nudge 而非终止 run）。所以分发必须**逐 kind 显式声明**。

**三条架构动作**：

1. **类型层**：`SubTaskKind` 开放联合，加成员即可（3.1）；
2. **分发层**：唯一的 switch 接缝 `runSubtask`（3.4），新 kind = 加一个 case + 一个执行器；
3. **校验层**：按 kind 的校验器映射，而不是散落的 if/else：
   ```ts
   const nameValidators: Record<SubTaskKind, (st) => string[]> = {
     behavior: st => gateway.getBehaviorNames(st.scenario_name, st.ontology_name),
     function: st => gateway.getFunctionNames(st.scenario_name, st.ontology_name),
     // 未来：validation: st => gateway.getRuleNames(...)
   };
   ```

**数据管道保持 kind 无关**：`Map<seq,data>` + `SubTaskResult.data?: any` 对任何 kind 的输出开放，未来 `validation` 子任务产出校验结果也走同一管道，不用改。

**新增 kind 的 7 步协同清单**（未来实施照单走，漏第 7 步则 LLM 不会用）：

| # | 位置 | 改什么 |
|---|---|---|
| 1 | [types.ts](agent-backend/src/types.ts) | `SubTaskKind` 联合加成员 |
| 2 | [agent-factory.ts](agent-backend/src/agent/agent-factory.ts) | submit_plan schema 的 kind union 加 Literal |
| 3 | [plan-validation.ts](agent-backend/src/agent/plan-validation.ts) | 加该 kind 的名称/参数校验器 |
| 4 | [orchestrator.ts](agent-backend/src/agent/orchestrator.ts) | `runSubtask` 加 case + 执行器 |
| 5 | [orchestrator.ts](agent-backend/src/agent/orchestrator.ts) | `enrichPlanDisplay` 加展示解析 |
| 6 | 前端 [AgentApp.tsx](frontend/src/components/Design/AgentApp.tsx) | 徽标分支 |
| 7 | [prompts.ts](agent-backend/src/agent/prompts.ts) | kind 表 + 教学段（漏此步 LLM 不会用） |

**避免过度设计**：现在只留 switch 接缝，**不建**插件注册表/handler 框架——两个 case 不值得。等第三个 kind 出现再提炼（规则：two is enough to abstract, one is not enough）。

**kind 专属数据放哪**：优先塞 `params`（自由 Record）；只有"影响编排语义"的东西（如 `validation` 引用的 rule_template id、`approval` 的审批人）才提成 SubTask 顶层可空字段，且不影响老规划。

---

## 四、数据流：`Map<seq, data>` + `$ref`

### 4.1 结构化数据怎么进 `Map`（行为输出捕获）

**行为子任务**——[subtask-runner.ts:110-116](agent-backend/src/agent/subtask-runner.ts#L110) `tool_execution_end` 改造：

```ts
} else if (event.type === 'tool_execution_end') {
  const text = toolResultToText(event.result?.content);
  const display = toolDisplayNames.get(event.toolCallId);
  const called = this.resolveCalledDisplay(subTask, event.toolName, event.args);
  // ── 新增：只捕获"主行为"那一次 executeOntoBehavior 的结构化输出 ──
  if (event.toolName === 'executeOntoBehavior'
      && event.args?.behavior_name === subTask.behavior) {
    primaryResultData = safeParseData(text);   // JSON.parse 取 .data，失败→null
  }
  // …现状展示逻辑不变
}
```

其中 `safeParseData`（放 `ref-resolver.ts` 或 `text-utils.ts`）：

```ts
export function safeParseData(text: string): any {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' && 'data' in parsed ? parsed.data : parsed;
  } catch { return null; }
}
```

**判别要点**：
- 必须 key 在 `behavior_name === subTask.behavior`，**不能取"最后一次工具调用"**——规则取数查询、公共函数调用都可能发生在主行为之后；
- 解析失败一律 `null`，**绝不抛错**（不影响行为子任务本身成败）。

**行为输出的实际信封（已核实，2026-08-10）**：`data` 的源头是 core-backend 行为执行，不是 LLM：

| 行为类型 | 返回信封（core-backend） | `safeParseData` 结果 | `$ref` path |
|---|---|---|---|
| SQL 行为 | `{"result":{"data":rows,"row_count":n}}` | `data`=rows（数组） | `result.data` |
| API 行为 | `{"status_code":…,"headers":…,"data":<映射后数据>}` | `data`=映射后数据 | `data` |

> 链路证据：[mcp_server_sse.py:269-286](core-backend/mcp_server_sse.py#L269)（MCP 调后端）+ [data_engine.py:196](core-backend/services/data_engine.py#L196)（SQL）/ [data_engine.py:83-96](core-backend/services/data_engine.py#L83)（API + output_mapping 确定性映射）+ [mcp_server_sse.py:308](core-backend/mcp_server_sse.py#L308)（原样 `json.dumps` 回传）。
> **`data` 不经 LLM**：LLM 只决定"调哪个行为/传什么参数"+ 写 `summary` 文本；结构化 `data` 走后端直传。可 parse 性有保障（MCP 层保证返回文本是 JSON）。

**函数子任务**：`callOntoFunction` 返回体 `{result:…}` 整体作为 `data`。

**编排器维护**：`runBatch` 后把每个 `result.data` 写入 `resultDataMap.set(result.seq, result.data)`（跨波存活，v1 纯内存）。

### 4.2 `$ref` 绑定标记（父Agent 写在函数子任务 params 里）

```jsonc
// 整取上游行为输出的 data 字段
"purchaseRecordSet": {"type":"array", "value": {"$ref": 1, "path": "data"}}

// 取函数返回体 result 里的某字段
"threshold": {"type":"number", "value": {"$ref": 2, "path": "result.sumNotArrivalQty"}}

// 单参数多源拼装（concat：多个上游输出拼接成数组；标量自动包一层）
"purchaseRecordSet": {"type":"array", "value": {"concat": [
  {"$ref": 2, "path": "data"},
  {"$ref": 3, "path": "data"}
]}}
```

`path` 指向**上游子任务声明的返回结构**（SKILL.md §3/§4 有权威声明，父Agent 经 load_skill 可知；SQL 行为取 `result.data`，API 行为取 `data`）。

### 4.3 解析时机与调用点

```
runFunctionSubtask(st, emit)
  │
  ├─ resolveParams(st.params, resultDataMap)   ← 执行前统一解析（v1 只服务函数子任务）
  │
  └─ callOntoFunction(ontologyId, st.behavior, resolvedParams)

runBehaviorSubtask(st, meta, emit)                ← 行为子任务，v1 不改
  └─ SubtaskRunner.run(st, meta, ...)           （行为参数不含 $ref，原样透传）
```

### 4.4 编排边界（已确认）

函数子任务与行为子任务**共用同一套 `depends_on` 拓扑分波**，可出现在 DAG 任意位置：

```
允许：链式 行为→函数→行为 ｜ 并行扇出（一个上游喂多个函数，同波并行）
      多源聚合（concat 吃多个上游，含行为+函数混合）
      结果复用（一个函数输出被多个下游引用）｜ 函数做起点（全字面量参数）或终点
```

**4 条硬约束**：
1. 一个函数子任务只能调 1 个本体函数（客户规则）；
2. `$ref` 只能引用 `depends_on` 里声明的上游（`validateRefTargets` 强制）；
3. 函数子任务是纯计算，不能做"写操作/安全门"节点（写入必须落在行为节点）；
4. 无 `depends_on` 的函数子任务，参数只能全用字面量。

**边界说明**：数据流编排任意且确定性（方式B）；但"**要不要执行下游**"的决策流仍由父Agent 在波反馈把关（方式A，LLM 必经）——条件编排（如 110>100 才建单）无法纯确定性。

---

## 五、全流程执行图（含函数子任务）

```
用户：查高强度钢板未到位采购量，超100吨就创建补货采购单
 │
 ▼
① 父Agent：load_skill 加载 SKILL.md → 提交 submit_plan（3个子任务）
 │      seq1 行为 QueryPurchaseRecords（查记录，kind 省略→behavior）
 │      seq2 函数 sumRawNotArrivalQty（算未到位量，kind:'function'，$ref 绑 seq1）
 │      seq3 行为 CreatePurchaseRecord（补货，数量由父Agent 反馈填）
 ▼
② Orchestrator 规划校验与确认
 │      kind 归一化（undefined→behavior）
 │      行为名/函数名校验（switch：nameValidators[kind]）
 │      参数结构校验（switch：kind 对应参数声明）
 │      $ref 目标校验（引用的 seq 必须存在且是上游依赖）
 │      规划确认弹窗 → 用户批准
 ▼
③ Wave 1：子任务1（行为，读 → 并行）
 │      runSubtask → case 'behavior' → 子Agent
 │      executeOntoBehavior 返回 {…, data:[3条采购记录]} → 捕获 data
 │      Map[1].data = 采购记录数组
 ▼
④ Wave 2：子任务2（函数，确定性，无子Agent、无LLM、无弹窗）
 │      runSubtask → case 'function' → runFunctionSubtask
 │      resolveParams: purchaseRecordSet ← Map[1].data（$ref:1, path:"data"）
 │      callOntoFunction('sumRawNotArrivalQty', {…}) → {result:{sumNotArrivalQty:110}}
 │      Map[2].data = {rawMaterialName, sumNotArrivalQty:110}
 ▼
⑤ 110 > 100 → 继续
   Wave 3：子任务3（行为，写 + 安全确认）
 │      v1：110 经 Wave2 反馈由父Agent 填入 params（方式A，见 7.4）
 │      v2（暂不做）：行为参数 $ref 直接绑定（方式B）
 │      安全管控弹窗 → 用户确认 → executeOntoBehavior
 │      返回 PO-2026-…-001，Map[3].data = 单据信息
 ▼
⑥ 最终总结：父Agent 汇总 → 未到位量110、已创建补货单、建议后续入库
```

---

## 六、参数形式与 `$ref` 解析规则（ref-resolver）— 详细版

### 6.1 参数形式全集（对应当前代码现状）

**外层形态**（来自 `submit_plan` schema `params: Record<string, Type.Any()>`，[param-contract.ts](agent-backend/src/agent/param-contract.ts) 现有判定）：

| 外层形态 | 例子 | 现状代码处理 | 解析器处理 |
|---|---|---|---|
| 包装形态（主流） | `{"type":"string","required":true,"value":"RM-001"}` | 各函数取 `.value` | 只解析 `.value`，保留 type/required |
| 裸标量 | `"unit": "吨"` | `isParamValueEmpty` 兼容 | 整体解析（无标记则原样） |
| 缺值 | `""` / 缺失 / null | 视为待补充 | 原样透传（`$ref` 不会在此） |

**值内形态**（加 `$ref` 后）：

| 值形态 | 例子 | 解析结果 |
|---|---|---|
| 标记（包装内） | `value: {"$ref":2,"path":"result.sumNotArrivalQty"}` | `value: 110` |
| 标记（无包装，参数即标记） | `{"$ref":3,"path":"data.purchaseRecordId"}` | 整个参数 = `"PO-2026-001"` |
| concat（多源拼装） | `value: {"concat":[{"$ref":2,"path":"data"},{"$ref":3,"path":"data"}]}` | 拼接后的数组 |
| 标记嵌在深层对象里 | `"filter":{"maxQty":{"$ref":2,"path":"result.sumNotArrivalQty"}}` | `filter.maxQty = 110` |
| 数组里混用 | `"ids":[{"$ref":1,"path":"data[0].purchaseRecordId"},"RM-001"]` | `["PO-2026-001","RM-001"]` |
| 纯业务对象/数组（无标记） | `"filter":{"name":"钢板"}` | 原样透传，不得误判为标记 |

### 6.2 完整 TypeScript 实现（生产级草案）

新增 `agent-backend/src/agent/ref-resolver.ts`（纯函数，与 `plan-validation.ts`/`param-contract.ts` 同风格）：

```ts
/**
 * ref-resolver —— $ref 绑定解析器（纯函数，无副作用，可独立单测）。
 * v1 范围：只服务"函数子任务"的 params；行为子任务 params 不含标记，原样透传。
 * 设计原则：非"按位置硬编码"——任意值递归解析，唯一"硬编码"是标记形状判定。
 */

export class RefResolveError extends Error {}
export class RefUnresolvedError extends RefResolveError {} // $ref 引用的 seq 无数据
export class RefPathError extends RefResolveError {}        // path 越界/取空

function isPlainObject(x: unknown): x is Record<string, any> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** ① 标记识别（唯一硬编码）：只含 $ref 键（可带 path），无任何业务键 */
export function isRefMarker(x: unknown): boolean {
  if (!isPlainObject(x)) return false;
  const keys = Object.keys(x);
  return keys.includes('$ref') && keys.every(k => k === '$ref' || k === 'path');
}

/** 标记识别：只含 concat 键 */
export function isConcatMarker(x: unknown): boolean {
  return isPlainObject(x) && Object.keys(x).length === 1 && 'concat' in x;
}

/** ② 递归解析：任意值入口 */
export function resolveValue(x: unknown, dataMap: Map<number, any>): unknown {
  if (isConcatMarker(x)) {
    return (x as any).concat.flatMap((item: any) => {
      const r = resolveValue(item, dataMap);
      return Array.isArray(r) ? r : [r];   // 标量自动包一层，保证 concat 结果恒为数组
    });
  }
  if (isRefMarker(x)) {
    const upstream = dataMap.get((x as any).$ref as number);
    if (upstream === undefined) {
      throw new RefUnresolvedError(`$ref 引用的子任务 ${x.$ref} 无输出数据（上游失败或未产生结构化输出）`);
    }
    return walkPath(upstream, (x as any).path ?? '');
  }
  if (Array.isArray(x)) return x.map(item => resolveValue(item, dataMap)); // 数组逐个
  if (isPlainObject(x)) {                                                   // 对象逐键
    const out: Record<string, any> = {};
    for (const k of Object.keys(x)) out[k] = resolveValue(x[k], dataMap);
    return out;
  }
  return x;                                                                 // 标量原样
}

/** ③ path：空=整取 / 点路径 / [下标]，支持 data[0].arrivalQuantity */
export function walkPath(obj: any, path: string): any {
  if (!path) return obj;
  let cur = obj;
  const segRe = /([A-Za-z_$][\w$-]*)|\[(\d+)\]/g;   // 标识符 或 [数字]
  let m: RegExpExecArray | null;
  while ((m = segRe.exec(path))) {
    if (cur == null) throw new RefPathError(`$ref 路径 ${path} 越界（在 "${m[0]}" 处上游为 null）`);
    cur = cur[m[1] ?? m[2]];
  }
  return cur;
}

/** ④ 入口：兼容 包装形态 与 裸值 两种外层 */
export function resolveParams(params: Record<string, any>, dataMap: Map<number, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const k of Object.keys(params)) {
    const p = params[k];
    const wrapped = isPlainObject(p) && 'value' in p && !isRefMarker(p) && !isConcatMarker(p);
    out[k] = wrapped ? { ...p, value: resolveValue(p.value, dataMap) } : resolveValue(p, dataMap);
  }
  return out;
}

/** ⑤ 收集 params 中所有 $ref 标记（validateRefTargets 校验用） */
export function collectRefs(x: unknown, acc: { seq: number; path: string }[] = []): { seq: number; path: string }[] {
  if (isRefMarker(x)) { acc.push({ seq: (x as any).$ref as number, path: (x as any).path ?? '' }); return acc; }
  if (Array.isArray(x)) { x.forEach(i => collectRefs(i, acc)); return acc; }
  if (isPlainObject(x)) { Object.values(x).forEach(v => collectRefs(v, acc)); }
  return acc;
}
```

### 6.3 两道"防误伤"防线

1. **只解析父Agent 写的 `params`，从不递归扫描 `Map[seq].data` 里的运行时数据。** 真实数据只经 `$ref` 被"取走"，它自己永远不参与标记识别 → 业务数据里就算有 `{"$ref":…}` 字段也不会被展开。
2. **标记形状严格判定**：一个对象**只有** `$ref`（+`path`）键才认作标记；带任何其他业务键（如 `{"name":"…","$ref":…}`）一律当真实数据透传。加上父Agent 被 prompt 约束只写约定格式，歧义可控。

### 6.4 path 语法规范

```
path      := '' | segment ('.' segment)*
segment   := identifier | '[' digit+ ']'
identifier:= [A-Za-z_$][\w$-]*
```

| 写法 | 含义 | 示例 |
|---|---|---|
| （空） | 取整个上游 data | `{"$ref":1}` |
| `data` | 取 data 字段（API 行为 / 函数返回体） | `{"$ref":1,"path":"data"}` |
| `result.data` | SQL 行为的信封剥层 | `{"$ref":1,"path":"result.data"}` |
| `result.sumNotArrivalQty` | 点路径逐层取 | `{"$ref":2,"path":"result.sumNotArrivalQty"}` |
| `data[0]` | 数组下标（等价 `data.0`） | `{"$ref":1,"path":"data[0]"}` |
| `data[0].arrivalQuantity` | 混合 | `{"$ref":1,"path":"data[0].arrivalQuantity"}` |

**明确不支持（v1）**：负索引、通配 `*`、条件分支、算术变换、函数调用（如 `length()`）。"先算再引用"交给父Agent 在波反馈里算完填字面量，或未来加 `operator` 链。

> **path 与行为类型的绑定（2026-08-10 核实）**：SQL 行为外层多一层 `result`，所以 `$ref` 到 SQL 行为输出要写 `result.data`；API 行为直接 `data`。父Agent 教学段需指明"按上游行为的返回结构写 path"（见 13.4）。

### 6.5 错误矩阵

| 错误 | 发生点 | 处理 | 用户看到 |
|---|---|---|---|
| `$ref` 引用不存在的 seq | 规划期 `validateRefTargets` | nudge 父Agent 修正 | "子任务 X 的 $ref 引用了不存在的子任务 Y" |
| `$ref` 引用的 seq 不在 depends_on | 规划期 `validateRefTargets` | nudge 父Agent 修正 | "子任务 X 的 $ref 引用了非上游子任务 Y" |
| `$ref` 引用无输出数据（上游 data=null） | 执行期 resolveValue | **硬失败** RefUnresolvedError | "子任务 X 的函数失败：$ref 引用的子任务 Y 无输出数据" |
| path 越界/取空 | 执行期 walkPath | **硬失败** RefPathError | "子任务 X 的函数失败：$ref 路径 … 越界" |
| `callOntoFunction` isError | 执行期 | 函数子任务失败 | "子任务 X 的函数失败：{后端错误}" |
| 函数返回非 JSON | 执行期 callOntoFunction | 函数子任务失败 | "子任务 X 的函数失败：返回非 JSON" |
| 行为 `data` 解析失败 | 执行期 safeParseData | `data=null`，**不抛错** | 无（下游 $ref 引用它时才硬失败） |
| kind 值非法（非 'behavior'/'function'） | 规划期 schema | schema 拒绝，nudge | "kind 只能是 behavior 或 function" |
| 函数名不合法 | 规划期 validateBehaviors(kind 分支) | nudge 父Agent 修正 | "子任务 X 的函数名不存在于本体" |
| 函数参数缺必填 | 规划期 validateParams(kind 分支) | nudge 父Agent 修正 | "子任务 X 缺少必填参数 …" |

> 函数子任务失败 → 波内任一失败 → `runExecute` 终止本 run（fail-fast，与现状行为子任务失败一致）。理由：函数失败说明规划写错，继续跑只会连环错。未来 kind（如 validation）失败语义可能不同（nudge 而非终止），在 `runSubtask` 的 case 里按 kind 声明（3.5）。

### 6.6 单测用例清单（ref-resolver.test.ts）

| # | 输入 | dataMap | 期望 |
|---|---|---|---|
| 1 | `{"value":{"$ref":1,"path":"data"}}` | `{1: [3条记录]}` | value=记录数组 |
| 2 | `{"value":{"$ref":2,"path":"result.sumNotArrivalQty"}}` | `{2: {result:{sumNotArrivalQty:110}}}` | value=110 |
| 3 | `{"$ref":3,"path":"data.purchaseRecordId"}`（无包装） | `{3: {data:{purchaseRecordId:"PO-1"}}}` | 整个=PO-1 |
| 4 | concat 两项 | `{2:[a,b], 3:[c,d]}` | [a,b,c,d] |
| 5 | concat 含标量 | `{2:[a,b]}` + 字面 `"x"` | [a,b,x] |
| 6 | 标记嵌深层对象 | `{2:{result:{sumNotArrivalQty:110}}}` | `{maxQty:110}` |
| 7 | 数组混用 | `{1:{data:[{purchaseRecordId:"P1"}]}}` | ["P1","RM-001"] |
| 8 | 纯业务对象无标记 | — | 原样透传 |
| 9 | 包装形态缺值 `{"type":"string","value":""}` | — | 原样（value 保持空串） |
| 10 | `$ref` 无数据 | `{}` | 抛 RefUnresolvedError |
| 11 | path 越界 | `{1:{data:[…]}}` + `path:"data[5]"` | 抛 RefPathError |
| 12 | `data[0].arrivalQuantity` | `{1:{data:[{arrivalQuantity:60}]}}` | 60 |
| 13 | 带业务键的 `$ref` 对象不误判 | `{"name":"a","$ref":1}` | 原样透传（不解析） |
| 14 | 包装形态本身是 `$ref`（不入 value 分支） | `{"$ref":3,"path":"data"}` | 整体=上游 data |
| 15 | SQL 信封 `result.data` | `{1:{result:{data:[…]}}}` | value=rows |

---

## 七、数据 Demo（真实本体，端到端）

### 7.0 场景

> "查一下高强度钢板目前未到位的采购量有多少？如果超过100吨，就帮我创建一张补货采购单，数量就是未到位量。"

### 7.1 父Agent 提交的规划（`submit_plan` 入参）

```jsonc
{
  "subtasks": [
    {
      "seq": 1,                              // kind 省略 → 归一化为 behavior
      "behavior": "QueryPurchaseRecords",
      "params": { "rawMaterialName": {"type":"string","required":false,"value":"高强度钢板"} },
      "description": "查询高强度钢板的所有采购记录",
      "guidance": "按原材料名称查询全部采购记录，返回完整记录集",
      "scenario_name": "生产调度", "scenario_id": 1,
      "ontology_name": "原材料采购和库存", "ontology_id": 1,
      "depends_on": []
    },
    {
      "seq": 2, "kind": "function",
      "behavior": "sumRawNotArrivalQty",
      "params": {
        "filterRawMaterialName": {"type":"string","value":"高强度钢板"},
        "currentDate": {"type":"string","value":"2026-08-09"},
        "purchaseRecordSet": {"type":"array","value":{"$ref":1,"path":"data"}}
      },
      "description": "计算高强度钢板未到位采购量",
      "guidance": "对第1步查询的采购记录，过滤到位时间晚于当前日期的部分，对 arrivalQuantity 求和",
      "scenario_name": "生产调度", "scenario_id": 1,
      "ontology_name": "原材料采购和库存", "ontology_id": 1,
      "depends_on": [1]
    },
    {
      "seq": 3,                              // kind 省略 → behavior
      "behavior": "CreatePurchaseRecord",
      "params": {
        "rawMaterialId":   {"type":"string","value":"RM-001"},
        "rawMaterialName": {"type":"string","value":"高强度钢板"},
        "arrivalQuantity": {"type":"number","value":""},   // ← v1：由父Agent 波反馈填 110（方式A）
        "supplierName":    {"type":"string","value":"宝钢钢铁集团"},
        "arrivalTime":     {"type":"string","value":"2026-09-10"},
        "unit":            {"type":"string","value":"吨"}
      },
      "description": "创建高强度钢板的补货采购单",
      "guidance": "补货数量取第2步函数计算出的未到位总量",
      "scenario_name": "生产调度", "scenario_id": 1,
      "ontology_name": "原材料采购和库存", "ontology_id": 1,
      "depends_on": [2]
    }
  ],
  "reasoning": "先查记录，再函数汇总未到位量，超过阈值才补货创建采购单，形成依赖链 1→2→3"
}
```

> 注意：seq1/seq3 不写 kind（缺省 behavior）；seq3 的 `arrivalQuantity.value` 在初始规划是**空串**（必填参数，等待补充）。这正是现状"必填参数缺值由子Agent/父Agent 补"的闭环，v1 不写 `$ref`。

### 7.2 Wave 1 → 子任务1（行为，读，runSubtask case 'behavior'）

子Agent 执行 `executeOntoBehavior`，后端返回（SQL 行为信封，`data` 即 SKILL.md §3.5 声明结构）：

```json
{ "result": { "data": [
  { "purchaseRecordId": "PO-2026-001", "rawMaterialName": "高强度钢板", "arrivalTime": "2026-09-01", "arrivalQuantity": 60 },
  { "purchaseRecordId": "PO-2026-002", "rawMaterialName": "高强度钢板", "arrivalTime": "2026-09-15", "arrivalQuantity": 50 },
  { "purchaseRecordId": "PO-2026-003", "rawMaterialName": "高强度钢板", "arrivalTime": "2026-08-01", "arrivalQuantity": 80 }
]}}
```

`safeParseData` → `Map[1].data` = 上面数组。`SubTaskResult{seq:1, success:true, summary:…, data:[…]}`。

### 7.3 Wave 2 → 子任务2（函数，runSubtask case 'function'，无子Agent）

```
resolveParams(seq2.params, Map):
   purchaseRecordSet.value ← resolveValue({$ref:1,path:"data"}, Map) → Map[1].data（3条）
   → seq2.params = {filterRawMaterialName:"高强度钢板", currentDate:"2026-08-09", purchaseRecordSet:[3条]}

callOntoFunction(1, 'sumRawNotArrivalQty', seq2.params)
   → executeOntoFunction → POST /api/ontologies/1/functions/sumRawNotArrivalQty/execute
```

后端按 `code_file`（`functions/sumRawNotArrivalQty.py`）执行：**过滤 `arrivalTime < 2026-08-09` 的记录**（PO-…-003 的 08-01 被剔除），剩余 `60 + 50 = 110`，返回：

```json
{ "result": { "rawMaterialName": "高强度钢板", "sumNotArrivalQty": 110 } }
```

`Map[2].data` = `{ rawMaterialName, sumNotArrivalQty: 110 }`。**全程无LLM、无弹窗、无规则。**

### 7.4 Wave 3 → 子任务3（行为，110 怎么进入 `arrivalQuantity`）

**v1 只走方式A（行为参数不用 `$ref`）**

```
Wave2 完成 → 存在后续子任务 depends_on 本波（seq3 depends_on 2）→ runWaveFeedback 触发
    → 父Agent 读到"未到位总量110" → 提交调整后规划：seq3.arrivalQuantity.value = 110
    → Wave3 子Agent 拿到已填参数执行
```

**方式A / 方式B 的职责分工（已确认）**：

| 职责 | 谁来做 | v1 是否启用 |
|---|---|---|
| 决策流（110>100 要不要跑 seq3、怎么调整） | 只能父Agent（会推理），走反馈中继 | ✅ 必须（结构性必需） |
| 值填充（110 怎么进参数）——函数子任务输入 | 确定性 `$ref`（方式B） | ✅ 函数子任务专用 |
| 值填充——行为子任务参数 | v1：父Agent 反馈填值（方式A）；v2：`$ref` 视效果再定 | ⏸ 行为参数 `$ref` 延后 |

- **方式A 兜底含义**：方式B 表达不了的场景（要算过的值 / 要进 guidance / 要判断取其一 / 下游要上下文）→ 父Agent 反馈里加工后写字面量或指导文字。它不是"备而不用"——决策场景下是必经路径。
- **方式B 风险收敛（2026-08-09 决策）**：v1 只让函数子任务用 `$ref`（输入错了只是算错一个数，无副作用、结果可见），不放进写操作参数，把"静默错误数据进写操作"挡在 v1 之外。行为参数 `$ref` 若 v2 放开，须加两道闸：① 只允许"父Agent 已看到结果后的 `$ref`"（跨波反馈期写，不许初始规划预测结构）；② 用 SKILL.md 声明结构做 path 前缀校验（取到的字段必须是声明里存在的）。

之后照常：**安全管控弹窗**（CreatePurchaseRecord 有 securities 登记）→ 用户确认 → 执行 → 返回采购单号，最终总结。

### 7.5 SSE 事件流 / 执行记录序列（预期）

```
plan_received   { plan: [seq1, seq2, seq3]（enrichPlanDisplay 后，kind 已归一化） }
token           📋 执行计划 ……
exec_entry      父Agent规划完成（3个子任务）
subtask_start   seq1 QueryPurchaseRecords（kind:behavior）
tool_call       QueryPurchaseRecords running/done（data 捕获）
subtask_done    seq1 done
subtask_start   seq2 sumRawNotArrivalQty（kind:function，无弹窗）
subtask_done    seq2 done（result: 未到位总量110）
feedback        running → done
exec_entry      子任务结果分析（父Agent 填值 110）
subtask_start   seq3 CreatePurchaseRecord
security_confirm 审核采购必要性 → 用户确认
tool_call       CreatePurchaseRecord running/done
subtask_done    seq3 done
exec_entry      父Agent执行总结
done
```

### 7.6 波反馈 prompt 实际文本（`runWaveFeedback` 改造后）

```
本波次已执行完毕，共 1 个子任务。

【执行结果】
- 子任务 2（sumRawNotArrivalQty）: 未到位总量 110
  [结构化输出] {"rawMaterialName":"高强度钢板","sumNotArrivalQty":110}

请分析：
1. 各结果是否符合预期？……
2. 后续未开始的子任务是否需要本次结果中的数据？……
3. 【提前终止判断】……
【数据传播（必须）】
若后续未开始的某个子任务的 params 或 guidance 依赖本次结果中产生的新数据，必须调用 submit_plan 提交调整后的规划，把数据填入对应子任务的 params / guidance。
```

---

## 八、代码改动清单（实现级，逐文件）

### 8.1 [types.ts](agent-backend/src/types.ts)

```ts
type SubTaskKind = 'behavior' | 'function';   // 开放联合，未来加成员（见 3.5）

export interface SubTask {
  kind?: SubTaskKind;                        // 缺省归一化为 'behavior'
  behavior: string;
  // …不变
}
export interface SubTaskResult {
  data?: any;                                // 新增，kind 无关
  // …不变
}
```

### 8.2 [agent-ports.ts](agent-backend/src/agent/agent-ports.ts)

```ts
export interface OntologyGatewayPort {
  // …现状
  /** 本体函数英文名列表（kind:'function' 校验用） */
  getFunctionNames(scenario: string, ontology: string): string[];
}

export interface AgentFactoryPort {
  // …现状
  /** 确定性执行本体函数（无子Agent）：返回解析后的 {result} 结构；isError 抛错 */
  callOntoFunction(ontologyId: number, functionName: string, params: Record<string, any>): Promise<any>;
}
```

### 8.3 [ontology-gateway.ts](agent-backend/src/services/ontology-gateway.ts)

```ts
getFunctionNames(scenario: string, ontology: string): string[] {
  const data = this.loadOntologyData(scenario, ontology);
  return (data?.functions || []).map((f: any) => f.name).filter(Boolean);
}
```

### 8.4 `ref-resolver.ts`（新增）

见第六章 6.2 完整实现 + 6.6 用例。

### 8.5 [param-contract.ts](agent-backend/src/agent/param-contract.ts)

现状 `requiredParamNames(meta: BehaviorMeta)` 与 `validateParamStructure(meta, provided, seq, behavior)` 都从 `meta.params` 取参数声明。**泛化为直接收 `params`**（行为/函数共用）：

```ts
export function requiredParamNames(params: Record<string, any>): string[] {
  return Object.entries(params || {})
    .filter(([, s]) => (s as ParamSpec)?.required)
    .map(([k]) => k);
}

export function validateParamStructure(
  declared: Record<string, any>,          // 行为 meta.params 或 函数 functions[].params
  provided: Record<string, any>,
  seq: number,
  label: string,                          // 行为英文名 或 函数英文名
): string[] { /* 逻辑不变，把 meta.params 换成 declared */ }
```

**调用点同步改**：
- [subtask-runner.ts:84](agent-backend/src/agent/subtask-runner.ts#L84)：`requiredParamNames(meta)` → `requiredParamNames(meta.params)`
- [plan-validation.ts:29](agent-backend/src/agent/plan-validation.ts#L29)：`validateParamStructure(meta, …)` → `validateParamStructure(meta.params, …)`

### 8.6 [plan-validation.ts](agent-backend/src/agent/plan-validation.ts)

```ts
/** 行为/函数名合法性：按 kind 取对应名称集合（switch 映射，见 3.5） */
export function validateBehaviorNames(gateway: OntologyGatewayPort, plan: SubTaskPlan): InvalidBehavior[] {
  const invalid: InvalidBehavior[] = [];
  for (const st of plan.subtasks) {
    const names = st.kind === 'function'                      // 归一化后 kind 必为 'behavior'|'function'
      ? gateway.getFunctionNames(st.scenario_name, st.ontology_name)
      : gateway.getBehaviorNames(st.scenario_name, st.ontology_name);
    if (!names.includes(st.behavior)) invalid.push({ sub: st, valid: names });
  }
  return invalid;
}

/** 参数结构校验：按 kind 取参数声明 */
export function validateParamsStructure(gateway: OntologyGatewayPort, plan: SubTaskPlan): string[] {
  const errors: string[] = [];
  for (const st of plan.subtasks) {
    const declared = st.kind === 'function'
      ? gateway.getFunctionParams(st.scenario_name, st.ontology_name, st.behavior) ?? {}
      : gateway.getBehaviorMeta(st.scenario_name, st.ontology_name, st.behavior).params || {};
    errors.push(...validateParamStructure(declared, st.params || {}, st.seq, st.behavior));
  }
  return errors;
}

/** $ref 目标校验：只查函数子任务（v1 唯一用 $ref 者） */
export function validateRefTargets(plan: SubTaskPlan): string[] {
  const errors: string[] = [];
  const seqs = new Set(plan.subtasks.map(st => st.seq));
  for (const st of plan.subtasks) {
    if (st.kind !== 'function') continue;
    for (const ref of collectRefs(st.params)) {
      if (!seqs.has(ref.seq)) {
        errors.push(`子任务 ${st.seq}(${st.behavior}) 的 $ref 引用了不存在的子任务 ${ref.seq}`);
      } else if (!(st.depends_on || []).includes(ref.seq)) {
        errors.push(`子任务 ${st.seq}(${st.behavior}) 的 $ref 引用了非上游子任务 ${ref.seq}，请在 depends_on 声明`);
      }
    }
  }
  return errors;
}
```

并在 [orchestrator.ts](agent-backend/src/agent/orchestrator.ts) 的 `repairPlan` 链上新增一道 `validateRefTargets`（与 `validatePlanDeps` 并列，nudge 文案说明 `$ref` 只能引用 depends_on 上游）。

### 8.7 [agent-factory.ts](agent-backend/src/agent/agent-factory.ts)

- 新增 `callOntoFunction`（见 3.3 实现草案）；
- `createSubmitPlanTool` schema 的 `subtasks` 项加 kind：
  ```ts
  kind: Type.Optional(Type.Union([
    Type.Literal('behavior'),
    Type.Literal('function'),
  ])),
  ```
- 不改 `PARENT_MCP_EXCLUDED` / `CHILD_MCP_TOOL_NAMES` / `scopeToOntology`（函数子任务不走子Agent）。

### 8.8 [subtask-runner.ts](agent-backend/src/agent/subtask-runner.ts)

- `run()` 内 `let primaryResultData: any = null;`
- `tool_execution_end` 分支加主行为 data 捕获（见 4.1）；
- 成功返回路径 merge `data: primaryResultData`（失败路径 data 不设置）；
- 其余（buildInstruction / 安全确认 / 重试 / extractResult）**不改**。

### 8.9 [orchestrator.ts](agent-backend/src/agent/orchestrator.ts)

1. 规划校验阶段：**kind 归一化** `st.kind ??= 'behavior'`（enrichPlanDisplay 前）；
2. 新增实例字段/局部 `resultDataMap: Map<number, any>`（runExecute 内初始化，`runBatch` 后从每个 result 写入）；
3. `runBatch`：先按 kind 分流（函数 → fnTasks，行为按现状 secured/plain）；
4. 新增 `runSubtask`（switch 分发，kind 接缝，见 3.4）+ `runFunctionSubtask`；`runBehaviorSubtask` = 现状 `runSubtaskEntry`（改名/包裹，签名不变）；
5. `runWaveFeedback`：`waveList` 每条附带 `r.data` 的 JSON（截断如 2000 字符）；
6. `enrichPlanDisplay`：按 kind 分支取 `getFunctionMeta().display_name` 或 `getBehaviorMeta().display_name`；
7. 规划摘要打印（[orchestrator.ts:345-348](agent-backend/src/agent/orchestrator.ts#L345)）：函数子任务加 `（函数）` 标记（可选，展示友好）。

### 8.10 [prompts.ts](agent-backend/src/agent/prompts.ts)

`PARENT_SYSTEM_PROMPT` 增补（草案全文见第十三章）：
- `submit_plan` 参数规范表加 `kind` 字段说明；
- 3.3 子任务规划约束加一条"函数子任务"约束；
- 3.4 参数来源闭环加"④ 上游函数计算输出"；
- 新增 `$ref` / `concat` 语法教学段。

### 8.11 前端 [AgentApp.tsx](frontend/src/components/Design/AgentApp.tsx)

- 规划确认弹窗的子任务条目：`st.kind === 'function'` 时，标题用 `getFunctionMeta` 的中文名（若后端已 enrichPlanDisplay），并加「函数」徽标；`kind==='behavior'` 加「行为」徽标（可选）；
- 不改其余展示逻辑。

### 8.12 不改的文件清单

`CHILD_SYSTEM_PROMPT`、`createChildAgent`、`SubtaskRunner.run` 主体（安全/重试/指令组装）、`mcp-client.ts`、`mcp-config-store.ts`、`error-budget.ts`、core-backend（`mcp_server_sse.py`/`routers/functions.py` 已支持 executeOntoFunction）。

---

## 九、错误处理矩阵（汇总）

| # | 错误 | 阶段 | 处理 | 终止 run? |
|---|---|---|---|---|
| 1 | kind 值非法 | 规划 | schema 拒绝 + nudge | 否 |
| 2 | 行为名/函数名不存在 | 规划 | nudge 父Agent 修正（最多1次） | 否 |
| 3 | 参数缺必填/类型不符 | 规划 | nudge 父Agent 修正 | 否 |
| 4 | `$ref` 引用不存在 seq | 规划 | nudge 父Agent 修正 | 否 |
| 5 | `$ref` 引用非上游 | 规划 | nudge 父Agent 修正 | 否 |
| 6 | `$ref` 上游 data=null | 执行 | 函数子任务硬失败 | 是（fail-fast） |
| 7 | path 越界 | 执行 | 函数子任务硬失败 | 是 |
| 8 | callOntoFunction isError | 执行 | 函数子任务失败 | 是 |
| 9 | 函数返回非 JSON | 执行 | 函数子任务失败 | 是 |
| 10 | 行为 data 解析失败 | 执行 | data=null 不抛错 | 否 |
| 11 | 规划含环/悬空依赖 | 规划 | 现状 validatePlanStructure | 否 |

> fail-fast 理由：函数失败 = 规划写错（$ref 错/参数错/上游没数据），继续跑只会连环错。与现状"波内任一失败终止 run"一致。未来 kind 失败语义可逐 kind 声明（3.5）。

---

## 十、测试计划

### 10.1 单测（vitest）

| 模块 | 测试文件 | 覆盖 |
|---|---|---|
| ref-resolver | `ref-resolver.test.ts` | 6.6 的 15 条用例 |
| plan-validation | `plan-validation.test.ts`（扩展现有） | kind 归一化、函数名合法/非法、函数参数校验、validateRefTargets 三态、kind 非法 |
| param-contract | `param-contract.test.ts` | 泛化后签名回归 |
| agent-factory | `agent-factory.test.ts`（扩展现有） | callOntoFunction mock（成功/失败/非JSON）、kind schema 校验 |
| subtask-runner | `subtask-runner.test.ts`（扩展现有） | 主行为 data 捕获（含规则查询不覆盖）、解析失败=null |
| orchestrator | `orchestrator.test.ts`（扩展现有） | runSubtask switch 分发、函数与行为并行、函数子任务执行、resultDataMap 累积、波反馈带 data |

### 10.2 E2E 场景（参照 [e2e-confirm-policy.py](agent-backend/scripts/e2e-confirm-policy.py) 的 SSE 逐字节方式）

1. **主场景**：查记录→函数算未到位量→创建补货单（7.x 全链），验证：函数子任务无弹窗、`data` 进父Agent、110 填入 seq3、安全弹窗正常、总结含采购单号；
2. **纯函数结果**：用户只要"算一下未到位量"（函数作终点），验证最终总结含结果；
3. **函数失败**：上游行为无输出/$ref 越界 → 函数子任务失败、run 终止、错误文案清晰；
4. **回归**：纯行为规划（无 kind）全流程不变（归一化 behavior 不破坏现状）。

### 10.3 回归清单（现有功能不能坏）

- 纯行为子任务的读/写/安全弹窗/规则校验；
- 波反馈文本中继（行为→行为数据传播）；
- 规划确认（多步弹窗/单步跳过/拒绝重规划）；
- 中断（abort）路径；
- 现有 orchestrator/subtask-runner 单测全绿。

---

## 十一、风险与回退

### 11.1 风险清单

| 风险 | 等级 | 缓解 |
|---|---|---|
| R1 现有主循环被改坏（runBatch/runSubtaskEntry） | 高 | Step 6 前先跑全量现有单测；改后回归；手边留基线 diff |
| R2 行为 `data` 捕获抓错工具调用（覆盖成规则查询结果） | 中 | 严格 key 在 `behavior_name === subTask.behavior`；单测覆盖 |
| R3 父Agent 写错 `$ref` path（含 SQL/API 信封差异） | 中 | 规划期校验 + 执行期硬失败响亮报错（v1 函数子任务，不碰写操作）+ prompt 教"按上游返回结构写 path" |
| R4 提示词教学不足导致父Agent 不会用 kind/`$ref` | 中 | 多轮手测调 prompt（Step 7 单独验收） |
| R5 函数/行为并发写 `resultDataMap` | 低 | Node 事件循环单线程，Map 写入原子；依赖强制分波保证数据源就绪后才被读 |
| R6 kind 扩展时漏改联动点 | 低 | 3.5 的 7 步清单兜底（含 prompt 第 7 步） |

### 11.2 回退方案

```bash
git reset --hard 4863a88    # 整库回退到纯行为编排
```

若只想回退单个文件，用 `git checkout 4863a88 -- <file>`。设计文档 `docs/function-subtask-design.md` 独立于代码，不影响回退。

### 11.3 易错点看板（Step 5/6 实施检查清单）

> 按风险从大到小。A/C 是"改错就炸"，命门是"跑得通但频繁失败"。

**命门：父Agent 的 `$ref` 正确性**（本方案最大的非代码挑战）
- path 必须对上上游信封：SQL 行为 `result.data` / API 行为 `data` / 函数 `result.xxx`；
- seq 必须与 `depends_on` 一致；函数子任务必须带 `kind:'function'`；
- 错得频繁时 run 会反复硬失败 → prompt 教学（13.4）+ 规划期 `validateRefTargets` + 执行期 `walkPath` 硬失败，三道防线兜底，但体验命门仍在。

**陷阱 A — `runBatch` 顺序（最高危，改错就炸）**

| 项 | 内容 |
|---|---|
| 症状 | 函数子任务在分流前被 `getBehaviorMeta` 取空 meta → 参数校验/安全判定崩 |
| 错误写法 | batch 级先对**每个**子任务 `getBehaviorMeta`，再按 kind 分流 |
| 正确写法 | 先安全分流：行为写→secured[]；**函数+行为读→plain[]**；meta 只在 `runBehaviorSubtask` 内按需解析 |
| 防 | Step 6 单测：函数子任务必须不经 getBehaviorMeta 也能跑通 |

**陷阱 B — 行为 `data` 捕获判别（subtask-runner.ts）**

| 项 | 内容 |
|---|---|
| 症状 | data 捕获成前置规则取数的结果，或主行为被调多次时抓错一次 |
| 错误写法 | 取"最后一次 executeOntoBehavior 调用" |
| 正确写法 | key 在 `behavior_name === subTask.behavior`；规则同名调用要排除（规则取数发生在主行为之前） |
| 防 | 单测：构造"规则查询 + 主行为"两次调用，断言只捕主行为 |

**陷阱 C — `JSON.parse` 失败连锁**

| 项 | 内容 |
|---|---|
| 症状 | 一个行为返回非 JSON（如 text/plain）→ data=null → 下游函数 `$ref` 硬失败 → 全 run 终止 |
| 错误写法 | parse 失败抛异常（把行为子任务本身也炸了） |
| 正确写法 | `safeParseData` 失败置 null **绝不抛**；行为子任务本身不受影响 |
| 防 | 单测"非 JSON → data=null"；E2E 覆盖一次非 JSON 返回 |

**陷阱 D — `ref-resolver` 边界判断**

| 项 | 内容 |
|---|---|
| 症状 | 业务参数恰好长成 `{$ref,path}` 被误展开；concat 混标量/数组类型错 |
| 防 | 15 条单测锁死（含 6.6 用例 13：带业务键的 `$ref` 不误判） |

**陷阱 E — 波反馈数据截断**

| 项 | 内容 |
|---|---|
| 症状 | data 大时截断（2000字符），父Agent 拿不全填错下游参数 |
| 防 | 截断值按需调整；E2E 验证大 data 时父Agent 仍能提取关键字段 |

**回归点（容易被低估）**：`runBatch`/`runSubtaskEntry` 是**所有现有行为子任务的必经路**。改动前跑现状单测全绿；Step 6 后补一轮现状行为 e2e（读/写/安全弹窗/波反馈），再进 Step 7。

---

## 十二、实施顺序（含每步验收标准）

| 步 | 内容 | 文件 | 验收标准 |
|---|---|---|---|
| 1 | ref-resolver + 单测 | `ref-resolver.ts`(+test) | 15 条用例全绿 |
| 2 | 类型与网关 | `types.ts`/`agent-ports.ts`/`ontology-gateway.ts` | tsc 全绿 |
| 3 | callOntoFunction + kind schema | `agent-factory.ts` | mock 单测通过；手测 curl executeOntoFunction |
| 4 | 校验分流 + kind 归一化 | `param-contract.ts`/`plan-validation.ts` | 现有单测回归 + 新增用例 |
| 5 | 行为 data 捕获 | `subtask-runner.ts` | 现有单测回归 + data 捕获用例 |
| 6 | 编排核心（runSubtask switch + 并行池） | `orchestrator.ts` | 现有单测回归 + 函数子任务 e2e + 函数/行为并行验证 |
| 7 | 提示词教学 | `prompts.ts` | 手测父Agent 提交含 kind/`$ref` 的规划 |
| 8 | 前端徽标 | `AgentApp.tsx` | 手测弹窗显示 |
| 9 | 全链路 E2E | 脚本 | 10.2 四场景通过 |

> 依赖：Step 6 前必须完成 Step 5（行为 data 捕获是函数 `$ref` 的数据源）。Step 1/2/3/4 可并行。

---

## 十三、Prompt 教学文案草案（PARENT_SYSTEM_PROMPT 增补）

### 13.1 `submit_plan` 参数规范表新增

```
| kind | ❌ | 子任务类型：behavior（行为子任务，可省略）/ function（函数子任务）。
       kind:'behavior' 时 behavior 字段存行为名；kind:'function' 时 behavior 字段存函数名。
       函数子任务只调 1 个本体函数，输入数据来自上游依赖子任务的输出 |
```

### 13.2 3.3 子任务规划约束新增

```
| 6 | **函数子任务** | 需要按上游输出做汇总计算时，可规划 kind:'function' 子任务。
     函数子任务只调 1 个本体函数；不适用规则/安全确认；必须用 depends_on 声明数据来源。
     行为子任务省略 kind 即可（缺省即 behavior） |
```

### 13.3 3.4 参数来源闭环新增

```
| ④ 上游函数计算输出 | 上游函数子任务算出的值 | 用 depends_on 声明依赖；下游行为子任务需该值时在 guidance 注明"实际值由波次反馈中继填入" |
```

### 13.4 新增 `$ref` 绑定语法段

```
### 3.5 函数子任务的数据绑定（$ref）
函数子任务的数据来自上游依赖子任务的输出。在 params 的 value 中写 $ref 标记绑定：
- {"$ref": <上游seq>, "path": "<字段路径>"}   取上游输出的指定字段，path 可空（整取 data）或点路径/下标（如 data[0].arrivalQuantity）
- {"concat": [{"$ref":…}, {"$ref":…}, 字面量]}   多源拼装成数组（标量自动包一层）
示例：purchaseRecordSet = {"type":"array","value":{"$ref":1,"path":"data"}}
约束：$ref 引用的 seq 必须已用 depends_on 声明为上游；不得引用兄弟或后续子任务。
路径写法按上游行为的实际返回结构：API 行为取 data；SQL 行为取 result.data；函数取 result.xxx（详见 SKILL.md 声明的输出结构）。
```

---

## 十四、v2 遗留（本方案明确不做）

1. **行为参数 `$ref`（方式B进行为）**：须加两道闸（只允许"父Agent 已看到结果后的 `$ref`" + SKILL.md 声明结构 path 前缀校验）；
2. `$ref` 表达式扩展：算术、条件、通配、函数调用（如 `length()`）；
3. 结构化 `data` 持久化/留档（执行记录可点开完整数据集 / 跨对话复用）；
4. 函数子任务的"本对话默认执行"信任机制（关联 `security-confirm-trust` 设计，若函数将来接安全语义）；
5. **第三个 kind**（如 validation/decision/approval）——接缝已留（3.5），按 7 步清单接入。
