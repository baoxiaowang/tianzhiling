/**
 * 记忆写入总闸（临时运维开关）。
 *
 * `MEMORY_WRITE_DISABLED=true` 时，所有「自动记忆写入」入口统一短路：
 *   - 聊天 / 异步 / 小使者触发的结构化记忆入队（scheduleUserMessageEnrichment）
 *   - 视觉外观事实直写（scheduleVisualAppearanceMemory）
 *   - 检索触发的懒回填入队（agent-chat-tool.queueLazyBackfill）
 *   - 导入的自动风格 / 语言画像写入（updateAgentLanguageProfile）
 *   - 记忆任务消费（在 beginTaskExecution 统一延后：不删除、不标成功、不消耗重试次数）
 *
 * 刻意不影响（按运维要求保留）：
 *   - 聊天消息保存、近期上下文、已有记忆的检索与读取
 *   - 用户主动创建 / 编辑角色资料（导入记忆候选经用户确认后的写入）
 *   - 数据库、向量库与聊天服务本身
 *
 * 与既有的 `CHAT_SKIP_MEMORY_WRITE` 的关系：那个是更窄的旧开关，只覆盖
 * 原话索引入队、角色画像事实、时间记忆与批量抽取路由。`isMemoryWritePaused()`
 * 把两者合并，使「只设 MEMORY_WRITE_DISABLED 一个变量」即可覆盖全部自动写入；
 * 单独设 CHAT_SKIP_MEMORY_WRITE 仍保持旧的窄语义不变。
 */
function readTruthy(raw: unknown): boolean {
  if (typeof raw !== 'string') {
    return false;
  }
  const value = raw.trim().toLowerCase();
  return value === 'true' || value === '1' || value === 'yes';
}

export function isMemoryWriteDisabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return readTruthy(env.MEMORY_WRITE_DISABLED);
}

/** 自动记忆写入是否应暂停：总闸打开，或旧开关 CHAT_SKIP_MEMORY_WRITE 打开。 */
export function isMemoryWritePaused(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return isMemoryWriteDisabled(env) || readTruthy(env.CHAT_SKIP_MEMORY_WRITE);
}

