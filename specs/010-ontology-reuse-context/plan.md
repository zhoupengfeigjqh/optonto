# 实施方案：新建对话时引用存量本体

**Branch**: `010-ontology-reuse-context`（仓库未启用 `before_specify` hook，未自动创建分支） | **Date**: 2026-11-20 | **Spec**: [spec.md](./spec.md)

**Input**: 功能规格 `specs/010-ontology-reuse-context/spec.md`

## Summary

在「需求对话」的新建弹窗（`ConversationManager`，即当前填版本号的那个）里，于版本号之外增加「引用存量本体」多选：可 0 个、1 个或多个，跨场景可选，当前对话所属本体自身排除。

选中后，**创建对话时**后端把每个被引用本体的四类命名信息（概念名+中文名 / 概念属性名+中文名+类型+完整约束 / 函数名+中文名 / 行为名+中文名）抽取成**快照**，与 thread 一起落盘（`.data/threads/demand/{id}/.data.json` 顶层新增 `ontology_refs`）。此后每轮对话把该快照作为系统提示词的**第 5 段**追加，与既有四段（主体、拷问模式、业务基线、历史摘要）共存互不覆盖；未选任何本体时不追加，系统提示词逐字节不变。

创建前提供一次**预检**：返回冲突清单（同名概念属性不一致 / 跨类目同名）与提取体量（token 估算）。有冲突必须用户确认后才能创建；体量超限（20,000 tokens）**阻止创建**并给出可操作提示，不静默截断。

**技术路线**：core-backend 新增一个**纯函数**提取/渲染/冲突/体量模块 `services/ontology_refs.py`（无 I/O，可穷举单测）+ 一个新 router `routers/ontology_refs.py`（两个只读端点）；`services/thread_store.py` 增加字段与列表视图白名单；`routers/chat.py::_build_system_message` 增加一段。前端 `ConversationManager` 加多选与冲突确认弹窗、`ConversationChat` 头部展示引用清单与快照时间，并把选项/分组/文案等纯逻辑抽到 `conversation-ontology-refs.ts`。

**零数据库迁移**：本项目 thread 与本体均为文件存储（`.data/threads/demand/*/.data.json`、`.data/onto_market/{场景}/{本体}/ontology.yaml`），全仓无 SQLAlchemy / 无 Alembic（已核）。

## Technical Context

**Language/Version**: Python 3（`core-backend/`，FastAPI + Pydantic v2）；TypeScript 5.9（`frontend/`，Next.js 14.2 App Router + React 18.3）

**Primary Dependencies**: FastAPI、`langchain_core.messages`（`SystemMessage`）、antd 5.29（`Select` / `Modal` / `Tag` / `Tooltip`）。**不新增任何依赖**

**Storage**: 文件存储，无数据库。
- thread：`.data/threads/demand/{thread_id}/.data.json`（既有 `thread_store` 为唯一读写出口）
- 本体：`.data/onto_market/{scenario}/{ontology}/ontology.yaml`（身份四元组以 `ontology.yaml.metadata` 为唯一来源）
- 本特性在 thread JSON 顶层新增 `ontology_refs`，**不新增文件、不新增目录**

**Testing**:
- 后端：`core-backend/tests/test_ontology_refs.py`（纯函数：提取/渲染/冲突/体量）+ `core-backend/tests/test_thread_ontology_refs.py`（端点集成：创建/预检/超限/清空/删除）。沿用仓内 `unittest` 风格，`python -m pytest -q` 可跑
- 前端：`conversation-ontology-refs.test.ts`（纯函数）+ `ConversationManager.test.tsx`（新）+ `ConversationChat.test.tsx`（扩充既有文件）；Vitest 3 + jsdom

**Target Platform**: Linux 容器（`optonto-core-backend`，宿主端口 8001）+ 本地 Windows 开发；前端经 Nginx（`:81`）代理 `/api`

**Project Type**: Web 应用（FastAPI 后端 + Next.js 前端），本特性**两侧同改**

