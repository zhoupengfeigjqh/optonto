# -*- coding: utf-8 -*-
"""E2E 前置规则留痕闸（闸2）：给 V01 补挂函数 checkRawMaterialUnit，验证主行为调用前的函数留痕检查。
步骤：建函数（API 含静态校验）→ 写代码 → V01 补挂 related_functions → 等 mtime 刷新 → 真实对话看执行顺序。
预期：checkRawMaterialUnit 先于 CreatePurchaseRecord 被调用（子Agent遵守前置要求），
或出现"前置规则留痕缺失"报错后补跑重试（闸2实际拦截）——两种形态都证明链路生效。
"""
import json
import sys
import time
import urllib.request
import urllib.parse

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

CORE = 'http://localhost:8001/api'
AGENT = 'http://localhost:8003/agent-api'
SCEN, ONTO = '生产调度', '原材料采购和库存'
OID = 1
FN = 'checkRawMaterialUnit'

FUNC_CODE = '''def run(params: dict) -> dict:
    """
    校验采购单参数：rawMaterialId 必须存在于原材料主数据，且 unit 与该原材料定义单位一致。

    Params:
        rawMaterialId: str，采购单提供的原材料ID
        unit: str，采购单提供的计量单位
        rawMaterialSet: list，原材料主数据列表，每条记录包含 rawMaterialId 与 unit

    Returns:
        dict: {result: {pass: bool, message: str}}
    """
    raw_material_id = params.get("rawMaterialId")
    unit = params.get("unit")
    raw_material_set = params.get("rawMaterialSet") or []
    matched = [r for r in raw_material_set if isinstance(r, dict) and r.get("rawMaterialId") == raw_material_id]
    if not matched:
        return {"result": {"pass": False, "message": "原材料ID %s 不存在于原材料主数据" % raw_material_id}}
    defined_unit = matched[0].get("unit")
    if unit != defined_unit:
        return {"result": {"pass": False, "message": "单位不一致：采购单为 %s，原材料定义为 %s" % (unit, defined_unit)}}
    return {"result": {"pass": True, "message": "原材料存在且单位一致"}}
'''


def req(method, url, body=None):
    data = json.dumps(body).encode('utf-8') if body is not None else None
    r = urllib.request.Request(url, data=data, headers={'Content-Type': 'application/json'}, method=method)
    try:
        with urllib.request.urlopen(r, timeout=60) as resp:
            return resp.status, json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        return e.code, {'_body': e.read().decode('utf-8', errors='replace')[:300]}


