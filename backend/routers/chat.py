"""Chat API — streaming conversation using LangChain."""

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import AsyncGenerator

from config import (
    ANALYSIS_SYSTEM_PROMPT,
    ONTOLOGY_GENERATE_SYSTEM_PROMPT,
    ONTOLOGY_GENERATE_PROMPT_TEMPLATE,
    VALIDATION_SYSTEM_PROMPT,
    VALIDATION_PROMPT_TEMPLATE,
    TITLE_SUMMARIZE_PROMPT,
)

import yaml

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from routers.threads import _load_thread, _save_thread, _thread_dir

router = APIRouter(prefix="/api/threads", tags=["对话"])

# ─── Load .env ────────────────────────────────────────────────────────────
try:
    from dotenv import load_dotenv

    env_path = Path(__file__).resolve().parent.parent.parent / "config" / ".env"
    if env_path.exists():
        load_dotenv(env_path)
except ImportError:
    pass

# ─── LLM setup ────────────────────────────────────────────────────────────
# Try to import LangChain; if unavailable, use mock fallback.
try:
    from langchain_openai import ChatOpenAI

    _HAS_LANGCHAIN = True
except ImportError:
    _HAS_LANGCHAIN = False


def _build_llm():
    """Build a LangChain chat model from environment variables.

    Priority: LLM_API_KEY > DEEPSEEK_API_KEY > mock fallback
    """
    api_key = os.environ.get("LLM_API_KEY") or os.environ.get("DEEPSEEK_API_KEY") or ""
    api_url = os.environ.get("LLM_API_URL", "https://api.deepseek.com")
    model = os.environ.get("LLM_MODEL", "deepseek-chat")

    if not api_key:
        return None  # fallback to mock

    return ChatOpenAI(
        model=model,
        openai_api_key=api_key,
        openai_api_base=api_url,
        temperature=0.7,
        streaming=True,
    )


async def _mock_stream(prompt: str) -> AsyncGenerator[str, None]:
    """Mock streaming response for testing without an LLM API key."""
    import asyncio

    responses = [
        f"收到您的问题：{prompt[:50]}{'...' if len(prompt) > 50 else ''}\n\n",
        "这是一个模拟回复（Mock Response）。\n\n",
        "如需接入其他模型，请设置环境变量：\n",
        "- `LLM_API_KEY`：API 密钥（默认复用 DEEPSEEK_API_KEY）\n",
        "- `LLM_API_URL`：API 地址（默认 DeepSeek）\n",
        "- `LLM_MODEL`：模型名称（默认 deepseek-chat）\n\n",
        "当前时间：",
        datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"),
        "\n\n---\n*这是一条模拟回复*",
    ]
    for chunk in responses:
        yield f"data: {json.dumps({'token': chunk, 'done': False})}\n\n"
        await asyncio.sleep(0.05)
    yield f"data: {json.dumps({'token': '', 'done': True})}\n\n"


def _build_system_message(messages: list) -> str:
    """Build system message: inject business info from first user message into the analysis system prompt."""
    prompt = ANALYSIS_SYSTEM_PROMPT
    business_info = ""
    for msg in messages:
        if msg["role"] == "user" and msg["content"].strip():
            business_info = msg["content"].strip()
            break
    if "{business_info}" in prompt and business_info:
        prompt = prompt.replace("{business_info}", business_info)
    return prompt


async def _langchain_stream(llm, messages: list) -> AsyncGenerator[str, None]:
    """Stream response from LangChain."""
    from langchain_core.messages import HumanMessage, AIMessage, SystemMessage

    system_content = _build_system_message(messages)
    lc_messages = [SystemMessage(content=system_content)]
    for msg in messages:
        if msg["role"] == "user":
            lc_messages.append(HumanMessage(content=msg["content"]))
        elif msg["role"] == "assistant":
            lc_messages.append(AIMessage(content=msg["content"]))

    try:
        async for chunk in llm.astream(lc_messages):
            if chunk.content:
                yield f"data: {json.dumps({'token': chunk.content, 'done': False})}\n\n"
    except Exception as e:
        yield f"data: {json.dumps({'token': f'\n\n[调用出错: {str(e)}]', 'done': False})}\n\n"
    yield f"data: {json.dumps({'token': '', 'done': True})}\n\n"


