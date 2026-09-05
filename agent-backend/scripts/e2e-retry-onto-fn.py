# -*- coding: utf-8 -*-
"""单场景重试：强制规划本体函数子任务（两步计划逼出 submit_plan）。"""
import json
import sys
import urllib.request
import urllib.parse

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

BASE = 'http://localhost:8003/agent-api'
SCEN = '生产调度'
ONTO = '原材料采购和库存'
API_BASE = '/'.join([BASE, 'onto_market', urllib.parse.quote(SCEN), urllib.parse.quote(ONTO), 'threads'])


def post(url, body=None):
    data = json.dumps(body or {}).encode('utf-8')
    req = urllib.request.Request(url, data=data, headers={'Content-Type': 'application/json'}, method='POST')
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode('utf-8'))


tid = post(API_BASE, {'title': 'E2E本体函数重试', 'ontology_scope': [{'scenario': SCEN, 'ontology': ONTO}]})['id']
print(f'线程: {tid}')

msg = ('请制定一个两步计划并执行：第一步查询所有采购记录（QueryPurchaseRecords），'
       '第二步调用函数 sumRawNotArrivalQty（原材料未到位数）对查询结果汇总未到位数量。'
       '第二步是函数子任务，function 字段填 sumRawNotArrivalQty。')
body = json.dumps({'message': msg}).encode('utf-8')
req = urllib.request.Request(API_BASE + f'/{tid}/chat', data=body, headers={'Content-Type': 'application/json'}, method='POST')

events = []
with urllib.request.urlopen(req, timeout=300) as r:
    buf = b''
    while True:
        chunk = r.read(1)
        if not chunk:
            break
        buf += chunk
        if buf.endswith(b'\n\n'):
            for line in buf.decode('utf-8', errors='replace').splitlines():
                if not line.startswith('data: '):
                    continue
                evt = json.loads(line[6:])
                events.append(evt)
                t = evt.get('type')
                if t == 'plan_confirm':
                    post(BASE + f'/plan-confirm/{evt["confirmId"]}', {'approved': True})
                elif t == 'confirm':
                    post(BASE + f'/confirm/{evt["confirmId"]}', {'approved': True})
            buf = b''

fn_subs = []
for e in events:
    if e['type'] in ('plan_received', 'plan_confirm'):
        for st in e['plan']['subtasks']:
            kind = 'function=' + st['function'] if st.get('function') else 'behavior=' + st.get('behavior', '')
            print(f'  [{e["type"]}] {kind}  display_name="{st.get("display_name","")}"')
            if st.get('function'):
                fn_subs.append(st)
for e in events:
    if e['type'] == 'exec_entry':
        en = e['entry']
        if en.get('type') in ('subtask_start', 'subtask_done', 'tool_call'):
            print(f'  exec: {en["type"]} {en.get("name")} {en.get("status","")}')
errors = [e.get('message', '') for e in events if e['type'] == 'error']
print('errors:', errors[:2] if errors else '无')
print('done:', any(e['type'] == 'done' for e in events))
hit = [s for s in fn_subs if s['function'] == 'sumRawNotArrivalQty']
print(f'\n断言: 函数子任务命中={bool(hit)}  display_name含"原材料未到位"={any("原材料未到位" in (s.get("display_name") or "") for s in hit)}')
