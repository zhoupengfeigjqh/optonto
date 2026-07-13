"""Script to create the production scheduling ontologies on the OPTONTO platform.
Run from project root with: python scripts/create_ontologies.py
"""

import json
import urllib.request
import urllib.error
import sys

API = "http://localhost:8000/api"

def req(method, path, data=None):
    url = f"{API}{path}"
    body = json.dumps(data, ensure_ascii=False).encode("utf-8") if data else None
    r = urllib.request.Request(url, data=body, method=method)
    r.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(r) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        err = e.read().decode()
        print(f"  ERROR {method} {path}: {err}")
        return None

def create_scenario(name, desc):
    print(f"\n=== Creating scenario: {name} ===")
    r = req("POST", "/scenarios", {"name": name, "description": desc})
    if r: print(f"  Scenario ID: {r['id']}")
    return r["id"] if r else None

def create_ontology(scenario_id, name, desc, creator="system"):
    print(f"\n=== Creating ontology: {name} ===")
    r = req("POST", "/ontologies", {"scenario_id": scenario_id, "name": name, "description": desc, "creator": creator})
    if r: print(f"  Ontology ID: {r['id']}")
    return r["id"] if r else None

def add_concepts(oid, concepts):
    for c in concepts:
        r = req("POST", f"/ontologies/{oid}/concepts", c)
        if r: print(f"  Concept: {c['name']} OK")
        else: print(f"  Concept: {c['name']} FAILED")

def add_relations(oid, relations):
    for rl in relations:
        r = req("POST", f"/ontologies/{oid}/relations", rl)
        if r: print(f"  Relation: {rl['name']} OK")
        else: print(f"  Relation: {rl['name']} FAILED")

def add_behaviors(oid, behaviors):
    for b in behaviors:
        r = req("POST", f"/ontologies/{oid}/behaviors", b)
        if r: print(f"  Behavior: {b['name']} OK")
        else: print(f"  Behavior: {b['name']} FAILED")

def add_rules(oid, rules):
    for rl in rules:
        r = req("POST", f"/ontologies/{oid}/rules", rl)
        if r: print(f"  Rule: {rl['name']} OK")
        else: print(f"  Rule: {rl['name']} FAILED")

def add_events(oid, events):
    for e in events:
        r = req("POST", f"/ontologies/{oid}/events", e)
        if r: print(f"  Event: {e['name']} OK")
        else: print(f"  Event: {e['name']} FAILED")

def add_business_processes(oid, processes):
    for p in processes:
        r = req("POST", f"/ontologies/{oid}/business-processes", p)
        if r: print(f"  BP: {p['name']} OK")
        else: print(f"  BP: {p['name']} FAILED")


# ===========================================================================
# Step 1: Create scenario
# ===========================================================================
scenario_id = create_scenario("生产调度", "生产调度场景，涵盖原材料管理、订单排程、资源管理和货品BOM及工艺")
if not scenario_id:
    print("FAILED to create scenario, exiting")
    sys.exit(1)

