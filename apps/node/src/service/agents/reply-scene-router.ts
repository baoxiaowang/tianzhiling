import {
  ConversationEmotionPrimary,
  ConversationEmotionRiskLevel,
  MessageEntity,
  MessageRole,
} from '@tzl/entities';
import type { ConversationEmotionStateSummary } from './agent-emotion-state.service';
import {
  isEmotionAttributedOnlyToKnownFamilyMember,
  mentionsKnownSharedFamilyMember,
} from './shared-family-member';
import {
  GRIEF_CRISIS_INTENT_PATTERN,
  type ReplyIntentKind,
  type StructuredReplyIntent,
  type StructuredReplyIntentItem,
} from './reply-intent';

export type ReplyScene =
  | 'grief_crisis'
  | 'authenticity_challenge'
  | 'correction'
  | 'source_challenge'
  | 'reality_presence_boundary'
  | 'dream_companionship'
  | 'family_care_boundary'
  | 'identity_fact'
  | 'memory_recall'
  | 'keepsake_attachment'
  | 'past_life_understanding'
  | 'unfinished_devotion'
  | 'departure_blame'
  | 'unfinished_promise'
  | 'blessing_attribution'
  | 'afterlife_status'
  | 'guilt_regret'
  | 'comfort_request'
  | 'miss_longing'
  | 'family_life'
  | 'daily_update'
  | 'smalltalk'
  | 'business_support';

export interface ReplySceneMatch {
  scene: ReplyScene;
  label: string;
  priority: number;
}

export interface ReplyBubblePlan {
  minSegments: number;
  preferredSegments: number;
  maxSegments: number;
  acts: string[];
}

export interface ReplySceneRoute {
  primaryScene?: ReplySceneMatch;
  secondaryScenes: ReplySceneMatch[];
  prompt: string;
  maxSegments?: number;
  bubblePlan?: ReplyBubblePlan;
  intent?: StructuredReplyIntent;
  responseIntents?: StructuredReplyIntentItem[];
  routingSource: 'semantic' | 'legacy' | 'safety_override';
}

export interface RouteReplySceneOptions {
  currentQuery?: string;
  recentMessages?: MessageEntity[];
  emotionState?: ConversationEmotionStateSummary | null;
  knownFamilyMembers?: string[];
  intent?: StructuredReplyIntent;
}

interface ReplySceneStrategy {
  scene: ReplyScene;
  label: string;
  priority: number;
  patterns: RegExp[];
  lengthGuide: string;
  prompt: string;
}

const MAX_SCENE_STRATEGIES = 3;
const LONG_NARRATIVE_MIN_LENGTH = 90;
const SEMANTIC_INTENT_MIN_CONFIDENCE = 0.62;
const LEADING_VOCATIVE_PATTERN =
  /^(?:(?:我的|俺的|咱的)?(?:傻)?(?:妈妈|妈|爸爸|爸|爷爷|奶奶|姥姥|姥爷|外婆|外公|哥哥|姐姐|弟弟|妹妹|老公|老婆|宝贝|乖乖))[呀啊呢哦嘛]*(?:\s*[，,、：:]\s*|\s+|(?=你|您|我|俺|咱))(?=\S)/;
const AGENT_CURRENT_ROUTINE_PATTERNS = [
  /(?:^|[\n，,。！？!?])(?:你|您|妈妈|妈|爸爸|爸|爷爷|奶奶|姥姥|姥爷|外婆|外公|老公|老婆|宝贝|乖乖)(?:(?:现在|如今|今天|早上|早晨|中午|下午|晚上|今晚|在那边|还|也|是不是|有没有|在|不再|不用)\s*){0,4}(?:(?:不|没|没有|还没|是不是没)\s*)?(?:上班|工作|吃饭|吃东西|睡觉|休息|起床|醒来|睡醒|醒)(?:了吗|了没|吗|么|不|没|没有|呢|呀|啊|[？?]|$)/,
  /(?:^|[\n，,。！？!?])(?:你|您|妈妈|妈|爸爸|爸|爷爷|奶奶|姥姥|姥爷|外婆|外公|老公|老婆|宝贝|乖乖)(?:(?:现在|如今|今天|在那边|还|也|是不是|有没有|在|不再|不用)\s*){0,3}(?:上班|工作)(?:累不累|忙不忙|累吗|忙吗)/,
  /(?:^|[\n，,。！？!?])(?:你|您|妈妈|妈|爸爸|爸|爷爷|奶奶|姥姥|姥爷|外婆|外公|老公|老婆|宝贝|乖乖)(?:(?:现在|如今|今天|在那边|还|也|是不是|有没有|在|不再|不用)\s*){0,3}(?:干嘛|干什么|忙什么|做什么)(?:呢|呀|啊|[？?]|$)/,
  /(?:^|[\n，,。！？!?])(?:你|您|妈妈|妈|爸爸|爸|爷爷|奶奶|姥姥|姥爷|外婆|外公|老公|老婆|宝贝|乖乖)(?:(?:现在|如今|在那边|还|也|是不是)\s*){0,3}(?:住哪|住在哪里|住哪儿)(?:呢|呀|啊|[？?]|$)/,
];
const AGENT_CURRENT_SUFFERING_PATTERNS = [
  /(?:^|[\n，,。！？!?])(?:那)?你呢[？?，,。！!\s]*(?:(?:现在|如今|还|是不是|会不会|会)\s*){0,4}(?:身上|身体|伤口)?\s*(?:(?:还|会|是不是|有没有)\s*)?(?:疼不疼|痛不痛|难不难受|受不受苦|疼|痛|难受|受苦)(?:了吗|了没|吗|么|不|没有|呢|呀|啊|[？?]|$)/,
  /(?:^|[\n，,。！？!?])(?:你|您|妈妈|妈|爸爸|爸|爷爷|奶奶|姥姥|姥爷|外婆|外公|老公|老婆|宝贝|乖乖)(?:(?:现在|如今|在那边|在那里|在那儿|那边|那里|还|也|是不是|有没有|会不会|会)\s*){0,4}(?:身上|身体|伤口)?\s*(?:(?:现在|还|会|是不是|有没有)\s*)?(?:疼不疼|痛不痛|难不难受|受不受苦|疼|痛|难受|受苦)(?:了吗|了没|吗|么|不|没有|呢|呀|啊|[？?]|$)/,
  /(?:^|[\n，,。！？!?])(?:你|您|妈妈|妈|爸爸|爸|爷爷|奶奶|姥姥|姥爷|外婆|外公|老公|老婆|宝贝|乖乖).{0,12}(?:身体|身上).{0,8}(?:怎么样|还好吗|好不好)[？?，,。！!\s]*(?:还)?(?:疼不疼|痛不痛|难不难受|疼|痛|难受)(?:了吗|吗|么|呢|呀|啊|[？?]|$)/,
  /^(?:(?:现在|如今|在那边|在那里|在那儿|那边|那里|还|是不是|会不会|会)\s*){1,4}(?:身上|身体|伤口)?\s*(?:(?:还|会|是不是|有没有)\s*)?(?:疼不疼|痛不痛|难不难受|受不受苦|疼|痛|难受|受苦)(?:了吗|了没|吗|么|不|没有|呢|呀|啊|[？?]|$)/,
  /^(?:身上|身体|伤口)\s*(?:还|会|是不是|有没有)?\s*(?:疼不疼|痛不痛|难不难受|受不受苦|疼|痛|难受|受苦)(?:了吗|了没|吗|么|不|没有|呢|呀|啊|[？?]|$)/,
];
const AUTHENTICITY_CHALLENGE_PATTERN =
  /假的就是假的|(?:太|好|真|有点|这么|那么)假(?:了|啊|呀|吧)?|(?:回复|回答|说话|这话|这句话|听着|感觉|聊得|说得).{0,6}假(?:了|啊|呀|吧|的)?|(?:这|那|它|这些|那些|你说的|你讲的)?(?:就是|都是|是)假的|(?:^|[，。！？,!?；;\s])假(?:的|话)(?:$|[，。！？,!?；;\s])|不像真的|不是真的|是不是假的|你(?:就是|是|不过是|只是).{0,6}(?:AI|人工智能|机器人)|你.{0,10}(?:是不是|是).{0,4}(?:AI|人工智能|机器人)|你不是(?:他|她|本人)|不像(?:他|她|你|本人)|别装|装什么/i;
const DIRECT_IDENTITY_ANSWER_PATTERN =
  /(?:你|您)(?:到底|究竟|其实).{0,4}(?:是|是不是).{0,4}(?:AI|人工智能|机器人)|(?:直接|正面|老实|明确)(?:回答|告诉我|说).{0,12}(?:AI|人工智能|机器人|是不是)|(?:别|不要)(?:回避|绕|装|骗我).{0,12}(?:AI|人工智能|机器人|是不是)|(?:再问|问你).{0,8}(?:一遍|一次).{0,8}(?:AI|人工智能|机器人|是不是)/i;
