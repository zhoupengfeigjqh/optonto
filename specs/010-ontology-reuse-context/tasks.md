# 任务清单：新建对话时引用存量本体

**Input**: 设计文档
- `specs/010-ontology-reuse-context/spec.md`（4 个用户故事 P1/P1/P2/P3）
- `specs/010-ontology-reuse-context/plan.md`（技术栈、结构、章程门禁、8 条关键决策）
- `specs/010-ontology-reuse-context/research.md`（D1-D13 决策）
- `specs/010-ontology-reuse-context/data-model.md`（快照模型、V1-V12 不变量、生命周期）
- `specs/010-ontology-reuse-context/contracts/ontology-refs.md`（HTTP / 提示词段落 / 前端模块契约）
- `specs/010-ontology-reuse-context/quickstart.md`（验收脚本与失败判定）

**测试**: 本特性测试为**强制项**（章程 III：测试强制覆盖不可协商），不作为可选项跳过。

**组织方式**: 按用户故事分阶段，每个故事可独立实现与独立验证。

## 格式说明：`[ID] [P?] [Story] 描述`

- **[P]**：可并行执行（**不同文件**、无未完成依赖）。同一文件内的多个任务**不得**标 [P]。
- **[Story]**：所属用户故事（US1 / US2 / US3 / US4）。Setup、Foundational、Polish 阶段不带故事标签。
- 所有描述均含**具体文件路径**。

## 路径约定

后端根为 `core-backend/`，前端根为 `frontend/`，涉及文件：

```text
core-backend/config.py
core-backend/main.py
core-backend/routers/ontology_refs.py
core-backend/routers/threads.py
core-backend/routers/chat.py
core-backend/services/ontology_refs.py
core-backend/services/thread_store.py
core-backend/tests/test_ontology_refs.py
core-backend/tests/test_thread_ontology_refs.py

frontend/src/api/ontology-refs.ts
frontend/src/api/threads.ts
frontend/src/api/client.ts
frontend/src/components/Design/conversation-ontology-refs.ts
frontend/src/components/Design/conversation-ontology-refs.test.ts
frontend/src/components/Design/ConversationManager.tsx
frontend/src/components/Design/ConversationManager.test.tsx
frontend/src/components/Design/OntologyRefTags.tsx
frontend/src/components/Design/OntologyRefTags.test.tsx
frontend/src/components/Design/ConversationChat.tsx
frontend/src/components/Design/ConversationChat.test.tsx
frontend/vitest.config.ts
```

---

## Phase 1: Setup（基线确认）

**目的**：在改动前固定回归基线，避免"改完不知道坏了什么"。

- [ ] T001 执行 `cd core-backend && python -m pytest -q`、`cd frontend && npx vitest run`、`npx eslint src --ext .ts,.tsx`，把测试文件数/用例数与 lint 结果记录到本文件末尾"验收记录"，作为零回归基线
- [ ] T002 [P] 阅读 `core-backend/services/mcp_publish_registry.py`（发布即编译快照的先例）、`core-backend/services/context_compactor.py:63-75`（token 估算）、`core-backend/services/ontology_summary.py:22-39`（`format_constraint`）、`core-backend/services/inheritance.py:98`（`effective_map`），确认复用点，**不改动任何文件**

---

## Phase 2: Foundational（阻塞性前置）

**目的**：抽出后端提取/渲染/冲突/体量的纯函数模块与配置，作为四个用户故事的共同基础。

**⚠️ 关键**：本阶段完成前，任何用户故事都无法开始。

- [ ] T003 在 `core-backend/config.py` 新增 `ONTOLOGY_REF_MAX_TOKENS = _env_int("ONTOLOGY_REF_MAX_TOKENS", 20_000)` 与 `ONTOLOGY_REF_MAX_COUNT = _env_int("ONTOLOGY_REF_MAX_COUNT", 20)`（放在上下文压缩区之后，注释说明口径）
- [ ] T004 新建 `core-backend/services/ontology_refs.py`：定义 `ExtractedItems` / `RefEntry` / `RefConflict` / `SnapshotResult` 结构（`dataclass` 或 `TypedDict`，与 `services/` 既有风格一致），并实现 `extract_ontology_items(data) -> ExtractedItems`：
  - 严格四类：概念（name + title + attributes）/ 函数（name + title）/ 行为（name + title）
  - 概念属性取 `services.inheritance.effective_map` 的**有效属性**（自有 ∪ 继承收窄），**不标注继承来源**
  - `constraint` 文本 MUST 调用 `ontology_summary.format_constraint`，返回 `-` 时**不写该键**
  - `title` 缺失时不写该键（不用英文名填充）
  - 名称中的 `\r` / `\n` 替换为单个空格（其余可见字符原样，不转义）
  - 直接使用 `effective_map` 返回的 `ResolvedAttribute.attribute`：其 `constraint` **已经是** `_apply_restriction` 叠加后的收窄值（`inheritance.py:62-95`），实现时**不得**再次叠加收窄
