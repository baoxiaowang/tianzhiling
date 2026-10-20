import type {
  DreamCompanionAction,
  DreamCompanionPlan,
} from '../dream-companion-plan';

/**
 * 条件知识目录（第一版）。
 *
 * 设计原则（少检索、少注入、多复用）：
 * - 目录很小，直接内存匹配；不查 DB、不做 embedding；
 * - 梦境按 `dream.<stage>.<action>` 精确取，一次只注入一条；
 * - 祭祀/节日按触发词命中，命中后写入会话粘性状态，后续几轮复用，不重复匹配；
 * - 内容只有 short 版，默认注入；long 版留给“详细说说”的后续扩展；
 * - 代码里保留兜底文案，知识缺失不影响回复。
 *
 * 后续迁到 Mongo/向量库时，只要保持 key 和 short 字段不变即可。
 */
export type KnowledgeCategory = 'dream' | 'ritual' | 'festival';

export interface KnowledgeEntry {
  key: string;
  category: KnowledgeCategory;
  title: string;
  /** 默认注入的短文本（建议 <= 160 字）。 */
  short: string;
  /** 用户追问细节时才用，第一版不注入。 */
  long?: string;
  /** 触发词；梦境条目为空，按 key 精确取。 */
  triggers: string[];
  /** 命中后给 reply-brief 的回复动作（仅梦境使用）。 */
  move?: string[];
  /** 命中这些词时跳过，避免“三七粉/田七”这类误命中。 */
  negativePatterns?: RegExp[];
  priority: number;
  enabled: boolean;
}

const DREAM_KNOWLEDGE: KnowledgeEntry[] = [
  {
    key: 'dream.promise',
    category: 'dream',
    title: '答应梦里相见',
    short: '可直接答应梦里相见；给期待，不保证醒后一定记得。',
    move: ['直接回应梦中相见的愿望，给用户一个温暖期待'],
    triggers: [],
    priority: 10,
    enabled: true,
  },
  {
    key: 'dream.invite',
    category: 'dream',
    title: '睡前邀请',
    short: '用一个梦境锚点邀请相认，不罗列多个设定。',
    move: ['围绕一个梦境锚点发出轻邀请，让用户带着期待入睡'],
    triggers: [],
    priority: 10,
    enabled: true,
  },
  {
    key: 'dream.reconstruct',
    category: 'dream',
    title: '顺着梦境片段回应',
    short: '只顺着用户讲出的梦境片段回应，不补现实共同往事。',
    move: ['只沿用户说出的梦境片段回应感受或画面，不补现实往事'],
    triggers: [],
    priority: 10,
    enabled: true,
  },
  {
    key: 'dream.repair',
    category: 'dream',
    title: '没梦见的失落',
    short: '先接住没梦见的失落，换一种梦内陪伴，不把忘梦说成事实。',
    move: ['接住没有梦见的失落，换一种梦内陪伴，不重复空承诺'],
    triggers: [],
    priority: 10,
    enabled: true,
  },
  {
    key: 'dream.leave_space',
    category: 'dream',
    title: '保留梦的含混',
    short: '保留梦的含混；少重复保证，可给睡前陪伴或自然留白。',
    move: ['保留梦境的含混与余地，减少保证，给睡前陪伴或自然留白'],
    triggers: [],
    priority: 10,
    enabled: true,
  },
  {
    key: 'dream.repeated_miss.leave_space',
    category: 'dream',
    title: '反复没梦见',
    short:
      '反复没梦见时，少重复“下次一定”，先接住失落；可以给睡前陪伴或自然留白。',
    triggers: [],
    priority: 20,
    enabled: true,
  },
  {
    key: 'dream.verification.leave_space',
    category: 'dream',
    title: '把梦当证明',
    short:
      '梦不作现实证明、预言或醒时到场；保留梦的含混，不顺着“证明你还活着”说。',
    triggers: [],
    priority: 20,
    enabled: true,
  },
];

