import type { MemoryOpenItemView } from './memory-module.types';

/**
 * 回归轮（用户隔了一段时间回来）的处理规则：
 * 1) 按间隔把"上一段对话的尾巴"裁短——间隔越长，尾巴越短，位置让给清单和日子；
 * 2) 清单里凡是已经出现在尾巴里的（同一句原话、或同一件事的另一种说法）一律不给，避免重复；
 * 3) 刚问过的也先不给，避免查岗。
 * 这里全是纯函数：不碰存储、不调模型，便于单测与复盘。
 */

export type ReturnTurnTier = 'none' | 'brief' | 'short' | 'long' | 'veryLong';

/** 时间材料从 6 小时开始给；36 小时以上算明确的"隔了一段时间"。 */
export const RETURN_BRIEF_MIN_HOURS = 6;
export const RETURN_SHORT_MIN_HOURS = 36;
/** 超过这些天数，尾巴进一步缩到只留收尾。 */
export const RETURN_LONG_MIN_DAYS = 14;
export const RETURN_VERY_LONG_MIN_DAYS = 30;
/** 上次问过之后这几天内不再给这条，避免同一件事反复问。 */
export const RETURN_RAISE_COOLDOWN_DAYS = 3;
/** 回归轮最多给几条未了结的事、几条日子。 */
export const RETURN_MAX_ITEMS = 5;
export const RETURN_MAX_CALENDAR_ITEMS = 2;

export interface ReturnTurnPlan {
  tier: ReturnTurnTier;
  /** 这一轮实际保留多少条历史消息（0 表示由调用方沿用模式默认值）。 */
  historyLimit: number;
  /**
   * 是否要把清单/日子材料摆给模型。
   * 注意：这不再由"隔了多久"决定——间隔只是时间材料的事；
   * 清单该不该给，只看有没有未了结的事、以及是不是刚问过/已经在上下文里。
   * 保留这个字段只为兼容调用方与被测代码。
   */
  includeItems: boolean;
}

/**
 * 间隔 → 尾巴长度。
 * - 6 小时以内：普通轮，不裁、不给清单；
 * - 6–36 小时：当天同一段关系的延续，尾巴不裁，给清单（去掉尾巴里已有的）；
 * - 36 小时–14 天：只留上一段收尾 6 条；
 * - 14–30 天：留 3 条；
 * - 30 天以上：留 2 条，只够看出"上次是怎么结束的"。
 */
export function resolveReturnTurnPlan(options: {
  elapsedHours?: number;
  elapsedDays?: number;
}): ReturnTurnPlan {
  const hours = Number(options.elapsedHours);
  // 清单不再看间隔：任何一轮都可以拿到（是否合适由模型判断，重复由冷却规则挡）。
  if (!Number.isFinite(hours) || hours < RETURN_BRIEF_MIN_HOURS) {
    return { tier: 'none', historyLimit: 0, includeItems: true };
  }
  if (hours < RETURN_SHORT_MIN_HOURS) {
    return { tier: 'brief', historyLimit: 0, includeItems: true };
  }
  const days = Number.isFinite(Number(options.elapsedDays))
    ? Number(options.elapsedDays)
    : hours / 24;
  if (days < RETURN_LONG_MIN_DAYS) {
    return { tier: 'short', historyLimit: 6, includeItems: true };
  }
  if (days < RETURN_VERY_LONG_MIN_DAYS) {
    return { tier: 'long', historyLimit: 3, includeItems: true };
  }
  return { tier: 'veryLong', historyLimit: 2, includeItems: true };
}

export interface ReturnItemExclusion {
  /** 原话就在这轮的历史消息里，已经能直接看到。 */
  inHistory: MemoryOpenItemView[];
  /** 同一件事的另一种说法已经在这轮的历史里出现。 */
  mentionedInHistory: MemoryOpenItemView[];
  /** 最近刚问过，先不再给。 */
  recentlyRaised: MemoryOpenItemView[];
}

export interface ReturnItemSelection {
  items: MemoryOpenItemView[];
  exclusion: ReturnItemExclusion;
}

/** 规范化文本，用于"这句話是不是已经在历史里出现过"的判断。 */
export function normalizeReturnText(value: string): string {
  return (value || '')
    .replace(/[^\p{Script=Han}\p{L}\p{N}]/gu, '')
    .toLowerCase();
}

/**
 * 从清单里挑出这轮可以摆给模型的条目：
 * 先排除"历史里已经有的"和"刚问过的"，再按更新时间取前几条。
 */
