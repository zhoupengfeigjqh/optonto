# 任务清单：需求汇总按版本号筛选

**Input**: 设计文档
- `specs/011-requirement-version-filter/spec.md`（用户故事 P1/P2）
- `specs/011-requirement-version-filter/plan.md`（技术栈、结构、章程 gate）
- `specs/011-requirement-version-filter/research.md`（D1-D8 决策）
- `specs/011-requirement-version-filter/data-model.md`（内存模型、状态机、V1-V6）
- `specs/011-requirement-version-filter/contracts/version-filter.md`（模块与 UI 契约）
- `specs/011-requirement-version-filter/quickstart.md`（验收脚本与失败判定）

**测试**: 本特性测试为**强制项**（章程 III：测试完备性不可协商），不作为可选项跳过。

**组织方式**: 按用户故事分阶段，每个故事可独立实现与独立验证。

## 格式说明：`[ID] [P?] [Story] 描述`

- **[P]**：可并行执行（**不同文件**、无未完成依赖）。同一文件内的多个任务**不得**标 [P]。
- **[Story]**：所属用户故事（US1 / US2 / US3）。Setup、Foundational、Polish 阶段不带故事标签。
- 所有描述均含**具体文件路径**。

## 路径约定

前端仓库根为 `frontend/`，涉及文件：

```text
frontend/src/components/Design/requirement-version-filter.ts
frontend/src/components/Design/requirement-version-filter.test.ts
frontend/src/components/Design/RequirementSummary.tsx
frontend/src/components/Design/RequirementSummary.test.tsx
frontend/vitest.config.ts
```

---

## Phase 1: Setup（基线确认）

**目的**：在改动前固定回归基线，避免"改完不知道坏了什么"。

- [x] T001 执行 `cd frontend && npx vitest run` 与 `npx eslint src --ext .ts,.tsx`，把测试文件数/用例数与 lint 结果记录到本文件（`specs/011-requirement-version-filter/tasks.md`）末尾"验收记录"，作为零回归基线
- [x] T002 [P] 阅读 `frontend/src/test/antd.ts` 与 `frontend/src/components/Design/DataEngineTable.test.tsx`，确认 antd `Select` 浮层（挂 body）与表格交互的既有测试手法，不改动任何文件

---

## Phase 2: Foundational（阻塞性前置）

**目的**：抽出纯函数模块，作为三个用户故事的共同基础。

**⚠️ 关键**：本阶段完成前，任何用户故事都无法开始。

- [x] T003 新建 `frontend/src/components/Design/requirement-version-filter.ts`，定义并导出保留常量 `ALL_VERSIONS`/`UNSET_VERSION`、展示文本常量、`VersionOption` 类型（契约见 `contracts/version-filter.md` A.1）
- [x] T004 在 `frontend/src/components/Design/requirement-version-filter.ts` 实现 `normalizeVersion` 与 `versionKeyOf`（trim、`null/undefined → ''`、不折叠大小写）
- [x] T005 在 `frontend/src/components/Design/requirement-version-filter.ts` 实现 `compareVersionDesc`（数字段按数值、非数字段按字符串、整体降序；不得依赖 `localeCompare`）
- [x] T006 在 `frontend/src/components/Design/requirement-version-filter.ts` 实现 `buildVersionOptions`（首项「全部」+ 版本号去重降序；本阶段**不含**「未填写版本」，由 US2 的 T014 补齐）
- [x] T007 在 `frontend/src/components/Design/requirement-version-filter.ts` 实现 `filterByVersion`（返回子集且保持原顺序；未知选择值返回空数组）
- [x] T008 编写 `frontend/src/components/Design/requirement-version-filter.test.ts`：覆盖常量语义、`normalizeVersion` 边界、`v1.10 > v1.9`、非语义化版本号（`2026-11-20` / `v1.0-beta`）、选项数量与顺序、`filterByVersion(items, ALL_VERSIONS)` 全等；并断言 `filterByVersion` 在 500 条数据上单次执行 < 20ms（SC-003 的自动化测量口径）
- [x] T009 在 `frontend/vitest.config.ts` 的 `coverage.include` 中登记 `src/components/Design/requirement-version-filter.ts`（章程 III：抽出的核心模块必须纳入门禁）

