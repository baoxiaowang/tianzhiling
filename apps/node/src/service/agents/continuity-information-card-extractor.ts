import { MessageEntity, MongoObjectId } from '@tzl/entities';
import {
  buildContinuityInformationCard,
  ContinuityEventDraft,
  ContinuityInformationCard,
  shouldAttemptContinuityEventCapture,
} from './continuity-information-card';

export interface HistoricalContinuityMessageInput {
  message: MessageEntity;
  text: string;
}

interface ExtractedEventItem {
  sourceMessageId: string;
  draft: ContinuityEventDraft;
  latestEvidenceMessageId?: string;
  latestEvidenceAt?: Date;
  status?: 'resolved';
}

const MAX_CAPTURE_TEXT_LENGTH = 360;
const SERIOUS_HEALTH_PATTERN =
  /(?:住院|手术|癌|肿瘤|化疗|重病|挺严重|很严重|病危|抢救|ICU|重症|长期|一直不好)/u;
const DURABLE_CHANGE_PATTERN =
  /(?:结婚|离婚|怀孕|生了|添了|去世|走了|葬礼|退休|搬家|移民)/u;

export function extractContinuityInformationCards(options: {
  inputs: HistoricalContinuityMessageInput[];
  now?: Date;
}): ContinuityInformationCard[] {
  const now = options.now ?? new Date();
  const extracted = extractEvents(options.inputs);
  const messagesById = new Map(
    options.inputs.map(input => [
      stringifyObjectId(input.message.id),
      input.message,
    ])
  );
  const ordinalByMessage = new Map<string, number>();
  return extracted
    .map(item => {
      const message = messagesById.get(item.sourceMessageId);
      if (!message) return undefined;
      const ordinal = ordinalByMessage.get(item.sourceMessageId) ?? 0;
      ordinalByMessage.set(item.sourceMessageId, ordinal + 1);
      const card = buildContinuityInformationCard({
        draft: item.draft,
        sourceMessageId: item.sourceMessageId,
        sourceOccurredAt: message.sourceOccurredAt ?? message.createdAt,
        now,
        ordinal,
      });
      if (!card) return undefined;
      return {
        ...card,
        ...(item.latestEvidenceMessageId
          ? { latestEvidenceMessageId: item.latestEvidenceMessageId }
          : {}),
        ...(item.latestEvidenceAt
          ? { latestEvidenceAt: item.latestEvidenceAt }
          : {}),
        ...(item.status ? { status: item.status } : {}),
      };
    })
    .filter((card): card is ContinuityInformationCard => Boolean(card));
}

export function shouldInspectHistoricalContinuityMessage(
  text: string
): boolean {
  return (
    shouldAttemptContinuityEventCapture(text) ||
    /(?:挺严重|很严重|比较严重|病危|进了ICU|进ICU|要手术|需要手术|好多了|好起来了|康复了|出院了|没事了|恢复了|结果出来了|通知来了|通过了|没通过|录取了)/u.test(
      text
    )
  );
}

function extractEvents(
  inputs: HistoricalContinuityMessageInput[]
): ExtractedEventItem[] {
  const extracted: ExtractedEventItem[] = [];
  for (const input of inputs) {
    const severityUpdate =
      /(?:挺严重|很严重|比较严重|病危|进了ICU|进ICU|要手术|需要手术)/u.test(
        input.text
      );
    const healthResolved =
      /(?:已经|现在|后来)?(?:好多了|好起来了|康复了|出院了|没事了|恢复了)/u.test(
        input.text
      );
    const resultResolved =
      /(?:结果|通知).{0,8}(?:出来了|出了|收到了)|(?:通过了|没通过|录取了)/u.test(
        input.text
      );
    if (severityUpdate || healthResolved || resultResolved) {
      const prior = [...extracted]
        .reverse()
        .find(item =>
          resultResolved
            ? item.draft.eventKind === 'result_pending'
            : item.draft.eventKind === 'health' ||
              item.draft.eventKind === 'family_health'
        );
      if (prior) {
        prior.latestEvidenceMessageId = stringifyObjectId(input.message.id);
        prior.latestEvidenceAt =
          input.message.sourceOccurredAt ?? input.message.createdAt;
        if (severityUpdate) {
          prior.draft.summary =
            `${prior.draft.summary}；用户后续说明情况严重`.slice(0, 120);
          prior.draft.retentionPolicy = 'until_resolved';
          prior.draft.importance = 3;
        } else {
          prior.status = 'resolved';
        }
        continue;
      }
    }
    if (shouldAttemptContinuityEventCapture(input.text)) {
      extracted.push(...buildDeterministicEvents(input));
    }
  }
  return extracted;
}