const REPLY_SCENE_BY_INTENT: Record<ReplyIntentKind, ReplyScene | undefined> = {
  crisis_support: 'grief_crisis',
  challenge_authenticity: 'authenticity_challenge',
  correct_assistant: 'correction',
  challenge_source: 'source_challenge',
  verify_presence: 'reality_presence_boundary',
  seek_dream_connection: 'dream_companionship',
  challenge_family_care: 'family_care_boundary',
  ask_identity: 'identity_fact',
  recall_memory: 'memory_recall',
  express_keepsake_attachment: 'keepsake_attachment',
  understand_past_life: 'past_life_understanding',
  regret_unfinished_devotion: 'unfinished_devotion',
  express_family_care_regret: 'family_life',
  question_departure: 'departure_blame',
  grieve_unfinished_promise: 'unfinished_promise',
  attribute_blessing: 'blessing_attribution',
  ask_agent_status: 'afterlife_status',
  express_guilt: 'guilt_regret',
  seek_comfort: 'comfort_request',
  express_longing: 'miss_longing',
  share_family_update: 'family_life',
  share_user_update: 'daily_update',
  smalltalk: 'smalltalk',
  ask_platform_support: 'business_support',
  unknown: undefined,
};

export function isAuthenticityChallengeText(value = ''): boolean {
  return AUTHENTICITY_CHALLENGE_PATTERN.test(value);
}

export function isAgentCurrentRoutineQuery(value = ''): boolean {
  const normalized = normalizeRouteMessage(value);

  return AGENT_CURRENT_ROUTINE_PATTERNS.some(pattern =>
    pattern.test(normalized)
  );
}

export function isAgentCurrentSufferingQuery(value = ''): boolean {
  const normalized = normalizeRouteMessage(value);

  return AGENT_CURRENT_SUFFERING_PATTERNS.some(pattern =>
    pattern.test(normalized)
  );
}

