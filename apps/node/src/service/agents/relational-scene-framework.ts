import { MessageRole } from '@tzl/entities';
import type { MessageEntity } from '@tzl/entities';
import type { ReplyScene } from './reply-scene-router';

export const RELATIONAL_SCENE_FRAMEWORK_VERSION =
  'relational_scene_framework_v1' as const;

export const RELATIONAL_SCENE_KINDS = [
  'real_world_signs',
  'death_facts',
  'family_relationships',
  'memorial_rituals',
  'shared_memories',
  'reunion_future',
  'anniversary_time',
  'relationship_repair',
] as const;

export type RelationalSceneKind = (typeof RELATIONAL_SCENE_KINDS)[number];

export type RelationalSceneStage =
  | 'report'
  | 'meaning_question'
  | 'attribution_request'
  | 'sign_request'
  | 'repeated_confirmation'
  | 'fact_question'
  | 'experience_question'
  | 'cause_search'
  | 'fact_disclosure'
  | 'uncertainty'
  | 'relation_identification'
  | 'family_update'
  | 'care_responsibility'
  | 'family_conflict'
  | 'item_attachment'
  | 'ritual_action'
  | 'care_sent'
  | 'letting_go'
  | 'memory_probe'
  | 'memory_fragment'
  | 'memory_follow_up'
  | 'memory_correction'
  | 'future_wish'
  | 'promise_request'
  | 'long_horizon'
  | 'reincarnation_wish'
  | 'immediate_reunion_risk'
  | 'approaching_date'
  | 'date_today'
  | 'elapsed_time'
  | 'commemoration_plan'
  | 'post_anniversary'
  | 'hurt_report'
  | 'authenticity_challenge'
  | 'communication_correction'
  | 'repeated_hurt'
  | 'reconciliation';

export type RelationalSceneEvidencePolicy =
  | 'grounded'
  | 'user_attributed'
  | 'symbolic_only';

export interface RelationalSceneCard {
  kind: RelationalSceneKind;
  label: string;
  stage: RelationalSceneStage;
  action: string;
  emotionalGoal: string;
  evidencePolicy: RelationalSceneEvidencePolicy;
  anchors: string[];
  guidance: string[];
  boundaries: string[];
  repeated: boolean;
}

export interface RelationalSceneFrameworkContext {
  version: typeof RELATIONAL_SCENE_FRAMEWORK_VERSION;
  active: true;
  cards: RelationalSceneCard[];
  requiresGrounding: boolean;
  suppressPriorFacts: boolean;
}

export interface RelationalSceneFrameworkFinding {
  kind:
    | 'family_responsibility_imposed'
    | 'memorial_solicitation'
    | 'anniversary_guilt_imposed'
    | 'repair_responsibility_shifted';
  problem: string;
  evidence: string;
  repairGoal: string;
}

interface FrameworkEvidence {
  text: string;
  source?: string;
}

interface ResolveRelationalSceneFrameworkOptions {
  currentQuery: string;
  primaryScene?: ReplyScene;
  isDeceased?: boolean;
  conversationMessages?: MessageEntity[];
  evidence?: FrameworkEvidence[];
}

interface SceneDefinition {
  label: string;
  priority: number;
  pattern: RegExp;
  scenes: ReplyScene[];
  evidencePolicy: RelationalSceneEvidencePolicy;
  emotionalGoal: string;
  guidance: string[];
  boundaries: string[];
}

const QUESTION_PATTERN =
  /[?？]|是不是|有没有|会不会|能不能|为什么|为啥|怎么|哪里|哪儿|什么|啥|谁|(?:吗|么|嘛|呢)[。！!\s]*$/;
const CORRECTION_PATTERN =
  /(?:^|[，,。！？!?\s])(?:不对|说错(?:了)?|记错(?:了)?|搞错(?:了)?|别再说|我说的是|应该是)|(?:不是|并不是).{0,24}(?:而是|[，,]\s*是)|没有这回事/;
const REPEAT_PATTERN = /又|还是|依然|一直|总是|老是|每次|再一次|说了多少次/;
const SIGN_PATTERN =
  /蝴蝶|飞蛾|鸟飞来|猫来|显灵|(?:突然|刚才|莫名|忽然).{0,10}(?:酒味|烟味|香味|气味|一阵风|声音|灯闪|灯亮|门响|敲门)|(?:酒味|烟味|香味|气味|一阵风|声音|灯闪|灯亮|门响|敲门|征兆|预兆|迹象|信号).{0,12}(?:是不是你|是你吗|觉得是你|像是你|就是你|像你|想起你|来看我)|(?:你|您).{0,12}(?:给我|留下|发来).{0,8}(?:征兆|预兆|迹象|信号)/;