# ===========================================================================
# Step 2: 原材料本体
# ===========================================================================
oid_rm = create_ontology(scenario_id, "原材料", "生产过程中消耗的外部输入物料，需采购和考虑库存")
if oid_rm:
    add_concepts(oid_rm, [
        {"name": "原材料", "description": "生产过程中消耗的外部输入物料，需采购和考虑库存",
         "attributes": [
             {"name": "原材料编号", "type": "string", "required": True},
             {"name": "原材料名称", "type": "string", "required": True},
             {"name": "单位", "type": "string", "required": True},
             {"name": "安全库存", "type": "number", "required": True},
         ]},
        {"name": "原材料库存", "description": "原材料当前的待入库、可用库存和累计库存",
         "attributes": [
             {"name": "原材料编号", "type": "string", "required": True},
             {"name": "原材料名称", "type": "string", "required": True},
             {"name": "材料类型", "type": "string", "required": True},
             {"name": "待入库量", "type": "number", "required": True},
             {"name": "累计库存量", "type": "number", "required": True},
             {"name": "可用库存", "type": "number", "required": True},
             {"name": "单位", "type": "string", "required": True},
         ]},
        {"name": "原材料采购记录", "description": "原材料的采购记录，关联供应商和客户订单",
         "attributes": [
             {"name": "采购单号", "type": "string", "required": True},
             {"name": "原材料编号", "type": "string", "required": True},
             {"name": "原材料名称", "type": "string", "required": True},
             {"name": "采购时间", "type": "date", "required": True},
             {"name": "到位时间", "type": "date", "required": True},
             {"name": "到位数量", "type": "number", "required": True},
             {"name": "单位", "type": "string", "required": True},
             {"name": "等待周期", "type": "number", "required": True},
             {"name": "供应商名称", "type": "string", "required": True},
             {"name": "关联订单编号", "type": "string", "required": False},
             {"name": "关联订单名称", "type": "string", "required": False},
         ]},
        {"name": "供应商", "description": "原材料的供应方",
         "attributes": [
             {"name": "供应商名称", "type": "string", "required": True},
             {"name": "地址", "type": "string", "required": False},
             {"name": "联系人", "type": "string", "required": False},
             {"name": "联系电话", "type": "string", "required": False},
             {"name": "原材料编号", "type": "string", "required": True},
             {"name": "原材料名称", "type": "string", "required": True},
             {"name": "采购周期", "type": "number", "required": True},
         ]},
        {"name": "客户订单", "description": "客户的销售订单或询单，驱动原材料采购的源头",
         "attributes": [
             {"name": "订单编号", "type": "string", "required": True},
             {"name": "订单名称", "type": "string", "required": True},
             {"name": "订单批次号", "type": "string", "required": False},
             {"name": "订单缓冲周期", "type": "number", "required": False},
             {"name": "订单类型", "type": "string", "required": True},
         ]},
    ])

    add_relations(oid_rm, [
        {"name": "hasRawInventory", "source": "原材料", "target": "原材料库存", "cardinality": "1:1", "description": "每个原材料对应一条库存快照"},
        {"name": "recordsRawMaterial", "source": "原材料采购记录", "target": "原材料", "cardinality": "N:1", "description": "1个原材料可有多个采购，1个采购记录只关联1个原材料"},
        {"name": "orderedFromSupplier", "source": "原材料采购记录", "target": "供应商", "cardinality": "N:1", "description": "1个供应商对应多个采购单，1个采购单只有1个供应商"},
        {"name": "suppliesRawMaterial", "source": "供应商", "target": "原材料", "cardinality": "N:M", "description": "1个供应商可供应多个原材料，1个原材料可来自多个供应商"},
        {"name": "containsPurchaseRecord", "source": "客户订单", "target": "原材料采购记录", "cardinality": "1:N", "description": "1个采购记录最多关联1个订单，1个订单可关联多个采购记录"},
    ])

    add_behaviors(oid_rm, [
        {"name": "创建原材料采购单", "type": "CREATE", "description": "智能体或用户创建原材料采购订单", "protocol": "HTTP", "url": "/api/purchase/create", "method": "POST", "params": {"rawMaterialId": "string", "rawMaterialName": "string", "quantity": "number", "supplier": "string", "deliveryDate": "string", "customerOrderId": "string"}, "related_concepts": ["原材料", "供应商", "客户订单"]},
        {"name": "取消原材料采购单", "type": "DELETE", "description": "智能体或用户取消原材料采购订单", "protocol": "HTTP", "url": "/api/purchase/cancel", "method": "POST", "params": {"purchaseId": "string"}, "related_concepts": ["原材料采购记录"]},
        {"name": "入库原材料", "type": "UPDATE", "description": "智能体或用户确认原材料到货入库", "protocol": "HTTP", "url": "/api/purchase/warehouse", "method": "POST", "params": {"purchaseId": "string"}, "related_concepts": ["原材料采购记录", "原材料库存"]},
        {"name": "查询原材料库存信息", "type": "READ", "description": "智能体或用户查询原材料库存", "protocol": "HTTP", "url": "/api/inventory/raw-material", "method": "GET", "params": {"rawMaterialId": "string", "rawMaterialName": "string"}, "related_concepts": ["原材料库存"]},
        {"name": "查询原材料采购单信息", "type": "READ", "description": "智能体或用户查询原材料采购单", "protocol": "HTTP", "url": "/api/purchase/orders", "method": "GET", "params": {"purchaseId": "string", "rawMaterialId": "string", "rawMaterialName": "string"}, "related_concepts": ["原材料采购记录"]},
        {"name": "查询原材料基本信息", "type": "READ", "description": "智能体或用户查询原材料基本信息", "protocol": "HTTP", "url": "/api/raw-material", "method": "GET", "params": {"rawMaterialId": "string", "rawMaterialName": "string"}, "related_concepts": ["原材料"]},
        {"name": "查询供应商信息", "type": "READ", "description": "智能体或用户查询供应商信息", "protocol": "HTTP", "url": "/api/suppliers", "method": "GET", "params": {"supplierName": "string", "rawMaterialId": "string"}, "related_concepts": ["供应商"]},
    ])

    add_rules(oid_rm, [
        {"name": "采购-原料单位一致性", "description": "采购记录.单位 必须等于 原材料.单位", "related_concepts": ["原材料采购记录", "原材料"]},
        {"name": "库存-原料单位一致性", "description": "库存.单位 必须等于 原材料.单位", "related_concepts": ["原材料库存", "原材料"]},
        {"name": "到位时间合理性", "description": "到位时间 > 采购时间", "related_concepts": ["原材料采购记录"]},
        {"name": "采购-原料存在性", "description": "采购记录.原材料名称 必须存在于 原材料", "related_concepts": ["原材料采购记录", "原材料"]},
        {"name": "采购-供应商存在性", "description": "采购记录.供应商名称 必须存在于 供应商", "related_concepts": ["原材料采购记录", "供应商"]},
        {"name": "采购-订单存在性", "description": "采购记录.关联订单编号非空时，必须存在于 客户订单", "related_concepts": ["原材料采购记录", "客户订单"]},
        {"name": "安全库存预警", "description": "库存.可用库存量 < 原材料.安全库存，推送原材料采购或转库存预警", "related_concepts": ["原材料库存", "原材料"]},
        {"name": "采购到位超期预警", "description": "当前日期 >= 采购记录.到位时间，提示用户是否启动入库操作", "related_concepts": ["原材料采购记录"]},
        {"name": "采购目的推理", "description": "采购记录.关联订单编号为空 -> 该采购为补充库存", "related_concepts": ["原材料采购记录", "客户订单"]},
        {"name": "采购关联订单校验", "description": "采购记录.关联订单编号不在客户订单表中 -> 提示用户该客户订单可能已取消", "related_concepts": ["原材料采购记录", "客户订单"]},
    ])

    add_events(oid_rm, [
        {"name": "采购订单创建事件", "description": "原材料采购订单创建", "related_behavior": "创建原材料采购单", "trigger_behavior": "查询原材料库存信息"},
        {"name": "采购订单取消事件", "description": "原材料采购订单取消", "related_behavior": "取消原材料采购单", "trigger_behavior": "查询原材料库存信息"},
        {"name": "原材料入库事件", "description": "原材料入库确认", "related_behavior": "入库原材料", "trigger_behavior": "查询原材料库存信息"},
    ])

