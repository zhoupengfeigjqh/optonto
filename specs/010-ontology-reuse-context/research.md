# 技术研究：新建对话时引用存量本体

**Feature**: `010-ontology-reuse-context` | **Date**: 2026-11-20 | **Plan**: [plan.md](./plan.md)

本文件记录方案阶段的 13 项决策（D1-D13）。每项给出：待解问题、候选方案、结论、依据、后果。
所有"依据"均为仓内已核实的代码位置，不是推测。

---

## D1 落点：需求对话，还是智能体对话？

**问题**：项目里有两套独立的对话体系，都需要"选本体"。

**事实**（已核）：

| 体系 | 前端 | 后端 | 是否填版本号 | 现有本体选择能力 |
| :-- | :-- | :-- | :-- | :-- |
| 需求对话 | `ConversationManager.tsx` → `ConversationChat.tsx` | core-backend `POST /api/threads`（`routers/threads.py:30`） | **是**（`ConversationManager.tsx:155-162`） | 无 |
| 智能体对话 | `AgentApp.tsx` → `agent/AgentConversation.tsx` | agent-backend `POST /onto_market/{scenario}/{ontology}/threads` | 否 | **已有** `ontology_scope`（`AgentApp.tsx:227-246`） |

**结论**：落点为**需求对话**。

**依据**：spec 原文"新建对话时，**除了输入版本外**，还可选择存量本体"——只有需求对话有版本号输入；且 `agent-backend` 的 `ontology_scope` 是"智能体运行时允许访问哪些本体"，用于工具路由（`chat-session.ts:80 resolveScope`），不是提示词注入，语义不同。

**后果**：不触碰 `agent-backend`；两套体系保持独立，未来若要统一属新需求。

---

## D2 快照存什么：结构化、渲染文本，还是两者都存？

**问题**：FR-016 要求"引用是创建时的快照，源本体后续变更不影响提示词"，SC-007 要求"重新进入该对话时引用内容变化 0 处"。

**候选**：

| 方案 | 优点 | 缺点 |
| :-- | :-- | :-- |
| A. 只存引用（`{scenario, ontology}`），每轮重新读源本体 | 存储最小、源本体变更自动跟随 | **违反 FR-016**：源本体改了提示词就变；源本体删除后对话直接报错 |
| B. 只存渲染后的段落字符串 | 提示词绝对稳定；实现最简 | 前端无法列出"引用了哪些名字"（SC-002 需要核对清单）；无法做结构化审计 |
| C. 存结构化 `items` + 预渲染 `prompt_text` | 提示词稳定（直接拼 `prompt_text`）；UI/审计可读；SC-002 可逐项核对 | 存储略大（同一信息存两份，约 2 倍文本量，20K tokens 上限下 ≤ 数十 KB） |

**结论**：**C**。`prompt_text` 是提示词的唯一权威来源，`items` 只服务 UI 与审计，两者都在创建时一次性生成。

**依据**：既有先例——MCP 发布"发布即快照"（`services/mcp_publish_registry.py:177-254 compile_tools` 把工具编译进 `publishes.json`，读端点只读快照，见 `tests/test_mcp_publish.py:234-252`）；本体版本档案是把三份 YAML 整份拷到 `ontology_versions/{version}/`。

**后果**：提示词渲染逻辑日后演进不会让历史对话漂移；代价是同一信息两份，需在 data-model 中明确"两者必须由同一次提取产出，禁止分别生成"。

---

## D3 提取器放哪：扩展 `ontology_summary`，还是新建模块？

**问题**：仓内已有"本体 → 文本"渲染器 `services/ontology_summary.py::build`。

**事实**：`build()` 的口径与 FR-006 冲突——
- 只渲染概念/关系/行为/流程，**不含函数**（该文件 1-6 行注释明确说明）；
- 渲染了关系与流程（FR-006 明确**不得**提取）；
- 约束已在 `format_constraint` 中处理，但属性输出附"（自有/继承自 X）"，FR-006 未要求。

**结论**：**新建** `services/ontology_refs.py`，但**复用** `ontology_summary.format_constraint`（唯一实现，不复制）。

**理由**：给 `build()` 加开关会同时影响技能生成链路的既有输出（`skills` 相关调用），属污染既有消费者；两个口径的差异是结构性的（类目集合不同），不是参数化的差异。

**后果**：新增一个纯函数模块；`format_constraint` 成为跨模块公开函数（已是公开名，非下划线私有），符合章程 II"跨模块复用能力必须提升为公开 API"。

---

## D4 概念属性用「自有属性」还是「有效属性」？

