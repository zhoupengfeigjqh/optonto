# 本体文件契约（ontology.yaml / data_engines.yaml / securities.yaml）

> 本文件是**三端四址**共享读取规则的唯一权威描述。任何一端修改读取行为前，先改本文件，再改实现，并同步双端契约测试：
>
> | 端 | 位置 | 角色 |
> | :-- | :-- | :-- |
> | core-backend | `services/__init__.py`（`_load_ontology_data_uncached` 等） | 设计面读写 + HTTP API 权威源 |
> | core-backend | `mcp_server_sse.py` | 不直接读本体 yaml——经 `_api_get` 走 core HTTP API（仅函数清单有 mtime 指纹缓存，语义与下述一致） |
> | agent-backend | `src/services/ontology-gateway.ts` | 运行面直读磁盘（有意决策：同机 volume 挂载，简单快速，不经 HTTP） |
> | frontend | `src/components/Design/SecurityTable.tsx`（`resolveOpType`） | 仅操作类型推导的展示面副本 |

契约测试：`agent-backend/src/services/ontology-gateway.test.ts`（vitest）与 `core-backend/tests/test_ontology_files_contract.py`（stdlib unittest）镜像同一组用例（见文末用例表）。**改规则必须同步两侧用例。**

## 1. 文件布局

```
{onto_market}/{scenario}/{ontology}/
  ontology.yaml       # 本体语义模型（概念/行为/规则/函数…），权威文件
  data_engines.yaml   # 数据引擎（物理集成绑定），独立存放，可选
  securities.yaml     # 行为安全管控（全花名册六字段），独立存放，可选
```

### 本体身份（`metadata`）—— 唯一读取来源（2026-10-01 统一）

`ontology.yaml` 的 `metadata` 段承载**本体身份四元组**，它是**唯一读取来源**（core / agent / mcp-shared 三端同口径）：

| 键 | 含义 |
| :-- | :-- |
| `scenario_name` / `scenario_id` | 所属场景名 / 场景 ID |
| `ontology_name` / `ontology_id` | 本体名 / 本体 ID（`ontology_name` 即该本体的 `name`） |

- **读**：身份一律取自 metadata，**不用目录名或 meta.json 兜底**。`metadata` 缺失、四元组任一为空、
  或与所在目录名不一致 → 视为**身份不可信**：core 跳过并告警（`repositories/metadata.list_all_ontologies`）、
  mcp-shared 跳过并告警（`data_store.list_all_ontologies`）、agent 解析返回 null（新建对话时 400 指出条目）。
  不接受"两种语义并存"的兜底。
- **写**：metadata 由 core 保证恒新——新建本体即写入（`save_ontology_data`）；改名（场景/本体）与部署后
  由 `repositories.metadata.refresh_identity_metadata` **回刷**（只 patch 身份四键，保留 `source_file` /
  `shard_hash` 等历史字段）。
- **目录名**仍用于拼物理路径（`{onto_market}/{scenario}/{ontology}/`）。因读侧要求二者一致，
  目录名与 metadata 不一致即视为数据被外部篡改——请用改名接口，或同步修改两处。
- **meta.json** 职责收窄为：本体**注册**（id 分配、创建登记、存在性判据）与非身份字段
  （description / creator / created_at / updated_at）；**不再是身份读取来源**。
- **`id` 键（工具/路由/`get_ontology_names` 用的对外标识）同样取自 metadata 的 `ontology_id`**：
  core 与 mcp-shared 的清单行都把它映射为 `id`，确保"清单里的 id = 调用时能路由的 id"。
  但 **`ontology_id` / `scenario_id` 的分配权仍在 core 注册表**（meta.json，扫描 max+1）——
  yaml 是它的读取镜像，`refresh_identity_metadata` 会以注册表为准回填，故**不要手工改 yaml 里的 id**。
- `deployed_version`（部署状态）同样读自 metadata；缺失/未部署为空串。

**读取出口（唯一，禁止在其他地方另开读取路径）**：

