# -*- coding: utf-8 -*-
"""重现：查询高强度钢板库存，观察 SSE 事件流与是否卡死。"""
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
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        return {'_http_error': e.code, '_body': e.read().decode('utf-8', errors='replace')[:200]}


def new_thread(title):
    return post(API_BASE, {'title': title, 'ontology_scope': [{'scenario': SCEN, 'ontology': ONTO}]})['id']


def chat(tid, message, timeout=180):
    url = API_BASE + f'/{tid}/chat'
    req = urllib.request.Request(url, data=json.dumps({'message': message}).encode('utf-8'),
                                 headers={'Content-Type': 'application/json'}, method='POST')
    events = []
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
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
                        t = evt.get('type')
                        events.append(evt)
                        if t == 'plan_confirm':
                            post(BASE + f'/plan-confirm/{evt["confirmId"]}', {'approved': True})
                        elif t == 'confirm':
                            post(BASE + f'/confirm/{evt["confirmId"]}', {'approved': True})
                    buf = b''
        print(f'[正常结束] 事件数={len(events)}')
    except Exception as e:
        print(f'[异常/超时] {type(e).__name__}: {e}  已收事件数={len(events)}')
    return events


tid = new_thread('查询卡死重现')
print(f'线程: {tid}\n')

events = chat(tid, '请查询高强度钢板原材料的当前库存情况。')

print('\n── 事件流 ──')
for e in events:
    t = e.get('type')
    if t in ('subtask_input', 'subtask_result', 'parent_input'):
        print(f'[{t}] {e.get("entry", {}).get("detail", "")[:300]}')
    elif t in ('plan_confirm', 'confirm', 'exec_entry'):
        print(f'[{t}] {json.dumps(e.get("entry", e), ensure_ascii=False)[:200]}')
    else:
        print(f'[{t}] {json.dumps(e, ensure_ascii=False)[:200]}')