@router.post("/{thread_id}/chat")
async def chat(thread_id: str, body: dict):
    """Send a message and get a streaming response."""
    thread, sc, onto = _load_thread(thread_id)

    user_msg = body.get("message", "").strip()
    if not user_msg:
        raise HTTPException(status_code=400, detail="消息不能为空")

    now = datetime.now(timezone.utc).isoformat()

    # Append user message
    thread["messages"].append({
        "role": "user",
        "content": user_msg,
        "timestamp": now,
    })

    # Append a placeholder for assistant
    assistant_idx = len(thread["messages"])
    thread["messages"].append({
        "role": "assistant",
        "content": "",
        "timestamp": now,
    })
    thread["updated_at"] = now
    _save_thread(thread)

    llm = _build_llm()

    async def generate():
        nonlocal assistant_idx
        collected = ""

        if llm is None:
            stream = _mock_stream(user_msg)
        else:
            stream = _langchain_stream(llm, thread["messages"][:-1])

        async for chunk in stream:
            yield chunk
            data = chunk.removeprefix("data: ")
            try:
                payload = json.loads(data)
                token = payload.get("token", "")
                collected += token
            except json.JSONDecodeError:
                pass

        # Save the collected response
        thread["messages"][assistant_idx]["content"] = collected

        # Auto-set title: summarize first user question via LLM
        if thread.get("title") in ("新对话", "新对话", "") and llm is not None:
            for msg in thread["messages"]:
                if msg["role"] == "user" and msg["content"].strip():
                    try:
                        from langchain_core.messages import HumanMessage, SystemMessage
                        summary = await llm.ainvoke([
                            SystemMessage(content=TITLE_SUMMARIZE_PROMPT),
                            HumanMessage(content=msg["content"].strip()),
                        ])
                        thread["title"] = summary.content.strip()[:20] or msg["content"].strip()[:10]
                    except Exception:
                        thread["title"] = msg["content"].strip()[:10]
                    break

        _save_thread(thread)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/{thread_id}/export")
async def export_thread(thread_id: str, body: dict):
    """Export selected assistant messages directly as a markdown document without AI processing."""
    thread, sc, onto = _load_thread(thread_id)

    selected_indices = body.get("selected_indices", [])
    if not selected_indices:
        raise HTTPException(status_code=400, detail="请先选择要导出的助手回复内容")

    # Get selected assistant messages
    selected_content: list[str] = []
    for idx in selected_indices:
        if idx < len(thread["messages"]) and thread["messages"][idx]["role"] == "assistant":
            content = thread["messages"][idx].get("content", "").strip()
            if content:
                selected_content.append(content)

    if not selected_content:
        raise HTTPException(status_code=400, detail="选中的内容为空，无法导出")

    # Use title from request or default
    doc_title = body.get("title", "requirement").strip() or "requirement"

    # Build markdown content directly from selected messages
    lines = [f"# {doc_title}\n"]
    for i, content in enumerate(selected_content):
        lines.append(f"\n## {i + 1}\n")
        lines.append(content.strip())
        lines.append("\n")
    markdown_content = "\n".join(lines)

    # Save to thread directory
    dir_path = _thread_dir(sc, onto, thread_id)
    dir_path.mkdir(parents=True, exist_ok=True)
    filename = f"{doc_title}.md"
    file_path = dir_path / filename

    with open(file_path, "w", encoding="utf-8") as f:
        f.write(markdown_content)

    # Update thread status to documented
    thread["status"] = "documented"
    thread["updated_at"] = datetime.now(timezone.utc).isoformat()
    _save_thread(thread)

    return {
        "message": "文档已生成",
        "path": str(file_path),
        "filename": filename,
    }


