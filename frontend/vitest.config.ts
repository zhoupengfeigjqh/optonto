import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

/**
 * 前端测试配置（章程 III：每组件必须有单测、核心逻辑覆盖率 ≥80%）。
 *
 * - 环境：jsdom（缺 API 的 stub 见 src/test/setup.ts）
 * - 覆盖率：四维阈值均 80%，低于阈值命令非零退出（门禁）
 * - include 范围策略：先纳入「已补测」的模块，随测试推进逐批扩大
 *   （跟踪清单见 specs/001-frontend-test-quality/tasks.md；禁止通过下调阈值达标）
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    // 组件级用例要驱动 antd 的 portal（Modal 挂到 body、Select 浮层渲染），
    // 单例约 2s；但 jsdom + antd 的组合很吃 CPU，全量并发时会被拖到 15s 以上而误报超时。
    // 对策是「限并发 + 给足超时」，而不是继续放大单个超时数字：
    // 并发下调后单例回到数秒量级，30s 只作为兜底，真正的挂起仍会被拦住。
    maxWorkers: 3,
    testTimeout: 30000,
    hookTimeout: 30000,
    // 测试期禁止真实网络：fetch 在 setup 中被替换为抛错桩，用例需显式覆盖
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: [
        'src/utils/a11y.ts',
        'src/utils/yaml-segments.ts',
        'src/api/http-error.ts',
        'src/components/ResizableTable.tsx',
        'src/components/Design/agent/security-confirm-content.ts',
        'src/components/Design/rule/rule-operands.ts',
        'src/components/View/instance-graph-model.ts',
        'src/components/Design/data-engine/data-engine-helpers.ts',
        'src/components/Design/agent/plan-editing.ts',
        'src/components/Design/agent/execution-log.ts',
        // 本轮拆分产出的展示组件（均已补齐组件级测试）
        'src/components/Design/data-engine/MappingModal.tsx',
        'src/components/Design/data-engine/ConnectTestModal.tsx',
        'src/components/Design/data-engine/BehaviorEditModal.tsx',
        'src/components/Design/data-engine/SmartActionModals.tsx',
        'src/components/Design/data-engine/TargetConfigModal.tsx',
        'src/components/Design/agent/MessageList.tsx',
        'src/components/Design/agent/PlanConfirmModal.tsx',
        'src/components/Design/agent/ExecutionLogDrawer.tsx',
        'src/components/Design/agent/AgentConversation.tsx',
        'src/components/Design/DataEngineTable.tsx',
        'src/components/Design/AgentApp.tsx',
      ],
      exclude: ['src/**/*.{test,spec}.{ts,tsx}', 'src/test/**'],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
});
