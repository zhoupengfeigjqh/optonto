'use client';

/**
 * 智能体 SSE 流接收与事件分发——自 `AgentConversation.tsx` 抽取。
 *
 * 抽取动因（2026-10-05，宪法 II 单文件 ≤500 行）：流式接收 + 事件分发约 190 行，
 * 与「历史加载 / 滚动跟随 / 弹窗接线 / 渲染」是四件不同的事，混在一个组件里
 * 既超行数上限又难测。本 hook 只负责「发一条消息 → 读流 → 把事件翻译成状态变更」，
 * 不碰渲染与布局，边界清晰。
 *
 * ## 状态机（分阶段路由）
 *
 * 本轮对话按 `phase` 分三段，事件路由依赖它：
 *   planning（父Agent 规划：narrative 流入思考区）
 *     → subtask（子任务执行：exec_entry 流入子任务块）
 *     → summary（最终总结：token 新开一条 assistant 消息）
 *
 * ## 三条不变量（改动时务必保持）
 *
 * 1. **runId 用闭包捕获，不用 ref 现读**：`runIdRef.current` 是跨 run 共享的可变量，
 *    在事件回调里现读会让并发/跨轮的事件串轮。故发消息时 `const runId = runIdRef.current`
 *    捕获为常量，回调内只认这个常量。
 * 2. **并发守卫用 ref 而非 state**：`setSending(true)` 到下次渲染之间存在窗口，
 *    同一 tick 内的两次调用（Enter 连按 / 按钮连点）都会读到 `sending === false`
 *    而双双通过 → 发出两个流。ref 是同步的，能真正做到「同一时刻只有一个 run」。
 * 3. **中断三步序**：① 先断本地流（立即反馈，且不再往正文写 token）→ ② 再关弹窗
 *    （后端 abortAll 会解锁待确认弹窗）→ ③ 最后通知后端。只通知后端的话本地 reader
 *    仍在收数据，UI 会继续增长（审查 C2）。
 */
import { useEffect, useRef, useState } from 'react';
import { message } from 'antd';
import type { Dispatch, SetStateAction } from 'react';
import { agentChatStream, type AgentMessage } from '@/api/agent-client';
import type { AssistantChatMessage, ChatMessage, SubtaskChatItem } from './chat-types';
import { isAssistantMessage, isSubtaskItem } from './chat-types';
import { isSSEEvent, type SubTaskPlan } from './sse-events';
import { mergeExecEntry, type LogEntry } from './execution-log';
import type { PlanConfirmState, SecurityConfirmState } from './use-confirm-replies';

/** 中断兜底时限（ms）：后端迟迟不发 done 时强制结束读循环，见 abortFallbackTimerRef */
const ABORT_FALLBACK_MS = 90_000;

/** 本轮对话的阶段（事件路由依赖它，故只能是同步可读的 ref 而非 state） */
type Phase = 'planning' | 'subtask' | 'summary';

export interface UseAgentStreamArgs {
  scenarioName: string;
  ontologyName: string;
  threadId: string;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setExecutionLog: Dispatch<SetStateAction<LogEntry[]>>;
  setPlanConfirmModal: Dispatch<SetStateAction<PlanConfirmState | null>>;
  setConfirmModal: Dispatch<SetStateAction<SecurityConfirmState | null>>;
  setConfirmedPlan: Dispatch<SetStateAction<SubTaskPlan | null>>;
  setInput: Dispatch<SetStateAction<string>>;
}

export interface UseAgentStream {
  /** 是否有 run 在进行中（驱动输入框禁用与「发送/中断」按钮切换） */
  sending: boolean;
  /** 「父Agent 正在处理」空窗提示（feedback running 期间为 true） */
  analyzing: boolean;
  /** 当前轮次 id（拒绝规划时定位要更新的 assistant 消息用） */
  currentRunId: () => number;
  /** 发送一条消息（text 需已 trim） */
  send: (text: string) => Promise<void>;
  /** 中断当前 run */
  abort: () => Promise<void>;
}

