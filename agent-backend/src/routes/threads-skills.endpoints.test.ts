/**
 * HTTP 端点集成测试：threads CRUD / chat SSE / skills（7 个端点）。
 *
 * 宪法 III「每个接口（端点）MUST 有集成测试」。本文件覆盖：
 *   · GET/POST /onto_market/:s/:o/threads、GET/DELETE .../threads/:tid
 *   · POST .../threads/:tid/chat
 *   · GET /onto_market/skills/all、GET /onto_market/:s/:o/skills
 *
 * 其余端点（health / abort / confirm / plan-confirm / mcp-config）见
 * `control.endpoints.test.ts`。
 *
 * ## 策略：真实 HTTP + fake 端口
 *
 * supertest 驱动**真实装配的 Express app**（`createApp`），只替换四个端口依赖：
 * 路由层、中间件层全部走真实代码 → 断言的是端点契约本身，而非"mock 返回什么"。
 * 不触真实磁盘 / 网络 / LLM（宪法 III 要求打桩）。
 *
 * 本文件同时是**错误体契约的防漂移点**：`sendError` 的四字段形状
 * （code/message/detail/error，detail 与 error 均为 message 镜像）在此逐端点固化。
 */
import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
import type { AppDeps } from '../app.js';
import { ForbiddenError } from '../security/path-access-controller.js';

const SC = '生产调度';
const ON = '原材料采购和库存';
const TID = 'thread-1';
const BASE = `/agent-api/onto_market/${SC}/${ON}`;

/** 统一错误体断言（宪法 VI：稳定错误码 + 可读 message + 前端可解析） */
function expectErrorBody(body: any, status: number, messagePart?: string) {
  expect(body.code).toBe(status);
  expect(typeof body.message).toBe('string');
  expect(body.message.length).toBeGreaterThan(0);
  expect(body.detail).toBe(body.message);
  expect(body.error).toBe(body.message);
  if (messagePart) expect(body.message).toContain(messagePart);
}

/** 线程样本（满足 Thread 最小形状） */
const sampleThread = (over: Record<string, any> = {}) => ({
  id: TID,
  title: '新对话',
  status: 'active',
  messages: [],
  created_at: '2026-10-05T00:00:00.000Z',
  updated_at: '2026-10-05T00:00:00.000Z',
  scenario_name: SC,
  ontology_name: ON,
  ontology_scope: [],
  ...over,
});

/** threadStore fake 的完整形状（各用例只覆盖自己关心的方法） */
function fakeStore(over: Record<string, any> = {}) {
  return {
    list: vi.fn(() => []),
    create: vi.fn(() => sampleThread()),
    get: vi.fn(() => sampleThread()),
    delete: vi.fn(),
    appendMessages: vi.fn(),
    replaceMessages: vi.fn(),
    exists: vi.fn(() => true),
    ...over,
  } as any;
}

/** 组装 fake 依赖 */
function makeDeps(over: Partial<Record<keyof AppDeps, any>> = {}): AppDeps {
  return {
    threadStore: over.threadStore ?? fakeStore(),
    skillLoader: over.skillLoader ?? {
      listAllSkills: vi.fn(() => [{ name: 'skill-a', title: '技能A' }]),
      listSkills: vi.fn(() => [{ name: 'skill-b', title: '技能B' }]),
    },
    mcpConfigStore: over.mcpConfigStore ?? { getConfig: vi.fn(() => ({ servers: [] })), saveConfig: vi.fn() },
    orchestrator: over.orchestrator ?? {
      abortRun: vi.fn(() => ({ aborted: true })),
      handleConfirm: vi.fn(() => true),
      handlePlanConfirm: vi.fn(() => true),
    },
    chatSession: over.chatSession ?? {
      chat: vi.fn(async (_s: string, _o: string, _t: string, _m: string, send: (e: any) => void) => {
        send({ type: 'token', token: '你好' });
        send({ type: 'done' });
        return '你好';
      }),
      createThread: vi.fn((_s: string, _o: string, title?: string) => sampleThread({ title: title || '新对话' })),
    },
  } as AppDeps;
}

