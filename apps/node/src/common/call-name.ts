/**
 * 称呼归一：用户可能在一个称呼字段里填写多个备选称呼，例如
 * “老婆，姓傅的”“大宝、老闺宁”“儿子/妹妹”。提示词与展示层只应使用其中
 * 第一个作为主称呼，否则模型会把多个称呼一起叫出来（用户反馈“每次都是
 * 两个称呼一起，很别扭”）。
 *
 * 这里只做读取/展示层的归一，不改写数据库中的原始值：编辑页回填、导出等
 * 仍保留用户填写的完整内容。
 */
const CALL_NAME_SEPARATOR_PATTERN = /[，,、/／]+/u;

/**
 * 取多值称呼的第一个非空片段作为主称呼。
 * 没有分隔符时原样返回；全为空则退回原始文本（例如只填了“，，”）。
 */
export function primaryCallName(value?: string | null): string {
  const raw = typeof value === 'string' ? value.trim() : '';

  if (!raw) {
    return '';
  }

  const primary = raw
    .split(CALL_NAME_SEPARATOR_PATTERN)
    .map(segment => segment.trim())
    .find(segment => segment.length > 0);

  return primary || raw;
}

/**
 * 把文本中出现过的多值称呼替换为主称呼。
 * 用于 description 这类派生文本：历史数据已经把“老婆，姓傅的”写进了
 * 自我介绍，读出来时同样需要归一，否则多称呼仍会进入模型上下文。
 */
export function normalizeCallNameInText(
  text?: string | null,
  rawCallName?: string | null
): string {
  const value = typeof text === 'string' ? text : '';
  const raw = typeof rawCallName === 'string' ? rawCallName.trim() : '';
  const primary = primaryCallName(raw);

  if (!value || !raw || !primary || raw === primary) {
    return value;
  }

  return value.split(raw).join(primary);
}