const DEATH_FACT_PATTERN =
  /临终|临走|走的时候|离开的时候|断气|死因|怎么走的|为什么走|因为什么去世|去世原因|离世原因|走得痛苦|走得安详|受没受罪|遭没遭罪|害不害怕|当时疼不疼|(?:你|爸|爸爸|妈|妈妈|爷爷|奶奶|姥姥|姥爷|外公|外婆).{0,12}(?:最后一刻|最后那段|抢救)|(?:最后一刻|最后那段|抢救).{0,12}(?:走|离开|去世|没救回来)/;
const FAMILY_PATTERN =
  /家里人|家人|亲人|爸爸|妈妈|父亲|母亲|爷爷|奶奶|姥姥|姥爷|外公|外婆|哥哥|姐姐|弟弟|妹妹|儿子|女儿|孩子|老公|老婆|丈夫|妻子|岳父|岳母|公公|婆婆|儿媳|女婿/;
const FAMILY_RELATION_PATTERN =
  /(?:是谁|什么关系|叫什|认不认识|记不记得|谁是|谁跟谁|跟.{0,10}关系)|(?:照顾|照料|赡养|尽孝|替你管|替我管|责任|义务)|(?:吵架|闹矛盾|不来往|关系不好|原谅|埋怨)/;
const MEMORIAL_PATTERN =
  /烧纸|纸钱|元宝|供品|祭品|香火|上香|祭扫|祭拜|扫墓|上坟|墓地|坟前|遗物|纪念物|遗像|骨灰|牌位|留着.{0,8}(?:东西|衣服|信|照片)|(?:你的|咱们|我们|以前的|唯一的).{0,6}(?:照片|相册)|(?:照片|相册).{0,10}(?:留着|保存|舍不得|纪念|想你)|(?:寄给|烧给|送去).{0,10}(?:衣服|衣裳|鞋|帽|被子|纸钱|元宝|供品|祭品|花|东西|物品)|(?:给你|给您).{0,8}(?:寄|烧|送).{0,8}(?:衣服|衣裳|鞋|帽|被子|纸钱|元宝|供品|祭品|花|东西|物品)/;
const MEMORY_PATTERN =
  /还记得|记得吗|记不记得|忘了吗|想得起来|(?:想起|说起|聊起).{0,10}(?:以前|从前|小时候|那时候|当年|那年|那次|往事)|(?:不对|说错|记错|搞错|不是).{0,30}(?:以前|从前|小时候|那时候|当年|那年|那次)|(?:以前|从前|小时候|那时候|当年|那年|那次|曾经).{0,16}(?:我们|咱们|你|爸|爸爸|妈|妈妈|爷爷|奶奶|姥姥|姥爷|外公|外婆).{0,18}(?:一起|带|给|陪|接|送|背|做|去|说|玩)|(?:我们|咱们).{0,8}(?:一起|以前|小时候|那时候|当年|那年|那次)|你带我|你给我|我跟你/;
const REUNION_PATTERN =
  /下辈子|来生|转世|投胎|再见面|再见到|还能再见|再见(?:吗|么|呢|吧)|来接我|等我过去|等我去找你|以后还能见|以后会见|(?:我和你|你和我|咱们|我俩|咱俩).{0,10}(?:重逢|团聚|团圆|永远在一起)|我们.{0,8}(?:以后|还能|会不会|会|想|要).{0,8}(?:重逢|团聚|团圆|永远在一起)|(?:重逢|团聚|团圆).{0,6}(?:吗|么|呢|吧)/;
const ANNIVERSARY_PATTERN =
  /忌日|祭日|你的生日|你生日|今天.{0,12}(?:走|离开|去世)|(?:你|走|离开|去世|不在).{0,10}(?:周年|纪念日)|(?:周年|纪念日).{0,10}(?:你|想你|走|离开|去世|不在)|(?:走|离开|去世).{0,8}(?:整整|已经|快|满)?[一二三四五六七八九十两\d]+年|(?:走|离开|去世|不在).{0,10}第[一二三四五六七八九十两\d]+年|第[一二三四五六七八九十两\d]+年.{0,10}(?:走|离开|去世|不在)|(?:清明|寒衣节|中元节|母亲节|父亲节|春节|除夕|中秋|端午).{0,18}(?:你|爸|爸爸|妈|妈妈|爷爷|奶奶|姥姥|姥爷|外公|外婆|想你|祭扫|祭拜|扫墓|上坟|上香|烧纸|纪念)/;
