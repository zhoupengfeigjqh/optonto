# optonto-data-engine-mcp — 映射执行面（行为工具发布 behavior_tools + 前后翻译 + MCP 分发）
# build context = 仓库根（要带 mcp-shared）
FROM python:3.12-slim

WORKDIR /app

COPY data-engine-mcp/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -i https://pypi.tuna.tsinghua.edu.cn/simple -r requirements.txt

COPY mcp-shared /app/
COPY data-engine-mcp/server.py data-engine-mcp/behavior_tools.py data-engine-mcp/executor.py /app/

EXPOSE 8005
CMD ["python", "-m", "uvicorn", "server:starlette_app", "--host", "0.0.0.0", "--port", "8005"]
