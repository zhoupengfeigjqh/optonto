import { Router, Request, Response } from 'express';
import { SkillLoader } from '../services/skill-loader.js';
import type { SkillInfo } from '../types.js';

export function createSkillsRouter(skillLoader: SkillLoader): Router {
  const router = Router();

  /**
   * GET /onto_market/skills/all
   * 扫描 onto_market 全部本体，返回所有技能及所在位置（技能选择下拉用）。
   * 注意放在 :scenario/:ontology 路由之前，避免被当成场景/本体匹配。
   */
  router.get('/onto_market/skills/all', (req: Request, res: Response) => {
    try {
      const skills: SkillInfo[] = skillLoader.listAllSkills();
      res.json(skills);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  /**
   * GET /onto_market/:scenario/:ontology/skills
   * 获取某本体下所有可用技能列表
   */
  router.get('/onto_market/:scenario/:ontology/skills', (req: Request, res: Response) => {
    try {
      const scenario = req.params.scenario as string;
      const ontology = req.params.ontology as string;
      const skills: SkillInfo[] = skillLoader.listSkills(scenario, ontology);
      res.json(skills);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  return router;
}
