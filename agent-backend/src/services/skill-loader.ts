import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PathAccessController } from '../security/path-access-controller.js';
import type { SkillInfo, SkillDescription, SkillContext } from '../types.js';

/**
 * SkillLoader — 只读加载技能目录下的 SKILL.md 文件。
 * 所有操作都经过 PathAccessController 权限校验。
 */
export class SkillLoader {
  constructor(private pac: PathAccessController) {}

  /** 列出某本体下所有可用技能 */
  listSkills(scenario: string, ontology: string): SkillInfo[] {
    const skillsDir = this.pac.listSkillDirs(scenario, ontology);
    if (!existsSync(skillsDir)) return [];

    const entries = readdirSync(skillsDir, { withFileTypes: true });
    const skills: SkillInfo[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillPath = join(skillsDir, entry.name, 'SKILL.md');
      if (!existsSync(skillPath)) continue;

      try {
        const content = readFileSync(skillPath, 'utf-8');
        skills.push({
          name: entry.name,
          description: this.extractDescription(content),
          summary: this.extractSummary(content),
        });
      } catch {
        continue;
      }
    }

    return skills;
  }

  /** 加载单个技能的 SKILL.md 完整内容 */
  loadSkill(scenario: string, ontology: string, skillName: string): string {
    const path = this.pac.resolveReadPath('skill', scenario, ontology, skillName, 'SKILL.md');
    return readFileSync(path, 'utf-8');
  }

  /**
   * 获取指定技能的元数据（仅 name + description），用于 system prompt。
   * 只解析 frontmatter，不加载全文，轻量快速。
   */
  getSkillDescriptions(scenario: string, ontology: string, skillNames: string[]): SkillDescription[] {
    const skillsDir = this.pac.listSkillDirs(scenario, ontology);
    if (!existsSync(skillsDir)) return [];

    return skillNames
      .map(name => {
        const skillPath = join(skillsDir, name, 'SKILL.md');
        if (!existsSync(skillPath)) return null;
        try {
          const content = readFileSync(skillPath, 'utf-8');
          return { name, description: this.extractDescription(content) };
        } catch {
          return null;
        }
      })
      .filter((s): s is SkillDescription => s !== null);
  }

  /** 校验每个 SKILL.md 的 frontmatter 是否包含全部 4 个字段，缺失即报错 */
  validateSkillContext(scenario: string, ontology: string, skillNames: string[]): void {
    const errors: string[] = [];
    for (const name of skillNames) {
      try {
        const content = this.loadSkill(scenario, ontology, name);
        const fm = this.parseFrontmatter(content);
        const required = ['scenario_name', 'scenario_id', 'ontology_name', 'ontology_id'] as const;
        for (const field of required) {
          if (!fm[field] || !String(fm[field]).trim()) {
            errors.push(`技能 "${name}" 缺少 ${field}`);
          }
        }
      } catch (e: any) {
        errors.push(`技能 "${name}" 加载失败: ${e.message}`);
      }
    }
    if (errors.length > 0) {
      throw new Error(`技能上下文校验失败：\n${errors.join('\n')}`);
    }
  }

  /** 从 SKILL.md frontmatter 提取场景/本体上下文 */
  extractSkillContext(scenario: string, ontology: string, skillNames: string[]): SkillContext {
    if (!skillNames || skillNames.length === 0) {
      throw new Error('没有选择技能，无法提取场景/本体信息');
    }

    let merged: SkillContext | null = null;
    const errors: string[] = [];

    for (const name of skillNames) {
      try {
        const content = this.loadSkill(scenario, ontology, name);
        const fm = this.parseFrontmatter(content);

        const ctx: SkillContext = {
          scenario_name: (fm['scenario_name'] || '').trim(),
          scenario_id: Number(fm['scenario_id']),
          ontology_name: (fm['ontology_name'] || '').trim(),
          ontology_id: Number(fm['ontology_id']),
        };

        // 校验每个字段
        if (!ctx.scenario_name) errors.push(`技能 "${name}" 缺少 scenario_name`);
        if (!ctx.scenario_id && ctx.scenario_id !== 0) errors.push(`技能 "${name}" 缺少或无效 scenario_id`);
        if (!ctx.ontology_name) errors.push(`技能 "${name}" 缺少 ontology_name`);
        if (!ctx.ontology_id && ctx.ontology_id !== 0) errors.push(`技能 "${name}" 缺少或无效 ontology_id`);

        // 校验跨技能一致性
        if (merged) {
          if (merged.scenario_name !== ctx.scenario_name) errors.push(`技能 "${name}" 的 scenario_name ("${ctx.scenario_name}") 与之前技能 ("${merged.scenario_name}") 不一致`);
          if (merged.scenario_id !== ctx.scenario_id) errors.push(`技能 "${name}" 的 scenario_id (${ctx.scenario_id}) 与之前技能 (${merged.scenario_id}) 不一致`);
          if (merged.ontology_name !== ctx.ontology_name) errors.push(`技能 "${name}" 的 ontology_name ("${ctx.ontology_name}") 与之前技能 ("${merged.ontology_name}") 不一致`);
          if (merged.ontology_id !== ctx.ontology_id) errors.push(`技能 "${name}" 的 ontology_id (${ctx.ontology_id}) 与之前技能 (${merged.ontology_id}) 不一致`);
        } else {
          merged = ctx;
        }
      } catch (e: any) {
        errors.push(`技能 "${name}" 加载失败: ${e.message}`);
      }
    }

    if (errors.length > 0 || !merged) {
      throw new Error(`技能上下文提取失败：\n${errors.join('\n')}`);
    }

    return merged;
  }

  /** 从 SKILL.md 提取 YAML frontmatter 为键值对 */
  private parseFrontmatter(content: string): Record<string, string> {
    const result: Record<string, string> = {};
    const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!match) return result;

    const yamlBlock = match[1];
    for (const line of yamlBlock.split('\n')) {
      const sep = line.indexOf(':');
      if (sep <= 0) continue;
      const key = line.slice(0, sep).trim();
      let val = line.slice(sep + 1).trim();
      // 去除可选的引号
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (key) result[key] = val;
    }
    return result;
  }

  /** 从 SKILL.md 提取 description（YAML frontmatter 的 description 字段） */
  private extractDescription(content: string): string {
    return this.parseFrontmatter(content)['description'] || '';
  }

  /** 提取 SKILL.md 的第一段非空文本作为摘要 */
  private extractSummary(content: string): string {
    // 跳过 frontmatter
    const body = content.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '');
    const lines = body.split('\n').filter(l => l.trim());
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        return trimmed.slice(0, 200);
      }
    }
    return '';
  }
}
