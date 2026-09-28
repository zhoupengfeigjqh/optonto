# 实施计划：前端测试体系与覆盖率门禁，并拆分超长组件

**特性分支**: `001-frontend-test-quality` · **对应规范**: [spec.md](./spec.md) · **日期**: 2026-09-28

## 摘要

为前端补齐缺失的测试基础设施（运行器 + 组件测试工具 + jsdom 环境 + 覆盖率门禁），
在护栏就绪后按优先级补测组件，最后拆分超长组件至 500 行以内。
不改动任何业务行为；运行期产物与现有构建流程保持兼容。

## 技术上下文

- 栈：Next.js 14（App Router）+ React 18 + TypeScript 5 + Ant Design 5 + Tailwind 3
- 包管理：npm（`frontend/package.json`）；镜像构建时执行 `npm install`
- 路径别名：`@/*` → `./src/*`（vitest 需同步该别名）
- 测试环境：jsdom（无真实浏览器、无网络、无真实 LLM）

## 宪法检查（Constitution Check）

| 章程条款 | 本计划如何满足 |
|---|---|
| I 前端组件化 | 拆分后所有 `.tsx` ≤500 行；PascalCase 命名不变；不在渲染路径新增计算 |
| III 测试强制覆盖 | 引入运行器与覆盖率门禁；每组件补测，覆盖属性/事件/边界三类条件 |
| IV 无障碍 | 拆分时保留 `clickableProps` 等语义；测试断言键盘可达性 |
| V 性能 | 测试仅覆盖逻辑，不引入运行期依赖；拆分不增加渲染层级复杂度 |
| VI 接口契约 | 测试按统一错误契约（`message` 优先）断言前端解析 |
| 技术治理 | 新增 devDependencies 的选型理由见下节；均为测试期依赖，不进运行期产物 |
| 开发工作流 | 本计划与 tasks/spec 均为中文；门禁 = `tsc --noEmit` + `test:coverage` |

## 依赖选型理由（章程"技术治理与依赖管控"）

| 依赖 | 用途 | 选型理由 | 替代方案与不选原因 |
|---|---|---|---|
| `vitest` | 测试运行器 | 与 Vite/Next 生态同源，TS/ESM 开箱即用，配置成本低，速度快 | Jest：需额外 babel/ts-jest 配置，ESM 支持繁琐 |
| `@vitejs/plugin-react` | JSX/React 转换 | vitest 官方推荐的 React 插件 | 手写 esbuild 配置：易漂移，无收益 |
| `jsdom` | DOM 环境 | vitest 官方支持，生态成熟 | happy-dom：antd 兼容性风险更高 |
| `@testing-library/react` | 组件测试 API | 以用户视角断言（查询可访问角色），天然对齐无障碍要求 | enzyme：已停止维护，且测实现细节 |
| `@testing-library/jest-dom` | 语义化断言 | 提供 `toBeInTheDocument` 等可读断言 | 原生断言：冗长且可读性差 |
| `@testing-library/user-event` | 交互模拟 | 更贴近真实用户事件流（含键盘/焦点） | `fireEvent`：不触发完整事件链，无障碍用例不可靠 |
| `@vitest/coverage-v8` | 覆盖率统计 | v8 原生覆盖率，零插桩、速度快 | istanbul：更慢，此处无额外收益 |

上述均为 **devDependencies**，不进入生产依赖与镜像运行期，符合"禁止非必要三方库"的例外情形（章程 III 强制要求测试）。

## 实施策略

1. **基础设施**：`vitest.config.ts`（jsdom 环境、`@` 别名、覆盖率四维阈值 80%）+ `src/test/setup.ts`（jest-dom、`matchMedia`/`ResizeObserver` stub、`fetch` stub）。
2. **核心层优先补测**：先覆盖 `src/utils/**`、`src/api/**`（纯函数、错误契约解析），再覆盖组件。
3. **组件补测**：优先交互与边界密集的组件（`ResizableTable`、`JsonEditor`、`MCPService`、`DataEngineTable` 等），逐组件补三类条件。
4. **拆分超长文件**：先拆 `AgentApp.tsx`（1463 行），提取子组件与 Hook；再处理 `DataEngineTable.tsx`、`RuleTable.tsx`、`InstanceGraph.tsx`。
5. **门禁落地**：`npm run test:coverage` 作为合并前必跑项。

### 覆盖率阈值策略

- 目标阈值：语句/分支/函数/行 **均 80%**（章程下限，不得下调）。
- 分期落地：`coverage.include` 先纳入**已补测范围**，随测试推进逐批扩大；未纳入范围的组件在 tasks.md 中逐项跟踪，
  **禁止**通过调低阈值来"达标"。

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| antd/echarts 在 jsdom 下报错（`matchMedia`、`ResizeObserver` 缺失） | setup 统一 stub；对图表组件使用轻量 mock |
| 拆分 `AgentApp` 引入行为回归 | 先补测再拆；拆完跑 `tsc` + 全量测试 + 手工路径走查 |
| 新增依赖影响镜像构建 | 仅 devDependencies；`next build` 不打包测试依赖；构建后校验镜像可用 |
| 覆盖率一次性达标困难导致门禁形同虚设 | 阈值不降；以 `include` 范围滚动扩大 + tasks 逐项跟踪 |

## 验收方式

- `cd frontend && npm run test:coverage` → 用例全绿且覆盖率达标（退出码 0）
- `npx tsc --noEmit` → 通过
- `npm run build` → 成功（拆分后）
- 所有 `.tsx` ≤500 行（脚本核对）