| 端 | 读入口 | 用途 |
| :-- | :-- | :-- |
| core | `repositories/metadata.list_all_ontologies` | 清单（`/api/ontologies`；工具聚合已归 MCP 服务自发布，core 不再有 `functions/all` / `behaviors/all`） |
| core | `repositories/metadata.get_ontology_name_by_id` | **依赖注入出口**：所有按本体操作的路由（行为/函数/概念/规则/技能/数据引擎/部署/文件…） |
| core | `repositories/metadata.ontology_identity_by_name` | 只有名字、需要 id 的读取方（线程/对话记录 id） |
| mcp-shared | `data_store.list_all_ontologies` / `ontology_identity` / `get_ontology_names` | MCP 服务的 scope 生成、本体过滤、路由 |
| agent | `SkillLoader.resolveOntologyContext` | 对话作用域四元组解析（新建对话校验） |

**写入侧（保证 metadata 恒新，id 分配权在注册表）**：

| 位置 | 职责 |
| :-- | :-- |
| `repositories/metadata.registry_ids` | **唯一**的"从注册表取 (scenario_id, ontology_id)"实现 |
| `services._stamp_identity_metadata` | save / save-version 共用：把四元组写进 `data.metadata`（名字取当前名，id 取注册表） |
| `repositories/metadata.refresh_identity_metadata` | 改名（场景/本体）与部署后回刷（只 patch 四键，保留其他字段） |
| `routers/deploy._finalize_metadata` | 合并/预览时写入（同样经 `registry_ids`） |

## 2. Overlay 回退规则（两端一致）

对 `data_engines` 与 `securities` 两段，规则相同：

1. **独立文件存在 → 以其为准**（覆盖 ontology.yaml 同名单元的全部内容，非逐条合并）。
2. **独立文件不存在 → 回退 ontology.yaml 的旧段**（迁移前读时兼容；core 保存后固定清空旧段）。
3. **文件形态容忍两种**：顶层为列表（整个文件就是一个数组），或顶层为映射且含 `data_engines:` / `securities:` 键。两种形态等价。
4. 空文件视为 `[]`（`yaml.safe_load` 得 None → 空列表）。

### 已知有意分歧：解析失败姿态

- **core-backend（设计面）**：独立文件解析失败**抛错**——宁可报错也不静默回退旧段（避免新旧内容不一致难排查）。
- **agent-backend（运行面）**：整体 try/catch 降级为 null（本体视为不存在）——运行面容错优先，不让一个坏 yaml 打挂整次对话。

此为有意分歧，不属于漂移；改任一端姿态需重新评估另一端。

### 数据引擎 target 形态与 title（2026-10-31）

- `data_engines[].target` **只有 MCP 形态**：`server_url`（下游 MCP 的 Streamable HTTP 端点）+ `tool_name`（工具名），
  辅以 `data_source_name` / `api_name` / `params` / `response` / `output_fields` / `headers`。
  旧 HTTP 型的 `url` / `method` 已从 schema 与前端类型中**删除**：旧文件里的残留键按 Pydantic 默认
  `extra='ignore'` 读时静默丢弃，下次保存即物理消失（不留读时兼容分支，也不回填）。
- `data_engines[].title` 恒等于所属行为的中文名（`behaviors[].title` 的**派生快照**，唯一权威源是行为）：
  `save_ontology_data` / `save_ontology_version` 写盘前经 `services._sync_engine_titles` 统一刷新，
  行为改中文名后引擎标题自动跟随；无中文名的行为不回落英文 `name`（与 `securities[].title` 同口径）。

## 3. 操作类型推导（op_type / isWrite，三端一致）

用于：core 花名册同步（`_sync_securities_roster`）、agent 运行面写操作判定（`isWrite` → 安全确认/串行调度）、frontend 花名册展示。

规则（按序）：

1. 行为 `op_type` 显式为 `command` 或 `query` → **采用显式值**。
2. 其余一切情况 → `query`。

> 2026-09-07 简化：数据引擎唯一形态为 MCP（SQL/HTTP 型已删除），无 method 语义可推导，
> 写行为必须在行为上显式 `op_type: command`；引擎不再参与推导。

## 4. 缓存语义

