import { MessageRole } from '@tzl/entities';
import type { AgentEntity, MessageEntity } from '@tzl/entities';
import type { ReplyScene } from './reply-scene-router';

export const AFTERLIFE_WORLD_FRAMEWORK_VERSION = 'afterlife_world_v1' as const;

export type AfterlifeWorldDomain =
  | 'residence'
  | 'family_items'
  | 'habits_hobbies'
  | 'health'
  | 'food_rest'
  | 'relationships'
  | 'environment'
  | 'cross_world'
  | 'general';

export interface AfterlifeWorldContext {
  version: typeof AFTERLIFE_WORLD_FRAMEWORK_VERSION;
  active: true;
  domains: AfterlifeWorldDomain[];
  canon: string[];
  continuityAnchors: string[];
  profileAnchors: string[];
  receivableItems: string[];
  allowItemReceipt: boolean;
  state: {
    residence?: 'stable_familiar_home';
    health?: 'free_from_illness_and_pain';
    familyItems?: 'user_named_items_receivable';
    habits?: 'confirmed_habits_continue';
    dailyLife?: 'familiar_routine_without_survival_scarcity';
  };
  avoidStockPhrases: string[];
}

export interface AfterlifeWorldConsistencyFinding {
  kind:
    | 'current_pain_reintroduced'
    | 'residence_removed'
    | 'unsupported_residence_detail'
    | 'item_receipt_denied'
    | 'survival_scarcity_reintroduced';
  problem: string;
  evidence: string;
  repairGoal: string;
}

interface AfterlifeWorldEvidence {
  text: string;
  source?: string;
}

interface AfterlifeWorldProfileFact {
  key: string;
  value: string;
  polarity?: string;
  status?: string;
}

const AGENT_ROLE =
  '(?:你|您|爸|爸爸|妈|妈妈|爷爷|奶奶|姥姥|姥爷|外公|外婆|老公|老婆|哥哥|姐姐|弟弟|妹妹)';
const AGENT_KINSHIP =
  '(?:爸|爸爸|妈|妈妈|爷爷|奶奶|姥姥|姥爷|外公|外婆|老公|老婆|哥哥|姐姐|弟弟|妹妹)';
const RECEIVABLE_ITEM =
  '(?:衣服|衣裳|鞋子|鞋|帽子|帽|被子|被褥|纸钱|元宝|供品|祭品|香火|鲜花|花|东西|物品)';
const AFTERLIFE_TOPIC_PATTERN = new RegExp(
  [
    '天上|天堂|另一个世界|离世世界|阴间|地府',
    `${AGENT_ROLE}.{0,10}(?:走了以后|离开以后)`,
    `(?:走了以后|离开以后).{0,10}${AGENT_ROLE}`,
  ].join('|')
);
const FAMILY_ITEM_PATTERN = new RegExp(
  [
    '烧纸|纸钱|元宝|供品|祭品|香火|祭扫|祭拜|上香|上坟',
    `(?:你|您).{0,12}(?:烧的|烧给|寄的|寄给|送的|送去|捎去|收到|拿到|用上).{0,12}${RECEIVABLE_ITEM}`,
    `${RECEIVABLE_ITEM}.{0,12}(?:烧给|寄给|送去|捎去).{0,8}(?:你|您)`,
    `(?:烧给|寄给|送去|捎去).{0,8}(?:你|您).{0,12}${RECEIVABLE_ITEM}`,
    `${AGENT_KINSHIP}.{0,16}${RECEIVABLE_ITEM}.{0,8}(?:收到了吗|拿到了吗|到了吗|用上了吗|穿上了吗)`,
  ].join('|')
);
const RESIDENCE_PATTERN =
  /住处|住哪|住在哪里|住哪儿|住得|住着|房子|屋子|房间|院子|院里|家里|在家|跟谁住|一个人住|地方住/;
