import type { MessageEntity, MongoObjectId } from '@tzl/entities';
import type {
  RelationshipOpenLoopAuthorityType,
  RelationshipOpenLoopContentDomain,
  RelationshipOpenLoopDraft,
  RelationshipOpenLoopRelation,
  RelationshipOpenLoopState,
} from './relationship-open-loop';

export interface RelationshipOpenLoopExtraction {
  draft?: RelationshipOpenLoopDraft;
  sourceMessageId: string;
  sourceOccurredAt: Date;
  decision:
    | 'candidate'
    | 'lifecycle_only'
    | 'fact_verification_only'
    | 'not_eligible';
  reason: string;
}

const SERIOUS_HEALTH_PATTERN =
  /(?:住院|手术|癌|肿瘤|恶性|确诊|化疗|放疗|病危|抢救|ICU|重症|呼吸困难|吐血|晕倒|高烧不退|疼得厉害|复查.{0,10}(?:没控制住|没有控制住|不好)|长期卧床)|(?:病情|身体|伤势|情况).{0,8}(?:很严重|挺严重|比较严重)/u;
const HEALTH_PATTERN =
  /(?:生病|病了|住院|手术|复查|检查|化验|治疗|出院|康复|去医院|看医生)/u;
const CURRENT_HEALTH_REPORT_PATTERN =
  /(?:(?:我|自己|本人)|(?:爸爸|父亲|爸|妈妈|母亲|妈|爷爷|奶奶|姥姥|姥爷|外公|外婆|孩子|儿子|女儿|哥哥|姐姐|弟弟|妹妹|老公|老婆|丈夫|妻子)).{0,14}(?:最近|这两天|这阵子|现在|昨天|前天|一直|又|有点|很|挺|比较|不太)?.{0,8}(?:不舒服|身体不好|生病了|病了|发烧了|感冒了|疼得厉害)/u;
const FAMILY_SUBJECT_PATTERN =
  /(?:爸爸|父亲|爸|妈妈|母亲|妈|爷爷|奶奶|姥姥|姥爷|外公|外婆|孩子|儿子|女儿|哥哥|姐姐|弟弟|妹妹|老公|老婆|丈夫|妻子)/u;
const DECISION_REQUEST_PATTERN =
  /(?:怎么办|怎么处理|能不能|可不可以|要不要|该不该|应该不应该|怎么决定|怎么选|拿不定主意|帮我想想|帮帮我)/u;
const WAITING_RESULT_PATTERN =
  /(?:等|等待).{0,12}(?:结果|通知|回复|消息|答复)|(?:结果|通知).{0,12}(?:没出|没出来|还没有|还没)|复查.{0,12}(?:还没|等待|等)/u;
const EXPLICIT_COMMITMENT_PATTERN =
  /(?:我|我们)(?:准备|打算|决定|计划|明天|后天|下周|过几天|到时候|今晚|今天要|明天要).{1,60}/u;
const CONCRETE_FUTURE_EVENT_PATTERN =
  /(?:考试|面试|复试|入职|报到|开庭|签约|手术|复查|检查|住院|出院|搬家|迁居|回家|出差|旅行|结婚|婚礼|上学|开学|转学|比赛|演出|开会|办手续|提交申请|等候审批|等待审批|等通知|等结果)/u;
const EXPLICIT_PROMISE_PATTERN =
  /(?:我|我们).{0,8}(?:答应|保证|承诺|说好).{1,60}/u;
const FACT_VERIFICATION_RISK_PATTERN =
  /(?:你|您).{0,12}(?:是不是|有没有|是否).{0,30}(?:藏|放|留|埋|存).{0,30}(?:东西|钱|存折|珠子|首饰|信|钥匙)|(?:我|我们).{0,20}(?:去哪里|在哪|哪里).{0,12}(?:找|拿|取|挖)/u;
const PROPERTY_PATTERN =
  /(?:房子|房产|财产|遗产|家产|产权|过户|卖房|卖掉房|分家|存款|存折|遗嘱|律师|法院|官司)/u;
const CARE_PATTERN = /(?:照顾|照料|陪护|看护|养老|谁管|谁陪|没人管|没人照顾)/u;
const CHILD_EDUCATION_PATTERN =
  /(?:孩子|儿子|女儿|侄子|侄女|外甥|外甥女).{0,24}(?:上学|转学|学校|幼儿园|接送|留在|回老家|监护|照顾)|(?:上学|转学|学校|幼儿园|接送).{0,24}(?:孩子|儿子|女儿|侄子|侄女|外甥|外甥女)/u;
const FUNERAL_PATTERN =
  /(?:安葬|下葬|葬在|埋在|迁坟|迁葬|墓地|坟地|骨灰|五七|百日|周年|祭扫|扫墓|上坟)/u;
