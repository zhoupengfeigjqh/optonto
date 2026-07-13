"""Application configuration."""

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

# 统一数据目录
DATA_DIR = BASE_DIR / "backend" / ".data"
ONTO_MARKET_DIR = DATA_DIR / "onto_market"
CONFIG_DIR = BASE_DIR / "config"

# Ensure directories exist
ONTO_MARKET_DIR.mkdir(parents=True, exist_ok=True)
CONFIG_DIR.mkdir(parents=True, exist_ok=True)

# SQLite 已移除，元数据改用 meta.json 文件存储
