import {
  ConversationChatImportConfidence,
  ConversationChatImportSpeaker,
  ConversationChatImportTimePrecision,
} from '@tzl/entities';
import { createHash } from 'crypto';

export interface ChatImportSortableItem {
  id?: unknown;
  screenshotSequence: number;
  bubbleSequence: number;
  speaker: ConversationChatImportSpeaker;
  content: string;
  rawTimeText?: string;
  occurredAt?: Date;
  timePrecision: ConversationChatImportTimePrecision;
  timeConfidence: ConversationChatImportConfidence;
  recognitionConfidence: number;
  fingerprint?: string;
  isDuplicate?: boolean;
}

export interface ExistingChatImportComparableItem {
  speaker: ConversationChatImportSpeaker;
  content: string;
  rawTimeText?: string;
  occurredAt?: Date;
  sourceSequence?: number;
}

export interface ChatImportLanguageStatistics {
  messageCount: number;
  dayCount: number;
  averageLength: number;
  medianLength: number;
  lowerLength: number;
  upperLength: number;
  shortMessageRatio: number;
  questionRatio: number;
  exclamationRatio: number;
  repeatedPunctuationRatio: number;
  commonEndings: string[];
  commonModalParticles: string[];
  commonPhrases: string[];
  replyCount: number;
  averageReplyBubbleCount: number;
  medianReplyBubbleCount: number;
  maxReplyBubbleCount: number;
  multiBubbleReplyRatio: number;
}

export function normalizeChatImportText(value: unknown): string {
  return typeof value === 'string'
    ? value
        .replace(/[\r\n\t]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 2000)
    : '';
}

export function buildChatImportFingerprint(
  item: Pick<
    ChatImportSortableItem,
    'speaker' | 'content' | 'occurredAt' | 'rawTimeText'
  >
): string {
  const timeKey = item.occurredAt
    ? item.occurredAt.toISOString().slice(0, 16)
    : normalizeChatImportText(item.rawTimeText).toLowerCase();
  const textKey = normalizeChatImportText(item.content)
    .toLowerCase()
    .replace(/[\s，。！？、；：,.!?;:]+/g, '');

  return createHash('sha1')
    .update(`${item.speaker}|${timeKey}|${textKey}`)
    .digest('hex');
}

export function markDuplicateChatImportItems<T extends ChatImportSortableItem>(
  items: T[]
): T[] {
  const byScreenshot = new Map<number, T[]>();

  for (const item of items) {
    item.fingerprint = item.fingerprint || buildChatImportFingerprint(item);
    item.isDuplicate = false;
    const screenshotItems = byScreenshot.get(item.screenshotSequence) || [];
    screenshotItems.push(item);
    byScreenshot.set(item.screenshotSequence, screenshotItems);
  }

  const screenshotGroups = [...byScreenshot.entries()]
    .sort(([left], [right]) => left - right)
    .map(([screenshotSequence, screenshotItems]) => ({
      screenshotSequence,
      items: screenshotItems.sort(
        (left, right) => left.bubbleSequence - right.bubbleSequence
      ),
    }));

  for (let index = 1; index < screenshotGroups.length; index += 1) {
    const previous = screenshotGroups[index - 1];
    const current = screenshotGroups[index];

    if (current.screenshotSequence - previous.screenshotSequence !== 1) {
      continue;
    }

    const overlapLength = findAdjacentScreenshotOverlap(
      previous.items,
      current.items
    );

    for (let offset = 0; offset < overlapLength; offset += 1) {
      const previousItem =
        previous.items[previous.items.length - overlapLength + offset];
      const currentItem = current.items[offset];
      const previousScore = previousItem.recognitionConfidence || 0;
      const currentScore = currentItem.recognitionConfidence || 0;

      if (currentScore > previousScore) {
        previousItem.isDuplicate = true;
      } else {
        currentItem.isDuplicate = true;
      }
    }
  }

  return sortChatImportItems(items);
}

/**
 * Marks a previously imported, contiguous conversation segment as duplicate.
 *
 * A single repeated short reply is deliberately not enough evidence: people
 * really do say “嗯” or “好” more than once. Cross-batch matching therefore
 * requires either an exact multi-message batch match, a sufficiently strong
 * multi-message run, or one longer message with the same explicit time.
 */
export function markPreviouslyImportedChatItems<
  T extends ChatImportSortableItem
>(items: T[], existingGroups: ExistingChatImportComparableItem[][]): T[] {
  const incoming = sortChatImportItems(items).filter(item => !item.isDuplicate);

  for (const rawGroup of existingGroups) {
    const existing = [...rawGroup].sort(
      (left, right) => (left.sourceSequence ?? 0) - (right.sourceSequence ?? 0)
    );

    for (
      let incomingStart = 0;
      incomingStart < incoming.length;
      incomingStart += 1
    ) {
      for (
        let existingStart = 0;
        existingStart < existing.length;
        existingStart += 1
      ) {
        let length = 0;

        while (
          incomingStart + length < incoming.length &&
          existingStart + length < existing.length &&
          isContiguousExistingSequence(existing, existingStart, length) &&
          isSameOverlapMessage(
            incoming[incomingStart + length],
            existing[existingStart + length]
          )
        ) {
          length += 1;
        }

        if (
          !isStrongPreviouslyImportedMatch(
            incoming,
            existing,
            incomingStart,
            existingStart,
            length
          )
        ) {
          continue;
        }

        for (let offset = 0; offset < length; offset += 1) {
          incoming[incomingStart + offset].isDuplicate = true;
        }
      }
    }
  }

  return sortChatImportItems(items);
}

