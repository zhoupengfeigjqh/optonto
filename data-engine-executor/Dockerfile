# optonto-data-engine-executor — 数据引擎执行服务（行为/引擎执行唯一实现；**零工具**，仅内网 REST） — 映射执行面（前后翻译 + MCP 分发 + 行为索引）
# build context = 仓库根（要带 mcp-shared）
FROM python:3.12-slim

WORKDIR /app

COPY data-engine-executor/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -i https://mirrors.aliyun.com/pypi/simple/ -r requirements.txt

COPY mcp-shared /app/
COPY data-engine-executor/server.py data-engine-executor/behavior_index.py data-engine-executor/executor.py /app/

EXPOSE 8005
CMD ["python", "-m", "uvicorn", "server:starlette_app", "--host", "0.0.0.0", "--port", "8005"]
