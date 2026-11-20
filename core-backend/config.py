"""Application configuration and centralized prompt management.

提示词常量已迁移至 prompts.py；此处仅保留路径配置 + 再导出，兼容历史 `from config import X`。
"""

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


def _env_int(name: str, default: int) -> int:
    """读整数环境变量；未设置/非法值一律回退默认值（配置不应让进程起不来）。"""
    try:
        return int(os.environ.get(name, "").strip() or default)
    except (TypeError, ValueError):
        return default

# 统一数据目录（项目根目录 .data，与 backend 同级）
DATA_DIR = BASE_DIR / ".data"
ONTO_MARKET_DIR = DATA_DIR / "onto_market"
CONFIG_DIR = BASE_DIR / "config"

# 会话线程统一存放（.data/threads，与本体目录解耦）
THREADS_DIR = DATA_DIR / "threads"
DEMAND_THREADS_DIR = THREADS_DIR / "demand"
AGENT_THREADS_DIR = THREADS_DIR / "agent"

# Ensure directories exist
ONTO_MARKET_DIR.mkdir(parents=True, exist_ok=True)
CONFIG_DIR.mkdir(parents=True, exist_ok=True)
DEMAND_THREADS_DIR.mkdir(parents=True, exist_ok=True)
AGENT_THREADS_DIR.mkdir(parents=True, exist_ok=True)

# SQLite 已移除，元数据改用 meta.json 文件存储

# ─── 上下文压缩（需求对话，2026-11-20 定稿） ──────────────────────────────────
# 名义窗口只用于换算比例，不直接当作工作预算：300K 全量塞满会带来成本、延迟
# 与长上下文信息衰减问题。全部可用环境变量覆盖（模型会换，禁止硬编码）。
LLM_CONTEXT_WINDOW = _env_int("LLM_CONTEXT_WINDOW", 300_000)
# 触发阈值：未压缩轮数超过 70，或估算 tokens（system + 摘要 + 未压原文）达到 200K
CONTEXT_TRIGGER_ROUNDS = _env_int("CONTEXT_TRIGGER_ROUNDS", 70)
CONTEXT_TRIGGER_TOKENS = _env_int("CONTEXT_TRIGGER_TOKENS", 200_000)
# 轮数触发时的保留窗口（最近 40 轮），其余归档；稳态每次归档约 30 轮
CONTEXT_KEEP_ROUNDS = _env_int("CONTEXT_KEEP_ROUNDS", 40)
# token 触发时的保留窗口按 tokens 反推，且不少于该轮数（触底保护，防模型"断片"）
CONTEXT_KEEP_TOKENS = _env_int("CONTEXT_KEEP_TOKENS", 40_000)
CONTEXT_MIN_KEEP_ROUNDS = _env_int("CONTEXT_MIN_KEEP_ROUNDS", 8)
# 摘要硬上限（注入 system prompt 的长度）与单条消息硬上限（防单条粘贴打爆）
CONTEXT_SUMMARY_MAX_TOKENS = _env_int("CONTEXT_SUMMARY_MAX_TOKENS", 2_000)
CONTEXT_SINGLE_MSG_MAX_TOKENS = _env_int("CONTEXT_SINGLE_MSG_MAX_TOKENS", 20_000)
# 摘要源对话上限：一次归档的原文过大时先按 token 截断，避免压缩调用自身超限
CONTEXT_SUMMARY_SOURCE_MAX_TOKENS = _env_int("CONTEXT_SUMMARY_SOURCE_MAX_TOKENS", 120_000)

# LLM 调用参数（此前未设置，输出上限缺失会导致生成本体时 YAML 被截断）
LLM_MAX_TOKENS_CHAT = _env_int("LLM_MAX_TOKENS_CHAT", 4_096)
LLM_MAX_TOKENS_SUMMARY = _env_int("LLM_MAX_TOKENS_SUMMARY", 2_000)
LLM_MAX_TOKENS_ONTOLOGY = _env_int("LLM_MAX_TOKENS_ONTOLOGY", 8_192)
LLM_TIMEOUT_CHAT = _env_int("LLM_TIMEOUT_CHAT", 120)
LLM_TIMEOUT_SUMMARY = _env_int("LLM_TIMEOUT_SUMMARY", 60)

# ─── LLM Prompts ──────────────────────────────────────────────────────────────
# 提示词已拆分至 prompts.py，此处再导出以保持 from config import X 兼容
from prompts import (  # noqa: E402,F401
    ANALYSIS_SYSTEM_PROMPT,
    VALIDATION_SYSTEM_PROMPT,
    VALIDATION_PROMPT_TEMPLATE,
    TITLE_SUMMARIZE_PROMPT,
    ONTOLOGY_GENERATE_SYSTEM_PROMPT,
    ONTOLOGY_GENERATE_PROMPT_TEMPLATE,
    MAPPING_ANALYSIS_SYSTEM_PROMPT,
    MAPPING_ANALYSIS_PROMPT,
    ALIGNMENT_SYSTEM_PROMPT,
    ALIGNMENT_PROMPT,
    FUNCTION_CODE_SYSTEM_PROMPT,
    FUNCTION_CODE_PROMPT,
    RULE_DESIGN_GENERATE_SYSTEM_PROMPT,
    RULE_DESIGN_GENERATE_PROMPT,
    SKILL_GENERATE_SYSTEM_PROMPT,
    SKILL_GENERATE_PROMPT,
    GRILLING_PROMPT,
    CONTEXT_SUMMARY_SYSTEM_PROMPT,
    CONTEXT_SUMMARY_PROMPT_TEMPLATE,
)
