"""Application configuration and centralized prompt management.

提示词常量已迁移至 prompts.py；此处仅保留路径配置 + 再导出，兼容历史 `from config import X`。
"""

from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

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
    TARGET_PARSE_SYSTEM_PROMPT,
    TARGET_PARSE_PROMPT,
    FUNCTION_CODE_SYSTEM_PROMPT,
    FUNCTION_CODE_PROMPT,
    RULE_GENERATE_SYSTEM_PROMPT,
    RULE_GENERATE_PROMPT,
    SKILL_GENERATE_SYSTEM_PROMPT,
    SKILL_GENERATE_PROMPT,
    DB_GENERATE_SYSTEM_PROMPT,
    DB_GENERATE_PROMPT,
    GRILLING_PROMPT,
)
