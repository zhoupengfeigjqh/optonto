# 任务与验收：规则设计（rule_design）

**特性分支**: `007-rule-design` · **完成日期**: 2026-10-31

## 后端（core-backend）

- [x] T001 `schemas/__init__.py`：新增 `RULE_OPERATOR_ARITY` / `RULE_OPERATOR_FIELD_TYPES` / `RULE_COMBINE_VALUES`
      与 `RuleConditionItem` / `RuleConditionGroupItem` / `RuleDesignItem`；`RuleItem.rule_design`（可选）
- [x] T002 `schemas` 归一：`combine` / `operator` 值域非法归一空串、`values` 标量转字符串数组、空组剔除、整段空归一 `None`
- [x] T003 `services/rule_design.py`（新）：`response_properties` / `resolve_field` / `field_paths` + 上限与字数常量
      （本体函数扁平映射与公共函数 JSON Schema 包裹两种形态同解）
- [x] T004 `services/validators.py`：`validate_rule_design`（函数限 `related_functions`、字段声明、
      运算符适配字段类型、取值个数、5 组 × 5 条、文案 ≤30 字 → 全部 400）
- [x] T005 `routers/rules.py`：create / update 接入校验；**删除 `/rules/generate` 端点**及其专属 import（`json`、`errors`、`llm_utils`、`effective_map`、`read_common_functions`、`load_env`）
- [x] T006 删除 `prompts/rule_generate.py`；`prompts/__init__.py` 去掉两常量导出；`config.py` 去掉导入
- [x] T007 `tests/test_rule_design.py`（36 例）：模型归一 / 字段路径 / 校验分支 / 落盘往返（含空设计不落键）

## 前端（frontend）

- [x] T101 `api/design.ts`：`Rule.rule_design` + `RuleOperator` / `RuleCondition` / `RuleConditionGroup` / `RuleDesign`；
      **删除 `generateRule`**
- [x] T102 `Design/rule/rule-design.ts`（新）：`OPERATOR_META`（16 个）、字段树、默认值、摘要/表达式、
      `validateDesign`、`normalizeDesign`（与后端同口径）
- [x] T103 `Design/rule/rule-design.test.ts`：32 例纯函数单测
- [x] T104 `Design/rule/RuleDesignCondition.tsx`（新）：函数（限关联函数）→ 字段（嵌套下钻）→ 运算符（按类型）→ 取值
- [x] T105 `Design/rule/RuleDesignModal.tsx`（新）：组间/组内 AND-OR、增删组与条件、5×5 上限禁用、30 字计数、空态
- [x] T106 `Design/rule/RuleDesignModal.test.tsx`：25 例组件测试（默认值、仅关联函数、回显、截断、上限、保存、空态）
- [x] T107 `Design/RuleTable.tsx`：新增「规则设计」列（未设计 / `N组 · M条件` + 表达式 Tooltip + 笔头）：
      点笔头先进入行内编辑态并打开弹窗，保存写入 `editData.rule_design`，行尾 ✓ 统一落盘；
      **删除 AI 选择关联函数按钮与 `genLoading`**；数据补充的「重新推导」按钮换 `ReloadOutlined`

## 契约与文档

- [x] T201 `specs/contracts/ontology-yaml.md`：字段表新增 `rules[].rule_design` + 新增「规则设计」节
      （结构、运算符表、400 校验清单、空设计口径、用例 D1-D6）
- [x] T202 `specs/007-rule-design/spec.md`：状态置已实现、补默认值与上限口径、修订记录
- [x] T203 `agent-backend/src/types.ts::RuleDetail` 加字段说明（运行期不消费，仅为 DTO 完整）

## 验证

| 门禁 | 结果 |
| :-- | :-- |
| `python -m unittest tests.test_rule_design` | 36 passed |
| `python -m pytest -q`（core 全量） | 264 passed |
| `npx vitest run`（前端全量） | 619 passed / 49 files |
| `npx eslint src --ext .ts,.tsx` | 0 error（存量 any warning 不在追溯范围） |
| `rules/generate` 残留扫描（core / frontend/src） | 0 命中 |
| 静态原型自检（jsdom） | 19 项通过（`prototype.html`） |

## 部署冒烟（2026-10-31，docker compose）

| 项 | 结果 |
| :-- | :-- |
| `docker compose build optonto-core-backend / optonto-agent-backend / optonto-frontend` | 三个镜像构建成功（前端 `next build` 类型检查通过） |
| 容器重建 | core / frontend / agent 三个容器 Up（nginx 不变，用 resolver 跟随容器 IP） |
| `GET /health`、`GET /`（nginx :81）、agent `/health` | 200 / 200 / 200 |
| `POST /api/ontologies/1/rules/generate` | **405**（端点已下线） |
| `GET /api/ontologies/1/rules` | 200，7 条 |
| 非法 `rule_design`（函数不在 `related_functions`）POST | **400**，规则数仍 7（校验失败不落盘） |
| 前端产物校验 | `.next/static/chunks/app/design/[id]` 内含「规则设计」「条件不成立」 |

## 已知边界

- `rule_design` **运行期零消费**：agent 规则闸、MCP 编译、部署合并均不解析（部署按 `rules` 整条搬运，字段原样保留）。
- 值内容允许空白（string 默认值即空白）；只校验个数，不校验语义。
- 三层以上嵌套组合不做（UI 固定两层），存储留演进空间。
- `matches` 正则合法性只在前端提示，不拦截保存。
