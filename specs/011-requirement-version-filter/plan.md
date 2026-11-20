# 实施方案：需求汇总按版本号筛选

**Branch**: `011-requirement-version-filter` | **Date**: 2026-11-20 | **Spec**: [spec.md](./spec.md)

**Input**: 功能规格 `specs/011-requirement-version-filter/spec.md`

## Summary

在「需求汇总」列表页标题行右侧新增版本号下拉，选项由当前已加载的需求文档实时去重推导（「全部」+ 各版本号 +「未填写版本」），选中后仅显示该版本的行。

**技术路线**：纯前端改动（零后端接口变更、零新增依赖）。把"选项推导 / 自然排序 / 过滤 / 选中项回落"四件事抽成同目录纯函数模块 `requirement-version-filter.ts`，组件只负责状态与渲染。这样排序与边界规则可被单测穷举，组件保持薄。

## Technical Context

**Language/Version**: TypeScript 5.9（`frontend/`）

**Primary Dependencies**: React 18.3、Next.js 14.2（App Router，`'use client'` 组件）、antd 5.29（`Select` / `Table` / `Modal` / `message`）

**Storage**: 无新增存储。数据来自既有 `GET /api/threads/requirements/list`（`RequirementItem.version`，可能为空串）

**Testing**: Vitest 3 + jsdom + @testing-library/react；纯函数用同名同目录 `.test.ts`，组件用 `.test.tsx`

**Target Platform**: 现代浏览器（管理端设计面）

**Project Type**: Web 应用（Next.js 前端 + FastAPI 后端），本特性仅触及前端

**Performance Goals**: 切换筛选到表格更新 ≤ 200ms（本地内存过滤，百条量级），不触发额外网络请求。**测量口径**：纯函数过滤在 500 条数据上单次执行 < 20ms（自动化断言），200ms 为"点击到表格完成重绘"的人工观测值（见 quickstart 场景 A）

**Constraints**: 不改后端接口与 `RequirementItem` 形状；不改表格列定义与既有删除/查看流程；不引入新依赖（章程 VI）；**上下文边界**由既有 `listRequirements` 的 `scenario`/`ontology` 入参唯一决定，本特性不新增取数路径，筛选不得改变该入参

**Scale/Scope**: 单场景/单本体下需求文档百条量级，极端按千条设计；改动 1 个组件 + 新增 1 个纯函数模块 + 2 个测试文件 + 1 处测试门禁登记

## Constitution Check

*GATE: 设计前通过，设计后复检（见文末）。*

| 原则 | 检查结论 | 依据 / 落地方式 |
| :-- | :-- | :-- |
| I. 中文文档与规格驱动 | 通过 | 本 plan、research、data-model、contracts、quickstart 全中文；规格已建，方案阶段若调整数值需回写 spec 修订记录 |
| II. 代码质量与模块化 | 通过 | 版本比较/选项推导为**唯一实现**，抽到 `requirement-version-filter.ts`；`RequirementSummary.tsx` 改后约 120 行（<500）；不复制粘贴排序逻辑；不引用他模块下划线私有符号 |
| III. 测试完备性（不可协商） | 通过（需执行） | 纯函数 `.test.ts` + 组件 `.test.tsx` 同名同目录；新纯模块**必须**登记进 `vitest.config.ts` 的 coverage include；覆盖率 ≥80%；测试在宿主机本地跑，不依赖容器 |
| IV. 无障碍 | 通过（需执行） | 下拉使用 antd `Select`（原生键盘可达），补 `aria-label="按版本号筛选"`；需在组件任务内完成键盘验证，不留到跨故事复核 |
| V. 性能与一致性 | 通过 | `useMemo` 派生 options / visibleItems，不在渲染路径重复排序；`rowKey` 保持 `thread_id_filename` 不变；删除为破坏性操作，既有二次确认保留；本特性无新增端点，故无端点 P95 口径需要登记 |
| VI. 依赖治理 | 通过 | 零新增依赖：自然排序自实现分段比较，不引入 semver / lodash |
| VII. 接口契约两侧同改 | 通过（无需变更） | 不新增/修改任何端点与字段；前端不硬编码后端常量（版本号全部来自数据） |
| VIII. 测试部署简单可控 | 通过 | 门禁仍为单命令 `npx vitest run`；无新增部署步骤与环境变量 |
| IX. 优雅降级与故障可观测 | 通过 | 列表加载失败沿用既有 `message.error`；删除失败沿用既有提示；筛选是纯本地计算，无新增失败面 |

