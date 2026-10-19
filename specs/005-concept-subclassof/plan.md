# 实施计划：概念继承（subClassOf）与继承属性收窄

**特性分支**: `005-concept-subclassof` · **对应规范**: [spec.md](./spec.md) · **日期**: 2026-10-19

## 摘要

在概念上增加 `sub_class_of`（单值父概念）与 `attribute_restrictions`（仅三维度收窄），
**落盘只存引用、读取时合成**：父概念是属性的唯一权威源，子概念不复制属性。
合成规则以纯函数形式在 core（Python）与 agent/mcp-shared（Python/TS）各实现一份，按
`specs/contracts/ontology-yaml.md` 镜像同一组用例。设计面 API 额外返回只读的
`inherited_attributes`；前端据此把继承行置灰，仅放开枚举/范围/模式三格。

## 技术上下文

- **权威模型**：`core-backend/schemas/__init__.py`（Pydantic v2）
- **后端分层**：`routers/concepts.py`（接口）→ `services/inheritance.py`（纯函数合成/级联）→
  `services/validators.py`（跨字段强校验，400）；`services/ontology_summary.py` 与 `routers/rules.py` 属读侧消费点
- **运行面**：`mcp-shared/data_store.py` 在加载出口合成；`agent-backend/src/services/concept-inheritance.ts`
  + `ontology-gateway.ts#resolveConcepts`
- **前端**：`api/design.ts`（类型 + `effectiveAttributes`）、`Design/concept-inheritance.ts`（纯函数）、
  `Design/ConceptTable.tsx`（父概念列 + 属性弹窗）、`RelationTable` / `BehaviorTable` / `View/*`
- **测试**：core `unittest`、agent `vitest`、frontend `vitest`

## 宪法检查（Constitution Check）

| 章程条款 | 本计划如何满足 |
|---|---|
| II 后端分层 | 合成为纯函数 `services/inheritance.py`（只依赖 schemas）；路由只做参数接收与调用；强校验在 `validators.py` 抛 `InvalidInputError` → 400 |
| III 测试 | core 39 例、agent 镜像 3 例、前端纯函数 13 例；契约文档同步用例表 |
| VI 数据一致性 | 单一权威源（父概念），派生结果不落盘；读侧环/悬空截断告警，写侧 400 |
| VI 契约一致 | 新字段可选、缺省兼容；`subClassOf` 别名读时兼容；双端用例镜像 |
| VIII 优雅降级与可观测 | 环/悬空父概念在 core/mcp-shared 记 warning 并截断，运行面不挂整次对话 |
| 500 行约束 | `ConceptTable.tsx` 通过抽纯函数（concept-inheritance.ts）控制在可维护范围；`inheritance.py` 约 190 行 |

## 实施策略

### 批次 A：后端模型 + 合成（P1）

1. `schemas`：`AttributeRestriction`、`ConceptItem.sub_class_of/attribute_restrictions`（含 camelCase 别名、
   空限制丢弃）、`InheritedAttributeItem`、`ConceptView`。
2. `services/inheritance.py`：`effective_map` / `inherited_of` / `inherited_attribute_names` /
   `strip_conflicting_attributes` / `prune_restrictions` / `descendants_of` /
   `clear_parent_references` / `rename_parent_references`。
3. `services/validators.py`：`validate_sub_class_of`、`validate_restrictions`；
   `status_enum_of` 与 `validate_relation` 改用有效属性。

### 批次 B：接口与级联（P1）

4. `routers/concepts.py`：GET 返回 `ConceptView`；POST/PUT 做父概念/收窄校验 + 同名剔除 + 改名级联；
   `PUT /attributes` 兼容 `{attributes, attribute_restrictions}`；DELETE 清子引用与收窄。
5. 读侧消费点：`ontology_summary.build`、`routers/rules.py` 使用有效属性并标注继承来源。

### 批次 C：运行面一致（P2）

6. `mcp-shared/data_store.py`：新增 `resolve_concept_inheritance`，在加载出口把概念 `attributes`
   替换为有效属性（只读、不落盘）。
7. `agent-backend/src/services/concept-inheritance.ts` + `ontology-gateway.ts#resolveConcepts`。

### 批次 D：前端交互（P1/P2）

8. `api/design.ts`：类型与 `effectiveAttributes`；`updateAttributes` 支持收窄载荷。
9. `Design/concept-inheritance.ts`：父候选防环、收窄规范化、预校验。
10. `Design/ConceptTable.tsx`：父概念列/编辑下拉、属性数、同名确认；属性弹窗拆到
    `Design/ConceptAttributeModal.tsx`：自有行全编辑、继承行只读 + 三格可收窄 + 恢复继承；保存只提交自有属性与收窄。
11. `RelationTable` / `BehaviorTable` / `OntologyGraph` / `InstanceGraph` / `instance-graph-model` 改用有效属性。

### 批次 E：契约与验收（P2）

12. `specs/contracts/ontology-yaml.md`：字段、读取/写入规则、I1-I7 用例表。
13. 三端测试与 lint/类型检查；`tasks.md` 记验收结果。

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| 多端合成口径漂移 | 契约文档为唯一口径；core/agent/前端各配镜像用例（I1-I3） |
| 父概念改名/删除造成悬空 | 写时级联（改名）与清引用（删除）；读侧仍保留截断告警兜底 |
| 子概念已有同名属性被"吃掉" | 前端保存前确认弹窗列出名单；后端按继承优先剔除并记 warning |
| 收窄被放宽 | 写时 400 + 前端控件钳制（options/上下界），双保险 |
