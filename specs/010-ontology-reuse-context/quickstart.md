# 快速验证指南：新建对话时引用存量本体

**Feature**: `010-ontology-reuse-context` | **Date**: 2026-11-20

本指南用于实现完成后**验证功能真的可用**。数据模型见 [data-model.md](./data-model.md)，接口与提示词契约见 [contracts/ontology-refs.md](./contracts/ontology-refs.md)。

---

## 1. 前置条件

| 项 | 要求 |
| :-- | :-- |
| 后端 | `core-backend` 可运行（宿主 8001）；前端经 Nginx 在 `http://localhost:81/` |
| 数据 | 至少 3 个**有内容**的本体（各含 ≥1 概念、≥1 函数、≥1 行为）；其中两个本体必须含**同名概念但属性不同**（如都有 `Order`，一边 `orderNo(string, 唯一/必填)` + `amount(number, ≥0)`，另一边 `orderNo(string)` + `total(number)`）；另准备 1 个**空本体**（无概念/函数/行为）用于置灰验证 |
| 造数据方式 | 直接在 `.data/onto_market/{场景}/{本体}/ontology.yaml` 编辑，或经本体设计页手建；**统一走既有编辑链路**，不手改 meta.json |
| 造冲突方式 | 两个本体的同名概念满足上述属性差异即可；跨类目同名则让同一本体里概念与函数同名（如都叫 `Inventory`） |
| 大本体（超限用） | 若无，可临时把多个本体各复制出若干概念（仅本地验证用，**不得提交**） |

---

## 2. 自动化门禁（必跑）

```bash
# 后端
cd core-backend
python -m pytest -q tests/test_ontology_refs.py
python -m pytest -q tests/test_thread_ontology_refs.py
python -m pytest -q                     # 全量回归

# 前端
cd frontend
npx vitest run src/components/Design/conversation-ontology-refs.test.ts
npx vitest run src/components/Design/ConversationManager.test.tsx
npx vitest run src/components/Design/OntologyRefTags.test.tsx
npx vitest run src/components/Design/ConversationChat.test.tsx
npx vitest run                          # 全量回归
npx eslint src --ext .ts,.tsx
```

**期望结果**：

| 命令 | 期望 |
| :-- | :-- |
| 纯函数测试 | 全绿；覆盖提取四类、渲染规则、冲突两类、体量边界 |
| 端点测试 | 全绿；覆盖候选（含 exclude）、预检（allowed/conflicts）、创建带引用、超限 400 且**无目录残留**、清空保留、删除消失、未选引用时**无 `ontology_refs` 键** |
| 全量后端 | 全绿，用例数只增不减 |
| 前端全量 | 全绿；测试文件数 = 改动前 + 3（纯模块 / 新建弹窗 / 引用标签组） |
| `eslint` | 0 error（warning 不得新增） |
| 覆盖率 | `conversation-ontology-refs.ts` ≥80%（已登记 `vitest.config.ts` 的 include） |

---

## 3. 手工验收步骤

启动后进入「本体设计 → 需求 → 对话管理」，点「新建对话」。

### 场景 A：选择与创建（US1）

1. **只填版本号、不选本体** → 确认创建：**期望** 创建成功、进入对话页；Header **不出现**任何引用标签。
2. 再次新建，展开「引用存量本体」：**期望** 每项第一行形如「场景名 - 本体名」，第二行小字显示描述、条目数（概念/函数/行为）与「已部署 vX」（有则显示）；**当前本体不在其中**；空本体置灰、第二行替换为「暂无可提取内容」。
3. 选 1 个创建：**期望** 创建成功；进入对话页 Header 显示 1 个引用标签 + 「快照 YYYY-MM-DD HH:mm」。
4. 选 3 个（跨场景）创建：**期望** 三条标签；点击确认到进入对话界面 ≤ 3 秒（SC-001）。
5. 同一本体重复勾选：**期望** 下拉内不会重复累加（去重）。

### 场景 B：提示词内容正确（US2 / SC-002）

1. 用场景 A-4 创建的那条对话，在 `core-backend` 进程内核对系统提示词：

```bash
cd core-backend
python -c "
import json,sys
from services import thread_store
d,_,_ = thread_store.load_thread('<thread_id>')
s = d['ontology_refs']
print(s['prompt_text'])
print('tokens=', s['token_estimate'], 'refs=', len(s['refs']))
"
```

2. **期望**：`prompt_text` 中出现的概念名 / 属性名（含类型与约束）/ 函数名 / 行为名，与三个源本体清单**逐项核对**：缺失 0 项、多出 0 项；**不出现**概念关系、对象关系、规则、流程、安全管控、数据引擎（可用 `grep -n "关系\\|流程\\|规则\\|安全"` 辅助，命中数应为 0）。
3. **期望**：无属性约束的属性行**没有** `；约束=` 片段；无中文名的条目只有英文名（无编造中文）。

### 场景 C：命名约束生效（US2 / SC-003）