- agent-backend：按 (scenario, ontology) 缓存，**三文件 mtime**（ontology.yaml + data_engines.yaml + securities.yaml）任一变化即失效重读；不存在的文件 mtime 记 0。
- core-backend：`load_ontology_data` 有自身缓存（见实现），失效语义同样以文件 mtime 为准，无 TTL 陈旧窗口；
  `repositories.metadata._read_ontology_yaml_metadata` 另按 `(mtime_ns, size)` 缓存**仅 metadata 段**（2026-10-31，
  见下节测量），不缓存整份文件、不做身份兜底，返回对象只读。
- mcp_server_sse：仅函数清单缓存，指纹 = (ontology.yaml/meta.json 文件数, 最大 mtime_ns)。

### 身份查询性能（2026-10-31）

按本体操作的路由前置是 `ontology_id → (场景, 本体)`，其身份只认 `ontology.yaml.metadata`。此前每次请求都完整
解析**全部**本体的 YAML（容器内 bind mount 实测 30KB 单文件 ≈ 55ms，本场景 4 个本体 ≈ 250ms），构成「本体明细」
切页签 280–450ms 的主因（单次加载还要叠加 `load_ontology_data` 的深拷贝）。

| 端点（`/api/ontologies/{id}/…`） | 优化前 | 优化后（稳态） |
| :-- | --: | --: |
| `concepts` | 451ms | 49–52ms（冷启动首请求 132ms，含本体首次解析） |
| `behaviors` | 373ms | 51ms |
| `functions` | 281ms | 53ms |
| `rules` | 279ms | 43ms |

口径：`docker exec` 内 `time.perf_counter()` 分段测量（注册表扫盘 / 单文件解析 / 深拷贝）+ 宿主机 `Measure-Command`
请求三次取稳态；环境为 Windows + Docker Desktop bind mount。正确性用例见
`tests/test_metadata_identity.py::test_metadata_段缓存按文件指纹失效` 与 `::test_metadata_文件缺失返回空字典`。

## 5. 契约用例表（双端测试镜像）

### Overlay

| # | 场景 | 期望 |
| :-: | :-- | :-- |
| O1 | data_engines.yaml 存在（tool_name=query_b），ontology.yaml 旧段为 tool_name=query_a | 采用独立文件 |
| O2 | data_engines.yaml 不存在，ontology.yaml 旧段为 tool_name=query_b | 回退旧段 |
| O3 | securities.yaml 存在（scope=everyone），ontology.yaml 旧段 scope=disable | 采用独立文件（everyone） |
| O4 | 独立文件为裸列表形态 | 等价接受 |
| O5 | 独立文件为映射包裹形态（`data_engines:` / `securities:` 键） | 等价接受 |

### 操作类型推导

| # | op_type | 引擎 | 期望 |
| :-: | :-- | :-- | :-- |
| T1 | `command`（显式） | 任意引擎 | command |
| T2 | `query`（显式） | 任意引擎 | query |
| T3 | 空 | 有引擎 | query（引擎不参与推导） |
| T4 | 空 | 无引擎 | query |

### 字段契约与旧格式迁移（2026-09-28，spec 003）

**读取字段（新格式）**：