**检查点**：`npx vitest run src/components/Design/requirement-version-filter.test.ts` 全绿，且该文件覆盖率 ≥80%。

---

## Phase 3: User Story 1 - 按版本号过滤需求文档 (P1) 🎯 MVP

**目标**：标题行右侧出现下拉（默认「全部」），选版本后表格只剩该版本的行。

**独立验证**：仅实现本阶段即可交付——选 v1.0 后表格只剩 v1.0，选「全部」恢复；未筛选时与改动前逐项一致。

### 实现

- [x] T010 [US1] 在 `frontend/src/components/Design/RequirementSummary.tsx` 增加 `selectedVersion` 状态（初值 `ALL_VERSIONS`）与 `useMemo` 派生的 `options` / `visibleItems`
- [x] T011 [US1] 在 `frontend/src/components/Design/RequirementSummary.tsx` 把标题行改为左右布局：左侧保留「需求汇总」标题，右侧放 antd `Select`（`aria-label="按版本号筛选"`、宽度约 160、无清除按钮），options 来自 T010
- [x] T012 [US1] 在 `frontend/src/components/Design/RequirementSummary.tsx` 把 `Table` 的 `dataSource` 改为 `visibleItems`；**列定义、`rowKey`、`pagination`、操作入口一律不动**
- [x] T013 [US1] 在 `frontend/src/components/Design/RequirementSummary.tsx` 确保切换场景/本体时（既有的 `useEffect` 依赖 `scenarioName`/`ontologyName`）把 `selectedVersion` 重置为 `ALL_VERSIONS`

### 测试

- [x] T014 [P] [US1] 新建 `frontend/src/components/Design/RequirementSummary.test.tsx`：mock `@/api/client`，覆盖「默认全部且行数等于数据条数」「选某版本后只剩该版本」「切回全部后恢复」「切换筛选不触发 `listRequirements` 二次调用」；并补充两条边界断言：(a) 筛选后 `listRequirements` 的入参仍为当前 `scenarioName`/`ontologyName`（FR-006）；(b) 表头列数与列文本在筛选前后一致、同一文档的「本体生成」标签文本不变（FR-007 / US1-场景4）
- [x] T015 [US1] 在 `frontend/src/components/Design/RequirementSummary.test.tsx` 补充无障碍断言：`Select` 具备可读名称；用 `frontend/src/test/antd.ts` 的 `selectOption()` 通过键盘/浮层路径完成一次筛选（章程 IV：组件内自测，不留到复核）

**检查点**：`npx vitest run src/components/Design/RequirementSummary.test.tsx` 全绿；手工按 `quickstart.md` 场景 A 验证通过。

---

## Phase 4: User Story 2 - 选项来自真实数据，历史空版本不隐藏 (P2)

**目标**：下拉不出现空版本选项；`v1.10` 排在 `v1.9` 之前；版本号为空的历史文档可通过「未填写版本」查到且排在最后。

**独立验证**：只有 v1.0 数据时下拉为两项；造一条空版本文档后出现「未填写版本」并可筛选出它。

### 实现

- [x] T016 [US2] 修改 `frontend/src/components/Design/requirement-version-filter.ts` 的 `buildVersionOptions`：存在空版本条目时在末尾追加 `{ value: UNSET_VERSION, label: UNSET_VERSION_LABEL }`
- [x] T017 [US2] 修改 `frontend/src/components/Design/RequirementSummary.tsx` 的空态文案：选中「全部」→ 原有文案；选中具体版本 → 「该版本下暂无需求文档」；选中「未填写版本」→ 「没有未填写版本的需求文档」（用 `locale.emptyText`）

### 测试

- [x] T018 [P] [US2] 扩充 `frontend/src/components/Design/requirement-version-filter.test.ts`：空版本置末、「无条目时只有全部」、`v1.9`/`v1.10`/`v2.0` 降序、大小写不合并、**版本号字面等于「全部」的条目仍可被筛出**（验证保留值不与 label 冲突）
- [x] T019 [US2] 扩充 `frontend/src/components/Design/RequirementSummary.test.tsx`：空版本文档出现在「未填写版本」下、三种空态文案分别正确；并断言当前没有任何文档时下拉处于 `disabled`（不可展开）但仍可见（US2-场景4 / 契约 B.2「空集合」）

