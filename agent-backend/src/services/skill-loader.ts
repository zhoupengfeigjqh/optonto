import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PathAccessController } from '../security/path-access-controller.js';
import type { SkillInfo } from '../types.js';

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

  /** 批量加载多个技能（合并为一个 context） */
  loadSkills(scenario: string, ontology: string, skillNames: string[]): string {
    return skillNames
      .map(name => {
        try {
          const content = this.loadSkill(scenario, ontology, name);
          return `## 技能: ${name}\n\n${content}`;
        } catch {
          return `## 技能: ${name}\n\n(技能文件不可用)`;
        }
      })
      .join('\n\n---\n\n');
  }

  /** 从 SKILL.md 提取 description（YAML frontmatter 的 description 字段） */
  private extractDescription(content: string): string {
    const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!match) return '';
    const frontmatter = match[1];
    const descMatch = frontmatter.match(/description:\s*["']?(.+?)["']?\s*$/m);
    return descMatch ? descMatch[1].trim() : '';
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
