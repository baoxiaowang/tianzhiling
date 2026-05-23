# @tzl/transfer

旧 MySQL 数据迁移到新 MongoDB 的独立脚本项目。

## Scripts

- `pnpm dev`：直接运行 TypeScript 入口。
- `pnpm build`：编译到 `dist`。
- `pnpm start`：运行编译后的入口。

后续迁移脚本放在 `src/scripts` 下，并在 `package.json` 的 `scripts` 中补充命令。

## Environment

默认会读取仓库根目录 `.env`、`apps/transfer/.env` 和当前工作目录 `.env`，已存在的环境变量不会被覆盖。

常用变量：

- `TRANSFER_MYSQL_HOST`
- `TRANSFER_MYSQL_PORT`
- `TRANSFER_MYSQL_USER`
- `TRANSFER_MYSQL_PASSWORD`
- `TRANSFER_MYSQL_DATABASE`
- `TRANSFER_MONGO_HOST`
- `TRANSFER_MONGO_PORT`
- `TRANSFER_MONGO_USERNAME`
- `TRANSFER_MONGO_PASSWORD`
- `TRANSFER_MONGO_DATABASE`
- `TRANSFER_MONGO_AUTH_SOURCE`