function isContiguousExistingSequence(
  items: ExistingChatImportComparableItem[],
  start: number,
  offset: number
): boolean {
  if (offset === 0) {
    return true;
  }

  const previous = items[start + offset - 1].sourceSequence;
  const current = items[start + offset].sourceSequence;
  return (
    previous === undefined || current === undefined || current === previous + 1
  );
}

function isStrongPreviouslyImportedMatch(
  incoming: ChatImportSortableItem[],
  existing: ExistingChatImportComparableItem[],
  incomingStart: number,
  existingStart: number,
  length: number
): boolean {
  if (length <= 0) {
    return false;
  }

  const exactMultiMessageBatch =
    length >= 2 &&
    incomingStart === 0 &&
    existingStart === 0 &&
    length === incoming.length &&
    length === existing.length;
  if (exactMultiMessageBatch) {
    return true;
  }

  const visibleLength = incoming
    .slice(incomingStart, incomingStart + length)
    .reduce(
      (total, item) =>
        total + countVisibleCharacters(normalizeChatImportText(item.content)),
      0
    );

  if (length >= 3 && visibleLength >= 8) {
    return true;
  }

  if (length >= 2 && visibleLength >= 16) {
    return true;
  }

  return (
    length === 1 &&
    visibleLength >= 8 &&
    hasMatchingExplicitTime(incoming[incomingStart], existing[existingStart])
  );
}

function findAdjacentScreenshotOverlap<T extends ChatImportSortableItem>(
  previousItems: T[],
  currentItems: T[]
): number {
  const maximum = Math.min(previousItems.length, currentItems.length, 12);

  for (let length = maximum; length >= 1; length -= 1) {
    const previousStart = previousItems.length - length;
    const matches = Array.from({ length }, (_, offset) =>
      isSameOverlapMessage(
        previousItems[previousStart + offset],
        currentItems[offset]
      )
    ).every(Boolean);

    if (!matches) {
      continue;
    }

    if (length >= 2) {
      return length;
    }

    const previous = previousItems[previousStart];
    const current = currentItems[0];
    const visibleLength = countVisibleCharacters(
      normalizeChatImportText(previous.content)
    );

    if (visibleLength >= 8 && hasMatchingExplicitTime(previous, current)) {
      return 1;
    }
  }

  return 0;
}

function isSameOverlapMessage(
  left: Pick<
    ChatImportSortableItem,
    'speaker' | 'content' | 'occurredAt' | 'rawTimeText'
  >,
  right: Pick<
    ChatImportSortableItem,
    'speaker' | 'content' | 'occurredAt' | 'rawTimeText'
  >
): boolean {
  return (
    left.speaker === right.speaker &&
    normalizeComparableText(left.content) ===
      normalizeComparableText(right.content) &&
    areTimesCompatible(left, right)
  );
}

function normalizeComparableText(value: string): string {
  return normalizeChatImportText(value)
    .toLowerCase()
    .replace(/[\s，。！？、；：,.!?;:]+/g, '');
}

function areTimesCompatible(
  left: Pick<ChatImportSortableItem, 'occurredAt' | 'rawTimeText'>,
  right: Pick<ChatImportSortableItem, 'occurredAt' | 'rawTimeText'>
): boolean {
  if (left.occurredAt && right.occurredAt) {
    return (
      Math.abs(left.occurredAt.getTime() - right.occurredAt.getTime()) <= 60_000
    );
  }

  const leftRaw = normalizeChatImportText(left.rawTimeText).toLowerCase();
  const rightRaw = normalizeChatImportText(right.rawTimeText).toLowerCase();

  return !leftRaw || !rightRaw || leftRaw === rightRaw;
}

function hasMatchingExplicitTime(
  left: Pick<ChatImportSortableItem, 'occurredAt' | 'rawTimeText'>,
  right: Pick<ChatImportSortableItem, 'occurredAt' | 'rawTimeText'>
): boolean {
  if (left.occurredAt && right.occurredAt) {
    return (
      Math.abs(left.occurredAt.getTime() - right.occurredAt.getTime()) <= 60_000
    );
  }

  const leftRaw = normalizeChatImportText(left.rawTimeText).toLowerCase();
  const rightRaw = normalizeChatImportText(right.rawTimeText).toLowerCase();
  return Boolean(leftRaw && rightRaw && leftRaw === rightRaw);
}

export function sortChatImportItems<T extends ChatImportSortableItem>(
  items: T[]
): T[] {
  return [...items].sort(
    (left, right) =>
      left.screenshotSequence - right.screenshotSequence ||
      left.bubbleSequence - right.bubbleSequence
  );
}