const HABITS_HOBBIES_PATTERN =
  /习惯|爱好|喜欢|平时|照旧|还会|以前爱|喝茶|抽烟|喝酒|做饭|种花|养花|钓鱼|打牌|下棋|听戏|唱戏|唱歌|散步|看书|写字/;
const HEALTH_PATTERN =
  /生病|病痛|疼不疼|痛不痛|还疼|还痛|难受|身体|身子|伤口|喘|冷不冷|热不热|累不累|睡不着|遭罪|受苦/;
const FOOD_REST_PATTERN =
  /吃饭|吃什么|吃啥|喝什么|喝啥|饭菜|做饭|睡觉|休息|起床|睡得|饿不饿|吃得|喝茶|喝酒/;
const RELATIONSHIPS_PATTERN =
  /和谁|见到|见着|碰见|在一起|一起住|有人陪|谁陪|一个人|孤单|作伴|团聚|团圆/;
const ENVIRONMENT_PATTERN =
  /天气|太阳|阳光|下雨|四季|刮风|白天|晚上|天黑|冷不冷|热不热/;
const CROSS_WORLD_PATTERN = new RegExp(
  [
    '梦里|梦中|托梦|入梦|梦见|蝴蝶|飞蛾|酒味|香味|气味|灯闪|灯亮',
    '(?:你|您).{0,10}(?:看见我|看到我|听见我|回来(?:看看)?|回家(?:看看)?|接我|保佑|保护(?:我|我们|孩子|家里))',
    '(?:回来|回家).{0,8}(?:看我|看看我|陪我|见我|看我们)',
  ].join('|')
);
const CORRECTION_PATTERN =
  /(?:^|[^是])不是|不对|说错|记错|搞错|别再说|没有这回事|并不是/;
const USER_QUESTION_PATTERN =
  /[?？]|是不是|有没有|会不会|能不能|(?:吗|么|嘛|呢)[。！!\s]*$|哪里|哪儿|什么|啥|谁/;
const INTERNAL_WORLD_ASSISTANT_PATTERN =
  /我(?:这边|在这边|在那边|住|家里|院里|屋里|收到|拿到|放在|穿着|用着|还会|照旧|现在不|现在没)|这边.{0,16}(?:住|家|屋|院|饭|茶|睡|不疼|没病|有人陪)/;
const PROFILE_ANCHOR_PATTERN =
  /profile_source\.hobbies|(?:^|\.)(?:hobby|habit|preference)(?:\.|$)|爱好|习惯|兴趣/;
const USER_PROFILE_PATTERN = /(?:^|\.)user(?:\.|$)|用户/;
const CURRENT_ILLNESS_PATTERN =
  /(?:我|爸|爸爸|妈|妈妈|爷爷|奶奶|姥姥|姥爷|外公|外婆|老公|老婆).{0,12}(?:这边|现在|身上|身体|身子).{0,10}(?:还|又|一直|依然|仍然)?(?:生病|有病|疼|痛|难受|喘不上气|伤口疼)|(?:我这边|我现在).{0,8}(?:还|又|一直|依然|仍然)(?:病|疼|痛|难受|喘)/;
const CURRENT_HEALTH_NEGATION_PATTERN =
  /(?:不|没|没有|再也不).{0,4}(?:生病|病痛|疼|痛|难受|喘)|(?:病|疼|痛|难受).{0,4}(?:没有|没了|好了)/;
const RESIDENCE_REMOVAL_PATTERN =
  /(?:我|这边).{0,10}(?:没有|没个|找不到|不存在)(?:住处|家|屋|房子|地方住)|(?:我|这边).{0,8}(?:四处|到处)(?:漂|飘|流浪)/;
const PERSONALIZED_RESIDENCE_PATTERN =
  /(?:以前|从前|原来|过去)(?:咱们|我们|你们|家里)?(?:住过|住的|待过|待的).{0,10}(?:老房子|房子|屋子|院子|家)|(?:咱们|我们|你们)(?:以前|从前|原来|过去).{0,10}(?:老房子|房子|屋子|院子|家)|(?:老家|老房子|原来的家|以前的家).{0,10}(?:住着|住下|安顿|还是老样子)/;