export function selectReturnTurnItems(options: {
  items: MemoryOpenItemView[];
  historyMessageIds: string[];
  historyTexts: string[];
  now: Date;
  maxItems?: number;
  raiseCooldownDays?: number;
}): ReturnItemSelection {
  const historyIds = new Set(options.historyMessageIds || []);
  const historyText = normalizeReturnText(
    (options.historyTexts || []).join('\n')
  );
  const cooldownMs =
    (options.raiseCooldownDays ?? RETURN_RAISE_COOLDOWN_DAYS) *
    24 *
    60 *
    60 *
    1000;
  const maxItems = options.maxItems ?? RETURN_MAX_ITEMS;

  const exclusion: ReturnItemExclusion = {
    inHistory: [],
    mentionedInHistory: [],
    recentlyRaised: [],
  };
  const kept: MemoryOpenItemView[] = [];

  for (const item of options.items || []) {
    if ((item.sourceMessageIds || []).some(id => historyIds.has(id))) {
      exclusion.inHistory.push(item);
      continue;
    }
    const summary = normalizeReturnText(item.summary);
    if (summary.length >= 6 && historyText.includes(summary)) {
      exclusion.mentionedInHistory.push(item);
      continue;
    }
    const lastRaisedAt = item.lastRaisedAt
      ? Date.parse(item.lastRaisedAt)
      : NaN;
    if (
      Number.isFinite(lastRaisedAt) &&
      options.now.getTime() - lastRaisedAt < cooldownMs
    ) {
      exclusion.recentlyRaised.push(item);
      continue;
    }
    kept.push(item);
  }

  kept.sort((left, right) => {
    const leftAt = left.dueAt ? Date.parse(left.dueAt) : NaN;
    const rightAt = right.dueAt ? Date.parse(right.dueAt) : NaN;
    if (
      Number.isFinite(leftAt) &&
      Number.isFinite(rightAt) &&
      leftAt !== rightAt
    ) {
      return leftAt - rightAt;
    }
    return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
  });

  return { items: kept.slice(0, maxItems), exclusion };
}

function describeItemTime(item: MemoryOpenItemView, now: Date): string {
  const at = Date.parse(item.updatedAt);
  if (!Number.isFinite(at)) return '';
  const days = Math.floor((now.getTime() - at) / (24 * 60 * 60 * 1000));
  if (days <= 0) return '今天说的';
  if (days === 1) return '昨天说的';
  if (days < 30) return `${days} 天前说的`;
  return `${Math.floor(days / 30)} 个月前说的`;
}

/**
 * 渲染成几行家常话。只给事实（原话、什么时候说的、什么状态、问过没有），
 * 不排名次、不建议问哪条，并明确允许"都不用"。
 */
export function buildReturnTurnMaterialPrompt(options: {
  plan: ReturnTurnPlan;
  items: MemoryOpenItemView[];
  calendarItems: MemoryOpenItemView[];
  now: Date;
}): string {
  const { plan, items, calendarItems, now } = options;
  if (!plan.includeItems || (!items.length && !calendarItems.length)) {
    return '';
  }

  const lines = ['# 你记得的事'];
  if (items.length) {
    // 实测结论：只把清单摆出来，模型几乎不会主动提（22 个回归场景只提了 2 次）。
    // 所以清单非空时改成"必须用掉一件"——先接住人，再把这件事自然带出来。
    lines.push(
      '（本轮要求：从下面挑一件自然用上——先接住用户这句话，再顺口把这件事带出来；' +
        '像家里人聊天，不要用"结果""进展""跟进"这类词，也不要像在催他。' +
        '只有一种情况可以不用：用户这轮在说很重的痛苦或危险的话，那就先接住他。）'
    );
    // 措辞：只给"用户什么时候说过什么原话"，不给"还没结果""已答应"这类程序状态词——
    // 实测这些词会被原样翻译成"结果出来没"这种机械问法。
    lines.push(
      '（就按下面这些话顺口问一句就行，像家里人聊天，不要用"结果""进展""跟进"这类词。）'
    );
    for (const item of items) {
      const time = describeItemTime(item, now).replace('说的', '');
      const raised =
        item.raisedCount > 0 && item.lastRaisedAt
          ? `上次问过，${describeItemTime(
              { ...item, updatedAt: item.lastRaisedAt },
              now
            ).replace('说的', '')}`
          : '还没提过';
      lines.push(`- 用户${time}说过："${item.summary}"（${raised}）`);
    }
  }
  if (calendarItems.length) {
    lines.push('# 你记得的日子');
    for (const item of calendarItems) {
      lines.push(`- ${item.summary}`);
    }
  }
  return lines.join('\n');
}

/** 这轮实际保留多少条历史：裁到计划里的条数，但不超过模式本身的上限。 */
export function resolveReturnTurnHistoryLimit(options: {
  plan: ReturnTurnPlan;
  modeLimit: number;
}): number {
  if (!options.plan.historyLimit) return options.modeLimit;
  return Math.min(options.modeLimit, options.plan.historyLimit);
}

/** 判断"这次回复"有没有说到某条清单里的事：只看实词（去掉虚词），再看共有的片段。 */
const MENTION_STOPWORDS = new Set(
  '我你他她它的了是在要有会去就又都还这那和跟给对也才把被让到从很着过吗呢吧啊'.split(
    ''
  )
);

function contentOnlyReturnText(value: string): string {
  return normalizeReturnText(value)
    .split('')
    .filter(char => !MENTION_STOPWORDS.has(char))
    .join('');
}