const RELATIONSHIP_DECISION_PATTERN =
  /(?:离婚|分居|复婚|道歉|家暴|打人|控制欲|情感控制|断绝关系|要不要继续|该不该继续)/u;
const LIFECYCLE_PATTERN =
  /(?:解决了|定下来了|办好了|商量好了|结束了|出院了|康复了|结果出来了|结果出了|没事了|不要再问|别再问|不要再提|别再提|不想再聊|改天再说|以后再说|过段时间再说)/u;

export function shouldInspectRelationshipOpenLoopText(text: string): boolean {
  const normalized = normalizeText(text, 600);
  if (normalized.length < 3) return false;
  return (
    LIFECYCLE_PATTERN.test(normalized) ||
    SERIOUS_HEALTH_PATTERN.test(normalized) ||
    WAITING_RESULT_PATTERN.test(normalized) ||
    EXPLICIT_PROMISE_PATTERN.test(normalized) ||
    (Boolean(resolveDueAt(normalized, new Date())) &&
      CONCRETE_FUTURE_EVENT_PATTERN.test(normalized)) ||
    ((PROPERTY_PATTERN.test(normalized) ||
      CARE_PATTERN.test(normalized) ||
      CHILD_EDUCATION_PATTERN.test(normalized) ||
      FUNERAL_PATTERN.test(normalized) ||
      RELATIONSHIP_DECISION_PATTERN.test(normalized)) &&
      (DECISION_REQUEST_PATTERN.test(normalized) ||
        EXPLICIT_COMMITMENT_PATTERN.test(normalized)))
  );
}

export function extractRelationshipOpenLoop(options: {
  message: Pick<MessageEntity, 'id' | 'createdAt' | 'sourceOccurredAt'>;
  text: string;
  now?: Date;
}): RelationshipOpenLoopExtraction {
  const now = options.now ?? new Date();
  const text = normalizeText(options.text, 600);
  const sourceMessageId = stringifyObjectId(options.message.id);
  const sourceOccurredAt =
    options.message.sourceOccurredAt ?? options.message.createdAt ?? now;
  if (!text || !sourceMessageId) {
    return {
      sourceMessageId,
      sourceOccurredAt,
      decision: 'not_eligible',
      reason: 'empty_or_missing_source',
    };
  }
  if (LIFECYCLE_PATTERN.test(text)) {
    return {
      sourceMessageId,
      sourceOccurredAt,
      decision: 'lifecycle_only',
      reason: 'explicit_lifecycle_signal',
    };
  }
  if (FACT_VERIFICATION_RISK_PATTERN.test(text)) {
    return {
      sourceMessageId,
      sourceOccurredAt,
      decision: 'fact_verification_only',
      reason: 'unsupported_real_object_verification',
    };
  }
  if (
    CURRENT_HEALTH_REPORT_PATTERN.test(text) &&
    countDistinctHealthSubjects(text) > 1
  ) {
    return {
      sourceMessageId,
      sourceOccurredAt,
      decision: 'not_eligible',
      reason: 'compound_health_event_requires_context',
    };
  }

  const dueAt = resolveDueAt(text, sourceOccurredAt);
  const classification = classifyOpenLoop(text, dueAt);
  if (!classification) {
    return {
      sourceMessageId,
      sourceOccurredAt,
      decision: 'not_eligible',
      reason: 'no_high_confidence_open_loop',
    };
  }
  const waitingResult = WAITING_RESULT_PATTERN.test(text);
  const commitment = extractExplicitCommitment(text);
  const state = resolveState({
    dueAt,
    waitingResult,
    commitment,
    decisionRequested: DECISION_REQUEST_PATTERN.test(text),
    seriousHealth: SERIOUS_HEALTH_PATTERN.test(text),
  });
  const relation = resolveRelation({ state, dueAt, commitment });
  const expiresAt = resolveExpiresAt({
    domain: classification.domain,
    importance: classification.importance,
    dueAt,
    sourceOccurredAt,
  });
  const draft: RelationshipOpenLoopDraft = {
    summary: text.slice(0, 140),
    subject: resolveSubject(text, classification.domain),
    contentDomain: classification.domain,
    authorityType: classification.authorityType,
    state,
    importance: classification.importance,
    ...(dueAt ? { dueAt } : {}),
    ...(expiresAt ? { expiresAt } : {}),
    ...(commitment ? { userCommitment: commitment } : {}),
    ...(relation ? { relation } : {}),
  };
  return {
    sourceMessageId,
    sourceOccurredAt,
    decision: 'candidate',
    reason: classification.reason,
    draft,
  };
}

