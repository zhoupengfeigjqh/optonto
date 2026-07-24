# ─── Build stage ─────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

# 安装依赖（利用 Docker 缓存层）
COPY package.json package-lock.json ./
RUN npm install

# 编译 TypeScript
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ─── Production stage ────────────────────────────────
FROM node:22-alpine
WORKDIR /app

# 仅复制编译产物和生产依赖
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./

# 数据目录由 docker-compose 挂载
# config 目录由 docker-compose 挂载到 /app/config

EXPOSE 8003

CMD ["node", "dist/index.js"]
