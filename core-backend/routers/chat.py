"""Chat API — streaming conversation using LangChain."""

import json
from datetime import datetime, timedelta, timezone
from typing import AsyncGenerator

from config import (
    ANALYSIS_SYSTEM_PROMPT,
    GRILLING_PROMPT,
    ONTOLOGY_GENERATE_SYSTEM_PROMPT,
    ONTOLOGY_GENERATE_PROMPT_TEMPLATE,
    VALIDATION_SYSTEM_PROMPT,
    VALIDATION_PROMPT_TEMPLATE,
    TITLE_SUMMARIZE_PROMPT,
    DATA_DIR,
)

import yaml

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from routers.threads import _load_thread, _save_thread, _thread_dir, _resolve_ids
from llm_utils import load_env, build_llm, strip_code_fence

router = APIRouter(prefix="/api/threads", tags=["对话"])

# 「本体生成」可按用户勾选裁剪的一级目录（metadata 恒输出，不在此列）
_FILTERABLE_SECTIONS = (
    "concepts", "relations", "functions", "behaviors",
    "rules", "processes", "securities", "data_engines",
)

# 北京时间（固定 +08:00 偏移；不依赖 tzdata，容器内同样可用）
# 仅用于对外展示型时间（如 ontology.yaml 的 metadata.created_at）；
# 内部排序/缓存用的 updated_at 等仍统一用 UTC。
BEIJING_TZ = timezone(timedelta(hours=8))

# ─── Load .env ────────────────────────────────────────────────────────────
load_env()


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


def _build_system_message(messages: list, grilling: bool = False) -> str:
    """Build system message: inject business info from first user message into the analysis system prompt."""
    prompt = ANALYSIS_SYSTEM_PROMPT
    if grilling:
        prompt += GRILLING_PROMPT
    business_info = ""
    for msg in messages:
        if msg["role"] == "user" and msg["content"].strip():
            business_info = msg["content"].strip()
            break
    if "{business_info}" in prompt and business_info:
        prompt = prompt.replace("{business_info}", business_info)
    return prompt