**问题**：概念可通过 `sub_class_of` 继承属性，并用 `attribute_restrictions` 收窄约束（`schemas/__init__.py:97-111`）。同一语义可能有两种表达：一个本体把属性写在子概念上，另一个用继承 + 收窄。

**结论**：用 `services.inheritance.effective_map(concepts)` 的**有效属性**（自有 ∪ 继承后收窄），与 `ontology_summary.build` 同口径。输出时**不标注**继承来源。

**理由**：
1. 若只用自有属性，两个"订单"概念一个用继承、一个用自有，会被判为属性集合不同 → 误报冲突；或漏掉真实生效的约束 → 模型按错误约束设计。
2. 与既有唯一语义入口保持一致，避免第二套"什么算属性的约束"的口径。
3. "不标注继承来源"是为满足 FR-006 的严格四类（未要求继承信息），且继承链信息对"命名与属性对齐"这个目标无价值。

**后果**：`spec.md` 修订记录需注明该口径（已回写）。

---

## D5 约束如何格式化：复用还是自写？

**结论**：复用 `ontology_summary.format_constraint`。

**依据**：它已覆盖 6 个约束字段（`unique` / `required` / `enum` / `pattern` / `min` / `max`），输出"唯一；必填；枚举=[...]；模式=...；范围=lo~hi"，与 `schemas/__init__.py:49-56` 的字段一一对应；且 `constraint is None` 与"全缺省"都归一为 `-`（`schemas/__init__.py:85-94` 的归一逻辑）。

**适配**：FR-008 要求"属性无任何约束时不输出空约束描述"。`format_constraint` 返回 `-` 时，渲染器**不输出** `；约束=` 片段（不是输出 `约束=-`）。

**后果**：属性行格式为 `- {name}（{title}）: {type}；约束={text}`，其中 `；约束=...` 在 `text == "-"` 时整段省略。

---

## D6 候选选项从哪个端点来？

**问题**：FR-003 要求"没有任何概念/函数/行为的本体置灰不可选"，所以选项里必须带"可引用性"；FR-002 要求"当前本体不出现在选项中"。

**候选**：

| 方案 | 问题 |
| :-- | :-- |
| A. 扩展现有 `GET /api/ontologies`（加 `referenceable` / `counts`） | 该端点被多处消费（智能体对话范围选择器、部署页等，`api/ontologies.ts:36-43`）；为了一个消费方，让**所有**调用方都付出"解析全部 YAML 统计条目"的开销 |
| B. 前端拉 `GET /api/ontologies` 后逐个 `GET /api/ontologies/{id}/data` 判断 | N+1（本体数十个即数十请求）；前端重复实现"什么算有内容"的判定 |
| C. 新增专用端点 `GET /api/ontology-refs/candidates` | 多一个端点，但只服务本特性；可带 `exclude_*` 参数；统计在后端一次完成 |

**结论**：**C**。

**端点**：`GET /api/ontology-refs/candidates?exclude_scenario=&exclude_ontology=`

**返回**：每项 `{ontology_id, scenario_id, scenario_name, ontology_name, description, deployed_version, counts:{concepts, functions, behaviors}, referenceable, skip_reason}`。

**实现**：`ontology_registry.list_all_ontologies()`（一次全量，`repositories/metadata.py:310-338`）→ 对每项 `services.load_ontology_data(scenario, ontology)`（**mtime 缓存**，`services/__init__.py:206-221`）→ 统计三类数量。

**后果**：`GET /api/ontologies` 零改动，既有消费者无回归风险。性能计入 plan 的 P95 口径。

---

## D7 冲突与超限：前端算还是后端算？预检要不要单独端点？

**结论**：后端算，独立预检端点 `POST /api/ontology-refs/precheck`；**创建端点再次计算**，不信任预检结果。

**理由**：
1. 冲突判定需要"属性集合 + 约束文本"的比较，逻辑必须与提取器同源（否则出现"预检说没冲突、创建后提示词里两份定义打架"）。放后端 = 只有一份实现（章程"跨服务契约单点收口"）。
2. 超限判定依赖 token 估算，仓内唯一的估算是 Python 侧 `context_compactor.estimate_tokens`（`context_compactor.py:63-75`，明确不引 tiktoken）。前端再写一份必然漂移。
3. **创建时重算**是必须的：预检与创建之间存在时间窗（用户可能在弹窗停留数分钟，期间本体被改），且前端预检结果可被绕过。SC-002 要求"提示词与源本体清单核对缺失 0 项"，只有创建时提取的快照才可作权威。