- [ ] T005 在 `core-backend/services/ontology_refs.py` 实现 `render_prompt_text(entries) -> str` 与常量 `ONTOLOGY_REF_SECTION`（**唯一定义处**，见 `contracts/ontology-refs.md` B.2）：段落以 `\n\n` 开头、以 `=== 存量本体参考结束 ===\n` 结尾；空类目省略小节标题；概念无属性不输出属性行；`entries` 为空返回 `""`
- [ ] T006 在 `core-backend/services/ontology_refs.py` 实现 `detect_conflicts(entries) -> list[RefConflict]`：只检两类（`concept_attribute_mismatch` 按 `(name, type, format_constraint(constraint))` 排序后比对；`cross_category_duplicate` 取三类名称集合交集），差异文案按 `contracts` A.2 的 `differences` 口径生成
- [ ] T007 在 `core-backend/services/ontology_refs.py` 实现 `build_snapshot(inputs, *, max_tokens, max_count) -> SnapshotResult`：解析身份四元组（`services.ontology_registry` / `load_ontology_data`）→ 去重 → 数量校验 → 提取 → 渲染 → `estimate_tokens(prompt_text)` → 体量校验；返回 `allowed` / `token_estimate` / `conflicts` / `refs` / `reason`。**纯计算，不落盘**
- [ ] T008 新建 `core-backend/routers/ontology_refs.py`：`GET /api/ontology-refs/candidates`（复用 `ontology_registry.list_all_ontologies()` + `services.load_ontology_data`，实现 exclude 与 `referenceable` / `skip_reason`）与 `POST /api/ontology-refs/precheck`（调 `build_snapshot`，不落盘）；只调 services，**不 import repositories**
- [ ] T009 在 `core-backend/main.py` 的 `include_router` 区（L53-72）注册新 router，并按既有惯例 import
- [ ] T010 新建 `core-backend/tests/test_ontology_refs.py` 覆盖纯函数：四类提取齐全 / 空概念空函数空行为 / 中文名缺失 / 属性无约束省略 / 继承属性收窄 / **严格不混入关系·流程·规则·安全·数据引擎** / 渲染骨架与空类目省略 / 名称含换行 / 冲突两类（含三方）/ 属性一致时不误报 / 体量边界（19999/20000/20001）

**检查点**：`python -m pytest -q tests/test_ontology_refs.py` 全绿；`POST /api/ontology-refs/precheck` 手工 curl 可用。

---

## Phase 3: User Story 1 - 新建对话时选择要复用的存量本体 (P1) 🎯 MVP

**目标**：新建弹窗出现「引用存量本体」多选；不选/选 1/选 3 都能创建；创建后对话页能看到引用清单与快照时间。

**独立验证**：仅实现本阶段即可交付——选 0 个与改动前完全一致；选 3 个后对话页 Header 出现 3 个标签 + 快照时间。

### 实现

