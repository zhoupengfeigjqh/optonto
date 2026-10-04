# optonto-ontology-function-executor — 本体函数执行服务（零工具执行底座）
# build context = 仓库根（需 COPY mcp-shared）
# 零工具：服务不挂 /mcp 与 /sse，只提供 /execute-function、/execute-common-function（内网调用）
FROM python:3.12-slim

WORKDIR /app

COPY ontology-function-executor/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -i https://pypi.tuna.tsinghua.edu.cn/simple -r requirements.txt

COPY mcp-shared /app/
COPY ontology-function-executor/server.py /app/server.py

ENV TZ=Asia/Shanghai
EXPOSE 8006
CMD ["python", "-m", "uvicorn", "server:starlette_app", "--host", "0.0.0.0", "--port", "8006"]