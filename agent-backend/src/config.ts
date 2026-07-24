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
