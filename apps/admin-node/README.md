# TianZhiLing Admin Node

管理后台 API 独立服务骨架，默认监听 `7101`。

## Scripts

```bash
npx -y pnpm@9 install
npx -y pnpm@9 build:admin-node
npx -y pnpm@9 dev:admin-node
```

## Env

- `ADMIN_API_PORT`: 服务端口，默认 `7101`
- `ADMIN_API_ACCOUNT`: 管理员账号，默认 `admin`
- `ADMIN_API_PASSWORD`: 管理员密码，默认 `admin123456`
- `ADMIN_API_JWT_SECRET`: 管理员 JWT 密钥，默认回退到 `NODE_JWT_SECRET`
- `ADMIN_API_MONGO_*`: 管理后台 Mongo 配置，默认回退到 `NODE_MONGO_*`

## Routes

- `GET /admin_api/system/health`
- `POST /admin_api/auth/login`
- `GET /admin_api/auth/me`