- [ ] T011 [US1] 修改 `core-backend/services/thread_store.py::create_thread`：新增 `ontology_refs: Optional[dict]` 参数；非空时写入 thread 顶层 `ontology_refs`，**为空/None 时不写该键**（data-model V1）；`list_threads` 白名单**保持不变**
- [ ] T012 [US1] 修改 `core-backend/routers/threads.py::create_thread`：解析 `body.get("ontology_refs")`，非空时调 `services.ontology_refs.build_snapshot` 校验并生成快照，失败抛 `InvalidInputError` / `NotFoundError`；成功把快照传给 `thread_store.create_thread`
- [ ] T013 [P] [US1] 新建 `frontend/src/api/ontology-refs.ts`：`OntologyRefCandidate` / `RefConflict` / `PrecheckResult` / `OntologyRefInput` 类型 + `listOntologyRefCandidates` / `precheckOntologyRefs`（走既有 `request` 底座，不新增硬编码后端常量）
- [ ] T014 [US1] 修改 `frontend/src/api/threads.ts`：新增 `OntologyRefSnapshot` / `OntologyRefEntry` 等类型，`Thread` 增 `ontology_refs?`，`createThread` 增第 5 参 `ontology_refs?`（**省略时请求体不带该键**）
- [ ] T015 [US1] 修改 `frontend/src/api/client.ts`：再导出 `ontology-refs.ts`
- [ ] T016 [P] [US1] 新建 `frontend/src/components/Design/conversation-ontology-refs.ts`：`refKeyOf` / `parseRefKey`（value 用 `\u0000` 分隔、名称中的 `\u0000` 先替换为空格）/ `toSelectOptions`（label「场景 - 本体」、排除自身、`disabled` + `reason`，并**携带** `description` / `counts` / `deployed_version` 供 `optionRender` 渲染第二行）/ `toRefInputs` / `formatSnapshotTime` / `missingRefIds`（按 `scenario_id` + `ontology_id` 组合判定）/ 空态与失败文案常量（纯函数，无 React 依赖）
- [ ] T017 [US1] 修改 `frontend/src/components/Design/ConversationManager.tsx`：打开新建弹窗时加载候选（`useEffect` 依赖 `showVersionModal`）、版本号 `Input` 之后加 `Select mode="multiple"`（`aria-label="引用存量本体"`；`optionRender` 两行渲染：第一行「场景 - 本体」，第二行描述 + 条目数 + 已部署版本，`referenceable=false` 时第二行换成 `skip_reason` 且整项禁用；选项区显示「已选 {n} / {max_count}」，达上限时 `onChange` 截断并 `message.warning`）、提交时把选中值转 `OntologyRefInput[]` 传给 `createThread`；候选加载失败给 `message.error` 且**不阻断**填写版本号创建
- [ ] T018 [P] [US1] 新建 `frontend/src/components/Design/conversation-ontology-refs.test.ts`：选项 label / 去重 / 排除自身 / 置灰与原因 / **选项携带 `description` / `counts` / `deployed_version`** / `refKeyOf` 与 `parseRefKey` 互逆（含名称带 `/`、空格与 `\u0000` 的用例）/ `missingRefIds` 四元组匹配 / 时间格式化 / 空态文案
- [ ] T019 [US1] 新建 `frontend/src/components/Design/ConversationManager.test.tsx`：mock `@/api/client` 与 `@/api/ontology-refs`；覆盖不选/选 1/选 3 均可提交、提交时 `createThread` 第 5 参形状正确、不选时**不带**该键、候选失败仍可创建、`aria-label` 可读名称
- [ ] T020 [US1] 新建 `frontend/src/components/Design/OntologyRefTags.tsx`（子组件，< 80 行）并在 `ConversationChat.tsx` Header 的 `title` 之后挂载**一行**：每个引用一个 `Tag`（「场景 - 本体」）+「快照 {时间}」`Tooltip`（Tooltip 内展示 `token_estimate` / `max_tokens`）；`ontology_refs` 不存在时返回 `null`
- [ ] T021 [P] [US1] 新建 `frontend/src/components/Design/OntologyRefTags.test.tsx`：无引用时容器为空、有引用时逐项渲染、快照时间格式正确、Tooltip 内含该本体条目数与 `token_estimate` / `max_tokens`
- [ ] T022 [US1] 新建 `core-backend/tests/test_thread_ontology_refs.py`，覆盖**三个端点**：① `GET /api/ontology-refs/candidates` —— `exclude_scenario`+`exclude_ontology` 生效、空本体 `referenceable=false` 且 `skip_reason` 为「暂无可提取内容」、排序沿用 `updated_at` 降序、单个本体 YAML 解析失败时**跳过该本体而不使整端点失败**；② `POST /api/threads` —— 带 1 个/3 个引用成功且落盘含 `items`+`prompt_text`+`snapshot_at`+`token_estimate`、不带引用时 thread JSON **无** `ontology_refs` 键（V1）、重复引用去重（V3）；③ `GET /api/threads/{id}` 回传完整快照、`GET /api/threads` **不**回传该字段
- [ ] T023 [US1] 在 `frontend/vitest.config.ts` 的 `coverage.include` 登记 `src/components/Design/conversation-ontology-refs.ts`

