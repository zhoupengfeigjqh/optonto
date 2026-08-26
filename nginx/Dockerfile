# 独立 Nginx 入口容器：仅做反向代理，无任何应用代码
FROM nginx:alpine

# 官方 nginx 镜像的站点配置目录是 /etc/nginx/conf.d/（注意与 alpine apk 版的 http.d 不同）
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 81
