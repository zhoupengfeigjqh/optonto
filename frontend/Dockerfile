# ─── Build stage ───
FROM node:20-alpine AS builder

WORKDIR /app

# Copy frontend package files
COPY frontend/package.json ./
RUN npm install --registry=https://registry.npmmirror.com

# Copy frontend source and config
COPY frontend/ ./

RUN npm run build

# ─── Production stage (纯 Next.js；Nginx 已拆分为独立容器 optonto-nginx) ───
FROM node:20-alpine

WORKDIR /app

# 复制 Next.js 构建产物
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

ENV PORT=3000
ENV HOSTNAME=0.0.0.0

EXPOSE 3000

CMD ["node", "server.js"]
