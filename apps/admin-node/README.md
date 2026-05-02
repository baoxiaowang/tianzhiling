# TianZhiLing Admin Node

管理后台 API 独立服务骨架，默认监听 `7101`。

## Scripts

```bash
corepack pnpm install
ADMIN_INIT_ACCOUNT=admin ADMIN_INIT_PASSWORD='replace-with-strong-password' sh scripts/init-admin-node.sh
corepack pnpm dev:admin-node
```

生产服务器使用 Docker Compose 初始化，不依赖宿主机 Node/npm/pnpm：

```bash
ADMIN_INIT_ACCOUNT=admin ADMIN_INIT_PASSWORD='replace-with-strong-password' sh scripts/prd-init-admin-node.sh
```

## Env

- `ADMIN_API_PORT`: 服务端口，默认 `7101`
- `ADMIN_API_JWT_SECRET`: 管理员 JWT 密钥，默认回退到 `NODE_JWT_SECRET`
- `ADMIN_API_MONGO_*`: 管理后台 Mongo 配置，默认回退到 `NODE_MONGO_*`
- `ADMIN_INIT_ACCOUNT`: 初始化超级管理员账号，默认 `admin`
- `ADMIN_INIT_PASSWORD`: 初始化超级管理员密码；不配置时脚本会生成随机密码并输出一次
- `ADMIN_INIT_NAME`: 初始化超级管理员名称，默认 `超级管理员`

生产登录只校验数据库中的 `admin_account`，不再回退到固定默认账号密码。

## Routes

- `GET /admin_api/system/health`
- `POST /admin_api/auth/login`
- `GET /admin_api/auth/me`
