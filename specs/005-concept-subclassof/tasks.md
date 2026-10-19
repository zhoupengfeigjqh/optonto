# 任务清单：概念继承（subClassOf）与继承属性收窄

**特性分支**: `005-concept-subclassof` · **完成日期**: 2026-10-19

## 后端

- [x] `schemas/__init__.py`：`AttributeRestriction` / `ConceptItem.sub_class_of` / `ConceptItem.attribute_restrictions`
      / `InheritedAttributeItem` / `ConceptView`（含 `subClassOf` 别名归一、空限制丢弃）
- [x] `services/inheritance.py`（新）：有效属性合成、继承项视图、同名剔除、孤儿收窄剪枝、后代/级联工具
- [x] `services/validators.py`：`validate_sub_class_of`（存在性/自引用/环）、`validate_restrictions`（只删不增/不超父/合法正则）
- [x] `services/validators.py`：`status_enum_of`、`validate_relation` 改用有效属性
- [x] `routers/concepts.py`：GET 返回 `ConceptView`；POST/PUT 校验 + 剔除 + 改名级联；`PUT /attributes` 兼容对象载荷；DELETE 清子引用
- [x] `services/ontology_summary.py` / `routers/rules.py`：LLM 上下文改用有效属性并标注继承来源

## 运行面

- [x] `mcp-shared/data_store.py`：加载出口 `resolve_concept_inheritance`（只读合成，环/悬空告警）
- [x] `agent-backend/src/services/concept-inheritance.ts`（新）：TS 镜像合成
- [x] `agent-backend/src/services/ontology-gateway.ts#resolveConcepts` 改用有效属性

## 前端

- [x] `api/design.ts`：`AttributeRestriction` / `InheritedAttribute` / `Concept` 新字段 / `effectiveAttributes` /
      `updateAttributes` 收窄载荷
- [x] `components/Design/concept-inheritance.ts`（新）：父候选防环、收窄规范化、预校验
- [x] `components/Design/ConceptTable.tsx`：父概念列与编辑下拉、属性数（自有 + 继承）、同名确认、保存载荷拆分
- [x] `components/Design/ConceptAttributeModal.tsx`（新，从概念表拆出）：继承行只读 +
      枚举/范围/模式可收窄 + 恢复继承，自有行全编辑
- [x] `RelationTable` / `BehaviorTable`：关系端点属性与 status 枚举改用有效属性
- [x] `OntologyGraph` / `InstanceGraph` / `instance-graph-model`：属性展示改用有效属性

## 契约与测试

- [x] `specs/contracts/ontology-yaml.md`：字段契约、读取/写入规则、I1-I7 用例表
- [x] `core-backend/tests/test_concept_inheritance.py`（新，39 例，含路由视图直调）
- [x] `agent-backend/src/services/ontology-gateway.test.ts`（新增 I1-I3，31 例全绿）
- [x] `frontend/src/components/Design/concept-inheritance.test.ts`（新，13 例）

## 验收记录（2026-10-19）

| 检查 | 结果 |
| :-- | :-- |
| `python -m unittest discover -s tests`（core） | 199 例 OK |
| `npx vitest run src/services/ontology-gateway.test.ts`（agent） | 31 例通过 |
| `npx vitest run`（frontend 全量） | 43 文件 / 539 例通过 |
| mcp-shared 加载出口冒烟（临时脚本，已验证后删除） | 继承属性合并 + `inherited_from` 正确 |
| `npx tsc --noEmit`（frontend / agent-backend） | 通过 |
| `npx eslint`（改动文件） | 0 error（仅存量 any warning） |

## 兼容性说明

- 存量 YAML 无新字段 → `sub_class_of=None`、`attribute_restrictions={}`，行为与改造前完全一致。
- 旧客户端仍可按裸数组调用 `PUT /concepts/{name}/attributes`（只更新自有属性，收窄保持不变）。
- 外部导入数据如使用 camelCase `subClassOf`，读取时自动归一为 `sub_class_of`。