# ===========================================================================
# Step 3: 订单排程本体
# ===========================================================================
oid_os = create_ontology(scenario_id, "订单排程", "客户订单排程管理，涵盖订单、排产任务、排产结果和算法参数")
if oid_os:
    add_concepts(oid_os, [
        {"name": "订单", "description": "客户销售订单或询单，包含订单头信息",
         "attributes": [
             {"name": "订单编号", "type": "string", "required": True},
             {"name": "订单名称", "type": "string", "required": True},
             {"name": "订单批次号", "type": "string", "required": False},
             {"name": "订单缓冲周期", "type": "number", "required": False},
             {"name": "订单类型", "type": "string", "required": True},
         ]},
        {"name": "订单明细", "description": "订单的具体行项，记录需要交付的货品、数量和交期",
         "attributes": [
             {"name": "订单编号", "type": "string", "required": True},
             {"name": "货品编号", "type": "string", "required": True},
             {"name": "货品名称", "type": "string", "required": True},
             {"name": "起排日期", "type": "date", "required": True},
             {"name": "截止日期", "type": "date", "required": True},
             {"name": "交付数量", "type": "number", "required": True},
             {"name": "优先级", "type": "string", "required": True},
         ]},
        {"name": "货品", "description": "企业生产输出的物料，包含成品和半成品",
         "attributes": [
             {"name": "货品编号", "type": "string", "required": True},
             {"name": "货品名称", "type": "string", "required": True},
             {"name": "货品大类", "type": "string", "required": True},
             {"name": "物料类型", "type": "string", "required": True},
             {"name": "主单位", "type": "string", "required": True},
             {"name": "副单位", "type": "string", "required": False},
             {"name": "主副单位换算比", "type": "number", "required": False},
             {"name": "管理部门", "type": "string", "required": False},
             {"name": "生产部门", "type": "string", "required": False},
             {"name": "预设仓库", "type": "string", "required": False},
             {"name": "规格", "type": "string", "required": False},
         ]},
        {"name": "BOM基本信息", "description": "生产该货品所需的物料清单",
         "attributes": [
             {"name": "BOM编号", "type": "string", "required": True},
             {"name": "BOM名称", "type": "string", "required": True},
             {"name": "货品编号", "type": "string", "required": True},
             {"name": "货品名称", "type": "string", "required": True},
             {"name": "BOM版本", "type": "string", "required": False},
         ]},
        {"name": "排产任务", "description": "根据订单创建的生产排程任务",
         "attributes": [
             {"name": "订单编号", "type": "string", "required": True},
             {"name": "订单名称", "type": "string", "required": True},
             {"name": "排产任务编号", "type": "string", "required": True},
             {"name": "排产任务名称", "type": "string", "required": True},
             {"name": "排产任务描述", "type": "string", "required": False},
             {"name": "排产场景", "type": "string", "required": False},
             {"name": "任务状态", "type": "string", "required": True},
         ]},
        {"name": "排产结果", "description": "排产任务执行后产出的调度方案及关键指标",
         "attributes": [
             {"name": "排产任务编号", "type": "string", "required": True},
             {"name": "排产任务名称", "type": "string", "required": True},
             {"name": "排产场景", "type": "string", "required": False},
             {"name": "方案名称", "type": "string", "required": True},
             {"name": "方案状态", "type": "string", "required": True},
             {"name": "总产品数量", "type": "number", "required": False},
             {"name": "总工序数量", "type": "number", "required": False},
             {"name": "平均生产周期", "type": "number", "required": False},
             {"name": "延期工件数量", "type": "number", "required": False},
             {"name": "延期率", "type": "number", "required": False},
             {"name": "总加工成本", "type": "number", "required": False},
             {"name": "总利润", "type": "number", "required": False},
             {"name": "设备平均利用率", "type": "number", "required": False},
         ]},
        {"name": "欠料明细", "description": "下发排产结果与当前库存对比后得出的缺料清单",
         "attributes": [
             {"name": "排产任务编号", "type": "string", "required": True},
             {"name": "排产任务名称", "type": "string", "required": True},
             {"name": "排产场景", "type": "string", "required": False},
             {"name": "原材料编号", "type": "string", "required": True},
             {"name": "原材料名称", "type": "string", "required": True},
         ]},
        {"name": "算法参数", "description": "排产任务的优化目标参数，定义排产策略和约束",
         "attributes": [
             {"name": "排产任务编号", "type": "string", "required": True},
             {"name": "排产任务名称", "type": "string", "required": True},
             {"name": "排产方式", "type": "string", "required": True},
             {"name": "设备利用率目标", "type": "string", "required": False},
             {"name": "订单交期目标", "type": "string", "required": False},
             {"name": "加工成本最低", "type": "string", "required": False},
             {"name": "使用剩余产能", "type": "string", "required": False},
             {"name": "附件转换率最低", "type": "string", "required": False},
         ]},
    ])

    add_relations(oid_os, [
        {"name": "hasDetail", "source": "订单", "target": "订单明细", "cardinality": "1:N", "description": "1个订单含多个明细项"},
        {"name": "hasProduct", "source": "订单明细", "target": "货品", "cardinality": "N:1", "description": "1个订单明细只包含1个货品"},
        {"name": "hasBOM", "source": "货品", "target": "BOM基本信息", "cardinality": "1:1", "description": "1个货品有1个BOM"},
        {"name": "drivesScheduling", "source": "订单", "target": "排产任务", "cardinality": "1:N", "description": "1个订单可以产生多个排产任务"},
        {"name": "producesPlan", "source": "排产任务", "target": "排产结果", "cardinality": "1:1", "description": "1个排产任务产出1个排产结果"},
        {"name": "hasShortageDetail", "source": "排产结果", "target": "欠料明细", "cardinality": "1:N", "description": "1个排产结果对应多个原料欠料明细"},
        {"name": "hasScheduleParams", "source": "排产任务", "target": "算法参数", "cardinality": "1:1", "description": "1个排产任务有1组算法参数"},
        {"name": "hasVersionDerivative", "source": "排产任务", "target": "排产任务", "cardinality": "1:N", "description": "排产任务的版本派生关系"},
    ])

    add_behaviors(oid_os, [
        {"name": "创建订单", "type": "CREATE", "description": "用户或智能体创建新的订单及其明细", "protocol": "HTTP", "url": "/api/orders", "method": "POST", "params": {"orderName": "string", "orderBatch": "string", "orderType": "string", "orderDetails": "array"}, "related_concepts": ["订单", "订单明细"]},
        {"name": "订单更新", "type": "UPDATE", "description": "用户或智能体更新已有订单信息及明细", "protocol": "HTTP", "url": "/api/orders", "method": "PUT", "params": {"orderId": "string", "orderName": "string"}, "related_concepts": ["订单", "订单明细"]},
        {"name": "订单删除", "type": "DELETE", "description": "用户或智能体删除已有订单及明细", "protocol": "HTTP", "url": "/api/orders", "method": "DELETE", "params": {"orderId": "string"}, "related_concepts": ["订单"]},
        {"name": "查询订单", "type": "READ", "description": "用户或智能体查询订单及明细", "protocol": "HTTP", "url": "/api/orders", "method": "GET", "params": {"orderId": "string", "orderName": "string"}, "related_concepts": ["订单", "订单明细"]},
        {"name": "创建排产任务", "type": "CREATE", "description": "用户或智能体根据订单信息创建排产任务", "protocol": "HTTP", "url": "/api/scheduling/tasks", "method": "POST", "params": {"orderId": "string"}, "related_concepts": ["订单", "排产任务"]},
        {"name": "新增排产任务", "type": "CREATE", "description": "基于已有排产任务创建新场景下的排产任务", "protocol": "HTTP", "url": "/api/scheduling/scenarios", "method": "POST", "params": {"scheduleId": "string", "scenario": "string"}, "related_concepts": ["排产任务"]},
        {"name": "创建算法参数", "type": "CREATE", "description": "用户或智能体为排产任务创建算法参数", "protocol": "HTTP", "url": "/api/scheduling/params", "method": "POST", "params": {"scheduleId": "string"}, "related_concepts": ["排产任务", "算法参数"]},
        {"name": "启动排产任务", "type": "CREATE", "description": "用户或智能体选择排产任务并执行", "protocol": "HTTP", "url": "/api/scheduling/execute", "method": "POST", "params": {"scheduleId": "string"}, "related_concepts": ["排产任务"]},
        {"name": "查询排产任务", "type": "READ", "description": "用户或智能体查询排产任务的当前状态", "protocol": "HTTP", "url": "/api/scheduling/tasks/status", "method": "GET", "params": {"scheduleId": "string", "orderId": "string"}, "related_concepts": ["排产任务"]},
        {"name": "查询排产结果", "type": "READ", "description": "用户或智能体查询排产任务结果", "protocol": "HTTP", "url": "/api/scheduling/results", "method": "GET", "params": {"scheduleId": "string", "orderId": "string"}, "related_concepts": ["排产结果"]},
        {"name": "排产结果下发", "type": "UPDATE", "description": "用户或智能体将已成功执行的排产任务下发", "protocol": "HTTP", "url": "/api/scheduling/tasks/deploy", "method": "POST", "params": {"scheduleId": "string"}, "related_concepts": ["排产任务", "排产结果"]},
        {"name": "排产结果撤回", "type": "UPDATE", "description": "用户或智能体取消已下发的排产结果", "protocol": "HTTP", "url": "/api/scheduling/plans/deploy/cancel", "method": "POST", "params": {"scheduleId": "string"}, "related_concepts": ["排产任务", "排产结果"]},
        {"name": "查询排产结果欠料明细", "type": "READ", "description": "用户或智能体查询订单下发后的齐套欠料信息", "protocol": "HTTP", "url": "/api/material/shortages", "method": "GET", "params": {"scheduleId": "string", "orderId": "string"}, "related_concepts": ["欠料明细"]},
        {"name": "启动排产查询定时任务", "type": "CREATE", "description": "后台启动定时任务轮询排产任务状态", "protocol": "HTTP", "url": "/api/scheduling/poll/start", "method": "POST", "params": {"scheduleId": "string", "intervalMinutes": "number", "checkCnt": "number"}, "related_concepts": ["排产任务"]},
    ])

    add_rules(oid_os, [
        {"name": "订单创建-订单类型", "description": "订单明细.类型 只能是询单或销售二选一", "related_concepts": ["订单"]},
        {"name": "订单明细-货品存在性", "description": "订单明细.货品编号和货品名称 必须存在于 货品", "related_concepts": ["订单明细", "货品"]},
        {"name": "订单明细-截止日期约束", "description": "订单明细.截止日期 > 订单明细.起排日期", "related_concepts": ["订单明细"]},
        {"name": "订单明细-交付数量约束", "description": "订单明细.交付数量 > 0", "related_concepts": ["订单明细"]},
        {"name": "订单明细-优先级约束", "description": "订单明细.优先级 只能是按期交付或可延期交付", "related_concepts": ["订单明细"]},
        {"name": "订单更新-未排产约束", "description": "订单更新时，该订单必须未创建排产任务，否则拒绝", "related_concepts": ["订单", "排产任务"]},
        {"name": "订单删除-未排产约束", "description": "订单删除时，该订单必须未创建排产任务，否则拒绝", "related_concepts": ["订单", "排产任务"]},
        {"name": "创建排产任务-唯一性约束", "description": "创建排产任务时，该订单只能创建一次排产任务", "related_concepts": ["订单", "排产任务"]},
        {"name": "新增排产任务-状态约束", "description": "新增排产任务时，排产任务状态需为已排产", "related_concepts": ["排产任务"]},
        {"name": "启动排产任务-状态约束", "description": "启动排产任务时，还未开启排产", "related_concepts": ["排产任务", "算法参数"]},
        {"name": "排产结果下发-状态约束", "description": "排产结果下发时，排产任务为已排产，方案状态为未锁定", "related_concepts": ["排产任务", "排产结果"]},
        {"name": "排产结果撤回-状态约束", "description": "排产结果撤回时，方案状态为已下发", "related_concepts": ["排产任务", "排产结果"]},
        {"name": "已排产完成后可新增排产任务", "description": "排产任务.任务状态=已排产 -> 可新增场景任务", "related_concepts": ["排产任务", "排产结果"]},
        {"name": "排产结果成功下发后提示查欠料", "description": "排产结果.方案状态=已下发 -> 提示查欠料", "related_concepts": ["排产结果", "欠料明细"]},
        {"name": "订单创建后提示排产", "description": "订单创建成功 -> 提示可对该订单创建排产任务", "related_concepts": ["订单", "排产任务"]},
        {"name": "排产启动后提示等待", "description": "排产任务启动 -> 提示等待结果", "related_concepts": ["排产任务", "排产结果"]},
    ])

    add_events(oid_os, [
        {"name": "订单创建事件", "description": "订单创建成功", "related_behavior": "创建订单"},
        {"name": "订单更新事件", "description": "订单更新成功", "related_behavior": "订单更新"},
        {"name": "订单删除事件", "description": "订单删除成功", "related_behavior": "订单删除"},
        {"name": "排产任务创建事件", "description": "排产任务创建成功", "related_behavior": "创建排产任务", "trigger_behavior": "查询排产任务"},
        {"name": "新增排产任务事件", "description": "新增排产场景成功", "related_behavior": "新增排产任务", "trigger_behavior": "查询排产任务"},
        {"name": "排产任务启动事件", "description": "排产任务启动成功", "related_behavior": "启动排产任务", "trigger_behavior": "启动排产查询定时任务"},
        {"name": "排产结果下发事件", "description": "排产结果下发成功", "related_behavior": "排产结果下发", "trigger_behavior": "查询排产结果欠料明细"},
        {"name": "排产结果撤回事件", "description": "排产结果撤回成功", "related_behavior": "排产结果撤回"},
        {"name": "算法参数创建事件", "description": "算法参数创建成功", "related_behavior": "创建算法参数"},
    ])

