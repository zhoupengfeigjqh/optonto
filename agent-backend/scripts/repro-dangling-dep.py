# -*- coding: utf-8 -*-
"""复现"子任务 2 依赖的子任务 1 不存在"：3 步流程（当前日期→一个月后→查高强度钢板库存）。
抓取 submit_plan 提交的原始规划（plan_confirm 事件中的 seq/depends_on）与后续 error/校验事件，
定位悬空依赖是 LLM 初次提交就有，还是确认/中继环节产生。
"""
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
        return {'_http_error': e.code, '_body': e.read().decode('utf-8', errors='replace')[:300]}


def show_plan(plan, tag):
    print(f'\n=== {tag} ===')
    for st in plan.get('subtasks', []):
        print(f"  seq={st.get('seq')} fn={st.get('function') or ''} bh={st.get('behavior') or ''} "
              f"depends_on={st.get('depends_on')} desc={st.get('description', '')[:30]}")


tid = post(API_BASE, {'title': 'repro-悬空依赖', 'ontology_scope': [{'scenario': SCEN, 'ontology': ONTO}]})['id']
print(f'thread: {tid}')

url = API_BASE + f'/{tid}/chat'
body = json.dumps({'message': '请构建一个3步流程：获取当前日期 → 计算一个月后的日期 → 查询高强度钢板库存'}).encode('utf-8')
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
                show_plan(evt.get('plan') or {}, 'plan_confirm 弹窗规划（= 父Agent submit_plan 原始提交）')
                post(BASE + f'/plan-confirm/{evt["confirmId"]}', {'approved': True})
                print('  → 已自动批准')
            elif t == 'confirm':
                post(BASE + f'/confirm/{evt["confirmId"]}', {'approved': True})
            elif t == 'error':
                print(f'\n!!! error 事件: {evt.get("message")}')
            elif t == 'exec_entry':
                e = evt.get('entry', {})
                if e.get('type') in ('subtask_done',) and ('校验' in (e.get('name') or '') or '修正' in (e.get('name') or '') or '调整' in (e.get('detail') or '')):
                    print(f'  [exec_entry] {e.get("name")} | {e.get("status")} | {(e.get("detail") or "")[:120]}')
            elif t == 'plan_received':
                show_plan(evt.get('plan') or {}, 'plan_received（确认后最终规划）')
            elif t == 'done':
                print('\n=== done ===')
        buf = b''
