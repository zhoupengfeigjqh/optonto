# 任务与验收：规则设计智能生成

**特性分支**: `008-rule-design-generate` · **完成日期**: 2026-10-31

## 后端（core-backend）

- [x] T001 `schemas`：`RuleDesignGenerateRequest`（字段名与 `RuleItem` 对齐）/ `RuleDesignGenerateResponse`
      （`rule_design` + `warnings` + `dropped_conditions` + `model` + `elapsed_ms`）
- [x] T002 `services/rule_design.py`：新增 `operators_for_type` / `designable_fields` / `default_value_for_type`
      / `truncate_message`（字段口径唯一来源，供提示词与修边共用）
- [x] T003 `services/rule_design_generate.py`（新）：`build_function_context`（**全部**关联函数 + 可设计字段）、
      `repair_generated_design`（纯函数修边）、`generate_rule_design`（60s 超时、结构化日志、只读不落盘）
- [x] T004 `prompts/rule_design_generate.py`（新）：只输出 JSON、函数/字段白名单、运算符码表、5×5 与 30 字约束；
      `prompts/__init__.py` 与 `config.py` 导出
- [x] T005 `routers/rules.py`：`POST /api/ontologies/{id}/rules/design/generate`（复用 `validate_related_functions`）
- [x] T006 `tests/test_rule_design_generate.py`（25 例）：上下文含全部函数、9 类修边分支、LLM 异常分支、零副作用

## 前端（frontend）

- [x] T101 `api/design.ts`：`RuleDesignGeneratePayload` / `RuleDesignGenerateResult` / `generateRuleDesign`
- [x] T102 `rule/use-rule-design-generate.ts`（新）：loading + 调用的唯一入口，组件不直接碰 API
- [x] T103 `rule/RuleDesignModal.tsx`：右上「智能生成」按钮、`dirty || value` 判定覆盖二次确认、
      生成中禁用保存、成功后 `normalizeDesign` 回填、失败保留原设计、warnings 提示
- [x] T104 `RuleTable.tsx`：向弹窗补 `ontologyId` / `ruleDescription` / `behaviorName`（取自编辑态草稿）
- [x] T105 `RuleDesignModal.test.tsx`：新增 7 例（payload 含全部函数、回填、覆盖确认与取消、替换、失败保留、生成中禁用、空态无按钮）

## 契约与文档

- [x] T201 `specs/contracts/rule-design-generate.md`（新）：请求/响应、错误码、修边口径、性能与日志
- [x] T202 `specs/contracts/ontology-yaml.md`：规则设计节补「AI 草稿同构、不落盘、覆盖需确认」与契约链接
- [x] T203 `specs/007-rule-design/spec.md`：边界「不做 AI 生成」补指向本特性

## 验证

| 门禁 | 结果 |
| :-- | :-- |
| `python -m unittest tests.test_rule_design_generate` | 25 passed |
| `python -m pytest -q`（core 全量） | **289 passed** |
| `npx tsc --noEmit` | 0 error |
| `npx vitest run`（前端全量） | **625 passed / 49 files** |
| `npx eslint src --ext .ts,.tsx --quiet` | 0 error |

## 部署冒烟（2026-10-31，docker compose）

| 项 | 结果 |
| :-- | :-- |
| `docker compose up -d --build optonto-core-backend optonto-frontend` | 两个镜像重建、容器 Recreated + Started |
| `GET /health` | 200 |
| `POST .../rules/design/generate` 且 `related_functions: []` | 400 |
| `POST .../rules/design/generate` 且函数不存在 | 400 |
| 真实生成（ontology 1，`sumRawNotArrivalQty` + `checkRawMaterialUnit`） | **200 · 1200ms**，产出 2 组 2 条件（`pass eq true`、`sumNotArrivalQty lt 100`），`warnings=[]`、`dropped_conditions=0` |

## 语义与耦合说明

- **语义统一**：请求字段名 == `rules[]` 字段名；生成物 == 手工填写的 `rule_design`（同一个 `RuleDesignItem`、
  同一套 `validate_rule_design`、同一套前端 `normalizeDesign`），不存在「AI 版本」的特殊结构。
- **高内聚**：LLM 逻辑只在 `services/rule_design_generate.py`；字段口径只在 `services/rule_design.py`；
  前端网络调用只在 `use-rule-design-generate.ts`；路由只做参数校验与编排。
- **低耦合**：不新增依赖（复用 `llm_utils.llm_json`）；不引入运行期概念（agent 仍不消费 `rule_design`）；
  与已退役的 `rules/generate` 零共享代码。

## 已知边界

- 生成不流式、不做多轮修正、不缓存；重复生成即整段覆盖（需确认）。
- 上下文固定为该规则**全部** `related_functions`（用户决策），不支持只选部分函数。
- 未声明 `response` 的函数会被标注并跳过（记 warning），不会被用来编造条件。
