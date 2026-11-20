# 接口契约：存量本体引用

**Feature**: `010-ontology-reuse-context` | **Date**: 2026-11-20 | **Plan**: [plan.md](../plan.md) | **Data Model**: [data-model.md](../data-model.md)

本文件是**前后端共同契约来源**。任一侧实现变更 MUST 先改本文件，再同步两侧代码（章程 VI / 技术治理"契约单点收口"）。

服务：`core-backend`（FastAPI，宿主端口 8001，前端经 `/api` 代理）。

---

## A. HTTP 契约

### A.1 候选列表

```http
GET /api/ontology-refs/candidates?exclude_scenario={场景名}&exclude_ontology={本体名}
```

**用途**：填充「引用存量本体」多选框，并给出不可选原因（FR-002 / FR-003）。

**Query**：

| 参数 | 必填 | 说明 |
| :-- | :-- | :-- |
| `exclude_scenario` | 否 | 要排除的本体所属场景名；与 `exclude_ontology` **同时给出**才生效 |
| `exclude_ontology` | 否 | 要排除的本体名（避免自我引用）；二者仅给一时忽略并照常返回全量 |

**200 响应**：

```json
{
  "candidates": [
    {
      "ontology_id": "12",
      "scenario_id": "3",
      "scenario_name": "订单场景",
      "ontology_name": "货品BOM及工艺",
      "description": "BOM 与工艺路线",
      "deployed_version": "v1.2",
      "counts": { "concepts": 6, "functions": 4, "behaviors": 11 },
      "referenceable": true,
      "skip_reason": null
    },
    {
      "ontology_id": "13",
      "scenario_id": "3",
      "scenario_name": "订单场景",
      "ontology_name": "空本体",
      "description": "",
      "deployed_version": "",
      "counts": { "concepts": 0, "functions": 0, "behaviors": 0 },
      "referenceable": false,
      "skip_reason": "暂无可提取内容"
    }
  ],
  "max_count": 20
}
```

**语义**：

- 排序沿用 `ontology_registry.list_all_ontologies()` 的 `updated_at` 降序（`repositories/metadata.py:338`）。
- `referenceable=false` 当且仅当 `concepts + functions + behaviors == 0`；`skip_reason` 固定文案「暂无可提取内容」。
- `counts` 只统计三类顶层条目数（概念不展开属性），用于 UI 展示体量与置灰判定。
- `description` / `deployed_version` **恒定返回字符串**（可为空串）：`deployed_version` 已有空串兜底（`str(md.get("deployed_version") or "")`）；`description` 直接来自 `meta.json`，`row = dict(meta)`（`repositories/metadata.py:332`）**不会补缺省值**，故实现 MUST 用 `.get("description", "")` 归一为空串。
- `skip_reason` 在 `referenceable=true` 时为 `null`，为 `false` 时固定文案「暂无可提取内容」。
- **不返回** `items`（列表不携带概念明细，避免响应膨胀）。

**失败**：`500` 仅在扫描目录异常时；单个本体的 YAML 解析失败 MUST 跳过该本体并记结构化日志，不使整个端点失败（章程"优雅降级"，与 `metadata.list_all_ontologies` 跳过身份不可信本体同构）。

---

### A.2 预检

```http
POST /api/ontology-refs/precheck
Content-Type: application/json
```

**用途**：创建前列出冲突与体量（FR-014 / FR-015 / SC-006）。**纯计算，不落盘、不创建任何目录。**

**请求体**：

```json
{
  "refs": [
    { "scenario_name": "订单场景", "ontology_name": "货品BOM及工艺" },
    { "scenario_name": "库存场景", "ontology_name": "库存模型" }
  ]
}
```

- `refs` 允许为空数组（返回 `allowed=true`、`conflicts=[]`、`token_estimate=0`）。
- 重复项按一条处理（去重后计算）。
- 顺序不参与判定；响应**不回传** `refs`（见下方字段语义），调用方按自己提交的顺序展示即可。

**200 响应**：