export function analyzeChatImportLanguage(
  messages: Array<{
    content: string;
    occurredAt?: Date;
    speaker?: ConversationChatImportSpeaker;
  }>
): ChatImportLanguageStatistics {
  const agentMessages = messages.filter(
    item =>
      item.speaker === undefined ||
      item.speaker === ConversationChatImportSpeaker.agent
  );
  const contents = agentMessages
    .map(item => normalizeChatImportText(item.content))
    .filter(Boolean);
  const lengths = contents.map(countVisibleCharacters).sort((a, b) => a - b);
  const total = Math.max(contents.length, 1);
  const commonEndings = countTokens(
    contents
      .map(
        content =>
          content.match(
            /([啊呀呢吧嘛啦哦哈哎哟喽诶嗯呐呗哒咯唉]{1,3})[。！？!?~～]*$/
          )?.[1]
      )
      .filter((value): value is string => Boolean(value))
  );
  const commonPhrases = countTokens(
    contents.reduce<string[]>(
      (phrases, content) =>
        phrases.concat(
          (content.match(/[\u3400-\u9fff]{2,6}/g) || []).filter(
            token => !COMMON_PHRASE_STOP_WORDS.has(token)
          )
        ),
      []
    )
  );
  const replyBubbleCounts = buildReplyBubbleCounts(messages);
  const sortedReplyBubbleCounts = [...replyBubbleCounts].sort((a, b) => a - b);
  const replyTotal = Math.max(replyBubbleCounts.length, 1);

  return {
    messageCount: contents.length,
    dayCount: new Set(
      agentMessages
        .map(item => item.occurredAt?.toISOString().slice(0, 10))
        .filter(Boolean)
    ).size,
    averageLength: round(
      lengths.reduce((sum, length) => sum + length, 0) / total
    ),
    medianLength: percentile(lengths, 0.5),
    lowerLength: percentile(lengths, 0.25),
    upperLength: percentile(lengths, 0.75),
    shortMessageRatio: ratio(
      lengths.filter(length => length <= 15).length,
      total
    ),
    questionRatio: ratio(
      contents.filter(content => /[？?]/.test(content)).length,
      total
    ),
    exclamationRatio: ratio(
      contents.filter(content => /[！!]/.test(content)).length,
      total
    ),
    repeatedPunctuationRatio: ratio(
      contents.filter(content => /([！？!?~～])\1+/.test(content)).length,
      total
    ),
    commonEndings: commonEndings.slice(0, 5),
    commonModalParticles: commonEndings.slice(0, 5),
    commonPhrases: commonPhrases.slice(0, 8),
    replyCount: replyBubbleCounts.length,
    averageReplyBubbleCount: round(
      replyBubbleCounts.reduce((sum, count) => sum + count, 0) / replyTotal
    ),
    medianReplyBubbleCount: percentile(sortedReplyBubbleCounts, 0.5),
    maxReplyBubbleCount:
      sortedReplyBubbleCounts[sortedReplyBubbleCounts.length - 1] || 0,
    multiBubbleReplyRatio: ratio(
      replyBubbleCounts.filter(count => count >= 2).length,
      replyTotal
    ),
  };
}

function buildReplyBubbleCounts(
  messages: Array<{ content: string; speaker?: ConversationChatImportSpeaker }>
): number[] {
  if (!messages.some(item => item.speaker !== undefined)) {
    return messages
      .map(item => normalizeChatImportText(item.content))
      .filter(Boolean)
      .map(() => 1);
  }

  const counts: number[] = [];
  let currentCount = 0;

  for (const message of messages) {
    const hasContent = Boolean(normalizeChatImportText(message.content));
    if (hasContent && message.speaker === ConversationChatImportSpeaker.agent) {
      currentCount += 1;
      continue;
    }

    if (currentCount) {
      counts.push(currentCount);
      currentCount = 0;
    }
  }

  if (currentCount) {
    counts.push(currentCount);
  }

  return counts;
}

function countVisibleCharacters(value: string): number {
  return Array.from(value.replace(/\s+/g, '')).length;
}

function percentile(values: number[], target: number): number {
  if (!values.length) {
    return 0;
  }

  const index = Math.min(
    values.length - 1,
    Math.max(0, Math.round((values.length - 1) * target))
  );
  return values[index];
}

function ratio(value: number, total: number): number {
  return round(value / Math.max(total, 1));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function countTokens(values: string[]): string[] {
  const counts = new Map<string, number>();

  for (const value of values) {
    const normalized = value.trim();
    if (!normalized) {
      continue;
    }
    counts.set(normalized, (counts.get(normalized) || 0) + 1);
  }

  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .sort(
      (left, right) => right[1] - left[1] || left[0].localeCompare(right[0])
    )
    .map(([value]) => value);
}

const COMMON_PHRASE_STOP_WORDS = new Set([
  '这个',
  '那个',
  '什么',
  '怎么',
  '就是',
  '可以',
  '没有',
  '还是',
  '不是',
  '知道',
]);