**检查点**：`pytest tests/test_thread_ontology_refs.py` 与 `npx vitest run src/components/Design/{ConversationManager,OntologyRefTags,conversation-ontology-refs}.test.*` 全绿；手工按 `quickstart.md` 场景 A 验证通过。

---

## Phase 4: User Story 2 - 对话时模型遵守命名唯一与属性对齐 (P1)

**目标**：引用后每轮系统提示词追加「存量本体参考」段；未引用时段落不出现且提示词逐字节不变。

**独立验证**：引用 1 个本体后发一条消息，`_build_system_message` 输出含段且位置在业务基线之后、历史摘要之前；不引用时与改动前哈希一致。

### 实现

- [ ] T024 [US2] 修改 `core-backend/routers/chat.py::_build_system_message`：新增 `ontology_refs_text: str = ""` 参数，在业务基线与 `_SUMMARY_SECTION` **之间**追加；为空时**不追加**
- [ ] T025 [US2] 修改 `core-backend/routers/chat.py::_langchain_stream` 与其调用方 `generate()`：从 **thread 顶层** `data.get("ontology_refs")` 取 `prompt_text` 并透传（不得从 messages 派生，参照 `business_info` 的既有告警注释）
- [ ] T026 [P] [US2] 扩充 `core-backend/tests/test_ontology_refs.py`：段落骨架逐行断言（含 5 条约束原文）、空类目省略、无约束属性省略、名称含 `===` 时不破坏段落边界
- [ ] T027 [US2] 扩充 `core-backend/tests/test_thread_ontology_refs.py`：`_build_system_message(bi, False, summary)` 三参调用返回值与改动前**逐字节相同**（SC-005）；四参带引用时段落出现在业务基线之后、摘要之前

**检查点**：手工按 `quickstart.md` 场景 B（提示词逐项核对）、场景 C（模型遵守命名约定）验证通过。

---

## Phase 5: User Story 3 - 已存在的命名冲突在创建前就暴露 (P2)

**目标**：勾选有冲突的本体时，创建前弹出冲突清单；取消后保留选择；超限时阻断且提示可操作。

**独立验证**：勾选两个属性不同的同名概念本体，点确认 → 出冲突弹窗；点取消 → 新建弹窗仍在、选择保留。

### 实现

- [ ] T028 [US3] 修改 `core-backend/routers/threads.py::create_thread`：增加"不得引用当前对话所属本体自身"的校验（`400`，契约 A.3 表第 4 行）
- [ ] T029 [US3] 修改 `frontend/src/components/Design/ConversationManager.tsx`：`handleConfirmNew` 改为「预检 → 分支」：进入时置 `prechecking`（确认按钮 `loading` + 文案「正在检查引用冲突…」，禁用取消与重复提交，**不得静默等待**）；`allowed=false` 时 `message.error(reason)` 并保持弹窗；`conflicts` 非空时打开冲突 `Modal`（`okText="仍然创建"` / `cancelText="返回调整"`，取消**不关闭**新建弹窗、不丢选择）；`allowed=true` 时在弹窗底部显示「预计注入约 {token_estimate} tokens（上限 {max_tokens}）」；否则直接创建
- [ ] T030 [P] [US3] 扩充 `frontend/src/components/Design/conversation-ontology-refs.test.ts`：`groupConflicts` 两类分组标题、`conflictKindLabel` 文案、`differences` 为空时不渲染空行
- [ ] T031 [US3] 扩充 `frontend/src/components/Design/ConversationManager.test.tsx`：超限阻断（`createThread` 未被调用）、冲突弹窗出现→取消保留选择→再次确认可创建、预检失败时**不**自动创建、**预检期间确认按钮为 `loading` 且重复点击不发起第二个请求**（章程 IV 三态）、预检通过时显示体量提示文案、选中数达 `max_count` 时被截断并提示
- [ ] T032 [US3] 扩充 `core-backend/tests/test_thread_ontology_refs.py`：`precheck` 本体不存在 404、`refs` 非数组 400、超限 `allowed=false` 且 `reason` 含实际值与上限、绕过前端直接 `POST /api/threads` 超限 → 400 且 `.data/threads/demand/` **无新增目录**（V7）、引用自身 400；**创建端点畸形入参**（`ontology_refs` 为字符串 / 元素非对象 / 元素缺 `scenario_name`）→ 400