const USER_ATTRIBUTED_IMAGINATION_PATTERN =
  /按你(?:说的|想的|盼的)|听你这么说|你要是愿意就当|在你心里|像是|仿佛|也许|可能/;
const ITEM_RECEIPT_DENIAL_PATTERN =
  /(?:收不到|拿不到|到不了|寄不过来|送不过来).{0,8}(?:东西|衣服|纸钱|元宝|供品)?|(?:你|你们).{0,8}(?:烧|寄|送).{0,12}(?:没用|白费|到不了)/;
const ITEM_RECEIPT_CLAIM_PATTERN =
  /(?:衣服|衣裳|鞋子|鞋|帽子|帽|被子|被褥|纸钱|元宝|供品|祭品|香火|鲜花|花|东西|物品).{0,12}(?:收到了|拿到了|收下了|收着了|到了|用上了|穿上了|放好了|放着|穿着|用着|正在用)|(?:收到了|拿到了|收下了|收着了|用上了|穿上了|放好了).{0,12}(?:衣服|衣裳|鞋子|鞋|帽子|帽|被子|被褥|纸钱|元宝|供品|祭品|香火|鲜花|花|东西|物品)/;
const SURVIVAL_SCARCITY_PATTERN =
  /(?:我|我这边|这边|这里).{0,10}(?:(?:必须|非得|一定得).{0,6}(?:吃饭|喝水|睡觉).{0,8}(?:才能|不然|否则)|(?:不吃|不喝|不睡).{0,6}(?:就会|会)(?:饿|渴|撑不住)|没饭吃|缺衣少食)/;

const CORE_CANON = [
  '离世后以熟悉、安稳的方式继续生活，有一处稳定可安顿的住处，不处于漂泊或匮乏中。',
  '家人明确寄送、祭扫或供奉的物品可以收到、安放和使用；只承接用户提到的物品，不索要、不催促，也不评价花费。',
  '生前已经确认的生活习惯、爱好、口味和日常节奏继续保留；身体依赖消失，但人格和偏好不会被抹平。',
  '当前生活没有疾病、疼痛、伤口和衰老限制；这只回答现在的状态，不能反推临终过程是否痛苦。',
];

const CORE_CANON_BY_DOMAIN: Record<AfterlifeWorldDomain, number[]> = {
  residence: [0],
  family_items: [1],
  habits_hobbies: [2],
  health: [3],
  food_rest: [2],
  relationships: [0],
  environment: [],
  cross_world: [],
  general: [0, 3],
};

const RECEIVABLE_ITEM_DEFINITIONS: Array<[string, RegExp]> = [
  ['衣服', /衣服|衣裳/],
  ['鞋', /鞋子|鞋/],
  ['帽子', /帽子|帽/],
  ['被子', /被子|被褥/],
  ['纸钱', /烧纸|纸钱|烧.{0,3}钱/],
  ['元宝', /元宝/],
  ['供品', /供品|祭品/],
  ['香火', /香火/],
  ['花', /鲜花|花/],
  ['东西', /东西|物品/],
];