// ─── threads 列表 ──────────────────────────────────

describe(`GET ${BASE}/threads`, () => {
  it('返回线程摘要列表', async () => {
    const threadStore = fakeStore({ list: vi.fn(() => [{ id: TID, title: '新对话', message_count: 0 }]) });
    const res = await request(createApp(makeDeps({ threadStore }))).get(`${BASE}/threads`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(threadStore.list).toHaveBeenCalledWith(SC, ON);
  });

  it('列表失败 → 400 统一错误体', async () => {
    const threadStore = fakeStore({ list: vi.fn(() => { throw new Error('目录不可读'); }) });
    const res = await request(createApp(makeDeps({ threadStore }))).get(`${BASE}/threads`);
    expect(res.status).toBe(400);
    expectErrorBody(res.body, 400, '目录不可读');
  });
});

// ─── threads 创建 ──────────────────────────────────

describe(`POST ${BASE}/threads`, () => {
  it('创建成功 → 201 + 线程体（title 缺省走默认值）', async () => {
    const res = await request(createApp(makeDeps()))
      .post(`${BASE}/threads`)
      .send({ ontology_scope: [{ scenario: SC, ontology: ON }] });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe(TID);
    expect(res.body.title).toBe('新对话');
  });

  it('本体范围非法 → 400（领域异常在 ChatSession、路由只做 HTTP 适配）', async () => {
    const chatSession = { chat: vi.fn(), createThread: vi.fn(() => { throw new Error('本体范围非法：x'); }) };
    const res = await request(createApp(makeDeps({ chatSession }))).post(`${BASE}/threads`).send({ ontology_scope: [] });
    expect(res.status).toBe(400);
    expectErrorBody(res.body, 400, '本体范围非法');
  });
});

// ─── threads 详情 ──────────────────────────────────

describe(`GET ${BASE}/threads/:tid`, () => {
  it('返回线程详情', async () => {
    const res = await request(createApp(makeDeps())).get(`${BASE}/threads/${TID}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(TID);
  });

  it('跨本体访问（ForbiddenError）→ 404（不泄露"存在但无权"）', async () => {
    const threadStore = fakeStore({ get: vi.fn(() => { throw new ForbiddenError('对话不属于当前场景/本体'); }) });
    const res = await request(createApp(makeDeps({ threadStore }))).get(`${BASE}/threads/${TID}`);
    expect(res.status).toBe(404);
    expectErrorBody(res.body, 404, '不属于当前场景');
  });

  it('其他读取失败 → 400（非 Forbidden 一律客户端错误）', async () => {
    const threadStore = fakeStore({ get: vi.fn(() => { throw new Error('文件损坏'); }) });
    const res = await request(createApp(makeDeps({ threadStore }))).get(`${BASE}/threads/${TID}`);
    expect(res.status).toBe(400);
    expectErrorBody(res.body, 400, '文件损坏');
  });
});

// ─── threads 删除 ──────────────────────────────────

describe(`DELETE ${BASE}/threads/:tid`, () => {
  it('删除成功 → 200 { message: 已删除 }，且按 (scenario, ontology, tid) 寻址', async () => {
    const threadStore = fakeStore();
    const res = await request(createApp(makeDeps({ threadStore }))).delete(`${BASE}/threads/${TID}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: '已删除' });
    expect(threadStore.delete).toHaveBeenCalledWith(SC, ON, TID);
  });

  it('归属校验失败 → 404（与 GET 详情同口径，不泄露"存在但无权"）', async () => {
    // 真实 ThreadStore.delete 内部先 readThread() 做归属校验，校验不过即抛 ForbiddenError。
    // 该 404 映射与 GET 详情对齐是补端点测试时补齐的：此前 DELETE 一律 400，
    // 前端无法区分「线程不存在」与「线程存在但不属于当前本体」。
    const threadStore = fakeStore({
      delete: vi.fn(() => { throw new ForbiddenError('对话不属于当前场景/本体'); }),
    });
    const res = await request(createApp(makeDeps({ threadStore }))).delete(`${BASE}/threads/${TID}`);
    expect(res.status).toBe(404);
    expectErrorBody(res.body, 404, '不属于当前场景');
  });
});