def main():
    # ── 1. 建函数元数据（幂等：已存在则跳过） ──
    s, d = req('POST', f'{CORE}/ontologies/{OID}/functions', {
        'name': FN,
        'display_name': '校验采购原材料单位一致性',
        'description': '校验采购单的 rawMaterialId 存在于原材料主数据，且 unit 与原材料定义单位一致。服务于前置规则 V01。',
        'related_concepts': ['PurchaseRecord', 'RawMaterial'],
        'params': {
            'rawMaterialId': {'type': 'string', 'display_name': '原材料ID', 'example': 'RM-001', 'required': True},
            'unit': {'type': 'string', 'display_name': '计量单位', 'example': '吨', 'required': True},
            'rawMaterialSet': {'type': 'array', 'display_name': '原材料主数据集', 'required': True, 'items': {'type': 'object', 'properties': {
                'rawMaterialId': {'type': 'string', 'display_name': '原材料ID', 'required': True},
                'unit': {'type': 'string', 'display_name': '单位', 'required': True},
            }}},
        },
        'response': {'result': {'type': 'object', 'display_name': '校验结果'}},
        'code_file': f'functions/{FN}.py',
    })
    print('1. 建函数:', s, '' if s in (200, 201) else d)
    if s == 400:  # 已存在
        print('   （已存在，跳过）')

    # ── 2. 写函数代码（保存期 _validate_function_code 静态校验） ──
    s, d = req('PUT', f'{CORE}/ontologies/{OID}/functions/{FN}/code', {'code': FUNC_CODE})
    print('2. 写代码:', s, '' if s == 200 else d)

    # ── 3. V01 补挂 related_functions ──
    s, rules = req('GET', f'{CORE}/ontologies/{OID}/rules')
    v01 = next(r for r in rules if r['name'] == 'V01_UnitConsistency_Purchase')
    if FN not in (v01.get('related_functions') or []):
        v01['related_functions'] = [FN]
        s, d = req('PUT', f'{CORE}/ontologies/{OID}/rules/V01_UnitConsistency_Purchase', v01)
        print('3. V01 补挂函数:', s, '' if s == 200 else d)
    else:
        print('3. V01 已挂', FN, '，跳过')

    # ── 4. 等 MCP mtime 指纹刷新（免重启） ──
    print('4. 等待 8s 让 MCP 指纹刷新...')
    time.sleep(8)

    # ── 5. 真实对话：创建采购单，观察执行顺序 ──
    base = '/'.join([AGENT, 'onto_market', urllib.parse.quote(SCEN), urllib.parse.quote(ONTO), 'threads'])
    s, th = req('POST', base, {'title': 'e2e-前置留痕闸', 'ontology_scope': [{'scenario': SCEN, 'ontology': ONTO}]})
    tid = th['id']
    print('5. 线程:', tid)

    body = json.dumps({'message': '创建采购单：原材料RM-001高强度钢板，数量 5，单位 吨，供应商 宝钢钢铁集团，到位时间 2026-09-20'}).encode('utf-8')
    r = urllib.request.Request(base + f'/{tid}/chat', data=body, headers={'Content-Type': 'application/json'}, method='POST')
    events = []
    tokens = []
    with urllib.request.urlopen(r, timeout=300) as resp:
        buf = b''
        while True:
            chunk = resp.read(1)
            if not chunk:
                break
            buf += chunk
            while b'\n' in buf:
                line, buf = buf.split(b'\n', 1)
                line = line.strip()
                if not line.startswith(b'data:'):
                    continue
                try:
                    ev = json.loads(line[5:].decode('utf-8'))
                except Exception:
                    continue
                k = ev.get('type')
                if k == 'exec_entry':
                    e = ev.get('entry', {})
                    events.append(e)
                elif k == 'token':
                    tokens.append(ev.get('text', ''))
                elif k == 'confirm':
                    req('POST', f'{AGENT}/confirm/{ev["confirmId"]}', {'approved': True})
                elif k == 'plan_confirm':
                    req('POST', f'{AGENT}/plan-confirm/{ev["confirmId"]}', {'approved': True})

    # ── 6. 分析：函数与主行为的调用顺序 + 是否出现闸2拦截 ──
    calls = [(e.get('name'), e.get('status'), (e.get('result') or e.get('detail') or '')[:120])
             for e in events if e.get('type') == 'tool_call']
    print('\n=== 工具调用序列 ===')
    for c in calls:
        print(' ', c[0], c[1], c[2] if c[1] != 'running' else '')

    fn_idx = [i for i, c in enumerate(calls) if c[0] == FN and c[1] == 'done']
    beh_idx = [i for i, c in enumerate(calls) if c[0] == 'CreatePurchaseRecord' and c[1] == 'done']
    gate_hits = [c for c in calls if '留痕缺失' in (c[2] or '')]

    print('\n========== 断言 ==========')
    ok = True
    if fn_idx:
        print('  [PASS] 规则函数', FN, '已被调用留痕（次数:%d）' % len(fn_idx))
    else:
        ok = False
        print('  [FAIL] 规则函数未被调用')
    if fn_idx and beh_idx:
        if fn_idx[0] < beh_idx[0]:
            print('  [PASS] 函数留痕先于主行为完成')
        else:
            ok = False
            print('  [FAIL] 主行为先于函数留痕完成（闸2未拦住？）')
    elif not beh_idx:
        print('  [INFO] 主行为未执行（可能被子Agent因规则验证不通过而拒绝）')
    if gate_hits:
        print('  [PASS] 观测到闸2拦截记录（前置规则留痕缺失）→ 子Agent补跑纠正')
    else:
        print('  [INFO] 未触发闸2拦截（子Agent按指令主动先调函数，闸作为兜底未 firing）')
    print('\n总结:', ''.join(tokens)[:300])
    print('\n总体:', '✅ 通过' if ok else '❌ 失败')


if __name__ == '__main__':
    main()
