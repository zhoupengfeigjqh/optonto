/**
 * 规划闸门 —— 规划（初始/波次调整共用）进入执行前的完整校验链 + 修复循环。
 *
 * 六个校验器共享同一骨架 repairPlan（校验 → 有错则记录执行流水 + 复位 holder + nudge 父Agent
 * 最多 1 次 → 复验），各自只差校验器与提示文案；约束校验是特例（取值范围硬中断不 nudge）。
 *
 * 从 Orchestrator 拆出后本模块即测试面：修复循环的"修正一次/复验不过判废"可脱离 execute() 全路径直测。
 */
import { validateBehaviorNames, validateFunctionNames, validateAllParams, validateAllConstraints, validatePlanStructure, validateSeqConflicts } from './plan-validation.js';
import type { InvalidTaskName } from './plan-validation.js';
import { renderParamStructure, validateParamStructure, type ParamSpec } from './param-contract.js';
import type { OntologyGatewayPort } from './agent-ports.js';
import type { AgentPort } from './agent-port.js';
import type { EventChannel } from './event-channel.js';
import type { FunctionCatalogView } from './function-catalog.js';
import type { PlanSubmission } from './run-session.js';
import type { SubTaskPlan } from '../types.js';

/** 规划修复上下文：nudge 父Agent 所需三件套 + run 级函数目录快照打包，替代 4-5 参穿透。
 *  submittedPlan 只经 PlanSubmission 口操作（reset 复位-重提协议 / peek 读最新提交） */
export interface PlanRepairCtx {
  parentAgent: AgentPort;
  submittedPlan: PlanSubmission;
  emit: EventChannel;
  catalog: FunctionCatalogView;
}

/** 规划闸门依赖：本体元信息 + 带超时的父Agent prompt（orchestrator 注入其 parentPrompt） */
export interface PlanGateDeps {
  gateway: OntologyGatewayPort;
  promptParent: (agent: AgentPort, text: string) => Promise<void>;
}

export class PlanGate {
  constructor(private deps: PlanGateDeps) {}

  /** seq 冲突校验（校验链首）：规划内 seq 唯一 + 反馈路径防"新任务冒名已执行 seq"。非法时提示父Agent 修正（最多1次）。返回修正后的规划，无法修正返回 null。 */
  async validateTaskSeqs(plan: SubTaskPlan, ctx: PlanRepairCtx, executedTasks?: ReadonlyMap<number, string>): Promise<SubTaskPlan | null> {
    return this.repairPlan(plan, ctx, {
      label: 'seq 冲突校验',
      doneLabel: 'seq 冲突已修正',
      detailOf: (p) => validateSeqConflicts(p, executedTasks).join('；'),
      isClean: (p) => validateSeqConflicts(p, executedTasks).length === 0,
      nudge: (p) => `以下子任务的 seq 不合法：\n${validateSeqConflicts(p, executedTasks).join('；')}\n\n请重新分配 seq：规划内不得重复；新增子任务不得占用已执行子任务的 seq（改用未占用的 seq），保持其余内容不变，然后重新调用 submit_plan 工具提交修正后的规划。`,
    });
  }

  /** 校验行为子任务的行为名合法性（gateway 花名册，按子任务所属本体过滤）；非法时提示父Agent 自动修正（最多1次）。返回修正后的规划，无法修正返回 null。 */
  async validateTaskBehaviorNames(plan: SubTaskPlan, ctx: PlanRepairCtx): Promise<SubTaskPlan | null> {
    const invalidOf = (p: SubTaskPlan): InvalidTaskName[] => validateBehaviorNames(this.deps.gateway, p);
    return this.repairPlan(plan, ctx, {
      label: '行为名校验',
      doneLabel: '行为名已修正',
      detailOf: (p) => `不存在的 behavior: ${invalidOf(p).map(iv => `子任务${iv.sub.seq}: ${iv.sub.behavior}（${iv.sub.scenario_name}/${iv.sub.ontology_name}）`).join('、')}`,
      isClean: (p) => invalidOf(p).length === 0,
      nudge: (p) => {
        const invalid = invalidOf(p);
        // 按子任务分行列各自的合法名单（不合并成总表）：跨本体规划中合并名单会导致父 Agent
        // 跨本体误选、白白浪费唯一的修正机会；valid 为空（本体无行为/yaml缺失）时给删除或换本体的出口
        const lines = invalid.map(iv => {
          const head = `- 子任务${iv.sub.seq}（${iv.sub.behavior}，${iv.sub.scenario_name}/${iv.sub.ontology_name}）`;
          return iv.valid.length > 0
            ? `${head}，合法行为名有：${iv.valid.join('、')}`
            : `${head}，该本体下没有任何合法行为名——请检查 scenario_name/ontology_name 是否填错，或删除该子任务`;
        });
        return `以下子任务的 behavior 不在其所属场景/本体的合法集合中：\n${lines.join('\n')}\n请严格按各子任务对应的合法名单修正（严禁跨子任务借用名单），保持其余子任务不变，然后重新调用 submit_plan 工具提交修正后的规划。`;
      },
    });
  }

