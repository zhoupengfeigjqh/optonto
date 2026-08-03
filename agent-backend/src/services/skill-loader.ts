import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';
import { PathAccessController } from '../security/path-access-controller.js';
import type { SkillInfo, SkillDescription, SkillContext, SkillSelection } from '../types.js';

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

  /** 加载单个技能的 SKILL.md 完整内容（按显式位置） */
  loadSkill(scenario: string, ontology: string, skillName: string): string {
    const path = this.pac.resolveReadPath('skill', scenario, ontology, skillName, 'SKILL.md');
    return readFileSync(path, 'utf-8');
  }

  /**
   * 获取选中技能的元数据（仅 name + description），用于父 Agent system prompt。
   * 每个技能用自身声明的 (scenario, ontology) 定位，支持跨本体技能集。
   */
  getSkillDescriptions(skills: SkillSelection[]): SkillDescription[] {
    return skills
      .map(s => {
        try {
          const content = this.loadSkill(s.scenario, s.ontology, s.name);
          return { name: s.name, description: this.extractDescription(content) };
        } catch {
          return null;
        }
      })
      .filter((s): s is SkillDescription => s !== null);
  }

  /** 校验每个选中技能的 SKILL.md 的 frontmatter 是否包含全部 4 个字段，缺失即报错 */
  validateSkillContext(skills: SkillSelection[]): void {
    if (!skills || skills.length === 0) return;
    const errors: string[] = [];
    for (const s of skills) {
      try {
        const content = this.loadSkill(s.scenario, s.ontology, s.name);
        const fm = this.parseFrontmatter(content);
        const required = ['scenario_name', 'scenario_id', 'ontology_name', 'ontology_id'] as const;
        for (const field of required) {
          if (!fm[field] || !String(fm[field]).trim()) {
            errors.push(`技能 "${s.name}" 缺少 ${field}`);
          }
        }
      } catch (e: any) {
        errors.push(`技能 "${s.name}" 加载失败: ${e.message}`);
      }
    }
    if (errors.length > 0) {
      throw new Error(`技能上下文校验失败：\n${errors.join('\n')}`);
    }
  }

  /** 扫描 onto_market 全部本体，返回所有技能及所在位置（技能选择下拉用） */
  listAllSkills(): SkillInfo[] {
    const ontoMarket = join(this.pac.getDataDir(), 'onto_market');
    const result: SkillInfo[] = [];
    try {
      for (const sc of readdirSync(ontoMarket, { withFileTypes: true })) {
        if (!sc.isDirectory()) continue;
        const scDir = join(ontoMarket, sc.name);
        for (const on of readdirSync(scDir, { withFileTypes: true })) {
          if (!on.isDirectory()) continue;
          const skillsDir = join(scDir, on.name, 'skills');
          if (!existsSync(skillsDir)) continue;
          for (const skill of readdirSync(skillsDir, { withFileTypes: true })) {
            if (!skill.isDirectory()) continue;
            const skillPath = join(skillsDir, skill.name, 'SKILL.md');
            if (!existsSync(skillPath)) continue;
            try {
              const content = readFileSync(skillPath, 'utf-8');
              result.push({
                name: skill.name,
                description: this.extractDescription(content),
                summary: this.extractSummary(content),
                scenario: sc.name,
                ontology: on.name,
              });
            } catch {
              continue;
            }
          }
        }
      }
    } catch {
      // 目录不存在等
    }
    return result;
  }

  /** 从 SKILL.md 提取 YAML frontmatter 为对象（与 ontology-gateway 一致使用 js-yaml） */
  private parseFrontmatter(content: string): Record<string, unknown> {
    const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!match) return {};
    try {
      const yaml = load(match[1]);
      return yaml && typeof yaml === 'object' ? (yaml as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }

  /** 从 SKILL.md 提取 description（YAML frontmatter 的 description 字段） */
  private extractDescription(content: string): string {
    return String(this.parseFrontmatter(content)['description'] ?? '').trim();
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
