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

1. 行为 `op_type` 显式为 `command` 或 `query` → **采用显式值**（显式优先，不看数据引擎）。
2. 否则查数据引擎：存在 `behavior_name` 匹配的引擎，且 `engine_type != "SQL"`，且 `target.method` 大写后 ∈ `{POST, PATCH, DELETE, PUT}` → `command`。
3. 其余一切情况 → `query`（SQL 引擎推不出写；无引擎推不出写；method 大小写不敏感）。

写方法集合：`{POST, PATCH, DELETE, PUT}`（三端同一常量）。

## 4. 缓存语义

- agent-backend：按 (scenario, ontology) 缓存，**三文件 mtime**（ontology.yaml + data_engines.yaml + securities.yaml）任一变化即失效重读；不存在的文件 mtime 记 0。
- core-backend：`load_ontology_data` 有自身缓存（见实现），失效语义同样以文件 mtime 为准，无 TTL 陈旧窗口。
- mcp_server_sse：仅函数清单缓存，指纹 = (ontology.yaml/meta.json 文件数, 最大 mtime_ns)。

## 5. 契约用例表（双端测试镜像）

### Overlay

| # | 场景 | 期望 |
| :-: | :-- | :-- |
| O1 | data_engines.yaml 存在（POST 引擎），ontology.yaml 旧段为 GET 引擎 | 采用独立文件（行为判写） |
| O2 | data_engines.yaml 不存在，ontology.yaml 旧段为 POST 引擎 | 回退旧段（行为判写） |
| O3 | securities.yaml 存在（scope=everyone），ontology.yaml 旧段 scope=disable | 采用独立文件（everyone） |
| O4 | 独立文件为裸列表形态 | 等价接受 |
| O5 | 独立文件为映射包裹形态（`data_engines:` / `securities:` 键） | 等价接受 |

### 操作类型推导

| # | op_type | 引擎 | 期望 |
| :-: | :-- | :-- | :-- |
| T1 | `command`（显式） | SQL 引擎 | command（显式优先） |
| T2 | `query`（显式） | HTTP POST 引擎 | query（显式优先） |
| T3 | 空 | HTTP POST 引擎 | command |
| T4 | 空 | HTTP GET 引擎 | query |
| T5 | 空 | SQL 引擎（即使 method=POST） | query |
| T6 | 空 | 无引擎 | query |
| T7 | 空 | HTTP `post`（小写）引擎 | command（大小写不敏感） |
