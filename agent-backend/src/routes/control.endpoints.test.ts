/**
 * HTTP 端点集成测试：health / 中断 / 确认回执 / MCP 配置。
 *
 * 宪法 III「每个接口（端点）MUST 有集成测试」。本文件覆盖 10 个端点：
 *   GET /health、GET /agent-api/health、POST /abort、
 *   POST /confirm/:confirmId、POST /plan-confirm/:confirmId、
 *   GET/PUT /mcp-config、POST /mcp-config/test、/tools、/call-tool
 *
 * ## 本组重点固化的两条语义
 *
 * 1. 失败 MUST 以错误表达（宪法 VI）：无活动 run 的 /abort 回 409 而非
 *    200 已中断；失效的确认回执回 404 而非 200 ok。二者原先都在撒谎。
 * 2. 答复语义严格：approved 缺省/非布尔一律 400（不当成拒绝），
 *    否则一次网络抖动会把用户的批准静默变成拒绝。
 *
 * 策略同 threads-skills 文件：supertest 驱动真实 Express app（createApp），
 * 只替换四个端口依赖 —— 路由层与中间件层走真实代码，不触磁盘/网络/LLM。
 */
import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp, errorHandler } from '../app.js';
import type { AppDeps } from '../app.js';

const TID = 'thread-1';
/** 统一错误体断言（宪法 VI：稳定错误码 + 可读 message + detail/error 镜像） */
function expectErrorBody(body: any, status: number, messagePart?: string) {
  expect(body.code).toBe(status);
  expect(typeof body.message).toBe('string');
  expect(body.message.length).toBeGreaterThan(0);
  expect(body.detail).toBe(body.message);
  expect(body.error).toBe(body.message);
  if (messagePart) expect(body.message).toContain(messagePart);
}

/** 组装 fake 依赖 */
function makeDeps(over: Partial<Record<keyof AppDeps, any>> = {}): AppDeps {
  return {
    threadStore: over.threadStore ?? {
      list: vi.fn(() => []), create: vi.fn(), get: vi.fn(), delete: vi.fn(),
      appendMessages: vi.fn(), replaceMessages: vi.fn(), exists: vi.fn(() => true),
    },
    skillLoader: over.skillLoader ?? { listAllSkills: vi.fn(() => []), listSkills: vi.fn(() => []) },
    mcpConfigStore: over.mcpConfigStore ?? { getConfig: vi.fn(() => ({ servers: [] })), saveConfig: vi.fn() },
    orchestrator: over.orchestrator ?? {
      abortRun: vi.fn(() => ({ aborted: true })),
      handleConfirm: vi.fn(() => true),
      handlePlanConfirm: vi.fn(() => true),
    },
    chatSession: over.chatSession ?? { chat: vi.fn(), createThread: vi.fn() },
  } as AppDeps;
}

// ─── health（2 端点）───────────────────────────────

describe('健康检查（/health 与 /agent-api/health）', () => {
  it('两个端点均返回 ok + 合法 ISO 时间戳（同一处理函数，响应体形状一致）', async () => {
    const app = createApp(makeDeps());
    const a = await request(app).get('/health');
    const b = await request(app).get('/agent-api/health');
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.status).toBe('ok');
    expect(b.body.status).toBe('ok');
    expect(new Date(a.body.timestamp).toISOString()).toBe(a.body.timestamp);
    expect(new Date(b.body.timestamp).toISOString()).toBe(b.body.timestamp);
  });
});

// ─── 中断（1 端点）────────────────────────────────

describe('POST /abort', () => {
  /** 只定制 abortRun 的返回；回执方法保持"命中"以免干扰其他组 */
  const orch = (ret: any) => ({
    abortRun: vi.fn(() => ret),
    handleConfirm: vi.fn(() => true),
    handlePlanConfirm: vi.fn(() => true),
  });

  it('中断成功 → 200 { message: 已中断 }，thread_id 透传给 orchestrator', async () => {
    const orchestrator = orch({ aborted: true });
    const res = await request(createApp(makeDeps({ orchestrator }))).post('/agent-api/abort').send({ thread_id: TID });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: '已中断' });
    expect(orchestrator.abortRun).toHaveBeenCalledWith(TID);
  });

  it('无活动 run → 409（不再撒谎说"已中断"）', async () => {
    const res = await request(createApp(makeDeps({ orchestrator: orch({ aborted: false, reason: 'no_active_run' }) })))
      .post('/agent-api/abort').send({ thread_id: TID });
    expect(res.status).toBe(409);
    expectErrorBody(res.body, 409, '没有正在执行');
  });

  it('属其他会话 → 409 thread_mismatch（多标签页不得互相中断，审查 M8）', async () => {
    const res = await request(createApp(makeDeps({ orchestrator: orch({ aborted: false, reason: 'thread_mismatch' }) })))
      .post('/agent-api/abort').send({ thread_id: 'other' });
    expect(res.status).toBe(409);
    expectErrorBody(res.body, 409, '其他会话');
  });

  it('thread_id 类型非法 → 400（不把脏输入当"无 thread_id"放行）', async () => {
    const orchestrator = orch({ aborted: true });
    const res = await request(createApp(makeDeps({ orchestrator }))).post('/agent-api/abort').send({ thread_id: 123 });
    expect(res.status).toBe(400);
    expectErrorBody(res.body, 400, '必须是字符串');
    expect(orchestrator.abortRun).not.toHaveBeenCalled();
  });
});

