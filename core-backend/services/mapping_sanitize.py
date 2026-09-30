"""数据引擎映射的落盘前清洗（纯逻辑；分层：业务层，只被路由层调用，不 import fastapi）。

背景：智能映射（``routers/data_engines.analyze_mapping``）的输入输出映射来自 LLM 的 JSON 输出，
可能带上「本体侧不存在」或「目标侧不存在」的路径。这类条目两头看不见：

- UI 不可见——映射弹窗按本体字段清单逐行渲染，键不在清单里的条目没有行可展示，用户既看不到也删不掉；
- 运行期不命中——翻译按真实路径查表（mapper._translate_input/_translate_output），键不存在即静默失效。

故在落盘前清洗，并把剔除项回报给用户（进智能映射结论的 issues）。
"""


def sanitize_mapping(mapping: dict | None, onto_fields: list | None,
                     target_fields: list | None) -> tuple[dict, list[str]]:
    """只保留「本体侧键 ∈ onto_fields 且 目标侧值 ∈ target_fields」的条目。

    空串值（本体属性在目标无来源的显式声明）不参与目标侧校验，恒保留。
    两条保守兜底——宁可留下可疑条目并告警，也不静默改动用户配置：
    - 任一侧字段清单为空（调用方未提供清单）→ 不校验，原样返回；
    - 全部条目都不匹配 → 原样返回（不清空整份映射），仅在 issues 中回报。

    返回 ``(清洗后映射, 问题描述列表)``。
    """
    mapping = dict(mapping or {})
    issues: list[str] = []
    if not mapping or not onto_fields or not target_fields:
        return mapping, issues

    onto_set, target_set = set(onto_fields), set(target_fields)
    kept: dict = {}
    dropped: list[str] = []
    for src, dst in mapping.items():
        if src in onto_set and (not dst or dst in target_set):
            kept[src] = dst
        else:
            dropped.append(f"{src} → {dst or '(空)'}")

    if not kept:
        return mapping, [f"智能映射结果与本体/目标字段清单完全不符，已原样保留待人工核对：{'、'.join(dropped)}"]
    if dropped:
        issues.append(
            f"已剔除 {len(dropped)} 条字段清单中不存在的映射（本体或目标字段不存在）：{'、'.join(dropped)}")
    return kept, issues
