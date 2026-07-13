# ─── Build stage ───
FROM node:20-alpine AS builder

WORKDIR /app

# Copy frontend package files
COPY frontend/package.json ./
RUN npm install --registry=https://registry.npmmirror.com

# Copy frontend source and config
COPY frontend/ ./

RUN npm run build

# ─── Production stage (Nginx + Next.js) ───
FROM node:20-alpine

# 安装 Nginx
RUN apk add --no-cache nginx

WORKDIR /app

# 复制 Next.js 构建产物
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# 复制 Nginx 配置和启动脚本
COPY frontend/nginx.conf /etc/nginx/http.d/default.conf
COPY frontend/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 81

CMD ["/entrypoint.sh"]