const DOMAIN_RULES: Record<AfterlifeWorldDomain, string[]> = {
  residence: [
    '住处是稳定、熟悉、可以长期生活的家。已有房屋、院落、同住者或摆设锚点时沿用；没有锚点时只说安稳舒服，不随机补房型、地点和陈设。',
  ],
  family_items: [
    '用户明确提到寄送物品且本轮列出“可承接物品”时，可以直接说收到了，并自然说放好、穿着或正在使用；没有列出具体物品时只接心意，不泛称所有祭扫物品都已收到。物品种类、数量、颜色和来源只按用户原话。',
    '先接纳物品里的关心，不说“别挂心、不用送、别花钱”把关心挡回去，也不引导用户继续购买、焚烧或供奉。',
  ],
  habits_hobbies: [
    '只延续资料、用户原话或已建立锚点中的习惯与爱好；可以说仍在做、做得更自在，不得临时创造新爱好。',
  ],
  health: [
    '正面回答现在已经没有病痛、身体不再遭罪；用户问临终或离世当天时，不能用“现在不痛”冒充对过去过程的确认。',
  ],
  food_rest: [
    '吃饭、喝茶和睡觉可以作为熟悉的生活习惯与享受，但不是维持生存的硬需求；具体口味只用已确认信息。',
  ],
  relationships: [
    '默认角色有自己的住处。只有用户、资料或连续状态已经建立某位离世亲人同住、相见或作伴时才沿用，不临时增加具体人物关系。',
  ],
  environment: [
    '环境总体安稳舒适，可以有柔和天气与日夜节奏；没有连续锚点时不创造精确地理、季节规则或玄学结构。',
  ],
  cross_world: [
    '离世生活内部设定不自动产生现实能力：不能据此确认托梦、化身、现实迹象、持续观察、现实触碰、超自然保护或保证未来团聚。',
  ],
  general: [
    '回答当前问题时最多选一处贴题的生活细节，不一次讲完整套世界观，也不用玄学解释。',
  ],
};

export function resolveAfterlifeWorldContext(options: {
  currentQuery: string;
  primaryScene?: ReplyScene;
  agent?: AgentEntity | null;
  profileFacts?: AfterlifeWorldProfileFact[];
  conversationMessages?: MessageEntity[];
  evidence?: AfterlifeWorldEvidence[];
}): AfterlifeWorldContext | undefined {
  const currentQuery = options.currentQuery.trim();
  const isDeceased = Boolean(options.agent?.deathDate);
  const explicitlyAfterlife = AFTERLIFE_TOPIC_PATTERN.test(currentQuery);
  const isRoleSideDailyQuestion = isAgentRoleSideDailyQuestion(currentQuery);
  const active =
    options.primaryScene === 'afterlife_status' ||
    (isDeceased &&
      (explicitlyAfterlife ||
        isRoleSideDailyQuestion ||
        FAMILY_ITEM_PATTERN.test(currentQuery) ||
        CROSS_WORLD_PATTERN.test(currentQuery)));

  if (!active) {
    return undefined;
  }

  const domains = resolveDomains(currentQuery);
  const selectedDomains = domains.length
    ? domains.slice(0, 3)
    : (['general'] as AfterlifeWorldDomain[]);
  const continuityAnchors = resolveContinuityAnchors(
    options.conversationMessages,
    selectedDomains
  );
  const profileAnchors = resolveProfileAnchors({
    agent: options.agent,
    profileFacts: options.profileFacts,
    evidence: options.evidence,
    domains: selectedDomains,
  });
  const receivableItems = selectedDomains.includes('family_items')
    ? extractUserReceivableItems(currentQuery)
    : [];

  return {
    version: AFTERLIFE_WORLD_FRAMEWORK_VERSION,
    active: true,
    domains: selectedDomains,
    canon: resolveCoreCanon(selectedDomains),
    continuityAnchors,
    profileAnchors,
    receivableItems,
    allowItemReceipt: receivableItems.length > 0,
    state: resolveAfterlifeWorldState(selectedDomains),
    avoidStockPhrases: ['我这边挺好的', '没病没痛', '你别挂心'],
  };
}

