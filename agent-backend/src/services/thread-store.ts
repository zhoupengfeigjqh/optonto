import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PathAccessController, ForbiddenError } from '../security/path-access-controller.js';
import type { Thread, ThreadSummary, ThreadMessage, OntologySelection } from '../types.js';

/**
 * ThreadStore — 对话线程数据的读写。
 * 线程目录全局平铺（{threadsDir}/agent/{threadId}），路径安全经 PathAccessController 校验；
 * 场景/本体【归属校验】在本层：读线程 json 内记录的 scenario_name/ontology_name 与请求比对（readThread）。
 */
export class ThreadStore {
  constructor(private pac: PathAccessController) {}

  /** 列出某本体下所有 agent 线程（平铺扫描，按线程 json 内记录的场景/本体过滤） */
  list(scenario: string, ontology: string): ThreadSummary[] {
    const baseDir = this.pac.listThreadDirs();
    if (!existsSync(baseDir)) return [];

    const entries = readdirSync(baseDir, { withFileTypes: true });
    const threads: ThreadSummary[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dataPath = join(baseDir, entry.name, '.data.json');
      if (!existsSync(dataPath)) continue;

      try {
        const raw = readFileSync(dataPath, 'utf-8');
        const thread = JSON.parse(raw) as Thread;
        if (thread.scenario_name !== scenario || thread.ontology_name !== ontology) continue;
        threads.push({
          id: thread.id,
          title: thread.title || '新对话',
          created_at: thread.created_at,
          updated_at: thread.updated_at,
          message_count: thread.messages?.length || 0,
        });
      } catch {
        // 跳过损坏的线程文件
        continue;
      }
    }

    // 按更新时间倒序
    threads.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
    return threads;
  }

  /** 创建新线程（ontologyScope = 用户选择的本体范围；空数组 = 通用问答模式） */
  create(scenario: string, ontology: string, title: string, ontologyScope: OntologySelection[]): Thread {
    const threadId = randomUUID();
    const now = new Date().toISOString();

    const thread: Thread = {
      id: threadId,
      title: title || '新对话',
      status: 'active',
      messages: [],
      created_at: now,
      updated_at: now,
      scenario_name: scenario,
      ontology_name: ontology,
      ontology_scope: ontologyScope,
    };

    // 新建线程：UUID 全新，无归属可校验，经 PAC 取可写路径
    const dirPath = this.pac.resolveWritePath(threadId);
    mkdirSync(dirPath, { recursive: true });

    const dataPath = join(dirPath, '.data.json');
    writeFileSync(dataPath, JSON.stringify(thread, null, 2), 'utf-8');

    return thread;
  }

  /** 获取单个线程（校验线程归属的场景/本体） */
  get(scenario: string, ontology: string, threadId: string): Thread {
    const thread = this.readThread(scenario, ontology, threadId);
    return thread;
  }

  /** 删除线程及其目录（先经 readThread 做归属校验，与读路径同口径） */
  delete(scenario: string, ontology: string, threadId: string): void {
    this.readThread(scenario, ontology, threadId); // 归属校验：不属于当前场景/本体 → ForbiddenError
    const dirPath = this.pac.resolveWritePath(threadId);
    if (existsSync(dirPath)) {
      rmSync(dirPath, { recursive: true, force: true });
    }
  }

  /** 追加消息到线程 */
  appendMessages(scenario: string, ontology: string, threadId: string, messages: ThreadMessage[]): void {
    const thread = this.readThread(scenario, ontology, threadId);
    thread.messages.push(...messages);
    this.persist(thread, scenario, ontology, threadId);
  }

  /** 整体替换线程消息（短期记忆压缩后写回：摘要 + 保留原文尾部） */
  replaceMessages(scenario: string, ontology: string, threadId: string, messages: ThreadMessage[]): void {
    const thread = this.readThread(scenario, ontology, threadId);
    thread.messages = messages;
    this.persist(thread, scenario, ontology, threadId);
  }

  /** 写回线程 json（更新 updated_at）。调用前必经 readThread（append/replace），归属已校验 */
  private persist(thread: Thread, scenario: string, ontology: string, threadId: string): void {
    thread.updated_at = new Date().toISOString();
    const dirPath = this.pac.resolveWritePath(threadId);
    const dataPath = join(dirPath, '.data.json');
    writeFileSync(dataPath, JSON.stringify(thread, null, 2), 'utf-8');
  }

  /** 检查线程是否存在且属于指定场景/本体 */
  exists(scenario: string, ontology: string, threadId: string): boolean {
    try {
      this.readThread(scenario, ontology, threadId);
      return true;
    } catch {
      return false;
    }
  }

  /** 读取线程并校验归属（场景/本体必须与请求一致，防跨本体访问） */
  private readThread(scenario: string, ontology: string, threadId: string): Thread {
    const dataPath = this.pac.resolveThreadReadPath(threadId);
    if (!existsSync(dataPath)) {
      throw new ForbiddenError('对话不存在');
    }
    const raw = readFileSync(dataPath, 'utf-8');
    const thread = JSON.parse(raw) as Thread;
    if (thread.scenario_name !== scenario || thread.ontology_name !== ontology) {
      throw new ForbiddenError('对话不属于当前场景/本体');
    }
    return thread;
  }
}