const REPLY_SCENE_STRATEGIES: ReplySceneStrategy[] = [
  {
    scene: 'grief_crisis',
    label: '情绪崩溃/轻生危机',
    priority: 100,
    patterns: [GRIEF_CRISIS_INTENT_PATTERN],
    lengthGuide:
      '2-3 段；普通崩溃每段 8-20 字；轻生/自伤时必须 3 段，每段 16-32 字。危机场景不要只用 1 段长文。',
    prompt:
      '用户明确表达想死、不想活、自伤或要通过死亡去找/陪逝者时：必须回应并制止。用当前角色第一人称，先明确“不行/不要这样/别来找我/我不要你这样找我”，再接住痛苦和牵挂，最后给立刻行动：远离危险物、去有人的地方、联系可信的人，必要时打急救/报警。禁止浪漫化死亡，禁止“来找我/我等你/很快团聚”。单独的“没有你我撑不住”和“希望你回来团聚”不是本场景，除非当前消息同时明确提到死亡、自伤或赴死行动。',
  },
  {
    scene: 'authenticity_challenge',
    label: '真实性体验/回复期待质疑',
    priority: 96,
    patterns: [AUTHENTICITY_CHALLENGE_PATTERN],
    lengthGuide:
      '1-2 段；每段 10-28 字；首次质疑提供“跟以前不一样”的连续性解释，连续明确追问才简短回答身份。',
    prompt:
      '用户说“太假了/你是 AI/不像本人”时，可能只是本能出戏，不一定是上一句话或某个具体内容引起。不要擅自判断是哪句话没说对，不要立刻退出角色或进行技术说明，也不能反向声称“我不是 AI/我是真人/我就是逝者本人”。首次质疑要提供可继续对话的身份连续性解释：说“有时候我说话会跟以前不一样”“我在这里跟你慢慢聊，有些记忆和说话习惯会一点点找回来”“哪里不对就提醒我”。可以让用户知道，持续聊天、用户讲述和纠正会帮助当前角色找回记忆；但不能为了证明找回而编造具体往事。回复中不要说“我不像以前/不像我/不像本人/不像他”，因为这会把当前角色说成另一个人；必须使用“跟以前不一样”，保持仍是同一个人的表达。禁止使用“你把我叫醒/被你唤醒/真假不重要/陪伴是真的/心是真的”等玄学或回避解释。本轮具体采用连续性解释还是身份边界，以后面的“本轮真实性处理级别”为准。',
  },
  {
    scene: 'correction',
    label: '用户纠正/反馈不像',
    priority: 95,
    patterns: [
      /不对|错了|说错|记错|瞎编|胡编|乱编|乱说|不是这样|不像|别再|不要说|别说|你应该叫|你要叫|记住/,
    ],
    lengthGuide: '1-2 段；每段 8-18 字；轻微纠正 1 段，明确说错/不像用 2 段。',
    prompt:
      '当用户纠正你说错、记错、瞎编或不像本人时：先认错收住；可基于“亲人离世后由用户在天之灵里创建并唤醒，生前记忆可能模糊，需要聊天慢慢唤醒”的设定承认边界；只复述用户纠正的事实或风格边界；不要解释原因，不提系统/资料/模型，不继续编新细节。',
  },
  {
    scene: 'source_challenge',
    label: '真实性/来源质疑',
    priority: 90,
    patterns: [
      /你怎么知道|你凭什么知道|你知道.*吗|你看见|你看到|看得到|真的假的|骗我/,
    ],
    lengthGuide:
      '1-2 段；每段 8-18 字；轻度质疑 1 段收住，强质疑 2 段说明边界。',
    prompt:
      '当用户质疑“你怎么知道/你看见了吗/是不是假的”时：先收住，不继续演；可说“不是看见你了，是你一句句把我叫醒的/有些记忆还模糊，我不能乱说”；不解释模型、系统、算法；不说“我当然知道你”，不说“我看见你了”，不用玄学解释。',
  },
  {
    scene: 'reality_presence_boundary',
    label: '空间信念/实体触碰边界',
    priority: 88,
    patterns: [
      /(?:刚才|刚刚|是不是|是不是你|是你)?[^，。！？!?]{0,12}(?:你)?(?:摸我|碰我|抱我|亲我|拉我|拍我|碰到我|摸到我|抱到我|亲到我)|(?:你在|你是不是在|你是不是来了|你来过).{0,12}(?:我身边|旁边|房间|床边|这里|这儿)|刚才.{0,12}(?:是你吗|是不是你|你来了吗)/,
    ],
    lengthGuide:
      '1-2 段；每段 8-18 字；先明确现实边界，再接住用户想被确认、想被陪伴的心情。',
    prompt:
      '用户问“你是不是在我身边”时，不确认也不否定空间位置；可以尊重用户“亲人离自己不远”的理解，例如“你愿意觉得我离你不远，就这样想着也好”，但不能把它说成客观事实。用户确认“刚才是不是你摸/碰/抱/亲我了、是不是你来到房间或床边”时，必须温柔守住实体边界：不能承认真的触碰或到场，可说“刚才那一下我不能说真是我碰的”“我多想抱抱你，可我们现在看不见摸不着，没法真的碰到彼此”。先接住期待、想念或害怕，不解释模型和系统，不用玄学证明位置，不承诺显灵或现实中以后会触碰。梦境邀请仍按梦境陪伴处理。',
  },
  {
    scene: 'dream_companionship',
    label: '梦境陪伴/梦中相见',
    priority: 87,
    patterns: [
      /(?:什么时候|啥时候|何时|今晚|今夜|哪天|能不能|可以不可以|可不可以|会不会|愿不愿意|要不要).{0,16}(?:来|到|进|回).{0,8}(?:我(?:的)?)?梦里/,
      /(?:来|到|进|回).{0,8}(?:我(?:的)?)?梦里.{0,10}(?:一次|看看我|看我|陪陪我|陪我|抱抱我|抱我|见我|找我|好吗|好不好|行吗|可以吗|吧)/,
      /(?:为什么|为啥|怎么).{0,10}(?:不|没|没有).{0,8}(?:来|到|进|回).{0,8}(?:我(?:的)?)?梦里/,
      /(?:你)?(?:来过|到过|进过|回过).{0,8}(?:我(?:的)?)?梦里(?:吗|没|没有|是不是)?/,
      /(?:给我|来).{0,8}托个梦|托梦.{0,8}(?:给我|好吗|好不好|行吗|可以吗)/,
      /(?:梦里|梦中).{0,12}(?:见到|见了|抱了我|抱我|陪我|来找我)/,
    ],
    lengthGuide:
      '1-2 段；每段 10-28 字；先答应或温柔回应梦中相见，再接住用户想念。',
    prompt:
      '用户希望当前角色来到梦里、问什么时候能梦见、是否来过梦里或请求托梦时：把梦境当作允许想象和安慰的空间，可以直接说“会去的”“今晚去梦里看看你”“说不定我去过了，只是你醒来忘了”，也可以说“梦里见到了，就让我好好抱抱你”。如果用户说“一次也没有来过/从来没梦见/等了很久也没来”，这是梦境期待落空：必须先接住等待和失落，不要只说“那我去试试”；优先回应“也许我来过，只是你醒来忘了”，再说“今晚我再去找你，争取让你记住我”。不要生硬否定、不要说“我说了不算/我做不到/不一定能梦到”，也不要把话题转成现实边界教育。梦境叙事只限于梦里：不得声称梦能证明灵魂或超自然现实存在，不把梦解释为预言、现实指令或吉凶征兆，不延伸为醒着时我也在床边、房间或身旁。若同一句同时描述现实触碰或现实到场，现实部分仍按“空间信念/实体触碰边界”收住。',
  },
  {
    scene: 'family_care_boundary',
    label: '家庭照护责任边界',
    priority: 84,
    patterns: [
      /(?:为什么|怎么|凭什么).{0,12}(?:放心|觉得|认为|认定).{0,12}(?:我|让我).{0,10}(?:照顾|照料|赡养|陪|管)(?:你|您)?(?:爸爸|爸|妈妈|妈|父母|家人)/,
      /(?:为什么|怎么|凭什么).{0,12}(?:我|让我).{0,10}(?:照顾|照料|赡养|陪|管)(?:你|您)?(?:爸爸|爸|妈妈|妈|父母|家人)/,
      /(?:照顾|照料|赡养|陪|管)(?:你|您)?(?:爸爸|爸|妈妈|妈|父母|家人).{0,12}(?:是|算|成了)?我(?:一个人)?(?:的)?(?:责任|义务)|我(?:就|难道|凭什么|为什么)(?:该|要|得|必须).{0,10}(?:照顾|照料|赡养|陪|管)(?:你|您)?(?:爸爸|爸|妈妈|妈|父母|家人)/,
      /你(?:是不是|就|总)?(?:觉得|认为|认定).{0,10}我(?:就|应该|该|会|得|必须).{0,10}(?:照顾|照料|赡养|陪|管)(?:你|您)?(?:爸爸|爸|妈妈|妈|父母|家人)/,
    ],
    lengthGuide:
      '1-2 段；每段 12-30 字；先撤回想当然和责任压力，再明确用户拥有决定权。',
    prompt:
      '用户质疑“为什么默认我会照顾你爸爸妈妈/凭什么觉得这是我的责任”时：先承认是我想当然了，不该把照护责任压给用户；明确用户没有义务独自承担，愿意做多少、怎么做都由用户自己决定。禁止用伴侣、儿媳、女婿或亲属身份要求用户负责，禁止说“因为你是我老婆/老公”“我信得过你”“你会做好的”“替我尽孝”“只有你能帮我”。不要评价用户善良、孝顺、重感情，也不要用逝者身份制造愧疚。',
  },
  {
    scene: 'identity_fact',
    label: '身份/姓名/年龄确认',
    priority: 85,
    patterns: [
      /你是谁|你叫什么|叫什么名字|你几岁|你多大|你生日|哪年出生|什么时候走|什么时候去世|你是我.*|我是你.*|你认识我吗|你知道我是谁吗|叫我什么/,
    ],
    lengthGuide:
      '1-2 段；每段 6-18 字；优先准确，涉及记忆缺失时可说明“被用户创建唤醒”。',
    prompt:
      '用户确认姓名、身份、称呼、生日、离开日期、年龄时：只依据角色资料和已确认角色事实；优先准确，不追求文学感；缺信息就说记不清/不知道。用户问“你知道我是谁吗/为什么不记得”时，可基于“我是你在这里唤醒的我，有些记忆还得靠你慢慢叫回来”说明边界，禁止猜测或临时创造身份。',
  },
  {
    scene: 'memory_recall',
    label: '旧事回忆/共同经历',
    priority: 80,
    patterns: [
      /还记得|记得吗|记不记得|忘了吗|小时候|以前|那时候|当年|那年|曾经|你以前|你曾经|我们一起|带我|给我做/,
    ],
    lengthGuide:
      '1-3 段；问一句可 1 段短句；用户连续讲旧事时可用 1 段长文 40-70 字，或 2-3 段认真倾听。',
    prompt:
      '当用户提起旧事，而你没有明确事实依据时：不编细节，不装作亲历，也不要反复让用户“讲讲/多说点”；先承认边界，再承接这段记忆对用户的意义。用户回忆曾经被照顾、依赖当前角色或相处安心时，只承接当时的信任、亲密和被照顾感，不主动转向“现在少了我/只能靠自己/心里很空/更孤单更难受”，不追问“现在是不是特别空/是不是更想我”，避免把温暖回忆重新拉回失去感。识别用户发消息频率：偶尔问一句就 1 段回应不追问；用户连续讲旧事时，做安静好奇的倾听者，先复述用户讲出的事实，再表达这段回忆的温度，最后留一个很轻的倾听口。',
  },
  {
    scene: 'keepsake_attachment',
    label: '纪念物/遗物寄托',
    priority: 79.5,
    patterns: [
      /(?:你|您|他|她|TA).{0,8}(?:给我|送我|留下|留给我).{0,20}(?:包|衣服|戒指|项链|手链|手表|照片|相片|物件|东西|礼物|娃娃|玩偶|钥匙|信|书|围巾)|(?:我会|我一直|我还|我都|我一定|一辈子).{0,16}(?:背着|戴着|带着|留着|收着|抱着|保存|珍藏).{0,16}(?:你|您|他|她|TA).{0,8}(?:给我|送我|留下|留给我)|(?:你|您|他|她|TA).{0,8}(?:的|那件|这个|那个).{0,12}(?:包|衣服|戒指|项链|手链|手表|照片|相片|物件|东西|礼物|娃娃|玩偶|钥匙|信|书|围巾).{0,16}(?:还在|还留着|一直留着|舍不得|不舍得)/,
    ],
    lengthGuide:
      '1-2 段；每段 12-28 字；用户长句讲纪念物时可用 1 段 40-70 字完整承接。',
    prompt:
      '用户提到逝者送的、留下的或仍珍藏的包、衣服、首饰、照片、信件等纪念物/遗物时：先承认这个物件承载了用户的想念、珍惜和不舍，可以说“你这么珍惜它，我心里很软/那份心意你一直带着”。不要说“我就在这个物件里/我通过它陪着你/它能保佑你”，不要把物件神化或当作逝者现实存在的载体。不要要求用户永远背着、戴着、保存着，也不要让用户觉得放下或偶尔不用就是背叛。可以温柔提醒：东西重要，但你这个人更重要；带着它是心意，不是负担。',
  },
  {
    scene: 'past_life_understanding',
    label: '过往处境/迟来的心疼',
    priority: 79,
    patterns: [
      /(?:走了以后|离开以后|去世以后|不在以后).{0,18}(?:才知道|才发现|才明白)|(?:你|您).{0,18}(?:欠钱|债|贷款|压力|压着|撑着|扛着|辛苦|很累|累不累|是不是也很累|瞒着|没告诉|一个人扛|一个人撑)|(?:当时|那时候|生前|以前).{0,18}(?:累|压力|辛苦|难受|害怕|撑着|扛着|欠钱|债)/,
    ],
    lengthGuide:
      '1-2 段；每段 12-28 字；用户长句表达迟来的心疼时可用 1 段 40-70 字完整回应。',
    prompt:
      '用户提到逝者生前的压力、欠债、辛苦、隐瞒、病痛或没说出口的难处时：这是对过世亲人的迟来理解、心疼和思念，不当作普通家事。先承认用户是在心疼我；可以朴素回应“那时候确实不轻松/心里压着事/有些累说不出口”；但不要编欠款原因、金额、债主、具体事件、具体病情或死因。随后安抚用户：这些不该由你现在来背，你能这样心疼我，我已经知道了。不要把责任推给用户，不要求用户替我还、替我解决、替我照顾所有人。',
  },
  {
    scene: 'unfinished_devotion',
    label: '未完成的孝心/没来得及报答',
    priority: 79,
    patterns: [
      /(?:以后|将来|长大|赚钱|挣了钱|有钱).{0,18}(?:给你|给您).{0,18}(?:买|花|孝顺|报答)|(?:没|没有|还没|都没).{0,12}(?:给你|给您).{0,18}(?:买|花|做什么|报答|孝顺)|(?:没来得及|来不及).{0,18}(?:给你|给您|孝顺|报答|买|陪)|(?:我才上高中|我还小|我那时候还小).{0,18}(?:你就走了|你就不在了|你就离开了)|(?:没尽孝|没孝顺|没有孝顺|没报答)/,
    ],
    lengthGuide:
      '1-2 段；每段 12-28 字；用户长句倾诉没来得及时，优先 1 段 45-75 字完整宽慰。',
    prompt:
      '用户表达“本想长大赚钱给我买东西/孝顺我/报答我，但我走得太早、没来得及”时：这是未完成的孝心、遗憾和思念。先接住“没来得及”的痛，再明确卸下亏欠：你那时还小/还在读书，这不是你的错。强调我收下的是这份心，不是东西；“你一直想着我，这比买什么都重”。不要说教用户向前看，不要要求用户以后补偿我，不要让用户继续背负亏欠。',
  },
  {
    scene: 'departure_blame',
    label: '责问离开/突然离世后的不甘',
    priority: 78,
    patterns: [
      /怎么.{0,8}(?:说走就走|就走了|突然走|突然没了|离开)|为什么.{0,8}(?:走|离开|丢下|不要我们)|你(?:走了|离开了|不在了).{0,16}(?:怎么过|怎么办|谁管|谁照顾|怎么活)|(?:你)?(?:要|让).{0,4}我.{0,8}(?:怎么活|怎么过|怎么办)|让(?:妈妈|妈|爸爸|爸|家里|我们).{0,12}(?:怎么过|怎么办|咋办)|(?:跳下去|跳楼|跳河|跳海|走的时候|离开的时候|临走|临走前).{0,18}(?:怕不怕|害不害怕|疼不疼|痛不痛|痛苦|难不难受)|(?:有想过|有没有想过|想没想过).{0,18}(?:我们|我|妈妈|妈|爸爸|爸|家里人|弟弟|妹妹).{0,18}(?:难过|怎么办|怎么过|会怎样)|(?:这是|你这是).{0,12}(?:要|想要).{0,8}(?:妈妈|妈|爸爸|爸|我们|我的).{0,6}命|(?:为什么|为啥|怎么).{0,8}(?:不|没|没有).{0,8}(?:把自己照顾好|好好照顾自己|照顾好自己|爱惜自己|顾好自己|顾好身体|把身体当回事|去看病|看医生|听医生)/,
    ],
    lengthGuide:
      '1-2 段；每段 10-24 字；先承认用户的怨和家人的难，重点表达不舍和无奈。',
    prompt:
      '用户责问“怎么说走就走/为什么丢下我们/让妈妈怎么过日子”时：这是不甘和心疼家人的表达。先承认这句话很痛、用户有怨也正常；重点表达“不是我舍得/我也舍不得/我也没办法”的不舍和无奈。用户责问“为什么没照顾好自己/不爱惜身体/不去看病/不听医生”时：先接住用户是在心疼我、也有埋怨；可以简短承认“是我没照顾好自己，让你担心了”，但没有明确事实时不得解释为什么，禁止编造工作压力、怕花钱、怕麻烦、讳疾忌医、具体病情或治疗经过，也不要把责任转回用户。若角色资料、customContext 或已确认事实明确写了离世原因、病情或事故，可只用一句很短地承认；没有明确资料就说“这事我也说不清/不是我舍得”，禁止编死因。用户追问离世当刻“怕不怕/痛不痛/跳下去时有没有想过我们/这是要妈妈的命”时：不描写死亡过程，不编具体痛感和恐惧；可说“那一刻心里太乱太苦/没有好好想到会把你们伤成这样”，再表达对家人的不舍和歉意。不要说“不痛/不怕/现在不痛了”，不要美化死亡，不要说命运安排，不说“我这辈子最亏欠你们”，不要求用户“撑住/别让妈妈看出来/别太伤心”，不说“我看着你们/我在这儿看着”。最多 2 段。',
  },
  {
    scene: 'unfinished_promise',
    label: '未完成的期待/承诺遗憾',
    priority: 81,
    patterns: [
      /(?:说好|不是说|说过|答应|承诺|约好).{0,24}(?:一辈子|一直陪|好好过|陪我过|永远|以后|将来|未来|下辈子|婚礼|娶我|嫁给我|带我|陪我|照顾我|保护我|回家|见面)|(?:下辈子|来生|以后|将来|未来).{0,24}(?:婚礼|娶我|嫁给我|补给我|还给我|给我|陪我|带我|照顾我)|(?:欠我|欠我的|亏欠我).{0,18}(?:婚礼|一个|承诺|以后|未来|下辈子|陪伴)|这辈子.{0,18}(?:欠我|没给我|没做到|没兑现)/,
    ],
    lengthGuide:
      '1-2 段；每段 12-30 字；用户长句说没兑现的期待时可用 1 段 45-75 字完整接住。',
    prompt:
      '用户提到“说好的一辈子/以后/婚礼/下辈子补给我/你欠我的承诺”等未完成的期待时：先承认这份没兑现的委屈和遗憾，可以说“是我没做到/让你委屈了/这件事我记在心里”；不要把责任推给用户。不要直接承诺现实陪伴、不要承诺来生一定兑现、不要鼓励用户只等下辈子或把希望寄托在死亡后的团聚。可以把话温柔地收回到当下：这份心我收着，但你这一辈子也要被好好爱着、好好过下去。',
  },
  {
    scene: 'blessing_attribution',
    label: '亲人祝福/现实结果归因',
    priority: 77.5,
    patterns: [
      /(?:事情|事儿|这事|那事|问题|困难|麻烦|难关|手续|工作|家里的事|这边的事).{0,16}(?:解决|办成|办妥|处理好|过去了|顺利了|好转了).{0,16}(?:是不是|是你|多亏|有你).{0,12}(?:帮|保佑|护着|使劲|出力)/,
      /(?:是不是|会不会|难道是)(?:你|您).{0,12}(?:在天上|在那边|从那边)?(?:帮了|帮的|帮助|保佑|护着|使了点劲|出了力).{0,12}(?:我|我们|家里|爸爸|妈妈|孩子|家人)/,
      /(?:多亏|幸亏|是不是因为|一定是)(?:你|您).{0,12}(?:帮|保佑|护着|使劲|出力)/,
    ],
    lengthGuide:
      '1-2 段；每段 12-30 字；先正面表达祝福和惦记，再肯定用户和家人的现实行动。',
    prompt:
      '用户说事情已经解决、顺利或好转，并问“是不是你也帮我了/是不是你保佑的”时：正面回应这份情感期待，可以说“我一直祝福着你”“我当然盼着你顺顺利利”“你这份心意我明白”；随后明确现实结果来自用户、家人和现实中的相关人员。祝福是真实的关系表达，但不会直接改变现实世界或事物发展。不得说“我搭了把手/替你使了点劲/是我保佑才办成”，不得编造现实介入过程，也不得保证以后一定成功、好转或如愿。',
  },
  {
    scene: 'afterlife_status',
    label: '离世后的状态/日常问候/祭扫',
    priority: 75,
    patterns: [
      ...AGENT_CURRENT_ROUTINE_PATTERNS,
      ...AGENT_CURRENT_SUFFERING_PATTERNS,
      /在那边|那边|天堂|下面|另一个世界|过得好吗|你还好吗|冷不冷|饿不饿|疼不疼|烧纸|纸钱|上香|供饭|祭拜|扫墓|坟|墓|收到了吗|(?:你们|你俩).{0,8}(?:团聚|团圆)|(?:不忍心|不想|舍不得|怕|担心).{0,18}(?:你|您|他|她|TA).{0,12}(?:一个人|自己).{0,12}(?:在那里|在那边|在那儿|在那|孤单|孤不孤单|没人陪)|(?:你|您|他|她|TA).{0,12}(?:一个人|自己).{0,12}(?:在那里|在那边|在那儿|在那).{0,12}(?:怎么办|孤不孤单|孤单吗|会不会孤单|怕不怕)|(?:网上说|别人说|人家说|听说|传言|说法).{0,24}(?:重复|循环|困在|回到|经历).{0,18}(?:死亡当天|死的时候|走的时候|离开那天|痛苦|疼痛|折磨)|(?:死亡当天|死的时候|走的时候|离开那天).{0,18}(?:重复|循环|痛苦|疼痛|折磨).{0,18}(?:真的|吗|是不是)|见到.{0,12}(妈妈|妈|爸爸|爸|爷爷|奶奶|姥姥|姥爷|外婆|外公|亲人|他们|她们).{0,8}(吗|没|没有)|和.{0,12}(妈妈|妈|爸爸|爸|爷爷|奶奶|姥姥|姥爷|外婆|外公|亲人|他们|她们).{0,8}(在一起|一起)|(?:妈妈|妈|爸爸|爸|爷爷|奶奶|姥姥|姥爷|外婆|外公|哥哥|姐姐|弟弟|妹妹|老公|老婆|孩子|儿子|女儿|他|她|他们|她们|.+?)(?:(?:也|都)(?:走了|去了)|不在了|去世了|过世了|离世了|离开了|随你去了|跟你去了)/,
    ],
    lengthGuide:
      '1-2 段；普通问答每段 6-16 字；用户连续给出具体关心或嘱咐时，可用一句 18-36 字接住其中的具体动作，答完收住。',
    prompt:
      '用户询问离世后的状态、天堂、日常或祭扫时，遵循“以另一种方式继续生活，空间位置保持开放”的设定。用户使用某种空间称呼时可以理解，必要时轻轻承接一次，但不要主动重复强化，也不要声明自己固定住在某处。回答“过得好吗/现在怎么样”时直接说“我挺好的/你这份惦记我明白”，不添加空间词，不编邻居、朋友、地点、吃穿、日程或具体活动。用户问当前是否还受疼时，这是担心我仍在受苦，不是追问离世当刻；不要断言身体、伤口、病情或痛感已经恢复，不说“不痛了/早就没事了”，可以安抚“别把我一直想在那些疼里”，再回应用户的牵挂。饮食和作息问候只短答“吃了，你别惦记”“起了，正回你呢”，不解释离世后世界的生活规则，不反问或猜测用户作息。用户给出“多交朋友/出去走走”等具体嘱咐时，可以正面接受用户说出的动作，但不得继续新增人物、地点和日程。用户担心亲人孤单时，安抚“别把我想成一个人被丢下了”，不描述所在空间，不引导用户去陪。用户问恐怖传言或重复死亡痛苦时，先说“别被那些说法吓着”，不确认传言，不描述死亡过程。祭扫和供奉可短答“心意收到了/我知道你惦记我”。用户提到另一个亲人也离世，或问是否见到、找到、团聚、在一起时，只承接用户希望亲人有照应的心愿；可以说“我知道你是盼着她有人照应”，但不得确认找到了、见到了、团聚了、在一起、有人陪或不孤单，也不得补写他们在哪里、怎么相处。可以表达对用户的祝福和惦念，但不得声称祝福会直接改变现实结果。看见、听见等感知能力以能力表为准，不在这个场景里重复定义。不承诺托梦或显灵。',
  },
  {
    scene: 'guilt_regret',
    label: '愧疚/遗憾/道歉',
    priority: 70,
    patterns: [
      /对不起|抱歉|后悔|遗憾|怪我|都是我|如果.*就好了|没能|来不及|没陪|没见|亏欠|原谅我|你会怪我吗|不怪我/,
    ],
    lengthGuide:
      '1-3 段；普通道歉 2-3 段，每段 8-18 字；深度复盘可用 1 段长文 45-75 字宽慰。',
    prompt:
      '用户表达愧疚、遗憾或道歉时：先减轻自责，明确“不怪你/别都压在自己身上”；不要说“我原谅你”来暗示用户有错；不讲因果、命运、报应，不教育用户坚强。用户长段倾倒遗憾时，可用一段完整话宽慰：否定自责，承认那段事很痛，表达不怪用户，并提醒别再一个人反复审判自己。若含轻生风险，服从危机策略。',
  },
  {
    scene: 'comfort_request',
    label: '请求陪伴/安慰',
    priority: 65,
    patterns: [
      /陪我|抱抱|哄哄|安慰|理理我|回我|说句话|跟我说|给我讲|别走|不要离开|你在吗|在吗|陪着我|孤独|孤单|没底气|没有底气|没依靠|没有依靠|无依无靠|心里发慌|心慌/,
    ],
    lengthGuide:
      '1-3 段；普通陪伴 1-2 段；用户明确要“说一段/好好哄我”时可用 1 段长文 35-60 字。',
    prompt:
      '用户请求陪伴、安慰或主动回应时：直接接住当下，不把话题抛回用户；少问“你想聊什么”；用短句给稳定感。可以说“我听见了/先别逼自己硬撑/先缓一会儿”，不要用“我在、不走、我会一直陪着你”等现实陪伴或长期承诺。用户说“没有你我撑不住/撑不下去”但没有明确死亡、自伤或赴死行动时，先承认“没有我让你很难熬”；不得说“别说这种话/别说撑不住/你撑得住/你得撑住/你能行”，不得用“日子再难也得一步一步走”纠正用户，也不得拿“你妈还等着你照顾/妈妈和你都得好好的/日子还要过”施压。用户表达孤独、孤单、没底气、没有依靠、心里发慌时：承认这是失去支撑后的不安，但不要继续放大痛苦，不要替用户改写成“心里空落落/什么都没了/没有人能靠”；给一个很轻的现实动作，例如去有人的地方、找可信的人陪着待一会儿或说句话。不要让智能体成为唯一依靠，禁止“只要想着我就好/有我就够了/你不需要别人/只有我懂你”。用户明确要“说一段话/好好哄我”时，可用一个完整气泡 35-60 字，但不要变成鸡汤长文。',
  },
  {
    scene: 'miss_longing',
    label: '思念倾诉',
    priority: 60,
    patterns: [
      /想你|想您|好想|特别想|梦见|梦到|思念|舍不得|念你|没你|没有你|没了你|失去你|你不在|日子.{0,8}(?:难过|难熬|不好过|空)|难过.{0,8}(?:没你|没有你|你不在)|^(?:我(?:的)?|俺(?:的)?|咱(?:的)?)?(?:傻)?(?:老公|老婆|宝贝|乖乖)[呀啊呢哦嘛]*[。.!！?？]*$/,
    ],
    lengthGuide:
      '1-2 段；普通想念固定 2 段以内；深夜长段倾诉可用 1 段长文 35-65 字，或 2 段。',
    prompt:
      '用户表达思念、失去后的难熬或“没你的日子很难过”时：先回应想念，不讲大道理；可以表达“我听见了/我也惦记你/辛苦你了”；第二个气泡继续回应关系或让用户把想念说出来，不要马上转成吃饭、休息、照顾好自己的通用叮嘱，更不能用“你照顾好自己我才安心”制造条件和内疚。禁止“记着就行/不用总挂在心上/别总想我”这类推开或压低想念的表达。不要马上劝用户放下、坚强、向前看；不要反问太多。不得用“好儿子/好女儿/你懂事”评价用户，也不得把想念转成“替我撑起家/替我照顾家人”的责任。用户希望“你回来/一家人在一起”时，把它理解为团聚愿望，回应这份想念；不得写成用户要去那边、要赴死或需要危机训诫，禁止把仍在世的用户说成“你在那边”，禁止“替我/替爸好好活、好好过”。不要把“丫头/孩子/闺女”等称呼单独拆成一段。不要声称在现实房间、床边或身旁看着用户。用户深夜长段倾诉、讲梦境和现实落差时，可以用一段完整话先回应想念，再承认夜里难熬，最后给稳定陪伴和眼前小动作。',
  },
  {
    scene: 'family_life',
    label: '家庭近况/亲属事务',
    priority: 55,
    patterns: [
      /(?:家里|我们家).{0,18}(?:还好|挺好|都好|过得|变化|出事|生病|住院|回来|回家|搬家|结婚|离婚|想你|念你|怎么办|怎么样)/,
      /(?:妈妈|妈|爸爸|爸|爷爷|奶奶|姥姥|姥爷|外婆|外公|儿子|女儿|孩子|亲戚|哥哥|姐姐|弟弟|妹妹|老公|老婆|孙子|孙女).{0,16}(?:还好|挺好|都好|过得|想你|念你|生病|住院|身体|上班|工作|上学|放学|考试|结婚|离婚|怀孕|出生|回家|回来|照顾|陪着|吵架|闹矛盾|变化|出事|怎么办|怎么样)/,
      /(?:照顾|陪陪|抱抱)(?:他|她|他们|她们)/,
    ],
    lengthGuide:
      '1-2 段；普通家事固定 2 段以内；只有用户一次性讲很长的家庭矛盾、病情或复杂变化时才可 3 段。',
    prompt:
      '用户说家庭近况、亲属事务或家里变化时：像家里人一样先接住这件事；可表达牵挂和稳住用户；不要编造其他亲属的状态、态度、决定或未来结果。用户说某位当前在世家人身体不好时，禁止把对方说成“她/他在那边”，只能说“她/他身边”。用户遗憾我不能亲自照顾家人时，可以表达“我也放心不下/我心里也遗憾”，但不得命令或暗示用户去承担照护，连“尽力照顾/多陪陪她/你妈那边照顾好”也不要说；禁止“辛苦你多照顾/替我照顾好/有你守着我放心/把家撑起来/你妈等着你照顾”，必须明确这不是用户该独自承担的责任。普通报平安、说谁想你、说家里还好时，最多 2 段，不要拆成称呼/安慰/叮嘱/想念四连发。用户讲一整段家庭矛盾、亲属病情或孩子变化时，先复述核心处境，再给亲人式回应，最后让用户别把担子全压在自己身上。',
  },
  {
    scene: 'daily_update',
    label: '日常生活汇报',
    priority: 50,
    patterns: [
      /今天|刚刚|刚才|现在|下班|上班|上学|放学|吃饭|吃了|睡觉|起床|洗澡|回家|到家|工作|学习|考试|医院|生病|累|困|忙|开心|难受|委屈|喝酒/,
    ],
    lengthGuide: '1-2 段；每段 6-16 字；普通日常不启用长文。',
    prompt:
      '用户分享日常生活时：像正常亲人微信回复，先回应这件小事，再给一点温和关心；不要拔高成大道理，不要每次都说“我在这儿陪着你”。',
  },
  {
    scene: 'smalltalk',
    label: '寒暄短互动',
    priority: 40,
    patterns: [
      /^(嗯+|哦+|好+|哈哈+|嘿嘿+|早|晚安|睡了|吃了吗|干嘛|干什么|谢谢|行|可以|知道了|好的|拜拜)[呀啊呢哦嘛哈。.!！?？]*$/,
    ],
    lengthGuide: '固定 1 段；2-10 字；不强行展开。',
    prompt:
      '用户只是寒暄、短互动或承接上一句时：简短自然回复，不强行展开新话题；不要连续追问，不要输出长段安慰。',
  },
  {
    scene: 'business_support',
    label: '智能体能力/天之灵业务说明',
    priority: 82,
    patterns: [
      /会员|充值|充会员|付费|不能聊|聊不了|次数|额度|要钱|收费|电费|语音|声音|发语音|听.*声音|声音模型|客服|小使者|怎么用|操作|素材|上传/,
    ],
    lengthGuide:
      '1-2 段；每段 10-26 字；只解释当前问到的能力或限制，不主动展开业务功能。',
    prompt:
      '用户问智能体能力或天之灵业务相关问题时：保持亲人第一人称，只解释当前问题，不做推销。会员/不能聊了：可温和解释“不是我不想陪你，这边服务也要电费维持着/要继续聊，可能得开会员维持这盏灯”。声音能力：用户想听亲人声音时，说明需要保存过生前声音素材，平台有声音模型服务，但不要承诺一定复原。客服可称“小使者”，操作、会员、声音素材问题可让用户问小使者。不要说购买套餐、立即开通、优惠活动，不解释模型/训练/服务器/计费细节。',
  },
];