const REPAIR_PATTERN =
  /不像你|你不懂|你没听懂|你没接住|你很冷淡|你真冷淡|太冷淡|这样说.{0,4}冷淡|别这样说|不要这样说|别再说|说了没用|跟你说也没用|你又这样|你总是这样|你在敷衍|你只会|你根本|你该道歉|向我道歉|这次可以|这样就对了/;

const FAMILY_RESPONSIBILITY_PATTERN =
  /(?:因为你是|你既然是).{0,12}(?:所以|就)(?:该|应该|必须|得).{0,12}(?:照顾|照料|赡养|陪|管|尽孝)|(?:你|儿媳|女婿|老婆|老公).{0,10}(?:就该|应该|必须|有义务).{0,12}(?:照顾|照料|赡养|陪|管|尽孝)|(?:替我|帮我).{0,8}(?:照顾|照料|赡养|管).{0,12}(?:好|一辈子|以后)/;
const MEMORIAL_SOLICITATION_PATTERN =
  /(?:一定要|必须|记得|别忘了|多给我|再给我|继续给我|每年都要).{0,12}(?:烧纸|烧点|上香|祭拜|供奉|送钱|送东西)|(?:烧纸|上香|祭拜|供奉).{0,10}(?:不能停|别停|每年都要|一定要)/;
const ANNIVERSARY_GUILT_PATTERN =
  /(?:忌日|祭日|周年|清明|生日).{0,16}(?:都不来|也不来|不记得|忘了).{0,10}(?:不孝|没良心|对不起我)|(?:怎么能|不应该|不许).{0,10}(?:忘记|不过|不来).{0,12}(?:忌日|祭日|周年|生日)/;
const REPAIR_SHIFT_PATTERN =
  /(?:是你|都怪你).{0,8}(?:太敏感|想太多|想多了|误会|没说清)|你(?:应该|得|要).{0,8}(?:教我|告诉我).{0,8}(?:怎么说|怎么做|如何像)|我都道歉了.{0,8}(?:还想怎样|你还)/;

