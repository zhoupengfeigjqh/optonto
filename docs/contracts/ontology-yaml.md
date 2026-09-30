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

## 3. 操作类型推导（op_type / isWrite，三端一致）

用于：core 花名册同步（`_sync_securities_roster`）、agent 运行面写操作判定（`isWrite` → 安全确认/串行调度）、frontend 花名册展示。

规则（按序）：

1. 行为 `op_type` 显式为 `command` 或 `query` → **采用显式值**。
2. 其余一切情况 → `query`。

> 2026-09-07 简化：数据引擎唯一形态为 MCP（SQL/HTTP 型已删除），无 method 语义可推导，
> 写行为必须在行为上显式 `op_type: command`；引擎不再参与推导。

## 4. 缓存语义

- agent-backend：按 (scenario, ontology) 缓存，**三文件 mtime**（ontology.yaml + data_engines.yaml + securities.yaml）任一变化即失效重读；不存在的文件 mtime 记 0。
- core-backend：`load_ontology_data` 有自身缓存（见实现），失效语义同样以文件 mtime 为准，无 TTL 陈旧窗口。
- mcp_server_sse：仅函数清单缓存，指纹 = (ontology.yaml/meta.json 文件数, 最大 mtime_ns)。

## 5. 契约用例表（双端测试镜像）

### Overlay

| # | 场景 | 期望 |
| :-: | :-- | :-- |
| O1 | data_engines.yaml 存在（POST 引擎），ontology.yaml 旧段为 GET 引擎 | 采用独立文件 |
| O2 | data_engines.yaml 不存在，ontology.yaml 旧段为 POST 引擎 | 回退旧段 |
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
| relations[] | `relation_type` | `string[]` | 关系类型多选：`asymmetric`/`symmetric`/`transitive`/`functional`/`inverse_functional`；值域外静默丢弃 |
| concepts[] | `terms` | `string[]` | 概念术语集（其他表述）；去重去空 |
| concepts[].attributes[] | `name == "status"` | `string` + `constraint.enum` | 生命周期状态属性：类型恒为 string，枚举值即状态全集 |
| functions[] | `type` | `string` | 函数类型英文码：`TRANSFORMATION`/`CALCULATION`/`DERIVATION`/`VALIDATION`/`MODEL`；值域外归一为空串 |
| behaviors[] | `concept` | `string` | **关联概念唯一（标量）**；取代旧 `related_concepts` 数组 |
| behaviors[] | `from_status` / `to_status` | `string` | command 行为的状态机跃迁；取值必须落在关联概念 status 属性的枚举内 |
| rules[] | `behavior` | `string` | **绑定行为唯一（标量）**；取代旧 `related_behaviors` 数组 |
| rules[] | `related_functions` | `string[]` | **关联函数（2026-09-30 口径 B）**：本体函数 ∪ 公共函数，必须存在否则 400；其中本体且 `type=VALIDATION` 者为**判断函数** |
| concepts[] | `instance_label` | `string` | 实例标签（可选）：实例视图节点标签所用的**属性英文名**，须是该概念已定义的属性 |
| concepts[].attributes[] | `constraint` | `{unique, required, enum, pattern, min, max}` | 属性约束对象：布尔 / 字符串数组 / 正则（仅 string）/ 数值范围（仅 number、integer）；**全缺省视为无约束，保存时不落盘**；`unique=true` 隐式要求 `required=true` |
| rules[] | `data_supplements` | `string[]` | 规则取数接口（query 行为名）；前端按关联函数声明的关联概念自动推导，可手工增减 |

**`params` 说明字段口径（两端一致）**：`behaviors[].params` 项的说明字段为 **`description`**，`functions[].params` 项为 **`display_name`**，两者不互换（`mcp-shared/schema_compile.param_spec_to_schema` 以 `display_name or description` 做读取兜底，但**写入**须按各自口径）。

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

**归一化（`mcp-shared/sandbox.py::_normalize_output`，读时兼容）**：新式（带 bool `success`）原样放行；
旧式 `{"result": …}` 拆包进 `data`（单 result 键取其值，多顶层键整包保留）；裸返回整包作 `data`（stderr 告警）。
行为（facade）与外部 MCP 工具**不在信封范围**（各有既有消费方 / 源头不受控）。

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
