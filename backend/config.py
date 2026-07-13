"""Application configuration."""

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

# 统一数据目录
DATA_DIR = BASE_DIR / "backend" / "data"
ONTO_MARKET_DIR = DATA_DIR / "onto_market"
THREADS_DIR = DATA_DIR / "threads"
CONFIG_DIR = BASE_DIR / "config"

# Ensure directories exist
ONTO_MARKET_DIR.mkdir(parents=True, exist_ok=True)
THREADS_DIR.mkdir(parents=True, exist_ok=True)
CONFIG_DIR.mkdir(parents=True, exist_ok=True)

# SQLite 数据库
DATABASE_URL = f"sqlite+aiosqlite:///{DATA_DIR / 'optonto.db'}"