**检查点**：手工按 `quickstart.md` 场景 D、E 验证通过。

---

## Phase 6: User Story 4 - 引用结果可追溯，不因原本体变动而漂移 (P3)

**目标**：源本体被改/被删后，对话的引用内容与提示词不变；页面标注"原本体已不存在"；清空消息不清引用。

**独立验证**：创建引用后改源本体属性并删源本体，重进对话 → 清单、快照时间、`prompt_text` 均不变，标签变灰。

### 实现

- [ ] T033 [US4] 修改 `frontend/src/components/Design/OntologyRefTags.tsx`：接收当前候选的 `{scenario_id}/{ontology_id}` key 集合，`missingRefIds` 命中的标签变灰并附「原本体已不存在」提示（`Tooltip`，不发起该本体的详情请求）
- [ ] T034 [P] [US4] 扩充 `frontend/src/components/Design/OntologyRefTags.test.tsx`：缺失态灰显 + 提示文案；正常态不带提示；**跨场景同 `ontology_id` 的不同本体不得被误判为缺失**（验证四元组匹配）
- [ ] T035 [US4] 扩充 `core-backend/tests/test_thread_ontology_refs.py`：改动源本体后 `GET /api/threads/{id}` 的 `prompt_text` 与 `snapshot_at` 逐字节不变（V10）；删除源本体后 thread 仍 200（V11）；`POST /{id}/clear` 后 `ontology_refs` 仍在（V8）；`DELETE /{id}` 后目录不存在（V9）；未引用本体时 `prompt_text` 为 `""`

**检查点**：手工按 `quickstart.md` 场景 F、G 验证通过。

---

## Phase 7: 收尾与横切关注点

- [ ] T036 全量回归：`cd core-backend && python -m pytest -q` 与 `cd frontend && npx vitest run`、`npx eslint src --ext .ts,.tsx`，结果写入本文件验收记录
- [ ] T037 覆盖率核对：`cd frontend && npx vitest run --coverage`，确认 `conversation-ontology-refs.ts` ≥80% 且不影响既有阈值
- [ ] T038 性能实测（章程 V）：三项 P95（candidates / precheck / 创建带 3 个引用）按 plan 口径测量并记录到验收记录
- [ ] T039 按 `specs/010-ontology-reuse-context/quickstart.md` 完成场景 A-H 手工验收，结果填入验收记录；**SC-001 端到端耗时单独记录**（点击确认 → 进入对话界面的秒表读数，要求 ≤3 秒）；**SC-002 至少抽 5 段引用对话**核对提示词（不足 5 段则记录实际段数并说明）
- [ ] T040 若实现过程中调整了任何口径（提示词文案、冲突判定、上限值），回写 `spec.md` 修订记录与 `contracts/ontology-refs.md`；未变化则注明"无变更"

---

## Dependencies（故事完成顺序）

```
Phase 1 (T001-T002)
        ↓
Phase 2 (T003-T010)   ← 纯函数 + 候选/预检端点，阻塞全部故事
        ↓
        ├── Phase 3 / US1 (T011-T023)  ← MVP：多选 + 创建 + 清单展示
        │        ↓
        ├── Phase 4 / US2 (T024-T027)  ← 依赖 US1 的落盘字段
        │        ↓
        ├── Phase 5 / US3 (T028-T032)  ← 依赖 US1 的创建链路 + US2 的提示词段
        │        ↓
        └── Phase 6 / US4 (T033-T035)  ← 依赖 US1 的快照与清单
                 ↓
           Phase 7 (T036-T040)
```

- US1 可在 Phase 2 后立即开始，不依赖 US2/US3/US4。
- **US2 必须早于 US3 完成**：US3 的冲突清单与 US2 的提示词段落共用同一份提取结果，先落地注入才能验证"冲突提示与提示词一致"。
- US4 只读 US1 落盘的快照，不阻塞 US3。

---

## Parallel Example: US1

```bash
# 以下两项是不同文件，可并行：
Task: "新建 frontend/src/api/ontology-refs.ts（类型 + 2 个调用）"                        # T013
Task: "新建 frontend/src/components/Design/conversation-ontology-refs.ts（纯函数）"     # T016

# 但 T014 / T015（api/threads.ts、client.ts）与 T013 需串行：同属契约层，后者再导出前者
```

