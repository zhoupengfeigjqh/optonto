"""spec 003 端到端验收脚本（一次性；跑完即删）。

覆盖：关系类型 / 概念术语集 / 函数类型 / 生命周期状态属性 / 行为状态跃迁 /
规则「实例自身」与条件树 / 两处数组→标量迁移 / 历史版本快照加载 / 存量数据回归。

用法：python scripts/_e2e_spec003.py
"""

import json
import time
import urllib.error
import urllib.request
from pathlib import Path

CORE = "http://localhost:8001/api"
ROOT = Path(__file__).resolve().parent.parent
MARKET = ROOT / ".data" / "onto_market"
SC = "e2e-spec003-tmp"
ON = "tmponto"

PASS, FAIL = [], []


def req(method, url, body=None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    r = urllib.request.Request(url, data=data,
                              headers={"Content-Type": "application/json"}, method=method)
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            raw = resp.read().decode("utf-8")
            return resp.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        try:
            return e.code, json.loads(raw)
        except Exception:
            return e.code, {"_body": raw[:300]}


def check(label, cond, extra=""):
    (PASS if cond else FAIL).append(label)
    print(f"  [{'OK' if cond else 'NG'}] {label}{'' if cond else '  <<< ' + str(extra)}")


def main():
    ts = int(time.time())
    print("== 0. 建隔离临时场景/本体 ==")
    # 清理上次中断留下的同名场景（幂等）
    s, existing = req("GET", f"{CORE}/scenarios")
    for sc0 in (existing or []):
        if sc0.get("name") == SC:
            req("DELETE", f"{CORE}/scenarios/{sc0['id']}")
    s, sc = req("POST", f"{CORE}/scenarios", {"name": SC, "description": "spec003 e2e 临时场景"})
    check("创建临时场景", s in (200, 201), (s, sc))
    sid = sc["id"]
    s, onto = req("POST", f"{CORE}/ontologies", {"scenario_id": sid, "name": ON})
    check("创建临时本体", s in (200, 201), (s, onto))
    oid = onto["id"]

    # ── 批次 A ───────────────────────────────────────────────────────────
    print("\n== 1. 概念 + 术语集 + 生命周期状态属性 ==")
    s, _ = req("POST", f"{CORE}/ontologies/{oid}/concepts",
               {"name": "PurchaseRecord", "display_name": "采购单", "description": "采购单",
                "terms": ["采购订单", "PO", "采购订单", " 采购单 "]})
    check("创建概念（术语集含重复/空白）", s in (200, 201), s)
    s, concepts = req("GET", f"{CORE}/ontologies/{oid}/concepts")
    c0 = concepts[0]
    check("术语集去重去空", c0.get("terms") == ["采购订单", "PO", "采购单"], c0.get("terms"))

    s, d = req("PUT", f"{CORE}/ontologies/{oid}/concepts/PurchaseRecord/attributes", [
        {"name": "purchaseRecordId", "type": "string"},
        {"name": "arrivalQuantity", "type": "number"},
        {"name": "status", "type": "string",
         "constraint": {"enum": ["待入库", "已入库", "已取消"], "required": True}},
    ])
    check("写入 status 属性（string + 枚举）", s == 200, (s, d))

    s, d = req("PUT", f"{CORE}/ontologies/{oid}/concepts/PurchaseRecord/attributes", [
        {"name": "status", "type": "number", "constraint": {"enum": [1, 2]}},
    ])
    check("status 属性非 string → 400", s == 400, (s, d))

    s, d = req("PUT", f"{CORE}/ontologies/{oid}/concepts/PurchaseRecord/attributes", [
        {"name": "status", "type": "string"},
    ])
    check("status 属性枚举为空 → 400", s == 400, (s, d))

    s, d = req("PUT", f"{CORE}/ontologies/{oid}/concepts/PurchaseRecord/attributes", [
        {"name": "status", "type": "string", "constraint": {"enum": ["待入库", "已入库", "已取消"], "required": True}},
        {"name": "status", "type": "string", "constraint": {"enum": ["A"]}},
    ])
    check("多个 status 属性 → 400", s == 400, (s, d))

    # 恢复合法属性
    req("PUT", f"{CORE}/ontologies/{oid}/concepts/PurchaseRecord/attributes", [
        {"name": "purchaseRecordId", "type": "string"},
        {"name": "arrivalQuantity", "type": "number"},
        {"name": "status", "type": "string",
         "constraint": {"enum": ["待入库", "已入库", "已取消"], "required": True}},
    ])

    print("\n== 2. 关系类型（多选 + 非法值丢弃） ==")
    s, rel = req("POST", f"{CORE}/ontologies/{oid}/relations",
                 {"name": "recordsRawMaterial", "source": "PurchaseRecord", "target": "PurchaseRecord",
                  "cardinality": "N:1", "relation_type": ["functional", "transitive", "bogus", 42],
                  "source_attr": "purchaseRecordId", "target_attr": "purchaseRecordId",
                  "description": "测试关系"})
    check("创建关系", s in (200, 201), (s, rel))
    check("关系类型过滤非法值", rel and rel.get("relation_type") == ["functional", "transitive"],
          rel and rel.get("relation_type"))

    print("\n== 3. 函数类型（英文码 + 值域归一） ==")
    fn = f"e2eCheckUnit_{ts}"
    s, f1 = req("POST", f"{CORE}/ontologies/{oid}/functions",
                {"name": fn, "display_name": "单位校验", "description": "e2e",
                 "related_concepts": ["PurchaseRecord"], "params": {"x": {"type": "string"}},
                 "response": {"pass": {"type": "boolean"}, "reason": {"type": "string"}}, "code_file": f"functions/{fn}.py",
                 "type": "VALIDATION"})
    check("创建函数（type=VALIDATION）", s in (200, 201) and f1.get("type") == "VALIDATION", (s, f1))

    s, f2 = req("POST", f"{CORE}/ontologies/{oid}/functions",
                {"name": fn + "_b", "display_name": "非法类型", "description": "e2e",
                 "related_concepts": [], "params": {}, "response": {},
                 "code_file": "", "type": "格式转换"})
    check("函数类型非法值归一为空串", s in (200, 201) and f2.get("type") == "", (s, f2))

    # ── 批次 B ───────────────────────────────────────────────────────────
    print("\n== 4. 行为状态跃迁（强耦合校验） ==")
    s, b1 = req("POST", f"{CORE}/ontologies/{oid}/behaviors",
                {"name": "ReceiveRawMaterial", "display_name": "入库", "description": "入库",
                 "op_type": "command", "concept": "PurchaseRecord",
                 "from_status": "待入库", "to_status": "已入库",
                 "params": {}, "response": {}})
    check("创建 command 行为（合法跃迁）", s in (200, 201) and b1.get("concept") == "PurchaseRecord", (s, b1))

    s, d = req("POST", f"{CORE}/ontologies/{oid}/behaviors",
               {"name": "CancelPurchaseRecord", "op_type": "command", "concept": "PurchaseRecord",
                "from_status": "待入库", "to_status": "不存在的状态", "params": {}, "response": {}})
    check("目标状态越界 → 400", s == 400, (s, d))

    s, d = req("POST", f"{CORE}/ontologies/{oid}/behaviors",
               {"name": "Bad1", "op_type": "command", "concept": "NotExists", "params": {}, "response": {}})
    check("关联概念不存在 → 400", s == 400, (s, d))

    s, d = req("POST", f"{CORE}/ontologies/{oid}/behaviors",
               {"name": "Bad2", "op_type": "command", "concept": "", "from_status": "待入库",
                "params": {}, "response": {}})
    check("声明状态但无关联概念 → 400", s == 400, (s, d))

    s, b2 = req("POST", f"{CORE}/ontologies/{oid}/behaviors",
                {"name": "QueryPurchaseRecords", "display_name": "查采购单", "op_type": "query",
                 "concept": "PurchaseRecord", "params": {"id": {"type": "string", "required": True}},
                 "response": {}})
    check("创建 query 行为（不填状态）", s in (200, 201) and b2.get("from_status") == "", (s, b2))

    print("\n== 5. 规则：绑定行为 + 关联函数（判断函数） ==")
    # 规则字段白名单：任何已废弃/遗留的字段都不允许出现（比逐字段断言更严）
    allowed_rule_keys = {"name", "description", "display_name", "position",
                         "behavior", "related_functions", "data_supplements"}
    s, r1 = req("POST", f"{CORE}/ontologies/{oid}/rules",
                {"name": "V01_UnitCheck", "display_name": "单位一致性校验", "description": "e2e",
                 "behavior": "ReceiveRawMaterial", "related_functions": [fn], "position": "前置"})
    check("创建规则（行为标量 + 关联函数）", s in (200, 201) and r1.get("behavior") == "ReceiveRawMaterial", (s, r1))
    check("规则字段无遗留键（仅白名单字段）", set(r1) <= allowed_rule_keys, sorted(r1))

    s, rules = req("GET", f"{CORE}/ontologies/{oid}/rules")
    check("关联函数往返无损", rules[0].get("related_functions") == [fn], rules[0].get("related_functions"))
    check("binding 单值无 related_behaviors 字段", "related_behaviors" not in rules[0], list(rules[0]))

    s, d = req("POST", f"{CORE}/ontologies/{oid}/rules",
               {"name": "Bad_UnknownFn", "position": "前置", "behavior": "ReceiveRawMaterial",
                "related_functions": ["NotExistsFunction"]})
    check("关联函数不存在 → 400", s == 400, (s, d))

    print("\n== 6. 落盘文件结构 ==")
    yml = (MARKET / SC / ON / "ontology.yaml").read_text(encoding="utf-8")
    check("概念段含 terms", "terms:" in yml)
    check("关系段含 relation_type", "relation_type:" in yml)
    check("函数段含 type", "\n  type: VALIDATION" in yml)
    beh_section = yml.split("behaviors:")[1].split("rules:")[0]
    check("行为段用标量 concept", "concept: PurchaseRecord" in beh_section and "related_concepts:" not in beh_section,
          beh_section[:200])
    check("函数段仍保留 related_concepts 数组（本轮不变）",
          "related_concepts:" in yml.split("functions:")[1].split("behaviors:")[0])
    check("行为段含状态跃迁", "from_status: 待入库" in yml and "to_status: 已入库" in yml)
    check("规则段用标量 behavior + 关联函数",
          "behavior: ReceiveRawMaterial" in yml and "related_functions:" in yml and "related_behaviors:" not in yml)
    check("规则段无遗留条件树结构（children/logic 均不得出现）",
          "children:" not in yml and "logic:" not in yml)

    # ── 存量数据回归 ──────────────────────────────────────────────────────
    print("\n== 7. 存量数据回归（旧格式读时迁移） ==")
    s, live_behaviors = req("GET", f"{CORE}/ontologies/1/behaviors")
    check("存量本体行为可读", s == 200 and len(live_behaviors) > 0, s)
    live_b = next((b for b in live_behaviors if b["name"] == "CancelPurchaseRecord"), None)
    check("旧 related_concepts 数组迁移为标量 concept",
          live_b is not None and live_b.get("concept") == "PurchaseRecord", live_b)
    check("存量行为无 from/to 仍可读（空串）", live_b is not None and live_b.get("from_status") == "", live_b)

    s, live_rules = req("GET", f"{CORE}/ontologies/1/rules")
    live_r = next((r for r in live_rules if r["name"] == "V01_UnitConsistency_Purchase"), None)
    check("旧 related_behaviors 数组迁移为标量 behavior",
          live_r is not None and live_r.get("behavior") == "CreatePurchaseRecord", live_r)

    s, d = req("GET", f"{CORE}/ontologies/1/deploy/version-preview?version=v1.0")
    check("历史版本快照 v1.0 可加载", s == 200, (s, str(d)[:160]))

    # ── 清理 ─────────────────────────────────────────────────────────────
    print("\n== 8. 清理临时数据 ==")
    req("DELETE", f"{CORE}/ontologies/{oid}")
    req("DELETE", f"{CORE}/scenarios/{sid}")
    time.sleep(1.5)
    check("临时目录已清除", not (MARKET / SC).exists())
    s, scs = req("GET", f"{CORE}/scenarios")
    check("场景数还原（1 个）", s == 200 and len(scs) == 1, [x["name"] for x in scs])
    s, onts = req("GET", f"{CORE}/ontologies")
    check("本体数还原（4 个）", s == 200 and len(onts) == 4, len(onts))

    print(f"\n===== 结果：{len(PASS)} 通过 / {len(FAIL)} 失败 =====")
    if FAIL:
        for f in FAIL:
            print("  FAIL:", f)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
