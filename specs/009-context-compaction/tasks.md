# 任务清单：需求对话上下文压缩（009）

**状态**: 已实现（2026-11-20）

## 后端

- [x] `config.py`：新增压缩参数与 LLM 输出/超时参数（全部支持环境变量覆盖）
- [x] `prompts/context_summary.py`：新增 8 小节结构化摘要提示词（含保真硬约束）
- [x] `config.py` / `prompts/__init__.py`：再导出摘要提示词
- [x] `services/context_compactor.py`（新增）：
  - [x] `estimate_tokens` / `truncate_to_tokens`（本地估算，不引 tiktoken）
  - [x] `round_spans` / `round_count`（按 user 切轮，过滤空 assistant 与报错占位）
  - [x] `plan_compaction`（轮数 >70 或 token ≥200K；轮数保留 40 / token 反推 / 触底 8）
  - [x] `build_view`（视图组装 + 单条超限截断）
  - [x] `verify_summary`（数字 / 引号内专名 / 约束词保真校验）
  - [x] `merge_digest`（按 name 合并，`rejected` 只增不删）
  - [x] `compress_thread`（摘要 + 两次尝试 + 二次压缩 + 落盘；失败不推进 `covered_until`）
- [x] `services/thread_store.py`：`clear_messages` 连带清 `context` / `digest`
- [x] `routers/chat.py`：
  - [x] 压缩接入（status 事件 → 压缩 → 重读线程 → 组装视图）
  - [x] 摘要拼进 system 末尾；`business_info` 从全量 messages 取
  - [x] 错误改为独立 `error` 事件 + `last_error` 字段，不再写进 `messages`
  - [x] 对话 / 生成本体 / 验证显式设置 `max_tokens` 与 `timeout`
- [x] `llm_utils.py`：`build_llm` / `llm_text` / `llm_json` 支持可选 `max_tokens` / `timeout`

## 前端

- [x] `api/threads.ts`：`Thread` 增加 `context` / `last_error` 类型
- [x] `ConversationChat.tsx`：
  - [x] 消费 `status` / `error` / `archived_rounds` 事件（元事件与 token 同包也能正确处理）
  - [x] 「前 N 轮已归档」徽标 + 摘要查看弹窗
  - [x] 错误横幅（不再把错误写进消息气泡）
  - [x] 清空对话时同步清除归档状态

## 测试

- [x] `tests/test_context_compactor.py`：36 例（估算/切轮/双触发/触底/视图/校验/digest/压缩三路径/清空）
- [x] `ConversationChat.test.tsx`：6 例（徽标与摘要、status、error、archived 刷新）

## 验收记录

| 项 | 结果 |
| :-- | :-- |
| 后端压缩器单测 | `python -m unittest tests.test_context_compactor` → 36 passed |
| 后端全量 | `python -m pytest tests --ignore=tests/test_error_contract.py` → 321 passed，13 failed 均为宿主机 starlette 版本不兼容（`Router.__init__() got an unexpected keyword argument 'on_startup'`，与本次改动无关） |
| 前端全量 | `npx vitest run` → 50 files / 629 passed |
| 前端 lint | 0 error（11 条 warning 均为存量：`any` / hooks 依赖 / 既有 a11y） |
| 索引红线 | 压缩不改 `messages`，`/export`、`/validate` 的 `selected_indices` 语义不变 |

## 未做 / 后续

- 未在真实 LLM 上做端到端长会话压测（宿主机无可用 fastapi/starlette 组合，路由无法本地起服务）；
  上线前建议在容器内跑一次 100+ 轮真实会话，核对摘要保真与首 token 延迟。
- `digest` 目前只存不读；后续可让 `generate-ontology` 在 md 缺失时作为兜底输入。
