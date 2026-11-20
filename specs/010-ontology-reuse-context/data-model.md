# 数据模型：新建对话时引用存量本体

**Feature**: `010-ontology-reuse-context` | **Date**: 2026-11-20 | **Plan**: [plan.md](./plan.md) | **Contracts**: [contracts/ontology-refs.md](./contracts/ontology-refs.md)

本特性**不引入数据库、不引入迁移**。全部状态落在既有 thread JSON 文件里。

---

## 1. 存储位置

| 对象 | 介质 | 唯一写入口 |
| :-- | :-- | :-- |
| 对话（thread） | `.data/threads/demand/{thread_id}/.data.json` | `services/thread_store.save_thread` |
| 引用快照 | 同上文件顶层键 `ontology_refs` | 同上（与 thread 同一次写入） |
| 源本体 | `.data/onto_market/{scenario}/{ontology}/ontology.yaml` | 本体编辑链路（本特性**只读**） |

**不新增文件、不新增目录、不改动源本体。**

---

## 2. 实体

### 2.1 引用快照（`ontology_refs`）— thread 顶层可选键

| 字段 | 类型 | 必填 | 说明 |
| :-- | :-- | :-- | :-- |
| `snapshot_at` | string（UTC ISO8601） | 是 | 快照生成时间；前端展示为本地时间（与既有 `created_at` 同口径） |
| `max_tokens` | int | 是 | 生成时的上限值（记录当时口径；Header Tooltip 展示为「`token_estimate` / `max_tokens`」，后续改配置不影响历史对话） |
| `token_estimate` | int | 是 | `estimate_tokens(prompt_text)` 的结果（唯一估算口径）；Header Tooltip 展示体量 |
| `refs` | `RefEntry[]` | 是 | 被引用本体条目，按创建时提交顺序；**已去重** |
| `prompt_text` | string | 是 | **渲染后的整段提示词文本**（所有 refs 合并），每轮直接拼进 system prompt |

**`prompt_text` 是提示词的唯一权威来源**；`refs[].items` 只服务 UI 清单、审计与 SC-002 的逐项核对。

### 2.2 引用条目（`RefEntry`）

| 字段 | 类型 | 必填 | 说明 |
| :-- | :-- | :-- | :-- |
| `ontology_id` | string | 是 | 取自 `ontology.yaml.metadata`（身份唯一来源）；数字字符串 |
| `scenario_id` | string | 是 | 同上；与 `ontology_id` 组合参与"原本体已不存在"的判定（避免跨场景 id 碰撞） |
| `scenario_name` | string | 是 | 展示名，与 id 同时存以防场景改名后清单不可读 |
| `ontology_name` | string | 是 | 同上 |
| `counts` | `{concepts:int, functions:int, behaviors:int}` | 是 | 便于 UI 显示体量，避免前端遍历 items |
| `items` | `ExtractedItems` | 是 | 四类提取结果（见 2.3） |

### 2.3 提取项（`ExtractedItems`）— **严格四类**

| 键 | 元素结构 | 说明 |
| :-- | :-- | :-- |
| `concepts` | `{name, title?, attributes: AttributeItem[]}` | 概念：英文名 + 中文名 |
| `functions` | `{name, title?}` | 函数：**只有名字**，不含 params/response/related_concepts |
| `behaviors` | `{name, title?}` | 行为：**只有名字**，不含 params/response/concept/from_status/to_status |

`AttributeItem`（概念属性）：

| 字段 | 类型 | 说明 |
| :-- | :-- | :-- |
| `name` | string | 英文名 |
| `title` | string? | 中文名；缺失时**不写该键**（FR-007：不得用英文名冒充） |
| `type` | string | 数据类型（`string` / `number` / …） |
| `constraint` | string? | 约束文本；无任何约束时**不写该键**（FR-008） |

**`constraint` 文本的生成必须调用 `services.ontology_summary.format_constraint`**（唯一实现），不得另写一份。取值形如 `唯一；必填`、`枚举=[A, B]`、`范围=0~+∞`。

**明确的非提取项**（FR-006，出现即视为缺陷）：概念关系、对象关系、规则、流程、安全管控、数据引擎、函数参数、函数返回、行为参数、行为返回、行为状态迁移。

### 2.4 冲突项（`Conflict`）— 仅存在于预检响应，**不落盘**