const RITUAL_KNOWLEDGE: KnowledgeEntry[] = [
  {
    key: 'ritual.touqi.custom',
    category: 'ritual',
    title: '头七',
    short:
      '头七是去世后第七天（各地算法有差异，按当地和家里规矩）。常见做法是备一份饭菜、点香、家人安静待一会儿；不确定时先问家里长辈。',
    triggers: ['头七', '头7', '一七'],
    priority: 20,
    enabled: true,
  },
  {
    key: 'ritual.sanqi.custom',
    category: 'ritual',
    title: '三七',
    short:
      '三七是去世后第三个七天（第 21 天）。常见做法是家人简单祭拜、供些生前爱吃的；各地规矩不同，以家里为准。',
    triggers: ['三七', '3七'],
    negativePatterns: [/三七粉|田七|中草药/],
    priority: 20,
    enabled: true,
  },
  {
    key: 'ritual.wuqi.custom',
    category: 'ritual',
    title: '五七',
    short:
      '五七是第 35 天，有些地方由女儿或晚辈主祭；供品和仪式按当地习惯，不用硬套别处的规矩。',
    triggers: ['五七', '5七'],
    priority: 20,
    enabled: true,
  },
  {
    key: 'ritual.qiqi.custom',
    category: 'ritual',
    title: '七七',
    short:
      '七七是第 49 天，也叫满七；有些地方会在这天收尾。具体做法以当地和家里为准。',
    triggers: ['七七', '7七', '满七'],
    priority: 20,
    enabled: true,
  },
  {
    key: 'ritual.hundred_days.custom',
    category: 'ritual',
    title: '百日',
    short:
      '百日是去世后第 100 天，常见做法是家人祭拜、简单供饭；各地叫法和算法可能不同。',
    triggers: ['百日', '百天', '100天'],
    priority: 20,
    enabled: true,
  },
  {
    key: 'ritual.anniversary.custom',
    category: 'ritual',
    title: '周年/忌日',
    short:
      '周年/忌日按家里惯用的农历或公历日子；常见做法是祭拜、供饭、说说近况，不必追求排场。',
    triggers: ['周年', '忌日', '祭日'],
    priority: 15,
    enabled: true,
  },
  {
    key: 'festival.qingming.custom',
    category: 'festival',
    title: '清明',
    short:
      '清明常见做法是扫墓、献花、供饭；不能去墓地时，也可以在家点香、说说话。注意当地防火和禁烧规定。',
    triggers: ['清明'],
    priority: 15,
    enabled: true,
  },
  {
    key: 'festival.zhongyuan.custom',
    category: 'festival',
    title: '中元',
    short:
      '中元/七月半常见做法是烧纸、供饭、祭祖；注意当地禁烧和防火规定，也可以用在家纪念代替。',
    triggers: ['中元', '七月半', '鬼节'],
    priority: 15,
    enabled: true,
  },
  {
    key: 'festival.hanyi.custom',
    category: 'festival',
    title: '寒衣节',
    short:
      '寒衣节常见做法是烧纸衣、送寒衣；注意当地规定，也可以用在家纪念、说说话代替。',
    triggers: ['寒衣'],
    priority: 15,
    enabled: true,
  },
  {
    key: 'festival.chunjie.custom',
    category: 'festival',
    title: '春节祭祖',
    short:
      '春节/除夕常见做法是请祖先、供饭、上香；各地差异很大，按家里习惯来。',
    triggers: ['春节', '过年', '除夕', '祭祖'],
    priority: 10,
    enabled: true,
  },
  {
    key: 'ritual.taboo.custom',
    category: 'ritual',
    title: '习俗忌讳',
    short:
      '各地忌讳不同：不确定时不要说“必须/不能”，先问家里怎么做；不替用户判断吉凶。',
    triggers: ['忌讳', '规矩', '讲究', '不能做'],
    priority: 5,
    enabled: true,
  },
];