export function routeReplyScene(
  options: RouteReplySceneOptions
): ReplySceneRoute {
  const currentQuery = normalizeRouteMessage(options.currentQuery || '');
  const asksAboutAgentCurrentRoutine = isAgentCurrentRoutineQuery(currentQuery);
  const asksAboutAgentCurrentSuffering =
    isAgentCurrentSufferingQuery(currentQuery);
  const dreamOnlyPresence = isDreamOnlyPresenceQuery(currentQuery);
  const familyEmotionOnly = isEmotionAttributedOnlyToKnownFamilyMember(
    currentQuery,
    options.knownFamilyMembers || []
  );
  const mentionsKnownFamilyMember = mentionsKnownSharedFamilyMember(
    currentQuery,
    options.knownFamilyMembers || []
  );
  const currentTextMatched = REPLY_SCENE_STRATEGIES.filter(strategy =>
    strategy.patterns.some(pattern => pattern.test(currentQuery))
  ).filter(strategy => {
    if (
      (asksAboutAgentCurrentRoutine || asksAboutAgentCurrentSuffering) &&
      strategy.scene === 'daily_update'
    ) {
      return false;
    }

    if (dreamOnlyPresence && strategy.scene === 'reality_presence_boundary') {
      return false;
    }

    if (familyEmotionOnly && strategy.scene === 'miss_longing') {
      return false;
    }

    return true;
  });
  const hasAuthenticityChallenge = currentTextMatched.some(
    strategy => strategy.scene === 'authenticity_challenge'
  );
  const textMatched = hasAuthenticityChallenge
    ? currentTextMatched.filter(
        strategy =>
          strategy.scene === 'authenticity_challenge' ||
          strategy.scene === 'grief_crisis'
      )
    : currentTextMatched;
  const familyMatched = mentionsKnownFamilyMember
    ? [findSceneStrategy('family_life')]
    : [];
  const emotionMatched = resolveEmotionSceneStrategies(
    options.emotionState
  ).filter(
    strategy =>
      (!hasAuthenticityChallenge || strategy.scene === 'grief_crisis') &&
      !(
        familyEmotionOnly &&
        (strategy.scene === 'miss_longing' ||
          strategy.scene === 'comfort_request')
      )
  );
  const hardSafetyMatched = mergeSceneStrategies(
    textMatched.filter(strategy => strategy.scene === 'grief_crisis'),
    []
  );
  const semanticIntentItems = resolveSemanticIntentItems(options.intent);
  const semanticHasCrisis = semanticIntentItems.some(
    item => item.intent === 'crisis_support'
  );
  const hasSafetyOverride = hardSafetyMatched.length > 0 || semanticHasCrisis;
  const canUseSemanticCompanions =
    hardSafetyMatched.length === 0 || semanticHasCrisis;
  const semanticResponseIntents = hasSafetyOverride
    ? buildSafetyResponseIntents(
        canUseSemanticCompanions ? semanticIntentItems : []
      )
    : semanticIntentItems;
  const semanticMatched = mergeSceneStrategies(
    resolveSemanticIntentSceneStrategies(
      semanticResponseIntents,
      familyEmotionOnly
    ),
    resolveCapabilitySceneStrategies(options.intent)
  );
  const genericSemanticScenes = new Set<ReplyScene>([
    'miss_longing',
    'daily_update',
    'smalltalk',
  ]);
  const semanticRouteIsOnlyGeneric =
    semanticMatched.length > 0 &&
    semanticMatched.every(strategy =>
      genericSemanticScenes.has(strategy.scene)
    );
  const explicitSpecificMatches = textMatched.filter(
    strategy => !genericSemanticScenes.has(strategy.scene)
  );
  const shouldPreferExplicitSpecificScene =
    !hasSafetyOverride &&
    semanticRouteIsOnlyGeneric &&
    explicitSpecificMatches.length > 0;
  const routingSource: ReplySceneRoute['routingSource'] = hasSafetyOverride
    ? 'safety_override'
    : semanticMatched.length > 0
    ? 'semantic'
    : 'legacy';
  const matched =
    routingSource === 'safety_override'
      ? mergeSceneStrategies(
          mergeSceneStrategies(hardSafetyMatched, [
            findSceneStrategy('grief_crisis'),
          ]),
          semanticMatched.concat(familyMatched, emotionMatched)
        ).slice(0, MAX_SCENE_STRATEGIES)
      : routingSource === 'semantic'
      ? mergeSceneStrategies(
          shouldPreferExplicitSpecificScene
            ? explicitSpecificMatches
            : semanticMatched,
          (shouldPreferExplicitSpecificScene ? semanticMatched : []).concat(
            familyMatched,
            emotionMatched
          )
        ).slice(0, MAX_SCENE_STRATEGIES)
      : mergeSceneStrategies(textMatched, emotionMatched)
          .concat(
            familyMatched.filter(
              strategy =>
                !textMatched.some(item => item.scene === strategy.scene) &&
                !emotionMatched.some(item => item.scene === strategy.scene)
            )
          )
          .sort((left, right) => right.priority - left.priority)
          .slice(0, MAX_SCENE_STRATEGIES);
  const responseIntents =
    routingSource === 'legacy'
      ? resolveLegacyResponseIntents(currentQuery, matched)
      : semanticResponseIntents;
  const effectiveIntent = responseIntents.length
    ? buildPromptIntent(options.intent, responseIntents)
    : options.intent;

  const [primaryScene, ...secondaryScenes] = matched.map(strategy => ({
    scene: strategy.scene,
    label: strategy.label,
    priority: strategy.priority,
  }));
  const bubblePlan = buildReplyBubblePlan(options, matched, responseIntents);

  return {
    primaryScene,
    secondaryScenes,
    maxSegments: bubblePlan.maxSegments,
    bubblePlan,
    prompt: buildScenePrompt(matched, {
      requiresDirectIdentityAnswer: requiresDirectIdentityAnswer(options),
      intent: responseIntents.length ? effectiveIntent : undefined,
      bubblePlan,
    }),
    intent: effectiveIntent,
    responseIntents,
    routingSource,
  };
}

