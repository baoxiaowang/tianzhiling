FROM node:20.18.0-alpine AS admin-build

ARG BRAND=tianzhiling
ARG BRAND_NAME=天之灵
ARG BRAND_COMPANY=武汉市天之灵智能技术有限公司
ARG BRAND_ADMIN_TITLE=天之灵管理后台

ENV BRAND=$BRAND \
  BRAND_NAME=$BRAND_NAME \
  BRAND_COMPANY=$BRAND_COMPANY \
  BRAND_ADMIN_TITLE=$BRAND_ADMIN_TITLE

WORKDIR /workspace

RUN corepack enable

COPY package.json ./package.json
COPY pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY pnpm-lock.yaml ./pnpm-lock.yaml
COPY apps/admin/package.json ./apps/admin/package.json
COPY packages/shared/package.json ./packages/shared/package.json

RUN npm pkg delete scripts.prepare --prefix /workspace

RUN npx -y pnpm@9.15.9 --dir /workspace install --ignore-scripts --frozen-lockfile --prod=false --filter ./apps/admin... --filter @tzl/shared --config.node-linker=isolated \
  && npx -y pnpm@9.15.9 --dir /workspace rebuild esbuild

COPY packages/shared ./packages/shared
COPY apps/admin ./apps/admin

ENV VITE_ENABLE_IMAGEMIN=false

RUN npx -y pnpm@9.15.9 --dir /workspace --filter @tzl/shared build \
  && rm -rf /workspace/apps/admin/dist \
  && npx -y pnpm@9.15.9 --dir /workspace/apps/admin exec vite build --config ./config/vite.config.prod.ts \
  && test -f /workspace/apps/admin/dist/index.html

FROM nginx:1.27-alpine

ARG RELEASE_VERSION=unknown

LABEL org.opencontainers.image.revision=$RELEASE_VERSION

COPY apps/admin/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=admin-build /workspace/apps/admin/dist /usr/share/nginx/html