**后果**：预检是"交互提示"，创建是"权威校验"。两者调用同一个 `services.ontology_refs.build_snapshot(refs) -> SnapshotResult`，只是预检丢弃不落盘。

---

## D8 提示词段落放哪、空段怎么处理？

**问题**：`_build_system_message`（`routers/chat.py:77-90`）当前顺序为：主体 → 拷问模式 → 业务基线（占位符替换）→ 历史摘要（追加末尾）。

**结论**：新段插在**业务基线之后、历史摘要之前**；`refs` 为空时**整段不追加**。

**理由**：
1. 摘要段刻意放 system 末尾以最大化前缀缓存命中（`chat.py:32` 既有注释）。引用段是**稳定前缀**（同一对话每轮完全相同），放摘要之前不会破坏"稳定前缀 + 可变尾部"的缓存结构。
2. 引用段是硬约束，必须早于摘要出现，避免被"如与当前消息冲突，以当前消息为准"的摘要免责声明稀释（`_SUMMARY_SECTION` 在 `chat.py:33-39`）。
3. 空段不追加 → 满足 SC-005"未选本体时系统提示词与改动前逐字节一致"。

**实现**：`_build_system_message(business_info, grilling=False, summary_text="", ontology_refs_text="")`，在 `summary_text` 之前插入；`_langchain_stream` 增加同名参数透传；调用方从 **thread 顶层** `data.get("ontology_refs")` 取（和 `business_info` 必须从全量 messages 取同理，`chat.py:80-82` 已有此类告警）。

**后果**：`_langchain_stream` 与 `generate()` 各加一个参数；不落盘 system prompt（沿用现状，`chat.py:98` 已确认 prompt 不入 thread JSON）。

---

## D9 注入上限取多少？单次能引用几个本体？

**上限**：**20,000 tokens**（`ONTOLOGY_REF_MAX_TOKENS`，默认 20000，环境变量可覆盖）。

**依据**：与 `CONTEXT_SINGLE_MSG_MAX_TOKENS = 20_000`（`config.py:51`）同量级；spec Assumptions 已标注"初始按 20,000 tokens 计，实际数值在方案阶段确定并回写"。

**引用数量上限**：**20 个**（`ONTOLOGY_REF_MAX_COUNT`，默认 20）。超出时前后端都提示"一次最多引用 20 个本体，请分批"。

**理由**：20 个本体的命名清单在 20K tokens 内通常放得下；数量上限是"防手滑全选"的前置闸门，真正约束仍是 token 上限（数量限制不替代体量校验）。

**后果**：两个配置项都有默认值，不构成"新增部署步骤"；spec 的 Assumptions 已回写。

---

## D10 冲突检测口径：检哪些、怎么比？

**只检两类**（严格对齐 FR-014）：

1. **同名概念、属性不一致**：两个及以上被引本体存在同名概念，其**有效属性集合**不同。
   比较键 = 按属性名排序后的 `[(name, type, format_constraint(constraint))]`。
   差异明细：只在一侧出现的属性名；两侧都有但 `type` 或约束文本不同的属性名。
2. **跨类目同名**：同一名称同时出现在不同类目（概念名 ∩ 函数名 ∩ 行为名 三者的非空交集）。

**不检**：
- "概念不同但语义相同的属性"（US2-场景3）——语义相近无法自动判定，只在提示词层面用 SHOULD 要求（FR-012），不产生阻断。
- 同名函数/同名行为之间是否语义不同——FR-014 只列"同名概念属性不一致"与"跨类目同名"，同类目同名（如两个本体的函数都叫 `sumQty`）**不阻断**：提示词已要求"不得同名异义"，但没有属性可比对，无法客观判定。

**归一化**：`constraint` 为 `None` 或全缺省时 `format_constraint` 均返回 `-`，因此 `unique=False` 与 `None` 视为相同（符合直觉：都没约束）。属性顺序不影响判定（排序后比较）。

**后果**：`contracts/ontology-refs.md` 的 `conflicts[]` 结构按此两种 `kind` 定义。

---

## D11 前端冲突确认交互

**结论**：创建按钮点击后先调预检 →
- `allowed=false`（超限）→ `message.error` 或错误 Modal，**不发起创建**；
- `conflicts` 非空 → 弹 `Modal`（标题"引用本体存在命名冲突"）列出分组，`okText="仍然创建"` / `cancelText="返回调整"`；取消则**保留弹窗内的选择状态**（FR US3-场景3）；
- 无冲突且未超限 → 直接创建。

**理由**：spec US3-场景3 明确"用户看到冲突后取消，选择状态保留，可调整后重试"。因此冲突 Modal 是**叠加在新建弹窗之上**的第二层 Modal，不能关闭新建弹窗。