| 节 | 字段 | 形态 | 说明 |
| :-- | :-- | :-- | :-- |
| relations[] | `relation_type` | `string[]` | **对象关系**类型多选（大驼峰）：`Asymmetric`/`Symmetric`/`Transitive`/`Functional`/`InverseFunctional`；值域外静默丢弃。读时兼容 2026-10-19 之前的蛇形写法（`asymmetric` → `Asymmetric`、`inverse_functional` → `InverseFunctional`），内存与下次落盘恒为大驼峰 |
| concepts[] | `terms` | `string[]` | 概念术语集（其他表述）；去重去空 |
| concepts[].attributes[] | `name == "status"` | `string` + `constraint.enum` | 生命周期状态属性：类型恒为 string，枚举值即状态全集 |
| functions[] | `type` | `string` | 函数类型英文码：`TRANSFORMATION`/`CALCULATION`/`DERIVATION`/`VALIDATION`/`MODEL`；值域外归一为空串 |
| behaviors[] | `concept` | `string` | **关联概念唯一（标量）**；取代旧 `related_concepts` 数组 |
| behaviors[] | `from_status` / `to_status` | `string` | command 行为的状态机跃迁；取值必须落在关联概念 status 属性的枚举内 |
| rules[] | `behavior` | `string` | **绑定行为唯一（标量）**；取代旧 `related_behaviors` 数组 |
| rules[] | `related_functions` | `string[]` | **关联函数（2026-09-30 口径 B）**：本体函数 ∪ 公共函数，必须存在否则 400；其中本体且 `type=VALIDATION` 者为**判断函数** |
| rules[] | `rule_design` | `object \| null` | **规则设计（2026-10-31，spec 007）**：`{combine, groups[], pass_message, fail_message}`；设计期表达，**运行期不消费**；全空归一为 `null` 不落盘（详见「规则设计」节） |
| concepts[] | `instance_label` | `string` | 实例标签（可选）：实例视图节点标签所用的**属性英文名**，须是该概念已定义的属性 |
| concepts[].attributes[] | `constraint` | `{unique, required, enum, pattern, min, max}` | 属性约束对象：布尔 / 字符串数组 / 正则（仅 string）/ 数值范围（仅 number、integer）；**全缺省视为无约束，保存时不落盘**；`unique=true` 隐式要求 `required=true` |
| rules[] | `data_supplements` | `string[]` | 规则取数接口（query 行为名）；前端按关联函数声明的关联概念自动推导，可手工增减 |
| concepts[] | `sub_class_of` | `string \| null` | 父概念（OWL `subClassOf`）**至多 1 个**；空/缺省 = 根概念；读时兼容 camelCase `subClassOf` 别名 |
| concepts[] | `attribute_restrictions` | `{属性名: {enum?, min?, max?, pattern?}}` | 对**继承属性**的收窄声明；空对象不落盘 |
| concept_relations[] | `relation_type` | `string` | **概念关系**类型单选：`SubClassOf` / `EquivalentClass` / `DisjointWith`；值域外归一为空串（业务层 400） |
| concept_relations[] | `name` / `title` / `source` / `target` / `source_attr` / `target_attr` / `description` | `string` | 概念关系字段 = 对象关系去掉 `cardinality`；关联概念属性**选填**（两端同填同空、类型一致） |

**概念关系口径（2026-10-19）**：

- `SubClassOf` 的成员关系**唯一权威是 `concepts[].sub_class_of`**：`concept_relations` 中的同类型条目只作「关联概念属性」持久化锚点，读取时由后端按概念图派生（`name` = `{子概念}SubClassOf{父概念}`、`title` = `{子中文} 是一种 {父中文}`），失配锚点自动剪枝。API 只允许对 SubClassOf 行更新两端属性，禁止新增/删除。
- **SubClassOf 锚点的落盘字段只有 `name` / `relation_type` / `source` / `target` / `source_attr` / `target_attr`**：`title` 与 `description` 恒为读时派生值，落盘永不回读，故写盘时一律剔除（空非空都剔除，`_compact_concept_relations`）。
- `EquivalentClass` / `DisjointWith` 由 `concept_relations` 落盘；二者对称，同一无序概念对只登记一条（反向重复 → 400）；不得用于祖先-后代概念。
- 概念关系与对象关系（`relations`）分属两个一级节，互不混用；部署合并、生成范围勾选均按一级节独立处理。

**`params` 中文字段口径（两端一致）**：`functions[].params` 与 `behaviors[].params` 项的中文字段名统一为 **`title`**，`description` 降级为**可选的补充说明**（不再承担中文名）。编译器 `mcp-shared/tool_contract.param_spec_to_schema` 以 `title or description` 读取（兜底仅面向外部 MCP 工具与历史快照），产物写 JSON Schema 的 `title`。

**迁移规则（读时兼容，两端一致）**：

1. `related_concepts: [x]`（数组）→ `concept: x`；取首个元素，含多元素时取首个并记 warning（存量数据实测恒为单元素）。
2. `related_behaviors: [x]`（数组）→ `behavior: x`；口径同上。
3. 新字段存在时**优先**，同名字段不同时存在时不做覆盖。
4. **函数仍保留 `related_concepts` 数组**（本次未收缩），勿与行为混淆。
5. **`check_functions`（2026-09-30 前身的独立裁决字段）→ 并入 `related_functions`**（口径 B 取消该字段：角色改由函数类型承载）。
6. **旧条件树字段已退役**：字段移除，不再读时兼容；规则的约束逻辑统一由 `related_functions` 承载（活跃本体已无该字段）。

