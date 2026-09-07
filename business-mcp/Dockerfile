# optonto-business-mcp — 业务集成面（模拟业务系统；REST 薄适配，强制 outputSchema）
# build context = 仓库根（要带 mcp-shared）
# 注意：本服务是业务侧集成边缘，不进前端启停白名单，只能 Docker 手动启停。
FROM python:3.12-slim

WORKDIR /app

COPY business-mcp/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -i https://pypi.tuna.tsinghua.edu.cn/simple -r requirements.txt

COPY mcp-shared/mcp_shared /app/mcp_shared
COPY business-mcp/server.py business-mcp/decls.py /app/
COPY business-mcp/config /app/config

EXPOSE 8004
CMD ["python", "-m", "uvicorn", "server:starlette_app", "--host", "0.0.0.0", "--port", "8004"]
