"""公共工具：环境变量加载、LLM 构建、Markdown 代码围栏剥离。

此前各 router 各自复制了一份 .env 加载 + _build_llm + 围栏剥离逻辑，
统一收拢到这里，保证行为一致、减少重复。
"""

import os
from pathlib import Path

try:
    from langchain_openai import ChatOpenAI
except ImportError:
    ChatOpenAI = None


def load_env() -> None:
    """从项目根 config/.env 加载环境变量（幂等，已在环境中则不覆盖）。"""
    try:
        from dotenv import load_dotenv
        env_path = Path(__file__).resolve().parent.parent / "config" / ".env"
        if env_path.exists():
            load_dotenv(env_path)
    except ImportError:
        pass


def build_llm(temperature: float = 0.7, streaming: bool = True):
    """构建 LangChain 聊天模型。未安装依赖或缺 API Key 时返回 None（走 mock）。"""
    if ChatOpenAI is None:
        return None
    api_key = os.environ.get("LLM_API_KEY") or os.environ.get("DEEPSEEK_API_KEY") or ""
    api_url = os.environ.get("LLM_API_URL", "https://api.deepseek.com")
    model = os.environ.get("LLM_MODEL", "deepseek-chat")
    if not api_key:
        return None
    return ChatOpenAI(
        model=model,
        openai_api_key=api_key,
        openai_api_base=api_url,
        temperature=temperature,
        streaming=streaming,
    )


def strip_code_fence(text: str) -> str:
    """剥离 Markdown 代码围栏（```...```）；无围栏时原样返回。"""
    text = text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1]
        text = text.rsplit("```", 1)[0]
        text = text.strip()
    return text
