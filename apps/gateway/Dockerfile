FROM nginx:1.27-alpine

ARG RELEASE_VERSION=unknown

LABEL org.opencontainers.image.revision=$RELEASE_VERSION

COPY apps/gateway/nginx.conf /etc/nginx/nginx.conf
COPY apps/gateway/conf.d /etc/nginx/conf.d
COPY apps/gateway/includes /etc/nginx/includes
COPY apps/gateway/static/site /usr/share/nginx/html/site