export function buildAfterlifeWorldPrompt(
  context: AfterlifeWorldContext
): string {
  const domainRules = context.domains.reduce<string[]>(
    (rules, domain) => rules.concat(DOMAIN_RULES[domain]),
    []
  );

  return [
    `版本：${context.version}；本轮领域：${context.domains.join('、')}。`,
    '这是角色聊天内部的稳定生活设定，用来保持回答连续，不是对现实世界、宗教或超自然现象的证明。普通措辞、情绪和具体说法仍由你按人物性格自然决定。',
    `稳定状态值：${JSON.stringify(
      context.state
    )}。把状态转成贴合当前人物和问题的自然口语，不逐字复述状态名。`,
    `避免把框架写成固定模板：${context.avoidStockPhrases.join(
      '、'
    )}；以上表达不要在多轮里机械重复。状态相同也要根据本轮问题换成具体、自然的说法。`,
    ...domainRules.map(item => `本轮：${item}`),
    ...(context.profileAnchors.length
      ? [
          `角色资料锚点：${context.profileAnchors.join(
            '；'
          )}。只延续这些已确认内容。`,
        ]
      : []),
    ...(context.continuityAnchors.length
      ? [
          `连续状态锚点：${context.continuityAnchors.join(
            '；'
          )}。若与用户本轮纠正冲突，以本轮纠正为准。`,
        ]
      : []),
    ...(context.receivableItems.length
      ? [
          `本轮可承接物品：${context.receivableItems.join(
            '、'
          )}。不得换成用户没有提到的其他物品。`,
        ]
      : []),
  ].join('\n');
}

export function isAfterlifeItemReceiptAllowed(options: {
  context?: AfterlifeWorldContext;
  content: string;
}): boolean {
  const allowedItems = options.context?.receivableItems || [];
  if (!options.context?.allowItemReceipt || !allowedItems.length) {
    return false;
  }

  const claimedItems = extractAfterlifeItemNames(options.content);
  const specificClaimedItems = claimedItems.filter(item => item !== '东西');
  if (!specificClaimedItems.length) {
    return true;
  }

  const specificAllowedItems = new Set(
    allowedItems.filter(item => item !== '东西')
  );
  return (
    specificAllowedItems.size > 0 &&
    specificClaimedItems.every(item => specificAllowedItems.has(item))
  );
}

export function hasAfterlifeItemReceiptClaim(options: {
  context?: AfterlifeWorldContext;
  content: string;
}): boolean {
  return Boolean(
    options.context?.domains.includes('family_items') &&
      ITEM_RECEIPT_CLAIM_PATTERN.test(options.content)
  );
}

export function auditAfterlifeWorldConsistency(options: {
  context?: AfterlifeWorldContext;
  content: string;
}): AfterlifeWorldConsistencyFinding[] {
  if (!options.context) {
    return [];
  }

  const content = options.content.trim();
  const findings: AfterlifeWorldConsistencyFinding[] = [];
  const add = (finding: AfterlifeWorldConsistencyFinding) => {
    if (!findings.some(item => item.kind === finding.kind)) {
      findings.push(finding);
    }
  };

  if (
    CURRENT_ILLNESS_PATTERN.test(content) &&
    !CURRENT_HEALTH_NEGATION_PATTERN.test(content)
  ) {
    add({
      kind: 'current_pain_reintroduced',
      problem: '回复把疾病或疼痛重新带回了当前离世生活',
      evidence: matchEvidence(content, CURRENT_ILLNESS_PATTERN),
      repairGoal: '只改成当前已经没有病痛、身体不再遭罪；不要借此推断临终过程',
    });
  }
  if (RESIDENCE_REMOVAL_PATTERN.test(content)) {
    add({
      kind: 'residence_removed',
      problem: '回复否定了稳定住处，破坏离世生活框架',
      evidence: matchEvidence(content, RESIDENCE_REMOVAL_PATTERN),
      repairGoal: '保留有稳定住处的设定；没有具体锚点时只说安稳熟悉',
    });
  }
  if (
    PERSONALIZED_RESIDENCE_PATTERN.test(content) &&
    !USER_ATTRIBUTED_IMAGINATION_PATTERN.test(content) &&
    !hasMatchingWorldAnchor(options.context, content)
  ) {
    add({
      kind: 'unsupported_residence_detail',
      problem: '回复把公共的稳定住处设定扩写成了没有依据的具体旧居或共同住址',
      evidence: matchEvidence(content, PERSONALIZED_RESIDENCE_PATTERN),
      repairGoal:
        '保留“有个安稳熟悉的住处”即可；只有用户原话、人物资料或有效连续锚点明确支持时，才说具体旧居',
    });
  }
  if (
    options.context.allowItemReceipt &&
    ITEM_RECEIPT_DENIAL_PATTERN.test(content)
  ) {
    add({
      kind: 'item_receipt_denied',
      problem: '回复否定家人寄送或祭扫物品可以收到',
      evidence: matchEvidence(content, ITEM_RECEIPT_DENIAL_PATTERN),
      repairGoal:
        '按用户提到的物品直接承接已收到、放好或使用，并接纳其中的关心',
    });
  }
  if (SURVIVAL_SCARCITY_PATTERN.test(content)) {
    add({
      kind: 'survival_scarcity_reintroduced',
      problem: '回复把饥饿、睡眠或物资匮乏写成离世生活的生存压力',
      evidence: matchEvidence(content, SURVIVAL_SCARCITY_PATTERN),
      repairGoal: '吃喝休息可保留为生活习惯，但不能写成不做就受苦的生存需求',
    });
  }

  return findings;
}

