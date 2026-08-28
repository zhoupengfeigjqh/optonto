import { resolve, normalize, relative } from 'node:path';
import { existsSync } from 'node:fs';

/**
 * PathAccessController — Agent 文件访问权限控制的核心。
 *
 * 所有文件 IO 必须经过此控制器，严格限制为：
 *   - 只读：{dataDir}/onto_market/{scenario}/{ontology}/skills/**   (技能文件)
 *   - 读写：{threadsDir}/agent/{threadId}/**                        (对话线程，全局平铺按线程ID存放)
 *
 * 任何路径穿越（..）或越权操作都会被拒绝。
 *
 * 名实约定：线程目录是【全局平铺】的——线程路径方法只收 threadId，不假装按场景/本体分层；
 * 线程的场景/本体【归属校验】在 ThreadStore.readThread（读 json 内记录比对），不在路径层。
 */
export class PathAccessController {
  constructor(private readonly dataDir: string, private readonly threadsDir: string) {}

  /**
   * 解析技能文件可读路径，仅允许读取 skills/ 目录下的文件。
   * @throws {ForbiddenError} 如果路径越权
   */
  resolveReadPath(scenario: string, ontology: string, skillName: string, filename?: string): string {
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
   * 解析线程目录可读写路径（全局平铺：{threadsDir}/agent/{threadId}，不按场景/本体分层）。
   * @throws {ForbiddenError} 如果路径越权
   */
  resolveWritePath(threadId: string, ...rest: string[]): string {
    this.assertValidPathComponent(threadId, '线程 ID');

    const base = resolve(this.threadsDir, 'agent', threadId);
    const finalPath = rest.length > 0 ? resolve(base, ...rest) : base;

    this.assertWithinBase(finalPath, base);
    return finalPath;
  }

  /**
   * 解析线程 .data.json 只读路径（全局平铺；归属校验由调用方读 json 比对场景/本体）
   */
  resolveThreadReadPath(threadId: string): string {
    this.assertValidPathComponent(threadId, '线程 ID');

    const base = resolve(this.threadsDir, 'agent', threadId);
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
   * agent 线程根目录（全局平铺，不按场景/本体分目录；按本体过滤由调用方读 json 实现）
   */
  listThreadDirs(): string {
    return resolve(this.threadsDir, 'agent');
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

  /**
   * 取场景/本体 meta.json 只读路径（core-backend 的 id 注册表，scenario_id/ontology_id 的权威来源）。
   * 不校验存在性——调用方自行容错（meta 缺失时静默降级）。
   */
  resolveOntologyMetaPath(scenario: string, ontology?: string): string {
    this.assertValidPathComponent(scenario, '场景');
    if (ontology !== undefined) this.assertValidPathComponent(ontology, '本体');
    return ontology
      ? resolve(this.dataDir, 'onto_market', scenario, ontology, 'meta.json')
      : resolve(this.dataDir, 'onto_market', scenario, 'meta.json');
  }

  /** 暴露数据根目录（只读，用于跨本体扫描技能文件） */
  getDataDir(): string {
    return this.dataDir;
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
