# optonto-ontology-query-mcp — 本体查询 MCP 服务（平台内置对外工具面之一，只读无副作用）
# build context = 仓库根（要带 mcp-shared 与 .data 挂载点约定）
FROM python:3.12-slim

WORKDIR /app

COPY ontology-query-mcp/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -i https://mirrors.aliyun.com/pypi/simple/ -r requirements.txt

COPY mcp-shared /app/
COPY ontology-query-mcp/server.py /app/server.py

EXPOSE 8002
CMD ["python", "-m", "uvicorn", "server:starlette_app", "--host", "0.0.0.0", "--port", "8002"]