function classifyOpenLoop(
  text: string,
  dueAt?: Date
):
  | {
      domain: RelationshipOpenLoopContentDomain;
      authorityType: RelationshipOpenLoopAuthorityType;
      importance: 1 | 2 | 3;
      reason: string;
    }
  | undefined {
  if (SERIOUS_HEALTH_PATTERN.test(text)) {
    return {
      domain: 'health',
      authorityType: 'professional_high_stakes',
      importance: 3,
      reason: 'serious_health',
    };
  }
  if (
    HEALTH_PATTERN.test(text) &&
    (WAITING_RESULT_PATTERN.test(text) ||
      EXPLICIT_COMMITMENT_PATTERN.test(text) ||
      DECISION_REQUEST_PATTERN.test(text) ||
      Boolean(dueAt))
  ) {
    return {
      domain: 'health',
      authorityType: 'professional_high_stakes',
      importance: 2,
      reason: 'health_result_or_decision',
    };
  }
  if (
    PROPERTY_PATTERN.test(text) &&
    (DECISION_REQUEST_PATTERN.test(text) ||
      WAITING_RESULT_PATTERN.test(text) ||
      EXPLICIT_COMMITMENT_PATTERN.test(text))
  ) {
    return {
      domain: 'property_or_legal',
      authorityType: 'family_joint',
      importance: 3,
      reason: 'property_or_legal_decision',
    };
  }
  if (
    FUNERAL_PATTERN.test(text) &&
    (hasConcreteArrangement(text) || EXPLICIT_COMMITMENT_PATTERN.test(text))
  ) {
    return {
      domain: 'funeral_or_memorial',
      authorityType: /(?:墓地|坟地|葬在|埋在|迁坟|迁葬)/u.test(text)
        ? 'family_joint'
        : 'personal_symbolic',
      importance: 2,
      reason: 'scheduled_funeral_or_memorial_arrangement',
    };
  }
  if (
    CHILD_EDUCATION_PATTERN.test(text) &&
    (DECISION_REQUEST_PATTERN.test(text) ||
      WAITING_RESULT_PATTERN.test(text) ||
      EXPLICIT_COMMITMENT_PATTERN.test(text))
  ) {
    return {
      domain: 'child_or_education',
      authorityType: 'family_joint',
      importance: 2,
      reason: 'child_or_education_decision',
    };
  }
  if (
    CARE_PATTERN.test(text) &&
    FAMILY_SUBJECT_PATTERN.test(text) &&
    (DECISION_REQUEST_PATTERN.test(text) ||
      WAITING_RESULT_PATTERN.test(text) ||
      EXPLICIT_COMMITMENT_PATTERN.test(text))
  ) {
    return {
      domain: 'care_arrangement',
      authorityType: 'family_joint',
      importance: 3,
      reason: 'family_care_arrangement',
    };
  }
  if (
    RELATIONSHIP_DECISION_PATTERN.test(text) &&
    (DECISION_REQUEST_PATTERN.test(text) ||
      WAITING_RESULT_PATTERN.test(text) ||
      EXPLICIT_COMMITMENT_PATTERN.test(text))
  ) {
    return {
      domain: 'relationship_conflict',
      authorityType: 'relationship_or_moral',
      importance: /(?:家暴|打人)/u.test(text) ? 3 : 2,
      reason: 'explicit_relationship_decision',
    };
  }
  if (
    (Boolean(dueAt) && CONCRETE_FUTURE_EVENT_PATTERN.test(text)) ||
    (EXPLICIT_PROMISE_PATTERN.test(text) &&
      CONCRETE_FUTURE_EVENT_PATTERN.test(text)) ||
    (WAITING_RESULT_PATTERN.test(text) &&
      CONCRETE_FUTURE_EVENT_PATTERN.test(text))
  ) {
    return {
      domain: 'future_event',
      authorityType: 'ordinary_practical',
      importance: 2,
      reason: WAITING_RESULT_PATTERN.test(text)
        ? 'concrete_unresolved_result'
        : EXPLICIT_PROMISE_PATTERN.test(text)
        ? 'concrete_explicit_commitment'
        : 'concrete_future_event',
    };
  }
  return undefined;
}

function resolveState(options: {
  dueAt?: Date;
  waitingResult: boolean;
  commitment?: string;
  decisionRequested: boolean;
  seriousHealth: boolean;
}): RelationshipOpenLoopState {
  if (options.waitingResult) return 'awaiting_result';
  if (options.dueAt) return 'scheduled_checkpoint';
  if (options.commitment) return 'action_committed';
  if (options.decisionRequested) return 'decision_pending';
  return 'reported';
}

function resolveRelation(options: {
  state: RelationshipOpenLoopState;
  dueAt?: Date;
  commitment?: string;
}): RelationshipOpenLoopRelation | undefined {
  if (options.dueAt) return 'checkpoint';
  if (options.commitment) return 'commitment';
  if (options.state === 'awaiting_result') return 'dependency';
  return undefined;
}