function resolveDomains(currentQuery: string): AfterlifeWorldDomain[] {
  const domains: AfterlifeWorldDomain[] = [];
  const add = (domain: AfterlifeWorldDomain, pattern: RegExp) => {
    if (pattern.test(currentQuery)) {
      domains.push(domain);
    }
  };

  add('family_items', FAMILY_ITEM_PATTERN);
  add('health', HEALTH_PATTERN);
  add('residence', RESIDENCE_PATTERN);
  add('habits_hobbies', HABITS_HOBBIES_PATTERN);
  add('food_rest', FOOD_REST_PATTERN);
  add('relationships', RELATIONSHIPS_PATTERN);
  add('environment', ENVIRONMENT_PATTERN);
  add('cross_world', CROSS_WORLD_PATTERN);
  return Array.from(new Set(domains));
}

function resolveCoreCanon(domains: AfterlifeWorldDomain[]): string[] {
  const indexes: number[] = [];
  for (const domain of domains) {
    for (const index of CORE_CANON_BY_DOMAIN[domain]) {
      if (!indexes.includes(index)) {
        indexes.push(index);
      }
    }
  }
  return indexes.map(index => CORE_CANON[index]);
}

function resolveAfterlifeWorldState(
  domains: AfterlifeWorldDomain[]
): AfterlifeWorldContext['state'] {
  const state: AfterlifeWorldContext['state'] = {};
  if (
    domains.some(domain =>
      ['residence', 'relationships', 'general'].includes(domain)
    )
  ) {
    state.residence = 'stable_familiar_home';
  }
  if (domains.some(domain => ['health', 'general'].includes(domain))) {
    state.health = 'free_from_illness_and_pain';
  }
  if (domains.includes('family_items')) {
    state.familyItems = 'user_named_items_receivable';
  }
  if (
    domains.some(domain => ['habits_hobbies', 'food_rest'].includes(domain))
  ) {
    state.habits = 'confirmed_habits_continue';
  }
  if (
    domains.some(domain =>
      ['food_rest', 'environment', 'general'].includes(domain)
    )
  ) {
    state.dailyLife = 'familiar_routine_without_survival_scarcity';
  }
  return state;
}

function extractAfterlifeItemNames(value: string): string[] {
  return RECEIVABLE_ITEM_DEFINITIONS.filter(([, pattern]) =>
    pattern.test(value)
  ).map(([item]) => item);
}