```json
{
  "allowed": false,
  "max_tokens": 20000,
  "token_estimate": 28431,
  "conflicts": [
    {
      "kind": "concept_attribute_mismatch",
      "name": "Order",
      "category": null,
      "participants": [
        { "scenario_name": "订单场景", "ontology_name": "货品BOM及工艺", "detail": "orderNo(string, 唯一；必填)、amount(number, 范围=0~+∞)" },
        { "scenario_name": "库存场景", "ontology_name": "库存模型", "detail": "orderNo(string)、total(number)" }
      ],
      "differences": [
        "amount：仅在货品BOM及工艺中定义",
        "total：仅在库存模型中定义",
        "orderNo：约束 唯一；必填 ≠ -"
      ]
    },
    {
      "kind": "cross_category_duplicate",
      "name": "Inventory",
      "category": ["concept", "function"],
      "participants": [
        { "scenario_name": "库存场景", "ontology_name": "库存模型", "detail": "概念 Inventory" },
        { "scenario_name": "库存场景", "ontology_name": "库存模型", "detail": "函数 Inventory" }
      ],
      "differences": []
    }
  ],
  "reason": "引用内容约 28431 tokens，超过上限 20000；请减少勾选或改选内容更少的主体"
}
```

**字段语义**：

| 字段 | 说明 |
| :-- | :-- |
| `allowed` | `token_estimate <= max_tokens` **且去重后的引用条数 ≤ `max_count`**（条数由请求方已知，响应不回传；引用解析失败走 404，不会以 `allowed=false` 返回） |
| `token_estimate` | `estimate_tokens(将落盘的 prompt_text)`；允许创建时与落盘值**逐值相等**（data-model V6）；前端用于预检通过后的体量提示（见 C.4） |
| `conflicts` | 空数组 = 无冲突。两类 `kind` 见 data-model 2.4 |
| `reason` | `allowed=false` 时的**可操作**提示（含实际值与上限；不得只写"超出限制"） |

> **不返回 `refs`**：引用清单已由 A.1 提供、冲突方由 `conflicts[].participants` 提供，预检响应再返回一份会造成"写而不读"的死键（章程 VI）。条数判断由调用方按提交的 `refs` 长度自行完成。

**`differences` 的生成句式**（固定两条，不得自创）：

- 仅一侧定义：`{属性名}：仅在{本体名}中定义`
- 两侧定义不同：`{属性名}：{左值} ≠ {右值}`，其中值形如 `{type}，约束={constraint}`（`constraint` 为 `-` 时省略该段）

**失败**：

| 情形 | 状态码 | 说明 |
| :-- | :-- | :-- |
| 引用的本体不存在 | `404` | `NotFoundError("本体不存在: {场景名} - {本体名}")` |
| 引用的本体身份不可信（`ontology.yaml.metadata` 缺失或与目录名不符） | `404` | 同上（沿用 `list_all_ontologies` 跳过口径，不纳入引用） |
| `refs` 不是数组 / 元素缺字段 | `400` | `InvalidInputError` |

---

### A.3 创建对话（扩展）

```http
POST /api/threads
Content-Type: application/json
```

**请求体（新增字段 `ontology_refs`）**：

```json
{
  "title": "新对话",
  "scenario_name": "订单场景",
  "ontology_name": "订单排程",
  "version": "v1.0",
  "ontology_refs": [
    { "scenario_name": "订单场景", "ontology_name": "货品BOM及工艺" }
  ]
}
```

**规则**：

1. `ontology_refs` **省略 / `null` / 空数组** → 与改动前行为逐字节一致（thread JSON 不含 `ontology_refs` 键）。前端只传 `[{scenario_name, ontology_name}]`，**不传快照**（防伪造）。
2. 非空时后端**重新提取并重新校验**（不信任前端预检结果）：超限 → `400`；本体不存在 → `404`；未创建任何目录（data-model V7）。
3. 成功 → 快照与 thread **同一次** `save_thread` 写入；响应为完整 thread 对象（含 `ontology_refs`）。

**新增失败**：

| 情形 | 状态码 | message |
| :-- | :-- | :-- |
| 引用体量超限 | `400` | `引用内容约 {n} tokens，超过上限 {max}；请减少勾选或改选内容更少的主体` |
| 引用数量超限 | `400` | `一次最多引用 {max_count} 个本体，请分批创建` |
| 引用本体不存在 | `404` | `本体不存在: {场景名} - {本体名}` |
| 引用了当前对话所属本体自身 | `400` | `不能引用当前对话所属的本体` |
| `ontology_refs` 不是数组 / 元素不是对象 / 元素缺 `scenario_name` 或 `ontology_name` | `400` | `请求参数不合法` |

> 错误体沿用 `main.py` 全局处理器的既有格式 `{code, message, detail}`（`errors.py:9-12` 已声明），本特性**不新增**错误码字段，只使用既有 `InvalidInputError(400)` / `NotFoundError(404)`。

---

### A.4 读取对话