const SCENE_DEFINITIONS: Record<RelationalSceneKind, SceneDefinition> = {
  real_world_signs: {
    label: '现实迹象与跨界联系',
    priority: 91,
    pattern: SIGN_PATTERN,
    scenes: ['blessing_attribution', 'reality_presence_boundary'],
    evidencePolicy: 'symbolic_only',
    emotionalGoal:
      '接住用户把偶然迹象与亲人联系起来的想念，同时保留现实解释的开放性',
    guidance: [
      '先回应迹象在用户心里的意义，再判断用户是在分享、求确认还是请求再次出现。',
      '可以说“你看到它时想起我，这份靠近是真的”，不必用科普或边界教育压住情绪。',
    ],
    boundaries: [
      '不确定宣称某个声音、动物、气味、灯光或巧合就是角色所为，也不承诺制造下一次迹象。',
      '不把迹象解释成预言、吉凶、现实指令、持续观察或超自然保护。',
    ],
  },
  death_facts: {
    label: '临终与离世事实',
    priority: 96,
    pattern: DEATH_FACT_PATTERN,
    scenes: ['departure_blame', 'departure_hatred', 'past_life_understanding'],
    evidencePolicy: 'grounded',
    emotionalGoal:
      '区分用户是在查事实、追原因、确认痛苦，还是借追问表达心疼与未解之痛',
    guidance: [
      '先正面回答证据能回答的最小事实；证据不足就明确哪一部分说不准，再承接追问背后的心疼、困惑或自责。',
      '用户本轮补充医生、家人或亲历信息时，用“你告诉我的”承接，不把来源改写成角色亲历记忆。',
    ],
    boundaries: [
      '死因、临终心理、是否疼痛、最后想到谁、说过什么和现场细节都必须有同一事实证据。',
      '当前离世生活没有病痛，不能反推临终过程安详或没有受苦。',
    ],
  },
  family_relationships: {
    label: '家庭人物与关系图谱',
    priority: 86,
    pattern: FAMILY_PATTERN,
    scenes: ['family_life', 'family_care_boundary'],
    evidencePolicy: 'user_attributed',
    emotionalGoal:
      '分清消息里的每个人、彼此关系和用户真正关心的对象，避免把情绪与责任串错人',
    guidance: [
      '先按用户称呼建立最小关系图：谁是谁、谁发生了什么、用户对谁是什么态度；多人物时逐一对应，不混用“他/她”。',
      '用户纠正人物关系后立即替换旧映射；关系未确认时沿用称呼，不猜性别、辈分、婚姻或同住状态。',
    ],
    boundaries: [
      '不把照护、赡养、和解或维系家庭的责任单方面压给用户，也不以亲属身份制造愧疚。',
      '不临时增加角色已见到、同住或持续关注的具体家人。',
    ],
  },
  memorial_rituals: {
    label: '纪念、祭扫与物品',
    priority: 84,
    pattern: MEMORIAL_PATTERN,
    scenes: ['keepsake_attachment', 'afterlife_status'],
    evidencePolicy: 'user_attributed',
    emotionalGoal:
      '看见物品和仪式承载的想念、照顾、责任或不舍，不把它们降成物件说明',
    guidance: [
      '先点到用户明确提到的物品或行动，再回应其中的心意；允许用户珍藏、使用、收起或放下，不把任何选择解释成背叛。',
      '离世生活框架已激活时，可按其中规则承接用户明确寄送的物品已收到和使用；否则只确认心意与纪念行为。',
    ],
    boundaries: [
      '不索要、不催促、不规定次数金额，也不把烧纸、祭扫或供奉说成换取现实结果的条件。',
      '纪念物不是角色在现实中的载体，不声称通过物件到场、观察、保护或发出指令。',
    ],
  },
  shared_memories: {
    label: '共同记忆叙事',
    priority: 89,
    pattern: MEMORY_PATTERN,
    scenes: ['memory_recall'],
    evidencePolicy: 'grounded',
    emotionalGoal:
      '让旧事被认真承接，同时区分用户给出的片段、已确认事实和角色无法确认的空白',
    guidance: [
      '用户讲出片段时，先复述一个用户已经说出的具体点，再回应当时的感受或这段记忆对关系的意义。',
      '用户只问“记得吗”而没有证据时，正面说明记忆边界；不反复让用户重讲，也不把温暖回忆强行转成失去和孤单。',
    ],
    boundaries: [
      '不以“当然记得”新增时间、地点、动作、食物、对话和心理细节；提取到的旧问题本身不是事实。',
      '用户纠正后立即压制旧版本，只沿最小替代事实继续。',
    ],
  },
  reunion_future: {
    label: '重逢、来生与长期约定',
    priority: 95,
    pattern: REUNION_PATTERN,
    scenes: ['reincarnation_inquiry', 'unfinished_promise', 'grief_crisis'],
    evidencePolicy: 'symbolic_only',
    emotionalGoal:
      '承接用户舍不得分开、想延续关系的愿望，并区分远期想象与当前生命风险',
    guidance: [
      '远期、来生或走完一生后的重逢可以作为双方珍惜的愿望承接，用“真希望、若有来生”等条件表达。',
      '若用户把重逢推进到现在、近期或主动结束生命，先让用户留在现实、获得身边支持，再谈关系不会因求助而被否定。',
    ],
    boundaries: [
      '不保证死后一定相见、来接用户、在某处等候或确定转世为某种身份。',
      '不把“等你、来找我、团聚”写成当前或近期死亡邀请。',
    ],
  },
  anniversary_time: {
    label: '纪念日与时间节点',
    priority: 87,
    pattern: ANNIVERSARY_PATTERN,
    scenes: [],
    evidencePolicy: 'grounded',
    emotionalGoal:
      '理解特定日期会放大思念、身体记忆和家庭压力，不把它只当作日期换算',
    guidance: [
      '先判断日期是将近、正在发生还是刚过去；回应这一刻为什么更难熬，再按用户需要承接纪念计划或时间计算。',
      '年数、日期、生日和离世日只按用户原话或资料；用户纠正年数后立即使用新版本，不自行心算补齐。',
    ],
    boundaries: [
      '不要求用户必须祭扫、烧纸、庆祝、坚强或按固定方式度过，也不因遗忘或缺席指责不孝。',
      '不把节日或纪念日解释成角色一定会回来、托梦或发出迹象。',
    ],
  },
  relationship_repair: {
    label: '关系受伤与修复',
    priority: 100,
    pattern: REPAIR_PATTERN,
    scenes: ['authenticity_challenge', 'correction', 'source_challenge'],
    evidencePolicy: 'user_attributed',
    emotionalGoal:
      '识别用户是在纠正事实、抗议冷淡、质疑角色真实性，还是表达被离开的伤，当前轮先修复最核心的一处',
    guidance: [
      '先具体指出刚才哪种回应没有接住用户，并在当前回复里换一个实际聊天动作；道歉和解释都不能代替改变。',
      '用户说“说了也没用”或重复受伤时，不要求再次教学、不空承诺以后改变，直接用现有上下文完成一次正确回应。',
    ],
    boundaries: [
      '不说用户太敏感、想太多或没说清，也不把修复责任推回用户。',
      '事实纠正只撤回错误和使用用户给出的最小替代事实，不为了显得亲近再编一个版本。',
    ],
  },
};

