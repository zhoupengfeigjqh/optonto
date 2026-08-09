# -*- coding: utf-8 -*-
"""抓取子 Agent 实际收到的 subtask_input 指令，验证 data_supplements 行为参数结构已渲染进 live 指令。"""
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
        return {'_http_error': e.code, '_body': e.read().decode('utf-8', errors='replace')[:200]}


def new_thread(title):
    return post(API_BASE, {'title': title, 'skill_names': [SKILL]})['id']


def chat(tid, message):
    url = API_BASE + f'/{tid}/chat'
    req = urllib.request.Request(url, data=json.dumps({'message': message}).encode('utf-8'),
                                 headers={'Content-Type': 'application/json'}, method='POST')
    entries = []
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
                    t = evt.get('type')
                    if t == 'plan_confirm':
                        post(BASE + f'/plan-confirm/{evt["confirmId"]}', {'approved': True})
                    elif t == 'confirm':
                        post(BASE + f'/confirm/{evt["confirmId"]}', {'approved': True})
                    elif t == 'exec_entry' and evt.get('entry', {}).get('type') == 'subtask_input':
                        entries.append(evt['entry'])
                buf = b''
    return entries


tid = new_thread('指令渲染验证')
print(f'线程: {tid}\n')

entries = chat(tid, '请直接创建采购单：原材料 RM-001 高强度钢板，0.1 吨，供应商宝钢钢铁集团，到位时间 2026-08-20，信息已全部确认无需查询，直接创建。')

print(f'抓到 subtask_input 指令 {len(entries)} 条\n')
for e in entries:
    print('─' * 70)
    print(e.get('detail', ''))
