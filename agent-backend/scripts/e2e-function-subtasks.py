# -*- coding: utf-8 -*-
"""E2E 验证函数子任务链路（标记分类重构后）：
场景D：本体函数 sumRawNotArrivalQty 作为函数子任务 → display_name 应取发布方标记"原材料未到位数"
场景E：③其他MCP工具 generate_line_chart 作为函数子任务 → 可规划、可执行
断言：plan 中 function 字段命中、display_name 中文、无 error 事件。
"""
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


def chat_events(tid, message):
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
                    if t == 'plan_confirm':
                        post(BASE + f'/plan-confirm/{evt["confirmId"]}', {'approved': True})
                    elif t == 'confirm':
                        post(BASE + f'/confirm/{evt["confirmId"]}', {'approved': True})
                buf = b''
    return events


def summarize(tag, events):
    types = [e['type'] for e in events]
    print(f'=== {tag} ===')
    non_token = [t for t in types if t != 'token']
    print(f'  非 token 事件: {non_token}')
    plans = [e for e in events if e['type'] in ('plan_received', 'plan_confirm')]
    fn_subs = []
    for e in plans:
        for st in e['plan']['subtasks']:
            if st.get('function'):
                fn_subs.append(st)
                print(f'  函数子任务: function={st["function"]}  display_name="{st.get("display_name","")}"  desc="{st.get("description","")[:40]}"')
    errors = [e.get('message', '') for e in events if e['type'] == 'error']
    if errors:
        print(f'  ERROR: {errors[-1][:200]}')
    exec_entries = [e for e in events if e['type'] == 'exec_entry']
    for ee in exec_entries:
        print(f'  exec_entry: {json.dumps({k: v for k, v in ee.items() if k != "type"}, ensure_ascii=False)[:160]}')
    done = any(e['type'] == 'done' for e in events)
    print(f'  done: {done}')
    print()
    return fn_subs, errors, done


def main():
    tid = new_thread('E2E函数子任务验证')
    print(f'线程: {tid}\n')

    # ── 场景 D：本体函数子任务（发布方标记：原材料未到位数）──
    evD = chat_events(tid, '请调用函数 sumRawNotArrivalQty 汇总原材料的未到位数量，采购记录集合请自行查询获取。')
    fnD, errD, doneD = summarize('场景D: 本体函数子任务', evD)

    # ── 场景 E：③其他MCP工具子任务（generate_line_chart 无标记）──
    evE = chat_events(tid, '请用折线图工具 generate_line_chart 画一张图，数据用 [{"x":"一月","y":10},{"x":"二月","y":20}]。')
    fnE, errE, doneE = summarize('场景E: 其他MCP工具子任务', evE)

    print('========== 断言结果 ==========')
    ok = True
    def check(name, cond):
        nonlocal ok
        ok = ok and bool(cond)
        print(f'  [{"PASS" if cond else "FAIL"}] {name}')

    check('D: 规划出函数子任务 sumRawNotArrivalQty', any(s['function'] == 'sumRawNotArrivalQty' for s in fnD))
    if fnD:
        check('D: display_name 为发布方标记"原材料未到位数"', any('原材料未到位' in (s.get('display_name') or '') for s in fnD))
    check('D: 无 error 事件', not errD)
    check('D: 正常完成', doneD)

    check('E: 规划出函数子任务 generate_line_chart', any(s['function'] == 'generate_line_chart' for s in fnE))
    check('E: 无 error 事件', not errE)
    check('E: 正常完成', doneE)

    print(f'\n总体: {"✅ 全部通过" if ok else "❌ 有失败项"}')
    sys.exit(0 if ok else 1)


if __name__ == '__main__':
    main()
