FROM node:20.18.0-alpine AS base

WORKDIR /workspace/apps/node

RUN corepack enable

COPY package.json /workspace/package.json
COPY pnpm-workspace.yaml /workspace/pnpm-workspace.yaml
COPY pnpm-lock.yaml /workspace/pnpm-lock.yaml
COPY apps/node/package.json ./package.json
COPY packages/entities/package.json /workspace/packages/entities/package.json
COPY packages/shared/package.json /workspace/packages/shared/package.json

RUN npm pkg delete scripts.prepare --prefix /workspace

FROM base AS deps

RUN npx -y pnpm@9.15.9 install --frozen-lockfile --lockfile-dir=/workspace --config.recursive-install=false --config.node-linker=isolated

FROM deps AS build

COPY packages/entities /workspace/packages/entities
COPY packages/shared /workspace/packages/shared
COPY apps/node ./

RUN npx -y pnpm@9.15.9 --dir /workspace --filter @tzl/entities build \
  && npx -y pnpm@9.15.9 --dir /workspace --filter @tzl/shared build \
  && npx -y pnpm@9.15.9 build \
  && test -f dist/configuration.js

FROM base AS prod-deps

RUN npx -y pnpm@9.15.9 install --prod --frozen-lockfile --lockfile-dir=/workspace --config.recursive-install=false --config.node-linker=isolated

FROM node:20.18.0-alpine AS runtime

RUN apk add --no-cache tzdata && npm install -g pm2@5.4.3

ENV TZ="Asia/Shanghai"

ENV NODE_ENV=production

EXPOSE 7001

WORKDIR /workspace/apps/node

COPY --from=prod-deps /workspace/node_modules /workspace/node_modules
COPY --from=prod-deps /workspace/apps/node/node_modules ./node_modules
COPY --from=build /workspace/packages/entities/package.json /workspace/packages/entities/package.json
COPY --from=build /workspace/packages/entities/dist /workspace/packages/entities/dist
COPY --from=build /workspace/packages/shared/package.json /workspace/packages/shared/package.json
COPY --from=build /workspace/packages/shared/dist /workspace/packages/shared/dist
COPY --from=build /workspace/apps/node/package.json ./package.json
COPY --from=build /workspace/apps/node/bootstrap.js ./bootstrap.js
COPY --from=build /workspace/apps/node/dist ./dist
COPY --from=build /workspace/apps/node/public ./public

CMD ["pm2-runtime", "start", "./bootstrap.js", "--name", "apibest-node", "-i", "4"]