**Performance Goals**（章程 V：接口 P95 < 200ms，不含 LLM）
- `GET /api/ontology-refs/candidates`：全场景本体清单 + 逐个统计四类条目数，**P95 < 200ms**。
- `POST /api/ontology-refs/precheck`：≤ 20 个本体时 P95 < 200ms。
- `POST /api/threads`（带引用）：在原有落盘之外增加一次提取 + 渲染，P95 < 200ms。
- **测量口径**：以 `core-backend` 宿主机本机进程 + 3 个中等规模本体（各 10~30 概念）为基准，用 `time.perf_counter()` 包住 service 调用循环 20 次取 P95，结果记入 `tasks.md` 验收记录。在宿主机而非容器内测量，只为排除容器资源配额带来的噪声，不涉及任何章程条款的豁免。
- 依据：`load_ontology_data` 已有 mtime 缓存，重复调用不重复解析 YAML；候选端点对同一本体只解析一次。

**Constraints**:
- 提取**严格四类**（FR-006）：概念、概念属性、函数、行为。不得混入概念关系、对象关系、规则、流程、安全管控、数据引擎
- 注入上限 **20,000 tokens**（FR-015），新增配置项 `ONTOLOGY_REF_MAX_TOKENS`，可环境变量覆盖；超限**阻止创建**，不截断。**"超限"以估算口径为准**：判定与注入体量共用同一个 `estimate_tokens`（`context_compactor.py:63-75`，中文 1 字≈1 token、其余 4 字符≈1 token），不存在第二套度量，故 SC-006 的"100%"是对该口径的 100%
- 未选本体时系统提示词**逐字节不变**（SC-005）
- 引用是**创建时快照**，后续不重复读源本体（FR-016）；`clear_messages` 不得清除（FR-017）；删除对话随目录删除（FR-018）
- 只改 `core-backend` 与 `frontend`。**不碰** `agent-backend` 的 `ontology_scope`（那是智能体对话的本体范围，另一套体系，语义不同）
- 接口层不得直连 `repositories` 或存储原语（章程 II）：新 router 只调 `services.ontology_refs` / `services.ontology_registry` / `services.load_ontology_data` / `services.thread_store`

**Scale/Scope**: 单场景/跨场景本体总量按百个设计；单次引用**建议上限 20 个**（超出提示分批；见 research D9）；提取体量 ≤20K tokens。改动规模：后端新增 4 个文件（`services/ontology_refs.py`、`routers/ontology_refs.py`、2 个测试）、改 5 个（`routers/threads.py`、`routers/chat.py`、`routers/main.py`、`services/thread_store.py`、`config.py`）；前端新增 6 个（2 个契约/纯模块 + 1 个子组件 + 3 个测试）、改 6 个（`api/threads.ts`、`api/client.ts`、`ConversationManager.tsx`、`ConversationChat.tsx`、`ConversationChat.test.tsx`、`vitest.config.ts`）

## Constitution Check

*GATE: 设计前通过，设计后复检（见文末）。*

> 依据 `.specify/memory/constitution.md` **v1.2.0**（六条核心原则 + 技术治理与依赖管控 + 开发工作流与质量门禁）。本节按该文件实际章节组织，不沿用其它编号体系。