| 字段 | 类型 | 说明 |
| :-- | :-- | :-- |
| `kind` | `"concept_attribute_mismatch"` \| `"cross_category_duplicate"` | 两类 |
| `name` | string | 冲突名称（概念名 / 跨类目名） |
| `category` | string? | 仅跨类目时给出涉及的类目列表，如 `["concept","function"]` |
| `participants` | `{scenario_name, ontology_name, detail}[]` | 参与方及其定义摘要 |
| `differences` | `string[]` | 仅 `concept_attribute_mismatch`：逐条差异，句式由 `contracts` A.2 固定，如 `amount：number ≠ string`、`orderNo：仅在货品BOM及工艺中定义` |

### 2.5 预检结果（`PrecheckResult`）— 仅存在于响应

| 字段 | 类型 | 说明 |
| :-- | :-- | :-- |
| `allowed` | bool | `token_estimate <= max_tokens` 且**去重后**的引用条数 ≤ `max_count` |
| `max_tokens` | int | 当前配置值（前端在「预检通过」提示中展示） |
| `token_estimate` | int | 若允许创建，与将落盘的 `token_estimate` **完全一致**；前端在「预检通过」提示中展示 |
| `conflicts` | `Conflict[]` | 空数组表示无冲突 |
| `reason` | `string \| null` | `allowed=false` 时的可操作提示；允许时为 `null` |

> **不返回 `refs`**：引用清单由候选端点（A.1）提供、冲突方由 `conflicts[].participants` 提供，预检再返回一份即"写而不读"的死键。
> **内部结构与对外响应的映射**：后端 `SnapshotResult`（含 `entries` / `prompt_text` / `items`）只把 `allowed` / `max_tokens` / `token_estimate` / `conflicts` / `reason` 五个字段外露为 `PrecheckResult`；`create_thread` 用**同一个** `SnapshotResult` 落盘，因此预检与创建的体量口径必然一致（V6）。

---

## 3. 落盘示例

```json
{
  "id": "8f1c...",
  "title": "新对话",
  "status": "exploring",
  "version": "v1.0",
  "created_at": "2026-11-20T14:05:11.238000+00:00",
  "updated_at": "2026-11-20T14:05:11.238000+00:00",
  "messages": [],
  "scenario_name": "订单场景",
  "scenario_id": "3",
  "ontology_name": "订单排程",
  "ontology_id": "7",
  "ontology_refs": {
    "snapshot_at": "2026-11-20T14:05:11.238000+00:00",
    "max_tokens": 20000,
    "token_estimate": 412,
    "refs": [
      {
        "ontology_id": "12",
        "scenario_id": "3",
        "scenario_name": "订单场景",
        "ontology_name": "货品BOM及工艺",
        "counts": { "concepts": 1, "functions": 1, "behaviors": 1 },
        "items": {
          "concepts": [
            {
              "name": "Material",
              "title": "物料",
              "attributes": [
                { "name": "materialNo", "title": "物料编号", "type": "string", "constraint": "唯一；必填" },
                { "name": "qty", "title": "数量", "type": "number" }
              ]
            }
          ],
          "functions": [{ "name": "sumQty", "title": "汇总数量" }],
          "behaviors": [{ "name": "createMaterial" }]
        }
      }
    ],
    "prompt_text": "\n\n=== 存量本体参考（既有约定，硬约束）===\n…\n=== 存量本体参考结束 ===\n"
  }
}
```

**未选择任何本体时，`ontology_refs` 键 MUST NOT 出现**（不是空对象）。这使 SC-005 的"逐字节一致"具备可验证形式。

---

## 4. 不变量

| ID | 不变量 | 校验方式 |
| :-- | :-- | :-- |
| V1 | 未选引用 → thread JSON 无 `ontology_refs` 键 | 端点测试断言 `"ontology_refs" not in data` |
| V2 | `items` 与 `prompt_text` 由**同一次**提取产出（`prompt_text` 是 `items` 的纯函数渲染结果） | 单测：给定 items，`render(items) == prompt_text` |
| V3 | `refs` 内 `ontology_id` 唯一（重复勾选按一条处理） | 单测 + 端点测试 |
| V4 | `items` 的三类之外无任何键；函数/行为元素只有 `name`(+`title`) | 单测断言键集合 |
| V5 | `constraint` 文本与 `format_constraint` 输出逐字相同 | 单测直接复用该函数做对照 |
| V6 | `token_estimate == estimate_tokens(prompt_text)` | 单测 + 端点测试 |
| V7 | 超限 → 创建失败，`.data/threads/demand/` 下**无新增目录**（无残留） | 端点测试比对目录数 |
| V8 | `clear_messages` 不清除 `ontology_refs` | 端点测试：clear 后重新 GET，字段仍在 |
| V9 | `delete_thread_dir` 使引用随目录消失（FR-018） | 端点测试：delete 后 404 |
| V10 | `snapshot_at` 一旦写入不因后续对话变更（SC-007） | 端点测试：修改源本体后 GET，`prompt_text` 与 `snapshot_at` 均不变 |
| V11 | 被引用本体已删除时，thread 仍可读取并回话；前端标记"原本体已不存在" | 端点测试：删源本体后 GET thread 200；前端按 `refs[].ontology_id` 与当前候选列表求差集判定 |
| V12 | 名称中的换行符在渲染时替换为单个空格（防止行结构被破坏），其余字符原样输出、不转义 | 单测：名称含 `\n` 与 `===` 的输出断言 |

