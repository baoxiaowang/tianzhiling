import type { AgentProfileFactSummary } from './agent-profile-fact.service';

export type ProfileFactClass =
  | 'identity_relationship_style'
  | 'episodic_event_preference'
  | 'sensitive_taboo';

type ProfileFact = Pick<AgentProfileFactSummary, 'type' | 'key' | 'value'>;

/** 只用于读侧，不改变事实类型或落库数据；敏感内容优先于身份/风格。 */
export function classifyProfileFact(fact: ProfileFact): ProfileFactClass {
  const key = (fact.key || '').toLowerCase();
  const content = `${key} ${fact.value || ''}`;
  if (
    fact.type === 'taboo' ||
    /(?:^|[._])taboo(?:[._]|$)/.test(key) ||
    /禁忌|不想提|回避|吵架|矛盾/.test(content)
  ) {
    return 'sensitive_taboo';
  }
  if (
    /(?:^|[._])(?:identity|relationship|style|address|preferred_name)(?:[._]|$)/.test(
      key
    ) ||
    /称呼|关系|身份|方言|风格|preferred_name|address/.test(content) ||
    fact.type === 'identity' ||
    fact.type === 'relationship' ||
    fact.type === 'style'
  ) {
    return 'identity_relationship_style';
  }
  if (
    fact.type === 'memory' ||
    fact.type === 'preference' ||
    /(?:^|[._])(?:event|experience|preference|activity|memory|life_experience|shared_memories|hobbies)(?:[._]|$)/.test(
      key
    ) ||
    /事件|经历|偏好|近况|活动|去过|做过|吃过|生病|住院|复查|工作|上学|搬家|旅行/.test(
      content
    )
  ) {
    return 'episodic_event_preference';
  }
  return 'identity_relationship_style';
}

interface WordSegment {
  segment: string;
  isWordLike?: boolean;
}

/** TS 4.8 的项目 lib 尚未声明 Intl.Segmenter；不增加运行时依赖。 */
const Segmenter = (Intl as typeof Intl & {
  Segmenter?: new (
    locale: string,
    options: { granularity: 'word' }
  ) => { segment(text: string): Iterable<WordSegment> };
}).Segmenter;

function contentWords(value: string): string[] {
  // 去掉存储格式的主体前缀，避免“当前用户/角色”等元信息成为话题 cue。
  const text = value
    .toLowerCase()
    .replace(/用户与当前角色|当前角色|当前用户|用户/g, ' ');
  const words: string[] = [];
  if (Segmenter) {
    const segments = Array.from(
      new Segmenter('zh', { granularity: 'word' }).segment(text)
    );
    segments.forEach((item, index) => {
      if (!item.isWordLike) return;
      words.push(item.segment);
      // ICU 会把“接人”拆成“接/人”，合并相邻单字，保留这种短事件 cue。
      const next = segments[index + 1];
      if (
        next?.isWordLike &&
        /^[\u4e00-\u9fff]$/.test(item.segment) &&
        /^[\u4e00-\u9fff]$/.test(next.segment)
      ) {
        words.push(item.segment + next.segment);
      }
    });
  } else {
    // 兼容没有 Segmenter 的旧 Node：仅从原文生成双字交集。
    for (const part of text.match(/[a-z0-9]+|[\u4e00-\u9fff]{2,}/g) || []) {
      words.push(part);
      if (/^[\u4e00-\u9fff]+$/.test(part)) {
        for (let index = 0; index < part.length - 1; index += 1) {
          words.push(part.slice(index, index + 2));
        }
      }
    }
  }
  // 只取事实自身的实词，不使用人物/事件关键词表，也不使用事实 key 触发。
  return words.filter(
    word =>
      word.length >= 2 &&
      !/^(?:我们|你们|他们|她们|自己|以前|之前|当时|现在|今天|昨天|曾经|一起|因为|所以|时候|事情)$/.test(
        word
      )
  );
}

export function shouldInjectProfileFact(
  fact: ProfileFact,
  currentUserText: string
): boolean {
  const factClass = classifyProfileFact(fact);
  if (factClass === 'identity_relationship_style') return true;
  const query = (currentUserText || '').trim().toLowerCase();
  if (!query) return false;
  const factWords = contentWords(fact.value || '');
  const queryWords = new Set(contentWords(query));
  return factWords.some(word => queryWords.has(word));
}