function buildDeterministicEvents(
  input: HistoricalContinuityMessageInput
): ExtractedEventItem[] {
  const text = input.text
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, MAX_CAPTURE_TEXT_LENGTH);
  const sourceMessageId = stringifyObjectId(input.message.id);
  const sourceAt = input.message.sourceOccurredAt ?? input.message.createdAt;
  const subject = resolveEventSubject(text);
  const pendingResultMatched =
    /(?:检查|化验|考试|面试|申请|手术).{0,24}(?:等结果|还没结果|等通知|没通知)|(?:等结果|等通知|还没出|还没定)/u.test(
      text
    );
  if (pendingResultMatched) {
    return [
      {
        sourceMessageId,
        draft: {
          summary: text.slice(0, 100),
          subject,
          eventKind: 'result_pending',
          timeScope: 'ongoing',
          retentionPolicy: 'until_resolved',
          importance: 2,
        },
      },
    ];
  }
  const futureMatched =
    /(?:明天|后天|大后天|下周|下个月|周末|过几天|\d{1,2}天后|\d{1,2}月\d{1,2}[日号]|到时候|准备|打算|计划|要去|要做|将要).{0,40}(?:考试|面试|开学|毕业|复查|检查|手术|出院|出差|旅行|回家|搬家|见面|办事|结果|通知|活动|上班|报到)/u.test(
      text
    );
  if (futureMatched) {
    const eventAt = resolveRelativeEventAt(text, sourceAt);
    return [
      {
        sourceMessageId,
        draft: {
          summary: text.slice(0, 100),
          subject,
          eventKind: 'future_event',
          timeScope: 'future',
          retentionPolicy: eventAt ? 'event_window' : 'short_7d',
          importance: 2,
          ...(eventAt ? { eventAt } : {}),
        },
      },
    ];
  }
  const healthMatched =
    /(?:生病|病了|不舒服|发烧|咳嗽|疼|住院|出院|手术|复查|检查|化疗|康复|受伤|去医院|看医生)/u.test(
      text
    );
  if (healthMatched) {
    const serious = SERIOUS_HEALTH_PATTERN.test(text);
    return [
      {
        sourceMessageId,
        draft: {
          summary: text.slice(0, 100),
          subject,
          eventKind: subject === '用户' ? 'health' : 'family_health',
          timeScope: /(?:最近|这几天|一直|还在|现在)/u.test(text)
            ? 'ongoing'
            : 'current',
          retentionPolicy: serious ? 'until_resolved' : 'transient_3d',
          importance: serious ? 3 : 2,
        },
      },
    ];
  }
  if (
    DURABLE_CHANGE_PATTERN.test(text) &&
    !/(?:你|您).{0,6}(?:去世|走了)|(?:去世|走了).{0,6}(?:你|您)/u.test(text)
  ) {
    return [
      {
        sourceMessageId,
        draft: {
          summary: text.slice(0, 100),
          subject: '用户家庭',
          eventKind: 'life_change',
          timeScope: /(?:明天|后天|下周|下个月|准备|要)/u.test(text)
            ? 'future'
            : 'past',
          retentionPolicy: 'durable',
          importance: 3,
        },
      },
    ];
  }
  const recentEventMatched =
    /(?:前天|昨天|刚才|刚刚|上周|最近|这几天).{0,48}(?:发生|去了|回来|摔|受伤|考试|面试|吵架|搬|辞职|出差|旅行|出事)/u.test(
      text
    );
  return recentEventMatched
    ? [
        {
          sourceMessageId,
          draft: {
            summary: text.slice(0, 100),
            subject,
            eventKind: 'recent_event',
            timeScope: 'past',
            retentionPolicy: 'short_7d',
            importance: 2,
          },
        },
      ]
    : [];
}

function resolveRelativeEventAt(
  text: string,
  sourceAt: Date
): Date | undefined {
  const start = new Date(sourceAt);
  start.setHours(12, 0, 0, 0);
  if (/大后天/u.test(text)) return new Date(start.getTime() + 3 * 86400000);
  if (/后天/u.test(text)) return new Date(start.getTime() + 2 * 86400000);
  if (/明天/u.test(text)) return new Date(start.getTime() + 86400000);
  const daysLater = /(\d{1,2})天后/u.exec(text);
  if (daysLater) {
    return new Date(start.getTime() + Number(daysLater[1]) * 86400000);
  }
  if (/下周/u.test(text)) return new Date(start.getTime() + 7 * 86400000);
  if (/下个月/u.test(text)) {
    const next = new Date(start);
    next.setMonth(next.getMonth() + 1);
    return next;
  }
  const monthDay = /(?:(\d{1,2})月(\d{1,2})[日号])/.exec(text);
  if (!monthDay) return undefined;
  const parsed = new Date(
    sourceAt.getFullYear(),
    Number(monthDay[1]) - 1,
    Number(monthDay[2]),
    12
  );
  if (parsed.getTime() < sourceAt.getTime() - 86400000) {
    parsed.setFullYear(parsed.getFullYear() + 1);
  }
  return parsed;
}

function resolveEventSubject(text: string): string {
  const family =
    /(?:爸爸|父亲|妈妈|母亲|爸|妈|爷爷|奶奶|姥姥|姥爷|外公|外婆|孩子|儿子|女儿|哥哥|姐姐|弟弟|妹妹|老公|老婆|丈夫|妻子)/u.exec(
      text
    )?.[0];
  return family ? `用户的${family}` : '用户';
}

function stringifyObjectId(value: MongoObjectId | undefined): string {
  if (!value) return '';
  return typeof (value as { toHexString?: () => string }).toHexString ===
    'function'
    ? (value as { toHexString: () => string }).toHexString()
    : String(value);
}
