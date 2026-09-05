# -*- coding: utf-8 -*-
"""E2E 验证行为 facade 化：多步规划中子 Agent 直接调用行为工具（工具名即行为名，不再走 executeOntoBehavior）"""
import json
import sys
import urllib.request
import urllib.parse

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

BASE = 'http://localhost:8003/agent-api'
SCEN = '生产调度'
ONTO = '原材料采购和库存'
API = '/'.join([BASE, 'onto_market', urllib.parse.quote(SCEN), urllib.parse.quote(ONTO), 'threads'])


def post(url, body=None):
    data = json.dumps(body or {}).encode('utf-8')
    req = urllib.request.Request(url, data=data, headers={'Content-Type': 'application/json'}, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        return {'_err': e.code, '_body': e.read().decode('utf-8', errors='replace')[:150]}


def chat(tid, message):
    body = json.dumps({'message': message}).encode('utf-8')
    req = urllib.request.Request(API + f'/{tid}/chat', data=body, headers={'Content-Type': 'application/json'}, method='POST')
    events = []
    with urllib.request.urlopen(req, timeout=300) as r:
        buf = b''
        while True:
            ch = r.read(1)
            if not ch:
                break
            buf += ch
            if buf.endswith(b'\n\n'):
                for line in buf.decode('utf-8', errors='replace').splitlines():
                    if not line.startswith('data: '):
                        continue
                    evt = json.loads(line[6:])
                    events.append(evt)
                    t = evt.get('type')
                    if t == 'confirm':
                        post(BASE + f'/confirm/{evt["confirmId"]}', {'approved': True})
                    elif t == 'plan_confirm':
                        post(BASE + f'/plan-confirm/{evt["confirmId"]}', {'approved': True})
                buf = b''
    return events


tid = post(API, {'title': 'facade-E2E', 'ontology_scope': [{'scenario': SCEN, 'ontology': ONTO}]})['id']
print('thread:', tid)
evts = chat(tid, '先查一下高强度钢板（RM-001）的当前库存，然后为它创建一张 5 吨的采购单，供应商是宝钢。分两步执行。')

plan = [e for e in evts if e.get('type') == 'plan_received']
print('plan_received:', len(plan), '子任务数:', len(plan[0]['plan']['subtasks']) if plan else 0)
if plan:
    for s in plan[0]['plan']['subtasks']:
        print('  -', s.get('behavior') or s.get('function'), '|', (s.get('description') or '')[:40])

entries = [(e['entry'].get('type'), e['entry'].get('name'), e['entry'].get('status'))
           for e in evts if e.get('type') == 'exec_entry']
print('exec_entry 序列:')
for tp, n, st in entries:
    print('  ', tp, n, st)

tool_names = [n for tp, n, st in entries if tp == 'tool_call']
print('---断言---')
print('[PASS] 无 executeOntoBehavior' if 'executeOntoBehavior' not in tool_names else '[FAIL] 仍见 executeOntoBehavior')
beh_called = any(n in ('QueryInventory', 'CreatePurchaseRecord') for n in tool_names)
print('[PASS] 行为以一等工具被直接调用' if beh_called else '[FAIL] 未见行为工具直接调用')
confirms = [e for e in evts if e.get('type') == 'confirm']
print('[PASS] 写操作有安全确认' if confirms else '[WARN] 无安全确认弹窗')
print('[PASS] done 收尾' if any(e.get('type') == 'done' for e in evts) else '[FAIL] 无 done')
