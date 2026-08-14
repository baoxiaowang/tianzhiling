import type {
  ConversationContentUnit,
  ConversationObjectKind,
  ConversationObjectPlan,
  ConversationReadingAnchor,
} from './reply-intent';

// 内容单元：用户本轮说的"具体的事"，是 L1 内容回声的锚点。
export type ContentUnitKind =
  | 'event'
  | 'scene'
  | 'object'
  | 'person'
  | 'state'
  | 'memory';

export type ContentUnitSource = 'utterance' | 'memory';

export interface ContentUnit {
  kind: ContentUnitKind;
  text: string;
  source: ContentUnitSource;
}

const OBJECT_KIND_TO_CONTENT_KIND: Partial<
  Record<ConversationObjectKind, ContentUnitKind>
> = {
  family: 'person',
  other_person: 'person',
  place: 'scene',
  keepsake: 'object',
  displacement_loss: 'state',
};

// 排除纯情绪/空泛表达，只保留能当"事"来照回的内容。
const EMOTIONAL_FILLER_PATTERN =
  /^(?:想你|想您|好想|特别想|思念|舍不得|念你|难过|难受|痛苦|撑不住|扛不住|害怕|委屈|后悔|愧疚|对不起|抱歉|不怪你)$/;

export function collectContentUnits(options: {
  anchors: ConversationReadingAnchor[];
  objectPlan?: ConversationObjectPlan;
  plannedUnits?: ConversationContentUnit[];
}): ContentUnit[] {
  const units: ContentUnit[] = [];
  const seen = new Set<string>();

  const push = (text: string, kind: ContentUnitKind) => {
    const normalized = text.trim();
    if (!normalized || normalized.length < 2) return;
    if (EMOTIONAL_FILLER_PATTERN.test(normalized)) return;
    const key = normalized;
    if (seen.has(key)) return;
    seen.add(key);
    units.push({ kind, text: normalized, source: 'utterance' });
  };

  for (const unit of options.plannedUnits ?? []) {
    push(unit.text, unit.kind);
  }

  for (const object of options.objectPlan?.objects ?? []) {
    const kind = OBJECT_KIND_TO_CONTENT_KIND[object.kind] ?? 'scene';
    if (object.kind === 'agent' || object.kind === 'user') continue;
    push(object.mention, kind);
  }

  for (const anchor of options.anchors) {
    push(anchor.text, 'state');
  }

  return units.slice(0, 4);
}

export function buildContentUnitPrompt(units: ContentUnit[]): string {
  if (!units.length) return '';

  const items = units.map(unit => `${unit.kind}:"${unit.text}"`).join('、');

  return [
    '本轮用户说了具体的事：' + items + '。',
    '先照着其中一件具体的事回应（比如复述、点出那个画面或物件），再自然带出情绪；不要跳过这些事，直接回"想你、别难过、不怪你"这类空泛安慰。',
  ].join(' ');
}

function normalizeForMatch(text: string): string {
  return text
    .replace(/[\s，。！？、；：,.!?;:'"“”‘’()（）\[\]【】]/g, '')
    .toLowerCase();
}

function splitMatchableFragments(text: string): string[] {
  const clauses = text
    .split(/[\s，。！？、；：,.!?;:'"“”‘’()（）\[\]【】]+/)
    .map(item => normalizeForMatch(item))
    .filter(item => item.length >= 2);

  if (!clauses.length) return [];

  // 短句直接整体匹配；长句还按标点拆成小段，避免要求模型逐字复述整句。
  return clauses.filter(item => item.length >= 2);
}

function longestCommonSubstringLength(left: string, right: string): number {
  const short = left.length <= right.length ? left : right;
  const long = short === left ? right : left;
  const previous = new Array<number>(short.length + 1).fill(0);
  let maxLength = 0;

  for (const longChar of long) {
    for (let index = short.length; index >= 1; index -= 1) {
      if (short[index - 1] === longChar) {
        const next = previous[index - 1] + 1;
        previous[index] = next;
        maxLength = Math.max(maxLength, next);
      } else {
        previous[index] = 0;
      }
    }
  }

  return maxLength;
}

function overlapsReplyMeaningfully(fragment: string, reply: string): boolean {
  const minOverlap = fragment.length <= 6 ? fragment.length : 4;
  return longestCommonSubstringLength(fragment, reply) >= minOverlap;
}

export function findContentUnitEchoes(
  replyText: string,
  units: ContentUnit[]
): ContentUnit[] {
  const reply = normalizeForMatch(replyText);
  if (!reply) return [];

  return units.filter(unit => {
    const fragments = splitMatchableFragments(unit.text);
    return fragments.some(fragment => overlapsReplyMeaningfully(fragment, reply));
  });
}

export function hasContentUnitEcho(
  replyText: string,
  units: ContentUnit[]
): boolean {
  return findContentUnitEchoes(replyText, units).length > 0;
}
