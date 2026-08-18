import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** 查找项目根目录下的 config/.env */
function findEnvPath(): string {
  const candidates = [
    resolve(__dirname, '../../config/.env'),     // src/ 与 dist/ 向上两级均为项目根 → config/
    '/app/config/.env',                          // Docker 容器内
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return ''; // 不强制，可能已通过环境变量注入
}

function loadConfig() {
  // 注意：这里的 process.env 写入是 pi-ai SDK 的鉴权契约，不能删——
  // SDK 内部从 process.env.DEEPSEEK_API_KEY 取 key（见 node_modules/@earendil-works/pi-ai env-api-keys.js），
  // 不把 config/.env 注入 env，Agent 调用会因缺 key 失败。已存在的 env 优先（容器注入 > 文件）。
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
    dataDir: process.env['DATA_DIR'] || resolve(__dirname, '../../.data'),
    port: parseInt(process.env['PORT'] || '8003', 10),
    // 会话线程统一存放（.data/threads，与本体目录解耦；Docker 为 /app/.data/threads）
    threadsDir: process.env['THREADS_DIR'] || resolve(__dirname, '../../.data/threads'),
    // 全局 MCP 配置路径（./config/mcp-config.json，src/ 与 dist/ 均向上两级到项目根；Docker 为 /app/config）
    mcpConfigPath: process.env['MCP_CONFIG_PATH'] || resolve(__dirname, '../../config/mcp-config.json'),
  };
}

export const config = loadConfig();
export type Config = typeof config;