| 原则 / 章节 | 检查结论 | 依据 / 落地方式 |
| :-- | :-- | :-- |
| I. 前端组件化与代码质量 | 通过 | 选项推导/分组/冲突文案/时间格式化抽到 `conversation-ontology-refs.ts`（纯函数，无 React 依赖），组件只留状态与渲染；`ConversationManager.tsx` 现 183 行、改后预计 < 330 行（< 500）；**`ConversationChat.tsx` 现 474 行，已贴 500 行硬上限**，故引用标签组 MUST 外置为子组件 `OntologyRefTags.tsx`（< 80 行），父组件只插入一行；props/状态显式类型，不引入 `any` 逃逸（既有 `catch (e: any)` 沿用不改）；渲染路径无昂贵计算，候选列表 `useMemo` 派生 |
| II. 后端分层架构与代码质量 | 通过 | 新增 `services/ontology_refs.py`（领域逻辑，无 I/O、无 fastapi 依赖）+ `routers/ontology_refs.py`（只做参数接收与响应组装）。提取所用数据经 `services.load_ontology_data`（业务层公开函数）取得，**不 import repositories / 不拼路径**；不复用他模块下划线私有符号（`chat.py::_build_system_message` 是既有私有函数，由 `chat.py` 自身调用，不跨模块引用）；新文件均 < 500 行 |
| III. 测试强制覆盖（不可协商） | 通过（需执行） | 每个新端点有集成测试（**candidates / precheck / 创建带引用三端点**，清空与删除复用既有端点由 V8/V9 断言兜住，见 T022/T032/T035）；纯函数单测覆盖提取、渲染、冲突、体量四组边界；前端新纯模块登记进 `vitest.config.ts` 的 coverage `include` 并达 80%；`ConversationManager` / `OntologyRefTags` 均有单测；测试全部在宿主机跑。**两项显式登记**：① `OntologyRefTags.tsx` 不纳入 coverage include（豁免理由见 research D13）；② SC-003 / SC-004 依赖真实模型输出，章程禁止对 LLM 断言，**只由 quickstart 场景 C 人工验收**，不作自动化门禁 |
| IV. 无障碍与交互体验 | 通过（需执行） | 多选沿用 antd `Select mode="multiple"`（原生键盘可达）+ `aria-label="引用存量本体"`；冲突清单用 `Modal`（Esc 关闭、焦点可见、按钮可达）；置灰项通过 antd `disabled` + 可读原因（`optionRender` 文本），不做纯颜色区分；异步三态：候选加载 `Spin`/失败 `message.error` + 重试、创建 `creating` 遮罩（既有）、预检失败 `message.error` |
| V. 性能标准 | 通过（需测量） | 见 Technical Context 的性能目标与测量口径；候选端点**禁止 N+1**：一次 `list_all_ontologies()` + 逐本体一次 `load_ontology_data`（命中 mtime 缓存），不做"每个概念一次 IO"；渲染在创建时一次完成并落盘，每轮对话只做字符串拼接（无 IO、无解析） |
| VI. 数据一致性与接口契约 | 通过 | 单次创建是"读源本体 → 生成快照 → 落盘"的一次写；`save_thread` 为整文件 JSON 覆盖写（既有语义），快照与 thread 同时写入，不存在半提交；重复创建不幂等无害（每次新 id）故不加幂等键，但**重复引用同一本体去重**（Edge Case）；错误一律用 `errors.DomainError` 子类（`InvalidInputError` / `NotFoundError`），由全局处理器映射为 `{code, message, detail}`，接口层不新增 `HTTPException`；新增字段两侧同改（前端 `Thread` / `ThreadSummary` 类型 + `contracts/ontology-refs.md`）；不写"写而不读"字段——`items` 供前端清单与审计、`prompt_text` 供提示词、`token_estimate` 供体量展示与超限判定，三者均有消费者 |
| 技术治理：依赖管控 | 通过 | **零新增依赖**：token 估算复用既有 `context_compactor.estimate_tokens`（本地启发式，明确不引 tiktoken）；约束格式化复用 `ontology_summary.format_constraint`；不引 lodash/semver |
| 技术治理：跨服务契约单点收口 | 通过 | 提示词段落模板只在 `services/ontology_refs.py` 一处定义（`ONTOLOGY_REF_SECTION` 常量），`chat.py` 只拼接返回值；前端不复制拒绝规则，只展示后端返回的 `conflicts` / `allowed` |
| 开发工作流：中文文档与门禁 | 通过 | 本 plan、research、data-model、contracts、quickstart 全中文；门禁仍为单命令（`python -m pytest -q`、`npx vitest run`、`npx eslint`）；无新增部署步骤与环境变量（`ONTOLOGY_REF_MAX_TOKENS` 有默认值） |

