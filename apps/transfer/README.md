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
- `pnpm message`：执行 `src/scripts/message.js`，从旧 MySQL 的 `conversation_record` 导出消息 BSON，再导入 MongoDB 的 `message`。
- `pnpm message:export`：从旧 MySQL 的 `conversation_record` 导出 `message` BSON dump。
- `pnpm message:import`：从 BSON dump 导入 MongoDB 的 `message`。
- `pnpm post`：执行 `src/scripts/post.js`，从旧 MySQL 的 `moment` 导出动态 BSON，再导入 MongoDB 的 `post`。
- `pnpm post:export`：从旧 MySQL 的 `moment` 导出 `post` BSON dump。
- `pnpm post:import`：从 BSON dump 导入 MongoDB 的 `post`。
- `pnpm post-comment`：执行 `src/scripts/post-comment.js`，从旧 MySQL 的 `moment_comment` / `replay_message` 导出动态评论 BSON，再导入 MongoDB 的 `post_comment`。
- `pnpm post-comment:export`：从旧 MySQL 的动态评论表导出 `post_comment` BSON dump。
- `pnpm post-comment:import`：从 BSON dump 导入 MongoDB 的 `post_comment`。
- `pnpm membership-order`：执行 `src/scripts/membership-order.js`，从旧 MySQL 的 `agent` / `speaker` / `order` / `goods` 聚合导出会员、订单、历史声音训练任务和历史音色素材 BSON dump，不执行 MongoDB 导入。
- `pnpm membership-order:export`：同上，仅导出 `order` / `user_membership` / `voice_training_task` / `voice_timbre` BSON dump 和 `membership-order.report.json` 报表。
- `pnpm membership-order:test`：执行会员订单迁移脚本级 fixture 校验。

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
- `TRANSFER_MESSAGE_BATCH_SIZE`
- `TRANSFER_MESSAGE_MODE`：`all` / `export` / `import`，默认 `all`。
- `TRANSFER_MESSAGE_IMPORT_BATCH_SIZE`
- `TRANSFER_MESSAGE_DUMP_PATH`：消息迁移 BSON dump 根目录，默认跟 `TRANSFER_CONVERSATION_DUMP_PATH` / `TRANSFER_AGENT_DUMP_PATH` / `TRANSFER_USER_DUMP_PATH` 一致，未配置时为 `apps/transfer/dump`。
- `TRANSFER_MESSAGE_USER_SEND_TYPES`：可选，逗号分隔，覆盖旧 `send_type` 到 `role=user` 的映射，默认包含 `1,user,用户,member,customer,human`。
- `TRANSFER_MESSAGE_ASSISTANT_SEND_TYPES`：可选，逗号分隔，覆盖旧 `send_type` 到 `role=assistant` 的映射，默认包含 `2,agent,assistant,ai,bot,智能体`。
- `TRANSFER_POST_BATCH_SIZE`
- `TRANSFER_POST_MODE`：`all` / `export` / `import`，默认 `all`。
- `TRANSFER_POST_IMPORT_BATCH_SIZE`
- `TRANSFER_POST_DUMP_PATH`：动态迁移 BSON dump 根目录，默认跟 `TRANSFER_MESSAGE_DUMP_PATH` / `TRANSFER_CONVERSATION_DUMP_PATH` / `TRANSFER_AGENT_DUMP_PATH` / `TRANSFER_USER_DUMP_PATH` 一致，未配置时为 `apps/transfer/dump`。
- `TRANSFER_POST_COMMENT_BATCH_SIZE`
- `TRANSFER_POST_COMMENT_MODE`：`all` / `export` / `import`，默认 `all`。
- `TRANSFER_POST_COMMENT_IMPORT_BATCH_SIZE`
- `TRANSFER_POST_COMMENT_DUMP_PATH`：动态评论迁移 BSON dump 根目录，默认跟 `TRANSFER_POST_DUMP_PATH` / `TRANSFER_MESSAGE_DUMP_PATH` / `TRANSFER_CONVERSATION_DUMP_PATH` / `TRANSFER_AGENT_DUMP_PATH` / `TRANSFER_USER_DUMP_PATH` 一致，未配置时为 `apps/transfer/dump`。
- `TRANSFER_POST_COMMENT_INCLUDE_MOMENT_COMMENT`：是否导出旧 `moment_comment`，默认 `true`。
- `TRANSFER_POST_COMMENT_INCLUDE_REPLAY_MESSAGE`：是否导出旧 `replay_message`，默认 `true`。
- `TRANSFER_MEMBERSHIP_ORDER_BATCH_SIZE`
- `TRANSFER_MEMBERSHIP_ORDER_MODE`：仅支持 `export`，默认 `export`。
- `TRANSFER_MEMBERSHIP_ORDER_DUMP_PATH`：会员订单和历史声音训练任务迁移 BSON dump 根目录，默认跟其他迁移 dump 路径一致，未配置时为 `apps/transfer/dump`。

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
pnpm message:export ./dump
pnpm message:import ./dump
pnpm post:export ./dump
pnpm post:import ./dump
pnpm post-comment:export ./dump
pnpm post-comment:import ./dump
pnpm membership-order:export ./dump
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
    message.bson
    message.metadata.json
    post.bson
    post.metadata.json
    post_comment.bson
    post_comment.metadata.json
    order.bson
    order.metadata.json
    user_membership.bson
    user_membership.metadata.json
    membership-order.report.json
    voice_training_task.bson
    voice_training_task.metadata.json
    voice_timbre.bson
    voice_timbre.metadata.json
```

在 Studio 3T 导入时选择 `dump` 作为 mongodump 根目录。
