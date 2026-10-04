# optonto-mcp-publish — 自建发布门面（对外提供执行能力的唯一出口；一个镜像 N 个实例，由 core 动态创建）
# build context = 仓库根（需 COPY mcp-shared）
#
# 端口不写死：容器内端口由 $PORT 决定（core 统一用 8100），一个镜像即可多实例；
# 宿主端口由发布时用户指定的端口映射进来（docker run -p <host>:8100）。
FROM python:3.12-slim

WORKDIR /app

COPY mcp-publish/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -i https://pypi.tuna.tsinghua.edu.cn/simple -r requirements.txt

COPY mcp-shared /app/
COPY mcp-publish/server.py /app/server.py

ENV PORT=8100 \
    MCP_TRANSPORT=streamable \
    PYTHONUNBUFFERED=1 \
    TZ=Asia/Shanghai

EXPOSE 8100
CMD ["sh", "-c", "exec python -m uvicorn server:starlette_app --host 0.0.0.0 --port ${PORT}"]