**写时校验（core 设计面，仅对显式声明的值生效）**：

- `status` 属性：至多一个；存在则必须 `type=string` 且枚举非空 → 否则 400。
- `from_status`/`to_status`：两者均为空则跳过；非空时必须落在关联概念 status 属性的枚举内 → 否则 400。
- 规则 `related_functions` 中的函数名必须存在于 本体函数 ∪ 公共函数 → 否则 400。
- 关系（2026-10-05 补齐）：`source` / `target` 必须是本体内已存在的概念；非空的
  `source_attr` / `target_attr` 必须是对应概念已定义的属性 → 否则 400。
- 流程（2026-10-05 补齐）：步骤 `current_action` 非空且必须命中本体内已存在的行为；
  `previous_action` 非空时同理 → 否则 400。
- 函数（2026-10-05 补齐）：`related_concepts` 中的概念必须存在于本体 → 否则 400。
- 概念继承（2026-10-19，spec 005）：
  - `sub_class_of` 必须指向本体内已存在的**其他**概念，且不得形成环（自引用 / A→B→A 均 400）；
  - `attribute_restrictions` 的键必须是**继承来的**属性名（自有属性不可声明收窄）→ 否则 400；
  - `enum` 必须是父有效枚举的非空子集（只删不增）→ 否则 400；
  - `min` / `max` 必须落在父有效范围内 → 否则 400；
  - `pattern` 可任意覆盖（空串 = 显式清除父模式），非空时必须是合法正则 → 否则 400；
  - 子概念与继承属性同名的自有声明 → **自动剔除**（继承优先），前端保存前以确认弹窗预告名单；
  - 父概念改名 → 级联改写子概念 `sub_class_of`；父概念删除 → 清空子概念 `sub_class_of` 与其 `attribute_restrictions`（子概念保留）。

> 校验归属铁律不变：**值域类**非法值由 Pydantic validator 静默归一（不报错）；
> **跨字段强耦合**类由业务层 `services/validators.py` 抛 `errors.InvalidInputError` → 400
> （不可放 Pydantic：请求体校验失败会被全局处理器映射为 422，造成 400/422 契约分裂）。

| # | 场景 | 期望 |
| :-: | :-- | :-- |
| M1 | 行为 `related_concepts: [C1]`（旧） | 迁移为 `concept=C1`，概念解析命中 C1 |
| M2 | 行为同时有 `concept=New` 与 `related_concepts: [Old]` | 采用 New，忽略 Old |
| M3 | 规则 `related_behaviors: [B1]`（旧）+ 前置 | 迁移为 `behavior=B1`，挂在 B1 的前置规则 |
| M4 | 规则 `behavior=B2`（新）标量 | 按行为精确挂载，不串到 B1 |
| M5 | 仅含旧字段的历史快照 | 可加载，新字段取缺省（`terms=[]`、`from_status=''` 等） |

> 该组用例镜像：`agent-backend/src/services/ontology-gateway.test.ts`（M1-M5）与
> `core-backend/tests/test_ontology_files_contract.py::TestFieldMigration`（M1-M5）；
> 更细的模型/校验用例见 `core-backend/tests/test_model_extension.py`（32 例）。

### 概念属性继承（subClassOf，2026-10-19，spec 005）

**落盘口径**：只存 `sub_class_of` + `attribute_restrictions`，**属性不复制**（父概念是唯一权威源）。

**读取口径（三端一致，逐字镜像）**——有效属性 = 自有属性（未被继承同名占用的）+ 父概念有效属性：

1. 同名时**继承优先**：子概念不能再声明父概念已有的属性，只能通过 `attribute_restrictions` 收窄；
2. 收窄沿继承链逐层叠加：`enum` 取交集（只删不增）、`min` 取最大、`max` 取最小、
   `pattern` 取最近一层非空覆盖（空串 = 显式清除）；
