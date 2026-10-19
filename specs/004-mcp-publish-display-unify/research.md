# 研究记录：MCP 发布页的配置展示与卡片结构统一

**特性**: [spec.md](./spec.md) | **计划**: [plan.md](./plan.md) | **日期**: 2026-10-19

技术上下文中的未知项已全部消解（无 NEEDS CLARIFICATION 残留）。以下决策均以现有代码事实为据，并记录被否决的备选方案。

## R1 两段地址与片段结构的**事实源**放在哪

**决策**：放在前端声明层 `frontend/src/components/Design/mcp-publish/catalog.ts` —— 在 `FixedServiceDef` 上新增两个字段：
- `clientKey: string`：客户端配置里的服务标识（如 `optonto-ontology-query` / `optonto-common-function` / `optonto-business`）；
- `internalEndpoint: string`：容器内可达地址（容器名 + 容器内端口 + 端点路径）。

`config-snippets.ts` 变成通用纯函数：由 `def.transport` 推导 `type`、由 `def.endpoint`（宿主）与 `def.internalEndpoint`（内网）生成两段。

**理由**：
1. `catalog.ts` 已是固定服务声明的唯一事实源，并且 `core-backend/tests/test_service_topology_consistency.py` 已在读它（`service:` 键、`endpoint:`、`transport:`、`exposure:`、`publishTools:`），新增字段不改变该护栏的解析口径；
2. 两段地址都是**编译期常量**（compose 里端口固定），没有任何运行时信息需要后端提供；
3. 无需新增接口，也就不触碰原则 VIII「两侧同改」的成本。

**备选与否决理由**：
- 后端下发（给每张固定卡片开一个 config 接口）：否决。为静态常量引入网络依赖与前后端双份契约，收益为零，且会让「打开弹窗」变成异步失败面。
- 继续按 `def.key` 硬编码三份 JSON：否决。这正是当前重复与漂移的来源（两张卡片各写一遍 `mcpServers`）。

## R2 业务系统 MCP 的请求头怎么来

**决策**：仍然读一次平台 MCP 配置（现有 `getMCPConfig()`），但**只提取 `headers`** 并入片段；匹配口径为「该条目的规范化 URL 等于 `def.endpoint`（宿主）或 `def.internalEndpoint`（容器内）」。匹配不到 → 不带头、不报错，并在弹窗说明中提示“若该服务需要鉴权，请先在「MCP 配置」页登记请求头”。

**理由**：
1. 固定服务按契约不带令牌（`specs/contracts/mcp-tools.md` §9.3「固定服务不带令牌」），所以 headers 常态为空；只有用户显式改了配置才需要带入；
2. 现状用 `s.url.includes('business-mcp')` 做字符串嗅探，客户换成自有域名即失效；规范化地址相等是更稳的判据，且不依赖服务命名；
3. 只取 headers 可根治「整条内部条目回显」的缺陷（FR-006）。

**备选与否决理由**：
- 完全不读配置、固定不带 headers：否决。与 FR-007 冲突，且用户确实可能在 business MCP 上挂鉴权。
- 按名称匹配（`name === def.title`）：否决。名称是用户可改的展示字段，改名即失配；地址是连接事实。

## R3 两个内网执行底座给不给片段

**决策**：**都不给**。8005（数据引擎执行）与 8006（本体函数执行）在 2026-10-19 方案 B 后都是 `transport='none'`（零工具、无 `/mcp`），`clientTypeOf('none') === null` 即“无客户端片段”，弹窗只输出内网执行端点说明（沿用现有 `{internal: true, endpoint, endpoints: [...]}` 形态）。

**理由**：
1. 零工具服务没有可列的工具、也没有协议端点，给出 `mcpServers` 片段是**不可连接的错误信息**；
2. `catalog.ts` 已把二者标为 `exposure: '内网'`、`publishTools: false`、`transport: 'none'`，判定无需再加开关；
3. 拓扑护栏已断言 8005/8006 必须 `TRANSPORT_NONE` 且不得注册 `list_tools` / `call_tool`，故这一口径是结构保证而非约定。

**备选与否决理由**：
- 给 8005 容器内段：否决。它不再挂 `/mcp`，容器内也没有可粘的连接端点；行为对外只有自建发布一条路（决策记录 `specs/2026-10-19-zero-tool-executor-decision.md`）。
- 按「是否有宿主端口」判定：否决。判据会与传输模式形成两套口径，且未来若给 8006 加端口就会自相矛盾。

## R4 自建发布的工具清单从哪取

