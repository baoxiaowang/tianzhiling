import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

const QUESTION_PATTERN = /[?？]|(?:你|您).{0,16}(?:吗|呢|没|没有|好不好|行不行)[。！!…\s]*$/u;
const LITERAL_SPLIT_PATTERN = /[\n。！？!?；;]/u;

export interface ReplyRepetitionResult {
  segments: string[];
  removed: string[];
  fallbackApplied: boolean;
}

export function extractRecentAssistantTexts(
  messages: ChatCompletionMessageParam[] | undefined,
  limit = 3
): string[] {
  const texts: string[] = [];
  for (const message of messages || []) {
    if (message.role !== 'assistant') continue;
    const value = contentText(message.content).trim();
    if (value) texts.push(value);
  }
  return texts.slice(-Math.max(1, limit));
}

export function extractLiteralClauses(texts: string[]): string[] {
  const clauses: string[] = [];
  for (const text of texts) {
    for (const part of String(text || '').split(LITERAL_SPLIT_PATTERN)) {
      const clause = part.trim();
      if (clause.length >= 4 && !clauses.includes(clause)) clauses.push(clause);
    }
  }
  return clauses.slice(-8);
}

export function deriveRecentReplyMoves(texts: string[]): string[] {
  return texts.some(text => QUESTION_PATTERN.test(text))
    ? ['generic_question']
    : [];
}

export function removeRepeatedReplySegments(
  segments: string[],
  recentAssistantTexts: string[],
  fallback = '我在，慢慢说。'
): ReplyRepetitionResult {
  const recent = recentAssistantTexts
    .map(normalizeRepeatText)
    .filter(text => text.length >= 8);
  const clauses = extractLiteralClauses(recentAssistantTexts).filter(
    clause => normalizeRepeatText(clause).length >= 6
  );
  const removed: string[] = [];
  const kept = segments.filter(segment => {
    const normalized = normalizeRepeatText(segment);
    if (!normalized) return false;
    const repeated =
      recent.some(
        text =>
          normalized === text ||
          bigramSimilarity(normalized, text) >= 0.82 ||
          normalized.includes(text)
      ) ||
      clauses.some(clause => normalized.includes(normalizeRepeatText(clause)));
    if (repeated) removed.push(segment);
    return !repeated;
  });
  if (!kept.length && segments.length > 0) {
    return {
      segments: [fallback],
      removed,
      fallbackApplied: true,
    };
  }
  return { segments: kept, removed, fallbackApplied: false };
}

export function normalizeRepeatText(value: string): string {
  return String(value || '')
    .replace(/[\s，,。.!！?？、；;：:]+/gu, '')
    .trim();
}

function bigramSimilarity(left: string, right: string): number {
  if (!left || !right) return 0;
  if (left === right) return 1;
  const leftBigrams = bigrams(left);
  const rightBigrams = bigrams(right);
  if (!leftBigrams.size || !rightBigrams.size) return 0;
  let overlap = 0;
  for (const gram of leftBigrams) {
    if (rightBigrams.has(gram)) overlap += 1;
  }
  return (2 * overlap) / (leftBigrams.size + rightBigrams.size);
}

function bigrams(value: string): Set<string> {
  const set = new Set<string>();
  for (let index = 0; index < value.length - 1; index += 1) {
    set.add(value.slice(index, index + 2));
  }
  return set;
}

function contentText(content: ChatCompletionMessageParam['content']): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map(part => {
        if (typeof part === 'string') return part;
        return typeof part?.text === 'string' ? part.text : '';
      })
      .join('');
  }
  return '';
}