// ─── 安全管控回执（1 端点）────────────────────────

describe('POST /confirm/:confirmId', () => {
  /** 回执方法的参数签名显式声明——否则 mock.calls 的元组退化为无参元组，取不到实参 */
  const orch = (hit: boolean) => ({
    abortRun: vi.fn(() => ({ aborted: true })),
    handleConfirm: vi.fn((_confirmId: string, _approved: boolean) => hit),
    handlePlanConfirm: vi.fn((_confirmId: string, _approved: boolean, _plan?: any, _opts?: any) => hit),
  });

  it('命中确认请求 → 200 ok', async () => {
    const orchestrator = orch(true);
    const res = await request(createApp(makeDeps({ orchestrator }))).post('/agent-api/confirm/c-1').send({ approved: true });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: 'ok' });
    expect(orchestrator.handleConfirm).toHaveBeenCalledWith('c-1', true);
  });

  it('确认请求已失效（超时/中断/已答复）→ 404 而非 200（消除"状态真空"，审查 C3）', async () => {
    const res = await request(createApp(makeDeps({ orchestrator: orch(false) })))
      .post('/agent-api/confirm/c-gone').send({ approved: false });
    expect(res.status).toBe(404);
    expectErrorBody(res.body, 404, '已失效');
  });

  it('approved 缺省 / 非布尔 → 400，且不进 orchestrator（不当成"拒绝"处理）', async () => {
    for (const body of [{}, { approved: 'true' }, { approved: 1 }]) {
      const orchestrator = orch(true);
      const res = await request(createApp(makeDeps({ orchestrator }))).post('/agent-api/confirm/c-1').send(body);
      expect(res.status).toBe(400);
      expectErrorBody(res.body, 400, '必须是布尔值');
      expect(orchestrator.handleConfirm).not.toHaveBeenCalled();
    }
  });
});

// ─── 规划确认回执（1 端点）────────────────────────

describe('POST /plan-confirm/:confirmId', () => {
  const orch = (hit: boolean) => ({
    abortRun: vi.fn(() => ({ aborted: true })),
    handleConfirm: vi.fn((_confirmId: string, _approved: boolean) => hit),
    handlePlanConfirm: vi.fn((_confirmId: string, _approved: boolean, _plan?: any, _opts?: any) => hit),
  });

  it('确认执行（用户未改规划）→ 只回 approved，不回传 plan', async () => {
    const orchestrator = orch(true);
    const res = await request(createApp(makeDeps({ orchestrator }))).post('/agent-api/plan-confirm/p-1').send({ approved: true });
    expect(res.status).toBe(200);
    const call = orchestrator.handlePlanConfirm.mock.calls[0];
    expect(call[0]).toBe('p-1');
    expect(call[1]).toBe(true);
    expect(call[2]).toBeUndefined();
  });

  it('拒绝并重规划 → 回传 rejectAction + suggestion', async () => {
    const orchestrator = orch(true);
    await request(createApp(makeDeps({ orchestrator })))
      .post('/agent-api/plan-confirm/p-2')
      .send({ approved: false, rejectAction: 'replan', suggestion: '先查库存' });
    const call = orchestrator.handlePlanConfirm.mock.calls[0];
    expect(call[1]).toBe(false);
    expect(call[3].rejectAction).toBe('replan');
    expect(call[3].suggestion).toBe('先查库存');
  });

  it('用户编辑过规划 → 回传 plan（后端据此判定"规划已修改"）', async () => {
    const orchestrator = orch(true);
    const plan = { subtasks: [{ seq: 1 }] };
    await request(createApp(makeDeps({ orchestrator })))
      .post('/agent-api/plan-confirm/p-3').send({ approved: true, plan });
    expect(orchestrator.handlePlanConfirm.mock.calls[0][2]).toEqual(plan);
  });

  it('已失效 → 404；rejectAction 非法值 → 400', async () => {
    const gone = await request(createApp(makeDeps({ orchestrator: orch(false) })))
      .post('/agent-api/plan-confirm/p-gone').send({ approved: true });
    expect(gone.status).toBe(404);
    expectErrorBody(gone.body, 404, '已失效');

    const bad = await request(createApp(makeDeps({ orchestrator: orch(true) })))
      .post('/agent-api/plan-confirm/p-1').send({ approved: true, rejectAction: 'whatever' });
    expect(bad.status).toBe(400);
    expectErrorBody(bad.body, 400, 'exit');
  });
});

// ─── MCP 配置读写（2 端点）─────────────────────────