**检查点**：手工按 `quickstart.md` 场景 B、C 验证通过；纯函数与组件测试全绿。

---

## Phase 5: User Story 3 - 筛选与增删操作不打架 (P2)

**目标**：删除当前版本最后一条后自动回「全部」并提示；进详情再返回保持筛选；不出现"停在空版本且无提示"。

**独立验证**：筛选到只有 1 条的版本，删除后提示出现、下拉回「全部」、列表显示其余文档。

### 实现

- [x] T020 [US3] 在 `frontend/src/components/Design/requirement-version-filter.ts` 实现 `resolveSelectionAfterChange(options, selected)`（仍存在→原样；否则→`ALL_VERSIONS`）
- [x] T021 [US3] 在 `frontend/src/components/Design/RequirementSummary.tsx` 分两级处理失效选择：① **派生阶段**同步校正（`selectedVersion` 不在 `options` 中时按 `ALL_VERSIONS` 过滤，避免渲染一帧空表，见 data-model V7）；② `useEffect` 只负责把状态同步为「全部」并 `message.info('当前版本已无需求文档，已显示全部')`（仅值真的变化时触发，避免重复提示）
- [x] T022 [US3] 在 `frontend/src/components/Design/RequirementSummary.tsx` 确认「查看详情 → 返回」路径不重置筛选（组件未卸载，`useState` 自然保留），必要时调整 `onBack` 中的 `load()` 顺序以免先清空再渲染

### 测试

- [x] T023 [P] [US3] 扩充 `frontend/src/components/Design/requirement-version-filter.test.ts`：`resolveSelectionAfterChange` 三条分支（仍存在 / 消失 / 传入「全部」）
- [x] T024 [US3] 扩充 `frontend/src/components/Design/RequirementSummary.test.tsx`：删除某版本最后一条后自动回落 + 提示文案，并断言该过程中不出现"空表 + 空态文案"的中间帧；「查看→返回」后筛选保持；组件重挂载后回到「全部」（FR-011 的刷新分支）；空版本空态

**检查点**：手工按 `quickstart.md` 场景 D、E 验证通过。

---

## Phase 6: 收尾与横切关注点

- [x] T025 全量回归：在 `frontend/` 下执行 `npx vitest run`（文件数应为基线 +2，用例只增不减）与 `npx eslint src --ext .ts,.tsx`（0 error，warning 不新增），结果写入 `specs/011-requirement-version-filter/tasks.md` 验收记录
- [x] T026 覆盖率核对：在 `frontend/` 下执行 `npx vitest run --coverage`，确认 `frontend/vitest.config.ts` 中登记的 `src/components/Design/requirement-version-filter.ts` ≥80% 且不影响既有阈值
- [ ] T027 按 `specs/011-requirement-version-filter/quickstart.md` 完成 8 个手工验收场景（含场景 G 键盘与场景 H 零回归），结果填入本文件"验收记录"；场景 A 需记录"点击到表格完成重绘"的实测耗时（SC-003 的人工观测口径）
- [x] T028 若实现过程中调整了任何口径（如空态文案、保留值、排序规则），回写 `specs/011-requirement-version-filter/spec.md` 修订记录与 `specs/011-requirement-version-filter/contracts/version-filter.md`；若未变化则在验收记录中注明"无变更"

---

## Dependencies（故事完成顺序）

```
Phase 1 (T001-T002)
        ↓
Phase 2 (T003-T009)  ← 纯函数模块，阻塞全部故事
        ↓
        ├── Phase 3 / US1 (T010-T015)  ← MVP，可单独交付
        │        ↓
        ├── Phase 4 / US2 (T016-T019)  ← 依赖 T006 的选项推导
        │        ↓
        └── Phase 5 / US3 (T020-T024)  ← 依赖 T016 后的 options（含 unset）
                 ↓
          Phase 6 (T025-T028)
```

- US1 可在 Phase 2 后立即开始，不依赖 US2/US3。
- US2 与 US3 都改 `RequirementSummary.tsx`，**不可并行**（同文件冲突）；但 US2 的纯函数测试（T018）与 US3 的纯函数测试（T023）可并行。
- T017（空态文案）与 T021（回落逻辑）同文件，按序执行。

---

## Parallel Example: US1 测试与实现

