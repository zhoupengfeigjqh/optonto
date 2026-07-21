"""测试 optonto_mcp MCP 服务的所有工具接口"""
import asyncio, json, sys, time
import io
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
        # 只显示前 500 字符
        print(f"     {str(detail)[:500]}")

async def test():
    print(f"\n--- 正在连接 MCP 服务: {MCP_URL} ---")
    async with AsyncExitStack() as stack:
        transport = await stack.enter_async_context(sse_client(url=MCP_URL))
        read, write = transport
        session = await stack.enter_async_context(ClientSession(read, write))
        await session.initialize()
        ok("SSE 连接成功，MCP 握手完成")

        # ─── 1. list_tools ─────────────────────────────────────
        print("\n[1] list_tools() -- 获取工具列表")
        tools = await session.list_tools()
        tool_names = [t.name for t in tools.tools]
        expected = [
            "list_ontologies", "list_behaviors", "list_concepts",
            "get_concept_attributes", "list_relations", "get_concept_relations",
            "list_functions", "list_securities", "execute_behavior",
        ]
        for name in expected:
            if name in tool_names:
                ok(f"工具 '{name}' 已暴露")
            else:
                fail(f"工具 '{name}' 缺失")
        if len(tools.tools) == len(expected):
            ok(f"工具数量正确: {len(tools.tools)} 个")
        else:
            fail(f"工具数量异常: 期望 {len(expected)}, 实际 {len(tools.tools)}")

        # ─── 2. list_ontologies ────────────────────────────────
        print("\n[2] list_ontologies() -- 列出所有本体")
        result = await session.call_tool("list_ontologies", {})
        data = json.loads(result.content[0].text)
        if isinstance(data, list):
            ok(f"返回了 {len(data)} 个本体")
            for o in data[:3]:
                print(f"     ID={o.get('id')} name={o.get('name')} [{o.get('scenario_name')}/{o.get('ontology_name')}]")
        else:
            fail("list_ontologies 返回格式异常", data)

        # ─── 3. list_behaviors ─────────────────────────────────
        print("\n[3] list_behaviors(ontology_id=1) -- 列出本体 1 的行为")
        result = await session.call_tool("list_behaviors", {"ontology_id": 1})
        data = json.loads(result.content[0].text)
        if isinstance(data, list):
            ok(f"本体1有 {len(data)} 个行为")
            for b in data[:3]:
                print(f"     {b.get('name', b.get('display_name', '?'))}")
        else:
            # 可能是错误信息（如本体不存在）
            print(f"     返回: {json.dumps(data, ensure_ascii=False)[:200]}")

        # ─── 4. list_concepts ──────────────────────────────────
        print("\n[4] list_concepts(ontology_id=1) -- 列出本体 1 的概念")
        result = await session.call_tool("list_concepts", {"ontology_id": 1})
        data = json.loads(result.content[0].text)
        if isinstance(data, list):
            ok(f"本体1有 {len(data)} 个概念")
            for c in data[:5]:
                print(f"     {c.get('name', '?')} - {c.get('display_name', c.get('description', ''))}")
        else:
            print(f"     返回: {json.dumps(data, ensure_ascii=False)[:200]}")

        # ─── 5. get_concept_attributes ─────────────────────────
        print("\n[5] get_concept_attributes(ontology_id=1) -- 尝试获取某个概念的属性")
        # 先拿第一个概念的名称
        if isinstance(data, list) and len(data) > 0:
            cname = data[0]["name"]
            result = await session.call_tool("get_concept_attributes", {
                "ontology_id": 1, "concept_name": cname
            })
            attrs = json.loads(result.content[0].text)
            if isinstance(attrs, list):
                ok(f"概念 '{cname}' 有 {len(attrs)} 个属性")
                for a in attrs[:4]:
                    print(f"     {a.get('name', '?')} ({a.get('type', '?')})")
            else:
                fail(f"get_concept_attributes 返回异常", attrs)

        # ─── 6. list_relations ─────────────────────────────────
        print("\n[6] list_relations(ontology_id=1) -- 列出本体 1 的关系")
        result = await session.call_tool("list_relations", {"ontology_id": 1})
        data = json.loads(result.content[0].text)
        if isinstance(data, list):
            ok(f"本体1有 {len(data)} 个关系")
            for r in data[:3]:
                print(f"     {r.get('source', '?')} → {r.get('target', '?')} [{r.get('relation_type', '?')}]")
        else:
            print(f"     返回: {json.dumps(data, ensure_ascii=False)[:200]}")

        # ─── 7. get_concept_relations ──────────────────────────
        print("\n[7] get_concept_relations(ontology_id=1) -- 获取某个概念的关系")
        # 拿第一个概念的关系
        concepts_r = await session.call_tool("list_concepts", {"ontology_id": 1})
        concepts = json.loads(concepts_r.content[0].text)
        if isinstance(concepts, list) and len(concepts) > 0:
            cname = concepts[0]["name"]
            result = await session.call_tool("get_concept_relations", {
                "ontology_id": 1, "concept_name": cname
            })
            rels = json.loads(result.content[0].text)
            if isinstance(rels, list):
                ok(f"概念 '{cname}' 有 {len(rels)} 个直接关系")
                for r in rels[:3]:
                    print(f"     {r.get('source', '?')} → {r.get('target', '?')}")
            else:
                fail(f"get_concept_relations 返回异常", rels)

        # ─── 8. list_functions ─────────────────────────────────
        print("\n[8] list_functions(ontology_id=1) -- 列出本体 1 的函数")
        result = await session.call_tool("list_functions", {"ontology_id": 1})
        data = json.loads(result.content[0].text)
        if isinstance(data, list):
            ok(f"本体1有 {len(data)} 个函数")
            for f in data[:3]:
                print(f"     {f.get('name', '?')}")
        else:
            print(f"     返回: {json.dumps(data, ensure_ascii=False)[:200]}")

        # ─── 9. list_securities ────────────────────────────────
        print("\n[9] list_securities(ontology_id=1) -- 列出本体 1 的安全信息")
        result = await session.call_tool("list_securities", {"ontology_id": 1})
        data = json.loads(result.content[0].text)
        if isinstance(data, list):
            ok(f"本体1有 {len(data)} 条安全信息")
        else:
            print(f"     返回: {json.dumps(data, ensure_ascii=False)[:200]}")

        # ─── 10. execute_behavior (只测试不存在的行为) ──────
        print("\n[10] execute_behavior -- 测试行为调用（故意传不存在的行为）")
        result = await session.call_tool("execute_behavior", {
            "ontology_id": 1,
            "behavior_name": "_test_nonexistent_behavior_",
            "params": {},
        })
        text = result.content[0].text
        print(f"     返回: {text[:300]}")
        # 期望返回 404 或者 error，但不应该崩溃
        if "error" in text.lower() or "404" in text or "not found" in text.lower():
            ok("不存在的行为返回了错误信息（预期行为）")
        else:
            fail("execute_behavior 对不存在行为返回异常", text)

        # ─── 11. 测试传参验证 ──────────────────────────────
        print("\n[11] 参数校验 -- 缺少必需参数 ontology_id")
        try:
            result = await session.call_tool("list_behaviors", {})
            data = json.loads(result.content[0].text)
            print(f"     返回: {json.dumps(data, ensure_ascii=False)[:200]}")
        except Exception as e:
            ok(f"缺少参数时抛出异常（框架层行为）: {str(e)[:100]}")

    # ─── 汇总 ────────────────────────────────────────────────
    total = passed + failed
    print(f"\n{'='*50}")
    print(f"   测试完成: {total} 项 | PASS: {passed}  FAIL: {failed}")
    print(f"{'='*50}")
    return failed == 0

if __name__ == "__main__":
    success = asyncio.run(test())
    sys.exit(0 if success else 1)