**决策**：新增只读端点 `GET /api/mcp/published/{name}/tools`，由 `services/mcp_publish_containers.published_tools(name)` 读注册表条目里的 `tools`（发布时编译的快照，含 `name` / `description` / `inputSchema`），返回 `{name, kind, ontology_name, tools}`；条目不存在 → 走现有 `NotFoundError` → 404。

**理由**：
1. 快照数据**已经在注册表里**（`build_entry` 编译后落盘），只是 `public_view()` 没吐出来 —— 无需重新编译或连容器；
2. 列表接口 `GET /api/mcp/published` 每次刷新都会调用，把每个发布的完整 `inputSchema` 内联进去会让载荷按“发布数 × 工具数 × schema 大小”膨胀，而工具查看是**低频、按需**动作；
3. 实时探测容器 `/tools` 在停机/容器缺失时不可用，且会把“冻结快照”说成“实时清单”，与发布语义冲突（§9.4 发布即冻结）。

**备选与否决理由**：
- `public_view()` 直接内联 `tools`：否决（载荷膨胀 + 首屏不需要）。
- 前端连容器 `/tools`：否决（需要宿主端口与令牌，且停机不可用；与冻结语义冲突）。
- 复用固定服务的 `/tools` 探针接口：否决（探针按 URL 连服务，语义不同，也无法读快照）。

## R5 两张卡片“结构一致”的落地方式

**决策**：在 `mcp-publish/cards.tsx` 内抽出两个仅展示的小原子并两块共用：
- `StatusBadge`：状态点 + 文本（`检查中… / 运行中 / 已停止`），自建发布额外的 `容器缺失` 作为同组件的一种状态；
- `InfoRow`：`标签｜值` 的单行信息（值可传 `<code>` 元素）。

`PublishedServiceCard` 统一为：标题 + 标签组 → 状态位 → 信息区（端点 / 传输模式 / 可用工具 + 查看工具 → 领域行：类型与已选工具、本体、访问令牌、依赖与快照提示）→ 说明 → 按钮组（查看配置 / 启动·停止 / 删除）。

**理由**：两块的信息项本来高度重合（端点、传输模式、工具数、状态），差异集中在“谁有令牌/本体/依赖”。抽原子后差异只体现为**多出的领域行**，不需要两套排版；
`cards.tsx` 现约 123 行，新增原子后仍远低于 500 行上限。

**备选与否决理由**：
- 复制固定卡片的 JSX 到自建卡片：否决。两份排版必然漂移，正是本次要消除的问题。
- 抽成独立文件（`cards/` 目录）：暂不必要；若实施后逼近 300 行再拆（章程上限 500，留余量）。

## R6 工具清单的失败与空态如何区分

**决策**：
- **请求失败**（404 / 网络错误 / 服务异常）→ `message.error` 呈现后端原因，**不打开弹窗**（与现有「查看配置」失败一致）；
- **成功但 0 条** → 打开弹窗，显示「0 个工具（发布时未勾选任何工具）」，而不是「暂无工具信息」这种含糊文案；
- 弹窗标题下固定一行说明：「工具清单为发布时快照，修改本体后需重新发布才会更新」。

**理由**：FR-016 要求失败不得冒充 0 个工具；把“错误”和“空”放在两个通道（toast / 弹窗空态）最不容易混淆，也避免弹窗里出现需要二次判断的错误卡片。

**备选与否决理由**：
- 弹窗内错误态：可行但增加了弹窗状态机（loading / error / empty / list），收益不高；若后续要支持“弹窗内重试”再引入。
- 静默吞掉错误：直接违反原则 IX。

## R7 跨仓护栏（`test_service_topology_consistency.py`）如何同步

**决策**：**保持既有正则可解析**，只做追加式修改：
- `catalog.ts` 每条仍以 `key: '…',` 开头、以 `\n  },` 收尾，单引号字符串不变；新增 `clientKey` / `internalEndpoint` 放在 `endpoint` 之后；
- `config-snippets.ts` 保留 `key === 'functionExecutor'` 分支与 `endpoints: ['POST /execute-function']` 形态，保住 `test_公共函数迁移后旧端点只允许出现在归位说明里` 的解析；
- 保留 `clientTypeOf(def.transport)` 的调用形态（护栏断言该字符串存在），避免“手写 type”；
- 新增一条护栏断言（同批加）：三个对外固定服务的片段生成结果**都含两段**，且 `internalEndpoint` 指向真实容器（复用 `assert_url_real`）。

**理由**：护栏是“改服务端就得同步卡片”的机器执行者；让它继续锁住事实源，比改测试去适应新代码更可靠。

**备选与否决理由**：
- 改造护栏为结构化解析（解析 TS AST）：否决。为一次展示改动引入解析依赖，成本远超收益；正则 + 固定的书写约定已足够。