3. 多级传递：A→B→C，C 同时得到 A、B 的属性；
4. 环 / 悬空父概念：读侧**截断 + 告警**，不抛错（运行面容错优先）；写侧 400；
5. 派生结果不落盘：core API 以 `inherited_attributes` 返回（继承项带 `inherited_from` / `restricted`），
   mcp-shared 在加载出口把概念 `attributes` 替换为有效属性（只读，运行面不回写）。

| # | 场景 | 期望 |
| :-: | :-- | :-- |
| I1 | 子概念 `sub_class_of` 父概念，父有 `status`/`amount`，子自有 `order_no` | 有效属性 = order_no + status + amount |
| I2 | 子收窄 `status.enum` 为父枚举子集、`amount.max` 小于父 max | 合成后取子集/更小上界 |
| I3 | 子声明与父同名的自有属性 | 按继承优先剔除自有声明，取父定义 |
| I4 | 父概念后续删掉一个枚举值 | 子有效枚举自动跟随（交集），无需回刷 |
| I5 | 环 / 父概念不存在 | 读时截断不报错；写时 400 |
| I6 | 父概念删除 | 子概念 `sub_class_of` 与 `attribute_restrictions` 清空，子概念保留 |
| I7 | 父概念改名 | 子概念 `sub_class_of` 级联改写 |

> 镜像用例：`core-backend/tests/test_concept_inheritance.py`（39 例）与
> `agent-backend/src/services/ontology-gateway.test.ts`（I1-I3）；前端纯函数见
> `frontend/src/components/Design/concept-inheritance.test.ts`。

### 规则设计（`rule_design`，2026-10-31，spec 007）

**定位**：规则的**设计期**条件表达，把 `related_functions` 的判断组合成可读逻辑。
**运行期（agent 规则闸 / MCP 编译 / 部署）一律不消费**——闸门仍只认 `related_functions`；
这也意味着它不是「旧条件树」的复活（旧字段已退役且不读时兼容，本字段是全新键）。

```yaml
rule_design:
  combine: and                  # 组间组合：and | or（缺省 = and，非法归一为空串由写侧 400）
  groups:                       # 1..5 组
  - combine: and                # 组内组合：and | or
    conditions:                 # 每组 1..5 条
    - function: checkRawMaterialUnit   # 必须 ∈ 本规则 related_functions
      field: pass                      # 相对统一信封 data 的路径，支持 a.b / items[].c
      operator: eq                     # 见下方运算符表
      values: ["true"]                 # 字符串数组；个数由运算符决定
  pass_message: 原材料存在且单位一致，允许创建采购单      # ≤30 字
  fail_message: 原材料不存在或单位不一致，拒绝创建采购单  # ≤30 字
```

**取值个数与适用字段类型**（`schemas.RULE_OPERATOR_ARITY` / `RULE_OPERATOR_FIELD_TYPES`，
前端 `rule/rule-design.ts::OPERATOR_META` 同源）：

| 运算符 | 文案 | 取值个数 | 适用类型 |
| :-- | :-- | :-: | :-- |
| `eq` / `ne` | 等于 / 不等于 | 1 | 全部 |
| `gt` / `gte` / `lt` / `lte` | 大于 / 大于等于 / 小于 / 小于等于 | 1 | number, integer |
| `between` | 介于（含两端） | 2 | number, integer |
| `contains` / `not_contains` | 包含 / 不包含 | 1 | string, array |
| `starts_with` / `ends_with` | 开头是 / 结尾是 | 1 | string |
| `matches` | 匹配正则 | 1 | string |
| `in` / `not_in` | 属于 / 不属于 | ≥1 | string, number, integer |
| `empty` / `not_empty` | 为空 / 非空 | 0 | 全部 |

**写侧校验（core，业务层 → 400）**：`validate_rule_design`（`services/validators.py`）