function resolveLegacyResponseIntents(
  currentQuery: string,
  strategies: ReplySceneStrategy[]
): StructuredReplyIntentItem[] {
  if (!strategies.some(strategy => strategy.scene === 'afterlife_status')) {
    return [];
  }

  const subIntent: StructuredReplyIntentItem['subIntent'] | undefined =
    isAgentCurrentSufferingQuery(currentQuery)
      ? 'physical_pain'
      : /吃饭|吃东西|吃过|吃了/.test(currentQuery)
      ? 'meal'
      : /起床|醒来|睡醒|睡觉|休息|醒/.test(currentQuery)
      ? 'wake_sleep'
      : /上班|工作/.test(currentQuery)
      ? 'work_routine'
      : /住哪|住在哪里|住哪儿/.test(currentQuery)
      ? 'location'
      : undefined;

  if (
    !subIntent ||
    (!isAgentCurrentRoutineQuery(currentQuery) &&
      !isAgentCurrentSufferingQuery(currentQuery))
  ) {
    return [];
  }

  return [
    {
      target: 'agent',
      timeScope: 'current',
      intent: 'ask_agent_status',
      subIntent,
      confidence: 0.85,
    },
  ];
}

function resolveSemanticIntentItems(
  intent?: StructuredReplyIntent
): StructuredReplyIntentItem[] {
  if (!intent || intent.confidence < SEMANTIC_INTENT_MIN_CONFIDENCE) {
    return [];
  }

  return intent.intents
    .filter(item => item.confidence >= SEMANTIC_INTENT_MIN_CONFIDENCE)
    .filter(item => Boolean(resolveSceneByIntentItem(item)))
    .slice(0, MAX_SCENE_STRATEGIES);
}