# ===========================================================================
# Step 4: 资源本体
# ===========================================================================
oid_res = create_ontology(scenario_id, "资源", "生产资源管理，涵盖设备、人员、日历、班次和异常记录")
if oid_res:
    add_concepts(oid_res, [
        {"name": "设备", "description": "生产加工用的机器或产线",
         "attributes": [
             {"name": "设备组名称", "type": "string", "required": False},
             {"name": "设备编号", "type": "string", "required": True},
             {"name": "设备名称", "type": "string", "required": True},
             {"name": "所属部门", "type": "string", "required": False},
             {"name": "负荷率上限", "type": "number", "required": False},
             {"name": "资源费率", "type": "number", "required": False},
             {"name": "是否公用", "type": "boolean", "required": False},
         ]},
        {"name": "设备组", "description": "同类型或同工作中心的设备集合",
         "attributes": [
             {"name": "设备组编号", "type": "string", "required": True},
             {"name": "设备组名称", "type": "string", "required": True},
             {"name": "资源制约", "type": "boolean", "required": False},
             {"name": "组批工时是否按单件工时", "type": "boolean", "required": False},
             {"name": "是否炉内资源", "type": "boolean", "required": False},
         ]},
        {"name": "人员", "description": "参与生产的操作工或技术工",
         "attributes": [
             {"name": "人员组名称", "type": "string", "required": False},
             {"name": "人员编号", "type": "string", "required": True},
             {"name": "人员名称", "type": "string", "required": True},
             {"name": "所属部门", "type": "string", "required": False},
             {"name": "人工成本", "type": "number", "required": False},
             {"name": "职称", "type": "string", "required": False},
             {"name": "是否可跨场工作", "type": "boolean", "required": False},
         ]},
        {"name": "人员组", "description": "同技能或同工种的人员集合",
         "attributes": [
             {"name": "人员组编号", "type": "string", "required": True},
             {"name": "人员组名称", "type": "string", "required": True},
             {"name": "资源制约", "type": "boolean", "required": False},
             {"name": "组批工时是否按单件工时", "type": "boolean", "required": False},
             {"name": "是否炉内资源", "type": "boolean", "required": False},
         ]},
        {"name": "部门", "description": "企业组织架构单元",
         "attributes": [
             {"name": "机构编码", "type": "string", "required": True},
             {"name": "部门名称", "type": "string", "required": True},
             {"name": "是否生产部门", "type": "boolean", "required": True},
             {"name": "地址", "type": "string", "required": False},
         ]},
        {"name": "资源日历", "description": "设备或人员的工作日历，定义作息和休假规则",
         "attributes": [
             {"name": "资源编号", "type": "string", "required": True},
             {"name": "资源名称", "type": "string", "required": True},
             {"name": "开始时间", "type": "date", "required": True},
             {"name": "结束时间", "type": "date", "required": True},
             {"name": "是否包含休息日", "type": "boolean", "required": False},
             {"name": "班次名称", "type": "string", "required": True},
         ]},
        {"name": "班次", "description": "每日工作时间段，含开始结束时间和休息时段",
         "attributes": [
             {"name": "班次名称", "type": "string", "required": True},
             {"name": "开始时间", "type": "string", "required": True},
             {"name": "结束时间", "type": "string", "required": True},
             {"name": "休息时段", "type": "string", "required": False},
             {"name": "可生产时间", "type": "number", "required": False},
         ]},
        {"name": "设备异常记录", "description": "设备在指定时间段内的异常停机记录",
         "attributes": [
             {"name": "设备编号", "type": "string", "required": True},
             {"name": "设备名称", "type": "string", "required": True},
             {"name": "设备组名称", "type": "string", "required": False},
             {"name": "异常开始时间", "type": "date", "required": True},
             {"name": "异常结束时间", "type": "date", "required": True},
             {"name": "异常类型", "type": "string", "required": True},
         ]},
    ])

    add_relations(oid_res, [
        {"name": "belongsToGroup", "source": "设备", "target": "设备组", "cardinality": "N:1", "description": "1台设备只属于1个设备组"},
        {"name": "belongsToDept", "source": "设备", "target": "部门", "cardinality": "N:1", "description": "1台设备只属于1个部门"},
        {"name": "personBelongsToGroup", "source": "人员", "target": "人员组", "cardinality": "N:1", "description": "1个人员只属于1个人员组"},
        {"name": "personBelongsToDept", "source": "人员", "target": "部门", "cardinality": "N:1", "description": "1个人员只属于1个部门"},
        {"name": "containsShift", "source": "资源日历", "target": "班次", "cardinality": "N:1", "description": "1个日历含1个班次"},
        {"name": "hasDowntime", "source": "设备", "target": "设备异常记录", "cardinality": "1:N", "description": "1台设备可有多条异常记录"},
        {"name": "hasCalendar", "source": "设备", "target": "资源日历", "cardinality": "N:1", "description": "设备关联资源日历"},
        {"name": "personHasCalendar", "source": "人员", "target": "资源日历", "cardinality": "N:1", "description": "人员关联资源日历"},
    ])

    add_behaviors(oid_res, [
        {"name": "创建资源日历", "type": "CREATE", "description": "智能体或用户创建资源日历", "protocol": "HTTP", "url": "/api/calendar/create", "method": "POST", "params": {"resourceName": "string", "startDate": "string", "endDate": "string", "shiftName": "string"}, "related_concepts": ["资源日历"]},
        {"name": "创建班次", "type": "CREATE", "description": "智能体或用户创建班次", "protocol": "HTTP", "url": "/api/shift/create", "method": "POST", "params": {"shiftName": "string", "startTime": "string", "endTime": "string"}, "related_concepts": ["班次"]},
        {"name": "查询设备信息", "type": "READ", "description": "用户或智能体查询设备基本信息", "protocol": "HTTP", "url": "/api/equipment", "method": "GET", "params": {"deviceId": "string", "deviceName": "string"}, "related_concepts": ["设备"]},
        {"name": "查询人员信息", "type": "READ", "description": "用户或智能体查询人员基本信息", "protocol": "HTTP", "url": "/api/personnel", "method": "GET", "params": {"personId": "string", "personName": "string"}, "related_concepts": ["人员"]},
        {"name": "查询日历信息", "type": "READ", "description": "用户或智能体查询日历信息", "protocol": "HTTP", "url": "/api/calendar", "method": "GET", "params": {"resourceId": "string", "resourceName": "string"}, "related_concepts": ["资源日历"]},
        {"name": "查询设备组信息", "type": "READ", "description": "用户或智能体查询设备组信息", "protocol": "HTTP", "url": "/api/equipment/groups", "method": "GET", "params": {"groupId": "string", "groupName": "string"}, "related_concepts": ["设备组"]},
        {"name": "查询人员组信息", "type": "READ", "description": "用户或智能体查询人员组信息", "protocol": "HTTP", "url": "/api/personnel/groups", "method": "GET", "params": {"groupId": "string", "groupName": "string"}, "related_concepts": ["人员组"]},
        {"name": "查询班次信息", "type": "READ", "description": "用户或智能体查询班次信息", "protocol": "HTTP", "url": "/api/shift", "method": "GET", "params": {"shiftName": "string"}, "related_concepts": ["班次"]},
        {"name": "创建设备异常记录", "type": "CREATE", "description": "智能体或用户记录设备异常停机", "protocol": "HTTP", "url": "/api/equipment/downtime", "method": "POST", "params": {"deviceId": "string", "deviceName": "string", "startTime": "string", "endTime": "string", "downtimeType": "string"}, "related_concepts": ["设备异常记录"]},
    ])

    add_rules(oid_res, [
        {"name": "资源日历-结束时间合理性", "description": "资源日历.结束时间 > 资源日历.开始时间", "related_concepts": ["资源日历"]},
        {"name": "班次-结束时间合理性", "description": "班次.结束时间 > 班次.开始时间", "related_concepts": ["班次"]},
        {"name": "资源日历-班次存在性", "description": "资源日历.班次名称 必须存在于 班次", "related_concepts": ["资源日历", "班次"]},
        {"name": "资源日历-资源存在性", "description": "资源日历.资源名称 必须存在于 设备 或 人员", "related_concepts": ["资源日历", "设备", "人员"]},
    ])

    add_events(oid_res, [
        {"name": "日历创建事件", "description": "资源日历创建成功", "related_behavior": "创建资源日历"},
        {"name": "班次创建事件", "description": "班次创建成功", "related_behavior": "创建班次"},
        {"name": "设备异常记录创建事件", "description": "设备异常记录创建成功/失败", "related_behavior": "创建设备异常记录"},
    ])

