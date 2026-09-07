# optonto-ontology-mcp — 本体语义面（list* 查询 + 本体/公共函数沙箱）
# build context = 仓库根（要带 mcp-shared 与 .data 挂载点约定）
FROM python:3.12-slim

WORKDIR /app

COPY ontology-mcp/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -i https://pypi.tuna.tsinghua.edu.cn/simple -r requirements.txt

COPY mcp-shared/mcp_shared /app/mcp_shared
COPY ontology-mcp/server.py /app/server.py

EXPOSE 8002
CMD ["python", "-m", "uvicorn", "server:starlette_app", "--host", "0.0.0.0", "--port", "8002"]
