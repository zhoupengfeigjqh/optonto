import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { load } from 'js-yaml';
import { PathAccessController } from '../security/path-access-controller.js';
import type { SkillInfo, SkillDescription, SkillContext, SkillSelection, OntologySelection, ConversationScope } from '../types.js';

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
    const path = this.pac.resolveReadPath(scenario, ontology, skillName, 'SKILL.md');
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

  /**
   * 解析单个本体选择为权威四元组（id 取自 core meta.json 注册表，实时权威）。
   * meta 缺失/解析失败返回 null——路由层据此 400（用户选了不存在的本体）。
   */
  resolveOntologyContext(scenario: string, ontology: string): SkillContext | null {
    try {
      const onMeta = JSON.parse(readFileSync(this.pac.resolveOntologyMetaPath(scenario, ontology), 'utf-8'));
      const scMeta = JSON.parse(readFileSync(this.pac.resolveOntologyMetaPath(scenario), 'utf-8'));
      const ontologyId = Number(onMeta?.id);
      const scenarioId = Number(scMeta?.id ?? onMeta?.scenario_id);
      if (!Number.isFinite(ontologyId) || !Number.isFinite(scenarioId)) return null;
      return { scenario_name: scenario, scenario_id: scenarioId, ontology_name: ontology, ontology_id: ontologyId };
    } catch {
      return null;
    }
  }

  /**
   * 解析对话作用域（新建对话/对话发起共用单一入口）：
   *  - contexts：所选本体的权威四元组（按 ontology_id 去重；解析失败的条目静默跳过——
   *    新建时路由已逐条校验，运行期跳过只对"本体后被删除"的场景兜底）
   *  - skills：所选本体目录下全部技能（自动关联，用户无感；无技能的本体照样可选，知识为空而已）
   */
  resolveScope(selections: OntologySelection[]): ConversationScope {
    const seen = new Set<number>();
    const contexts: SkillContext[] = [];
    const skills: SkillSelection[] = [];
    for (const sel of selections) {
      const ctx = this.resolveOntologyContext(sel.scenario, sel.ontology);
      if (ctx && !seen.has(ctx.ontology_id)) {
        seen.add(ctx.ontology_id);
        contexts.push(ctx);
      }
      for (const s of this.listSkills(sel.scenario, sel.ontology)) {
        skills.push({ name: s.name, scenario: sel.scenario, ontology: sel.ontology });
      }
    }
    return { contexts, skills };
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
