import type { MemoryOpenItemState } from '@tzl/entities';

/**
 * 未了结条目的抽取与状态判定规则（离线任务用）。
 *
 * 线上实测：陪伴型聊天是"9 个字一条"的碎片，"要……""明天……"这类词到处都是，
 * 只按宽信号抽取会给每个用户每月堆几十条候选（实测 43 条/月），清单直接变噪声。
 * 所以收紧为**两个条件同时满足**才算一件没完的事：
 *   ① 命中一个具体事项（就医、学业、工作、钱财、承诺类习惯……）；
 *   ② 有明确的"未完成/未来"信号，或有明确的承诺语气。
 * 纪念日、纯情绪、泛指闲聊一律不进清单。
 *
 * 状态迁移只由离线任务写；回复链路只写"这一轮提起了"。
 */

/** 具体事项：只有这些类别才可能成为一件没完的事。 */
const OPEN_ITEM_TOPIC_RULES: Array<[RegExp, string]> = [
  [
    /复查|复诊|化验|检查|报告|拍片|结果|住院|出院|手术|开刀|化疗|放疗|看病|拿药|体检|配药/u,
    '就医',
  ],
  [/生病|发烧|咳嗽|血压|血糖|疼|不舒服|失眠|睡不着|睡眠|吃药|服药/u, '身体'],
  [
    /考试|成绩|分数|升学|中考|高考|考研|录取|开学|报名|补课|家长会|论文|答辩/u,
    '学业',
  ],
  [
    /面试|上班|工作|加班|辞职|离职|换工作|失业|涨工资|发工资|出差|项目|合同/u,
    '工作',
  ],
  [/搬家|买房|租房|装修|过户|拆迁|新房|看房|交房/u, '居住'],
  [/借钱|还钱|欠款|工资|存款|存钱|赔钱|分红|打官司|开庭|起诉/u, '钱财'],
  [/结婚|离婚|怀孕|生孩子|坐月子|订亲|相亲|处对象|婚礼/u, '婚育'],
  [/吵架|闹别扭|矛盾|翻脸|不搭理|和好|道歉/u, '关系矛盾'],
  // 习惯类只在"承诺/决心"路径下才算（见下方承诺信号），日常提到不算。
  [/抽烟|吸烟|戒烟|复吸|喝酒|戒酒|减肥|锻炼|运动/u, '习惯'],
];

/** 明确的"未完成 / 未来"信号：去掉"要""得"这类到处都是的词。 */
const UNRESOLVED_MARKER_PATTERN =
  /(?:还没|还没好|还没定|还没出|没出|没定|没有结果|等结果|等消息|等着|过几天|下周|下个月|下星期|明天|后天|到时候|约好|预约|准备去|打算去|计划去|要去|得去|需要去|准备做|打算做|计划做|要开始|开始戒|在戒|坚持|保证)/u;

/** 承诺/决心语气：习惯类只有这种语气才算一件"要跟进的事"。 */
const COMMITMENT_MARKER_PATTERN =
  /(?:我?决定|下决心|答应|保证|从今天起|从明天起|开始了|要坚持|在戒|戒了|不抽了|不喝了|不再)/u;

/** 说明"这件事已经有结果/了结了"的信号。 */
export const OPEN_ITEM_RESOLVED_PATTERN =
  /(?:没事了|没事儿了|好了|好转了|康复了|出院了|考完了|考过了|过了|通过了|解决了|办完了|结束了|结果出来了|结果没事|已经好了|不用了|取消了|不去了|不抽了|不喝了|戒了|戒掉了|已经戒了|分手了|离了|搬完了|搞定了|还清了)/u;

/** 说明用户明确不想再提这件事。 */
export const OPEN_ITEM_DISMISS_PATTERN =
  /(?:别问了|不想提|别提了|不要再问|别再说|不想说这个|不想聊这个)/u;

/** 就医、身体、钱财这一类更重，其余按一般重要度。 */
const HIGH_IMPORTANCE_PATTERN =
  /(?:住院|手术|化疗|放疗|复查|复诊|体检|看病|拿药|病|癌|抢救|ICU|借钱|还钱|欠款|打官司|开庭|离婚)/u;

export interface OpenItemObservation {
  /** 这件事是不是"还没完"。 */
  unresolved: boolean;
  /** 有结果、已了结。 */
  resolved: boolean;
  /** 用户明确不想再提。 */
  dismissed: boolean;
  /** 命中的具体事项；没有事项就不成条目。 */
  topicKey?: string;
  importance: 1 | 2 | 3;
}

/** 这句话谈到的"具体事项"（纪念日、闲聊不算）。 */
export function resolveItemTopicKey(text: string): string | undefined {
  const value = (text || '').trim();
  if (!value) return undefined;
  for (const [pattern, key] of OPEN_ITEM_TOPIC_RULES) {
    if (pattern.test(value)) return key;
  }
  return undefined;
}

/**
 * 判定这句话对"未了结清单"意味着什么。
 * 收紧后：必须命中具体事项；已了结 / 不想提直接返回；
 * 否则要同时有"未来或未完成"信号，或（习惯类）有明确承诺，才算一条。
 */
export function resolveOpenItemObservation(
  text: string
): OpenItemObservation | undefined {
  const value = (text || '').trim();
  if (!value) return undefined;

  // "别问了、我不想提"通常不点明是哪件事，但它必须生效：
  // 不知道是哪件时由引擎落到"刚刚问过的那一件"上（见引擎）。
  const dismissed = OPEN_ITEM_DISMISS_PATTERN.test(value);
  if (dismissed) {
    return {
      unresolved: false,
      resolved: false,
      dismissed: true,
      importance: HIGH_IMPORTANCE_PATTERN.test(value) ? 3 : 2,
    };
  }

  const topicKey = resolveItemTopicKey(value);
  if (!topicKey) return undefined;

  const resolved = OPEN_ITEM_RESOLVED_PATTERN.test(value);
  if (resolved) {
    return {
      unresolved: false,
      resolved: true,
      dismissed: false,
      topicKey,
      importance: HIGH_IMPORTANCE_PATTERN.test(value) ? 3 : 2,
    };
  }

  const commitment = COMMITMENT_MARKER_PATTERN.test(value);
  const upcoming = UNRESOLVED_MARKER_PATTERN.test(value);
  if (!upcoming && !commitment) return undefined;

  return {
    unresolved: true,
    resolved: false,
    dismissed: false,
    topicKey,
    importance: HIGH_IMPORTANCE_PATTERN.test(value) ? 3 : 2,
  };
}

/** 一句话写成条目摘要：只截取原话，不改写、不总结。 */
export function buildOpenItemSummary(text: string): string {
  const value = (text || '').trim().replace(/\s+/gu, ' ');
  return value.length > 60 ? `${value.slice(0, 60)}…` : value;
}

/** 状态迁移的合法方向：只允许从活跃态走向终态，或互相之间做有限调整。 */
export function nextOpenItemState(options: {
  current: MemoryOpenItemState;
  observation: OpenItemObservation;
}): MemoryOpenItemState | undefined {
  const { current, observation } = options;
  const activeStates: MemoryOpenItemState[] = [
    'reported',
    'awaiting_result',
    'action_committed',
  ];

  if (observation.dismissed) {
    return current === 'dismissed' ? undefined : 'dismissed';
  }
  if (observation.resolved) {
    return current === 'resolved' ? undefined : 'resolved';
  }
  if (!activeStates.includes(current)) return undefined;
  if (observation.unresolved) {
    return current === 'awaiting_result' ? undefined : 'awaiting_result';
  }
  return undefined;
}
