import { resolve, normalize, relative } from 'node:path';
import { existsSync } from 'node:fs';

/**
 * PathAccessController — Agent 文件访问权限控制的核心。
 *
 * 所有文件 IO 必须经过此控制器，严格限制为：
 *   - 只读：{dataDir}/onto_market/{scenario}/{ontology}/skills/**   (技能文件)
 *   - 读写：{dataDir}/onto_market/{scenario}/{ontology}/threads/agent/** (对话线程)
 *
 * 任何路径穿越（..）或越权操作都会被拒绝。
 */
export class PathAccessController {
  constructor(private readonly dataDir: string) {}

  /**
   * 解析可读路径，仅允许读取 skills/ 目录下的文件。
   * @throws {ForbiddenError} 如果路径越权
   */
  resolveReadPath(type: 'skill', scenario: string, ontology: string, skillName: string, filename?: string): string {
    this.assertValidPathComponent(scenario, '场景');
    this.assertValidPathComponent(ontology, '本体');
    this.assertValidPathComponent(skillName, '技能名');

    const base = resolve(this.dataDir, 'onto_market', scenario, ontology, 'skills', skillName);
    const finalPath = filename ? resolve(base, filename) : base;

    this.assertWithinBase(finalPath, base);
    this.assertPathExists(finalPath, `技能文件 "${skillName}" 不存在`);
    return finalPath;
  }

  /**
   * 解析可读写路径，仅允许 threads/agent/ 目录下的操作。
   * @throws {ForbiddenError} 如果路径越权
   */
  resolveWritePath(type: 'thread', scenario: string, ontology: string, threadId: string, ...rest: string[]): string {
    this.assertValidPathComponent(scenario, '场景');
    this.assertValidPathComponent(ontology, '本体');
    this.assertValidPathComponent(threadId, '线程 ID');

    const base = resolve(this.dataDir, 'onto_market', scenario, ontology, 'threads', 'agent', threadId);
    const finalPath = rest.length > 0 ? resolve(base, ...rest) : base;

    this.assertWithinBase(finalPath, base);
    return finalPath;
  }

  /**
   * 解析只读的线程目录检查（用于读取 .data.json）
   */
  resolveThreadReadPath(scenario: string, ontology: string, threadId: string): string {
    this.assertValidPathComponent(scenario, '场景');
    this.assertValidPathComponent(ontology, '本体');
    this.assertValidPathComponent(threadId, '线程 ID');

    const base = resolve(this.dataDir, 'onto_market', scenario, ontology, 'threads', 'agent', threadId);
    const finalPath = resolve(base, '.data.json');

    this.assertWithinBase(finalPath, base);
    return finalPath;
  }

  /**
   * 列出某本体下的技能目录
   */
  listSkillDirs(scenario: string, ontology: string): string {
    this.assertValidPathComponent(scenario, '场景');
    this.assertValidPathComponent(ontology, '本体');
    const dir = resolve(this.dataDir, 'onto_market', scenario, ontology, 'skills');
    return dir;
  }

  /**
   * 列出某本体下的 agent 线程目录
   */
  listThreadDirs(scenario: string, ontology: string): string {
    this.assertValidPathComponent(scenario, '场景');
    this.assertValidPathComponent(ontology, '本体');
    const dir = resolve(this.dataDir, 'onto_market', scenario, ontology, 'threads', 'agent');
    return dir;
  }

  /** 校验 hasPermission 和场景本体值（用于 mcp-config.json） */
  assertCanConfigAccess(scenario: string, ontology: string): void {
    this.assertValidPathComponent(scenario, '场景');
    this.assertValidPathComponent(ontology, '本体');
  }

  /** 取本体目录下 config 存放路径 */
  resolveConfigDir(scenario: string, ontology: string): string {
    this.assertValidPathComponent(scenario, '场景');
    this.assertValidPathComponent(ontology, '本体');
    return resolve(this.dataDir, 'onto_market', scenario, ontology);
  }

  // ── 私有校验方法 ──────────────────────────────

  /** 校验路径组件，拒绝路径穿越和空值 */
  private assertValidPathComponent(value: string, label: string): void {
    if (!value || typeof value !== 'string') {
      throw new ForbiddenError(`${label}不能为空`);
    }
    if (value.includes('..') || value.includes('/') || value.includes('\\')) {
      throw new ForbiddenError(`${label}包含非法字符`);
    }
    // 限制长度防止滥用
    if (value.length > 200) {
      throw new ForbiddenError(`${label}过长`);
    }
  }

  /** 校验最终路径在基准路径之下（防止路径穿越） */
  private assertWithinBase(finalPath: string, basePath: string): void {
    const normalizedFinal = normalize(finalPath);
    const normalizedBase = normalize(basePath);

    const rel = relative(normalizedBase, normalizedFinal);
    if (rel.startsWith('..') || rel === normalizedFinal) {
      throw new ForbiddenError('路径越权：不允许访问基准目录之外的文件');
    }
  }

  /** 校验文件或目录存在 */
  private assertPathExists(path: string, message: string): void {
    if (!existsSync(path)) {
      throw new ForbiddenError(message);
    }
  }
}

export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ForbiddenError';
  }
}
