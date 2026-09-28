# 任务清单：前端测试体系与覆盖率门禁，并拆分超长组件

**特性分支**: `001-frontend-test-quality` · **规范**: [spec.md](./spec.md) · **计划**: [plan.md](./plan.md)

> 说明：本特性是**在当前项目上增量推进**，不新开工程、不重写既有模块；所有改动受章程 v1.0.1 约束。

## 阶段 1：测试基础设施（用户故事 1，P1）✅ 已完成

- [x] T001 `frontend/package.json` 增加测试 devDependencies 与 `test` / `test:coverage` 脚本
- [x] T002 新增 `frontend/vitest.config.ts`：jsdom 环境、`@` 别名、覆盖率四维阈值 80%
- [x] T003 新增 `frontend/src/test/setup.ts`：jest-dom、`matchMedia`/`ResizeObserver` stub、`getComputedStyle` 降级、`fetch` 网络隔离
- [x] T004 安装依赖并确认 `npm run test:coverage` 可运行
- [x] T004a 抽出 `src/api/http-error.ts`（错误解析由两个 client 共用），使其可被直接单测

## 阶段 2：核心层补测（用户故事 2，P2）✅ 已完成

- [x] T005 `src/utils/a11y.ts` 单测（7 例）
- [x] T006 `src/utils/yaml-segments.ts` 单测（9 例）
- [x] T007 `src/api/http-error.ts` 单测（6 例）
- [x] T008 `client.ts`、`agent-client.ts` 改为调用被测模块（行为不变）

## 阶段 3：组件补测（用户故事 2，P2）进行中

- [x] T009 `ResizableTable` 单测（3 例，并修复拖拽高亮未接线）
- [ ] T010 `JsonEditor` / `PythonEditor` 单测
- [ ] T011 `MCPService` 单测
- [ ] T012 `DataEngineTable` 单测
- [ ] T013 `MCPConfig` 单测
- [ ] T014 其余展示型组件按批补测
- [x] T014a 覆盖率 `include` 已随补测扩展：`a11y` / `yaml-segments` / `http-error` / `ResizableTable` /
  `agent/security-confirm-content` / `rule/rule-operands`（后续每批继续追加）

## 阶段 4：超长文件拆分（用户故事 3，P3）进行中

- [x] T018 拆分 `api/client.ts`（625 行）：按领域拆为
  `http` / `scenarios` / `ontologies` / `design` / `data-engines` / `threads` / `deploy` / `skills` / `mcp`，
  由 `client.ts`（19 行）作 barrel 再导出，**既有 `@/api/client` 导入路径不变**
  > 结果：`api/` 下最大文件 226 行（design.ts），已达标
- [ ] T015 拆分 `AgentApp.tsx`（原 1474 行）——分批进行：
  - [x] T015a 为可独立抽取的纯逻辑补测：`security-confirm-content.ts`（新增 10 例）
  - [x] T015b 抽取到 `components/Design/agent/`：`SecurityConfirmModal`、`SubtaskBlock`、`NarrativeBlock`、`EntryCard`、`chat-types`
    > 结果：`AgentApp.tsx` 1474 → 1198 行；`security-confirm-content.ts` 分支覆盖 95.65%
  - [ ] T015c 拆分 `AgentConversation`（约 959 行）——聊天主干，**必须在补测后进行**：
    - [ ] 先补 `AgentConversation` 关键路径测试（消息渲染 / 子任务块 / 流式事件 / 参数编辑），需 mock `agentChatStream` 与线程 API
    - [ ] 再抽取 `MessageBubble`、参数编辑区、输入区等子组件，目标 ≤500 行
- [x] T017 拆分 `RuleTable.tsx`（752 行）：抽为
  `rule/rule-operands.ts`（操作数纯逻辑）+ `rule/RuleEditors.tsx`（操作数/条件/验证/推理编辑器）
  > 结果：`RuleTable.tsx` 752 → **471 行**（达标）；`rule-operands.ts` 覆盖率 100/92.18/100/100
- [ ] T016 拆分 `DataEngineTable.tsx`（原 851 行）—— 分两步：
  - [x] T016a 抽纯 helper 到 `Design/data-engine/data-engine-helpers.ts`
    （字段拍平 / Schema→params / 样本反推结构 / 空白引擎）
    > 结果：851 → **732 行**；helper 新增 16 例单测
  - [ ] T016b 抽配置/映射/试调弹窗（约 290 行）——**需先补测**：弹窗是映射页行为最密集处
    （`target`/`input_mapping`/`output_mapping` 三份手工对齐，出错代价高）
- [x] T019a 拆分 `app/page.tsx`（504 行）：对话弹窗抽为 `app/home-dialogs.tsx`（`<HomeDialogs>` + 分组 props）
  > 结果：`app/page.tsx` 504 → **361 行**（达标）
- [x] T019b 拆分 `app/design/[id]/page.tsx`（506 行）：内容区抽为 `components/Design/DesignContent.tsx`
  > 结果：`design/[id]/page.tsx` 506 → **444 行**（达标）；同步清理 17 个不再使用的组件导入