  /** 校验函数子任务的函数名合法性（FunctionCatalog 三源合一：本体函数按本体过滤 ∪ 公共函数 ∪ 其他MCP工具）；非法时提示父Agent 自动修正（最多1次）。返回修正后的规划，无法修正返回 null。 */
  async validateTaskFunctionNames(plan: SubTaskPlan, ctx: PlanRepairCtx): Promise<SubTaskPlan | null> {
    const catalog = ctx.catalog; // run 级快照（session.catalogView），与执行展示同源同时刻
    const invalidOf = (p: SubTaskPlan): InvalidTaskName[] => validateFunctionNames(catalog, p);
    return this.repairPlan(plan, ctx, {
      label: '函数名校验',
      doneLabel: '函数名已修正',
      detailOf: (p) => `不存在的 function: ${invalidOf(p).map(iv => `子任务${iv.sub.seq}: ${iv.sub.function}（${iv.sub.scenario_name}/${iv.sub.ontology_name}）`).join('、')}`,
      isClean: (p) => invalidOf(p).length === 0,
      nudge: (p) => {
        const invalid = invalidOf(p);
        // 按子任务分行列各自的合法名单（不合并成总表），与行为校验同构；valid 为空时给出口
        const lines = invalid.map(iv => {
          const head = `- 子任务${iv.sub.seq}（${iv.sub.function}，${iv.sub.scenario_name}/${iv.sub.ontology_name}）`;
          return iv.valid.length > 0
            ? `${head}，合法函数名有：${iv.valid.join('、')}`
            : `${head}，没有可用的合法函数名——请检查 scenario_name/ontology_name 是否填错，或删除该子任务`;
        });
        return `以下子任务的 function 不在合法函数集合中：\n${lines.join('\n')}\n请严格按各子任务对应的合法名单修正（严禁跨子任务借用名单；公共函数与其他MCP工具为全局工具，任何子任务都可用），保持其余子任务不变，然后重新调用 submit_plan 工具提交修正后的规划。`;
      },
    });
  }

  /** 参数结构校验：必填参数 key 齐全 + 类型匹配；非法时提示父Agent 修正（最多1次）。返回修正后的规划，无法修正返回 null。 */
  async validateTaskParams(plan: SubTaskPlan, ctx: PlanRepairCtx): Promise<SubTaskPlan | null> {
    const catalog = ctx.catalog; // run 级快照（session.catalogView）
    return this.repairPlan(plan, ctx, {
      label: '参数结构校验',
      doneLabel: '参数结构已修正',
      detailOf: (p) => validateAllParams(this.deps.gateway, catalog, p).join('；'),
      isClean: (p) => validateAllParams(this.deps.gateway, catalog, p).length === 0,
      nudge: (p) => {
        // 逐子任务取声明源并校验（与 validateAllParams 同口径：行为→gateway 行为声明，函数→catalog 三源），
        // 按子任务分组输出：错误清单 + 声明结构 sketch。sketch 用中继提示同款 renderParamStructure——
        // 父 Agent 修正时看到的结构 = 校验器判错的依据 = 中继填值的依据（单一事实源），不再让它绕路 load_skill。
        const blocks: string[] = [];
        for (const st of p.subtasks) {
          const declared = st.function
            ? (catalog.functionInfo(st.scenario_name, st.ontology_name, st.function)?.params ?? null)
            : this.deps.gateway.getBehaviorMeta(st.scenario_name, st.ontology_name, st.behavior)?.params;
          if (!declared) continue; // 无声明源 → 该校验器本就跳过（MCP 工具 schema 兜底）
          const errs = validateParamStructure(declared, st.params || {}, st.seq, st.function || st.behavior);
          if (errs.length === 0) continue; // 只给有错子任务出块
          const sketch = Object.entries(declared)
            .flatMap(([k, s]) => renderParamStructure(k, s as ParamSpec, {}, '  '));
          blocks.push(`- 子任务${st.seq}（${st.function || st.behavior}，${st.scenario_name}/${st.ontology_name}）\n  错误：\n${errs.map(e => `  · ${e}`).join('\n')}\n  参数声明结构（请严格按此修正）：\n${sketch.join('\n')}`);
        }
        return `以下子任务的参数不合法：\n${blocks.join('\n\n')}\n\n请逐项修正：必填参数 key 齐全（type/required/description/value 四键）、type 与 value 的类型与声明一致、缺失值留空字符串；保持行为与整体规划不变，然后重新调用 submit_plan 工具提交修正后的规划。`;
      },
    });
  }

