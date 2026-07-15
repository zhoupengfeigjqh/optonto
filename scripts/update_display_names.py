"""Update all ontologies with Chinese display_names.
Run from project root: python scripts/update_display_names.py
"""

import json
import urllib.request
import urllib.error

API = "http://localhost:8001/api"

def req(method, path, data=None):
    url = f"{API}{path}"
    body = json.dumps(data, ensure_ascii=False).encode("utf-8") if data else None
    r = urllib.request.Request(url, data=body, method=method)
    r.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(r) as resp:
        return json.loads(resp.read().decode())

def get(oid):
    return req("GET", f"/ontologies/{oid}/data")

def put(oid, data):
    req("PUT", f"/ontologies/{oid}/data", data)

# ─── display_name 映射表 ───────────────────────────────────────────────

RAW_MATERIAL_CONCEPTS = {
    "原材料": {"display_name": "原材料"},
    "原材料库存": {"display_name": "原材料库存"},
    "原材料采购记录": {"display_name": "原材料采购记录"},
    "供应商": {"display_name": "供应商"},
    "客户订单": {"display_name": "客户订单"},
}
RAW_MATERIAL_RELATIONS = {
    "hasRawInventory": {"display_name": "原材料-库存"},
    "recordsRawMaterial": {"display_name": "采购记录-原材料"},
    "orderedFromSupplier": {"display_name": "采购-供应商"},
    "suppliesRawMaterial": {"display_name": "供应商供应原材料"},
    "containsPurchaseRecord": {"display_name": "订单包含采购"},
}
RAW_MATERIAL_BEHAVIORS = {
    "创建原材料采购单": {"display_name": "创建原材料采购单"},
    "取消原材料采购单": {"display_name": "取消原材料采购单"},
    "入库原材料": {"display_name": "原材料入库"},
    "查询原材料库存信息": {"display_name": "查询原材料库存"},
    "查询原材料采购单信息": {"display_name": "查询采购单"},
    "查询原材料基本信息": {"display_name": "查询原材料信息"},
    "查询供应商信息": {"display_name": "查询供应商信息"},
}
RAW_MATERIAL_RULES = {
    "采购-原料单位一致性": {"display_name": "采购与原料单位一致性校验"},
    "库存-原料单位一致性": {"display_name": "库存与原料单位一致性校验"},
    "到位时间合理性": {"display_name": "到位时间合理性校验"},
    "采购-原料存在性": {"display_name": "采购原料存在性校验"},
    "采购-供应商存在性": {"display_name": "采购供应商存在性校验"},
    "采购-订单存在性": {"display_name": "采购订单存在性校验"},
    "安全库存预警": {"display_name": "安全库存预警"},
    "采购到位超期预警": {"display_name": "采购到位超期预警"},
    "采购目的推理": {"display_name": "采购目的推理"},
    "采购关联订单校验": {"display_name": "采购关联订单校验"},
}
RAW_MATERIAL_EVENTS = {
    "采购订单创建事件": {"display_name": "采购订单创建事件"},
    "采购订单取消事件": {"display_name": "采购订单取消事件"},
    "原材料入库事件": {"display_name": "原材料入库事件"},
}

# ─── 订单排程 ───

