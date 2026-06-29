FROM node:20.18.0-alpine AS admin-build

WORKDIR /workspace

ENV NPM_CONFIG_REGISTRY=https://registry.npmmirror.com \
  PNPM_VERSION=9.15.9 \
  PNPM_INSTALL_FLAGS="--config.registry=https://registry.npmmirror.com --config.fetch-retries=5 --config.network-timeout=300000"

RUN corepack enable

COPY package.json ./package.json
COPY pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY pnpm-lock.yaml ./pnpm-lock.yaml
COPY apps/admin/package.json ./apps/admin/package.json
COPY packages/shared/package.json ./packages/shared/package.json

RUN npm pkg delete scripts.prepare --prefix /workspace

RUN npx -y pnpm@${PNPM_VERSION} --dir /workspace install --ignore-scripts --frozen-lockfile --prod=false --filter ./apps/admin... --filter @tzl/shared --config.node-linker=isolated ${PNPM_INSTALL_FLAGS} \
  && npx -y pnpm@${PNPM_VERSION} --dir /workspace rebuild esbuild

COPY packages/shared ./packages/shared
COPY apps/admin ./apps/admin

ENV VITE_ENABLE_IMAGEMIN=false

RUN npx -y pnpm@${PNPM_VERSION} --dir /workspace --filter @tzl/shared build \
  && rm -rf /workspace/apps/admin/dist \
  && npx -y pnpm@${PNPM_VERSION} --dir /workspace/apps/admin exec vite build --config ./config/vite.config.prod.ts \
  && test -f /workspace/apps/admin/dist/index.html

FROM nginx:1.27-alpine

COPY apps/admin/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=admin-build /workspace/apps/admin/dist /usr/share/nginx/html