**平台差异风险声明**：本特性涉及文件路径（场景/本体目录名）与时间格式化（快照时间）。Windows 与 Linux 的路径分隔符不影响逻辑（统一用 `pathlib` / 既有 `fs_store`）；快照时间统一存 UTC ISO8601，前端按本地时区展示（与既有 `created_at` 一致）。**无新增平台差异风险**。

**性能敏感变更登记**（章程 V）：见上文三项 P95 与测量口径，实测值须写入 `tasks.md` 验收记录。

## Project Structure

### Documentation (this feature)

```text
specs/010-ontology-reuse-context/
├── spec.md                        # 已完成
├── plan.md                        # 本文件
├── research.md                    # Phase 0（13 项决策）
├── data-model.md                  # Phase 1（快照模型、不变量、状态流转）
├── contracts/
│   └── ontology-refs.md           # Phase 1（HTTP 契约 / 提示词段落契约 / 前端模块契约）
├── quickstart.md                  # Phase 1
├── checklists/
│   └── requirements.md            # 已完成
└── tasks.md                       # 由 /speckit.tasks 生成
```

### Source Code (repository root)

```text
core-backend/
├── routers/
│   ├── ontology_refs.py                 # 新增：GET /api/ontology-refs/candidates、POST /api/ontology-refs/precheck
│   ├── threads.py                       # 修改：POST /api/threads 透传 ontology_refs（body 解析）
│   ├── chat.py                          # 修改：_build_system_message 增加第 5 段；chat 时从 thread 顶层取快照
│   └── main.py                          # 修改：注册新 router（集中 include_router 区，main.py:53-72）
├── services/
│   ├── ontology_refs.py                 # 新增：提取 / 渲染 / 冲突检测 / 体量估算（纯函数，唯一实现）
│   ├── thread_store.py                  # 修改：create_thread 增字段；list_threads 白名单**保持不变**（列表不回传引用）
│   └── ontology_registry.py             # 只读调用，不改
├── config.py                            # 修改：ONTOLOGY_REF_MAX_TOKENS / ONTOLOGY_REF_MAX_COUNT
└── tests/
    ├── test_ontology_refs.py            # 新增：纯函数单测
    └── test_thread_ontology_refs.py     # 新增：端点集成测试

frontend/
├── src/
│   ├── api/
│   │   ├── ontology-refs.ts             # 新增：candidates / precheck 两个调用 + 类型
│   │   ├── threads.ts                   # 修改：createThread 增 refs 入参；Thread 增 ontology_refs 字段（ThreadSummary 不变）
│   │   └── client.ts                    # 修改：再导出新模块
│   └── components/Design/
│       ├── conversation-ontology-refs.ts       # 新增：选项构建/分组/冲突文案/时间格式化（纯函数）
│       ├── conversation-ontology-refs.test.ts  # 新增：纯函数单测
│       ├── ConversationManager.tsx             # 修改：多选 + 预检 + 冲突确认 + 超限提示（183 行 → 预计 < 330）
│       ├── ConversationManager.test.tsx        # 新增：组件交互与无障碍
│       ├── OntologyRefTags.tsx                 # 新增：Header 引用标签组（子组件，含"原本体已不存在"态）
│       ├── OntologyRefTags.test.tsx            # 新增：子组件单测（空/有引用/缺失态/键盘可读）
│       ├── ConversationChat.tsx                # 修改：Header 插入一行 <OntologyRefTags/>（474 行 → 约 478）
│       └── ConversationChat.test.tsx           # 修改：补断言（有引用时挂载、无引用时不渲染）
└── vitest.config.ts                     # 修改：coverage include 登记 conversation-ontology-refs.ts
```

**Structure Decision**: 沿用既有分层与目录约定，不新建平行树。后端新增能力落在 `services/`（领域）+ `routers/`（传输）两层，与 `mcp_publish_registry`（发布即编译快照）的既有模式同构；前端沿用 `api/`（契约）+ `components/Design`（UI 同目录纯模块）的既有约定（与 `requirement-version-filter.ts`、`behavior-op-type.ts` 一致）。

