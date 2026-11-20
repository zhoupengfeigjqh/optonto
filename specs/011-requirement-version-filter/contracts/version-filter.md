# 契约：版本筛选纯函数模块与列表页 UI 行为

**Feature**: `011-requirement-version-filter` | **Date**: 2026-11-20

本特性**不新增或修改任何 HTTP 接口**（沿用 `GET /api/threads/requirements/list`）。
本文件记录两类内部契约，供实现与测试对齐：① 纯函数模块的导出 API；② 列表页的 UI 行为契约。

---

## A. 模块契约：`frontend/src/components/Design/requirement-version-filter.ts`

### A.1 导出常量

| 导出 | 值 | 说明 |
| :-- | :-- | :-- |
| `ALL_VERSIONS` | `'__all__'` | 「全部」的**保留值**，不作展示文本 |
| `UNSET_VERSION` | `'__unset__'` | 「未填写版本」的保留值 |
| `ALL_VERSIONS_LABEL` | `'全部'` | 展示文本 |
| `UNSET_VERSION_LABEL` | `'未填写版本'` | 展示文本 |

**约束**：保留值不得与任何可能的用户输入冲突；实现中**禁止**用 label 充当 `value`。

### A.2 导出函数

| 函数 | 签名 | 契约 |
| :-- | :-- | :-- |
| `normalizeVersion` | `(raw: string \| null \| undefined) => string` | 去首尾空格；`null/undefined` → `''`；不折叠大小写；不解析语义化版本 |
| `versionKeyOf` | `(item: { version?: string }) => string` | 等于 `normalizeVersion(item.version)` |
| `compareVersionDesc` | `(a: string, b: string) => number` | 自然降序：数字段按数值、非数字段按字符串；全等返回 0；**必须**保证 `v1.10` 在 `v1.9` 之前 |
| `buildVersionOptions` | `(items: RequirementItem[]) => VersionOption[]` | 首项恒为「全部」；中间为去重版本号降序；存在空版本时末尾追加「未填写版本」；无条目时只返回「全部」 |
| `filterByVersion` | `(items: RequirementItem[], selected: string) => RequirementItem[]` | 返回子集且**保持原顺序**；`selected` 为未知值时返回空数组。**注意**：调用方 MUST 在派生阶段同步校正（`selected` 不在 `options` 中即视作 `ALL_VERSIONS`），不得只依赖 `useEffect` 事后回落，否则会先渲染一帧空表（见 data-model V7） |
| `resolveSelectionAfterChange` | `(options: VersionOption[], selected: string) => string` | `selected` 仍存在于 options → 原样返回；否则返回 `ALL_VERSIONS` |

### A.3 不变量

1. `buildVersionOptions` 的返回项数量 = 1 + 去重版本数 + (存在空版本 ? 1 : 0)。
2. `filterByVersion(items, ALL_VERSIONS)` **逐项全等** `items`（同一引用或等长等序）。
3. `resolveSelectionAfterChange(options, ALL_VERSIONS)` 恒为 `ALL_VERSIONS`。
4. 全部函数为纯函数：不读写 DOM、不发请求、不依赖当前时间、无副作用。

---

## B. UI 行为契约：`RequirementSummary` 列表页

### B.1 组件入参（不变）

```ts
interface Props {
  ontologyId: string;          // 保留，当前未使用（既有）
  activeTab?: string;
  scenarioName?: string;
  ontologyName?: string;
}
```

**约束**：不新增必填 props；父组件 `DesignContent` 的调用点无需改动。

### B.2 标题行

| 元素 | 契约 |
| :-- | :-- |
| 标题 | 文案仍为「需求汇总」 |
| 筛选控件 | 位于标题行**右侧**；antd `Select`，`aria-label="按版本号筛选"`；`value` 为选项保留值；`options` 为 `buildVersionOptions` 结果 |
| 默认值 | `ALL_VERSIONS`（展示为「全部」） |
| 空集合 | 当 `options` 只有「全部」一项时，控件 MUST 置为 `disabled`（不可展开），但 MUST NOT 隐藏（US2-场景4） |

### B.3 表格

| 项 | 契约 |
| :-- | :-- |
| 数据源 | `filterByVersion(items, selectedVersion)` |
| 列定义 | 与改动前**完全一致**（本体名 / 内容 / 版本 / 会话名称 / 创建时间 / 更新时间 / 本体生成 / 操作） |
| `rowKey` | 仍为 ``${thread_id}_${filename}`` |
| 分页 | 仍为 `false` |
| 空态（全部） | 「暂无导出的需求文档，请先在对话中导出文档」 |
| 空态（版本） | 「该版本下暂无需求文档」 |
| 空态（未填写版本） | 「没有未填写版本的需求文档」 |

### B.4 交互

| 场景 | 契约 |
| :-- | :-- |
| 切换版本 | 仅行集合变化；不发起网络请求；不重置表格选中/滚动以外的页面状态 |
| 点击「查看」 | 行为不变；进入详情后返回，`selectedVersion` 保持 |
| 删除文档 | 沿用既有二次确认；成功后重新拉取列表；若当前选择的版本已无条目 → 自动回落「全部」并提示「当前版本已无需求文档，已显示全部」 |
| 加载失败 | 沿用既有 `message.error('加载失败: …')`，筛选控件保持可用（列表为空） |
| 切换场景/本体 | 重新加载并重置为「全部」 |

### B.5 无障碍

- `Select` 必须可通过键盘完成：Tab 聚焦 → Enter/Space 展开 → 方向键选择 → Enter 确认。
- 控件必须有可读名称（`aria-label`），读屏播报为「按版本号筛选，全部」。
- 不得用自定义 `div` 伪装下拉（避免键盘与读屏失效）。

---

## C. 契约测试对应关系

| 契约条目 | 测试位置 |
| :-- | :-- |
| A.2 全部函数行为与不变量 | `requirement-version-filter.test.ts` |
| A.1 保留值不与 label 混用 | `requirement-version-filter.test.ts`（构造 `version === '全部'` 的条目） |
| B.2 标题行与默认值 | `RequirementSummary.test.tsx` |
| B.3 列不变 / 空态文案 | `RequirementSummary.test.tsx` |
| B.4 删除后回落 + 提示 | `RequirementSummary.test.tsx` |
| B.5 键盘可达 | `RequirementSummary.test.tsx`（聚焦 + 键盘展开断言） |