| 校验 | 报错 |
| :-- | :-- |
| 条件函数 ∈ 本规则 `related_functions` | `规则设计第 N 组第 M 条：函数 X 不在该规则的关联函数中` |
| 函数存在（本体 ∪ 公共） | `…函数不存在: X` |
| `field` 能在该函数 `response` 中逐层解析 | `…函数 X 未声明返回字段: p` |
| 运算符合法且适配字段类型 | `…运算符非法` / `…不支持运算符 op` |
| `values` 个数符合运算符要求（内容允许空白） | `…需要 1 个取值` / `需要 2 个取值` / `至少需要 1 个取值` |
| 组 1..5、每组 1..5 条 | `规则设计最多 5 个条件组` / `…最多 5 条条件` / `…没有条件` |
| 文案 ≤30 字（**业务层校验，不用 Pydantic `max_length`**，否则变 422） | `条件成立的结果说明不能超过 30 字` |

**空设计口径**：`rule_design` 缺省、`{}`、空组且无文案 → 归一为 `None`，`model_dump(exclude_none=True)` 不落键；
有文案无组保留原样并由写侧 400（不静默丢文案）。

**返回结构两种形态**（`services/rule_design.py::response_properties` 唯一实现）：
本体函数 `response` 直接是属性映射；公共函数是 JSON Schema `{type: object, properties}` → 先解包；
数组层用 `items[].x` 表达（`type=array` 且 `items.properties` 才下钻）。

| # | 场景 | 期望 |
| :-: | :-- | :-- |
| D1 | 合法设计（1 组 1 条，`pass eq true`） | 保存成功，yaml 结构如示例 |
| D2 | 条件函数不在 `related_functions` | 400 |
| D3 | `field` 不在函数 `response` 声明内 | 400 |
| D4 | `gt` 用在 string 字段 | 400 |
| D5 | 6 组 / 每组 6 条 / 文案 31 字 | 400 |
| D6 | `rule_design` 为空对象或仅空组 | 不落键（`None`） |

> 镜像实现：`core-backend/tests/test_rule_design.py`（36 例，含 D1-D6 与落盘往返）与
> `frontend/src/components/Design/rule/rule-design.test.ts` + `RuleDesignModal.test.tsx`。
> 前端交互：规则表「规则设计」列点笔头 → 表单弹窗（**已退役 `rules/generate`，不再提供 AI 选函数**）。
> AI 草稿（spec 008）：弹窗内「智能生成」调 `POST /rules/design/generate`，产出的 `rule_design`
> 与手工填写**同构**、同样遵守本节全部口径；草稿不落盘，覆盖已有设计须二次确认。
> 端点契约见 [rule-design-generate.md](./rule-design-generate.md)。

## 6. 中文名字段（`title`）口径（2026-10-29，spec 006 · 硬切）

**单一表达**：平台内"中文名"的字段名统一为 **`title`**；`display_name` 已从代码与全部存量文件中移除，
**不留读时兼容、不留别名、不双写**。任何一端读到的旧键 `display_name` 一律视为不存在（Pydantic 对未知键静默忽略）。

覆盖实体（落盘字段）：`concepts[]` / `concepts[].attributes[]` / `relations[]` / `concept_relations[]` /
`functions[]` / `behaviors[]` / `rules[]` / `processes[]` / `securities[]`（`action_name` 之外的展示名快照）/
`data_engines[]`（引擎自身，恒等于所属行为中文名的派生快照），以及 `functions[]` 与 `data_engines[]` 的 `params` / `response` 内每一层的
字段声明（含 `items.properties` 深层）。

**参数/返回字段口径（2026-10-29 起统一）**：

| 位置 | 中文字段 | 说明 |
| :-- | :-- | :-- |
| `functions[].params[*]` / `functions[].response[*]` | `title` | 首次统一 |
| `behaviors[].params[*]` / `behaviors[].response[*]` | `title` | 由 `description` 迁移（spec 006 D-2） |
| `data_engines[].target.params[*]` / `target.response[*]` | `title` | 首次统一 |

`description` 在参数节点上只剩"补充说明"语义；空值不落盘，**不参与中文名取数，任何一端都不再从它兜底**。

**`concept_relations[].title` 的语义（2026-10-30 判定：不另设字段名）**：它同样是"该实体的中文名"，只是概念关系本身是**断言**，其名字天然是句式（`采购订单与采购单等价` / `子概念 是一种 父概念`），而概念/属性的名字是名词短语。形态差异来自实体类型，不是字段语义分叉——改名为 `label` / `statement` 只会给"中文名"制造第二个名字，与 spec 006 的收口目标相反。