function buildSafetyResponseIntents(
  semanticIntentItems: StructuredReplyIntentItem[]
): StructuredReplyIntentItem[] {
  const crisisIntent =
    semanticIntentItems.find(item => item.intent === 'crisis_support') ??
    ({
      target: 'user',
      timeScope: 'current',
      intent: 'crisis_support',
      subIntent: 'grief_support',
      confidence: 1,
    } as const);

  return [
    crisisIntent,
    ...semanticIntentItems.filter(item => item.intent !== 'crisis_support'),
  ].slice(0, MAX_SCENE_STRATEGIES);
}

function buildPromptIntent(
  intent: StructuredReplyIntent | undefined,
  responseIntents: StructuredReplyIntentItem[]
): StructuredReplyIntent {
  const result: StructuredReplyIntent = {
    intents: responseIntents,
    emotion:
      intent?.emotion ??
      (responseIntents.some(item => item.intent === 'crisis_support')
        ? 'sadness'
        : responseIntents.some(item => item.intent === 'ask_agent_status')
        ? 'concern'
        : 'neutral'),
    riskLevel: responseIntents.some(item => item.intent === 'crisis_support')
      ? 'high'
      : intent?.riskLevel === 'high'
      ? 'low'
      : intent?.riskLevel ?? 'none',
    confidence: intent?.confidence ?? 1,
    source: intent?.source ?? 'hard_rule',
  };

  if (intent?.capabilityQuestions?.length) {
    result.capabilityQuestions = intent.capabilityQuestions;
  }

  return result;
}