function hasConcreteArrangement(text: string): boolean {
  return (
    Boolean(resolveDueAt(text, new Date())) ||
    /(?:准备|打算|计划|已经定|正在商量|家里商量|要去|要办)/u.test(text)
  );
}

function resolveExpiresAt(options: {
  domain: RelationshipOpenLoopContentDomain;
  importance: 1 | 2 | 3;
  dueAt?: Date;
  sourceOccurredAt: Date;
}): Date | undefined {
  if (options.domain === 'health' && options.importance < 3) {
    return new Date(
      options.sourceOccurredAt.getTime() + 7 * 24 * 60 * 60 * 1000
    );
  }
  if (options.domain === 'health' || options.domain === 'property_or_legal') {
    return undefined;
  }
  if (options.dueAt) {
    return new Date(options.dueAt.getTime() + 30 * 24 * 60 * 60 * 1000);
  }
  if (options.domain === 'funeral_or_memorial') {
    return new Date(
      options.sourceOccurredAt.getTime() + 30 * 24 * 60 * 60 * 1000
    );
  }
  if (options.domain === 'future_event') {
    return new Date(
      options.sourceOccurredAt.getTime() + 30 * 24 * 60 * 60 * 1000
    );
  }
  return undefined;
}

function extractExplicitCommitment(text: string): string | undefined {
  const matched = EXPLICIT_COMMITMENT_PATTERN.exec(text)?.[0];
  return matched?.trim().slice(0, 100) || undefined;
}

function resolveSubject(
  text: string,
  domain: RelationshipOpenLoopContentDomain
): string {
  if (domain === 'property_or_legal') {
    if (/妈妈|母亲|妈/u.test(text)) return '用户家庭与妈妈';
    return '用户家庭';
  }
  if (domain === 'funeral_or_memorial') return '当前亲人及相关家人';
  const matched = FAMILY_SUBJECT_PATTERN.exec(text)?.[0];
  if (matched) return `用户的${matched}`;
  if (domain === 'relationship_conflict') return '用户的亲密关系';
  return '用户';
}

function countDistinctHealthSubjects(text: string): number {
  const subjects = new Set<string>();
  if (
    /(?:我|自己|本人).{0,14}(?:不舒服|身体不好|生病了|病了|发烧了|感冒了|疼得厉害)/u.test(
      text
    )
  ) {
    subjects.add('user');
  }
  const aliases: Array<[string, RegExp]> = [
    ['father', /爸爸|父亲|爸/gu],
    ['mother', /妈妈|母亲|妈/gu],
    ['grandfather', /爷爷|姥爷|外公/gu],
    ['grandmother', /奶奶|姥姥|外婆/gu],
    ['child', /孩子|儿子|女儿/gu],
    ['sibling', /哥哥|姐姐|弟弟|妹妹/gu],
    ['partner', /老公|老婆|丈夫|妻子/gu],
  ];
  for (const [key, pattern] of aliases) {
    if (pattern.test(text)) subjects.add(key);
  }
  return subjects.size;
}

function resolveDueAt(text: string, sourceAt: Date): Date | undefined {
  const base = new Date(sourceAt);
  base.setHours(12, 0, 0, 0);
  if (/大后天/u.test(text)) return addDays(base, 3);
  if (/后天/u.test(text)) return addDays(base, 2);
  if (/明天/u.test(text)) return addDays(base, 1);
  if (/今晚/u.test(text)) return base;
  const daysLater = /(\d{1,2})天后/u.exec(text);
  if (daysLater) return addDays(base, Number(daysLater[1]));
  if (/下周/u.test(text)) return addDays(base, 7);
  if (/下个月/u.test(text)) {
    const next = new Date(base);
    next.setMonth(next.getMonth() + 1);
    return next;
  }
  const monthDay = /(\d{1,2})月(\d{1,2})[日号]/u.exec(text);
  if (monthDay) {
    const result = new Date(
      sourceAt.getFullYear(),
      Number(monthDay[1]) - 1,
      Number(monthDay[2]),
      12
    );
    if (result.getTime() < sourceAt.getTime() - 24 * 60 * 60 * 1000) {
      result.setFullYear(result.getFullYear() + 1);
    }
    return result;
  }
  return undefined;
}

function addDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * 24 * 60 * 60 * 1000);
}

function normalizeText(value: unknown, maxLength: number): string {
  return typeof value === 'string'
    ? value.replace(/\s+/gu, ' ').trim().slice(0, maxLength)
    : '';
}

function stringifyObjectId(value: MongoObjectId | undefined): string {
  if (!value) return '';
  return typeof (value as { toHexString?: () => string }).toHexString ===
    'function'
    ? (value as { toHexString: () => string }).toHexString()
    : String(value);
}