| 端点 | 是否返回 `ontology_refs` | 说明 |
| :-- | :-- | :-- |
| `GET /api/threads/{id}` | **是**（完整快照，含 `prompt_text`） | 对话页需要清单与快照时间；`prompt_text` 一并返回便于排查提示词（无安全边界，与本体内文本等同） |
| `GET /api/threads` | **否** | 列表 UI 不展示引用；避免列表响应携带整段 `prompt_text`。`list_threads` 的显式白名单**不加**该字段 |

**兼容**：旧 thread 无该键 → 响应中不出现该字段（不是 `null`），前端按 `undefined` 处理。

---

### A.5 清空与删除（语义保留，零改动）

| 端点 | 行为 |
| :-- | :-- |
| `POST /api/threads/{id}/clear` | 清 `messages` / `context` / `digest`，**保留** `ontology_refs`（FR-017） |
| `DELETE /api/threads/{id}` | 删整目录，引用随之消失（FR-018） |

---

## B. 提示词段落契约

### B.1 位置

`routers/chat.py::_build_system_message` 的拼接顺序（**新段为第 3.5 段**）：

```text
① ANALYSIS_SYSTEM_PROMPT（主体，含 {business_info} 占位符）
② GRILLING_PROMPT（拷问模式，可选）
③ 业务基线（{business_info} 替换）
④ 存量本体参考（本特性，仅在 thread 顶层有 ontology_refs 时追加）
⑤ 历史对话摘要（_SUMMARY_SECTION，必须在最后）
```

**理由**：⑤ 必须留在末尾以最大化前缀缓存命中（`chat.py:32` 既有注释）；④ 是每轮稳定的前缀。

### B.2 模板（`ONTOLOGY_REF_SECTION`，唯一定义在 `services/ontology_refs.py`）

```text
\n\n=== 存量本体参考（既有约定，硬约束）===
本次对话引用了 {ref_count} 个存量本体，其概念、属性、函数、行为的命名是**既有约定**，优先级高于本次新建内容：
1. 概念、函数、行为三类不得出现同名异义；同一类目内名称必须唯一；同一名称跨类目出现时必须显式说明二者关系，不得混用。
2. 与下列**同名概念**，其属性集合、属性英文名、属性类型与约束必须与所列定义完全一致；发现不一致时先向用户指出冲突，不得自行取舍或改写。
3. 概念不同但语义相同的属性，优先沿用下列已有的属性英文名、类型与约束，不新造第三种写法。
4. 以下名称为只读基线：不得重命名、不得合并、不得为同一事物另造同义词。
5. 未给中文名的条目只有英文名，禁止自行补写、音译或编造中文名。

[1] {scenario_name} - {ontology_name}（快照 {snapshot_at}：概念 {c} / 函数 {f} / 行为 {b}）
概念：
- {name}（{title}）
  - {attr_name}（{attr_title}）: {type}；约束={constraint}
- {name}
函数：
- {name}（{title}）
行为：
- {name}

[2] …
=== 存量本体参考结束 ===\n
```

### B.3 渲染规则

| 规则 | 说明 |
| :-- | :-- |
| 段落开头/结尾 | 以 `\n\n` 开头（与 `_SUMMARY_SECTION` 同风格），以 `=== 存量本体参考结束 ===\n` 结尾 |
| 空类目 | 该本体某类目（概念/函数/行为）为空 → **省略该小节标题**，不输出"（无）" |
| 中文名缺失 | 省略 `（{title}）`，不填英文名、不写 `-` |
| 约束缺失 | `format_constraint` 返回 `-` → **省略** `；约束=…` 片段（FR-008） |
| 概念无属性 | 概念行下不输出属性行 |
| 换行字符 | 任一名称含 `\r` / `\n` → 渲染时替换为单个空格；其余字符原样输出、不转义（Edge Case） |
| 引用为空 | **整段不追加**，`_build_system_message` 返回值与改动前逐字节一致（SC-005） |
| 顺序 | 按 `refs` 数组顺序编号 `[1]…[n]`，不重排、不按场景分组 |

---

## C. 前端模块契约

> 以下 TS 定义是 A 段 HTTP 契约的**投影**，字段与必填性以 A 段为准。A.1 的 `description` / `deployed_version` / `skip_reason` 恒定返回（值可能为空串或 `null`），故 C.1 中为必填而非可选——写成 `?` 会造成"后端可能不返回"的错误认知。

### C.1 `src/api/ontology-refs.ts`（新增）

