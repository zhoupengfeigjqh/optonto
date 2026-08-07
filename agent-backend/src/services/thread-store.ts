import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PathAccessController, ForbiddenError } from '../security/path-access-controller.js';
import type { Thread, ThreadSummary, ThreadMessage, SkillSelection } from '../types.js';

/**
 * ThreadStore — 对话线程数据的读写。
 * 所有操作都经过 PathAccessController 权限校验，
 * 严格限制在 {threadsDir}/agent/ 目录下（平铺按线程ID存放）。
 * 线程文件内记录 scenario_name/ontology_name，用于归属校验。
 */
export class ThreadStore {
  constructor(private pac: PathAccessController) {}

  /** 列出某本体下所有 agent 线程（平铺扫描，按线程 json 内记录的场景/本体过滤） */
  list(scenario: string, ontology: string): ThreadSummary[] {
    const baseDir = this.pac.listThreadDirs(scenario, ontology);
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

  /** 创建新线程 */
  create(scenario: string, ontology: string, title: string, skillNames: SkillSelection[]): Thread {
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
      skill_names: skillNames,
    };

    // 通过 PAC 校验路径并获取可写路径
    const dirPath = this.pac.resolveWritePath('thread', scenario, ontology, threadId);
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

  /** 删除线程及其目录 */
  delete(scenario: string, ontology: string, threadId: string): void {
    const dirPath = this.pac.resolveWritePath('thread', scenario, ontology, threadId);
    if (existsSync(dirPath)) {
      rmSync(dirPath, { recursive: true, force: true });
    }
  }

  /** 追加消息到线程 */
  appendMessages(scenario: string, ontology: string, threadId: string, messages: ThreadMessage[]): void {
    const thread = this.readThread(scenario, ontology, threadId);
    thread.messages.push(...messages);
    thread.updated_at = new Date().toISOString();

    const dirPath = this.pac.resolveWritePath('thread', scenario, ontology, threadId);
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
    const dataPath = this.pac.resolveThreadReadPath(scenario, ontology, threadId);
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