describe('MCP 配置（GET / PUT /mcp-config）', () => {
  it('GET 返回当前配置', async () => {
    const cfg = { servers: [{ name: '本体MCP', url: 'u', enabled: true }] };
    const mcpConfigStore = { getConfig: vi.fn(() => cfg), saveConfig: vi.fn() };
    const res = await request(createApp(makeDeps({ mcpConfigStore }))).get('/agent-api/mcp-config');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(cfg);
  });

  it('GET 读取失败 → 400 统一错误体', async () => {
    const mcpConfigStore = { getConfig: vi.fn(() => { throw new Error('配置损坏'); }), saveConfig: vi.fn() };
    const res = await request(createApp(makeDeps({ mcpConfigStore }))).get('/agent-api/mcp-config');
    expect(res.status).toBe(400);
    expectErrorBody(res.body, 400, '配置损坏');
  });

  it('PUT 保存成功 → 200，且原样透传给 store', async () => {
    const mcpConfigStore = { getConfig: vi.fn(), saveConfig: vi.fn() };
    const cfg = { servers: [] };
    const res = await request(createApp(makeDeps({ mcpConfigStore }))).put('/agent-api/mcp-config').send(cfg);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: '配置已保存' });
    expect(mcpConfigStore.saveConfig).toHaveBeenCalledWith(cfg);
  });

  it('PUT 保存失败 → 400（不吞错）', async () => {
    const mcpConfigStore = { getConfig: vi.fn(), saveConfig: vi.fn(() => { throw new Error('只读文件系统'); }) };
    const res = await request(createApp(makeDeps({ mcpConfigStore }))).put('/agent-api/mcp-config').send({ servers: [] });
    expect(res.status).toBe(400);
    expectErrorBody(res.body, 400, '只读文件系统');
  });
});

// ─── MCP 探测（3 端点）────────────────────────────

describe('MCP 探测（/test 与 /tools）', () => {
  // 两端点共用 withTempClient + shapeTools（审查 M9：曾有两份必然漂移的实现）。
  // 此处断言**入参校验**这条不需要网络的语义；真实连接与工具整形由
  // mcp-client / tool-catalog 的单测覆盖（不打桩真实网络）。
  it('缺 url / url 类型非法 → 400，且不发起连接', async () => {
    for (const path of ['/agent-api/mcp-config/test', '/agent-api/mcp-config/tools']) {
      for (const body of [{}, { url: 123 }, { url: '' }]) {
        const res = await request(createApp(makeDeps())).post(path).send(body);
        expect(res.status).toBe(400);
        expectErrorBody(res.body, 400, '缺少 MCP 服务 URL');
      }
    }
  });
});

describe('POST /mcp-config/call-tool', () => {
  it('缺 url 或 tool_name → 400', async () => {
    for (const body of [{}, { url: 'http://x' }, { tool_name: 't' }]) {
      const res = await request(createApp(makeDeps())).post('/agent-api/mcp-config/call-tool').send(body);
      expect(res.status).toBe(400);
      expectErrorBody(res.body, 400, '缺少 MCP 服务 URL 或工具名');
    }
  });
});

// ─── 全局错误兜底（宪法 VI）────────────────────────

describe('未捕获异常兜底 errorHandler（审查 M6）', () => {
  /** 最小 Response 替身：只记录 status/json 调用 */
  function mockRes(headersSent = false) {
    const out: { status?: number; body?: any; type?: string } = {};
    return {
      out,
      res: {
        headersSent,
        status(code: number) { out.status = code; return this; },
        json(body: any) { out.body = body; out.type = 'json'; return this; },
      } as any,
    };
  }

  it('三字段不再同值固定文案：message 可读、detail 带原始错误消息', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { out, res } = mockRes();
    errorHandler(new Error('未捕获的内部错误'), {} as any, res, (() => {}) as any);
    expect(out.status).toBe(500);
    expect(out.type).toBe('json');
    expect(out.body.message).toBe('服务器内部错误');
    expect(out.body.detail).toBe('未捕获的内部错误');
    expect(out.body.code).toBe(500);
    spy.mockRestore();
  });

  it('原始错误（含 stack）落服务端日志，堆栈不外泄到响应体', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { out, res } = mockRes();
    errorHandler(new Error('内部细节 X'), {} as any, res, (() => {}) as any);
    expect(spy).toHaveBeenCalled();
    expect(out.body.detail).toBe('内部细节 X');
    expect(String(out.body.detail)).not.toContain('\n');
    expect(JSON.stringify(out.body)).not.toContain('at ');
    spy.mockRestore();
  });

  it('非 Error 异常（抛字符串）也安全：detail 用 String() 兜底', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { out, res } = mockRes();
    errorHandler('裸字符串异常', {} as any, res, (() => {}) as any);
    expect(out.body.detail).toBe('裸字符串异常');
    spy.mockRestore();
  });

  it('响应头已发出 → 不再写响应（避免 ERR_HTTP_HEADERS_SENT 二次抛错）', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { out, res } = mockRes(true);
    errorHandler(new Error('流已开'), {} as any, res, (() => {}) as any);
    expect(out.status).toBeUndefined();
    expect(out.body).toBeUndefined();
    spy.mockRestore();
  });
});