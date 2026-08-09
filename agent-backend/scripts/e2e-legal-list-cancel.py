# -*- coding: utf-8 -*-
"""E2E：创建一笔采购单 → 取消它。验证"合法行为列表"约束：
子 agent 只调用列表内行为（主行为 CancelPurchaseRecord + 公共函数），不臆造查询行为名、不耗尽报错预算。"""
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


def chat(tid, message):
    """发送消息，SSE 逐字节读取，自动批准确认弹窗，返回事件列表。"""
    url = API_BASE + f'/{tid}/chat'
    body = json.dumps({'message': message}).encode('utf-8')
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
    return events


def report(tag, events):
    types = [e['type'] for e in events]
    print(f'\n== {tag} ==')
    print(f'事件序列: {types}')
    for e in events:
        if e.get('type') == 'plan_received':
            subs = e['plan']['subtasks']
            print(f'[规划] {len(subs)} 个子任务:')
            for st in subs:
                print(f'  - seq={st["seq"]} behavior={st["behavior"]} desc="{st.get("description", "")[:60]}"')
    for e in events:
        t = e.get('type')
        if t in ('subtask_start', 'subtask_done'):
            print(f'[{t}] {e.get("name", "")} status={e.get("status", "")} detail={e.get("detail", "")[:120]}')
        elif t == 'error':
            print(f'[error] {e.get("message", "")[:200]}')
    tokens = ''.join(e.get('token', '') for e in events if e.get('type') == 'token')
    if tokens:
        print(f'========== {tag} 总结 ==========\n{tokens}')
    return tokens


# ── 1. 确定要取消的采购单 ──
# 注意：java-backend 创建接口有 NumberFormatException("0.1") 历史 bug，创建失败无法获单号，
# 故直接用数据库中现存状态为"待入库"的采购单（经查询确认为 PO-20260809-045）。
PO = 'PO-20260809-045'

tid = post(API_BASE, {'title': '合法列表取消验证', 'skill_names': [SKILL]})['id']
print(f'线程: {tid}\n>> 将取消采购单 {PO}\n')

# ── 2. 取消该采购单（验证合法行为列表约束） ──
evX = chat(tid, f'取消采购订单 {PO}。')
report('取消采购单', evX)

# ── 3. 结果判定 ──
errs = [e for e in evX if e.get('type') == 'error']
# 抓取消行为是否真的发生（executeOntoBehavior 调 CancelPurchaseRecord 成功）
cancel_hit = any('CancelPurchaseRecord' in str(e.get('detail', '')) + str(e.get('token', '')) for e in evX if e.get('type') == 'subtask_done')
print(f' 取消子任务明细里出现 CancelPurchaseRecord: {cancel_hit}')
# 是否出现臆造行为/函数（应无）
hallucinated = [e for e in evX if e.get('type') == 'error' and ('行为不存在' in str(e.get('message', '')) or '函数不存在' in str(e.get('message', '')))]
if hallucinated:
    print(f' ⚠ 臆造行为/函数调用 {len(hallucinated)} 次:')
    for e in hallucinated:
        print(f'   - {str(e.get("message", ""))[:120]}')
done = [e for e in evX if e.get('type') == 'subtask_done']
ok = sum(1 for e in done if e.get('status') == 'success')
fail = sum(1 for e in done if e.get('status') == 'failed')
print(f'\n===== 判定 =====')
print(f'取消: {ok} 成功 / {fail} 失败 / error事件 {len(errs)}')
if fail == 0 and not errs:
    print('✅ 合法行为列表约束生效：取消子任务未臆造行为名、未耗尽报错预算')
else:
    print('⚠ 取消子任务存在失败/报错，需人工检查上方明细')