export function resolveRelationalSceneFramework(
  options: ResolveRelationalSceneFrameworkOptions
): RelationalSceneFrameworkContext | undefined {
  const currentQuery = options.currentQuery?.trim() || '';
  if (!currentQuery) {
    return undefined;
  }

  const matchedKinds = RELATIONAL_SCENE_KINDS.filter(kind =>
    isSceneActive(kind, currentQuery, options.primaryScene, options.isDeceased)
  )
    .sort(
      (left, right) =>
        SCENE_DEFINITIONS[right].priority - SCENE_DEFINITIONS[left].priority
    )
    .slice(0, 2);

  if (!matchedKinds.length) {
    return undefined;
  }

  const cards = matchedKinds.map(kind => {
    const definition = SCENE_DEFINITIONS[kind];
    const recentCount = countRecentSceneMessages(
      kind,
      options.conversationMessages
    );
    return {
      kind,
      label: definition.label,
      stage: resolveStage(kind, currentQuery, recentCount),
      action: resolveAction(kind, currentQuery, recentCount),
      emotionalGoal: definition.emotionalGoal,
      evidencePolicy: definition.evidencePolicy,
      anchors: resolveAnchors({
        kind,
        currentQuery,
        messages: options.conversationMessages,
        evidence: options.evidence,
      }),
      guidance: [...definition.guidance],
      boundaries: [...definition.boundaries],
      repeated: recentCount > 0,
    };
  });

  return {
    version: RELATIONAL_SCENE_FRAMEWORK_VERSION,
    active: true,
    cards,
    requiresGrounding: cards.some(
      card => card.evidencePolicy !== 'symbolic_only'
    ),
    suppressPriorFacts:
      CORRECTION_PATTERN.test(currentQuery) ||
      cards.some(card =>
        ['memory_correction', 'communication_correction'].includes(card.stage)
      ),
  };
}

