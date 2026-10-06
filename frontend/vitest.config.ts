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
        'src/components/Design/rule/rule-logic.ts',
        'src/components/Design/rule/function-label.ts',
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
        // 2026-10-05 会话层拆分产出。三者均已配齐单测后进门禁（宪法 1.2.0：
        // 抽出的核心模块 MUST 同时补测并纳入 include，否则「拆出是为了可测、
        // 却因漏配门禁而从未被测」的空转）。
        'src/components/Design/agent/use-agent-stream.ts',
        'src/components/Design/agent/use-confirm-replies.ts',
        'src/components/Design/agent/sse-events.ts',
        // 2026-10-06 补齐三个此前无测试、无门禁的模块：
        //   chat-types是联合类型收窄的唯一依据（守卫失准 → 运行时走错分支且编译器不报错）
        //   use-confirm-countdown 是 60s 超时边界（超时唯一权威在后端，此处是体验层）
        //   markdown 的输出直接进 dangerouslySetInnerHTML，escapeHtml 是唯一注入防线
        'src/components/Design/agent/chat-types.ts',
        'src/components/Design/agent/use-confirm-countdown.ts',
        'src/lib/markdown.ts',
        'src/components/Design/DataEngineTable.tsx',
        'src/components/Design/AgentApp.tsx',
        // 2026-10-05 收口：行为操作类型推导 / 发布就绪判据 / 固定服务配置片段（均配齐单测）
        'src/components/Design/behavior-op-type.ts',
        'src/components/Design/mcp-publish/readiness.ts',
        'src/components/Design/mcp-publish/config-snippets.ts',
        // 2026-10-05 MCP 发布分页栅格（固定发布 / 自建发布两块共用，一页最多 6 个）
        'src/components/Design/mcp-publish/ServiceGrid.tsx',
        // 2026-10-05 MCP 配置页纯逻辑（请求头解析/掩码、自建发布配置片段导入）
        'src/components/Design/mcp-config/server-config.ts',
        // 2026-10-05 固定服务传输模式与客户端 type 映射（卡片展示 + 配置片段的唯一来源）
        'src/components/Design/mcp-publish/catalog.ts',
        // 2026-10-05 MCP 工具清单弹窗（自 MCPConfig.tsx 抽出以满足 500 行约束）
        'src/components/Design/mcp-config/ToolsPickerModal.tsx',
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
