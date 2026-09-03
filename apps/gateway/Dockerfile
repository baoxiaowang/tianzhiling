FROM nginx:1.27-alpine

ARG RELEASE_VERSION=unknown
ARG BRAND_NAME=天之灵
ARG BRAND_DOMAIN=tianzhiling.chat

LABEL org.opencontainers.image.revision=$RELEASE_VERSION

COPY apps/gateway/nginx.conf /etc/nginx/nginx.conf
COPY apps/gateway/conf.d /etc/nginx/conf.d
COPY apps/gateway/includes /etc/nginx/includes
COPY apps/gateway/static/site /usr/share/nginx/html/site
RUN brand_mark="$(printf '%s' "$BRAND_NAME" | cut -c1)" \
  && sed \
    -e "s/{{BRAND_NAME}}/$BRAND_NAME/g" \
    -e "s/{{BRAND_DOMAIN}}/$BRAND_DOMAIN/g" \
    -e "s/{{BRAND_MARK}}/$brand_mark/g" \
    /usr/share/nginx/html/site/index.template.html \
    > /usr/share/nginx/html/site/index.html