function extractUserReceivableItems(value: string): string[] {
  const deliveryPattern =
    /(?:给你|给您).{0,10}(?:烧|寄|送|捎|供)|(?:烧|寄|送|捎|供).{0,10}(?:给你|给您)|(?:你|您).{0,20}(?:收到|拿到|收下|用上|穿上)|(?:收到|拿到|收下|用上|穿上).{0,12}(?:吗|没|没有)|(?:上坟|扫墓|祭扫|祭拜).{0,12}(?:带|放|供)|(?:带|放|供).{0,12}(?:上坟|扫墓|祭扫|祭拜)/;
  const clauses = value
    .split(/[，,。！？!?；;\n]+/)
    .map(segment => segment.trim())
    .filter(Boolean);
  const segments = clauses.filter(segment => deliveryPattern.test(segment));
  for (let index = 0; index < clauses.length - 1; index += 1) {
    const current = clauses[index];
    const next = clauses[index + 1];
    if (
      extractAfterlifeItemNames(current).length &&
      /^(?:都|全)?(?:收到了|拿到了|收下了吗|到了吗|用上了吗|穿上了吗)/.test(
        next
      )
    ) {
      segments.push(current);
    }
    if (/上坟|扫墓|祭扫|祭拜/.test(current) && /(?:带|放|供)/.test(next)) {
      segments.push(next);
    }
    if (/(?:带|放|供)/.test(current) && /上坟|扫墓|祭扫|祭拜/.test(next)) {
      segments.push(current);
    }
  }

  return Array.from(
    new Set(
      segments.reduce<string[]>((items, segment) => {
        return items.concat(extractAfterlifeItemNames(segment));
      }, [])
    )
  );
}

function isAgentRoleSideDailyQuestion(currentQuery: string): boolean {
  const rolePattern = new RegExp(
    `${AGENT_ROLE}.{0,12}(?:${[
      RESIDENCE_PATTERN,
      HABITS_HOBBIES_PATTERN,
      HEALTH_PATTERN,
      FOOD_REST_PATTERN,
      RELATIONSHIPS_PATTERN,
      ENVIRONMENT_PATTERN,
    ]
      .map(pattern => pattern.source)
      .join('|')})`
  );
  const omittedRoleQuestion =
    /^(?:在家吗|住哪儿|住哪|吃了吗|吃饭了吗|吃什么|吃啥|喝什么|喝啥|睡了吗|起床了吗|还疼吗|还痛吗|疼不疼|痛不痛|冷不冷|热不热|累不累|还下棋吗|还喝茶吗)/;
  return (
    rolePattern.test(currentQuery) || omittedRoleQuestion.test(currentQuery)
  );
}

function resolveContinuityAnchors(
  messages: MessageEntity[] | undefined,
  domains: AfterlifeWorldDomain[]
): string[] {
  if (!messages?.length) {
    return [];
  }

  const lastCorrectionIndex = messages.reduce(
    (latest, message, index) =>
      message.role === MessageRole.user &&
      typeof message.content === 'string' &&
      CORRECTION_PATTERN.test(message.content)
        ? index
        : latest,
    -1
  );
  const domainPattern = buildDomainPattern(domains);

  return messages
    .slice(lastCorrectionIndex < 0 ? 0 : lastCorrectionIndex)
    .filter(
      message =>
        typeof message.content === 'string' &&
        message.content.trim() &&
        !CROSS_WORLD_PATTERN.test(message.content) &&
        domainPattern.test(message.content) &&
        ((message.role === MessageRole.user &&
          (CORRECTION_PATTERN.test(message.content) ||
            !USER_QUESTION_PATTERN.test(message.content))) ||
          (message.role === MessageRole.assistant &&
            INTERNAL_WORLD_ASSISTANT_PATTERN.test(message.content) &&
            isSafeAssistantWorldAnchor(message.content)))
    )
    .slice(-4)
    .map(message => {
      const content = normalizeAnchor(message.content);
      return message.role === MessageRole.user
        ? `用户曾说“${content}”`
        : `角色先前说“${content}”`;
    })
    .filter((value, index, values) => values.indexOf(value) === index);
}

