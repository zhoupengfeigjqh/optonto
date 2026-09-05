# -*- coding: utf-8 -*-
"""E2E 验证「工具报错预算 + 超限短路」：
发一个必然失败的写操作（创建采购单，数量 0.1 → java-backend 400），
子Agent 会连续报错；观察是否在第 3 次报错后停止、不再继续试错，
且超限后的工具调用被短路（不执行真实工具）。
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
        return {'_http_error': e.code, '_body': e.read().decode('utf-8', errors='replace')[:200]}


tid = post(API_BASE, {'title': '报错预算短路验证', 'ontology_scope': [{'scenario': SCEN, 'ontology': ONTO}]})['id']
print(f'线程: {tid}\n>> 创建采购单（数量 0.1，后端必然 400）\n')

url = API_BASE + f'/{tid}/chat'
body = json.dumps({'message': '创建一张采购单：高强度钢板 0.1 吨，供应商宝钢钢铁集团，到货日期 2026-09-01。'}).encode('utf-8')
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
                    route = 'plan-confirm' if t == 'plan_confirm' else 'confirm'
                    print(f'  ▶ 批准确认: {t} {evt.get("confirmId")} behavior={evt.get("behavior", "")}')
                    post(BASE + f'/{route}/{evt["confirmId"]}', {'approved': True})
            buf = b''

# ── 事件序列 ──
types = [e['type'] for e in events]
print(f'\n事件序列: {types}\n')

# ── 规划 ──
for e in events:
    if e.get('type') == 'plan_received':
        subs = e['plan']['subtasks']
        print(f'[规划] {len(subs)} 个子任务:')
        for st in subs:
            print(f'  - seq={st["seq"]} behavior={st["behavior"]} desc="{st.get("description", "")[:60]}"')
        break

# ── 工具调用明细（数报错/被短路次数） ──
print('\n── 工具调用执行记录 ──')
err_calls = 0
short_circuit_calls = 0
tool_seq = 0
for e in events:
    if e.get('type') == 'exec_entry':
        entry = e.get('entry', {})
        if entry.get('type') == 'tool_call':
            tool_seq += 1
            name = entry.get('name', '')
            status = entry.get('status', '')
            result = str(entry.get('result', ''))[:90]
            print(f'  [{tool_seq}] [{status}] {name}  result={result}')
            if '连续报错' in result:
                err_calls += 1
            if '已中断执行' in result and '连续报错' in result:
                short_circuit_calls += 1
print(f'共 {tool_seq} 次工具调用')

# ── 子任务结果 ──
# 注意:subtask_done 嵌在 exec_entry.entry 里(entry.type == 'subtask_done'),非顶层事件
print('\n── 子任务结果 ──')
for e in events:
    if e.get('type') == 'exec_entry':
        entry = e.get('entry', {})
        if entry.get('type') == 'subtask_done' and entry.get('source') == 'child':
            print(f'[{entry.get("name", "")}] status={entry.get("status", "")} result={str(entry.get("result", ""))[:150]}')

# ── 总结 ──
tokens = ''.join(e.get('token', '') for e in events if e.get('type') == 'token')
print(f'\n========== 最终总结 ==========\n{tokens}')

# ── 判定 ──
print('\n===== 判定 =====')
done = []
for e in events:
    if e.get('type') == 'exec_entry':
        entry = e.get('entry', {})
        if entry.get('type') == 'subtask_done' and entry.get('source') == 'child':
            done.append(entry)
if any(e.get('status') == 'failed' for e in done):
    print('✅ 子任务失败收尾（符合预期）')
else:
    print('⚠ 子任务未失败？需人工确认')
print(f'报错/中断相关工具调用: {err_calls} 次（含短路）')
print(f'超限后被短路: {short_circuit_calls} 次')
