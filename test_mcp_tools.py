"""测试 optonto_mcp MCP 服务的所有 15 个工具接口（全部走 HTTP 代理）"""
import asyncio, json, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

from contextlib import AsyncExitStack
from mcp import ClientSession
from mcp.client.sse import sse_client

MCP_URL = "http://localhost:8002/sse"

passed = 0
failed = 0

def ok(msg):
    global passed; passed += 1
    print(f"  [PASS] {msg}")

def fail(msg, detail=""):
    global failed; failed += 1
    print(f"  [FAIL] {msg}")
    if detail:
        print(f"     {str(detail)[:500]}")

async def test_all():
    print(f"\n{'='*60}")
    print(f"  MCP 服务: {MCP_URL}")
    print(f"{'='*60}")

    async with AsyncExitStack() as stack:
        # ─── 连接 ────────────────────────────────────────────
        print("\n--- 连接 MCP Server ---")
        transport = await stack.enter_async_context(sse_client(url=MCP_URL))
        read, write = transport
        session = await stack.enter_async_context(ClientSession(read, write))
        await session.initialize()
        ok("SSE 连接成功，MCP 握手完成")

        # ─── 列出工具 ─────────────────────────────────────────
        print("\n[1] list_tools() — 验证所有 15 个工具已暴露")
        tools = await session.list_tools()
        tool_names = [t.name for t in tools.tools]
        expected_all = [
            "list_scenarios", "list_ontologies",
            "list_behaviors", "list_concepts", "list_relations",
            "list_functions", "list_securities",
            "get_concept_attributes", "get_concept_relations",
            "search_scenarios", "search_ontologies",
            "search_behaviors", "search_concepts", "search_functions",
            "execute_behavior",
        ]
        for name in expected_all:
            if name in tool_names:
                ok(f"工具 '{name}' 已暴露")
            else:
                fail(f"工具 '{name}' 缺失")
        if len(tools.tools) == len(expected_all):
            ok(f"工具总数正确: {len(tools.tools)} 个")
        else:
            fail(f"工具数量异常: 期望 {len(expected_all)}, 实际 {len(tools.tools)}")

        # ═══════════════════════════════════════════════════════
        #  list / get 系列
        # ═══════════════════════════════════════════════════════

        # ─── 2. list_scenarios ────────────────────────────────
        print("\n[2] list_scenarios() — 列出所有场景")
        result = await session.call_tool("list_scenarios", {})
        data = json.loads(result.content[0].text)
        if isinstance(data, list):
            ok(f"返回 {len(data)} 个场景")
            for s in data:
                print(f"     ID={s.get('id')} name={s.get('name')}")
        else:
            fail("返回格式异常", data)

        # ─── 3. list_ontologies ───────────────────────────────
        print("\n[3] list_ontologies() — 列出所有本体")
        result = await session.call_tool("list_ontologies", {})
        data = json.loads(result.content[0].text)
        if isinstance(data, list):
            ok(f"返回 {len(data)} 个本体")
            for o in data:
                print(f"     ID={o.get('id')} name={o.get('name')}  [{o.get('scenario_name')}/{o.get('ontology_name')}]")
        else:
            fail("返回格式异常", data)

        # ─── 4. list_behaviors ────────────────────────────────
        print("\n[4] list_behaviors(ontology_id=1) — 列出本体 1 的行为")
        result = await session.call_tool("list_behaviors", {"ontology_id": 1})
        data = json.loads(result.content[0].text)
        if isinstance(data, list):
            ok(f"本体1 有 {len(data)} 个行为")
            for b in data[:5]:
                print(f"     {b.get('name', '?')} → {b.get('display_name', '')}")
        else:
            print(f"     返回: {json.dumps(data, ensure_ascii=False)[:200]}")

        # ─── 5. list_concepts ─────────────────────────────────
        print("\n[5] list_concepts(ontology_id=1) — 列出本体 1 的概念")
        result = await session.call_tool("list_concepts", {"ontology_id": 1})
        data_concepts = json.loads(result.content[0].text)  # 后面 get_concept_* 会复用
        if isinstance(data_concepts, list):
            ok(f"本体1 有 {len(data_concepts)} 个概念")
            for c in data_concepts[:5]:
                print(f"     {c.get('name', '?')} — {c.get('display_name', c.get('description', ''))}")
        else:
            fail("返回格式异常", data_concepts)
            data_concepts = []  # 防止后面报错

        # ─── 6. get_concept_attributes ────────────────────────
        print("\n[6] get_concept_attributes() — 获取第一个概念的属性")
        if data_concepts:
            cname = data_concepts[0]["name"]
            result = await session.call_tool("get_concept_attributes", {
                "ontology_id": 1, "concept_name": cname
            })
            attrs = json.loads(result.content[0].text)
            if isinstance(attrs, list):
                ok(f"概念 '{cname}' 有 {len(attrs)} 个属性")
                for a in attrs[:4]:
                    print(f"     {a.get('name', '?')} ({a.get('type', '?')})")
            else:
                fail("返回格式异常", attrs)
        else:
            fail("没有概念可测 get_concept_attributes")

        # ─── 7. list_relations ────────────────────────────────
        print("\n[7] list_relations(ontology_id=1) — 列出本体 1 的关系")
        result = await session.call_tool("list_relations", {"ontology_id": 1})
        data_rels = json.loads(result.content[0].text)  # 后面 get_concept_relations 会复用
        if isinstance(data_rels, list):
            ok(f"本体1 有 {len(data_rels)} 个关系")
            for r in data_rels[:3]:
                print(f"     {r.get('source', '?')} → {r.get('target', '?')}  [{r.get('relation_type', r.get('name', '?'))}]")
        else:
            fail("返回格式异常", data_rels)
            data_rels = []

        # ─── 8. get_concept_relations ─────────────────────────
        print("\n[8] get_concept_relations() — 获取第一个概念的直接关系")
        if data_concepts:
            cname = data_concepts[0]["name"]
            result = await session.call_tool("get_concept_relations", {
                "ontology_id": 1, "concept_name": cname
            })
            rels = json.loads(result.content[0].text)
            if isinstance(rels, list):
                ok(f"概念 '{cname}' 有 {len(rels)} 个直接关系")
                for r in rels[:3]:
                    print(f"     {r.get('source', '?')} → {r.get('target', '?')}")
            else:
                fail("返回格式异常", rels)
        else:
            fail("没有概念可测 get_concept_relations")

        # ─── 9. list_functions ────────────────────────────────
        print("\n[9] list_functions(ontology_id=1) — 列出本体 1 的函数")
        result = await session.call_tool("list_functions", {"ontology_id": 1})
        data = json.loads(result.content[0].text)
        if isinstance(data, list):
            ok(f"本体1 有 {len(data)} 个函数")
            for f in data[:4]:
                print(f"     {f.get('name', '?')} — {f.get('display_name', '')}")
        else:
            print(f"     返回: {json.dumps(data, ensure_ascii=False)[:200]}")

        # ─── 10. list_securities ──────────────────────────────
        print("\n[10] list_securities(ontology_id=1) — 列出本体 1 的安全信息")
        result = await session.call_tool("list_securities", {"ontology_id": 1})
        data = json.loads(result.content[0].text)
        if isinstance(data, list):
            ok(f"本体1 有 {len(data)} 条安全信息")
            for s in data[:4]:
                print(f"     action={s.get('action_name', '?')}")
        else:
            print(f"     返回: {json.dumps(data, ensure_ascii=False)[:200]}")

        # ═══════════════════════════════════════════════════════
        #  search 系列
        # ═══════════════════════════════════════════════════════

        # ─── 11. search_scenarios ─────────────────────────────
        print("\n[11] search_scenarios(keyword='生产') — 模糊搜索场景")
        result = await session.call_tool("search_scenarios", {"keyword": "生产"})
        data = json.loads(result.content[0].text)
        if isinstance(data, list):
            ok(f"搜索到 {len(data)} 个场景")
            for s in data:
                print(f"     ID={s.get('id')} name={s.get('name')}")
        elif isinstance(data, dict) and "message" in data:
            ok(f"场景搜索无匹配（预期行为）: {data['message']}")
        else:
            fail("返回格式异常", data)

        # ─── 12. search_ontologies ────────────────────────────
        print("\n[12] search_ontologies(keyword='原材料') — 模糊搜索本体")
        result = await session.call_tool("search_ontologies", {"keyword": "原材料"})
        data = json.loads(result.content[0].text)
        if isinstance(data, list):
            ok(f"搜索到 {len(data)} 个本体")
            for o in data:
                print(f"     ID={o.get('id')} name={o.get('name')}  [{o.get('scenario_name')}]")
        elif isinstance(data, dict) and "message" in data:
            ok(f"本体搜索无匹配（预期行为）: {data['message']}")
        else:
            fail("返回格式异常", data)

        # ─── 13. search_behaviors ─────────────────────────────
        print("\n[13] search_behaviors(ontology_id=1, keyword='查询') — 模糊搜索行为")
        result = await session.call_tool("search_behaviors", {"ontology_id": 1, "keyword": "查询"})
        data = json.loads(result.content[0].text)
        if isinstance(data, list):
            ok(f"搜索到 {len(data)} 个行为")
            for b in data:
                print(f"     {b.get('name', '?')}")
        elif isinstance(data, dict) and "message" in data:
            ok(f"行为搜索无匹配（预期行为）: {data['message']}")
        else:
            fail("返回格式异常", data)

        # ─── 14. search_concepts ──────────────────────────────
        print("\n[14] search_concepts(ontology_id=1, keyword='订单') — 模糊搜索概念")
        result = await session.call_tool("search_concepts", {"ontology_id": 1, "keyword": "订单"})
        data = json.loads(result.content[0].text)
        if isinstance(data, list):
            ok(f"搜索到 {len(data)} 个概念")
            for c in data:
                print(f"     {c.get('name', '?')} — {c.get('display_name', '')}")
        elif isinstance(data, dict) and "message" in data:
            ok(f"概念搜索无匹配（预期行为）: {data['message']}")
        else:
            fail("返回格式异常", data)

        # ─── 15. search_functions ─────────────────────────────
        print("\n[15] search_functions(ontology_id=1, keyword='计算') — 模糊搜索函数")
        result = await session.call_tool("search_functions", {"ontology_id": 1, "keyword": "计算"})
        data = json.loads(result.content[0].text)
        if isinstance(data, list):
            ok(f"搜索到 {len(data)} 个函数")
            for f in data:
                print(f"     {f.get('name', '?')}")
        elif isinstance(data, dict) and "message" in data:
            ok(f"函数搜索无匹配（预期行为）: {data['message']}")
        else:
            fail("返回格式异常", data)

        # ═══════════════════════════════════════════════════════
        #  execute_behavior（只测异常路径，避免副作用）
        # ═══════════════════════════════════════════════════════

        # ─── 16. execute_behavior ─────────────────────────────
        print("\n[16] execute_behavior(不存在的行为) — 测试错误处理")
        result = await session.call_tool("execute_behavior", {
            "ontology_id": 1,
            "behavior_name": "_test_nonexistent_behavior_",
            "params": {},
        })
        text = result.content[0].text
        print(f"     返回: {text[:300]}")
        if "error" in text.lower() or "404" in text or "not found" in text.lower():
            ok("不存在的行为返回错误信息（预期行为）")
        else:
            fail("对不存在行为返回异常", text)

    # ─── 汇总 ────────────────────────────────────────────────
    total = passed + failed
    print(f"\n{'='*60}")
    print(f"  测试完成: {total} 项 | ✅ PASS: {passed}  ❌ FAIL: {failed}")
    print(f"{'='*60}")
    return failed == 0

if __name__ == "__main__":
    success = asyncio.run(test_all())
    sys.exit(0 if success else 1)