- [x] T019c 拆分 `View/InstanceGraph.tsx`（604 行）：抽 `View/instance-graph-model.ts`
  （常量 + 节点/边类型 + `extractRows` + `nodeLabel` + `buildResultColumns` + `buildChartOption`）
  > 结果：`InstanceGraph.tsx` 604 → **477 行**（达标）；模型层新增 15 例单测，覆盖率 100/92.3/97.05/100

当前仍 >500 行的文件（2 个）：

| 文件 | 行数 | 备注 |
|---|---|---|
| `components/Design/AgentApp.tsx` | 1203 | 已从 1474 降下；待 T015c 拆 `AgentConversation`（需先补测） |
| `components/Design/DataEngineTable.tsx` | 851 | 待 T016；弹窗与主组件耦合较深（40+ props），建议先补测再拆 |

## 阶段 5：门禁与回归（验收）进行中

- [x] T020 `npx tsc --noEmit` 通过
- [x] T021 `npm run test:coverage` 全绿且覆盖率达标（语句 100% / 分支 95% / 函数 93.75% / 行 100%，退出码 0）
- [x] T022 `npm run build` 成功（镜像内 `next build` 通过）
- [x] T023 脚本核对：全部文件 ≤500 行（**0 个超标**，最大 `AgentConversation.tsx` 489 行）
- [x] T024 重建 `optonto-frontend` 镜像并重启验证（`:81`、`/api/scenarios`、`/mcp/tools` 均 200）
- [x] T025 补齐最后两个超限文件（本轮完成，先抽纯逻辑 + 补测再拆）
  - `DataEngineTable.tsx` 732 → **449**：
    纯判据/表单初值进 `data-engine/data-engine-helpers.ts`（+8 函数，+17 测试）；
    弹窗拆为 `data-engine/{TargetConfigModal,MappingModal,ConnectTestModal,BehaviorEditModal,SmartActionModals}.tsx`
    —— 其中 `MappingModal` 由输入/输出两处近百行重复 JSX 收敛为同一组件
  - `AgentApp.tsx` 1203 → **236**（会话列表）+ `agent/AgentConversation.tsx` **489**：
    纯逻辑进 `agent/plan-editing.ts`（规划编辑/校验）与 `agent/execution-log.ts`（记录分组）+26 测试；
    展示层拆为 `MessageList` / `PlanConfirmModal` / `ExecutionLogDrawer`；
    两段重复的确认倒计时收敛为 `use-confirm-countdown.ts`
- [x] T026 覆盖率 `include` 纳入 4 个新纯逻辑模块；门槛未下调
      （All files：语句 100% / 分支 94.1% / 函数 98.36% / 行 100%；143 例全通过）

## 依赖关系

- 阶段 1 → 阶段 2/3 → 阶段 4（必须先在测试护栏下再拆分）
- T015 内部有强顺序：T015a → T015b → T015c
- 覆盖率 `include` 范围随 T014a 逐批扩大；**禁止**通过下调阈值来"达标"

## 遗留说明（诚实记录）

- **部署验证已补跑**（首轮 Docker 未启动时的欠账已清）：T019a/T019b/T019c 的改动
  经 `docker compose build optonto-frontend` + `up -d` 验证，`:81` 与 `/api/scenarios` 均 200。

- `ResizableTable.tsx` 分支覆盖 85%：未覆盖的 3 处为防御性守卫（`if (!th) return`、`if (!dragRef.current) return`、`columns || []`），单元测试范围内不可达。

- **组件级测试已闭环**（本轮补齐）：全部 11 个拆分产出的组件都有组件渲染测试，
  按「属性传递 / 事件触发 / 边界条件」三段组织，共 **318 例**（含纯逻辑 43 例）。
  覆盖率 `include` 已纳入这 11 个组件，门槛未下调：
  **All files 语句 96.67% / 分支 88.48% / 函数 83.61% / 行 96.67%**，`vitest run --coverage` 退出码 0。

- 组件测试基座（新增 `src/test/antd.ts` + 扩展 `src/test/setup.ts`）沉淀了四条经验，
  后续新增组件测试可直接复用，避免重复踩坑：
  1. antd `Modal`/`Select` 浮层在 **body 的 portal**，不在 RTL 容器内 → 统一查 `document`；
  2. `Select` 非原生控件，需 `mousedown` 到 `.ant-select-selector` 才展开；
  3. 带图标的按钮，图标会贡献 `aria-label`，可访问名变成「code 编辑输入」这类 → 用正则匹配；
  4. `findBy*`/`waitFor` 默认等 1000ms，全量并发时不够 → 统一放宽到 5s
     （`maxWorkers: 3` 限并发 + 重文件单独 60s 超时）。

- **顺带修掉一个真实 bug**：`MessageList` 里「点击工具返回数据展开详情」原本用
  `nextElementSibling` 取目标节点，但详情 `<pre>` 是**子节点**，导致该交互一直失效；
  测试暴露后改为按 id 定位，并补 `clickableProps` 无障碍属性。

- 拆分为「先抽纯逻辑 + 补测，再抽展示组件」两步：纯逻辑（可测）先行落地，
  展示组件先保持零行为改动，降低回归风险。
