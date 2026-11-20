# 方案研究：需求汇总按版本号筛选

**Feature**: `011-requirement-version-filter` | **Date**: 2026-11-20

本文件记录 Phase 0 的技术决策。所有条目均已定论，**无 `NEEDS CLARIFICATION` 遗留**。

---

## D1. 过滤放在前端还是后端

**Decision**: 前端过滤。`listRequirements()` 的参数与返回结构保持不变。

**Rationale**:

1. 数据量级为单场景/单本体下百条，前端过滤的切换延迟在毫秒级，满足 SC-003（≤200ms）。
2. 后端筛选会引入第二套取数口径：页面还有「本体生成」状态（由 `has_ontology` 实时推导）与创建/更新时间排序，若筛选下沉到服务端，这些推导要在两条路径上保持一致，耦合度上升。
3. 零接口变更 = 零契约风险（章程 VII），也不需要前后端同时发版。

**Alternatives considered**:

- 后端新增 `version` 查询参数：被否，收益是"数据量增长后可扩展"，代价是接口与契约变更、两处排序口径、本次收益为零。
- 全量改成分页 + 服务端筛选：被否，超出本需求范围（spec 假设已声明百条量级）。

---

## D2. 选项来源：实时去重，还是版本注册表

**Decision**: 由当前已加载的 `RequirementItem[]` 实时去重推导（`useMemo`）。

**Rationale**: 选项必须与"能查到内容的版本"严格一致（FR-002）。若引入独立版本清单（如本体版本存档目录），会出现"有选项但筛选后为空"的死选项，直接违反 SC-002。

**Alternatives considered**:

- 复用 `ontology_versions/` 版本存档目录作为选项源：被否，那是部署版本，与"某个版本导出过哪些需求文档"不是同一集合。
- 后端提供 `/versions` 汇总端点：被否，纯增复杂度，且与 D1 结论冲突。

---

## D3. 选项值用保留常量，不用中文 label 充当 value

**Decision**: 引入两个保留值常量作 `Select` 的 `value`：
`ALL_VERSIONS = '__all__'`、`UNSET_VERSION = '__unset__'`；中文「全部」「未填写版本」只作 `label`。

**Rationale**: 版本号是用户在建对话时自由输入的字符串（`create_thread` 只校验非空）。若直接把中文 label 当 value 兼作筛选键，那么用户真的把版本号写成「全部」时，该文档永远无法被筛选出来，且与"全部"语义冲突——这是不可测、难复现的隐性 bug。

**Alternatives considered**:

- 用中文 label 作 value：实现最省事，但上例会静默错判，被否。
- 用 `undefined` 表示"全部"：可行，但在 `Select` 与函数签名间传递时容易与"未选择"混淆，显式常量更可读可测。

---

## D4. 自然排序的实现方式

**Decision**: 自实现分段比较 `compareVersionDesc(a, b)`：把版本号切分为「连续数字段」与「非数字段」，数字段按数值比较、非数字段按字符串比较，整体降序。

**Rationale**:

1. 必须让 `v1.10` 排在 `v1.9` 之前（SC 相关场景），纯字符串排序恰好相反。
2. 版本号形态不受控：`v1.0`、`2026-11-20`、`v1.0-beta`、`迭代2`，语义化版本库（semver）会直接解析失败或抛错。
3. 自实现与 locale 无关，测试结果在任何机器一致（`localeCompare` 的 numeric 行为依赖运行时 locale，给测试带来不确定性）。

**Alternatives considered**:

- `localeCompare(other, undefined, { numeric: true })`：实现最短，但排序结果依赖 locale/ICU 版本；且默认 `sensitivity` 会把大小写差异折叠，与规格中"不合并大小写"的边界要求冲突（需额外配置才不折叠，反而更绕）。被否。
- `semver` 依赖：违反章程 VI（非必要依赖），且无法处理非语义化版本号。被否。

---

## D5. 版本号为空的历史文档如何归置

**Decision**: 单列为「未填写版本」选项，排序置末；「全部」下同样可见。

**Rationale**: 文档条目可能来自更早的线程（版本号字段历史值可能为空串）。若并入某个真实版本或直接隐藏，等于让数据不可见——违反 FR-004，且这类不可见最难被发现。

**Alternatives considered**:

- 隐藏空版本条目：被否，数据不可见比多一个选项更糟。
- 并入「全部」但不可单独筛选：被否，用户无法定位这批历史文档来补版本号。

---

## D6. 选中项失效后的回落策略

**Decision**: 由纯函数 `resolveSelectionAfterChange(options, selected)` 统一裁决：
- 选中项仍存在 → 保持不变；
- 选中项消失（例如删掉了该版本最后一条）→ 回落到「全部」；
- 组件在回落发生时给一次轻提示（「当前版本已无需求文档，已显示全部」）。

**Rationale**: 若不做回落，删除后页面会停在"空版本"，用户会误以为数据丢失。回落逻辑放在纯函数里，可脱离组件单测穷举，组件只负责订阅结果。

**Alternatives considered**:

- 只在删除回调里手写判断：被否，"删除""并发删除""切场景"三条路径都要各写一遍，容易漏。
- 停留在空版本并提示"该版本无文档"：已被 spec 的 US3 场景 1 排除（要求自动回落）。

---

## D7. 筛选状态的生命周期

**Decision**: 状态存于组件内 `useState`（初值「全部」）。

| 场景 | 行为 | 原因 |
| :-- | :-- | :-- |
| 进入详情再返回 | 保持 | 组件未卸载（早返回渲染 Viewer），`useState` 自然保留，满足 FR-010 |
| 切换场景/本体 | 重置「全部」 | 旧上下文的版本号在新上下文无意义 |
| 刷新页面 | 重置「全部」 | 规格假设：不持久化 |

**Rationale**: 用组件内状态即可覆盖以上三种行为，无需 URL 参数或本地存储；避免引入"筛选状态与应用状态不同步"的额外一致性问题。

**Alternatives considered**:

- 写入 URL query：被否，与规格「不持久化」假设冲突，且设计面路由由 `initialThreadId` 等参数占用，再加参数会扩大改动面。
- 写入 `localStorage`：被否，同上，且会造成"换本体后带出旧版本号"的困惑。

---

## D8. 测试与门禁登记方式

**Decision**:

1. 纯函数：`requirement-version-filter.test.ts`（同目录），覆盖哨兵语义、去重与 trim、自然排序（含非语义化版本号）、空版本置末、过滤、回落裁决。
2. 组件：`RequirementSummary.test.tsx`，mock `@/api/client`，覆盖默认「全部」、按版本过滤、空版本可见、删除后回落 + 提示、两种空态文案。
3. **门禁**：把 `src/components/Design/requirement-version-filter.ts` 加入 `frontend/vitest.config.ts` 的 `coverage.include`（章程 III：抽出的核心模块必须同时纳入 include，否则"拆出是为了可测、却从未被测"）。
4. 交互测试使用既有 `src/test/antd.ts` 的 `selectOption()` 展开 antd `Select`（浮层挂在 body，需查 `document`），不重复造轮子。

**Rationale**: 纯函数承担全部规则判定，覆盖率能稳定达 80% 以上；组件测试只验证"状态接线正确"，避免快照式脆弱测试。

**Alternatives considered**:

- 只写组件测试（不拆纯函数）：被否，自然排序的边界用例（v1.10/v1.9、`2026-11-20`、空值）在 DOM 层难以穷举且断言可读性差。
- 不登记 coverage include：被否，直接违反章程 III 的可测性要求。