# ===========================================================================
# Step 5: 货品BOM及工艺本体
# ===========================================================================
oid_bom = create_ontology(scenario_id, "货品BOM及工艺", "货品BOM及工艺路径管理，涵盖货品、BOM、工艺路径及资源需求")
if oid_bom:
    add_concepts(oid_bom, [
        {"name": "货品", "description": "企业生产输出的物料，包含成品和半成品",
         "attributes": [
             {"name": "货品编号", "type": "string", "required": True},
             {"name": "货品名称", "type": "string", "required": True},
             {"name": "货品大类", "type": "string", "required": True},
             {"name": "物料类型", "type": "string", "required": True},
             {"name": "主单位", "type": "string", "required": True},
             {"name": "副单位", "type": "string", "required": False},
             {"name": "主副单位换算比", "type": "number", "required": False},
             {"name": "管理部门", "type": "string", "required": False},
             {"name": "生产部门", "type": "string", "required": False},
             {"name": "预设仓库", "type": "string", "required": False},
             {"name": "规格", "type": "string", "required": False},
         ]},
        {"name": "货品库存", "description": "货品当前的待入库、可用库存和累计库存",
         "attributes": [
             {"name": "材料编号", "type": "string", "required": True},
             {"name": "材料名称", "type": "string", "required": True},
             {"name": "材料类型", "type": "string", "required": True},
             {"name": "可用库存", "type": "number", "required": True},
             {"name": "单位", "type": "string", "required": True},
         ]},
        {"name": "BOM基本信息", "description": "物料清单基本信息",
         "attributes": [
             {"name": "BOM编号", "type": "string", "required": True},
             {"name": "BOM名称", "type": "string", "required": True},
             {"name": "货品编号", "type": "string", "required": True},
             {"name": "货品名称", "type": "string", "required": True},
             {"name": "BOM版本", "type": "string", "required": False},
         ]},
        {"name": "BOM明细", "description": "BOM的组成项，记录子货品、用量及对应工艺路径",
         "attributes": [
             {"name": "BOM编号", "type": "string", "required": True},
             {"name": "货品编号", "type": "string", "required": True},
             {"name": "货品名称", "type": "string", "required": True},
             {"name": "需求量", "type": "number", "required": True},
             {"name": "BOM层级", "type": "number", "required": True},
             {"name": "工艺路径编号", "type": "string", "required": False},
             {"name": "工艺路径名称", "type": "string", "required": False},
         ]},
        {"name": "BOM原材料需求", "description": "BOM对每种原料总需求量",
         "attributes": [
             {"name": "BOM编号", "type": "string", "required": True},
             {"name": "原料编号", "type": "string", "required": True},
             {"name": "原料名称", "type": "string", "required": True},
             {"name": "总需求量", "type": "number", "required": True},
         ]},
        {"name": "BOM设备组需求", "description": "BOM对每个设备组需求",
         "attributes": [
             {"name": "BOM编号", "type": "string", "required": True},
             {"name": "设备组编号", "type": "string", "required": True},
             {"name": "设备组名称", "type": "string", "required": True},
         ]},
        {"name": "BOM人员组需求", "description": "BOM对每个人员组需求",
         "attributes": [
             {"name": "BOM编号", "type": "string", "required": True},
             {"name": "人员组编号", "type": "string", "required": True},
             {"name": "人员组名称", "type": "string", "required": True},
         ]},
        {"name": "工艺路径", "description": "货品的生产工艺路径基本信息",
         "attributes": [
             {"name": "工艺路径编号", "type": "string", "required": True},
             {"name": "工艺路径名称", "type": "string", "required": True},
             {"name": "类型", "type": "string", "required": True},
             {"name": "工艺版本号", "type": "string", "required": False},
         ]},
        {"name": "工艺路径原料需求", "description": "工艺路径对原材料的需求",
         "attributes": [
             {"name": "工艺路径编号", "type": "string", "required": True},
             {"name": "原料名称", "type": "string", "required": True},
             {"name": "原料编号", "type": "string", "required": True},
             {"name": "需求量", "type": "number", "required": True},
         ]},
        {"name": "工艺路径设备组需求", "description": "工艺路径对设备组的需求",
         "attributes": [
             {"name": "工艺路径编号", "type": "string", "required": True},
             {"name": "设备组编号", "type": "string", "required": True},
             {"name": "设备组名称", "type": "string", "required": True},
         ]},
        {"name": "工艺路径人员组需求", "description": "工艺路径对人员组的需求",
         "attributes": [
             {"name": "工艺路径编号", "type": "string", "required": True},
             {"name": "人员组编号", "type": "string", "required": True},
             {"name": "人员组名称", "type": "string", "required": True},
         ]},
    ])

    add_relations(oid_bom, [
        {"name": "hasProductInventory", "source": "货品", "target": "货品库存", "cardinality": "1:1", "description": "每个货品对应一条库存快照"},
        {"name": "hasBOM", "source": "货品", "target": "BOM基本信息", "cardinality": "1:1", "description": "1个货品有1个BOM"},
        {"name": "hasBOMDetail", "source": "BOM基本信息", "target": "BOM明细", "cardinality": "1:N", "description": "1个BOM含多个BOM明细项"},
        {"name": "refersToProduct", "source": "BOM明细", "target": "货品", "cardinality": "N:1", "description": "1个BOM明细项有1个货品"},
        {"name": "hasRoute", "source": "BOM明细", "target": "工艺路径", "cardinality": "N:1", "description": "1个BOM明细项对应1条工艺路径"},
        {"name": "requiresMaterial", "source": "BOM基本信息", "target": "BOM原材料需求", "cardinality": "1:N", "description": "1个BOM可包含多个原料需求"},
        {"name": "requiresEquipGroup", "source": "BOM基本信息", "target": "BOM设备组需求", "cardinality": "1:N", "description": "1个BOM可包含多个设备组需求"},
        {"name": "requiresPersonGroup", "source": "BOM基本信息", "target": "BOM人员组需求", "cardinality": "1:N", "description": "1个BOM可包含多个人组需求"},
        {"name": "routeRequiresMaterial", "source": "工艺路径", "target": "工艺路径原料需求", "cardinality": "1:N", "description": "1条工艺路径可关联多个原料需求"},
        {"name": "routeRequiresEquipGroup", "source": "工艺路径", "target": "工艺路径设备组需求", "cardinality": "1:N", "description": "1条工艺路径可关联多个设备组需求"},
        {"name": "routeRequiresPersonGroup", "source": "工艺路径", "target": "工艺路径人员组需求", "cardinality": "1:N", "description": "1条工艺路径可关联多个人组需求"},
    ])

    add_behaviors(oid_bom, [
        {"name": "查询货品信息", "type": "READ", "description": "用户或智能体查询货品基本信息", "protocol": "HTTP", "url": "/api/products", "method": "GET", "params": {"productId": "string", "productName": "string"}, "related_concepts": ["货品"]},
        {"name": "查询货品库存信息", "type": "READ", "description": "用户或智能体查询货品库存", "protocol": "HTTP", "url": "/api/products/inventory", "method": "GET", "params": {"productId": "string", "productName": "string"}, "related_concepts": ["货品库存"]},
        {"name": "查询BOM基本信息", "type": "READ", "description": "用户或智能体查询BOM基本信息", "protocol": "HTTP", "url": "/api/bom", "method": "GET", "params": {"bomId": "string", "productId": "string"}, "related_concepts": ["BOM基本信息"]},
        {"name": "查询BOM原料需求", "type": "READ", "description": "用户或智能体查询BOM的原料汇总需求", "protocol": "HTTP", "url": "/api/bom/materials", "method": "GET", "params": {"bomId": "string"}, "related_concepts": ["BOM原材料需求"]},
        {"name": "查询BOM设备组需求", "type": "READ", "description": "用户或智能体查询BOM的设备组汇总需求", "protocol": "HTTP", "url": "/api/bom/equipment", "method": "GET", "params": {"bomId": "string"}, "related_concepts": ["BOM设备组需求"]},
        {"name": "查询BOM人员组需求", "type": "READ", "description": "用户或智能体查询BOM的人员组汇总需求", "protocol": "HTTP", "url": "/api/bom/personnel", "method": "GET", "params": {"bomId": "string"}, "related_concepts": ["BOM人员组需求"]},
        {"name": "查询BOM明细信息", "type": "READ", "description": "用户或智能体查询BOM及其明细和工艺路径", "protocol": "HTTP", "url": "/api/bom/details", "method": "GET", "params": {"bomId": "string"}, "related_concepts": ["BOM明细"]},
        {"name": "查询工艺路径信息", "type": "READ", "description": "用户或智能体查询工艺路径及其关联资源需求", "protocol": "HTTP", "url": "/api/routes", "method": "GET", "params": {"routeId": "string", "routeName": "string"}, "related_concepts": ["工艺路径"]},
        {"name": "查询工艺路径原料需求", "type": "READ", "description": "用户或智能体查询工艺路径关联的原料需求", "protocol": "HTTP", "url": "/api/routes/materials", "method": "GET", "params": {"routeId": "string"}, "related_concepts": ["工艺路径原料需求"]},
        {"name": "查询工艺路径设备组需求", "type": "READ", "description": "用户或智能体查询工艺路径关联的设备组需求", "protocol": "HTTP", "url": "/api/routes/equipment", "method": "GET", "params": {"routeId": "string"}, "related_concepts": ["工艺路径设备组需求"]},
        {"name": "查询工艺路径人员组需求", "type": "READ", "description": "用户或智能体查询工艺路径关联的人员组需求", "protocol": "HTTP", "url": "/api/routes/personnel", "method": "GET", "params": {"routeId": "string"}, "related_concepts": ["工艺路径人员组需求"]},
    ])

    add_rules(oid_bom, [
        {"name": "查询BOM后引导", "description": "查询BOM基本信息后，提示可进一步查询原料/设备组/人员组需求", "related_concepts": ["BOM基本信息", "BOM原材料需求", "BOM设备组需求", "BOM人员组需求"]},
        {"name": "查询BOM明细后引导", "description": "查询BOM明细后，提示可查询对应工艺路径的资源需求", "related_concepts": ["BOM明细", "工艺路径原料需求", "工艺路径设备组需求", "工艺路径人员组需求"]},
    ])


print("\n========== ALL DONE ==========")