const ALL_KNOWLEDGE = [...DREAM_KNOWLEDGE, ...RITUAL_KNOWLEDGE];
const KNOWLEDGE_BY_KEY = new Map(ALL_KNOWLEDGE.map(entry => [entry.key, entry]));

/** 梦境：先按 stage+action 精确取，再退回 action，最后返回 undefined 让代码兜底。 */
export function getDreamKnowledge(
  plan: Pick<DreamCompanionPlan, 'dreamStage' | 'dreamAction'>
): KnowledgeEntry | undefined {
  return (
    KNOWLEDGE_BY_KEY.get(`dream.${plan.dreamStage}.${plan.dreamAction}`) ||
    KNOWLEDGE_BY_KEY.get(`dream.${plan.dreamAction}`)
  );
}

/** 动作级别的兜底知识：stage 覆盖条目没有 move 时，回复动作退回这里。 */
export function getDreamActionKnowledge(
  action: DreamCompanionAction
): KnowledgeEntry | undefined {
  return KNOWLEDGE_BY_KEY.get(`dream.${action}`);
}

/** 祭祀/节日：按触发词匹配，返回优先级最高的一条。 */
export function matchRitualKnowledge(
  query: string
): KnowledgeEntry | undefined {
  const text = (query || '').trim();
  if (!text) return undefined;
  const matched = RITUAL_KNOWLEDGE.filter(
    entry =>
      entry.enabled &&
      entry.triggers.some(trigger => text.includes(trigger)) &&
      !(entry.negativePatterns || []).some(pattern => pattern.test(text))
  ).sort((left, right) => right.priority - left.priority);
  return matched[0];
}

/** 只注入命中条目；长度兜底，避免单条知识过长。 */
export function buildRitualKnowledgePrompt(
  entry: KnowledgeEntry | undefined
): string {
  if (!entry) return '';
  const short = entry.short.trim().slice(0, 160);
  return short ? `# 相关习俗\n${short}` : '';
}

const STICKY_TTL_MS = 10 * 60 * 1000;
const STICKY_TURNS = 3;
const FOLLOW_UP_PATTERN =
  /^(?:那|这|还有|还要|需要|具体|然后|接着|再).{0,12}(?:准备|注意|做|办|买|带|忌讳|规矩|怎么|多少|吗|呢)|^(?:要|需要|准备|注意).{0,8}(?:什么|哪些|怎么|吗|呢)/;

interface StickyState {
  key: string;
  expiresAt: number;
  remainingTurns: number;
}

const stickyByConversation = new Map<string, StickyState>();

/**
 * 会话粘性：命中的祭祀/节日知识在后续几轮追问里复用，不重复匹配。
 * 只有“那还要准备什么/具体怎么做”这类追问才复用，避免把习俗带到无关话题。
 */
export function resolveRitualKnowledge(options: {
  conversationId?: string;
  query: string;
  now?: number;
}): KnowledgeEntry | undefined {
  const conversationId = options.conversationId?.trim();
  const now = options.now ?? Date.now();
  const matched = matchRitualKnowledge(options.query);
  if (matched) {
    if (conversationId) {
      stickyByConversation.set(conversationId, {
        key: matched.key,
        expiresAt: now + STICKY_TTL_MS,
        remainingTurns: STICKY_TURNS,
      });
    }
    return matched;
  }

  if (!conversationId) return undefined;
  const state = stickyByConversation.get(conversationId);
  if (!state || state.expiresAt <= now || state.remainingTurns <= 0) {
    stickyByConversation.delete(conversationId);
    return undefined;
  }
  if (!FOLLOW_UP_PATTERN.test((options.query || '').trim())) {
    stickyByConversation.delete(conversationId);
    return undefined;
  }

  const entry = KNOWLEDGE_BY_KEY.get(state.key);
  if (!entry) {
    stickyByConversation.delete(conversationId);
    return undefined;
  }
  state.remainingTurns -= 1;
  return entry;
}

/** 测试用：清空会话粘性。 */
export function resetRitualKnowledgeSticky(): void {
  stickyByConversation.clear();
}