async def _langchain_stream(llm, messages: list, grilling: bool = False) -> AsyncGenerator[str, None]:
    """Stream response from LangChain."""
    from langchain_core.messages import HumanMessage, AIMessage, SystemMessage

    system_content = _build_system_message(messages, grilling)
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
    grilling = bool(body.get("grilling", False))

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

    llm = build_llm()

    async def generate():
        nonlocal assistant_idx
        collected = ""

        if llm is None:
            stream = _mock_stream(user_msg)
        else:
            stream = _langchain_stream(llm, thread["messages"][:-1], grilling)

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
        if thread.get("title") in ("新对话", "") and llm is not None:
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
    """Export selected assistant messages directly as a markdown document without AI processing.

    需求：弹窗填「本体名」「内容」，md 文件名固定为 {本体名}_{内容}.md，同名覆盖。
    """
    thread, sc, onto = _load_thread(thread_id)

    selected_indices = body.get("selected_indices", [])
    if not selected_indices:
        raise HTTPException(status_code=400, detail="请先选择要导出的助手回复内容")

    ontology_name = body.get("ontology_name", "").strip()
    content = body.get("content", "").strip()
    version = body.get("version", "").strip()
    if not ontology_name or not content:
        raise HTTPException(status_code=400, detail="本体名与内容均不能为空")
    if not version:
        raise HTTPException(status_code=400, detail="版本不能为空")

    # 文件名合法性校验：禁路径分隔符、禁与线程元数据冲突的保留名、长度上限
    doc_name = f"{ontology_name}_{content}"
    if "/" in doc_name or "\\" in doc_name or doc_name in {".", ".."}:
        raise HTTPException(status_code=400, detail="本体名或内容包含非法字符")
    if content.lower() == "data":
        raise HTTPException(status_code=400, detail="内容不能使用保留名 data（与线程元数据冲突）")
    if len(doc_name) > 120:
        raise HTTPException(status_code=400, detail="本体名+内容过长（超过120字符）")

    # Get selected assistant messages
    selected_content: list[str] = []
    for idx in selected_indices:
        if idx < len(thread["messages"]) and thread["messages"][idx]["role"] == "assistant":
            msg_content = thread["messages"][idx].get("content", "").strip()
            if msg_content:
                selected_content.append(msg_content)

    if not selected_content:
        raise HTTPException(status_code=400, detail="选中的内容为空，无法导出")

    # Build markdown content directly from selected messages；注明版本
    lines = [f"# {ontology_name}·{content}", f"", f"版本：{version}", f""]
    for i, c in enumerate(selected_content):
        lines.append(f"\n## {i + 1}\n")
        lines.append(c.strip())
        lines.append("\n")
    markdown_content = "\n".join(lines)

    # Save to thread directory；同名覆盖
    dir_path = _thread_dir(thread_id)
    dir_path.mkdir(parents=True, exist_ok=True)
    filename = f"{doc_name}.md"
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
    """Generate a partial ontology yaml from the requirement markdown, and save it
    to the SAME thread directory as the md (同名覆盖), NOT overwrite the ontology."""
    from services import OntologyData, slice_yaml_sections

    thread, sc, onto = _load_thread(thread_id)
    if not sc or not onto:
        raise HTTPException(status_code=400, detail="对话未关联到本体，无法生成本体文件")

    # 用户勾选的一级目录（顶层节名）；空 = 不限（加载完整模板）
    selected = [s for s in (body.get("sections") or []) if isinstance(s, str) and s.strip()]

    # Read the requirement markdown file
    filename = body.get("filename", "")
    if not filename:
        raise HTTPException(status_code=400, detail="请提供需求文件名")
    file_path = _thread_dir(thread_id) / filename
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="需求文件不存在")
    markdown_content = file_path.read_text(encoding="utf-8")

    # Read the template（config.DATA_DIR 在本地与 Docker 容器内均指向 .data）
    tp = DATA_DIR / "onto_template.yaml"
    if not tp.exists():
        raise HTTPException(status_code=500, detail="本体模板文件不存在")
    template_content = tp.read_text(encoding="utf-8")

    # 模板只加载勾选的一级目录（metadata 恒含）：避免模型看到无关节后被诱导生成无关内容
    if selected:
        template_content = slice_yaml_sections(template_content, ["metadata"] + selected)

    llm = build_llm()
    if llm is None:
        raise HTTPException(status_code=400, detail="未配置 LLM API Key，无法自动生成本体")

    from langchain_core.messages import HumanMessage, SystemMessage

    # metadata 的场景/本体名称与 id 直接引用 meta.json（权威来源），不交给模型猜测
    created_at = datetime.now(BEIJING_TZ).strftime("%Y-%m-%d %H:%M:%S")
    scenario_id, ontology_id = _resolve_ids(sc, onto)

    prompt = ONTOLOGY_GENERATE_PROMPT_TEMPLATE.format(
        template_content=template_content,
        markdown_content=markdown_content,
        source_file=filename,
        source_thread=thread.get("title", ""),
        created_at=created_at,
        scenario_name=sc,
        scenario_id=scenario_id if scenario_id is not None else "",
        ontology_name=onto,
        ontology_id=ontology_id if ontology_id is not None else "",
        allowed_sections="、".join(selected) if selected else "不限",
    )

    try:
        response = await llm.ainvoke([
            SystemMessage(content=ONTOLOGY_GENERATE_SYSTEM_PROMPT),
            HumanMessage(content=prompt),
        ])
        yaml_text = response.content.strip()
        # Strip markdown code fences if present
        yaml_text = strip_code_fence(yaml_text)

        # Validate YAML
        parsed = yaml.safe_load(yaml_text)
        if not isinstance(parsed, dict):
            raise ValueError("生成的YAML不是有效的字典结构")

        # Validate structure (OntologyData allows partial: missing top-level sections default to empty)
        ontology_data = OntologyData(**parsed)

        # metadata 结构固化：7 个约定字段，顺序固定；scenario/ontology 名称与 id 取自 meta.json；移除已废弃的 name
        meta_in = parsed.get("metadata") if isinstance(parsed.get("metadata"), dict) else {}
        ontology_data.metadata = {
            "source_file": str(meta_in.get("source_file") or filename),
            "source_thread": str(meta_in.get("source_thread") or thread.get("title", "")),
            "created_at": str(meta_in.get("created_at") or created_at),
            "scenario_name": sc,
            "scenario_id": scenario_id,
            "ontology_name": onto,
            "ontology_id": ontology_id,
        }

        ontology_dict = ontology_data.model_dump(exclude_none=True)
        # 空节整节省略，不再输出 `functions: []` 这类空列表
        for key in ("concepts", "relations", "functions", "behaviors", "rules",
                    "processes", "securities", "data_engines"):
            if not ontology_dict.get(key):
                ontology_dict.pop(key, None)
        # 兜底硬过滤：模型若仍输出了未勾选的一级目录，直接丢弃（metadata 恒保留）
        if selected:
            for key in list(ontology_dict):
                if key in _FILTERABLE_SECTIONS and key not in selected:
                    ontology_dict.pop(key)

        # Output to the SAME directory as the md: {本体名}_{内容}.yaml, 同名覆盖
        req_name = filename[:-3] if filename.endswith(".md") else filename
        yaml_filename = f"{req_name}.yaml"
        yaml_path = _thread_dir(thread_id) / yaml_filename
        with open(yaml_path, "w", encoding="utf-8") as f:
            yaml.dump(
                ontology_dict,
                f,
                allow_unicode=True,
                sort_keys=False,
                default_flow_style=False,
            )

        # Update thread status
        thread["status"] = "documented"
        thread["updated_at"] = datetime.now(timezone.utc).isoformat()
        _save_thread(thread)

        return {
            "message": f"已生成 {yaml_filename}",
            "filename": yaml_filename,
            "scenario": sc,
            "ontology": onto,
            "stats": {
                "concepts": len(ontology_data.concepts),
                "relations": len(ontology_data.relations),
                "functions": len(ontology_data.functions),
                "behaviors": len(ontology_data.behaviors),
                "rules": len(ontology_data.rules),
                "processes": len(ontology_data.processes),
                "securities": len(ontology_data.securities),
                "data_engines": len(ontology_data.data_engines),
            },
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

    llm = build_llm()
    if llm is None:
        raise HTTPException(status_code=400, detail="未配置 LLM API Key，无法进行验证")

    from langchain_core.messages import HumanMessage, SystemMessage

    prompt = VALIDATION_PROMPT_TEMPLATE.format(analysis_content=analysis_text)

    try:
        response = await llm.ainvoke([
            SystemMessage(content=VALIDATION_SYSTEM_PROMPT),
            HumanMessage(content=prompt),
        ])
        result_text = response.content.strip()
        # 临时保存最新一次分析结果到对话文件：前端「分析结果」按钮可随时回看，无需重新验证
        thread["validate_result"] = {
            "result": result_text,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        thread["updated_at"] = datetime.now(timezone.utc).isoformat()
        _save_thread(thread)
        return {"result": result_text}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"验证失败: {str(e)}")
