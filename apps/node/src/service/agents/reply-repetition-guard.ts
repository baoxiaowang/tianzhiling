import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';

const QUESTION_PATTERN =
  /[?？]|(?:你|您).{0,16}(?:吗|呢|没|没有|好不好|行不行)[。！!…\s]*$/u;
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

/** Whole replies only: quoting an old clause is not evidence of repetition. */
export function isExactRepeatedReply(
  segments: string[],
  messages: ChatCompletionMessageParam[]
): boolean {
  const replies: string[] = [];
  let current: string[] = [];
  for (const message of messages || []) {
    if (message.role === 'assistant') {
      current.push(contentText(message.content));
    } else if (current.length) {
      replies.push(current.join('\n'));
      current = [];
    }
  }
  if (current.length) replies.push(current.join('\n'));
  const candidate = normalizeRepeatText(segments.join('\n'));
  return (
    candidate.length >= 8 &&
    replies.slice(-3).some(reply => normalizeRepeatText(reply) === candidate)
  );
}

export function normalizeRepeatText(value: string): string {
  return String(value || '')
    .replace(/[\s，,。.!！?？、；;：:]+/gu, '')
    .trim();
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