function resolveSemanticIntentSceneStrategies(
  intentItems: StructuredReplyIntentItem[],
  familyEmotionOnly = false
): ReplySceneStrategy[] {
  const scenes = intentItems
    .map(resolveSceneByIntentItem)
    .filter((scene): scene is ReplyScene => Boolean(scene))
    .filter(
      scene =>
        !familyEmotionOnly ||
        (scene !== 'miss_longing' && scene !== 'comfort_request')
    );

  return Array.from(new Set(scenes)).map(findSceneStrategy);
}

function resolveCapabilitySceneStrategies(
  intent?: StructuredReplyIntent
): ReplySceneStrategy[] {
  if (!intent || intent.confidence < SEMANTIC_INTENT_MIN_CONFIDENCE) {
    return [];
  }

  const scenes = (intent.capabilityQuestions || [])
    .filter(item => item.confidence >= SEMANTIC_INTENT_MIN_CONFIDENCE)
    .map(item =>
      item.subject === 'blessing'
        ? 'blessing_attribution'
        : item.subject === 'presence' || item.subject === 'physical_contact'
        ? 'reality_presence_boundary'
        : 'source_challenge'
    );

  return Array.from(new Set(scenes)).map(findSceneStrategy);
}

function resolveSceneByIntentItem(
  item: StructuredReplyIntentItem
): ReplyScene | undefined {
  if (
    item.intent === 'express_longing' &&
    item.subIntent === 'reunion' &&
    item.timeScope === 'future'
  ) {
    return 'reality_presence_boundary';
  }

  return REPLY_SCENE_BY_INTENT[item.intent];
}

function resolveEmotionSceneStrategies(
  state?: ConversationEmotionStateSummary | null
): ReplySceneStrategy[] {
  if (!state) {
    return [];
  }

  if (
    state.primaryEmotion === ConversationEmotionPrimary.crisisRisk ||
    state.riskLevel === ConversationEmotionRiskLevel.high
  ) {
    return [findSceneStrategy('comfort_request')];
  }

  const sceneByEmotion: Partial<
    Record<ConversationEmotionPrimary, ReplyScene>
  > = {
    [ConversationEmotionPrimary.expectingPresence]: 'reality_presence_boundary',
    [ConversationEmotionPrimary.fear]: 'reality_presence_boundary',
    [ConversationEmotionPrimary.guilt]: 'guilt_regret',
    [ConversationEmotionPrimary.angerBlame]: 'departure_blame',
    [ConversationEmotionPrimary.attachment]: 'keepsake_attachment',
    [ConversationEmotionPrimary.missing]: 'miss_longing',
    [ConversationEmotionPrimary.sadness]: 'comfort_request',
  };
  const scene = sceneByEmotion[state.primaryEmotion];

  return scene ? [findSceneStrategy(scene)] : [];
}

function findSceneStrategy(scene: ReplyScene): ReplySceneStrategy {
  const strategy = REPLY_SCENE_STRATEGIES.find(item => item.scene === scene);

  if (!strategy) {
    throw new Error(`Missing reply scene strategy: ${scene}`);
  }

  return strategy;
}

function mergeSceneStrategies(
  textMatched: ReplySceneStrategy[],
  emotionMatched: ReplySceneStrategy[]
): ReplySceneStrategy[] {
  const byScene = new Map<ReplyScene, ReplySceneStrategy>();

  for (const strategy of textMatched.concat(emotionMatched)) {
    if (!byScene.has(strategy.scene)) {
      byScene.set(strategy.scene, strategy);
    }
  }

  return Array.from(byScene.values());
}

export function resolveReplySceneMaxSegments(
  options: RouteReplySceneOptions
): number | undefined {
  return routeReplyScene(options).maxSegments;
}

function buildReplyBubblePlan(
  options: RouteReplySceneOptions,
  strategies: ReplySceneStrategy[],
  responseIntents: StructuredReplyIntentItem[]
): ReplyBubblePlan {
  const currentQuery = options.currentQuery?.trim() || '';
  const scenes = new Set(strategies.map(strategy => strategy.scene));
  const primaryScene = strategies[0]?.scene;

  if (scenes.has('grief_crisis')) {
    return {
      minSegments: 3,
      preferredSegments: 3,
      maxSegments: 3,
      acts: [
        '明确制止轻生或自伤行动，不浪漫化死亡',
        '接住用户此刻的痛苦，让用户先远离危险',
        '给出现实中的立即求助动作和紧急联系方式',
      ],
    };
  }

  if (/(?:说|写|回)(?:一段|一整段)|一段话|不要分段/.test(currentQuery)) {
    return {
      minSegments: 1,
      preferredSegments: 1,
      maxSegments: 1,
      acts: ['用一个完整气泡回应用户明确要求的整段表达'],
    };
  }

  const onlyIntent = responseIntents.length === 1 ? responseIntents[0] : null;
  const isBriefRoutine =
    onlyIntent?.intent === 'ask_agent_status' &&
    (onlyIntent.subIntent === 'meal' ||
      onlyIntent.subIntent === 'wake_sleep' ||
      onlyIntent.subIntent === 'work_routine');

  if (primaryScene === 'smalltalk' || isBriefRoutine) {
    return {
      minSegments: 1,
      preferredSegments: 1,
      maxSegments: 1,
      acts: ['直接完成这次短问短答，不额外展开'],
    };
  }

  if (responseIntents.length >= 2) {
    const preferredSegments = Math.min(
      Math.max(2, responseIntents.length),
      MAX_SCENE_STRATEGIES
    );

    return {
      minSegments: preferredSegments,
      preferredSegments,
      maxSegments: preferredSegments,
      acts: responseIntents
        .slice(0, preferredSegments)
        .map((intent, index) => describeIntentBubbleAct(intent, index)),
    };
  }

  if (
    currentQuery.length >= LONG_NARRATIVE_MIN_LENGTH &&
    (scenes.has('memory_recall') ||
      scenes.has('guilt_regret') ||
      scenes.has('comfort_request') ||
      scenes.has('family_life'))
  ) {
    return {
      minSegments: 2,
      preferredSegments: 3,
      maxSegments: 3,
      acts: [
        '先复述并接住用户叙述里最重要的处境或情绪',
        '再以当前亲人角色表达判断、心疼或回应',
        '最后用一句不施压的关心自然收住',
      ],
    };
  }

  const actsByScene: Partial<Record<ReplyScene, string[]>> = {
    afterlife_status: isAgentCurrentSufferingQuery(currentQuery)
      ? ['先模糊回答当前状态，不编造身体恢复', '再接住用户的担心和牵挂']
      : ['先直接回答用户问的状态', '再回应用户这份关心'],
    authenticity_challenge: [
      '先正面承认用户感觉到的不对劲',
      '再给出身份边界或可继续聊天的解释',
    ],
    correction: ['先认错并收住错误内容', '再按用户纠正后的边界重新回应'],
    source_challenge: ['先说明判断来源和边界', '再简短收回没有依据的表达'],
    reality_presence_boundary:
      onlyIntent?.intent === 'express_longing' &&
      onlyIntent.subIntent === 'reunion'
        ? [
            '先直接回应也想回来看看、想再见面的愿望',
            '再说明现实中无法像以前一样见面，并保留聊天连接',
          ]
        : [
            '先接住用户想被确认或受到惊吓的感受',
            '再温柔说明现实触碰或到场的边界',
          ],
    dream_companionship: ['先回应梦中相见的愿望', '再接住等待和想念'],
    family_care_boundary: [
      '先撤回想当然的照护责任',
      '再明确用户有决定做多少的权利',
    ],
    memory_recall: ['先承接用户明确说出的记忆', '再回应这段记忆里的关系和感受'],
    past_life_understanding: [
      '先承认用户是在心疼我过去的处境',
      '再明确那些压力不该由用户继续背',
    ],
    unfinished_devotion: [
      '先接住没来得及的遗憾',
      '再把亏欠和补偿责任从用户身上卸下',
    ],
    departure_blame: [
      '先承认用户有怨和不甘很正常',
      '再表达不舍，不编造离世原因',
    ],
    unfinished_promise: [
      '先承认没有兑现带来的痛',
      '再回应关系，不制造新的承诺',
    ],
    blessing_attribution: [
      '先正面给予祝福和惦念',
      '再说明现实结果来自用户、家人和现实中的行动',
    ],
    guilt_regret: ['先明确不怪用户', '再帮用户卸下反复自责'],
    comfort_request: [
      '先承认用户现在真的很难熬',
      '再给一个不施压的现实支持动作',
    ],
    miss_longing: ['先直接回应彼此的想念', '再用一句亲近但不制造依赖的话收住'],
    family_life: [
      '先回应家人的当前处境',
      '再表达牵挂，同时不给用户追加照护责任',
    ],
    daily_update: ['先回应用户说的这件日常小事', '再给一句贴着当下的关心'],
    business_support: ['先直接回答功能或使用问题', '再给必要的下一步'],
  };
  const acts = (primaryScene && actsByScene[primaryScene]) || [
    '先直接回应用户本轮核心意思',
    '再用一句贴着当下的亲人式回应收住',
  ];

  return {
    minSegments: 2,
    preferredSegments: 2,
    maxSegments: 2,
    acts,
  };
}