export function useAgentStream(args: UseAgentStreamArgs): UseAgentStream {
  const {
    scenarioName, ontologyName, threadId,
    setMessages, setExecutionLog, setPlanConfirmModal, setConfirmModal,
    setConfirmedPlan, setInput,
  } = args;

  const [sending, setSending] = useState(false);
  /** 父Agent 分析中（子任务间空窗提示） */
  const [analyzing, setAnalyzing] = useState(false);
  const phaseRef = useRef<Phase>('planning');
  /** 当前对话轮次 id（每次发消息自增），用于区分多轮对话的子任务块 */
  const runIdRef = useRef(0);
  /** 「正在发送」的同步镜像（并发守卫，见文件头不变量 2） */
  const sendingRef = useRef(false);
  /** 中断用的 AbortController：真正用于取消本地流读取 */
  const abortRef = useRef<AbortController | null>(null);
  /**
   * 挂起中的 `reader.read()` 的唤醒器集合（2026-10-06中断修复）。
   *
   * 经 nginx 代理的 SSE 在 AbortController.abort() 后，`read()` 可能既不返回也不抛错；
   * 若 send 循环只等 `read()` 的自然结束，UI 就卡在 sending。解决办法是让每次 read
   * 都与一个哨兵 Promise 竞速（`Promise.race([read(), aborted])`），中断时由哨兵兑现，
   * 循环立刻退出。waiter 在 finally 中注销，避免跨 run 泄漏。
   */
  const abortWaitersRef = useRef<Set<() => void>>(new Set());
  /**
   * 中断兜底定时器：后端迟迟不发 `done` 时强制唤醒读循环。
   *
   * 取 90s：中断后后端进入 `summaryPhase`，若父 Agent 未被一起打断（isChildAborted
   * 为 false），会调 LLM 生成「残留副作用点破」总结——`PARENT_PROMPT_TIMEOUT` 上限
   * 180s。兜底若太短（如 20s）会在 LLM 慢时截断这段**安全提示**，用户就看不到
   * 「已创建的采购单不会自动回滚」——这比"多转一会儿圈"严重得多。
   *
   * 代价可控：UI 在 abort() 内已即时复位，用户可继续操作；该定时器只在后端
   * 完全挂起（连接半开）时才真正触发。正常路径下 `done` 先到，finally 中清除。
   */
  const abortFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * 卸载时清理（这是本 hook 唯一的断连点）。
   *
   * `abort()` 刻意**不**断流，以便接收后端的中断总结；代价是在途请求会保持到流自然结束。
   * 若用户此时切换会话 / 关闭页面，连接与两个定时器都会泄漏，故在此收口。
   */
  useEffect(() => () => {
    abortRef.current?.abort();
    for (const wake of abortWaitersRef.current) wake();
    abortWaitersRef.current.clear();
    if (abortFallbackTimerRef.current) {
      clearTimeout(abortFallbackTimerRef.current);
      abortFallbackTimerRef.current = null;
    }
  }, []);

  /**
   * 中断当前 run。
   *
   * ## 为什么**不**调用 `AbortController.abort()`
   *
   * 后端在中断后仍会主动输出中断结论——规划阶段发 `narrative_end(aborted)` +
   * `token "⏹ 已中断"`（planning-phase），执行阶段发 `token "任务已被用户中断。"`
   * 甚至会调 LLM 生成「残留副作用点破」的总结（orchestrator.summaryPhase，告知用户
   * 已写入的采购单/库存**不会自动回滚**）。这些都是安全相关信息，MUST NOT 丢。
   *
   * 一旦 `abort()` 掐断连接，这些事件就再也收不到——表现为「聊天区一直转圈、
   * 没有中断结论」（首次修复引入的回归）。故本函数**只断消费、不断连接**：
   * 让读循环继续接收后端的收尾事件。
   *
   * ## 三段式
   *
   * ① 立即定格思考区 + 复位 UI —— 用户点击即刻看到反馈，不等任何网络
   * ② 保留连接继续读流 —— 接收后端的中断结论与 `done`
   * ③ 兜底定时器 —— 后端卡住（LLM 挂起等）时强制退出读循环，避免 UI 永久悬挂
   */
  const abort = async () => {
    // ① UI 立即响应：思考区定格（停止转圈）+ 释放发送态 + 停"父Agent 正在处理"
    setMessages(prev => prev.map(m =>
      (isAssistantMessage(m) && m.narrativeStreaming)
        ? { ...m, narrativeStreaming: false }
        : m));
    sendingRef.current = false;
    setSending(false);
    setAnalyzing(false);
    setPlanConfirmModal(null);
    setConfirmModal(null);

    // ③ 兜底：若后端迟迟不发 done（LLM 挂起 / 连接半开），到点强制结束读循环。
    // 该定时器在 send 的 finally 中被清除，正常路径下不会触发。
    abortFallbackTimerRef.current = setTimeout(() => {
      for (const wake of abortWaitersRef.current) wake();
      abortWaitersRef.current.clear();
    }, ABORT_FALLBACK_MS);

    try {
      // 带 thread_id 供后端做归属校验（多标签页/多会话下防跨会话误中断，审查 M8）
      const res = await fetch('/agent-api/abort', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ thread_id: threadId }),
      });
      if (res.status === 409) {
        const data = await res.json().catch(() => null);
        message.warning(data?.message || '中断请求未被后端接受（可能任务已结束或已在其他会话执行）');
      } else if (!res.ok) {
        message.warning('中断请求失败（HTTP ' + res.status + '），后端可能仍在执行');
      }
    } catch {
      message.warning('中断请求发送失败，后端可能仍在执行该任务');
    }
  };

  const send = async (text: string) => {
    if (!text || sendingRef.current) return;
    sendingRef.current = true;
    setInput('');
    setSending(true);

    // 重置执行状态（runId 先自增：占位 assistant 打标，本轮思考/直答都写进这条消息）
    phaseRef.current = 'planning';
    runIdRef.current += 1;
    // 本次 run 的 id 捕获为**闭包常量**（见文件头不变量 1）
    const runId = runIdRef.current;
    setExecutionLog([]);
    setPlanConfirmModal(null);
    setConfirmModal(null);
    setConfirmedPlan(null);
    abortRef.current = new AbortController();

    // 哨兵：中断时由 abort() 兑现，让挂起的 reader.read() 立即让位给竞速。
    // 声明在 try 之前——finally 需要能访问它来注销 waiter（否则 waiter 跨 run 泄漏）。
    let wakeAbort: () => void = () => {};
    const aborted = new Promise<'aborted'>(resolve => { wakeAbort = () => resolve('aborted'); });
    abortWaitersRef.current.add(wakeAbort);

    // 用户消息 + 空助手占位（流式填充载体：规划期 narrative 字段流入它；直答正文也回流它）
    const userMsg: AgentMessage = { role: 'user', content: text, timestamp: new Date().toISOString() };
    const assistantMsg: ChatMessage = { role: 'assistant', content: '', timestamp: '', runId };
    setMessages(prev => [...prev, userMsg, assistantMsg]);

    try {
      // 传 signal：中断时 fetch 本身被取消，reader 随之结束（审查 C2）
      const response = await agentChatStream(scenarioName, ontologyName, threadId, text, abortRef.current?.signal);
      if (!response.ok) throw new Error(await response.text());

      const reader = response.body?.getReader();
      if (!reader) throw new Error('无法获取响应流');

      const decoder = new TextDecoder();
      let buffer = '';

      /**
       * 解析并分发单行 SSE 数据（契约守卫见 isSSEEvent）。
       *
       * 返回 `'stop'` 表示**停止处理本批剩余行**（done / error 后的收尾事件）。
       * 与原先在 for 内 `break` 的语义一一对应，不可改成无条件 continue。
       */
      const dispatchLine = (line: string): 'stop' | undefined => {
        if (!line.startsWith('data: ')) return undefined;
        let data: unknown;
        try {
          data = JSON.parse(line.slice(6));
        } catch {
          return undefined; // 半包/非法 JSON：跳过该行，不中断整个流
        }
        // 契约守卫（审查 C4/M4）：后端新增事件类型时，此前是「悄悄不处理」——
        // 现在显式告警，且 isSSEEvent 收窄后下面各分支的 data 自动带类型，无需 as any。
        if (!isSSEEvent(data)) {
          console.warn('[agent] 收到未知 SSE 事件类型，已忽略：', (data as { type?: unknown })?.type);
          return undefined;
        }

        if (data.type === 'done') {
          setPlanConfirmModal(null);
          setConfirmModal(null);
          setMessages(prev => prev.map(m =>
            (isAssistantMessage(m) && m.narrativeStreaming) ? { ...m, narrativeStreaming: false } : m));
          return 'stop';
        }

        if (data.type === 'error') {
          // 定格思考区转圈（校验失败等路径不会再发 narrative_end）
          setMessages(prev => prev.map(m =>
            (isAssistantMessage(m) && m.narrativeStreaming) ? { ...m, narrativeStreaming: false } : m));
          if (phaseRef.current === 'subtask') {
            phaseRef.current = 'summary';
            setMessages(prev => [...prev, { role: 'assistant', content: '', timestamp: '' }]);
          }
          appendErrorMessage(data.message);
          return 'stop';
        }

        if (data.type === 'confirm') {
          setConfirmModal({
            confirmId: data.confirmId,
            behavior: data.behavior,
            content: data.content,
            params: (data.params ?? {}) as Record<string, any>,
          });
          return undefined;
        }

        if (data.type === 'plan_confirm') {
          setPlanConfirmModal({
            confirmId: data.confirmId,
            plan: data.plan,
            editedPlan: JSON.parse(JSON.stringify(data.plan)),
          });
          return undefined;
        }

        if (data.type === 'plan_received') {
          // 最终确认执行的规划（与 plan_confirm「待确认请求」区分）：仅留档展示，不参与执行
          setConfirmedPlan(data.plan);
          return undefined;
        }

        if (data.type === 'feedback') {
          // 父Agent 分析子任务结果期间的空窗提示（子任务间切换）
          setAnalyzing(data.status === 'running');
          return undefined;
        }

        if (data.type === 'exec_entry') {
          const entry = data.entry;
          // 去重/配对逻辑见 execution-log.mergeExecEntry（纯函数，可独立单测）
          setExecutionLog(prev => mergeExecEntry(prev, entry));
          // 聊天内子任务执行块（用 runId+seq 定位，避免多轮对话 seq 冲突）
          if (entry.source === 'child' && entry.seq != null) {
            // 局部取 seq：下面的 setMessages 回调里 TS 不会保留 entry.seq 的 != null 收窄
            const seq = entry.seq;
            if (entry.type === 'subtask_start') phaseRef.current = 'subtask';
            // 用闭包捕获的 runId（本次 run），不读 runIdRef.current——否则并发 run 会串轮
            setMessages(prev => {
              const updated = [...prev];
              const idx = updated.findIndex(m => isSubtaskItem(m) && m.runId === runId && m.seq === seq);
              if (idx < 0) {
                if (entry.type === 'subtask_start') {
                  updated.push({
                    role: 'subtask', runId, seq, behavior: entry.name,
                    displayName: entry.displayName, displayLabel: entry.displayLabel,
                    description: entry.description, status: entry.status, details: [entry],
                  });
                }
                return updated;
              }
              const it = updated[idx] as SubtaskChatItem;
              if (entry.type === 'subtask_start') {
                updated[idx] = {
                  ...it, status: entry.status, displayName: entry.displayName,
                  displayLabel: entry.displayLabel ?? it.displayLabel,
                  description: entry.description ?? it.description,
                  details: [...it.details, entry],
                };
              } else {
                // 只有 subtask_done 推进完成态；其余条目（tool_call / subtask_input / security_confirm）只追加明细
                const status = entry.type === 'subtask_done' ? entry.status : it.status;
                updated[idx] = { ...it, status, details: [...it.details, entry] };
              }
              return updated;
            });
          }
          return undefined;
        }

        if (data.type === 'narrative') {
          // 规划叙事：流入本轮 assistant 消息的 narrative 字段（runId 定位，修复轮复用同一字段并重启转圈）
          setMessages(prev => {
            const updated = [...prev];
            const idx = updated.findIndex(m => isAssistantMessage(m) && m.runId === runId);
            if (idx >= 0) {
              const it = updated[idx] as AssistantChatMessage;
              updated[idx] = {
                ...it, narrative: (it.narrative || '') + (data.token || ''), narrativeStreaming: true,
              };
            }
            return updated;
          });
          return undefined;
        }

        if (data.type === 'narrative_end') {
          setMessages(prev => prev.map(m => {
            if (!isAssistantMessage(m) || m.runId !== runId) return m;
            return data.outcome === 'answer'
              // 直答：撤掉思考区（正文随后以 token 全文回流到本条消息）
              ? { ...m, narrative: undefined, narrativeStreaming: false }
              // 规划/中断：定格思考区（停止转圈，内容留存可展开）
              : { ...m, narrativeStreaming: false };
          }));
          return undefined;
        }

        // data.type === 'token'：子任务阶段后的第一个 token = 最终总结 → 新开一条 assistant 消息
        const tokenText = data.token || '';
        if (phaseRef.current === 'subtask') {
          phaseRef.current = 'summary';
          setMessages(prev => [...prev, { role: 'assistant', content: '', timestamp: '' }]);
        }
        // 宪法 I：不使用 flushSync。原实现每 token 强制一次**同步**提交，绕过 React 18 自动批处理——
        // 流式期间本可一帧合并几十个 token 的一次渲染，变成了每 token 一次全量渲染，
        // 反而更慢且阻塞事件循环。批处理下 React 会在微任务里合并同 tick 的多次 setState。
        setMessages(prev => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last.role === 'assistant') {
            updated[updated.length - 1] = { ...last, content: last.content + tokenText };
          } else {
            // 末尾是子任务块等非正文消息 → 末尾新开正文消息承接
            updated.push({ role: 'assistant', content: tokenText, timestamp: '' });
          }
          return updated;
        });
        return undefined;
      };

      // 哨兵已在 try 之前创建并注册（见下方abortRef 初始化处）
      while (true) {
        const chunk = await Promise.race([reader.read(), aborted]);
        // 被中断：退出循环（UI 状态已在 abort() 内即时复位，这里只负责收尾）
        if (chunk === 'aborted') break;
        const { done, value } = chunk;
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (dispatchLine(line) === 'stop') break;
        }
      }
      abortWaitersRef.current.delete(wakeAbort);
      // 流掐断（done）时最后一行若不带换行会留在 buffer 里被丢弃 —— SSE 规范允许最后一条
      // 事件不带结尾空行，此前实现会静默丢掉该事件（审查 m16）
      if (buffer.trim()) {
        dispatchLine(buffer.endsWith('\r') ? buffer.slice(0, -1) : buffer);
      }
    } catch (e: any) {
      // AbortError = 用户主动中断（abort 已关弹窗并通知后端）：不往正文写错误文案
      if (e?.name !== 'AbortError') appendErrorMessage(e.message);
    } finally {
      // run 归属判断：中断后用户可能立刻发起新 run（runId 已递增），
      // 此时旧 run 的 finally 若再复位 sending，会把新 run 的「发送中」状态误关掉。
      if (runIdRef.current === runId) {
        sendingRef.current = false;
        setSending(false);
        // 「父Agent 正在处理」必须在此收尾：error / done / 中断三条路径都不会再发 feedback 事件，
        // 只靠 feedback 置位会导致异常收尾后转圈永久残留（审查 C2b）
        setAnalyzing(false);
        abortRef.current = null;
      }
      // 无论是否当前 run，都要注销本 run 的哨兵（避免 waiter 泄漏）
      abortWaitersRef.current.delete(wakeAbort);
      // 清除中断兜底定时器（正常路径下 done 先到，定时器在此被回收）
      if (abortFallbackTimerRef.current) {
        clearTimeout(abortFallbackTimerRef.current);
        abortFallbackTimerRef.current = null;
      }
    }
  };

  /**
   * 把错误写进末尾正文消息。末尾非 assistant（子任务块）或 assistant 空内容时才新开一条——
   * 复用已有空占位，避免同一轮出现两个来源的报错气泡。
   */
  function appendErrorMessage(text: string) {
    setMessages(prev => {
      const updated = [...prev];
      const last = updated[updated.length - 1];
      if (last.role === 'assistant' && !last.content) {
        updated[updated.length - 1] = { ...last, content: `\n\n[错误: ${text}]` };
      } else if (last.role !== 'assistant') {
        updated.push({ role: 'assistant', content: `\n\n[错误: ${text}]`, timestamp: '' });
      }
      return updated;
    });
  }

  return { sending, analyzing, currentRunId: () => runIdRef.current, send, abort };
}