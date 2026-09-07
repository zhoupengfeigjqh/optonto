# -*- coding: utf-8 -*-
"""E2E 验证可见性管控"配映射即收编"（架构文档 §六，阶段三）：

断言：
A. 把 business-mcp 手工配进 mcp-config + 在某本体 data_engines 配一条 engine_type=MCP 映射后，
   Agent 工具发现日志出现"收编隐藏 N 个已映射原始工具"（原始工具对 Agent 不可见，行为 facade 是唯一入口）
B. 设计期探针 /mcp-config/test 不受收编影响（仍列出 business-mcp 全部 8 个工具——映射页要靠它取 schema）
C. 收编不碰内置服务：本体MCP/数据引擎MCP 日志无"收编隐藏"

全程可逆：data_engines.yaml 先备份后恢复；mcp-config 还原为进入时状态。
"""
import json
import shutil
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

BASE = 'http://localhost:8003/agent-api'
SCEN = '生产调度'
ONTO = '原材料采购和库存'
BIZ_URL = 'http://optonto-business-mcp:8004/sse'
REPO = Path(__file__).resolve().parent.parent.parent
ENGINES_YAML = REPO / '.data' / 'onto_market' / SCEN / ONTO / 'data_engines.yaml'
BAK = ENGINES_YAML.with_suffix('.yaml.e2ebak')

SCRATCH_ENGINE = (
    '\n- name: E2E收编探针\n'
    '  behavior_name: e2eNoSuchBehavior\n'  # 不存在的占位行为：引擎条目对 facade 编译惰性，仅供收编索引扫描
    f'  target: {{server_url: "{BIZ_URL}", tool_name: query_inventories}}\n'
)

API = '/'.join([BASE, 'onto_market', urllib.parse.quote(SCEN), urllib.parse.quote(ONTO), 'threads'])
failures = []


def req(method, url, body=None, timeout=60):
    data = json.dumps(body).encode('utf-8') if body is not None else None
    r = urllib.request.Request(url, data=data, headers={'Content-Type': 'application/json'}, method=method)
    with urllib.request.urlopen(r, timeout=timeout) as resp:
        return json.loads(resp.read().decode('utf-8'))


def check(name, ok):
    print(('[PASS] ' if ok else '[FAIL] ') + name)
    if not ok:
        failures.append(name)


def chat(tid, message):
    body = json.dumps({'message': message}).encode('utf-8')
    r = urllib.request.Request(API + f'/{tid}/chat', data=body, headers={'Content-Type': 'application/json'}, method='POST')
    with urllib.request.urlopen(r, timeout=300) as resp:
        events = []
        buf = b''
        while True:
            ch = resp.read(1)
            if not ch:
                break
            buf += ch
            if buf.endswith(b'\n\n'):
                for line in buf.decode('utf-8', errors='replace').splitlines():
                    if line.startswith('data: '):
                        events.append(json.loads(line[6:]))
                buf = b''
    return events


orig_config = req('GET', BASE + '/mcp-config')
print('进入时 mcp-config servers:', [s['name'] for s in orig_config['servers']])

shutil.copy(ENGINES_YAML, BAK)
try:
    # 1) 手工配置 business-mcp（模拟业务系统，非内置）
    servers = [s for s in orig_config['servers'] if s.get('url') != BIZ_URL]
    servers.append({'name': '业务系统MCP', 'url': BIZ_URL, 'enabled': True})
    req('PUT', BASE + '/mcp-config', {'servers': servers})

    # 2) 配映射：scratch 引擎 → business-mcp query_inventories
    with open(ENGINES_YAML, 'a', encoding='utf-8') as f:
        f.write(SCRATCH_ENGINE)
    time.sleep(1)  # 等 mtime 越过一个刻度

    # 3) B: 设计期探针不受收编影响
    probe = req('POST', BASE + '/mcp-config/test', {'url': BIZ_URL})
    probe_names = [t['name'] for t in probe.get('tools', [])]
    check('设计期探针列出 business-mcp 全部 8 工具（含已映射的 query_inventories）',
          probe.get('success') and len(probe_names) == 8 and 'query_inventories' in probe_names)
    check('探针透出 outputSchema（阶段四映射页数据源）',
          all(t.get('outputSchema') for t in probe.get('tools', [])))

    # 4) A: 跑一次对话触发 discoverTools，然后查 agent 日志的收编行
    since = subprocess.run(['date', '-u', '+%Y-%m-%dT%H:%M:%S'], capture_output=True, text=True).stdout.strip()
    tid = req('POST', API, {'title': 'visibility-E2E',
                            'ontology_scope': [{'scenario': SCEN, 'ontology': ONTO}]})['id']
    print('thread:', tid)
    evts = chat(tid, '你好，请回复收到。')
    time.sleep(2)
    logs = subprocess.run(['docker', 'logs', '--since', since, 'optonto-agent-backend'],
                          capture_output=True).stdout.decode('utf-8', errors='replace')
    biz_lines = [l for l in logs.splitlines() if '业务系统MCP' in l]
    for l in biz_lines:
        print('  log:', l.strip())
    # 阶段五后：存量 8 引擎已改绑 MCP，本体的 7 个已映射原始工具本就在收编清单；
    # scratch 引擎的 query_inventories 与真实 QueryInventory 引擎同工具（去重后不增量）。
    # 断言"至少收编 1 个"而非精确 1 个——收编机制 firing 即通过。
    import re as _re
    check('业务系统MCP 发现 8 工具且收编隐藏 ≥1 个已映射原始工具',
          any('发现 8 个工具' in l and (m := _re.search(r'收编隐藏 (\d+) 个', l)) and int(m.group(1)) >= 1
              for l in biz_lines))
    # C: 内置服务永不收编
    builtin_hidden = [l for l in logs.splitlines() if ('本体MCP' in l or '数据引擎MCP' in l) and '收编隐藏' in l]
    check('内置服务（本体MCP/数据引擎MCP）无收编隐藏', not builtin_hidden)
    check('对话有 done 收尾', any(e.get('type') == 'done' for e in evts))
finally:
    BAK.replace(ENGINES_YAML)
    req('PUT', BASE + '/mcp-config', {'servers': orig_config['servers']})
    print('已还原 data_engines.yaml 与 mcp-config')

print('---')
print('E2E 结果:', '全部通过' if not failures else f'{len(failures)} 项失败: {failures}')
sys.exit(1 if failures else 0)
