"""一次性迁移：securities 段从 ontology.yaml 剥离为独立 securities.yaml（全花名册六字段）。

- 不经过 OntologyData 全量 dump（避免重写整个 ontology.yaml 引入格式 diff），
  只文本剥离 securities 段 + 新生成 securities.yaml。
- 花名册：每个行为一条；旧段已有配置（scope/confirm/confirm_content）保留，
  display_name/op_type 按行为定义+数据引擎推导生成；无旧配置的行为用默认值。
"""
import pathlib
import re
import sys

import yaml

BASE = pathlib.Path(__file__).resolve().parent.parent / ".data" / "onto_market" / "生产调度"
WRITE_METHODS = {"POST", "PATCH", "DELETE", "PUT"}
TOP_KEY = re.compile(r"^[A-Za-z_][\w-]*:")


def resolve_op_type(behavior: dict, engines: list) -> str:
    op = behavior.get("op_type") or ""
    if op in ("command", "query"):
        return op
    eng = next((d for d in engines if d.get("behavior_name") == behavior.get("name")), None)
    if eng and eng.get("engine_type") != "SQL" and (eng.get("target", {}).get("method", "") or "").upper() in WRITE_METHODS:
        return "command"
    return "query"


def migrate(ont_dir: pathlib.Path) -> None:
    oy = ont_dir / "ontology.yaml"
    if not oy.exists():
        return
    raw = yaml.safe_load(oy.read_text(encoding="utf-8")) or {}
    behaviors = raw.get("behaviors") or []

    engines = []
    de_path = ont_dir / "data_engines.yaml"
    if de_path.exists():
        de_raw = yaml.safe_load(de_path.read_text(encoding="utf-8")) or {}
        engines = de_raw.get("data_engines", []) if isinstance(de_raw, dict) else de_raw

    old_secs = {s["action_name"]: s for s in (raw.get("securities") or [])}
    roster = []
    for b in behaviors:
        name = b["name"]
        op = resolve_op_type(b, engines)
        old = old_secs.get(name, {})
        scope = old.get("scope", ["everyone"])
        if isinstance(scope, str):  # 旧标量形态 → 单元素数组（scope 恒数组，类型稳定）
            scope = [scope]
        roster.append({
            "action_name": name,
            "display_name": b.get("display_name") or name,
            "op_type": op,
            "scope": scope,
            "confirm": old.get("confirm", op == "command"),
            "confirm_content": old.get("confirm_content", ""),
        })

    (ont_dir / "securities.yaml").write_text(
        yaml.dump({"securities": roster}, allow_unicode=True, sort_keys=False),
        encoding="utf-8",
    )

    # 文本剥离 ontology.yaml 的 securities 段（段内行 = 非顶层 key 行）
    lines = oy.read_text(encoding="utf-8").splitlines(keepends=True)
    out, in_sec = [], False
    for ln in lines:
        if ln.startswith("securities:"):
            in_sec = True
            continue
        if in_sec and TOP_KEY.match(ln):
            in_sec = False
        if not in_sec:
            out.append(ln)
    oy.write_text("".join(out), encoding="utf-8")
    print(f"{ont_dir.name}: {len(roster)} 条花名册（旧配置保留 {len(old_secs)} 条）")


for d in sorted(BASE.iterdir()):
    if d.is_dir():
        migrate(d)
print("done", file=sys.stderr)