```ts
export interface RefCandidateCounts { concepts: number; functions: number; behaviors: number }

export interface OntologyRefCandidate {
  ontology_id: string;
  scenario_id: string;
  scenario_name: string;
  ontology_name: string;
  description: string;
  deployed_version: string;
  counts: RefCandidateCounts;
  referenceable: boolean;
  skip_reason: string | null;
}

export type ConflictKind = 'concept_attribute_mismatch' | 'cross_category_duplicate';

export interface RefConflict {
  kind: ConflictKind;
  name: string;
  category?: string[] | null;
  participants: { scenario_name: string; ontology_name: string; detail: string }[];
  differences: string[];
}

export interface PrecheckResult {
  allowed: boolean;
  max_tokens: number;
  token_estimate: number;
  conflicts: RefConflict[];
  /** `allowed=false` 时的可操作提示（含实际值与上限）；`allowed=true` 时为 `null` */
  reason: string | null;
}

export interface OntologyRefInput { scenario_name: string; ontology_name: string }

export function listOntologyRefCandidates(params?: {
  excludeScenario?: string;
  excludeOntology?: string;
}): Promise<{ candidates: OntologyRefCandidate[]; max_count: number }>;

export function precheckOntologyRefs(refs: OntologyRefInput[]): Promise<PrecheckResult>;
```

### C.2 `src/api/threads.ts`（修改）

```ts
export interface OntologyRefAttribute { name: string; title?: string; type: string; constraint?: string }
export interface OntologyRefConcept { name: string; title?: string; attributes: OntologyRefAttribute[] }
export interface OntologyRefEntry {
  ontology_id: string; scenario_id: string;
  scenario_name: string; ontology_name: string;
  counts: RefCandidateCounts;
  items: {
    concepts: OntologyRefConcept[];
    functions: { name: string; title?: string }[];
    behaviors: { name: string; title?: string }[];
  };
}
export interface OntologyRefSnapshot {
  snapshot_at: string;
  max_tokens: number;
  token_estimate: number;
  refs: OntologyRefEntry[];
  prompt_text: string;
}

export interface Thread { /* 既有字段 */ ontology_refs?: OntologyRefSnapshot }

export function createThread(
  title?: string, scenario_name?: string, ontology_name?: string, version?: string,
  ontology_refs?: OntologyRefInput[],   // 新增第 5 参；省略 → 请求体不带该键
): Promise<Thread>;
```

> `createThread` **省略**引用时，请求体 MUST NOT 出现 `ontology_refs` 键（不是 `[]`），以对齐 A.3 规则 1。

### C.3 `src/components/Design/conversation-ontology-refs.ts`（新增，纯函数）

```ts
export interface RefSelectOption {
  value: string;
  label: string;
  disabled: boolean;
  /** 不可选时的原因（= 后端的 skip_reason），可选 */
  reason?: string;
  /** 以下三项供 `optionRender` 渲染第二行（见 C.4「选项渲染」） */
  description: string;
  counts: RefCandidateCounts;
  deployed_version: string;
}

/**
 * 选项 value 用 `场景名\u0000本体名` 拼装，避免名称含 `/` 时与标签混淆；label 为「场景名 - 本体名」。
 * 名称本身若含 `\u0000`，拼装前 MUST 替换为空格（与渲染层的换行折叠同口径）；`parseRefKey` 按**第一个** `\u0000` 切分。
 */
export function refKeyOf(ref: OntologyRefInput): string;
export function parseRefKey(value: string): OntologyRefInput;

export function toSelectOptions(
  candidates: readonly OntologyRefCandidate[],
  excluded?: OntologyRefInput,
): RefSelectOption[];

export function toRefInputs(values: readonly string[]): OntologyRefInput[];

export interface ConflictGroup { title: string; items: { name: string; lines: string[] }[] }
export function groupConflicts(conflicts: readonly RefConflict[]): ConflictGroup[];
export function conflictKindLabel(kind: ConflictKind): string;

export function formatSnapshotTime(iso: string): string;   // → 本地 `YYYY-MM-DD HH:mm`

export const REF_EMPTY_TEXT = '当前没有可引用的存量本体';
export const REF_LOAD_FAILED_TEXT = '加载可引用本体失败';

/**
 * 被引用本体是否已不存在（FR-016 / US4-场景2）。
 * 用身份四元组中的两个 id 组合（`${scenario_id}/${ontology_id}`）匹配，避免跨场景 id 碰撞；
 * `candidateKeys` 由候选列表按同一口径拼装，返回"已不存在"的 key 集合。
 */
export interface RefIdentity { scenario_id: string; ontology_id: string }
export function missingRefIds(refs: readonly RefIdentity[], candidateKeys: ReadonlySet<string>): Set<string>;
```

### C.4 UI 契约

