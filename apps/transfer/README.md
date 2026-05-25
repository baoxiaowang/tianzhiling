# @tzl/transfer

旧 MySQL 数据迁移到新 MongoDB 的独立脚本项目。

## Scripts

- `pnpm dev`：直接运行 TypeScript 入口。
- `pnpm build`：编译到 `dist`。
- `pnpm start`：运行编译后的入口。
- `pnpm user`：执行 `src/scripts/user/index.js`，从旧 MySQL 导出用户 BSON dump，后续用 Studio 3T 手动导入。
- `pnpm user:export`：从旧 MySQL 的 `user_info` / `user_login` 导出 mongodump 目录。
- `pnpm agent`：执行 `src/scripts/agent.js`，先导出智能体 BSON dump，再从 BSON dump 导入 MongoDB。
- `pnpm agent:export`：从旧 MySQL 的 `agent` 导出 mongodump 目录。
- `pnpm agent:import`：从 mongodump 目录导入到 MongoDB 的 `agent`。
- `pnpm conversation`：执行 `src/scripts/conversation.js`，从旧 MySQL 的 `conversation_record` 按 `conversation_id + user_id + agent_id` 抽取会话 BSON，再导入 MongoDB。
- `pnpm conversation:export`：从旧 MySQL 的 `conversation_record` 导出 `conversation` BSON dump。
- `pnpm conversation:import`：从 BSON dump 导入 MongoDB 的 `conversation`。

后续迁移脚本放在 `src/scripts` 下，并在 `package.json` 的 `scripts` 中补充命令。

迁移脚本默认忽略旧 MySQL 中 `logical_del` 非 0 的数据。

## Environment

默认会读取仓库根目录 `.env`、`apps/transfer/.env` 和当前工作目录 `.env`，已存在的环境变量不会被覆盖。

常用变量：

- `TRANSFER_MYSQL_JDBC_URL`
- `TRANSFER_MYSQL_HOST`
- `TRANSFER_MYSQL_PORT`
- `TRANSFER_MYSQL_USER`
- `TRANSFER_MYSQL_PASSWORD`
- `TRANSFER_MYSQL_DATABASE`
- `TRANSFER_MYSQL_CHARSET`
- `TRANSFER_MYSQL_TIMEZONE`
- `TRANSFER_MONGO_HOST`
- `TRANSFER_MONGO_PORT`
- `TRANSFER_MONGO_USERNAME`
- `TRANSFER_MONGO_PASSWORD`
- `TRANSFER_MONGO_DATABASE`
- `TRANSFER_MONGO_AUTH_SOURCE`
- `TRANSFER_USER_BATCH_SIZE`
- `TRANSFER_USER_MODE`：仅支持 `export`，默认 `export`。
- `TRANSFER_USER_DUMP_PATH`：用户迁移 BSON dump 根目录，默认 `apps/transfer/dump`。
- `TRANSFER_AGENT_BATCH_SIZE`
- `TRANSFER_AGENT_MODE`：`all` / `export` / `import`，默认 `all`。
- `TRANSFER_AGENT_IMPORT_BATCH_SIZE`
- `TRANSFER_AGENT_DUMP_PATH`：智能体迁移 BSON dump 根目录，默认跟 `TRANSFER_USER_DUMP_PATH` 一致，未配置时为 `apps/transfer/dump`。
- `TRANSFER_CONVERSATION_BATCH_SIZE`
- `TRANSFER_CONVERSATION_MODE`：`all` / `export` / `import`，默认 `all`。
- `TRANSFER_CONVERSATION_IMPORT_BATCH_SIZE`
- `TRANSFER_CONVERSATION_DUMP_PATH`：会话迁移 BSON dump 根目录，默认跟 `TRANSFER_AGENT_DUMP_PATH` / `TRANSFER_USER_DUMP_PATH` 一致，未配置时为 `apps/transfer/dump`。

旧 MySQL 可以直接配置 JDBC URL，例如：

```ini
TRANSFER_MYSQL_JDBC_URL=jdbc:mysql://host:3310/database?useUnicode=true&characterEncoding=utf-8&serverTimezone=Asia/Shanghai
TRANSFER_MYSQL_USER=your_user
TRANSFER_MYSQL_PASSWORD=your_password
```

用户迁移也可以显式指定 BSON dump 根目录：

```bash
pnpm user:export ./dump
pnpm agent:export ./dump
pnpm agent:import ./dump
pnpm conversation:export ./dump
pnpm conversation:import ./dump
```

导出的目录结构兼容 Studio 3T 的 `BSON - mongodump folder` 导入格式，例如：

```text
dump/
  tzl/
    user.bson
    user.metadata.json
    user_account.bson
    user_account.metadata.json
    agent.bson
    agent.metadata.json
    conversation.bson
    conversation.metadata.json
```

在 Studio 3T 导入时选择 `dump` 作为 mongodump 根目录。
