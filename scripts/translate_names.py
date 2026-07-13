"""Translate all ontology names to English with abbreviations.
Updates all references (relations, behaviors, rules) that point to renamed concepts.
Run from project root: python scripts/translate_names.py
"""

import json
import urllib.request
import urllib.error

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
        print(f"  ERROR {method} {path}: {e.read().decode()}")
        return None

def get_scenario_id(name):
    scenes = req("GET", "/scenarios") or []
    for s in scenes:
        if s["name"] == name:
            return s["id"]
    return None

def get_ontologies(sid):
    return req("GET", f"/ontologies/by-scenario/{sid}") or []

def get_data(oid):
    return req("GET", f"/ontologies/{oid}/data")

def save_data(oid, data):
    return req("PUT", f"/ontologies/{oid}/data", data)


# ─── Translation Maps ───────────────────────────────────────────────

# Each entry: {"old_name": "new_name"}
# After renaming, references in relations/behaviors/rules are auto-updated by the script.

ONTOLOGY_MAPS = {

    # ========== 原材料 ==========
    "原材料": {
        "concepts": {
            "原材料": "RawMaterial",
            "原材料库存": "RawMaterialInv",
            "原材料采购记录": "PurchaseRecord",
            "供应商": "Supplier",
            "客户订单": "CustOrder",
        },
        "relations": {
            "hasRawInventory": "hasRawInventory",
            "recordsRawMaterial": "recordsRawMaterial",
            "orderedFromSupplier": "orderedFromSupplier",
            "suppliesRawMaterial": "suppliesRawMaterial",
            "containsPurchaseRecord": "containsPurchaseRecord",
        },
        "behaviors": {
            "创建原材料采购单": "CreatePurchaseOrder",
            "取消原材料采购单": "CancelPurchaseOrder",
            "入库原材料": "WarehouseIn",
            "查询原材料库存信息": "QueryRawMaterialInv",
            "查询原材料采购单信息": "QueryPurchaseOrder",
            "查询原材料基本信息": "QueryRawMaterial",
            "查询供应商信息": "QuerySupplier",
        },
        "rules": {
            "采购-原料单位一致性": "UnitConsistencyPO",
            "库存-原料单位一致性": "UnitConsistencyInv",
            "到位时间合理性": "DeliveryTimeValid",
            "采购-原料存在性": "MaterialExistsPO",
            "采购-供应商存在性": "SupplierExistsPO",
            "采购-订单存在性": "OrderExistsPO",
            "安全库存预警": "SafetyStockWarn",
            "采购到位超期预警": "DeliveryOverdueWarn",
            "采购目的推理": "PurchaseReasonInfer",
            "采购关联订单校验": "OrderLinkCheck",
        },
        "events": {
            "采购订单创建事件": "PurchaseOrderCreated",
            "采购订单取消事件": "PurchaseOrderCancelled",
            "原材料入库事件": "RawMaterialWarehoused",
        },
    },

    # ========== 订单排程 ==========
    "订单排程": {
        "concepts": {
            "订单": "Order",
            "订单明细": "OrderDetail",
            "货品": "Product",
            "BOM基本信息": "BOMInfo",
            "排产任务": "SchedTask",
            "排产结果": "SchedResult",
            "欠料明细": "ShortageDetail",
            "算法参数": "AlgoParams",
        },
        "relations": {
            "hasDetail": "hasDetail",
            "hasProduct": "hasProduct",
            "hasBOM": "hasBOM",
            "drivesScheduling": "drivesScheduling",
            "producesPlan": "producesPlan",
            "hasShortageDetail": "hasShortageDetail",
            "hasScheduleParams": "hasScheduleParams",
            "hasVersionDerivative": "hasVersion",
        },
        "behaviors": {
            "创建订单": "CreateOrder",
            "订单更新": "UpdateOrder",
            "订单删除": "DeleteOrder",
            "查询订单": "QueryOrder",
            "创建排产任务": "CreateSchedTask",
            "新增排产任务": "AddSchedTask",
            "创建算法参数": "CreateAlgoParams",
            "启动排产任务": "StartSchedTask",
            "查询排产任务": "QuerySchedTask",
            "查询排产结果": "QuerySchedResult",
            "排产结果下发": "DeploySchedResult",
            "排产结果撤回": "RecallSchedResult",
            "查询排产结果欠料明细": "QueryShortage",
            "启动排产查询定时任务": "StartPollingTask",
        },
        "rules": {
            "订单创建-订单类型": "OrderTypeValid",
            "订单明细-货品存在性": "ProductExistsValid",
            "订单明细-截止日期约束": "DueDateValid",
            "订单明细-交付数量约束": "QtyValid",
            "订单明细-优先级约束": "PriorityValid",
            "订单更新-未排产约束": "NoSchedOnUpdate",
            "订单删除-未排产约束": "NoSchedOnDelete",
            "创建排产任务-唯一性约束": "SchedUniqueValid",
            "新增排产任务-状态约束": "AddSchedStateValid",
            "启动排产任务-状态约束": "StartSchedStateValid",
            "排产结果下发-状态约束": "DeployStateValid",
            "排产结果撤回-状态约束": "RecallStateValid",
            "已排产完成后可新增排产任务": "CanAddAfterSched",
            "排产结果成功下发后提示查欠料": "CheckShortageAfterDeploy",
            "订单创建后提示排产": "PromptSchedAfterOrder",
            "排产启动后提示等待": "PromptWaitAfterStart",
        },
        "events": {
            "订单创建事件": "OrderCreated",
            "订单更新事件": "OrderUpdated",
            "订单删除事件": "OrderDeleted",
            "排产任务创建事件": "SchedTaskCreated",
            "新增排产任务事件": "SchedTaskAdded",
            "排产任务启动事件": "SchedTaskStarted",
            "排产结果下发事件": "SchedResultDeployed",
            "排产结果撤回事件": "SchedResultRecalled",
            "算法参数创建事件": "AlgoParamsCreated",
        },
    },

    # ========== 资源 ==========
    "资源": {
        "concepts": {
            "设备": "Equipment",
            "设备组": "EquipGroup",
            "人员": "Personnel",
            "人员组": "PersonnelGroup",
            "部门": "Department",
            "资源日历": "ResCalendar",
            "班次": "Shift",
            "设备异常记录": "EquipDowntime",
        },
        "relations": {
            "belongsToGroup": "belongsToGroup",
            "belongsToDept": "belongsToDept",
            "personBelongsToGroup": "personBelongsToGroup",
            "personBelongsToDept": "personBelongsToDept",
            "containsShift": "containsShift",
            "hasDowntime": "hasDowntime",
            "hasCalendar": "hasCalendar",
            "personHasCalendar": "personHasCalendar",
        },
        "behaviors": {
            "创建资源日历": "CreateCalendar",
            "创建班次": "CreateShift",
            "查询设备信息": "QueryEquipment",
            "查询人员信息": "QueryPersonnel",
            "查询日历信息": "QueryCalendar",
            "查询设备组信息": "QueryEquipGroup",
            "查询人员组信息": "QueryPersonnelGroup",
            "查询班次信息": "QueryShift",
            "创建设备异常记录": "CreateDowntimeRecord",
        },
        "rules": {
            "资源日历-结束时间合理性": "CalendarEndDateValid",
            "班次-结束时间合理性": "ShiftEndTimeValid",
            "资源日历-班次存在性": "ShiftExistsValid",
            "资源日历-资源存在性": "ResExistsValid",
        },
        "events": {
            "日历创建事件": "CalendarCreated",
            "班次创建事件": "ShiftCreated",
            "设备异常记录创建事件": "DowntimeRecorded",
        },
    },

    # ========== 货品BOM及工艺 ==========
    "货品BOM及工艺": {
        "concepts": {
            "货品": "Product",
            "货品库存": "ProductInv",
            "BOM基本信息": "BOMInfo",
            "BOM明细": "BOMDetail",
            "BOM原材料需求": "BOMMaterialReq",
            "BOM设备组需求": "BOMEquipReq",
            "BOM人员组需求": "BOMPersonReq",
            "工艺路径": "ProcessRoute",
            "工艺路径原料需求": "RouteMaterialReq",
            "工艺路径设备组需求": "RouteEquipReq",
            "工艺路径人员组需求": "RoutePersonReq",
        },
        "relations": {
            "hasProductInventory": "hasProductInventory",
            "hasBOM": "hasBOM",
            "hasBOMDetail": "hasBOMDetail",
            "refersToProduct": "refersToProduct",
            "hasRoute": "hasRoute",
            "requiresMaterial": "requiresMaterial",
            "requiresEquipGroup": "requiresEquipGroup",
            "requiresPersonGroup": "requiresPersonGroup",
            "routeRequiresMaterial": "routeRequiresMat",
            "routeRequiresEquipGroup": "routeRequiresEquip",
            "routeRequiresPersonGroup": "routeRequiresPerson",
        },
        "behaviors": {
            "查询货品信息": "QueryProduct",
            "查询货品库存信息": "QueryProductInv",
            "查询BOM基本信息": "QueryBOMInfo",
            "查询BOM原料需求": "QueryBOMMaterialReq",
            "查询BOM设备组需求": "QueryBOMEquipReq",
            "查询BOM人员组需求": "QueryBOMPersonReq",
            "查询BOM明细信息": "QueryBOMDetail",
            "查询工艺路径信息": "QueryProcessRoute",
            "查询工艺路径原料需求": "QueryRouteMatReq",
            "查询工艺路径设备组需求": "QueryRouteEquipReq",
            "查询工艺路径人员组需求": "QueryRoutePersonReq",
        },
        "rules": {
            "查询BOM后引导": "PromptAfterBOMQuery",
            "查询BOM明细后引导": "PromptAfterBOMDetailQuery",
        },
        "events": {},
    },
}