| 位置 | 契约 |
| :-- | :-- |
| `ConversationManager` 新建弹窗 | 版本号 `Input` 之后新增「引用存量本体（可选）」`Select mode="multiple"`，`aria-label="引用存量本体"`，`placeholder="不选则与改动前一致"`；下方一行说明「引用后本次对话的概念/函数/行为不会与这些本体重名，同名概念属性保持一致」 |
| 选项渲染（`optionRender`） | 第一行「{场景名} - {本体名}」；第二行小字展示 **`description`**（非空时）+「概念 {counts.concepts} / 函数 {counts.functions} / 行为 {counts.behaviors}」+ **`deployed_version`** 非空时的「已部署 {v}」；`referenceable=false` 时第二行整行替换为 **`skip_reason`**，整项 `disabled` |
| 选中数上限 | 选项区右侧常驻「已选 {n} / {max_count}」；达到上限后其余选项视为不可选（`onChange` 截断并 `message.warning('一次最多引用 {max_count} 个本体，请分批创建')`）——`max_count` 的唯一消费点 |
| 预检进行中 | 点「确认创建」后立即置 `prechecking`：确认按钮 `loading`、文案「正在检查引用冲突…」，同时禁用取消与重复提交；**禁止静默等待**（章程 IV 三态） |
| 冲突 Modal | 标题「引用本体存在命名冲突」；`okText="仍然创建"`、`cancelText="返回调整"`；`onCancel` 关闭本 Modal 且**保留**新建弹窗与已选状态 |
| 体量展示 | `token_estimate` / `max_tokens` 在**冲突 Modal** 顶部展示为「引用内容约 {token_estimate} tokens（上限 {max_tokens}），仍在范围内」——用户看到冲突时同时知道体量。无冲突时直接创建，不做"一闪而过"的无效提示（预检只在提交时调用一次，不做实时防抖） |
| 超限 | 不弹 Modal，`message.error(预检 reason)` 并保持新建弹窗打开 |
| `ConversationChat` Header | `title` 之后渲染引用标签组，**由独立子组件 `OntologyRefTags` 承担**（`ConversationChat` 现 474 行，已贴 500 行硬上限）：每个本体一个 `Tag`（文案「{场景名} - {本体名}」，`Tooltip` 内展示该本体的 **`refs[].counts`**（概念 / 函数 / 行为条数））+ 一个「快照 {格式化时间}」`Tooltip`，其中展示 **`token_estimate` / `max_tokens`**（如「引用内容约 4,210 / 20,000 tokens」）；`ontology_refs` 不存在时子组件**返回 `null`**（不渲染任何节点）；原本体已不存在时该 `Tag` 变灰并加「原本体已不存在」提示（判定用 `missingRefIds`，按 `scenario_id` + `ontology_id` 组合匹配，见 C.3） |

---

## D. 两侧同改清单（契约变更时的同步义务）

| 层 | 文件 | 变更 |
| :-- | :-- | :-- |
| 后端-传输 | `core-backend/routers/ontology_refs.py` | 新增两个端点 |
| 后端-传输 | `core-backend/routers/threads.py` | 创建端点透传 `ontology_refs` |
| 后端-传输 | `core-backend/routers/chat.py` | `_build_system_message` 第 5 段；`_langchain_stream` 参数透传 |
| 后端-传输 | `core-backend/main.py` | 注册新 router |
| 后端-领域 | `core-backend/services/ontology_refs.py` | 新增：提取/渲染/冲突/体量（= 本契约 B 段的唯一实现） |
| 后端-领域 | `core-backend/services/thread_store.py` | `create_thread` 增字段；`list_threads` 白名单**不加** |
| 后端-配置 | `core-backend/config.py` | `ONTOLOGY_REF_MAX_TOKENS` / `ONTOLOGY_REF_MAX_COUNT` |
| 前端-契约 | `frontend/src/api/ontology-refs.ts` | 新增 |
| 前端-契约 | `frontend/src/api/threads.ts` | `createThread` 第 5 参、`Thread` 类型 |
| 前端-契约 | `frontend/src/api/client.ts` | 再导出 |
| 前端-UI | `ConversationManager.tsx` / `ConversationChat.tsx` | 见 C.4 |
| 前端-UI | `OntologyRefTags.tsx` | 新增子组件（Header 引用标签组），见 C.4 |
| 前端-UI | `OntologyRefTags.test.tsx` | 新增子组件单测 |
| 前端-纯逻辑 | `conversation-ontology-refs.ts` | 见 C.3 |
| 文档 | 本文件 / `data-model.md` / `spec.md` 修订记录 | 同步 |
