# -*- coding: utf-8 -*-
"""阶段五一次性迁移：存量 HTTP(API) 型数据引擎改绑 MCP 型（engine_type: MCP）。

改绑规则（URL↔工具一一对应，business-mcp 即这些 Java 端点的适配器）：
- target.url/method 清空，落 server_url=http://optonto-business-mcp:8004/sse + tool_name
- output_mapping 目标路径重写为新响应形态：
  查询类（GET，数组负载包 {"result":[...]}）：data[*].x → result[*].x，丢弃 code/data 壳条目
  变更类（POST，envelope 解包为记录对象）：data.x → x，丢弃 code/data 壳条目
- input_mapping/params/response 不动（工具入参与 Java 端点同名）

用法：python scripts/migrate-http-engines-to-mcp.py [--apply]   # 默认 dry-run 打印 diff 摘要
"""
import sys
from pathlib import Path

import yaml

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

REPO = Path(__file__).resolve().parent.parent
YAML_PATH = REPO / '.data' / 'onto_market' / '生产调度' / '原材料采购和库存' / 'data_engines.yaml'
BAK_PATH = YAML_PATH.with_suffix('.yaml.p5bak')
BIZ = 'http://optonto-business-mcp:8004/sse'

URL_TO_TOOL = {
    ('POST', '/api/purchase-records'): 'create_purchase_record',
    ('POST', '/api/purchase-records/{purchaseOrderId}/cancel'): 'cancel_purchase_record',
    ('POST', '/api/purchase-records/{purchaseOrderId}/receive'): 'receive_purchase_record',
    ('GET', '/api/inventories'): 'query_inventories',
    ('GET', '/api/purchase-records'): 'query_purchase_records',
    ('GET', '/api/raw-materials'): 'query_raw_materials',
    ('GET', '/api/suppliers'): 'query_suppliers',
    ('GET', '/api/customer-orders'): 'query_customer_orders',
}


def rewrite_output_mapping(mapping: dict, is_query: bool) -> dict:
    out = {}
    for onto_path, target_path in (mapping or {}).items():
        if onto_path in ('code', 'data') or not target_path:
            # 壳条目（code/data 整体）与空映射：新形态无信封壳，丢弃
            continue
        v = target_path
        if is_query:
            if v.startswith('data[*].'):
                v = 'result[*].' + v[len('data[*].'):]
        else:
            if v.startswith('data.'):
                v = v[len('data.'):]
        out[onto_path] = v
    return out


def main():
    apply = '--apply' in sys.argv
    doc = yaml.safe_load(YAML_PATH.read_text(encoding='utf-8'))
    engines = doc.get('data_engines') if isinstance(doc, dict) else doc
    engines = engines or []
    changed = skipped = 0
    for de in engines:
        if not isinstance(de, dict):
            continue
        et = de.get('engine_type') or 'API'
        if et not in ('API', 'HTTP'):
            skipped += 1
            continue
        target = de.get('target') or {}
        url = target.get('url') or ''
        method = (target.get('method') or 'GET').upper()
        path = url.replace('http://optonto-business-backend:8080', '')
        tool = URL_TO_TOOL.get((method, path))
        if not tool:
            print(f'[跳过] {de.get("name")}: 未知端点 {method} {url}')
            skipped += 1
            continue
        is_query = method == 'GET'
        de['engine_type'] = 'MCP'
        target['server_url'] = BIZ
        target['tool_name'] = tool
        target['url'] = ''
        target['method'] = ''
        de['target'] = target
        de['output_mapping'] = rewrite_output_mapping(de.get('output_mapping') or {}, is_query)
        changed += 1
        print(f'[改绑] {de["name"]}: {method} {path} → MCP {tool}（输出映射 {len(de["output_mapping"])} 条）')

    print(f'---\n改绑 {changed} 条，跳过 {skipped} 条')
    if not apply:
        print('dry-run，未写盘。加 --apply 实际执行（自动备份 .p5bak）')
        return
    if not BAK_PATH.exists():
        BAK_PATH.write_text(YAML_PATH.read_text(encoding='utf-8'), encoding='utf-8')
    header = '# 数据引擎映射（阶段五已迁移：API(HTTP) 型 → MCP 型，备份 data_engines.yaml.p5bak）\n'
    YAML_PATH.write_text(header + yaml.safe_dump(doc if isinstance(doc, dict) else {'data_engines': engines},
                                                 allow_unicode=True, sort_keys=False), encoding='utf-8')
    print(f'已写盘，备份在 {BAK_PATH.name}')


if __name__ == '__main__':
    main()
