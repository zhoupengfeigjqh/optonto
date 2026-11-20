# 数据模型：需求汇总按版本号筛选

**Feature**: `011-requirement-version-filter` | **Date**: 2026-11-20

本特性**不新增持久化实体**，也不修改后端数据结构。以下三类均为前端内存模型，来源是既有接口返回值。

---

## 1. 需求文档条目（RequirementItem，既有）

来源：`GET /api/threads/requirements/list`（`frontend/src/api/threads.ts`）

| 字段 | 类型 | 与本特性的关系 |
| :-- | :-- | :-- |
| `filename` | string | 行标识的一部分 |
| `thread_id` | string | 行标识的一部分 |
| `version` | string | **筛选键**。可能为空串（历史线程未填版本） |
| `onto_name` | string | 现有列展示 |
| `content_name` | string | 现有列展示 |
| `thread_title` | string | 现有列展示 |
| `created_at` / `updated_at` | string(ISO) | 现有列展示 |
| `has_ontology` / `ontology_file` | boolean / string | 现有列展示（**不受筛选影响**，仍按原条目判定） |
| `scenario_name` / `ontology_name` | string | 上下文归属（由请求参数约束，不参与前端筛选） |

**约束**：本特性只读取 `version`，不改动该接口与类型定义。

---

## 2. 版本选项（VersionOption，新增，派生）

不存储，每次 `items` 变化时由 `buildVersionOptions(items)` 重新推导。

| 字段 | 类型 | 规则 |
| :-- | :-- | :-- |
| `value` | `'__all__' \| '__unset__' \| string` | 保留常量或规范化后的版本号 |
| `label` | string | 「全部」/「未填写版本」/ 版本号原文（去首尾空格后） |

**推导规则（顺序即展示顺序）**：

1. 首项固定 `{ value: ALL_VERSIONS, label: '全部' }`。
2. 中间项 = 所有 `normalizeVersion(item.version) !== ''` 的去重集合，按 `compareVersionDesc` **降序**。
3. 末尾项：若存在任一 `normalizeVersion(item.version) === ''` 的条目，追加 `{ value: UNSET_VERSION, label: '未填写版本' }`。
4. 无任何条目时只有「全部」一项。

**唯一性规则**：去重键 = `normalizeVersion(version)`（仅去首尾空格，**不做大小写折叠**——`v1.0` 与 `V1.0` 视为两个版本）。

---

## 3. 筛选选择状态（Selection State，新增，组件内）

| 状态 | 取值 | 初始值 | 迁移 |
| :-- | :-- | :-- | :-- |
| `selectedVersion` | 选项 `value` 之一 | `ALL_VERSIONS` | 见状态机 |

### 状态转移

```
            ┌──────────────────────────────┐
            │        ALL_VERSIONS          │ ← 初始
            └──────────────┬───────────────┘
         选择某版本 │              ↑ 选中项消失（删除最后一条）
            ↓                │ 或切换场景/本体/刷新
   ┌─────────────────────────┴───────┐
   │  <version> / UNSET_VERSION      │
   └─────────────────────────────────┘
```

| 触发 | 起始状态 | 结果 | 提示 |
| :-- | :-- | :-- | :-- |
| 用户选择版本 | 任意 | 该版本 | 无 |
| 用户选择「全部」 | 任意 | `ALL_VERSIONS` | 无 |
| 删除当前版本最后一条文档 | 该版本 | `ALL_VERSIONS` | 「当前版本已无需求文档，已显示全部」 |
| 切换场景/本体 | 任意 | `ALL_VERSIONS` | 无 |
| 刷新页面 | — | `ALL_VERSIONS` | 无 |
| 进入详情再返回 | 任意 | 不变 | 无 |

**回落裁决**由纯函数 `resolveSelectionAfterChange(options, selected)` 实现：返回仍有效的选择，或 `ALL_VERSIONS`。

---

## 4. 派生：可见行集合

```
visibleItems =
  selected === ALL_VERSIONS   → items
  selected === UNSET_VERSION  → items.filter(i => normalizeVersion(i.version) === '')
  其他                        → items.filter(i => normalizeVersion(i.version) === selected)
```

**不变量**：

- `visibleItems` 是 `items` 的子集，且**保持原有相对顺序**（不重新排序）。
- `rowKey`（`${thread_id}_${filename}`）与筛选前完全一致，避免 React 重挂载导致的操作状态丢失。
- 「本体生成」列仍按原条目 `has_ontology` 渲染，不因筛选重算。

---

## 5. 校验规则汇总

| 编号 | 规则 | 违反后果 |
| :-- | :-- | :-- |
| V1 | 选项不得包含无对应条目的版本号 | 死选项（违反 SC-002） |
| V2 | 空版本条目必须可通过「未填写版本」访问 | 数据不可见（违反 FR-004） |
| V3 | 版本号比较只用规范化值（trim），不折叠大小写 | 不同版本被误合并 |
| V4 | 数字段按数值比较 | `v1.9` 排到 `v1.10` 之前（违反 FR-005） |
| V5 | 选中项失效必须回落到「全部」，不得停在空集合 | 用户误判数据丢失（违反 FR-009） |
| V6 | 筛选不得改变列定义、行顺序、`rowKey` | 交互状态丢失、列渲染错乱 |
| V7 | 选中项不在 `options` 中时，MUST 在**派生阶段**即视作「全部」，不得只依赖渲染后的 effect 回落 | 会先渲染一帧"空表 + 空态文案"，用户看到闪一下（与 SC-004 的可感知要求冲突） |
