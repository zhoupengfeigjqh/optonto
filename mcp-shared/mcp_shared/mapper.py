"""映射翻译（迁自 core-backend services/data_engine.py；http_call 已随阶段五 HTTP 型删除而移除）。

映射本质是字典：运行期只换名不校验 schema，字段清单仅为设计期参照。
_translate_input：本体路径 → 目标路径（原地换名不改结构，递归，含 [*] 数组路径）。
_translate_output：目标路径 → 本体名，白名单语义（未映射字段丢弃不透传）。
"""


def _translate_input(params: dict, input_mapping: dict, _onto_path: str = "") -> dict:
    """Rename ontology param keys to target keys via input_mapping (recursive, in-place).

    与 _translate_output 同构（方向相反：本体路径 → 目标路径，原地换名不改结构）。
    平铺映射是路径的特例；object 内嵌套字段、array[object] 内部字段（[*] 路径）均可换名：
    {"order.lines[*].prod": "order.items[*].prod_name", "order.lines": "order.items"}
    """
    if not input_mapping or not params:
        return params
    result = {}
    for k, v in params.items():
        onto_path = f"{_onto_path}.{k}" if _onto_path else k
        target_full = input_mapping.get(onto_path, k)
        new_key = target_full.rsplit(".", 1)[-1]
        result[new_key] = _translate_input_value(v, input_mapping, onto_path)
    return result


def _translate_input_value(value, input_mapping: dict, onto_path: str):
    """值递归：dict 继续换名，list 元素走 [*] 路径，标量原样透传。"""
    if isinstance(value, dict):
        return _translate_input(value, input_mapping, onto_path)
    if isinstance(value, list):
        item_path = f"{onto_path}[*]"
        return [_translate_input_value(item, input_mapping, item_path) for item in value]
    return value


def _translate_output(data, output_mapping: dict, _orig_path: str = "", _ctx: tuple | None = None):
    """Recursively rename keys in target response back to ontology names via output_mapping.

    查表一律用目标原始路径（_orig_path 由响应里的真实 key 拼成），与父节点是否改名无关——
    因此数组/对象节点换名与其内部字段换名可共存（如 {"items": "data", "items[*].name": "data[*].prod_name"}）。

    白名单语义：映射非空时，未被任何映射目标路径覆盖（精确命中或作为祖先前缀）的字段
    一律丢弃，不再原样透传——实例视图/连接测试/智能体应用三端同口径，只暴露本体契约字段。
    映射为空（如 SQL 引擎）时不过滤，原样返回。空串映射值（"本体属性在目标无来源"）
    不产生目标路径，天然不参与白名单。
    """
    if not output_mapping or not data:
        return data
    if _ctx is None:
        reverse_map = {v: k for k, v in output_mapping.items() if v}
        _ctx = (reverse_map, set(reverse_map.keys()))
    reverse_map, target_paths = _ctx

    def _covered(path: str) -> bool:
        """目标路径被映射覆盖：精确命中，或作为某个映射路径的祖先（容器节点）。"""
        if path in target_paths:
            return True
        return any(t.startswith(path + ".") or t.startswith(path + "[*]") for t in target_paths)

    if isinstance(data, dict):
        result = {}
        for k, v in data.items():
            orig_path = f"{_orig_path}.{k}" if _orig_path else k
            if not _covered(orig_path):
                continue  # 未映射字段：丢弃，不透传
            onto_full = reverse_map.get(orig_path, k)
            new_key = onto_full.rsplit(".", 1)[-1]
            result[new_key] = _translate_output(v, output_mapping, orig_path, _ctx)
        return result
    if isinstance(data, list):
        orig_path = f"{_orig_path}[*]" if _orig_path else "[*]"
        return [_translate_output(item, output_mapping, orig_path, _ctx) for item in data]
    return data
