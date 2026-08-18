# -*- coding: utf-8 -*-
"""复现"中继未填充 purchaseRecordSet"：查询高强度钢板采购记录 → 计算未到位数量。
重点关注：波次反馈是否触发、父Agent 是否提交调整规划、调整规划里 purchaseRecordSet 填了什么、
函数子任务实际收到的参数（tool_call 事件的 params）。
"""
import json
import sys
import urllib.request
import urllib.parse

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

BASE = 'http://localhost:8003/agent-api'
SCEN = '生产调度'
ONTO = '原材料采购和库存'
SKILL = {'name': 'raw-material-inventory', 'scenario': SCEN, 'ontology': ONTO}
API_BASE = '/'.join([BASE, 'onto_market', urllib.parse.quote(SCEN), urllib.parse.quote(ONTO), 'threads'])


def post(url, body=None):
    data = json.dumps(body or {}).encode('utf-8')
    req = urllib.request.Request(url, data=data, headers={'Content-Type': 'application/json'}, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        return {'_http_error': e.code, '_body': e.read().decode('utf-8', errors='replace')[:300]}


def show_plan(plan, tag):
    print(f'\n=== {tag} ===')
    for st in plan.get('subtasks', []):
        params = st.get('params') or {}
        prs = params.get('purchaseRecordSet')
        prs_v = json.dumps(prs, ensure_ascii=False)[:200] if prs is not None else '(无此参数)'
        print(f"  seq={st.get('seq')} fn={st.get('function') or ''} bh={st.get('behavior') or ''} depends_on={st.get('depends_on')}")
        print(f"    purchaseRecordSet = {prs_v}")


tid = post(API_BASE, {'title': 'repro-中继填充', 'skill_names': [SKILL]})['id']
print(f'thread: {tid}')

url = API_BASE + f'/{tid}/chat'
body = json.dumps({'message': '查询高强度钢板的采购记录，并计算未到位数量'}).encode('utf-8')
req = urllib.request.Request(url, data=body, headers={'Content-Type': 'application/json'}, method='POST')

with urllib.request.urlopen(req, timeout=300) as r:
    buf = b''
    while True:
        chunk = r.read(1)
        if not chunk:
            break
        buf += chunk
        if not buf.endswith(b'\n\n'):
            continue
        for line in buf.decode('utf-8', errors='replace').splitlines():
            if not line.startswith('data: '):
                continue
            evt = json.loads(line[6:])
            t = evt.get('type')
            if t == 'plan_confirm':
                show_plan(evt.get('plan') or {}, 'plan_confirm（父Agent 初次提交）')
                post(BASE + f'/plan-confirm/{evt["confirmId"]}', {'approved': True})
                print('  → 已自动批准')
            elif t == 'confirm':
                post(BASE + f'/confirm/{evt["confirmId"]}', {'approved': True})
            elif t == 'feedback':
                print(f'\n[feedback] {evt.get("status")}')
            elif t == 'error':
                print(f'\n!!! error 事件: {evt.get("message")}')
            elif t == 'exec_entry':
                e = evt.get('entry', {})
                name = e.get('name') or ''
                detail = (e.get('detail') or '')[:150]
                # 全量打印关键节点：结果分析/校验/修正/函数调用参数/子任务起止
                if e.get('type') in ('subtask_done', 'subtask_start'):
                    print(f'  [entry:{e.get("type")}] {name} | {e.get("status")} | {detail}')
                elif e.get('type') == 'tool_call' and 'sumRaw' in name:
                    p = json.dumps(e.get('params'), ensure_ascii=False)[:300]
                    res = (e.get('result') or '')[:200]
                    print(f'  [tool_call] {name} | {e.get("status")} | params={p} | result={res}')
            elif t == 'done':
                print('\n=== done ===')
        buf = b''
