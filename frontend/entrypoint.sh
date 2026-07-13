#!/bin/sh
# Docker 自动设置 HOSTNAME=容器ID，Next.js 用这个值绑到了容器IP
# 改成 0.0.0.0 让它在所有接口上监听
HOSTNAME=0.0.0.0 node /app/server.js &

# 启动 Nginx（前台，保持容器存活）
nginx -g 'daemon off;'