  /**
   * 约束校验（校验链尾，声明源 = 关联概念属性 constraint 回溯）：
   * - 取值范围（number/integer 的 min/max，为空不查）：违例**直接中断报错**，不 nudge、不修复，
   *   fatalReason 携带明细提交给用户（2026-08-25 拍板：范围违例是数据可信度问题，不让 LLM 自修）。
   * - 枚举/匹配模式：违例不中断，nudge 父 Agent 修正一次，复验仍不过返回失败。
   * 返回 { plan, fatalReason? }（plan = null 时：有 fatalReason = 范围硬中断，无 = 枚举/模式修正失败）。
   */
  async validateTaskConstraints(plan: SubTaskPlan, ctx: PlanRepairCtx): Promise<{ plan: SubTaskPlan | null; fatalReason?: string }> {
    const rangeFatal = (rangeErrors: string[]): string => {
      ctx.emit.entry({ type: 'subtask_done', name: '取值范围校验', status: 'failed', detail: rangeErrors.join('；'), source: 'parent' });
      return `参数值超出取值范围：${rangeErrors.join('；')}`;
    };

    const first = validateAllConstraints(this.deps.gateway, plan);
    if (first.rangeErrors.length > 0) return { plan: null, fatalReason: rangeFatal(first.rangeErrors) };

    const firstErrors = [...first.enumErrors, ...first.patternErrors];
    if (firstErrors.length === 0) return { plan };

    // 违例不硬停：明细（含合法枚举清单/正则原文/路径/填值）带给父 Agent，修正一次
    ctx.emit.entry({ type: 'subtask_done', name: '枚举/匹配模式校验', status: 'failed', detail: firstErrors.join('；'), source: 'parent' });
    ctx.submittedPlan.reset(); // 只认本次修正后的新提交
    await this.deps.promptParent(ctx.parentAgent,
      `以下子任务的参数值违反声明的约束：\n${firstErrors.map(e => `· ${e}`).join('\n')}\n\n请逐项修正：枚举值必须改选为消息中列出的合法枚举值之一；不匹配模式的请将值转换为目标格式（如日期补零、去除多余空格/符号等）。保持行为与整体规划不变，然后重新调用 submit_plan 工具提交修正后的规划。`);
    const corrected = ctx.submittedPlan.peek();
    if (!corrected || !corrected.subtasks || corrected.subtasks.length === 0) return { plan: null };

    const again = validateAllConstraints(this.deps.gateway, corrected);
    if (again.rangeErrors.length > 0) return { plan: null, fatalReason: rangeFatal(again.rangeErrors) };
    if (again.enumErrors.length > 0 || again.patternErrors.length > 0) return { plan: null };
    ctx.emit.entry({ type: 'subtask_done', name: '枚举/匹配模式已修正', status: 'done', source: 'parent' });
    return { plan: corrected };
  }

  /**
   * 依赖结构校验（无自引用/无悬空依赖/无环）：非法时提示父Agent 修正（最多1次）。返回修正后的规划，无法修正返回 null。
   * executedSeqs：波次反馈中继路径传入已执行成功的 seq——dep 指向已执行子任务是合法的（"已完成"≠"不存在"），
   * 中继调整规划常只含剩余子任务，depends_on 仍引用前序已执行 seq。
   */
  async validatePlanDeps(plan: SubTaskPlan, ctx: PlanRepairCtx, executedSeqs: ReadonlySet<number> = new Set()): Promise<SubTaskPlan | null> {
    return this.repairPlan(plan, ctx, {
      label: '依赖结构校验',
      doneLabel: '依赖结构已修正',
      detailOf: (p) => validatePlanStructure(p, executedSeqs).join('；'),
      isClean: (p) => validatePlanStructure(p, executedSeqs).length === 0,
      nudge: (p) => `以下子任务的依赖关系不合法：\n${validatePlanStructure(p, executedSeqs).join('；')}\n\n请重新检查 depends_on（不能依赖自身、不能引用不存在的子任务、不能形成循环依赖；指向已执行完成的子任务是允许的），保持行为与参数不变，然后重新调用 submit_plan 提交修正后的规划。`,
    });
  }

  /**
   * 规划修复循环：跑校验器 → 有错则 pushEntry + 复位 holder + nudge 父Agent（最多1次）→ 复验。
   * 各 nudge 校验器共用此骨架，只差校验器与提示文案。
   * 返回修正后的规划；无法修正（复验仍有错 / 父Agent 未重提）返回 null。
   */
  private async repairPlan(
    plan: SubTaskPlan,
    ctx: PlanRepairCtx,
    opts: {
      label: string;
      doneLabel: string;
      detailOf: (p: SubTaskPlan) => string;
      isClean: (p: SubTaskPlan) => boolean;
      nudge: (p: SubTaskPlan) => string;
    },
  ): Promise<SubTaskPlan | null> {
    if (opts.isClean(plan)) return plan;

    ctx.emit.entry({ type: 'subtask_done', name: opts.label, status: 'failed', detail: opts.detailOf(plan), source: 'parent' });
    ctx.submittedPlan.reset(); // 只认本次修正后的新提交
    await this.deps.promptParent(ctx.parentAgent, opts.nudge(plan));
    const corrected = ctx.submittedPlan.peek();
    if (!corrected || !corrected.subtasks || corrected.subtasks.length === 0) return null;

    if (!opts.isClean(corrected)) return null;
    ctx.emit.entry({ type: 'subtask_done', name: opts.doneLabel, status: 'done', source: 'parent' });
    return corrected;
  }
}