```bash
# 后端纯函数（T004-T007 同文件）MUST 串行；
# T010（测试文件）可与 T008（router 文件）并行——不同文件。
```

---

## Implementation Strategy

### MVP 优先（仅 US1）

1. Phase 1 + Phase 2（纯函数模块与两个只读端点）
2. Phase 3（多选 + 创建落盘 + 清单展示）
3. **停下来验证**：`quickstart.md` 场景 A，确认不选引用时零回归
4. 可交付演示——此时快照已生效，只是模型是否遵守尚未验证

### 增量交付

1. Setup + Foundational → 基础就绪
2. US1 → 独立验证 → 交付（MVP）
3. US2 → 独立验证（场景 B、C）→ 交付（核心价值达成）
4. US3 → 独立验证（场景 D、E）→ 交付
5. US4 → 独立验证（场景 F、G）→ 交付
6. Phase 7 全量回归、性能实测与验收记录

### 多人的并行策略

- Phase 2 完成后：A 做 US1 前端（T013-T019、T021），B 做 US1 后端（T011-T012、T022）
- US2 只有后端（`chat.py` + 测试），可与 US1 前后端并行，但**必须在 US3 之前**合入
- US3 改 `ConversationManager.tsx`，与 US1 的 T017 同文件 → 必须等 T017 完成
- US4 改 `OntologyRefTags.tsx`，与 US1 的 T020 同文件 → 必须等 T020 完成

---

## 验收记录

> 执行完成后填写，供 `/speckit.implement` 后的核对使用。

| 项 | 结果 |
| :-- | :-- |
| 基线（T001） | 待填：后端 `pytest` 通过数；前端 文件数 / 用例数；eslint error / warning 数 |
| 纯函数测试（T010 / T026） | 待填 |
| 端点测试（T022 / T027 / T032 / T035） | 待填 |
| 全量回归（T036） | 待填 |
| 覆盖率（T037） | 待填：`conversation-ontology-refs.ts` 四维；全局四维 |
| 性能实测（T038） | 待填：candidates P95 / precheck P95 / 创建 P95（各 20 次） |
| 手工验收（T039） | 待填：场景 A-H 逐项结论 |
| SC-001 端到端耗时 | 待填：点击确认 → 进入对话界面的秒表读数（要求 ≤3 秒） |
| 规格回写（T040） | 待填：变更项或"无变更" |

### 实现备注

1. **`ConversationChat.test.tsx` 已存在**（5.5KB）：Phase 3 的 T020 只做"插入一行子组件"，其断言放在新建的 `OntologyRefTags.test.tsx`（T021），避免把一个职责拆到两个测试文件。
2. **不新增调试端点**：核对系统提示词用 `python -c` 直接调 `_build_system_message` 或读 thread JSON（见 quickstart 场景 B/H），不为验证而加"返回 prompt"的端点（章程 VI 禁止无消费者的死键）。
3. **`list_threads` 白名单刻意不增字段**：列表 UI 不展示引用，避免每次列表响应携带整段 `prompt_text`；详情端点才回传完整快照（契约 A.4）。

---

## Notes

- [P] 仅用于**不同文件**的任务；同文件任务一律串行，避免覆盖冲突。
- 每个任务都要能独立完成并验证，不留"以后补"的隐性依赖。
- **测试节奏**：本特性采用"实现即补测"（与 011 的既有实践一致），不强制红-绿流程；但纯函数（T004-T007）的测试 MUST 在进入下一 Phase 前变绿，端点的测试 MUST 在对应故事标记完成前变绿。
- 禁止在 `routers/` 里重复实现提取/渲染/冲突逻辑——唯一实现在 `services/ontology_refs.py`。
- 禁止在 `ConversationManager.tsx` 里重复实现选项拼装/分组文案——唯一实现在 `conversation-ontology-refs.ts`。
- 前后端契约改动 MUST 先改 `contracts/ontology-refs.md`，再同步两侧（章程 VI）。
- 单文件 500 行硬上限：`ConversationChat.tsx` 当前 474 行，新增逻辑 MUST 落在 `OntologyRefTags.tsx`，不得直接写进父组件。