1. 引用两个含同名概念「订单」（属性不同）的本体，创建对话。
2. 在对话中要求：「请为订单设计一个提交行为，并补充订单缺少的属性」。
3. **期望**：模型沿用「订单/Order」而不是另造「销售单」；对缺失属性优先沿用另一侧已有的英文名与类型；若不得不冲突，模型**先向用户指出**并请求裁决，而不是自行改名或改约束。

### 场景 D：冲突在创建前暴露（US3 / FR-014）

1. 勾选那两个属性不同的同名概念本体，点「确认创建」。
2. **期望**：先弹「引用本体存在命名冲突」，列出概念名 `Order`、双方属性差异（哪边独有、哪边约束不同）。
3. 点「返回调整」：**期望** 新建弹窗与已选状态**保留**，可改选。
4. 再点确认并选「仍然创建」：**期望** 创建成功（冲突不阻断，只要求确认）。
5. 改选**无冲突**组合 → 点确认：**期望** 不出现冲突弹窗，直接创建。

### 场景 E：超限拦截（FR-015 / SC-006）

1. 勾选足够多的本体使估算超过 20,000 tokens。
2. **期望**：创建被阻止，提示含**实际值**与**上限**（如「引用内容约 28431 tokens，超过上限 20000；请减少勾选…」），新建弹窗保持打开，`.data/threads/demand/` 下**没有**新目录。
3. **期望**：后端**没有**任何"截断后继续创建"的路径（可另跑一次 `POST /api/threads` 绕过前端直接提交，同样应 400）。

### 场景 F：快照不漂移（US4 / SC-007）

1. 记下场景 A-3 对话的 `snapshot_at` 与 `prompt_text`（用场景 B 的命令）。
2. 到本体设计页把被引用本体里那个概念删掉一个属性并保存。
3. 重新进入该对话（刷新页面），再执行场景 B 的命令。
4. **期望**：`prompt_text` 与 `snapshot_at` **逐字节不变**；页面标签时间不变。
5. 再直接把被引用本体**删除**：**期望** 该对话仍能打开并继续对话；标签变灰并提示「原本体已不存在」。

### 场景 G：清空与删除（FR-017 / FR-018）

1. 在有引用的对话里点「清空对话」并确认。
2. **期望**：消息清空；Header 的引用标签与快照时间**仍在**；再发一条消息，系统提示词仍含引用段（用场景 B 的方式抽查一次）。
3. 删除该对话：**期望** 列表不再有它；`.data/threads/demand/{id}/` 目录不存在。

### 场景 H：零回归（SC-005）

1. 不选任何引用创建一条对话，记下其 `prompt_text` 应为**不存在**（`load_thread` 结果里没有 `ontology_refs` 键）。
2. 用同一份样本参数对比改动前后的 system prompt。**注意不能用 Python 内置 `hash()`**——它默认开启随机化（`PYTHONHASHSEED`），跨进程结果不同，会必然假失败；必须用 `hashlib.sha256`：

```bash
cd core-backend
python -c "import hashlib; from routers.chat import _build_system_message; s=_build_system_message('样本业务信息', False, '样本摘要'); print(hashlib.sha256(s.encode('utf-8')).hexdigest(), len(s))"
```

在改动前（`git stash` 或对照分支）与本改动后各执行一次：**期望** `sha256` 与字符长度**都相同**。恢复时 `git stash pop`。
3. 页面层：不选引用时新建弹窗与改动前一致（多了一个可选下拉，其余文案/校验不变）；对话页 Header 不出现任何新节点。

---

## 4. 失败判定（出现任一条即视为未完成）

- 下拉里出现当前对话所属本体自身，或出现空本体且**可**勾选。
- 提取内容里混入概念关系 / 对象关系 / 规则 / 流程 / 安全管控 / 数据引擎中的任何一项。
- 属性行出现 `约束=-` 或空的约束段落；无中文名的条目被填了英文名或编造中文名。
- 同一名称跨类目出现却没有冲突提示；或同名概念属性明显不同却**无**冲突提示。
- 超限时创建成功，或提示不含实际值与上限，或无提示地静默截断。
- 创建成功后源本体被改，`prompt_text` 或 `snapshot_at` 发生变化。
- 清空对话后引用消失；或删除对话后目录仍残留。
- 不选引用时 system prompt 与改动前**不**逐字节一致（哈希不同）。
- 超限创建失败后 `.data/threads/demand/` 下出现新目录（残留）。
- 全量 `pytest` / `vitest` 出现任何失败，或 eslint 新增 error。

---

## 5. 回滚

本特性无数据库、无迁移、无数据格式破坏性变更：

1. 代码：还原 `core-backend/routers/{threads,chat,main}.py`、`services/thread_store.py`、`config.py`；删除 `services/ontology_refs.py`、`routers/ontology_refs.py` 及其测试；前端还原 `api/{threads,client}.ts`、`ConversationManager.tsx`、`ConversationChat.tsx`，删除 `api/ontology-refs.ts`、`conversation-ontology-refs.ts` 及其测试与 `vitest.config.ts` 的 include 行。
2. 数据：已创建的 thread JSON 里残留 `ontology_refs` 键，回滚后**无需清理**（旧代码不读该键，`list_threads` 白名单也不回传）。
