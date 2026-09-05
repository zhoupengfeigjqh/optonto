# -*- coding: utf-8 -*-
"""发起取消 PO-20260809-047、PO-20260809-048 两个采购单，自动批准确认弹窗，打印事件流与总结。"""
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


tid = post(API_BASE, {'title': '取消PO-047/048', 'ontology_scope': [{'scenario': SCEN, 'ontology': ONTO}]})['id']
print(f'线程: {tid}\n')

url = API_BASE + f'/{tid}/chat'
body = json.dumps({'message': '取消采购订单 PO-20260809-047 和 PO-20260809-048。'}).encode('utf-8')
req = urllib.request.Request(url, data=body, headers={'Content-Type': 'application/json'}, method='POST')

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
                if t in ('plan_confirm', 'confirm'):
                    # 用户已明确要求执行该操作，自动批准确认弹窗
                    route = 'plan-confirm' if t == 'plan_confirm' else 'confirm'
                    print(f'  ▶ 批准确认: {t} {evt.get("confirmId")} behavior={evt.get("behavior", "")}')
                    post(BASE + f'/{route}/{evt["confirmId"]}', {'approved': True})
            buf = b''

# 打印事件类型序列
types = [e['type'] for e in events]
print(f'\n事件序列: {types}\n')

# 打印规划子任务
for e in events:
    if e.get('type') == 'plan_received':
        subs = e['plan']['subtasks']
        print(f'[规划] {len(subs)} 个子任务:')
        for st in subs:
            print(f'  - seq={st["seq"]} behavior={st["behavior"]} desc="{st.get("description", "")[:50]}" depends_on={st.get("depends_on")}')
        break

# 打印执行事件（子任务开始/结束/总结）
for e in events:
    t = e.get('type')
    if t in ('subtask_start', 'subtask_done'):
        print(f'[{t}] {e.get("name", "")} status={e.get("status", "")} detail={e.get("detail", "")[:80]}')
    elif t in ('error',):
        print(f'[error] {e.get("message", "")[:150]}')

# 汇总 token 文本（最终总结）
tokens = ''.join(e.get('token', '') for e in events if e.get('type') == 'token')
print(f'\n========== 最终总结 ==========\n{tokens}')
