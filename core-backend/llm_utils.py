"""公共工具：环境变量加载、LLM 构建、LLM 调用壳、Markdown 代码围栏剥离。

此前各 router 各自复制了一份 .env 加载 + _build_llm + 围栏剥离 + ainvoke + json.loads，
统一收拢到这里：llm_json / llm_text 是 LLM 调用壳的单一实现，保证行为一致、减少重复。
"""

import json
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
    """剥离 Markdown 代码围栏（```...```，含 ```json/```sql 语言标记）；无围栏时原样返回。"""
    text = text.strip()
    if text.startswith("```"):
        parts = text.split("\n", 1)
        text = parts[1] if len(parts) > 1 else text[3:]  # 无换行（如 ```json）时也安全
        text = text.rsplit("```", 1)[0]
        text = text.strip()
    return text


async def llm_text(
    system_prompt: str,
    user_prompt: str,
    temperature: float = 0.3,
):
    """调 LLM 取文本（剥离围栏）。返回 (text, raw)：
    - LLM 不可用（未配置/无依赖）→ (None, None)
    - 成功 → (text, raw)
    """
    llm = build_llm(temperature=temperature, streaming=False)
    if llm is None:
        return None, None
    from langchain_core.messages import HumanMessage, SystemMessage
    response = await llm.ainvoke([SystemMessage(content=system_prompt), HumanMessage(content=user_prompt)])
    raw = str(response.content or "").strip()
    return strip_code_fence(raw), raw


async def llm_json(
    system_prompt: str,
    user_prompt: str,
    temperature: float = 0.3,
):
    """调 LLM 取 JSON（剥离围栏 + json.loads）。返回 (parsed, stripped)：
    - LLM 不可用（未配置/无依赖）→ (None, None)
    - JSON 解析失败 → (None, stripped_text)，调用方自行决定报错文案
    - 成功 → (dict, stripped_text)
    """
    text, _ = await llm_text(system_prompt, user_prompt, temperature)
    if text is None:
        return None, None
    try:
        return json.loads(text), text
    except json.JSONDecodeError:
        return None, text