# ===========================================================================

def apply_renames(onto_name, onto_id, maps):
    data = get_data(onto_id)
    if not data:
        print(f"  SKIP {onto_name}: no data")
        return

    c_map = maps["concepts"]
    r_map = maps["relations"]
    b_map = maps["behaviors"]
    ru_map = maps["rules"]
    e_map = maps.get("events", {})

    # 1. Rename concepts + keep display_name = old Chinese name
    old_to_new = {}
    for c in data["concepts"]:
        old = c["name"]
        if old in c_map:
            new = c_map[old]
            if not c.get("display_name"):
                c["display_name"] = old  # current Chinese becomes display_name
            c["name"] = new
            old_to_new[old] = new
            print(f"    Concept: [{old}] -> [{new}]")

    # 2. Update references in relations (source/target)
    for r in data["relations"]:
        if r["source"] in old_to_new:
            r["source"] = old_to_new[r["source"]]
        if r["target"] in old_to_new:
            r["target"] = old_to_new[r["target"]]
        old_r = r["name"]
        if old_r in r_map:
            if not r.get("display_name"):
                r["display_name"] = old_r if r_map[old_r] == old_r else ""
            r["name"] = r_map[old_r]
            if old_r != r_map[old_r]:
                print(f"    Relation: [{old_r}] -> [{r_map[old_r]}]")

    # 3. Update references in behaviors (related_concepts)
    for b in data["behaviors"]:
        old_b = b["name"]
        if old_b in b_map:
            if not b.get("display_name"):
                b["display_name"] = old_b
            b["name"] = b_map[old_b]
            print(f"    Behavior: [{old_b}] -> [{b_map[old_b]}]")
        b["related_concepts"] = [old_to_new.get(rc, rc) for rc in b["related_concepts"]]

    # 4. Update references in rules (related_concepts, related_behavior)
    for ru in data["rules"]:
        old_ru = ru["name"]
        if old_ru in ru_map:
            if not ru.get("display_name"):
                ru["display_name"] = old_ru
            ru["name"] = ru_map[old_ru]
            print(f"    Rule: [{old_ru}] -> [{ru_map[old_ru]}]")
        ru["related_concepts"] = [old_to_new.get(rc, rc) for rc in ru["related_concepts"]]
        if ru.get("related_behavior") and ru["related_behavior"] in b_map:
            ru["related_behavior"] = b_map[ru["related_behavior"]]

    # 5. Events
    for e in data["events"]:
        old_e = e["name"]
        if old_e in e_map:
            if not e.get("display_name"):
                e["display_name"] = old_e
            e["name"] = e_map[old_e]
            print(f"    Event: [{old_e}] -> [{e_map[old_e]}]")
        if e.get("related_behavior") and e["related_behavior"] in b_map:
            e["related_behavior"] = b_map[e["related_behavior"]]
        if e.get("trigger_behavior") and e["trigger_behavior"] in b_map:
            e["trigger_behavior"] = b_map[e["trigger_behavior"]]

    save_data(onto_id, data)
    print(f"  [{onto_name}] saved.\n")


# ===========================================================================
# Main
# ===========================================================================

sid = get_scenario_id("生产调度")
if not sid:
    print("ERROR: 生产调度 scenario not found")
    exit(1)

ontos = get_ontologies(sid)
print(f"Found {len(ontos)} ontologies under 生产调度\n")

for onto in ontos:
    name = onto["name"]
    oid = onto["id"]
    print(f"=== {name} (ID={oid}) ===")
    if name in ONTOLOGY_MAPS:
        apply_renames(name, oid, ONTOLOGY_MAPS[name])
    else:
        print(f"  SKIP: no translation map for '{name}'")

print("All done!")
