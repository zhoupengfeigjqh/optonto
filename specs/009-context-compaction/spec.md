# 功能规范：需求对话上下文压缩（滚动摘要）

**特性分支**: `009-context-compaction`

**创建日期**: 2026-11-20

**状态**: 已实现（2026-11-20；验收见 [tasks.md](./tasks.md)）

**输入**: 用户 2026-11-20 决策回合——
① 70 轮后压缩 30 轮（保留最近 40 轮）；② 或 token 超过 200K 时按 token 反推压缩轮次；
③ 摘要注入 system prompt（追加，不覆盖）；④ 摘要上限 2000；⑤ 系统提示词本身永不压缩。

## 背景与问题

`POST /api/threads/{id}/chat` 每轮把 `thread["messages"]` **全量**拼给模型（`routers/chat.py`），
无窗口、无截断、无摘要、无 token 预算；`ANALYSIS_SYSTEM_PROMPT` 单独就有 19553 字符
（约 13k tokens，含拷问模式）。且现网会把 LLM 异常文本当作 assistant 内容落盘（`[调用出错: …]`），
一旦超限就永久污染历史、后续每轮必然失败，用户只能「清空对话」并丢失全部需求演进。

## 参数定稿

| 项 | 值（环境变量可覆盖） |
| :-- | :-- |
| 名义窗口 | `LLM_CONTEXT_WINDOW=300000`（仅用于换算，不作工作预算） |
| 触发 | 未压轮数 > `CONTEXT_TRIGGER_ROUNDS=70` **或** 估算 tokens ≥ `CONTEXT_TRIGGER_TOKENS=200000` |
| 轮数触发 | 保留最近 `CONTEXT_KEEP_ROUNDS=40` 轮，其余归档（71 轮触发即压 31 轮，稳态 30-31 轮） |
| token 触发 | 保留窗口按 `CONTEXT_KEEP_TOKENS=40000` 从末尾反推，压缩轮次为变量 |
| 触底保护 | 至少保留 `CONTEXT_MIN_KEEP_ROUNDS=8` 轮 |
| 摘要上限 | `CONTEXT_SUMMARY_MAX_TOKENS=2000`（约 2000 中文字），超限二次压缩只压叙述 |
| 单条消息上限 | `CONTEXT_SINGLE_MSG_MAX_TOKENS=20000`，超限截断并标注 |
| 输出上限 | chat 4096 / 摘要 2000 / 生成本体 8192 |

token 估算：中文 1 字 ≈ 1 token，其余 4 字符 ≈ 1 token（不引入 tiktoken，章程 ⑥）。

## 不变量（红线）

1. **`thread["messages"]` 永不改写**：`/export`、`/validate` 的 `selected_indices` 直接索引该数组，
   删元素会让导出/校验**静默错位**。压缩只产出 prompt 视图，原文全量落盘。
2. **系统提示词主体永不压缩**：摘要只是追加在 system 末尾的一段，位于 messages 之前
   （恒定前缀在前，最大化 DeepSeek 前缀缓存命中）。
3. **业务基线从全量取**：`{business_info}` 必须由调用方从 `thread["messages"]` 取首条 user 传入；
   若从压缩后的视图里取，会静默换成后续消息。
4. **摘要只是派生物**：`clear_messages` 必须连带清空 `context` / `digest`。

## 用户场景与测试 *（必填）*

### 用户故事 1 - 长对话不再爆上下文（优先级：P1）

作为本体设计者，我在同一会话里连续讨论几十轮后，系统自动把早期对话归档成摘要，
对话继续可用，且我不会察觉"模型忘了前面说过什么"却没有解释。

**独立验证**：构造 71 轮线程 → 第 71 轮请求触发压缩 → `context.covered_until` 前移、
prompt 中 messages 从第 32 轮开始、system 末尾出现摘要段；`messages` 长度不变。

**验收场景**：

1. **Given** 未压 70 轮，**When** 发第 71 轮，**Then** 不压缩（规则是"超过 70 轮"）。
2. **Given** 未压 71 轮，**When** 发消息，**Then** 归档 31 轮、保留 40 轮，归档边界落在某一轮的 user 消息上。
3. **Given** 45 轮但估算 ≥200K，**When** 发消息，**Then** 走 token 规则，压缩轮次由 token 反推（非固定 30）。
4. **Given** 每轮极长导致 token 规则算出的保留窗口 <8 轮，**Then** 触底保留 8 轮。

### 用户故事 2 - 归档不破坏导出与验证（优先级：P1）

作为设计者，压缩后我勾选任意一条助手回复导出/验证，命中的仍是我勾选的那条。

**独立验证**：压缩前后对同一 `selected_indices` 调用 `/export`、`/validate`，结果逐字节一致。

### 用户故事 3 - 压缩失败不能中断对话（优先级：P1）

作为使用者，摘要调用超时或输出不合规时，本轮对话照常返回，只是历史没有被归档。

**验收场景**：

1. **Given** 摘要超时/JSON 非法/保真校验不过（重试 1 次仍失败），**Then** 不推进 `covered_until`，
   本轮按窗口截断发送，`messages` 不变，日志记录原因。
2. **Given** 压缩成功，**When** 用户点「清空对话」，**Then** `messages` / `context` / `digest` 全部清空。

### 用户故事 4 - 归档状态对用户可见（优先级：P2）

**验收场景**：压缩发生后，线程头部出现「前 N 轮已归档」徽标，点击可查看摘要全文；
压缩进行中显示「正在整理更早的对话…」；调用错误以横幅提示，不再伪装成助手回复。

## 数据结构

```jsonc
{
  "messages": [ /* 全量永久保留 */ ],
  "context": {
    "summary": "8 小节摘要",
    "covered_until": 62,          // messages[0:62] 已归档（message 索引，非轮次）
    "archived_rounds": 31,
    "summary_tokens": 1180,
    "updated_at": "...",
    "history": [ { "covered_until": 62, "archived_rounds": 31, "at": "..." } ]
  },
  "digest": { "concepts": [], "rules": [], "rejected": [], "open_questions": [] },
  "last_error": { "message": "...", "at": "..." }
}
```

`digest` 只增不减（`rejected` 任何情况下不删），用于抵抗多次摘要累积后的要素漂移；
摘要超限时二次压缩只允许压缩叙述，禁止删【规则与约束】【已否决方案】。

## 接口契约变更

- `GET /api/threads/{id}` 新增 `context`（可为空）与 `last_error`（可为空）。
- `POST /api/threads/{id}/chat` 的 SSE 新增两类事件：`{"status": "...", "archived_rounds": N}`
  与 `{"error": "..."}`；两者均可能与 `token` 同包，前端需先处理元事件再追加正文。
- 错误不再写入 `messages`（历史遗留的 `[调用出错:` 消息在归档时被过滤）。

## 修订记录

| 日期 | 变更 | 决策 |
| :-- | :-- | :-- |
| 2026-11-20 | 首版 | 70 轮 / 200K / 压 30 留 40 / 摘要 2000 注入 system 末尾；摘要只作视图不改 messages |
