# 契约：自建发布的工具清单（只读端点）

**特性**: [spec.md](../spec.md) | **日期**: 2026-10-19 | **状态**: 待实现

**读者**：core-backend 路由与服务实现、前端「MCP发布 → 自建发布」卡片的「查看工具」。

## 1. 端点

```http
GET /api/mcp/published/{name}/tools
```

- `name`：发布名（与列表接口的 `name` 一致，路径段需 URL 编码）。
- 无鉴权（与既有 `/api/mcp/published/*` 一致，平台内部接口）。
- 纯只读：**不启动/停止容器，不探测容器状态，不修改注册表**。

## 2. 成功响应 `200`

```json
{
  "name": "raw_inventory_purchase_action",
  "kind": "behavior",
  "ontology_name": "原材料采购和库存",
  "tools": [
    {
      "name": "QueryInventory",
      "description": "查询库存（本体「原材料采购和库存」）。返回为执行结果信封 {\"status_code\": int, \"data\": 业务数据}；下游返回非 2xx 时以错误形式抛出（不会静默返回失败数据）",
      "inputSchema": {
        "type": "object",
        "properties": {
          "ontology_id": { "type": "integer", "description": "本体 ID（必填）" },
          "warehouse": { "type": "string", "description": "仓库" }
        },
        "required": ["ontology_id", "warehouse"],
        "x-category": "本体行为",
        "x-ontology-scope": {
          "ontology_id": 1,
          "scenario_id": 1,
          "scenario_name": "生产调度",
          "ontology_name": "原材料采购和库存"
        }
      }
    }
  ]
}
```

### 字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `name` | `string` | 发布名 |
| `kind` | `'ontology_function' \| 'behavior'` | 发布类型 |
| `ontology_name` | `string` | 绑定本体中文名（注册表已有字段，缺失时为空串） |
| `tools` | `array` | 发布时冻结的工具快照，顺序与创建时的勾选顺序一致 |
| `tools[].name` | `string` | 工具名（= 函数名 / 行为名，裸名，无本体前缀） |
| `tools[].description` | `string` | 描述（发布时已拼入本体名与信封说明） |
| `tools[].inputSchema` | `object` | JSON Schema；`ontology_id` 是**必填**业务参数（LLM 填写），本体归属在顶层元数据 `x-ontology-scope`（不进 `properties`，不是参数） |

**不变式**

1. `tools.length === 列表接口同一发布的 tool_count`（同源于注册表条目）；
2. 该端点的数据是**发布时快照**：本体改动后不自动变化，需删除重建发布；
3. `tools: []` 是合法成功响应（发布时未勾选任何工具不可能发生，但历史/异常条目可能为空），前端必须按“0 个工具”呈现。

## 3. 错误响应

| 状态码 | 触发 | 响应体（既有统一错误结构） |
|---|---|---|
| `404` | 发布名不在注册表 | `{ "code": 404, "message": "自建发布不存在: <name>", "detail": … }` |
| `500` | 注册表读取异常 | `{ "code": 500, "message": <原因>, "detail": … }` |

**禁止行为**：条目不存在时返回 `200` + 空 `tools`（会把“找不到”显示成“0 个工具”，违反 FR-016）。

## 4. 前端消费规则

| 场景 | 行为 |
|---|---|
| 200，`tools.length > 0` | 打开工具弹窗，列出全部工具（名称 / 描述 / 参数可展开），标题下标注“工具清单为发布时快照，修改本体后需重新发布才会更新” |
| 200，`tools.length === 0` | 打开弹窗，显示“0 个工具（发布时未勾选任何工具）”，**不报错** |
| 404 / 5xx / 网络失败 | 以错误提示呈现后端 `message`（或网络原因），**不打开弹窗** |
| 容器已停止 / 容器缺失 | 与运行状态无关，照常返回快照并可查看 |

## 5. 与既有接口的边界

| 接口 | 是否包含 `tools` | 说明 |
|---|---|---|
| `GET /api/mcp/published`（列表） | ❌ | 保持轻量，仅 `tool_count` + `items`；本端点**不改变**它 |
| `GET /api/mcp/published/{name}`（详情） | ❌ | 同上 |
| `GET /api/mcp/published/{name}/client-config` | ❌ | 只给连接片段 |
| `GET /api/mcp/published/{name}/tools`（本端点） | ✅ | 只给工具快照 |

## 6. 测试要求

- 集成测试（core-backend）：成功形状（字段齐备、顺序与注册表一致）、404（不存在）、空快照（`tools: []` + 200）。
- 前端单测：成功打开弹窗、0 条空态、失败不打开弹窗且错误可见。