**无障碍**：Modal 由 antd 提供焦点陷阱与 Esc 关闭；冲突列表用 `role="list"` 语义（`ul/li`），不只用颜色区分类型（`Tag` 带文字）。

**后果**：`ConversationManager` 新增 `prechecking` / `conflictResult` 两个状态；创建流程从"一次调用"变成"预检 → （可选确认）→ 创建"。

---

## D12 清空消息与删除对话的语义

**已核事实**：
- `clear_messages`（`services/thread_store.py:214-225`）= `messages=[]` + `pop("context")` + `pop("digest")`，**不动其他键** → 新增的 `ontology_refs` 天然保留，满足 FR-017，**零改动**。
- `delete_thread_dir`（`thread_store.py:112-115`）= 删整个线程目录 → `ontology_refs` 随之消失，满足 FR-018，**零改动**。

**结论**：两项都不需要写代码，只需各加一条集成测试断言（防止未来有人把 `clear_messages` 改成"重置整个 dict"）。

**后果**：测试文件 `test_thread_ontology_refs.py` 覆盖这两条语义。

---

## D13 测试范围与覆盖率门禁登记

**后端**：

| 文件 | 覆盖内容 |
| :-- | :-- |
| `tests/test_ontology_refs.py` | 提取（四类齐全 / 空概念空函数空行为 / 中文名缺失 / 属性无约束 / 继承属性收窄 / 严格不混入关系与流程）；渲染（段落骨架 / 空类目省略 / 中文名缺失不编造）；冲突（同名概念属性一致→无冲突 / 属性类型不同 / 约束不同 / 属性名集合不同 / 跨类目同名 / 多本体三方冲突）；体量（估算值单调、超限判定边界 19999/20000/20001） |
| `tests/test_thread_ontology_refs.py` | 端点：候选列表含 exclude / 不可引用项置灰原因；预检返回 conflicts 与 allowed；创建带引用落盘含 `items`+`prompt_text`+`snapshot_at`；超限 400 且**未创建**（列表条数不变）；引用不存在本体 400/404；`clear` 后 `ontology_refs` 仍在；`delete` 后目录消失；未选引用时 thread JSON **不含** `ontology_refs` 键（SC-005 的可验证形式） |

**前端**：

| 文件 | 覆盖内容 |
| :-- | :-- |
| `conversation-ontology-refs.test.ts` | 选项 label 形如「场景 - 本体」、去重、排除自身、`referenceable=false` 的 disabled 与原因文本、冲突分组标题、快照时间格式化、CR-8 空态文案 |
| `ConversationManager.test.tsx` | 不选/选 1/选 3 均可提交；预检超限阻断；冲突弹窗出现→取消保留选择→再次确认可创建；候选加载失败提示；`aria-label` 可读名称 |
| `OntologyRefTags.test.tsx` | 无引用时返回 `null`（容器为空）；有引用时逐项渲染「场景名 - 本体名」与快照时间；`missingRefIds` 命中时标签变灰且提示文案存在 |
| `ConversationChat.test.tsx`（扩充） | 有引用时子组件挂载；无引用时不渲染任何引用节点 |

> `ConversationChat.tsx` 现状 474 行（已核），加标签组会突破章程 I 的 500 行硬上限，故引用标签组**必须**外置为 `OntologyRefTags.tsx`；父组件仅增一行挂载。

**门禁登记**：`conversation-ontology-refs.ts` MUST 加入 `frontend/vitest.config.ts` 的 `coverage.include`（章程"新增/抽取的核心逻辑模块 MUST 同时补齐单测并纳入覆盖率门禁"）。

**覆盖率豁免登记**（章程 III 治理条款要求"覆盖率未达标的变更 MUST NOT 合并，除非在计划中记录豁免理由与补测期限"）：

| 文件 | 豁免内容 | 理由 | 补测期限 |
| :-- | :-- | :-- | :-- |
| `OntologyRefTags.tsx` | 有单测（T021/T034），**不**纳入 `coverage.include` | 纯展示组件（Tag 列表 + Tooltip + 空态返回 `null`），分支集中在 antd Tooltip 渲染；纳入会以低覆盖拉低全局阈值。章程补充条款要求纳管的对象是"新增/抽取的**核心逻辑模块**"，本组件无自主逻辑（逻辑已在 `conversation-ontology-refs.ts`） | 与存量组件（`ConversationManager` / `ConversationChat`）补测一并评估，见 011 计划记录的存量清单 |

**后果**：无新增测试框架、无新增依赖。