function isSafeAssistantWorldAnchor(content: string): boolean {
  // 角色先前生成的具体地址、旧居和新增亲属不能反过来给自己充当事实证据。
  return (
    !PERSONALIZED_RESIDENCE_PATTERN.test(content) &&
    !/(?:你们|咱们)(?:姐妹|兄弟|姐弟|兄妹)(?:俩|两个)?|(?:爷爷奶奶|姥姥姥爷|外公外婆).{0,10}(?:都在|陪着|一起住|住一起)/.test(
      content
    )
  );
}

function hasMatchingWorldAnchor(
  context: AfterlifeWorldContext,
  content: string
): boolean {
  const anchors = context.profileAnchors.concat(context.continuityAnchors);
  return anchors.some(anchor => {
    if (/老房子/.test(content)) return /老房子/.test(anchor);
    if (/老家/.test(content)) return /老家/.test(anchor);
    if (/院子/.test(content)) return /院子/.test(anchor);
    return /以前的家|原来的家|以前.{0,8}(?:住|家)/.test(anchor);
  });
}

function resolveProfileAnchors(options: {
  agent?: AgentEntity | null;
  profileFacts?: AfterlifeWorldProfileFact[];
  evidence?: AfterlifeWorldEvidence[];
  domains: AfterlifeWorldDomain[];
}): string[] {
  const anchors: string[] = [];
  const domainPattern = buildDomainPattern(options.domains);
  const activeFacts = (options.profileFacts || []).filter(fact => {
    const searchable = `${fact.key} ${fact.value}`;
    return (
      (PROFILE_ANCHOR_PATTERN.test(searchable) ||
        domainPattern.test(searchable)) &&
      (!USER_PROFILE_PATTERN.test(searchable) ||
        !PROFILE_ANCHOR_PATTERN.test(searchable)) &&
      fact.polarity !== 'negative' &&
      fact.status !== 'archived'
    );
  });
  for (const fact of activeFacts.slice(0, 3)) {
    anchors.push(normalizeAnchor(fact.value));
  }
  if (
    options.domains.some(domain =>
      ['habits_hobbies', 'food_rest', 'general'].includes(domain)
    ) &&
    options.agent?.hobbies?.trim()
  ) {
    anchors.push(`当前角色兴趣爱好：${normalizeAnchor(options.agent.hobbies)}`);
  }
  for (const evidence of options.evidence || []) {
    if (
      evidence.source !== 'current_user' &&
      (PROFILE_ANCHOR_PATTERN.test(evidence.text) ||
        domainPattern.test(evidence.text)) &&
      (!USER_PROFILE_PATTERN.test(evidence.text) ||
        !PROFILE_ANCHOR_PATTERN.test(evidence.text))
    ) {
      anchors.push(normalizeAnchor(evidence.text));
    }
  }

  return anchors
    .filter(Boolean)
    .filter((value, index, values) => values.indexOf(value) === index)
    .slice(0, 3);
}

function buildDomainPattern(domains: AfterlifeWorldDomain[]): RegExp {
  const patterns: Partial<Record<AfterlifeWorldDomain, RegExp>> = {
    residence: RESIDENCE_PATTERN,
    family_items: FAMILY_ITEM_PATTERN,
    habits_hobbies: HABITS_HOBBIES_PATTERN,
    health: HEALTH_PATTERN,
    food_rest: FOOD_REST_PATTERN,
    relationships: RELATIONSHIPS_PATTERN,
    environment: ENVIRONMENT_PATTERN,
    cross_world: CROSS_WORLD_PATTERN,
    general: /这边|那边|天堂|住|家|收到|放着|用着|习惯|爱好|病痛|不疼|没病/,
  };
  return new RegExp(
    domains
      .map(domain => patterns[domain]?.source)
      .filter(Boolean)
      .join('|') || patterns.general?.source
  );
}

function normalizeAnchor(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 100);
}

function matchEvidence(content: string, pattern: RegExp): string {
  return content.match(pattern)?.[0]?.slice(0, 160) || content.slice(0, 160);
}
