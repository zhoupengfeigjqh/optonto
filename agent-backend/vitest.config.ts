import { defineConfig } from 'vitest/config';

/**
 * 后端单元测试配置（2026-10-05 新增，宪法 III / 技术治理）。
 *
 * ## 为什么此前没有配置文件
 *
 * package.json 里已有 `test:coverage` 脚本，但**没有任何配置文件**——
 * 即「只有命令、没有门禁」：覆盖率范围未声明、阈值未定义，
 * 宪法 III「核心单元覆盖率 MUST 不低于 80%」在agent-backend 侧零度量、零门禁
 * （前端自 001 规格起就有四维80% 阈值）。本文件补上这一环。
 *
 * ## include 策略：渐进式纳入（与前端一致）
 *
 * 先纳入「纯逻辑 + 已被现有单测充分覆盖」的模块，随测试推进逐批扩大。
 * 硬性约束（写进配置注释以防后人降标凑绿）：
 *  -禁止通过下调 thresholds 达标；
 *  - 新增/抽取的核心逻辑模块 MUST 同时补测并加入本清单；
 *    否则会出现「拆出是为了可测，却因漏配门禁而从未被测」的空转
 *    （该条已同步写入宪法 1.2.0「测试组织与命名」）。
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    // 测试 MUST NOT 触真实网络/LLM：这些模块一旦出现即说明分层被破坏
    exclude: ['node_modules', 'dist'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      // SAMPLING 配置待定（见下方注释）
      include: [
        'src/utils/*.ts',
        'src/agent/plan-validation.ts',
        'src/agent/param-contract.ts',
        'src/agent/execution-policy.ts',
        'src/agent/subtask-contract.ts',
        'src/agent/result-protocol.ts',
        'src/agent/security-policy.ts',
        'src/agent/error-budget.ts',
      ],
      exclude: ['src/**/*.{test,spec}.ts', 'src/test/**'],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
});