@router.post("/{thread_id}/generate-ontology")
async def generate_ontology(thread_id: str, body: dict):
    """Generate ontology.yaml from requirement markdown using LLM + template, then overwrite the ontology YAML."""
    from services import save_ontology_data, OntologyData

    thread, sc, onto = _load_thread(thread_id)
    if not sc or not onto:
        raise HTTPException(status_code=400, detail="对话未关联到本体，无法生成本体文件")

    # Read the requirement markdown file
    filename = body.get("filename", "")
    if not filename:
        raise HTTPException(status_code=400, detail="请提供需求文件名")
    file_path = _thread_dir(sc, onto, thread_id) / filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="需求文件不存在")
    markdown_content = file_path.read_text(encoding="utf-8")

    # Read the template
    config_dir = Path(__file__).resolve().parent.parent.parent
    template_path = config_dir / "backend" / ".data" / "onto_template.yaml"
    # Inside Docker: the .data is at /app/backend/.data
    template_path_docker = Path("/app/backend/.data/onto_template.yaml")
    tp = template_path_docker if template_path_docker.exists() else template_path
    if not tp.exists():
        raise HTTPException(status_code=500, detail="本体模板文件不存在")
    template_content = tp.read_text(encoding="utf-8")

    llm = _build_llm()
    if llm is None:
        raise HTTPException(status_code=400, detail="未配置 LLM API Key，无法自动生成本体")

    from langchain_core.messages import HumanMessage, SystemMessage

    prompt = ONTOLOGY_GENERATE_PROMPT_TEMPLATE.format(
        template_content=template_content,
        markdown_content=markdown_content,
        source_file=filename,
        source_thread=thread.get("title", ""),
        created_at=datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"),
    )

    try:
        response = await llm.ainvoke([
            SystemMessage(content=ONTOLOGY_GENERATE_SYSTEM_PROMPT),
            HumanMessage(content=prompt),
        ])
        yaml_text = response.content.strip()
        # Strip markdown code fences if present
        if yaml_text.startswith("```"):
            yaml_text = yaml_text.split("\n", 1)[1]
            yaml_text = yaml_text.rsplit("```", 1)[0]
            yaml_text = yaml_text.strip()

        # Validate YAML
        parsed = yaml.safe_load(yaml_text)
        if not isinstance(parsed, dict):
            raise ValueError("生成的YAML不是有效的字典结构")

        # Save as OntologyData
        ontology_data = OntologyData(**parsed)
        save_ontology_data(sc, onto, ontology_data)

        # Update thread status
        thread["status"] = "documented"
        thread["updated_at"] = datetime.now(timezone.utc).isoformat()
        _save_thread(thread)

        return {
            "message": "本体已生成并覆盖原文件",
            "scenario": sc,
            "ontology": onto,
            "concepts": len(ontology_data.concepts),
            "relations": len(ontology_data.relations),
            "behaviors": len(ontology_data.behaviors),
            "rules": len(ontology_data.rules),
            "events": len(ontology_data.events),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"生成本体失败: {str(e)}")


@router.post("/{thread_id}/clear")
async def clear_chat(thread_id: str):
    """Clear all messages in a thread but keep the thread."""
    thread, sc, onto = _load_thread(thread_id)
    thread["messages"] = []
    thread["updated_at"] = datetime.now(timezone.utc).isoformat()
    _save_thread(thread)
    return {"message": "对话已清空"}


@router.post("/{thread_id}/validate")
async def validate_analysis(thread_id: str, body: dict):
    """Validate selected analysis content for consistency and logical coherence from ontology perspective."""
    thread, sc, onto = _load_thread(thread_id)

    selected_indices = body.get("selected_indices", [])
    if not selected_indices:
        raise HTTPException(status_code=400, detail="请先选择要验证的助手回复内容")

    # Collect selected assistant messages
    selected_content: list[str] = []
    for idx in selected_indices:
        if idx < len(thread["messages"]) and thread["messages"][idx]["role"] == "assistant":
            content = thread["messages"][idx].get("content", "").strip()
            if content:
                selected_content.append(content)

    if not selected_content:
        raise HTTPException(status_code=400, detail="选中的内容为空，无法验证")

    analysis_text = "\n\n---\n\n".join(selected_content)

    llm = _build_llm()
    if llm is None:
        raise HTTPException(status_code=400, detail="未配置 LLM API Key，无法进行验证")

    from langchain_core.messages import HumanMessage, SystemMessage

    prompt = VALIDATION_PROMPT_TEMPLATE.format(analysis_content=analysis_text)

    try:
        response = await llm.ainvoke([
            SystemMessage(content=VALIDATION_SYSTEM_PROMPT),
            HumanMessage(content=prompt),
        ])
        return {"result": response.content.strip()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"验证失败: {str(e)}")
