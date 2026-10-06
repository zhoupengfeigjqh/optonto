/**
 * useConfirmReplies 单测 —— 确认回执的三态反馈（2026-10-05，宪法 III / IV）。
 *
 * ## 为什么必须有这个文件
 *
 * 该 hook 承载 C3 的修复：回执失败时**保持弹窗打开**并就地提示，成功才关闭。
 * 修复前是五处 `.catch(() => {})` 静默失败——弹窗照关、UI 呈现已确认态，
 * 而后端要等 CONFIRM_TIMEOUT(60s) 才按超时判失败，用户与系统之间存在「状态真空」，
 * 写操作上尤其危险。这条语义 MUST 有测试守着，否则极易被改回 `.catch(() => {})`。
 *
 * ## 本文件固化的语义
 *
 * 1. 失败 → 弹窗保持打开 + 展示原因（MUST NOT 静默关闭）
 * 2. 404 单独识别：确认已失效，重试无意义 → 引导「改为拒绝」而非反复失败
 * 3. busy 防连点：回执未完成时二次点击被忽略
 * 4. approved 缺省/非布尔由**后端**兜底（前端只发布尔），此处不重复校验
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import { useConfirmReplies, type PlanConfirmState, type SecurityConfirmState } from './use-confirm-replies';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

/** 规划编辑助手桩（校验 / 是否被改过） */
const validatePlan = vi.fn(() => [] as string[]);
const isPlanUnchanged = vi.fn(() => true);

/** 装配 hook：默认给出一个待确认的规划弹窗与一个待确认的安全弹窗 */
function setup(over: {
  planConfirmModal?: PlanConfirmState | null;
  confirmModal?: SecurityConfirmState | null;
  setMessages?: ReturnType<typeof vi.fn>;
  runId?: number;
} = {}) {
  const setPlanConfirmModal = vi.fn();
  const setConfirmModal = vi.fn();
  const setMessages = over.setMessages ?? vi.fn();
  const plan = { subtasks: [{ seq: 1, behavior: 'B' }] };
  const hook = renderHook(() => useConfirmReplies({
    planConfirmModal: over.planConfirmModal !== undefined
      ? over.planConfirmModal
      : { confirmId: 'p1', plan, editedPlan: plan },
    confirmModal: over.confirmModal !== undefined
      ? over.confirmModal
      : { confirmId: 'c1', behavior: 'B1', content: '确认写入', params: {} },
    setPlanConfirmModal,
    setConfirmModal,
    setMessages,
    currentRunId: () => over.runId ?? 1,
    validatePlan,
    isPlanUnchanged,
    onClearPlanError: vi.fn(),
    onPlanError: vi.fn(),
  }));
  return { ...hook, spies: { setPlanConfirmModal, setConfirmModal, setMessages } };
}

/** 成功响应 */
const ok = () => ({ ok: true, status: 200, json: async () => ({ message: 'ok' }) });
/** 失败响应（含统一错误体） */
const fail = (status: number, message: string) => ({
  ok: false, status, json: async () => ({ code: status, message, detail: message, error: message }),
});

beforeEach(() => {
  fetchMock.mockReset();
  validatePlan.mockReset();
  validatePlan.mockReturnValue([]);
  isPlanUnchanged.mockReset();
  isPlanUnchanged.mockReturnValue(true);
});

// ─── 安全管控回执 ──────────────────────────────────────────────────────────