/** 最长公共子串长度（只看实词，用于"回复复述了原话的哪一段"）。 */
export function longestCommonSubstringLength(
  left: string,
  right: string
): number {
  const a = normalizeReturnText(left);
  const b = normalizeReturnText(right);
  if (!a || !b) return 0;
  let best = 0;
  const previous = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = 0;
    for (let j = 1; j <= b.length; j += 1) {
      const saved = previous[j];
      previous[j] = a[i - 1] === b[j - 1] ? diagonal + 1 : 0;
      if (previous[j] > best) best = previous[j];
      diagonal = saved;
    }
  }
  return best;
}

/**
 * 回复提到这条清单的分数（0–1）：把两边的虚词去掉，
 * 共有的实词片段越长、命中的二字实词组合越多，分数越高。
 * 只共有一个虚词般的单字（"事"）不算。
 */
export function scoreOpenItemMention(
  replyText: string,
  itemSummary: string
): number {
  const reply = contentOnlyReturnText(replyText);
  const item = contentOnlyReturnText(itemSummary);
  if (!reply || item.length < 2) return 0;

  const sharedRun = longestCommonSubstringLength(reply, item);
  if (sharedRun >= 4) return 1;

  const grams: string[] = [];
  for (let index = 0; index + 2 <= item.length; index += 1) {
    grams.push(item.slice(index, index + 2));
  }
  if (!grams.length) return sharedRun >= 2 ? 0.6 : 0;

  let hits = 0;
  for (const gram of grams) {
    if (reply.includes(gram)) hits += 1;
  }
  const ratio = hits / grams.length;
  return sharedRun >= 2 ? Math.max(ratio, 0.5) : ratio;
}

/**
 * 两条清单算不算"同一件事"的门槛（也用于写入侧合并条目）。
 * 换个说法、少了个称呼都算同一件；只是恰好都提了"复查"这种同一个词不算。
 */
export const SAME_MATTER_MENTION_SCORE = 0.8;

/**
 * 这一轮回复提到了哪几条清单。主条按 0.5 的老阈值选出来；
 * 其余的只有"跟主条本来就是同一件事"（几乎原文撞上）才一起记账——
 * 一句话里出现两个字的词太容易巧合（"复查""手术"这种词谁都可能说），
 * 不能拿来给一堆不同的条目记"已经问过"，否则它们会一起进 3 天冷却，
 * 反而该问的都不问了。
 * 早先只记最像的那一条：同一件事被拆成两条时，另一条永远不算"问过"，
 * 下一轮又被端上来问一遍。
 */
export function listRaisedOpenItems(options: {
  replyText: string;
  items: MemoryOpenItemView[];
  minScore?: number;
  sameMatterScore?: number;
  limit?: number;
}): Array<{ item: MemoryOpenItemView; score: number }> {
  const minScore = options.minScore ?? 0.5;
  const sameMatterScore = options.sameMatterScore ?? SAME_MATTER_MENTION_SCORE;
  const limit = options.limit ?? 3;
  const scored = (options.items || []).map(item => ({
    item,
    score: scoreOpenItemMention(options.replyText, item.summary),
  }));
  const matched = scored.filter(entry => entry.score >= minScore);
  if (!matched.length) return [];
  matched.sort((left, right) => right.score - left.score);
  const primary = matched[0];
  const rest = matched.filter(
    entry =>
      entry.item.id !== primary.item.id &&
      scoreOpenItemMention(primary.item.summary, entry.item.summary) >=
        sameMatterScore
  );
  return [primary, ...rest].slice(0, limit);
}

/**
 * 这一轮回复到底提了哪一条（最像的一条）。
 * 阈值刻意偏高：宁可少记一次，也不要把无关的话记成"已经问过"，
 * 否则以后该问的就不问了。
 */
export function matchRaisedOpenItem(options: {
  replyText: string;
  items: MemoryOpenItemView[];
  minScore?: number;
}): { item: MemoryOpenItemView; score: number } | undefined {
  return listRaisedOpenItems({ ...options, limit: 1 })[0];
}

/**
 * 隔了一段时间才回来时，给模型一句"用自己的话说说这段时间"的参考。
 * 只给时间跨度和分寸，不给固定句式——"好久不见"这种话一说就假。
 */
export function buildElapsedFeelingInstruction(options: {
  elapsedHours?: number;
}): string {
  const hours = Number(options.elapsedHours);
  if (!Number.isFinite(hours) || hours < RETURN_SHORT_MIN_HOURS) return '';
  // 实测：寒暄本身模型做得比我们写的好；一旦给例句或档位词，它就会照搬成套话
  // （"这几天没动静"就是这么来的）。所以这里只给一句最小提示，跨度由上下文里的
  // "距上一次联系"提供，措辞完全交给模型，并明确"不说也可以"。
  return [
    '# 关于这段间隔',
    '可以自然带一句你对这段时间的惦记（隔了多久看上面的"距上一次联系"），也可以不带；用你自己的话，不要用固定句式或口头禅。',
    '不要带追问或抱怨的语气，也不要把时间跨度直接搬进开场。',
    '如果这轮用户情绪很重，或者间隔很短，就不用提，先接住他说的话。',
    '不许说"我一直看着你、守着你、等着你"这类把自己说成在现实里陪伴的话。',
  ].join('\n');
}
