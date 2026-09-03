# 微信聊天记录导入工作流

更新时间：2026-08-03

## 当前落地范围

第一阶段可用闭环已经完成：

1. 聊天页加号面板增加“导入记录”。
2. 用户可从相册分批添加微信聊天截图，单次最多 9 张，单批最多 30 张。
3. 识别前确认截图左右双方，默认左侧为他、右侧为用户。
4. 后台视觉模型识别文字、方向、消息类型、原始时间和标准时间。
5. 识别结果以聊天气泡校对，低置信内容突出显示。
6. 单条记录支持修改文字、调整说话人、修改日期时间和删除。
7. 确认后按历史时间写入聊天，并生成一条当前时间的导入摘要。
8. 导入消息不计入聊天额度，不进入待回复队列，也不触发即时回复。
9. 后台优先学习他的语言风格，包括习惯语气词、句子长度、一次回复的气泡数和表达节奏。
10. 后台从历史对话提取候选记忆，用户可确认、修改或移除，确认后才写入正式记忆。
11. 批次、截图、识别条目、校对结果、候选记忆、消息 ID 和任务状态完整保存，退出后可继续。

## 小程序入口

- 加号面板：`apps/weapp/src/components/chat-more-panel/chat-more-panel.vue`
- 导入页面：`apps/weapp/src/pages/chat-import/index.vue`
- 客户端接口：`apps/weapp/src/apis/chat-import.ts`
- 分包路径：`pages/chat-import/index`

导入页会先读取当前会话尚未结束的批次。存在 `queued`、`recognizing`、`needs_review`、`extracting_memory`、`needs_memory_review` 或失败批次时，用户会继续原任务，而不是重新创建。

## 后端入口

- 控制器：`apps/node/src/controller/conversation.controller.ts`
- 服务：`apps/node/src/service/conversation-chat-import.service.ts`
- 队列处理器：`apps/node/src/processor/conversation-chat-import.processor.ts`
- 纯规则：`apps/node/src/service/chat-import-domain.ts`
- 队列名：`conversation-chat-import`

接口：

```text
POST   /conversation/:conversationId/chat-imports
GET    /conversation/:conversationId/chat-imports/active
GET    /conversation/:conversationId/chat-imports/:batchId
POST   /conversation/:conversationId/chat-imports/:batchId/assets
POST   /conversation/:conversationId/chat-imports/:batchId/recognize
PATCH  /conversation/:conversationId/chat-imports/:batchId/identity
PATCH  /conversation/:conversationId/chat-imports/:batchId/items/:itemId
POST   /conversation/:conversationId/chat-imports/:batchId/confirm
PATCH  /conversation/:conversationId/chat-imports/:batchId/memories/:memoryId
POST   /conversation/:conversationId/chat-imports/:batchId/memories/confirm
DELETE /conversation/:conversationId/chat-imports/:batchId
```

## 持久化

新增集合：

- `conversation_chat_import_batch`：保存批次状态、截图、身份映射、识别统计、错误、可审核的记忆候选，以及记忆与风格任务状态。
- `conversation_chat_import_item`：保存每条识别文字、截图位置、说话人、时间、置信度、用户修改和最终消息 ID。

重新识别不会删除上一轮识别条目。旧条目使用 `isSuperseded` 标记为已替代，并保留 `recognitionAttempt`，页面和确认接口只读取当前版本。

消息使用原有 `message` 集合，并新增可选字段：

```text
source = wechat_import
importBatchId
importItemId
importedAt
sourceOccurredAt
sourceRawTimeText
sourceTimePrecision
sourceTimeConfidence
sourceScreenshotId
sourceSequence
recognitionConfidence
quotaExempt = true
replyTrigger = false
```

旧客户端会忽略新增字段，继续把导入内容显示成普通文字气泡。

## 顺序、时间与去重

- 顺序以截图序号和气泡位置为基础；只有双方都识别到明确历史时间时，才按标准时间辅助排序。
- `昨天`、`星期五`、`晚上 10:30` 等原始时间文字会保存为证据，不根据导入当天推断历史日期。
- 只比较相邻截图的边界：上一张末尾与下一张开头出现连续相同消息时，才判定为截图重叠。
- 单条短回复即使文字相同也不去重；单条较长消息必须同时具有一致的明确时间，才可作为边界重叠去重。
- 同一组重叠消息保留识别置信度更高的一份，原条目仍在业务记录中保留并标记 `isDuplicate`。

## 额度和回复保护

- 导入服务不调用普通 `/messages` 或 `/messages/async`。
- 聊天额度统计排除 `quotaExempt = true`。
- 待回复用户消息和“是否存在新用户消息”查询排除 `replyTrigger = false`。
- 导入过程不调用当前情绪识别或实时危机流程。

## 记忆与说话方式

- 只对用户确认后的文字消息分析。
- 语言风格学习是聊天导入的重点，分析对象仅为“他”一侧的消息。
- 规则统计包括习惯语气词、平均与中位句长、长短句分布、一次回复连续发送的气泡数、多气泡回复比例、问句、标点和高频短语。
- 模型在规则统计和原始样本上生成语言画像，结果写入 `AgentEntity.personaProfile.languageProfile`；聊天回复提示会读取 `modalParticles` 和 `replyBubblePattern`。
- 历史事实先保存为批次内候选，不直接写入正式记忆。用户可逐条修改或移除，再统一确认。
- 确认后的记忆保留来源导入条目 ID 和消息 ID，同一条记忆可有多条来源证据。
- 用户删除导入聊天时，可勾选同时删除对应记忆；只有最后一条来源证据也被删除后，该记忆才会归档。
- 历史提示词明确禁止把过去的临时状态解释为用户当前状态。
- 少于 10 条只保存风格证据；10 条以上生成低置信画像；30 条以上且跨至少 2 天可形成较高置信画像。
- 聚合结果写入 `AgentEntity.personaProfile.languageProfile`，不会覆盖事实和安全边界。

## 运行依赖

- 腾讯 COS：保存截图并提供视觉模型可读取的地址。
- Redis/BullMQ：运行识别和记忆任务。
- 视觉模型配置：`NODE_VISION_MODEL`、`NODE_VISION_API_KEY`、`NODE_VISION_BASE_URL`。
- 文本模型配置：用于历史事实和语言风格分析；不可用时仍保留导入消息和规则统计。

## 测试

```text
pnpm --filter @tzl/entities build
pnpm --filter ./apps/node build
pnpm --filter ./apps/node test -- --runInBand test/service/chat-import-domain.test.ts test/service/conversation-chat-import.service.test.ts test/service/message.service.test.ts test/service/agent-profile-fact.service.test.ts
pnpm --filter ./apps/weapp build:weapp
```

专项测试覆盖时间排序、相邻截图边界去重、语言统计、回复气泡数、候选记忆确认、来源证据删除，以及导入消息的 `quotaExempt` 和 `replyTrigger` 保护。

## 后续质量增强

当前第一阶段使用视觉模型直接识别。后续可继续增加：

1. 专用 OCR 与视觉模型双路校验。
2. 聊天气泡局部裁剪二次识别。
3. 逐张截图的身份映射和手动排序。
4. 原截图 7 天自动删除任务及导入批次管理页。
5. 群聊中指定某一位亲友的识别模式。

## 发布注意

本功能涉及后端实体、MongoDB 集合、BullMQ 队列和视觉模型，属于需要单独验证的后端发布范围。发布前必须确认 COS、Redis、视觉模型配置、队列处理器和回滚方案；不要只发布小程序入口而不发布对应后端。
