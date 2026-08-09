# -*- coding: utf-8 -*-
"""E2E 验证规划确认收窄：单步无规划弹窗 / 写操作仍有安全确认 / 多步弹窗含中文 display_name"""
import json
import sys
import time
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


def chat_events(tid, message, approve_plan=True):
    """发送消息，SSE 流式读取事件；遇确认弹窗自动批准。返回 (事件列表, 汇总文本)。"""
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
                    if t == 'plan_confirm' and approve_plan:
                        post(BASE + f'/plan-confirm/{evt["confirmId"]}', {'approved': True})
                    elif t == 'confirm' and approve_plan:
                        post(BASE + f'/confirm/{evt["confirmId"]}', {'approved': True})
                buf = b''
    # 汇总 tokens 文本
    tokens = ''.join(e.get('token', '') for e in events if e.get('type') == 'token')
    return events, tokens


def summarize(tag, events):
    types = [e['type'] for e in events]
    print(f'=== {tag} ===')
    print(f'  事件序列: {types}')
    plan_confirm = [e for e in events if e['type'] == 'plan_confirm']
    confirm = [e for e in events if e['type'] == 'confirm']
    plan_received = [e for e in events if e['type'] == 'plan_received']
    print(f'  plan_confirm 弹窗: {len(plan_confirm)} 个')
    print(f'  security_confirm 弹窗: {len(confirm)} 个')
    if plan_received:
        subs = plan_received[-1]['plan']['subtasks']
        print(f'  plan_received 子任务数: {len(subs)}')
        for st in subs:
            dn = st.get('display_name', '')
            print(f'    - behavior={st["behavior"]}  display_name="{dn}"  desc="{st.get("description","")[:30]}"')
    if plan_confirm:
        subs = plan_confirm[-1]['plan']['subtasks']
        print(f'  plan_confirm 弹窗子任务:')
        for st in subs:
            dn = st.get('display_name', '')
            print(f'    - behavior={st["behavior"]}  display_name="{dn}"')
    if confirm:
        for c in confirm:
            print(f'  security_confirm: behavior={c.get("behavior")}')
    errors = [e.get('message', '') for e in events if e['type'] == 'error']
    if errors:
        print(f'  ERROR: {errors[-1][:120]}')
    print()
    return plan_confirm, confirm, plan_received


def main():
    tid = new_thread('E2E规划确认验证')
    print(f'线程: {tid}\n')

    # ── 场景 A：单步只读 → 预期无 plan_confirm、无 security_confirm ──
    eventsA, tokensA = chat_events(tid, '请直接查询原材料 RM-001 高强度钢板的当前库存，只需要查询库存，不要做其他任何操作。')
    pcA, scA, prA = summarize('场景A: 单步只读查询', eventsA)

    # ── 场景 B：单步写 → 预期无 plan_confirm、有 security_confirm ──
    eventsB, tokensB = chat_events(tid, '请直接创建采购单：原材料 RM-001 高强度钢板，0.1 吨，供应商宝钢钢铁集团，到位时间 2026-08-20，信息已全部确认无需查询，直接创建。')
    pcB, scB, prB = summarize('场景B: 单步写(创建采购单)', eventsB)

    # ── 场景 C：多步 → 预期有 plan_confirm 且 display_name 为中文 ──
    # 显式列出 3 步操作，提高 LLM 生成多步规划的概率；未生成则重试一次
    promptC = '请按顺序执行以下操作：1) 查询高强度钢板 RM-001 的当前库存；2) 创建 100 公斤高强度钢板的采购单，供应商宝钢钢铁集团，到位时间 2026-08-20；3) 到货后办理入库。'
    eventsC, tokensC = chat_events(tid, promptC)
    pcC, scC, prC = summarize('场景C: 多步(查询+采购+入库)', eventsC)
    if len(pcC) == 0:
        print('  → 本轮未生成多步规划，重试一次...\n')
        eventsC, tokensC = chat_events(tid, promptC)
        pcC, scC, prC = summarize('场景C(重试): 多步(查询+采购+入库)', eventsC)

    # ── 断言 ──
    print('========== 断言结果 ==========')
    ok = True
    def check(name, cond):
        nonlocal ok
        ok = ok and bool(cond)
        print(f'  [{"PASS" if cond else "FAIL"}] {name}')

    # 场景A：单步(或读操作)时无规划弹窗
    subA = prA[-1]['plan']['subtasks'] if prA else []
    check('A: 无 plan_confirm 弹窗', len(pcA) == 0)
    if len(subA) == 1:
        check('A: 单步只读无 security_confirm', len(scA) == 0)
    else:
        print('  [SKIP] A 实际为多步，安全确认断言跳过')

    # 场景B：写操作无规划弹窗 + 有安全确认
    check('B: 无 plan_confirm 弹窗', len(pcB) == 0)
    check('B: 有 security_confirm 弹窗', len(scB) >= 1)

    # 场景C：多步有规划弹窗 + display_name 中文
    check('C: 有 plan_confirm 弹窗', len(pcC) >= 1)
    if pcC:
        dns = [st.get('display_name', '') for st in pcC[0]['plan']['subtasks']]
        check('C: display_name 全部为非空中文', all(d and not d.isascii() for d in dns))

    print(f'\n总体: {"✅ 全部通过" if ok else "❌ 有失败项"}')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