```bash
# T014 与 T010-T013 可并行（不同文件：测试文件 vs 源文件）：
Task: "在 frontend/src/components/Design/RequirementSummary.test.tsx 覆盖默认全部/按版本过滤/无二次请求"
Task: "在 frontend/src/components/Design/RequirementSummary.tsx 接入 selectedVersion 与 Select"
```

```bash
# T018 与 T023 可并行（同一测试文件的两个不同扩充批次需串行；
# 若拆成独立文件则可并行 —— 本项目约定同名同目录单文件，故实际串行执行）
```

---

## Implementation Strategy

### MVP 优先（仅 US1）

1. Phase 1 + Phase 2（纯函数与门禁登记）
2. Phase 3（下拉 + 过滤 + 组件测试）
3. **停下来验证**：跑 `quickstart.md` 场景 A / H，确认未筛选时零回归
4. 可交付演示

### 增量交付

1. Setup + Foundational → 基础就绪
2. US1 → 独立验证 → 交付（MVP）
3. US2 → 独立验证（场景 B、C）→ 交付
4. US3 → 独立验证（场景 D、E）→ 交付
5. Phase 6 全量回归与验收记录

### 多人的并行策略

- Phase 2 完成后：A 做 US1；B 只能等 US1 的 `RequirementSummary.tsx` 落地后再做 US2/ US3（同文件）
- 可并行的只有"纯函数测试扩充"与"组件测试编写"这类不同文件的工作

---

## 验收记录

> 执行完成后填写，供 `/speckit.implement` 后的核对使用。

| 项 | 结果 |
| :-- | :-- |
| 基线（T001） | 50 files / 629 tests passed；eslint 0 error（11 warning 均为存量） |
| 纯函数测试 | 28 passed（含「500 条过滤 < 20ms」性能断言，实测远低于阈值） |
| 组件测试 | 12 passed（含列文本不变、生成标签不变、无二次请求、删除回落、返回保持、重挂载重置、下拉 disabled） |
| 全量回归（T025） | 52 files / 669 tests passed（629 + 40 新增）；`npx vitest run` 连跑两次均全绿；eslint 0 error，warning 未新增 |
| 覆盖率（T026） | `requirement-version-filter.ts`：语句 100% / 分支 97.87% / 函数 100% / 行 100%；全局 97.61 / 90.62 / 87.05 / 97.61（阈值 80%，通过） |
| 手工验收（T027） | **未执行**：需浏览器环境（8 个场景含键盘与零回归的人工比对），留待人工按 quickstart 走查 |
| SC-003 耗时 | 自动化口径通过（500 条过滤 < 20ms）；端到端"点击到重绘"待人工记录 |
| 规格回写（T028） | 无变更：实现与 spec / contracts / data-model 一致 |

### 实现备注

1. **T006 与 T016 合并执行**：两者改的是同一文件的同一个函数（`buildVersionOptions` 的「未填写版本」分支），分两次改写会重复回退同一处代码，故一次性实现最终形态；两条任务均已勾选。
2. **「该版本下暂无需求文档」为防御性文案**：因选项由数据实时派生 + V7 要求派生阶段校正，该状态在正常交互下不可达（选中版本一旦没有文档，选择本身就会回落到「全部」）。保留该分支以防 `options` 与 `items` 极端不同步时出现空白表格无提示；组件测试覆盖了另外两种空态。
3. **覆盖率首次运行时出现过一次 `[vitest-worker]: Timeout calling "onTaskUpdate"` 的 vitest 基础设施超时**（非用例失败，52 files / 669 tests 全绿）。随后单独复跑一次全量未复现，故未调整 `maxWorkers`；若后续频繁出现，再按 `vitest.config.ts` 既有注释的思路降并发。

---

## Notes

- [P] 仅用于**不同文件**的任务；同文件任务一律串行，避免覆盖冲突。
- 每个任务都要能独立完成并验证，不留"以后补"的隐性依赖。
- 测试先行：纯函数测试（T008/T018/T023）应在对应实现之后立即补齐，不要攒到最后。
- 每完成一个 Phase 即跑一次相关测试，不要等到 Phase 6 才发现回归。
- 禁止在 `RequirementSummary.tsx` 中重复实现排序/去重逻辑（唯一实现在纯函数模块）。