**编译产物（`mcp-shared/tool_contract.py`）**：

参数节点三个键各承一义，编译产物与源数据同形（`param_spec_to_schema`）：

| JSON Schema 键 | 语义 | 源数据来源 |
| :-- | :-- | :-- |
| `properties[k].title` | 中文名 | `params[k].title` |
| `properties[k].description` | 补充说明 | `params[k].description` |
| `properties[k].example` | 示例值 | `params[k].example` |

- 中文名**只认 `title`**：无 `title` 就不产出 `title`，不回落 `description`；
- 工具级中文名 → **工具级 `title`**（发布快照 `tools[].title`；协议 `Tool.title`）。`inputSchema` 顶层扩展键
  **`x-title`** 是它在平台内的**运行期投影**（2026-10-30 反转，编译侧不再产出）。**不是** `inputSchema.title`——
  后者是 JSON Schema 描述 schema 自身的键。

**存量迁移**：`.data` 下全部本体文件、版本存档、`data_engines.yaml`、`securities.yaml`、`common_functions/functions.json`、
`mcp_publishes/publishes.json`、模板与技能文档均已一次性改写；迁移脚本走 YAML/JSON 解析改键（禁止文本正则），
并有「迁移前后非空中文名键路径→值集合相等」的校验。

---

## 7. 统一返回信封与规则判断函数（2026-09-30）

### 函数统一返回信封（本体函数 + 公共函数，源头在沙箱出口归一）

```json
{ "success": true, "data": { …业务数据… }, "error": null }
```

| 字段 | 类型 | 语义 | 约束 |
| :-- | :-- | :-- | :-- |
| `success` | bool | **执行成败**（函数是否正确跑完） | 必填 |
| `data` | any | 成功载荷（业务数据；`response` 声明描述的是 data 的内容，信封外层是协议） | success=true 时存在 |
| `error` | `{code: string, message: string}` | 业务失败原因 | success=false 时必填 |

**语义边界（三通道严格二分）**：

| 情形 | 表现 | 通道 |
| :-- | :-- | :-- |
| 函数崩溃 / 缺参 / 超时 | 抛异常 | MCP `isError` → 报错预算/重试（不变） |
| 函数正常完成但结果不可用 | `success=false` + `error` | 业务性失败，不走重试 |
| 判断函数判「不通过」 | `success=true` + `data.pass=false` + `data.reason` | 成功执行的失败判断，**禁止用 raise 表达** |

**归一化（`mcp-shared/function_runner.py::_normalize_output`，读时兼容）**：新式（带 bool `success`）原样放行；
旧式 `{"result": …}` 拆包进 `data`（单 result 键取其值，多顶层键整包保留）；裸返回整包作 `data`（stderr 告警）。
行为（自建发布；2026-10-19 起 8005 零工具）与外部 MCP 工具**不在信封范围**（各有既有消费方 / 源头不受控）。

### 规则关联函数与判断函数（口径 B：类型即角色 → 真阻断）

- 规则约束逻辑由 `related_functions`（本体函数 ∪ 公共函数）承载；**关联函数执行过即留痕**。
- **判断函数 = 本体函数且 `type=VALIDATION`**（无独立字段，角色由函数类型承载）：
  在 `data` 内返回 `{"pass": bool, "reason": string}`，运行期闸据此**真阻断**。
- 运行期（agent-backend 规则闸）：
  - 普通关联函数（CALCULATION 等本体函数 / 公共函数）：执行过即满足（留痕）；
  - 判断函数：除执行过外**还须有裁决结论**（返回缺 `pass` → fail-closed，不静默放行）；
  - 前置规则：主行为工具调用前核查——未执行 / 缺 `pass` → 拒绝并引导补跑；`pass=false` → **拒绝主行为**（结论已定，重试无效，真实业务系统零调用）；
  - 后置规则：收尾核查，缺失 nudge 补跑（有界）。
- 数据补充（`data_supplements`）：前端按**关联函数声明关联的概念**（`related_concepts`）推导对应 query 行为，可手工增减。
- 保存期（core）：`related_functions` 中的函数名必须存在于 本体函数 ∪ 公共函数 → 否则 400。