---

## 5. 生命周期（状态流转）

```text
[新建弹窗打开]
   │  GET /api/ontology-refs/candidates?exclude_*=当前本体
   ▼
[已选 0..N 个] ──未选──────────────► 直接创建（thread JSON 无 ontology_refs）
   │  POST /api/ontology-refs/precheck   （纯计算，不落盘）
   ▼
[预检结果]
   ├─ allowed=false ──► 阻断创建，提示减少勾选（无落盘）
   ├─ conflicts 非空 ──► 冲突 Modal ──取消──► 回到[已选]，选择状态保留
   │                                 └─确认──┐
   └─ 无冲突 ─────────────────────────────────┤
                                              ▼
                       POST /api/threads（带 refs 引用数组）
                         ├─ 后端重新提取 + 重新校验（权威）
                         ├─ 失败 → 400/404，无目录残留
                         └─ 成功 → 快照与 thread 同一次写入
                                              ▼
                       [对话进行中] 每轮：读 thread 顶层 prompt_text → 拼 system 第 5 段
                                              │
                      ┌───────────────────────┴───────────────────────┐
                      ▼                                               ▼
              [清空消息] messages/context/digest 清空        [删除对话] 整目录删除
               ontology_refs 保留（V8）                      引用消失（V9）
                      │
                      ▼
              下一轮仍按原快照注入（不重新读源本体）
```

---

## 6. 与源本体的关系

- **单向**：本体 → 快照。快照从不回写本体（FR 无写回要求，spec 明确"引用不产生任何写回"）。
- **创建时定版**：`prompt_text`/`items` 生成后永不刷新，源本体变更不触发任何同步任务。
- **无版本对齐**：不记录源本体的 `deployed_version`；快照即内容（若记录版本号反而会诱导误以为可回溯重算）。
- **源本体删除**：快照仍完整可用；前端用候选列表求差集显示"原本体已不存在"（V11），不请求该本体详情。

---

## 7. 规模与索引

| 项 | 目标 | 说明 |
| :-- | :-- | :-- |
| 单次引用本体数 | ≤ 20（`ONTOLOGY_REF_MAX_COUNT`） | 超出提示分批 |
| 单次提取体量 | ≤ 20,000 tokens（`ONTOLOGY_REF_MAX_TOKENS`） | 超限阻断，不截断 |
| thread JSON 增量 | ≤ 数百 KB | `items` + `prompt_text` 双份，20K tokens 量级下可控 |
| 候选端点扫描 | 全场景本体一次扫描 + 每本体一次 `load_ontology_data`（命中 mtime 缓存） | 不做逐概念 IO；无 N+1 |
| 每轮 chat 增量 | 0 次 IO（只读已加载的 thread dict 并做字符串拼接） | 无解析、无渲染、无估算 |

---

## 8. 兼容与降级

| 场景 | 行为 |
| :-- | :-- |
| 旧 thread（无 `ontology_refs` 键） | 读取时取 `None` → 不追加段落 → 行为与改动前完全一致 |
| 前端收到旧 thread | `ontology_refs` 为 `undefined` → Header 不渲染任何引用节点 |
| 候选端点失败 | 弹窗仍可填版本号创建（引用选择器显示空态 + 重试），不阻断主流程 |
| 预检端点失败 | `message.error` 并**不自动创建**（避免绕过冲突/超限校验）；用户可重试 |
| 创建时校验失败（前端已通过预检） | 后端 400/404 + 可读 message，前端显示在新建弹窗内，不跳转 |