describe('useConfirmReplies — 安全管控回执', () => {
  it('批准成功 → 关弹窗，不展示错误', async () => {
    fetchMock.mockResolvedValue(ok());
    const { result, spies } = setup();
    await act(async () => { await result.current.answerSecurityConfirm(true); });

    expect(fetchMock).toHaveBeenCalledWith('/agent-api/confirm/c1', expect.objectContaining({
      method: 'POST', body: JSON.stringify({ approved: true }),
    }));
    expect(spies.setConfirmModal).toHaveBeenCalledWith(null);
    expect(result.current.securityReplyError).toBe('');
  });

  it('拒绝同样走同一入口（approved=false）', async () => {
    fetchMock.mockResolvedValue(ok());
    const { result } = setup();
    await act(async () => { await result.current.answerSecurityConfirm(false); });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ approved: false });
  });

  it('回执失败 → **弹窗保持打开**且展示原因（C3 核心：不得静默关闭）', async () => {
    fetchMock.mockResolvedValue(fail(500, '服务器内部错误'));
    const { result, spies } = setup();
    await act(async () => { await result.current.answerSecurityConfirm(true); });

    expect(spies.setConfirmModal).not.toHaveBeenCalled(); // 关键：没有关弹窗
    expect(result.current.securityReplyError).toContain('服务器内部错误');
  });

  it('404（确认已失效）→ 提示引导「改为拒绝」，而非让用户反复重试', async () => {
    fetchMock.mockResolvedValue(fail(404, '该确认请求已失效'));
    const { result, spies } = setup();
    await act(async () => { await result.current.answerSecurityConfirm(true); });

    expect(spies.setConfirmModal).not.toHaveBeenCalled();
    expect(result.current.securityReplyError).toContain('已失效');
    expect(result.current.securityReplyError).toContain('拒绝');
  });

  it('网络异常 → 提示失败原因，弹窗保持打开', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    const { result, spies } = setup();
    await act(async () => { await result.current.answerSecurityConfirm(true); });
    expect(spies.setConfirmModal).not.toHaveBeenCalled();
    expect(result.current.securityReplyError).toContain('network down');
  });

  it('无待确认弹窗时直接返回，不发请求', async () => {
    const { result } = setup({ confirmModal: null });
    await act(async () => { await result.current.answerSecurityConfirm(true); });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
// ─── 规划确认：同意 ────────────────────────────────────────────────────────

describe('useConfirmReplies — 规划确认（同意）', () => {
  it('未改规划 → 只回 approved，不回传 plan（否则后端误判「规划已修改」）', async () => {
    fetchMock.mockResolvedValue(ok());
    const { result, spies } = setup();
    await act(async () => { await result.current.onConfirmExecute(); });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({ approved: true });
    expect(body.plan).toBeUndefined();
    expect(spies.setPlanConfirmModal).toHaveBeenCalledWith(null);
  });

  it('用户改过规划 → 回传编辑版 plan', async () => {
    isPlanUnchanged.mockReturnValue(false);
    fetchMock.mockResolvedValue(ok());
    const { result } = setup();
    await act(async () => { await result.current.onConfirmExecute(); });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.approved).toBe(true);
    expect(body.plan).toBeDefined();
    expect(body.plan.subtasks).toHaveLength(1);
  });

  it('结构校验不通过 → 留在弹窗内，**不发请求**', async () => {
    validatePlan.mockReturnValue(['子任务 1 缺少参数 x']);
    const { result, spies } = setup();
    await act(async () => { await result.current.onConfirmExecute(); });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(spies.setPlanConfirmModal).not.toHaveBeenCalled(); // 弹窗不关
  });

  it('回执失败 → 弹窗保持打开并展示原因', async () => {
    fetchMock.mockResolvedValue(fail(500, '服务器内部错误'));
    const { result, spies } = setup();
    await act(async () => { await result.current.onConfirmExecute(); });

    expect(spies.setPlanConfirmModal).not.toHaveBeenCalled();
    expect(result.current.planReplyError).toContain('服务器内部错误');
  });

  it('无待确认规划时直接返回，不发请求', async () => {
    const { result } = setup({ planConfirmModal: null });
    await act(async () => { await result.current.onConfirmExecute(); });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ─── 规划确认：拒绝 ────────────────────────────────────────────────────────

describe('useConfirmReplies — 规划确认（拒绝与重规划）', () => {
  it('拒绝并退出（exit）→ 回执后在聊天区留痕「拒绝了什么」', async () => {
    fetchMock.mockResolvedValue(ok());
    const setMessages = vi.fn();
    const { result, spies } = setup({ setMessages, runId: 7 });
    await act(async () => { await result.current.handleRejectPlan('exit'); });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body))
      .toEqual({ approved: false, rejectAction: 'exit', suggestion: '' });
    expect(spies.setPlanConfirmModal).toHaveBeenCalledWith(null);
    // 留痕：定位 runId=7 的 assistant 消息写入拒绝说明
    expect(setMessages).toHaveBeenCalled();
    const updater = setMessages.mock.calls.at(-1)![0];
    const next = updater([{ role: 'assistant', content: '', runId: 7 }]);
    expect(next[0].content).toContain('已拒绝规划并退出');
    expect(next[0].narrative).toBeUndefined();
  });

  it('拒绝并重规划（replan）→ 把用户建议带给后端', async () => {
    fetchMock.mockResolvedValue(ok());
    const { result } = setup();
    await act(async () => { await result.current.handleRejectPlan('replan', '先查库存'); });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body))
      .toEqual({ approved: false, rejectAction: 'replan', suggestion: '先查库存' });
  });

  it('重规划时建议为空 → 传空串（后端据此给默认引导语）', async () => {
    fetchMock.mockResolvedValue(ok());
    const { result } = setup();
    await act(async () => { await result.current.handleRejectPlan('replan'); });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).suggestion).toBe('');
  });

  it('拒绝回执失败 → 弹窗保持打开、不写聊天区留痕', async () => {
    fetchMock.mockResolvedValue(fail(500, '服务器内部错误'));
    const setMessages = vi.fn();
    const { result, spies } = setup({ setMessages });
    await act(async () => { await result.current.handleRejectPlan('exit'); });

    expect(spies.setPlanConfirmModal).not.toHaveBeenCalled();
    expect(setMessages).not.toHaveBeenCalled();
    expect(result.current.planReplyError).toContain('服务器内部错误');
  });

  it('拒绝已失效（404）→ 引导改为拒绝结束等待', async () => {
    fetchMock.mockResolvedValue(fail(404, '该规划确认请求已失效'));
    const { result } = setup();
    await act(async () => { await result.current.handleRejectPlan('exit'); });
    expect(result.current.planReplyError).toContain('拒绝');
  });
});

// ─── 防连点（busy）────────────────────────────────────────────────────────

describe('useConfirmReplies — 防连点', () => {
  it('回执未完成时的重复调用被忽略（只发一次请求）', async () => {
    let release: (v: any) => void = () => {};
    fetchMock.mockReturnValue(new Promise(res => { release = res; }));
    const { result } = setup();

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.answerSecurityConfirm(true);
      second = result.current.answerSecurityConfirm(true); // 连点
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.replyBusy).toBe(true);

    await act(async () => { release(ok()); await first; });
    expect(result.current.replyBusy).toBe(false);
    await second;
  });

  it('busy 期间不响应规划确认的重复点击', async () => {
    let release: (v: any) => void = () => {};
    fetchMock.mockReturnValue(new Promise(res => { release = res; }));
    const { result } = setup();

    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.onConfirmExecute();
      second = result.current.onConfirmExecute();
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => { release(ok()); await first; });
    await second;
  });

  it('HTTP 非 2xx 且响应体非 JSON → 仍给出可读兜底文案', async () => {
    fetchMock.mockResolvedValue({
      ok: false, status: 502, json: async () => { throw new Error('not json'); },
    });
    const { result } = setup();
    await act(async () => { await result.current.answerSecurityConfirm(true); });
    expect(result.current.securityReplyError).toContain('502');
  });
});