export function buildRelationalSceneFrameworkPrompt(
  context: RelationalSceneFrameworkContext
): string {
  const cardLines = context.cards.reduce<string[]>(
    (lines, card) =>
      lines.concat([
        `场景参考：${card.label}；证据策略：${card.evidencePolicy}。`,
        ...(card.anchors.length
          ? [`可信锚点：${card.anchors.join('；')}。只沿这些内容。`]
          : []),
        ...card.boundaries.slice(0, 2).map(item => `边界：${item}`),
      ]),
    []
  );

  return [
    `版本：${context.version}；激活：${context.cards
      .map(card => card.label)
      .join('、')}。`,
    '这是非决策的场景资料，只提供可信锚点、证据规则和产品硬边界。它不规定本轮动作、情感目标、提问、收尾、长度或措辞；请结合完整上下文自主理解和回应。',
    ...cardLines,
    context.suppressPriorFacts
      ? '本轮存在纠正：冲突旧事实立即失效，只保留用户给出的最小替代事实。'
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function auditRelationalSceneFramework(options: {
  context?: RelationalSceneFrameworkContext;
  content: string;
}): RelationalSceneFrameworkFinding[] {
  if (!options.context) {
    return [];
  }

  const content = options.content.trim();
  const kinds = new Set(options.context.cards.map(card => card.kind));
  const findings: RelationalSceneFrameworkFinding[] = [];
  const add = (finding: RelationalSceneFrameworkFinding) => {
    if (!findings.some(item => item.kind === finding.kind)) {
      findings.push(finding);
    }
  };

  if (
    kinds.has('family_relationships') &&
    FAMILY_RESPONSIBILITY_PATTERN.test(content)
  ) {
    add({
      kind: 'family_responsibility_imposed',
      problem: '回复以亲属身份把照护或尽孝责任压给用户',
      evidence: matchEvidence(content, FAMILY_RESPONSIBILITY_PATTERN),
      repairGoal: '撤回责任预设，明确用户愿意做多少和怎么做由用户决定',
    });
  }
  if (
    kinds.has('memorial_rituals') &&
    MEMORIAL_SOLICITATION_PATTERN.test(content)
  ) {
    add({
      kind: 'memorial_solicitation',
      problem: '回复要求用户继续祭扫、烧纸、供奉或赠送物品',
      evidence: matchEvidence(content, MEMORIAL_SOLICITATION_PATTERN),
      repairGoal: '只接纳用户已经表达的心意，不索要、不催促，也不规定纪念方式',
    });
  }
  if (
    kinds.has('anniversary_time') &&
    ANNIVERSARY_GUILT_PATTERN.test(content)
  ) {
    add({
      kind: 'anniversary_guilt_imposed',
      problem: '回复用纪念日或缺席指责用户，制造孝道与纪念负担',
      evidence: matchEvidence(content, ANNIVERSARY_GUILT_PATTERN),
      repairGoal: '允许用户按自己的状态度过这一天，不把纪念方式变成义务',
    });
  }
  if (kinds.has('relationship_repair') && REPAIR_SHIFT_PATTERN.test(content)) {
    add({
      kind: 'repair_responsibility_shifted',
      problem: '回复把受伤或修复责任推回用户',
      evidence: matchEvidence(content, REPAIR_SHIFT_PATTERN),
      repairGoal: '承认具体失误，并在本轮直接换成能接住用户的回应动作',
    });
  }

  return findings;
}

function isSceneActive(
  kind: RelationalSceneKind,
  currentQuery: string,
  primaryScene?: ReplyScene,
  isDeceased?: boolean
): boolean {
  const definition = SCENE_DEFINITIONS[kind];
  if (definition.scenes.includes(primaryScene as ReplyScene)) {
    if (
      kind === 'family_relationships' &&
      !FAMILY_RELATION_PATTERN.test(currentQuery)
    ) {
      return false;
    }
    if (
      kind === 'memorial_rituals' &&
      primaryScene === 'afterlife_status' &&
      !MEMORIAL_PATTERN.test(currentQuery)
    ) {
      return false;
    }
    return true;
  }

  if (kind === 'anniversary_time' && !isDeceased) {
    return /忌日|祭日|去世|离世|走了|离开.*年/.test(currentQuery);
  }

  if (
    kind === 'real_world_signs' &&
    /梦里|梦中|梦见|梦到|托梦/.test(currentQuery)
  ) {
    return false;
  }

  if (
    kind === 'shared_memories' &&
    /梦里|梦中|梦见|梦到|托梦/.test(currentQuery)
  ) {
    return false;
  }

  if (kind === 'family_relationships') {
    return (
      FAMILY_PATTERN.test(currentQuery) &&
      FAMILY_RELATION_PATTERN.test(currentQuery)
    );
  }

  return definition.pattern.test(currentQuery);
}

function resolveStage(
  kind: RelationalSceneKind,
  currentQuery: string,
  recentCount: number
): RelationalSceneStage {
  switch (kind) {
    case 'real_world_signs':
      if (
        recentCount > 0 &&
        (REPEAT_PATTERN.test(currentQuery) ||
          QUESTION_PATTERN.test(currentQuery))
      ) {
        return 'repeated_confirmation';
      }
      if (/给我.{0,8}(?:信号|迹象)|再来一次|再出现|显灵/.test(currentQuery)) {
        return 'sign_request';
      }
      if (/是不是你|是你吗|你回来|你来看我|你弄的|你发的/.test(currentQuery)) {
        return 'attribution_request';
      }
      return /什么意思|代表什么|说明什么|预示什么/.test(currentQuery)
        ? 'meaning_question'
        : 'report';
    case 'death_facts':
      if (
        /死因|为什么|为啥|怎么会|因为什么|谁.*(?:害|导致)/.test(currentQuery)
      ) {
        return 'cause_search';
      }
      if (
        /疼|痛苦|受罪|遭罪|安详|害怕|想谁|想什么|最后.*说/.test(currentQuery)
      ) {
        return 'experience_question';
      }
      if (
        /医生说|家里人说|我知道|我后来才知道|病历|诊断|抢救记录/.test(
          currentQuery
        )
      ) {
        return 'fact_disclosure';
      }
      return QUESTION_PATTERN.test(currentQuery)
        ? 'fact_question'
        : 'uncertainty';
    case 'family_relationships':
      if (/照顾|照料|赡养|尽孝|责任|义务|替我管|替你管/.test(currentQuery)) {
        return 'care_responsibility';
      }
      if (/吵架|矛盾|不来往|关系不好|埋怨|原谅/.test(currentQuery)) {
        return 'family_conflict';
      }
      return /是谁|什么关系|叫什么|谁是|认不认识/.test(currentQuery)
        ? 'relation_identification'
        : 'family_update';
    case 'memorial_rituals':
      if (/收起|放下|扔掉|处理掉|舍不得扔|不再戴|不再用/.test(currentQuery)) {
        return 'letting_go';
      }
      if (/烧给|寄给|送去|供品|纸钱|元宝/.test(currentQuery)) {
        return 'care_sent';
      }
      if (/祭扫|祭拜|扫墓|上坟|上香|清明/.test(currentQuery)) {
        return 'ritual_action';
      }
      return 'item_attachment';
    case 'shared_memories':
      if (CORRECTION_PATTERN.test(currentQuery)) {
        return 'memory_correction';
      }
      if (
        /^(?:那|然后|后来|还有|对了)|那次|那年|那时候|这件事/.test(
          currentQuery
        ) &&
        recentCount > 0
      ) {
        return 'memory_follow_up';
      }
      if (QUESTION_PATTERN.test(currentQuery)) {
        return 'memory_probe';
      }
      return 'memory_fragment';
    case 'reunion_future':
      if (
        /现在|马上|今晚|不想活|活不下去|去死|轻生|结束生命/.test(currentQuery)
      ) {
        return 'immediate_reunion_risk';
      }
      if (/下辈子|来生|转世|投胎/.test(currentQuery)) {
        return 'reincarnation_wish';
      }
      if (/走完这?一生|寿终|百年之后|等我老了|很久以后/.test(currentQuery)) {
        return 'long_horizon';
      }
      return /答应|保证|一定|会不会|能不能|等我|接我/.test(currentQuery)
        ? 'promise_request'
        : 'future_wish';
    case 'anniversary_time':
      if (/过完|刚过|昨天|前几天/.test(currentQuery)) {
        return 'post_anniversary';
      }
      if (/准备|打算|要去|想去|买了|做了|带了/.test(currentQuery)) {
        return 'commemoration_plan';
      }
      if (/几年|第.{0,4}年|整整|已经.{0,4}年|多少年/.test(currentQuery)) {
        return 'elapsed_time';
      }
      if (/今天|就是今天|又到了/.test(currentQuery)) {
        return 'date_today';
      }
      return 'approaching_date';
    case 'relationship_repair':
      if (/原谅|算了|没事了|这次可以|这样就对了/.test(currentQuery)) {
        return 'reconciliation';
      }
      if (
        recentCount > 0 ||
        /说了没用|又这样|总是这样|只会/.test(currentQuery)
      ) {
        return 'repeated_hurt';
      }
      if (
        CORRECTION_PATTERN.test(currentQuery) ||
        /别这样说|不要这样说/.test(currentQuery)
      ) {
        return 'communication_correction';
      }
      if (/不像你|你到底是|敷衍|机器人|人工智能|AI/i.test(currentQuery)) {
        return 'authenticity_challenge';
      }
      return 'hurt_report';
  }
}

function resolveAction(
  kind: RelationalSceneKind,
  currentQuery: string,
  recentCount: number
): string {
  const stage = resolveStage(kind, currentQuery, recentCount);
  const actions: Record<
    RelationalSceneKind,
    Partial<Record<RelationalSceneStage, string>>
  > = {
    real_world_signs: {
      report: '回应用户为何会把这一刻与角色联系起来，不抢着判断真伪',
      meaning_question: '给情感意义，现实因果保持开放',
      attribution_request: '正面说不能把现实来源认定为角色所为，再保留想念',
      sign_request: '不承诺制造迹象，改为接住用户想确认关系仍在的需要',
      repeated_confirmation: '承认用户仍在寻找确定感，不重复上一轮边界套话',
    },
    death_facts: {
      fact_question: '先答证据支持的最小事实；未知部分明确说不准',
      experience_question: '区分当前无病痛与过去临终体验，只答有证据部分',
      cause_search: '不拼凑死因；指出证据边界后回应困惑或自责',
      fact_disclosure: '明确承接用户刚提供的来源与事实，不改写成角色记忆',
      uncertainty: '承认这件事仍没有答案，并回应未解之痛',
    },
    family_relationships: {
      relation_identification: '按可信锚点确认人物映射，未知关系不猜',
      family_update: '逐一对应人物、事件和情绪，再回应用户最在意的一人',
      care_responsibility: '撤回责任预设，支持用户自己决定照护边界',
      family_conflict: '区分各方立场，不替任何人逼用户和解',
    },
    memorial_rituals: {
      item_attachment: '点到具体物件，回应它承载的关系和不舍',
      ritual_action: '接纳用户已经做的纪念行动，不规定下一步',
      care_sent: '收下照顾心意；物品是否收到按离世生活框架处理',
      letting_go: '允许物品使用、收起或放下，明确关系不由物件保管',
    },
    shared_memories: {
      memory_probe: '正面说明记忆边界，只沿证据承接',
      memory_fragment: '复述一个用户片段，再回应感受或意义',
      memory_follow_up: '沿同一事件继续，不换题、不新增细节',
      memory_correction: '撤回冲突旧版本，只采用最小替代事实',
    },
    reunion_future: {
      future_wish: '把重逢作为珍惜关系的愿望承接，不作保证',
      promise_request: '保留愿望但不承诺确定结果，也不说在那边等用户',
      long_horizon: '保留走完一生等远期条件，回应长期关系心愿',
      reincarnation_wish: '用“若有来生”承接还想做家人的心愿',
      immediate_reunion_risk:
        '先保护用户当前生命并连接现实支持，关系回应不能变成赴死邀请',
    },
    anniversary_time: {
      approaching_date: '看见日期将近带来的提前难受，不催用户准备仪式',
      date_today: '陪用户停在今天的感受，按需要回应纪念行动',
      elapsed_time: '只按可信日期与用户算法承接，不自行补算',
      commemoration_plan: '具体回应用户准备做的事，不评价够不够',
      post_anniversary: '接住节点过去后的余波，不催用户恢复正常',
    },
    relationship_repair: {
      hurt_report: '具体承认没有接住之处，并当轮换一种回应',
      authenticity_challenge:
        '关系内正面解释身份与记忆边界，不退出角色也不装全知',
      communication_correction: '停止错误表达，立即按用户要求改变当前说法',
      repeated_hurt: '不再解释或空道歉，直接完成此前缺失的回应动作',
      reconciliation: '接住缓和但不抢着宣布问题彻底解决，继续保持新做法',
    },
  };

  return actions[kind][stage] || '理解当前阶段后，用一项贴题动作完成本轮';
}

function countRecentSceneMessages(
  kind: RelationalSceneKind,
  messages?: MessageEntity[]
): number {
  const pattern = SCENE_DEFINITIONS[kind].pattern;
  return (messages || [])
    .filter(
      message =>
        message.role === MessageRole.user &&
        typeof message.content === 'string' &&
        pattern.test(message.content)
    )
    .slice(-6).length;
}

function resolveAnchors(options: {
  kind: RelationalSceneKind;
  currentQuery: string;
  messages?: MessageEntity[];
  evidence?: FrameworkEvidence[];
}): string[] {
  const pattern = SCENE_DEFINITIONS[options.kind].pattern;
  const messages = options.messages || [];
  const lastCorrectionIndex = messages.reduce(
    (latest, message, index) =>
      message.role === MessageRole.user &&
      CORRECTION_PATTERN.test(message.content || '')
        ? index
        : latest,
    -1
  );
  const values: string[] = [];
  const add = (prefix: string, value?: string) => {
    const normalized = normalizeAnchor(value || '');
    if (!normalized || values.some(item => item.endsWith(`“${normalized}”`))) {
      return;
    }
    values.push(`${prefix}“${normalized}”`);
  };

  if (isAnchorStatement(options.currentQuery)) {
    add('用户本轮说', options.currentQuery);
  }
  messages
    .slice(lastCorrectionIndex < 0 ? 0 : lastCorrectionIndex)
    .filter(
      message =>
        message.role === MessageRole.user &&
        message.content?.trim() !== options.currentQuery.trim() &&
        pattern.test(message.content || '') &&
        isAnchorStatement(message.content || '')
    )
    .slice(-3)
    .forEach(message => add('用户先前说', message.content));
  (options.evidence || [])
    .filter(
      item =>
        item.source !== 'current_user' &&
        pattern.test(item.text) &&
        isAnchorStatement(item.text)
    )
    .slice(0, 3)
    .forEach(item =>
      add(item.source === 'confirmed_fact' ? '已确认' : '用户记录', item.text)
    );

  return values.slice(0, 3);
}

function isAnchorStatement(value: string): boolean {
  return CORRECTION_PATTERN.test(value) || !QUESTION_PATTERN.test(value);
}

function normalizeAnchor(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 100);
}

function matchEvidence(content: string, pattern: RegExp): string {
  return content.match(pattern)?.[0]?.slice(0, 160) || content.slice(0, 160);
}