// ─── chat SSE ──────────────────────────────────────

describe(`POST ${BASE}/threads/:tid/chat`, () => {
  const url = `${BASE}/threads/${TID}/chat`;

  it('SSE 头正确 + 事件逐条以 data: 帧下发', async () => {
    const res = await request(createApp(makeDeps())).post(url).send({ message: '你好' });
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/event-stream/);
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.text).toContain('data: {"type":"token","token":"你好"}');
    expect(res.text).toContain('data: {"type":"done"}');
  });

  it('消息为空 / 仅空白 → 400，且不进入编排', async () => {
    const chatSession = { chat: vi.fn(), createThread: vi.fn() };
    const res = await request(createApp(makeDeps({ chatSession }))).post(url).send({ message: '   ' });
    expect(res.status).toBe(400);
    expectErrorBody(res.body, 400, '消息不能为空');
    expect(chatSession.chat).not.toHaveBeenCalled();
  });

  it('线程不存在 → 404（先校验存在再建流）', async () => {
    const threadStore = fakeStore({ exists: vi.fn(() => false) });
    const res = await request(createApp(makeDeps({ threadStore }))).post(url).send({ message: '你好' });
    expect(res.status).toBe(404);
    expectErrorBody(res.body, 404, '对话不存在');
  });

  it('编排抛错 → 以 error 事件下发（响应头已发出，无法再改状态码，故不用 HTTP 500）', async () => {
    const chatSession = {
      chat: vi.fn(async (_s: string, _o: string, _t: string, _m: string, send: (e: any) => void) => {
        send({ type: 'error', message: '编排炸了' });
        return '编排炸了';
      }),
      createThread: vi.fn(),
    };
    const res = await request(createApp(makeDeps({ chatSession }))).post(url).send({ message: '你好' });
    expect(res.status).toBe(200);
    expect(res.text).toContain('data: {"type":"error","message":"编排炸了"}');
  });
});

// ─── skills ───────────────────────────────────────

describe('GET /onto_market/skills/all', () => {
  it('返回全部技能列表', async () => {
    const skillLoader = { listAllSkills: vi.fn(() => [{ name: 'skill-a' }]), listSkills: vi.fn() };
    const res = await request(createApp(makeDeps({ skillLoader }))).get('/agent-api/onto_market/skills/all');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ name: 'skill-a' }]);
    expect(skillLoader.listAllSkills).toHaveBeenCalledTimes(1);
  });

  it('技能扫描失败 → 400 且错误体四字段齐全', async () => {
    const skillLoader = { listAllSkills: vi.fn(() => { throw new Error('扫描失败'); }), listSkills: vi.fn() };
    const res = await request(createApp(makeDeps({ skillLoader }))).get('/agent-api/onto_market/skills/all');
    expect(res.status).toBe(400);
    expectErrorBody(res.body, 400, '扫描失败');
  });
});

describe(`GET ${BASE}/skills`, () => {
  it('按路径参数返回该本体技能', async () => {
    const skillLoader = { listAllSkills: vi.fn(), listSkills: vi.fn(() => [{ name: 'skill-b' }]) };
    const res = await request(createApp(makeDeps({ skillLoader }))).get(`${BASE}/skills`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ name: 'skill-b' }]);
    expect(skillLoader.listSkills).toHaveBeenCalledWith(SC, ON);
  });

  it('本体不存在 → 400（领域异常统一映射）', async () => {
    const skillLoader = { listAllSkills: vi.fn(), listSkills: vi.fn(() => { throw new Error('本体不存在'); }) };
    const res = await request(createApp(makeDeps({ skillLoader }))).get('/agent-api/onto_market/不存在/本体/skills');
    expect(res.status).toBe(400);
    expectErrorBody(res.body, 400, '本体不存在');
  });
});