## 关键设计决策（详见 research.md）

1. **落点是「需求对话」而非「智能体对话」**：只有需求对话有"输入版本"这一步（`ConversationManager` → `POST /api/threads`）。`agent-backend` 的 `ontology_scope` 是智能体运行时的本体范围，不做提示词注入，二者语义不同，本特性不合并。
2. **快照双存**：`items`（结构化，供 UI 清单 + 审计 + SC-002 核对）+ `prompt_text`（渲染结果，直接拼进 system prompt）+ `token_estimate` + `snapshot_at`。渲染只做一次，避免"每轮重渲染导致提示词随代码演进漂移"，从而严格满足 FR-016 / SC-007。
3. **创建时重算，不信前端预检结果**：预检端点只用于交互提示；创建端点拿到 `[{scenario_name, ontology_name}]` 后**重新提取**并校验体量，避免 TOCTOU 与绕过。
4. **提取用「有效属性」口径**：概念属性取 `services.inheritance.effective_map` 的结果（自有 ∪ 继承后的收窄约束），与 `ontology_summary.build` 同口径，避免"继承表达 vs 自有表达"的误判；输出不标"继承自"，保持四类纯粹（见 research D4）。
5. **约束格式化复用既有唯一实现** `ontology_summary.format_constraint`，但按 FR-008 适配：约束文本为 `-` 时不输出"约束="片段。
6. **新端点独立前缀 `/api/ontology-refs`**，不扩展 `GET /api/ontologies`：后者被智能体对话的本体范围选择器消费，加"可引用性"统计会让每次列表都解析全部 YAML，属无谓放大；独立端点可按需带 exclude 参数与统计。
7. **提示词段落位置**：插在业务基线之后、历史摘要之前。摘要必须留在 system 末尾以最大化前缀缓存命中（`chat.py:32` 既有注释），引用段是稳定前缀，放摘要前不破坏缓存策略。
8. **上限 20,000 tokens** 落为配置项 `ONTOLOGY_REF_MAX_TOKENS`（默认 20000，环境变量可覆盖），与既有 `CONTEXT_SINGLE_MSG_MAX_TOKENS` 同量级，回写 spec Assumptions。

## Phase 执行结果

- Phase 0 → [research.md](./research.md)（13 项决策 D1-D13，无 NEEDS CLARIFICATION 遗留）
- Phase 1 → [data-model.md](./data-model.md)、[contracts/ontology-refs.md](./contracts/ontology-refs.md)、[quickstart.md](./quickstart.md)

## Constitution Check（设计后复检）

| 原则 / 章节 | 复检结论 |
| :-- | :-- |
| I 前端 | 通过：纯逻辑外置到 `conversation-ontology-refs.ts`；`ConversationManager` < 330 行；`ConversationChat` 474 → 约 478 行（引用标签组外置到 `OntologyRefTags.tsx`，< 80 行）；无渲染路径排序 |
| II 后端分层 | 通过：`routers/ontology_refs.py` 只调 services；`services/ontology_refs.py` 不 import fastapi / repositories；无跨模块私有符号引用 |
| III 测试 | 通过（待实现执行）：2 个后端测试文件 + 2 个前端测试文件已指定；新纯模块登记 include |
| IV 无障碍 | 通过（待实现执行）：`Select mode="multiple"` + `aria-label` + 冲突 Modal 键盘可达 + 三态反馈 |
| V 性能 | 通过（待测量）：三项 P95 ≤200ms，测量口径已定；候选端点单次解析、无 N+1 |
| VI 一致性与契约 | 通过：单次写入、领域异常、两侧同改、新增字段均有消费者 |
| 依赖治理 | 通过：零新增依赖 |
| 契约单点收口 | 通过：提示词模板与冲突规则只在 `services/ontology_refs.py` 一份 |
| 中文文档与门禁 | 通过：产物全中文；门禁命令不变；新增配置项有默认值 |

**无违反项**，`Complexity Tracking` 无需填写。

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| 无 | — | — |
