# optonto-common-function-mcp — 公共函数 MCP 服务（平台通用算力：发布 + 执行一体，自包含）
# build context = 仓库根（需 COPY mcp-shared）
# 对外：/mcp（streamable）发布 7 个公共函数工具；内网：/execute-common-function 供 core 测试按钮
FROM python:3.12-slim

WORKDIR /app

COPY common-function-mcp/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -i https://mirrors.aliyun.com/pypi/simple/ -r requirements.txt

COPY mcp-shared /app/
COPY common-function-mcp/server.py /app/server.py

ENV TZ=Asia/Shanghai
EXPOSE 8007
CMD ["python", "-m", "uvicorn", "server:starlette_app", "--host", "0.0.0.0", "--port", "8007"]