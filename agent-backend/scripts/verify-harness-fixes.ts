/**
 * 改进点回归验证（用新的端口缝驱动真实 Orchestrator，不连真实 SDK/LLM/MCP）。
 *  场景1：25 步串行链（每波 1 个，> MAX_ROUNDS=20）→ 必须触发波数上限，不再"报全部成功吞掉末尾"
 *  场景2：3 个独立子任务（一波并行）→ 正常全成功路径不受影响
 * 运行：npx tsx scripts/verify-harness-fixes.ts
 */
import { Orchestrator } from '../src/agent/orchestrator.js';
import { ConfirmManager } from '../src/agent/confirm-manager.js';
import type { PlanConfirmResult, ConfirmResult } from '../src/agent/confirm-manager.js';
import type { AgentPort } from '../src/agent/agent-port.js';
import type { AgentFactoryPort, OntologyGatewayPort } from '../src/agent/agent-ports.js';
import type { SubTaskPlan, BehaviorMeta, ThreadMessage, SkillSelection, SkillContext, SSEEvent } from '../src/types.js';

// ─── fakes ─────────────────────────────────────────────

type ParentMode = 'normal' | 'throw' | 'hang';

class FakeParent implements AgentPort {
  state: { messages: any[]; errorMessage?: string } = { messages: [], errorMessage: undefined };
  receivedPrompts: string[] = [];
  private plan: SubTaskPlan | null;
  private submit: (plan: SubTaskPlan) => void;
  private mode: ParentMode;

  constructor(plan: SubTaskPlan | null, submit: (plan: SubTaskPlan) => void, mode: ParentMode = 'normal') {
    this.plan = plan;
    this.submit = submit;
    this.mode = mode;
  }
  async prompt(input: string): Promise<void> {
    this.receivedPrompts.push(input);
    if (this.mode === 'throw') throw new Error('LLM API 调用失败'); // 守卫：异常应被兜底而非穿透
    if (this.mode === 'hang') return new Promise<void>(() => {}); // 守卫：永不 resolve，靠超时兜底
    if (this.plan) { this.submit(this.plan); this.plan = null; }
    this.state.messages.push({ role: 'assistant', content: '（faker 回复）', timestamp: Date.now() });
  }
  abort(): void {}
  subscribe(): void {}
}

class FakeChild implements AgentPort {
  state: { messages: any[]; errorMessage?: string } = { messages: [], errorMessage: undefined };
  async prompt(_input: string): Promise<void> {
    this.state.messages.push({ role: 'assistant', content: '子任务完成。【状态】成功', timestamp: Date.now() });
  }
  abort(): void {}
  subscribe(): void {}
}

class FakeFactory implements AgentFactoryPort {
  parent: FakeParent | null = null;
  receivedParentPrompts: string[] = [];
  constructor(private plan: SubTaskPlan | null, private mode: ParentMode = 'normal') {}
  async createParentAgent(
    _skills: SkillSelection[],
    _history: ThreadMessage[],
    _onSkillLoaded: (name: string) => void,
    onPlanSubmitted?: (plan: SubTaskPlan) => void,
  ): Promise<AgentPort> {
    const parent = new FakeParent(this.plan, (p) => onPlanSubmitted?.(p), this.mode);
    this.parent = parent;
    this.receivedParentPrompts = parent.receivedPrompts;
    return parent;
  }
  async createChildAgent(_context: SkillContext, _primaryBehavior?: string, _opId?: string, _requiredParams?: string[]): Promise<AgentPort> {
    return new FakeChild();
  }
  async closeAll(): Promise<void> {}
}

class FakeGateway implements OntologyGatewayPort {
  getBehaviorNames(_scenario: string, _ontology: string): string[] { return ['B']; }
  getBehaviorMeta(_scenario: string, _ontology: string, behavior: string): BehaviorMeta {
    return { params: {}, preRules: [], postRules: [], concepts: [], isWrite: false, display_name: behavior };
  }
  getFunctionMeta(_scenario: string, _ontology: string, functionName: string): { display_name: string; description?: string } {
    return { display_name: `函数-${functionName}`, description: '' };
  }
}

/** 自动通过规划确认 + 安全确认 */
class AutoConfirm extends ConfirmManager {
  async requestPlanConfirm(plan: SubTaskPlan, _sendEvent: (e: SSEEvent) => void): Promise<PlanConfirmResult> {
    return { approved: true, plan, reason: 'user' };
  }
  async requestConfirm(_behavior: string, _content: string, _params: any, _sendEvent: (e: SSEEvent) => void): Promise<ConfirmResult> {
    return { approved: true, reason: 'user' };
  }
}

