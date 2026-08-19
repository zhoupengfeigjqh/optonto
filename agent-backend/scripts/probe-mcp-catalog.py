# -*- coding: utf-8 -*-
"""直连 MCP server (SSE) 列出工具目录，核对发布方标记：
①本体函数 → scope.category/display_name const；②公共函数 → x-category/x-display_name；③无标记。
raw socket 读 SSE（uvicorn 用 \r\n 行尾 + chunked，urllib 的 read 语义会踩坑）。
用法: python probe-mcp-catalog.py [host:port]   默认 localhost:8002
"""
import json
import socket
import sys
import threading
import time
import urllib.request
import urllib.parse

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

BASE = sys.argv[1] if len(sys.argv) > 1 else 'localhost:8002'
HOST, PORT = BASE.split(':')
MCP = f'http://{BASE}'

msg_url = None
ready = threading.Event()
responses = {}
buf_lock = threading.Lock()


def reader():
    global msg_url
    try:
        sock = socket.create_connection((HOST, int(PORT)), timeout=10)
        sock.sendall(f'GET /sse HTTP/1.1\r\nHost: {BASE}\r\nAccept: text/event-stream\r\n\r\n'.encode())
        raw = b''
        # 跳过响应头
        while b'\r\n\r\n' not in raw:
            chunk = sock.recv(4096)
            if not chunk:
                raise ConnectionError('连接在响应头前关闭')
            raw += chunk
        raw = raw.split(b'\r\n\r\n', 1)[1]
        frame = b''
        while True:
            chunk = sock.recv(4096)
            if not chunk:
                break
            raw += chunk
            # 解 chunked：循环剥离 <size>\r\n<data>\r\n
            while True:
                nl = raw.find(b'\r\n')
                if nl < 0:
                    break
                try:
                    size = int(raw[:nl].split(b';')[0], 16)
                except ValueError:
                    # 半包或 keep-alive 空行，等更多数据（丢一个 CRLF 也行）
                    raw = raw[2:] if raw.startswith(b'\r\n') else raw
                    break
                if len(raw) < nl + 2 + size + 2:
                    break
                frame += raw[nl + 2: nl + 2 + size]
                raw = raw[nl + 2 + size + 2:]
                if size == 0:
                    return
            # 解 SSE 帧（\r\n\r\n 或 \n\n 分隔）
            for sep in (b'\r\n\r\n', b'\n\n'):
                while sep in frame:
                    block, frame = frame.split(sep, 1)
                    ev, data = '', None
                    for line in block.replace(b'\r\n', b'\n').decode('utf-8', 'replace').split('\n'):
                        if line.startswith('event: '):
                            ev = line[7:]
                        elif line.startswith('data: '):
                            data = line[6:]
                    if ev == 'endpoint':
                        msg_url = MCP + data
                        ready.set()
                    elif ev == 'message' and data:
                        m = json.loads(data)
                        if 'id' in m:
                            responses[m['id']] = m
    except Exception as e:
        print(f'SSE 线程异常: {type(e).__name__}: {e}', file=sys.stderr)
        ready.set()


def send(payload):
    data = json.dumps(payload).encode('utf-8')
    req = urllib.request.Request(msg_url, data=data, headers={'Content-Type': 'application/json'}, method='POST')
    urllib.request.urlopen(req, timeout=30).read()


def rpc(rid, method, params=None):
    send({'jsonrpc': '2.0', 'id': rid, 'method': method, 'params': params or {}})
    for _ in range(200):
        if rid in responses:
            return responses[rid]
        time.sleep(0.1)
    raise TimeoutError(method)


threading.Thread(target=reader, daemon=True).start()
if not ready.wait(10):
    print('SSE endpoint 等待超时', file=sys.stderr)
    sys.exit(1)

rpc(1, 'initialize', {'protocolVersion': '2024-11-05', 'capabilities': {}, 'clientInfo': {'name': 'probe', 'version': '0'}})
send({'jsonrpc': '2.0', 'method': 'notifications/initialized'})
tools = rpc(2, 'tools/list')['result']['tools']
print(f'工具总数: {len(tools)}')
for t in tools:
    s = t.get('inputSchema', {})
    scope = (s.get('properties') or {}).get('scope') or {}
    sp = scope.get('properties') or {}
    cat = (sp.get('category') or {}).get('const') or s.get('x-category') or '(无标记→其他MCP工具)'
    dn = (sp.get('display_name') or {}).get('const') or s.get('x-display_name') or ''
    print(f'  {t["name"]:35s} category={cat:15s} display_name={dn}')
for t in tools:
    if t['name'] == 'sumRawNotArrivalQty':
        print('\nsumRawNotArrivalQty scope 全貌:')
        print(json.dumps(t['inputSchema']['properties'].get('scope'), ensure_ascii=False, indent=1))
        break
for t in tools:
    if t['name'] == 'getCurrentDate':
        print('\ngetCurrentDate 顶层键:', list(t['inputSchema'].keys()))
        break