**平台差异风险登记**（章程 III）：本特性为纯前端逻辑与 jsdom 测试，不涉及文件系统、时区、编码、容器行为，**无平台差异风险**。

**存量补测清单结论**（章程治理条款）：既有清单为「frontend api 7 + composables 13」，本轮**不发起专项补测**；本特性改动集中在 `components/Design` 下的列表页与其纯函数，与 api/composables 补测范围无交集。补测顺序与范围维持既定清单，留待后续特性的 plan 继续给出结论。

## Project Structure

### Documentation (this feature)

```text
specs/011-requirement-version-filter/
├── spec.md              # 已完成
├── plan.md              # 本文件
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── contracts/
│   └── version-filter.md  # Phase 1（前端模块 / UI 契约）
├── quickstart.md        # Phase 1
└── tasks.md             # 由 /speckit.tasks 生成
```

### Source Code (repository root)

```text
frontend/
├── src/
│   ├── api/
│   │   └── threads.ts                        # 只读引用 RequirementItem.version，不改动
│   └── components/Design/
│       ├── requirement-version-filter.ts     # 新增：纯函数（选项推导/自然排序/过滤/回落）
│       ├── requirement-version-filter.test.ts# 新增：纯函数单测
│       ├── RequirementSummary.tsx            # 修改：标题行加下拉 + 过滤 + 空态 + 回落提示
│       └── RequirementSummary.test.tsx       # 新增：组件交互测试
└── vitest.config.ts                          # 修改：coverage include 登记新纯模块
```

**Structure Decision**: 沿用既有前端结构。改动落在单一功能域 `components/Design/RequirementSummary` 周边，新增纯函数模块与组件同目录同前缀（与 `behavior-op-type.ts` / `concept-inheritance.ts` 的既有约定一致），不新建目录、不跨域引用。

## 关键设计决策（详见 research.md）

1. **前端过滤**，不新增/修改后端查询参数：百条量级、切换零延迟、且避免与「本体生成」状态实时推导逻辑产生第二套取数口径。
2. **选项值使用保留常量**（`ALL` / `UNSET`），不用中文 label 当 value：版本号是用户自由输入，可能出现字面等于「全部」或「未填写版本」的情况，用 label 作 value 会与哨兵冲突。
3. **自然排序自实现**（数字段按数值、非数字段按字符串，降序），不依赖 `localeCompare` 的 locale 行为，也不用 semver（版本号含 `2026-11-20`、`v1.0-beta` 等非语义化形态）。
4. **未填写版本单列并置末**，绝不隐藏。
5. **选中项失效回落由派生逻辑统一处理**（`resolveSelectionAfterChange`），删除后自动回「全部」并提示，避免"停在空版本"。
6. **筛选状态随组件存续**：从详情返回保持（组件未卸载），切换场景/本体或刷新则重置为「全部」。

## Phase 执行结果

- Phase 0 → [research.md](./research.md)（7 项决策，无 NEEDS CLARIFICATION 遗留）
- Phase 1 → [data-model.md](./data-model.md)、[contracts/version-filter.md](./contracts/version-filter.md)、[quickstart.md](./quickstart.md)

## Constitution Check（设计后复检）

| 原则 | 复检结论 |
| :-- | :-- |
| I 中文文档 | 通过：全部产物中文，规格未出现需回写的数值变更 |
| II 模块化 | 通过：新增纯模块 1 个，组件仅增约 30 行；无重复实现 |
| III 测试 | 通过（待实现执行）：已明确 2 个测试文件与门禁登记位置 |
| IV 无障碍 | 通过（待实现执行）：`Select` + `aria-label`，键盘路径在组件任务内验证 |
| V 性能与一致性 | 通过：`useMemo` 派生，无 N+1、无渲染路径排序；无破坏性操作改动 |
| VI 依赖 | 通过：零新增 |
| VII 契约 | 通过：无接口变更，contracts 记录的是前端模块与 UI 行为契约 |
| VIII 部署 | 通过：门禁命令不变 |
| IX 降级 | 通过：沿用既有错误提示，无新增失败面 |

无违反项，`Complexity Tracking` 无需填写。