// ─── 计划构造 ─────────────────────────────────────────

function serialPlan(n: number): SubTaskPlan {
  return {
    subtasks: Array.from({ length: n }, (_, i) => ({
      seq: i + 1,
      behavior: 'B',
      params: {},
      description: `子任务 ${i + 1}`,
      scenario_name: 'sc',
      scenario_id: 1,
      ontology_name: 'on',
      ontology_id: 1,
      depends_on: i === 0 ? undefined : [i],
    })),
  };
}

function independentPlan(n: number): SubTaskPlan {
  return {
    subtasks: Array.from({ length: n }, (_, i) => ({
      seq: i + 1,
      behavior: 'B',
      params: {},
      description: `子任务 ${i + 1}`,
      scenario_name: 'sc',
      scenario_id: 1,
      ontology_name: 'on',
      ontology_id: 1,
    })),
  };
}

// ─── 运行 ─────────────────────────────────────────────

async function run(plan: SubTaskPlan | null, opts?: { mode?: ParentMode; timeoutMs?: number }): Promise<{ factory: FakeFactory; summary: string }> {
  const factory = new FakeFactory(plan, opts?.mode);
  const orchestrator = new Orchestrator(factory, new FakeGateway(), new AutoConfirm(), opts?.timeoutMs);
  const summary = await orchestrator.execute('测试执行', [], [], () => {});
  return { factory, summary };
}

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? '✅ PASS' : '❌ FAIL'}  ${name}${cond ? '' : ` —— ${detail || ''}`}`);
  if (!cond) failed++;
}

// 场景1：25 步串行链 → 波数上限
{
  const { factory } = await run(serialPlan(25));
  const prompts = factory.receivedParentPrompts;
  const lastSummaryPrompt = prompts.find(p => p.startsWith('任务未全部完成'));
  const fakeSuccessPrompt = prompts.find(p => p.startsWith('所有子任务已执行完毕'));
  check('场景1: 触发"任务未全部完成"终结总结', !!lastSummaryPrompt);
  check('场景1: 总结点名波数上限', !!lastSummaryPrompt?.includes('执行波数已达上限，仍有 5 个子任务未执行'), lastSummaryPrompt?.slice(0, 80));
  check('场景1: 不再走"所有子任务已执行完毕"假成功', !fakeSuccessPrompt);
  check('场景1: 失败总结含"残留副作用必须点破"要求', !!lastSummaryPrompt?.includes('残留副作用必须点破'));
}

// 场景2：3 个独立子任务 → 正常全成功
{
  const { factory } = await run(independentPlan(3));
  const prompts = factory.receivedParentPrompts;
  const fakeSuccessPrompt = prompts.find(p => p.startsWith('所有子任务已执行完毕'));
  const failPrompt = prompts.find(p => p.startsWith('任务未全部完成'));
  check('场景2: 走"所有子任务已执行完毕"总结', !!fakeSuccessPrompt);
  check('场景2: 未误触发波数上限/失败分支', !failPrompt);
}

// 场景3：3 步串行（<=20 波）→ 正常全成功，不受波数修复影响
{
  const { factory } = await run(serialPlan(3));
  const prompts = factory.receivedParentPrompts;
  const fakeSuccessPrompt = prompts.find(p => p.startsWith('所有子任务已执行完毕'));
  check('场景3: 短串行链仍正常全成功', !!fakeSuccessPrompt);
}

// 场景4：父Agent prompt 抛异常 → 不被穿透，走守卫 catch（点破残留副作用）
{
  const { summary } = await run(serialPlan(3), { mode: 'throw' });
  check('场景4: 抛异常不穿透 execute（返回字符串而非抛出）', typeof summary === 'string' && summary.length > 0);
  check('场景4: 总结点名"执行中断"与异常原因', summary.includes('执行中断') && summary.includes('LLM API 调用失败'), summary.slice(0, 100));
}

// 场景5：父Agent prompt 挂起 → 超时兜底，不再无限等待
{
  const started = Date.now();
  const { summary } = await run(serialPlan(3), { mode: 'hang', timeoutMs: 100 });
  const elapsed = Date.now() - started;
  check('场景5: 挂起被超时兜底（未无限等待）', elapsed < 5000, `耗时 ${elapsed}ms`);
  check('场景5: 总结点名"父Agent 响应超时"', summary.includes('父Agent 响应超时'), summary.slice(0, 100));
}

console.log(failed === 0 ? '\n全部通过' : `\n${failed} 项失败`);
process.exit(failed === 0 ? 0 : 1);