ORDER_CONCEPTS = {
    "订单": {"display_name": "订单"},
    "订单明细": {"display_name": "订单明细"},
    "货品": {"display_name": "货品"},
    "BOM基本信息": {"display_name": "BOM基本信息"},
    "排产任务": {"display_name": "排产任务"},
    "排产结果": {"display_name": "排产结果"},
    "欠料明细": {"display_name": "欠料明细"},
    "算法参数": {"display_name": "算法参数"},
}
ORDER_RELATIONS = {
    "hasDetail": {"display_name": "包含明细"},
    "hasProduct": {"display_name": "关联货品"},
    "hasBOM": {"display_name": "包含BOM"},
    "drivesScheduling": {"display_name": "驱动排产"},
    "producesPlan": {"display_name": "产出结果"},
    "hasShortageDetail": {"display_name": "包含欠料"},
    "hasScheduleParams": {"display_name": "包含参数"},
    "hasVersionDerivative": {"display_name": "版本派生"},
}
ORDER_BEHAVIORS = {
    "创建订单": {"display_name": "创建订单"},
    "订单更新": {"display_name": "更新订单"},
    "订单删除": {"display_name": "删除订单"},
    "查询订单": {"display_name": "查询订单"},
    "创建排产任务": {"display_name": "创建排产任务"},
    "新增排产任务": {"display_name": "新增排产任务"},
    "创建算法参数": {"display_name": "创建算法参数"},
    "启动排产任务": {"display_name": "启动排产任务"},
    "查询排产任务": {"display_name": "查询排产任务"},
    "查询排产结果": {"display_name": "查询排产结果"},
    "排产结果下发": {"display_name": "排产结果下发"},
    "排产结果撤回": {"display_name": "排产结果撤回"},
    "查询排产结果欠料明细": {"display_name": "查询欠料明细"},
    "启动排产查询定时任务": {"display_name": "启动定时查询"},
}
ORDER_RULES = {
    "订单创建-订单类型": {"display_name": "订单类型校验"},
    "订单明细-货品存在性": {"display_name": "货品存在性校验"},
    "订单明细-截止日期约束": {"display_name": "截止日期约束"},
    "订单明细-交付数量约束": {"display_name": "交付数量约束"},
    "订单明细-优先级约束": {"display_name": "优先级约束"},
    "订单更新-未排产约束": {"display_name": "未排产约束（更新）"},
    "订单删除-未排产约束": {"display_name": "未排产约束（删除）"},
    "创建排产任务-唯一性约束": {"display_name": "排产唯一性约束"},
    "新增排产任务-状态约束": {"display_name": "新增任务状态约束"},
    "启动排产任务-状态约束": {"display_name": "启动任务状态约束"},
    "排产结果下发-状态约束": {"display_name": "下发状态约束"},
    "排产结果撤回-状态约束": {"display_name": "撤回状态约束"},
    "已排产完成后可新增排产任务": {"display_name": "已排产可新增任务"},
    "排产结果成功下发后提示查欠料": {"display_name": "下发后查欠料"},
    "订单创建后提示排产": {"display_name": "创建后提示排产"},
    "排产启动后提示等待": {"display_name": "启动后提示等待"},
}
ORDER_EVENTS = {
    "订单创建事件": {"display_name": "订单创建事件"},
    "订单更新事件": {"display_name": "订单更新事件"},
    "订单删除事件": {"display_name": "订单删除事件"},
    "排产任务创建事件": {"display_name": "排产任务创建事件"},
    "新增排产任务事件": {"display_name": "新增排产任务事件"},
    "排产任务启动事件": {"display_name": "排产任务启动事件"},
    "排产结果下发事件": {"display_name": "排产结果下发事件"},
    "排产结果撤回事件": {"display_name": "排产结果撤回事件"},
    "算法参数创建事件": {"display_name": "算法参数创建事件"},
}

# ─── 资源 ───

RESOURCE_CONCEPTS = {
    "设备": {"display_name": "设备"},
    "设备组": {"display_name": "设备组"},
    "人员": {"display_name": "人员"},
    "人员组": {"display_name": "人员组"},
    "部门": {"display_name": "部门"},
    "资源日历": {"display_name": "资源日历"},
    "班次": {"display_name": "班次"},
    "设备异常记录": {"display_name": "设备异常记录"},
}
RESOURCE_RELATIONS = {
    "belongsToGroup": {"display_name": "属于设备组"},
    "belongsToDept": {"display_name": "属于部门"},
    "personBelongsToGroup": {"display_name": "属于人员组"},
    "personBelongsToDept": {"display_name": "属于部门"},
    "containsShift": {"display_name": "包含班次"},
    "hasDowntime": {"display_name": "有异常记录"},
    "hasCalendar": {"display_name": "关联日历"},
    "personHasCalendar": {"display_name": "关联日历"},
}
RESOURCE_BEHAVIORS = {
    "创建资源日历": {"display_name": "创建资源日历"},
    "创建班次": {"display_name": "创建班次"},
    "查询设备信息": {"display_name": "查询设备信息"},
    "查询人员信息": {"display_name": "查询人员信息"},
    "查询日历信息": {"display_name": "查询日历信息"},
    "查询设备组信息": {"display_name": "查询设备组信息"},
    "查询人员组信息": {"display_name": "查询人员组信息"},
    "查询班次信息": {"display_name": "查询班次信息"},
    "创建设备异常记录": {"display_name": "记录设备异常"},
}
RESOURCE_RULES = {
    "资源日历-结束时间合理性": {"display_name": "日历结束时间校验"},
    "班次-结束时间合理性": {"display_name": "班次结束时间校验"},
    "资源日历-班次存在性": {"display_name": "日历班次存在性校验"},
    "资源日历-资源存在性": {"display_name": "日历资源存在性校验"},
}
RESOURCE_EVENTS = {
    "日历创建事件": {"display_name": "日历创建事件"},
    "班次创建事件": {"display_name": "班次创建事件"},
    "设备异常记录创建事件": {"display_name": "设备异常记录事件"},
}

# ─── 货品BOM及工艺 ───

