/**
 * 记忆话题键：把"用户换着说法讲同一件事"归到同一个键上。
 * 两个地方共用，必须只有一份定义：
 *   1) 检索键抽取（agent.context）：用户这轮提到某话题，就按话题键去找旧话；
 *   2) 事件组合（memory 模块）：同一个话题 + 同一主体 + 生命周期连续，算同一件事。
 */

/** 习惯/身体类话题，主要用于检索键抽取。 */
export const HABIT_TOPIC_KEYS: Array<[RegExp, string]> = [
  // 单字"抽/喝/睡"也要收：用户讲这件事时常用否定式——"真的没抽""不喝了""没睡好"，
  // 这些说法里没有完整的"抽烟/喝酒/睡眠"，只按词匹配就永远找不到同一件事。
  [/抽烟|吸烟|戒[烟了]|复吸|一根烟|一颗烟|烟|抽/u, '抽烟'],
  [/喝酒|酒局|白酒|啤酒|黄酒|戒酒|酒|喝/u, '喝酒'],
  [/吃药|服药|停药|复诊|看病|药/u, '吃药'],
  [/失眠|睡不着|睡眠|睡得|早睡|熬夜|睡/u, '睡眠'],
  [/锻炼|运动|散步|跑步|健身|体检/u, '锻炼'],
];

/**
 * 组合用的话题规则：比检索键更宽，覆盖"一件具体的事"的常见类别。
 * 命中不到任何一条时，这句话不参与组合（宁可少聚，不可错聚）。
 */
export const EVENT_TOPIC_RULES: Array<[RegExp, string]> = [
  ...HABIT_TOPIC_KEYS,
  [/复查|复诊|检查|化验|拍片|结果|报告单|报告出来|出结果/u, '就医复查'],
  [/住院|出院|手术|开刀|化疗|放疗|抢救|ICU|重症/u, '住院就医'],
  [/生病|发烧|咳嗽|感冒|疼|不舒服|血压|血糖|血糖高|血压高/u, '身体状况'],
  [/考试|成绩|分数|升学|中考|高考|考研|录取|开学|报名|补课|家长会/u, '学业'],
  [/面试|上班|工作|加班|辞职|离职|换工作|失业|涨工资|发工资/u, '工作'],
  [/搬家|买房|租房|装修|过户|拆迁|新房|老房子/u, '居住'],
  [/生日|生辰|忌日|祭日|清明|中元|周年|祭拜|上坟|扫墓/u, '纪念日'],
  [/借钱|还钱|欠款|工资|存款|存钱|花销|赔钱|分红/u, '钱财'],
  [/结婚|离婚|怀孕|生孩子|坐月子|订亲|相亲|处对象/u, '婚育'],
  // 不用裸的"走了"：会被"出去走了走"这类误命中。
  [
    /去世|过世|离世|葬礼|下葬|出殡|后事|(?:你|您|他|她|爸|妈|爹|娘|奶奶|爷爷|姥姥|姥爷|外公|外婆)走了/u,
    '丧事',
  ],
  [/吵架|闹别扭|生气|矛盾|翻脸|不搭理|和好/u, '关系矛盾'],
];

/** 这句话谈到的话题键（可多个）。 */
export function resolveTopicKeys(text: string): string[] {
  const value = (text || '').trim();
  if (!value) return [];
  const keys: string[] = [];
  for (const [pattern, key] of EVENT_TOPIC_RULES) {
    if (keys.indexOf(key) === -1 && pattern.test(value)) keys.push(key);
  }
  return keys;
}

/** 组合用的主话题：取规则表里第一个命中的话题键。 */
export function resolvePrimaryTopicKey(text: string): string | undefined {
  const value = (text || '').trim();
  if (!value) return undefined;
  for (const [pattern, key] of EVENT_TOPIC_RULES) {
    if (pattern.test(value)) return key;
  }
  return undefined;
}
