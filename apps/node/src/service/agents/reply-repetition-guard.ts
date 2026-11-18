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

// ICU word segmentation avoids a hand-maintained vocabulary or stop-word list.
const questionSegmenter = new (
  Intl as unknown as {
    Segmenter: new (
      locale: string,
      options: { granularity: string }
    ) => {
      segment(value: string): Iterable<{
        segment: string;
        isWordLike: boolean;
      }>;
    };
  }
).Segmenter('zh', { granularity: 'word' });

export function isSameQuestionIdentity(a: string, b: string): boolean {
  if (!/[?？]/u.test(a) || !/[?？]/u.test(b)) return false;
  // Compare complete question clauses; a quote followed by an explanation is
  // not itself another occurrence of the quoted question.
  if (!isQuestionOnly(a) || !isQuestionOnly(b)) return false;
  const words = (value: string) =>
    new Set(
      Array.from(questionSegmenter.segment(value.toLowerCase()))
        .filter(part => part.isWordLike)
        .map(part => part.segment)
    );
  const left = words(a);
  const right = words(b);
  const shorter = Math.min(left.size, right.size);
  if (!shorter) return false;
  return [...left].filter(word => right.has(word)).length / shorter >= 0.6;
}

function isQuestionOnly(value: string): boolean {
  const clauses = value.trim().match(/[^。！？!?；;\n]+[。！？!?；;\n]*/gu);
  return Boolean(
    clauses?.length === 1 && /[?？]\s*$/u.test(clauses[0])
  );
}

export function suppressRepeatedQuestions(
  segments: string[],
  messages: ChatCompletionMessageParam[]
): ReplyRepetitionResult {
  const recent = extractRecentAssistantTexts(messages);
  const removed: string[] = [];
  const kept = segments.filter(segment => {
    const repeated = recent.some(text =>
      (text.match(/[^。！？!?；;\n]+[?？]/gu) || []).some(question =>
        isSameQuestionIdentity(segment, question)
      )
    );
    if (repeated) removed.push(segment);
    return !repeated;
  });
  const fallbackApplied = removed.length > 0 && kept.length === 0;
  return {
    segments: fallbackApplied ? ['好，这个问题就先放下。'] : kept,
    removed,
    fallbackApplied,
  };
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