BOM_CONCEPTS = {
    "货品": {"display_name": "货品"},
    "货品库存": {"display_name": "货品库存"},
    "BOM基本信息": {"display_name": "BOM基本信息"},
    "BOM明细": {"display_name": "BOM明细"},
    "BOM原材料需求": {"display_name": "BOM原料需求"},
    "BOM设备组需求": {"display_name": "BOM设备组需求"},
    "BOM人员组需求": {"display_name": "BOM人员组需求"},
    "工艺路径": {"display_name": "工艺路径"},
    "工艺路径原料需求": {"display_name": "工艺原料需求"},
    "工艺路径设备组需求": {"display_name": "工艺设备组需求"},
    "工艺路径人员组需求": {"display_name": "工艺人员组需求"},
}
BOM_RELATIONS = {
    "hasProductInventory": {"display_name": "关联库存"},
    "hasBOM": {"display_name": "包含BOM"},
    "hasBOMDetail": {"display_name": "包含明细"},
    "refersToProduct": {"display_name": "指向货品"},
    "hasRoute": {"display_name": "关联工艺"},
    "requiresMaterial": {"display_name": "需要原料"},
    "requiresEquipGroup": {"display_name": "需要设备组"},
    "requiresPersonGroup": {"display_name": "需要人员组"},
    "routeRequiresMaterial": {"display_name": "需要原料"},
    "routeRequiresEquipGroup": {"display_name": "需要设备组"},
    "routeRequiresPersonGroup": {"display_name": "需要人员组"},
}
BOM_BEHAVIORS = {
    "查询货品信息": {"display_name": "查询货品信息"},
    "查询货品库存信息": {"display_name": "查询货品库存"},
    "查询BOM基本信息": {"display_name": "查询BOM信息"},
    "查询BOM原料需求": {"display_name": "查询BOM原料需求"},
    "查询BOM设备组需求": {"display_name": "查询BOM设备需求"},
    "查询BOM人员组需求": {"display_name": "查询BOM人员需求"},
    "查询BOM明细信息": {"display_name": "查询BOM明细"},
    "查询工艺路径信息": {"display_name": "查询工艺路径"},
    "查询工艺路径原料需求": {"display_name": "查询工艺原料需求"},
    "查询工艺路径设备组需求": {"display_name": "查询工艺设备需求"},
    "查询工艺路径人员组需求": {"display_name": "查询工艺人员需求"},
}
BOM_RULES = {
    "查询BOM后引导": {"display_name": "查询BOM后引导"},
    "查询BOM明细后引导": {"display_name": "查询BOM明细后引导"},
}


# ===========================================================================
# Apply display_names
# ===========================================================================

ONTOLOGIES = [
    ("原材料", RAW_MATERIAL_CONCEPTS, RAW_MATERIAL_RELATIONS, RAW_MATERIAL_BEHAVIORS, RAW_MATERIAL_RULES, RAW_MATERIAL_EVENTS),
    ("订单排程", ORDER_CONCEPTS, ORDER_RELATIONS, ORDER_BEHAVIORS, ORDER_RULES, ORDER_EVENTS),
    ("资源", RESOURCE_CONCEPTS, RESOURCE_RELATIONS, RESOURCE_BEHAVIORS, RESOURCE_RULES, RESOURCE_EVENTS),
    ("货品BOM及工艺", BOM_CONCEPTS, BOM_RELATIONS, BOM_BEHAVIORS, BOM_RULES, {}),
]

scenes = req("GET", "/scenarios")
sched = [s for s in scenes if s["name"] == "生产调度"]
if not sched:
    print("ERROR: 生产调度 scenario not found!")
    exit(1)

scenario_id = sched[0]["id"]
ontos = req("GET", f"/ontologies/by-scenario/{scenario_id}")

for onto_name, c_map, r_map, b_map, ru_map, e_map in ONTOLOGIES:
    onto = [o for o in ontos if o["name"] == onto_name]
    if not onto:
        print(f"ERROR: {onto_name} not found!")
        continue
    oid = onto[0]["id"]
    data = get(oid)

    for c in data["concepts"]:
        if c["name"] in c_map:
            c["display_name"] = c_map[c["name"]]["display_name"]
    for r in data["relations"]:
        if r["name"] in r_map:
            r["display_name"] = r_map[r["name"]]["display_name"]
    for b in data["behaviors"]:
        if b["name"] in b_map:
            b["display_name"] = b_map[b["name"]]["display_name"]
    for r in data["rules"]:
        if r["name"] in ru_map:
            r["display_name"] = ru_map[r["name"]]["display_name"]
    for e in data["events"]:
        if e["name"] in e_map:
            e["display_name"] = e_map[e["name"]]["display_name"]

    put(oid, data)
    print(f"[{onto_name}] display_names updated successfully")

print("\nAll done!")
