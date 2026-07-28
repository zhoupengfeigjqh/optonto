import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** 查找项目根目录下的 config/.env */
function findEnvPath(): string {
  const candidates = [
    resolve(__dirname, '../../config/.env'),     // 开发: agent-backend/ -> config/
    resolve(__dirname, '../../../config/.env'),  // 编译后: dist/ -> .. -> config/
    '/app/config/.env',                          // Docker 容器内
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return ''; // 不强制，可能已通过环境变量注入
}

function loadConfig() {
  const envPath = findEnvPath();
  if (envPath) {
    const content = readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  }

  // 也尝试读 config.yaml 获取 model 名
  const yamlPaths = [
    resolve(__dirname, '../../config/config.yaml'),
    '/app/config/config.yaml',
  ];
  let modelName = 'deepseek-v4-flash';
  for (const p of yamlPaths) {
    if (existsSync(p)) {
      const yaml = readFileSync(p, 'utf-8');
      const match = yaml.match(/model:\s*["']?([\w.-]+)["']?/);
      if (match) modelName = match[1];
      break;
    }
  }

  return {
    deepseekApiKey: process.env['DEEPSEEK_API_KEY'] || '',
    deepseekBaseUrl: process.env['DEEPSEEK_BASE_URL'] || 'https://api.deepseek.com',
    modelName,
    dataDir: process.env['DATA_DIR'] || resolve(__dirname, '../../backend/.data'),
    port: parseInt(process.env['PORT'] || '8003', 10),
  };
}

export const config = loadConfig();
export type Config = typeof config;

// ─── Agent 系统提示词 ────────────────────────────────────────────────

export const AGENT_PRINCIPLES = `原则1：当智能体根据用户意图生成和执行任务时，请务必先从概念关系出发进行全局把控，然后再分析行为-规则-函数-安全等内容，以此推导出正确的执行逻辑。这是必须要遵循的原则！

原则2：请先根据用户的意图，抽取本体内容（skill），生成总任务，并将总任务拆分为子任务。

原则3：子任务按顺序执行，不允许绕过子任务或遗漏。

原则4：为了确保整个行为的执行是合法的，每当智能体要做行为执行时（即调用工具），还需要做如下检查：
1）请判断该行为是否在行为集合里
2）若在则先提取与该行为动作相关的规则和函数，进行规则验证推理或调用相关函数进行计算
3）完成2）后，请同时判断该行为动作是否需要安全管控，即需要人工介入。
4）不能绕过行为、规则和安全管控进行推理和行动

原则5：若流程中规则违反则反馈终止，若触发安全管控则反馈需要人工确认！`;