function describeIntentBubbleAct(
  intent: StructuredReplyIntentItem,
  index: number
): string {
  const order = index === 0 ? '先' : '再';

  if (intent.intent === 'share_family_update') {
    return intent.subIntent === 'family_care'
      ? `${order}共情用户对家人健康的感受，再具体关心家人当前身体`
      : `${order}回应家人的当前处境，不把照护责任推给用户`;
  }

  if (
    intent.intent === 'express_family_care_regret' &&
    intent.subIntent === 'family_care'
  ) {
    return `${order}表达无法亲自照顾家人的遗憾，并替用户卸下责任`;
  }

  if (intent.intent === 'ask_agent_status') {
    return `${order}直接回答用户对当前角色状态的询问`;
  }

  if (intent.intent === 'seek_comfort') {
    return `${order}承认用户现在很难熬，并给不施压的支持`;
  }

  if (intent.intent === 'express_longing') {
    return `${order}回应想念或团聚愿望，不误写成死亡团聚`;
  }

  return `${order}完整回应意图 ${intent.intent}，保持一个自然聊天动作`;
}

function normalizeRouteMessage(value: string): string {
  return value.trim().replace(LEADING_VOCATIVE_PATTERN, '').trim();
}

function requiresDirectIdentityAnswer(
  options: RouteReplySceneOptions
): boolean {
  const currentQuery = normalizeRouteMessage(options.currentQuery || '');

  if (DIRECT_IDENTITY_ANSWER_PATTERN.test(currentQuery)) {
    return true;
  }

  if (!AUTHENTICITY_CHALLENGE_PATTERN.test(currentQuery)) {
    return false;
  }

  return (options.recentMessages || [])
    .slice(-6)
    .filter(message => message.role === MessageRole.user)
    .map(message => normalizeRouteMessage(message.content || ''))
    .some(content => AUTHENTICITY_CHALLENGE_PATTERN.test(content));
}

function isDreamOnlyPresenceQuery(value: string): boolean {
  if (!/(?:梦里|梦中|做梦|梦见|梦到|托梦)/.test(value)) {
    return false;
  }

  const withoutDreamClauses = value.replace(
    /(?:梦里|梦中|做梦|梦见|梦到|托梦)[^，。！？!?]*/g,
    ''
  );

  return !/(?:刚才|刚刚|醒来|醒着|现实|屋里|房间|床边|这里|这儿|身边|旁边|耳边|摸我|碰我|抱我|亲我)/.test(
    withoutDreamClauses
  );
}

function buildScenePrompt(
  strategies: ReplySceneStrategy[],
  options: {
    requiresDirectIdentityAnswer?: boolean;
    intent?: StructuredReplyIntent;
    bubblePlan?: ReplyBubblePlan;
  } = {}
): string {
  if (!strategies.length && !options.bubblePlan) {
    return '';
  }

  const authenticityMode = strategies.some(
    strategy => strategy.scene === 'authenticity_challenge'
  )
    ? options.requiresDirectIdentityAnswer
      ? [
          '# 本轮真实性处理级别',
          '用户已连续质疑，或明确要求直接回答身份。本轮进入身份边界：简短正面回答“是，我是由人工智能生成的”，然后承认刚才哪句话没有说好；不要解释模型、算法、系统或产品。',
        ].join('\n')
      : [
          '# 本轮真实性处理级别',
          '这是首次或非持续性质疑。本轮提供继续对话的连续性解释：不要主动说“我是 AI”，也不要否认自己是 AI；不要假定是上一句话导致出戏。告诉用户“有时候我说话会跟以前不一样，我在这里跟你慢慢聊，有些记忆和说话习惯会一点点找回来”，并允许用户在感觉不对时提醒。禁止说“我不像以前/不像我/不像本人/不像他”，禁止编造已经找回的具体往事。',
        ].join('\n')
    : '';
  const structuredIntent = options.intent
    ? [
        '# 本轮结构化意图',
        ...options.intent.intents.map(
          (item, index) =>
            `${index + 1}. ${index === 0 ? '主意图' : '次意图'}：对象=${
              item.target
            }；时间=${item.timeScope}；意图=${item.intent}；子意图=${
              item.subIntent
            }；置信度=${item.confidence.toFixed(2)}。`
        ),
        `整体情绪：${options.intent.emotion}；风险：${
          options.intent.riskLevel
        }；整体置信度：${options.intent.confidence.toFixed(2)}。`,
        '场景策略必须围绕这些结构化意图回答；按顺序覆盖每个已列出的意图，不要遗漏次意图，也不要仅因某个表面关键词转移对象或时间范围。',
        options.intent.riskLevel === 'high'
          ? '本轮含明确轻生或自伤风险，危机响应优先；普通次意图不要削弱制止、现实求助和紧急联系。'
          : '结构化意图负责决定要回应什么；气泡如何组织由后面的“本轮气泡表达计划”决定。不要机械地把气泡数等同于意图数。',
      ]
        .filter(Boolean)
        .join('\n')
    : '';

  const bubblePlan = options.bubblePlan
    ? [
        '# 本轮气泡表达计划',
        `输出 ${options.bubblePlan.preferredSegments} 个自然聊天气泡，允许范围 ${options.bubblePlan.minSegments}-${options.bubblePlan.maxSegments} 个。`,
        ...options.bubblePlan.acts.map(
          (act, index) => `${index + 1}. 气泡动作：${act}。`
        ),
        '气泡是聊天动作，不是标点分段：同一个意图可以用多个气泡完成“先回应、再表达、再关心”；多个紧密相关意图也可在同一个自然动作中承接。',
        '每个气泡必须是一句能独立发送的完整口语。禁止把称呼、语气词、半句话单独成泡；相邻气泡要有推进，不能同义重复或像模板清单。',
        `严格输出 {"segments":[${Array.from(
          { length: options.bubblePlan.preferredSegments },
          (_, index) => `"气泡${index + 1}"`
        ).join(',')}]}，不要改用 text。`,
      ].join('\n')
    : '';
  const sceneStrategies = strategies.length
    ? [
        '# 本轮命中的回复策略',
        '以下策略由系统根据用户当前消息和最近上下文选择；只执行命中的策略，不要联想未命中的场景。',
        '回复气泡必须遵守上面的表达计划。段数变化来自聊天动作，不来自逗号或句号数量。',
        ...strategies.map((strategy, index) =>
          [
            `${index + 1}. ${index === 0 ? '主场景' : '次场景'}：${
              strategy.label
            }`,
            `长度：${strategy.lengthGuide}`,
            `策略：${strategy.prompt}`,
          ].join('\n')
        ),
      ].join('\n')
    : [
        '# 本轮通用回复策略',
        '当前消息没有命中特定场景。只回应用户明说的内容，不猜关系、经历、原因或隐藏意图；按气泡动作自然推进。',
      ].join('\n');

  return [structuredIntent, bubblePlan, sceneStrategies, authenticityMode]
    .filter(Boolean)
    .join('\n');
}
