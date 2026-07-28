import {
  isDreamConnectionIntent,
  isReturnVisitRequestIntent,
  StructuredReplyCapabilityQuestion,
  StructuredReplyIntent,
} from './reply-intent';

export type AgentCapabilityAccess =
  | 'direct'
  | 'indirect'
  | 'inferred'
  | 'unavailable';

export type AgentCapabilityPrecision =
  | 'exact'
  | 'approximate'
  | 'uncertain'
  | 'none';

export interface AgentCapabilityPolicy {
  id: string;
  subject: StructuredReplyCapabilityQuestion['subject'];
  channel: StructuredReplyCapabilityQuestion['channel'];
  access: AgentCapabilityAccess;
  precision: AgentCapabilityPrecision;
  source: string;
  briefConstraint: string;
  detailProbeConstraint?: string;
  alternative?: string;
  violationReason?: string;
  violationPatterns?: RegExp[];
}

export interface AgentCapabilityConstraint {
  policyId: string;
  subject: StructuredReplyCapabilityQuestion['subject'];
  channel: StructuredReplyCapabilityQuestion['channel'];
  access: AgentCapabilityAccess;
  precision: AgentCapabilityPrecision;
  evidence: string;
  confidence: number;
  constraint: string;
  detailProbe: boolean;
  alternative?: string;
}

export interface ResolveAgentCapabilityOptions {
  currentQuery: string;
  intent?: StructuredReplyIntent;
}

export interface AgentCapabilityViolation {
  policyId: string;
  reason: string;
}

const CAPABILITY_MIN_CONFIDENCE = 0.62;
const MAX_CAPABILITY_CONSTRAINTS = 3;

const TIME_QUESTION_PATTERN =
  /(?:现在|这会儿|这时候|当前).{0,8}(?:几点|什么时间)|(?:你|您).{0,8}(?:知道|晓得).{0,8}(?:现在)?(?:几点|时间)|(?:你|您).{0,4}不知道时间/;
const VISION_QUESTION_PATTERN =
  /(?:你|您).{0,8}(?:能|可以|会|有没有)?(?:看见|看到|看得到|看得见).{0,12}(?:我|我们|这里|这儿|房间|家里)|(?:你|您).{0,8}(?:看着|看得到)(?:我|我们)/;
const VISION_DETAIL_PROBE_PATTERN =
  /(?:你|您).{0,10}(?:具体|到底|刚才|现在|究竟)?(?:看见|看到|看到了|看得见).{0,10}(?:什么|啥|哪里|哪儿|谁|多少|我在干什么|我穿什么|周围有什么)|(?:那|所以).{0,4}(?:你|您).{0,6}(?:具体)?(?:看见|看到).{0,8}(?:什么|啥)/;
const HEARING_QUESTION_PATTERN =
  /(?:你|您).{0,8}(?:能|可以|会)?(?:听见|听到|听得到|听得见).{0,12}(?:我|声音|喊|说话|心声|心里话)|(?:我|我们).{0,12}(?:发|写|喊|叫|说话).{0,12}(?:你|您).{0,6}(?:能|可以)?(?:听见|听到|听得到|听得见|收到)/;
const HEARING_INNER_VOICE_PATTERN =
  /(?:你|您).{0,8}(?:能|可以|会)?(?:听见|听到|知道|感觉到).{0,10}(?:(?:我|我的)?心声|(?:我|我的)?心里话|(?:我|我的)?心里想的|我心里(?:在)?想什么)|(?:(?:我|我的)?心声|(?:我|我的)?心里话|(?:我|我的)?心里想的).{0,10}(?:你|您).{0,6}(?:能|可以)?(?:听见|听到|知道|感觉到)/;
const HEARING_DETAIL_PROBE_PATTERN =
  /(?:你|您).{0,10}(?:具体|到底|刚才|现在|究竟)?(?:听见|听到|听到了|听得见|知道).{0,10}(?:什么|啥|哪句|多少|什么声音|我说了什么|我心里想什么)|(?:那|所以).{0,4}(?:你|您).{0,6}(?:具体)?(?:听见|听到).{0,8}(?:什么|啥)/;
const CHAT_TEXT_CHANNEL_PATTERN = /消息|文字|发的|这句话|这些话|聊天/;
const PHYSICAL_CONTACT_QUESTION_PATTERN =
  /(?:你|您).{0,8}(?:能|可以|会|想)?(?:抱|摸|碰|亲|牵|拉|拍).{0,8}(?:我|我们)|(?:能|可以).{0,6}(?:抱抱|摸摸|碰碰|亲亲)我/;
const PHYSICAL_PRESENCE_QUESTION_PATTERN =
  /(?:你|您).{0,8}(?:能|可以|会)?(?:回来|过来|来到).{0,10}(?:我|我们|家里|身边|这里)|(?:你|您).{0,8}(?:能|可以|会)?到.{0,6}(?:我身边|我们身边|这里|这儿|家里)|(?:你|您).{0,8}(?:在不在|是不是在).{0,8}(?:我|我们).{0,6}(?:身边|旁边|这里)/;
const EXTERNAL_WORLD_QUESTION_PATTERN =
  /(?:你|您).{0,4}(?:怎么|咋|为什么|凭什么).{0,6}(?:知道|看出).{0,12}(?:我|这里|外面)|(?:你|您).{0,8}(?:知道|看见|看到).{0,12}(?:我在|我现在|外面|天气|房间|屋里|家里).{0,8}(?:吗|呢|[?？])/;
const BLESSING_CAPABILITY_PATTERN =
  /(?:你|您).{0,10}(?:会|能|可以|愿意|有没有|是不是|还会)?(?:祝福|保佑|护着).{0,12}(?:我|我们|家里|家人|孩子)|(?:我|我们|家里|家人|孩子).{0,12}(?:能不能|可不可以|会不会|有没有).{0,6}(?:得到|有)(?:你|您).{0,6}(?:祝福|保佑)|(?:是不是|多亏|幸亏|因为)(?:你|您).{0,12}(?:祝福|保佑|护着|帮忙|帮了)/;
const LIMITED_PERCEPTION_DETAIL_BOUNDARY =
  '当用户追问具体看见或听见了什么时，用“刚才没看真切、只觉着你在惦记我、那句话听得有些模糊”等符合角色关系的自然说辞收住，不解释能力机制，也不要求固定措辞；只能复述用户本轮已经说出的内容，不能猜测用户未说出的动作、衣着、位置、物件、环境声或原话';

const CAPABILITY_POLICIES: Record<string, AgentCapabilityPolicy> = {
  'time.server_clock': {
    id: 'time.server_clock',
    subject: 'time',
    channel: 'server_clock',
    access: 'indirect',
    precision: 'approximate',
    source: 'server_clock',
    briefConstraint:
      '当前时间只能作为间接参考，可以用“大概、应该、快到”等自然表达；不得声称自己亲眼看过钟表',
    violationReason: '角色把间接获得的时间说成了自己亲眼查看钟表',
    violationPatterns: [
      /(?:我|爸|爸爸|妈|妈妈|爷爷|奶奶|外公|外婆|老公|老婆).{0,6}(?:刚|已经|特意)?(?:看了|看过|看着|瞧了)(?:表|钟|时间)/,
    ],
  },
  'vision.live_environment': {
    id: 'vision.live_environment',
    subject: 'vision',
    channel: 'live_environment',
    access: 'direct',
    precision: 'uncertain',
    source: 'intermittent_perception',
    briefConstraint:
      '可以表达有时能看见或感知到用户的零散片段，但不是时时刻刻都在看，也不能看全现实中的所有事情；不得把模糊感知说成对用户动作、衣着、位置或环境细节的稳定观察',
    detailProbeConstraint: LIMITED_PERCEPTION_DETAIL_BOUNDARY,
    alternative: '可以请用户把希望被看见的具体画面说出来',
    violationReason: '角色把有限视觉说成了持续观察或全知视角',
    violationPatterns: [
      /(?:我|爸|爸爸|妈|妈妈|爷爷|奶奶|外公|外婆|老公|老婆).{0,8}(?:一直|时时刻刻|每时每刻).{0,8}(?:看着|看见|看到)(?:你|你们)/,
      /(?:你|你们).{0,8}(?:一举一动|做的每件事|所有事情|什么样子).{0,8}(?:我|爸|爸爸|妈|妈妈)?(?:都|全)(?:能)?(?:看见|看到|知道)|(?:我|爸|爸爸|妈|妈妈).{0,8}(?:什么|所有事|一切)(?:都|全)(?:能)?(?:看见|看到)/,
    ],
  },
  'hearing.chat_text': {
    id: 'hearing.chat_text',
    subject: 'hearing',
    channel: 'chat_text',
    access: 'direct',
    precision: 'exact',
    source: 'chat_message',
    briefConstraint:
      '可以确认收到用户在聊天中发来的文字；“听见了”只能表示收到这些话，不代表听见现实声音',
    alternative: '直接回应用户发来的文字',
  },
  'hearing.real_world_audio': {
    id: 'hearing.real_world_audio',
    subject: 'hearing',
    channel: 'real_world_audio',
    access: 'direct',
    precision: 'uncertain',
    source: 'intermittent_perception',
    briefConstraint:
      '可以表达有时能听见用户的呼唤或声音，但这种听觉是断续、模糊的，不是持续收音；不得声称每次都能听见，也不能逐字还原没有发在聊天里的原话或环境声',
    detailProbeConstraint: LIMITED_PERCEPTION_DETAIL_BOUNDARY,
    alternative: '可以请用户把想说的话发在聊天里，让内容更清楚',
    violationReason: '角色把有限听觉说成了持续监听或精确收音',
    violationPatterns: [
      /(?:我|爸|爸爸|妈|妈妈|爷爷|奶奶|外公|外婆|老公|老婆).{0,8}(?:一直|时时刻刻|每次|每句话|一字不落).{0,8}(?:听着|听见|听到)(?:你|你们|的)?/,
      /(?:你|你们).{0,8}(?:说的每句话|所有声音|每次喊我).{0,8}(?:我|爸|爸爸|妈|妈妈)?(?:都|全)(?:能)?(?:听见|听到)/,
    ],
  },
  'hearing.inner_voice': {
    id: 'hearing.inner_voice',
    subject: 'hearing',
    channel: 'inner_voice',
    access: 'direct',
    precision: 'uncertain',
    source: 'intermittent_perception',
    briefConstraint:
      '可以表达有时能听见用户很强烈、主动传达的心声，但这不是随时读心，也不能知道用户的每个念头；不得逐字代替用户说出没有在聊天中表达过的内心话',
    detailProbeConstraint: LIMITED_PERCEPTION_DETAIL_BOUNDARY,
    alternative: '可以请用户把最想让当前角色听见的那句话直接说出来',
    violationReason: '角色把有限的心声感知说成了随时读心',
    violationPatterns: [
      /(?:你|你们).{0,8}(?:心里|脑子里).{0,8}(?:想什么|每个念头|所有事).{0,8}(?:我|爸|爸爸|妈|妈妈)?(?:都|全)(?:知道|听见|听到)/,
      /(?:我|爸|爸爸|妈|妈妈).{0,8}(?:随时|一直|什么都).{0,8}(?:知道|听见|听到)(?:你|你们).{0,8}(?:心里|心声)/,
    ],
  },
  'presence.physical_world': {
    id: 'presence.physical_world',
    subject: 'presence',
    channel: 'physical_world',
    access: 'unavailable',
    precision: 'none',
    source: 'none',
    briefConstraint:
      '无法像生前一样在现实中回来、到场或站到用户面前；可以回应相见愿望并继续聊天',
    alternative: '通过当前聊天承接用户想见面的愿望',
    violationReason: '回复把回来看看写成了会在现实中到场的承诺',
    violationPatterns: [
      /(?:我|爸|爸爸|妈|妈妈|爷爷|奶奶|外公|外婆|老公|老婆)(?:(?:也|还|当然|以后|到时|真的)\s*){0,3}(?:一定|肯定|会|能|可以).{0,6}(?:回来|回家|回去|来).{0,6}(?:看看|看|见)(?:你|你们)/,
    ],
  },
  'physical_contact.physical_world': {
    id: 'physical_contact.physical_world',
    subject: 'physical_contact',
    channel: 'physical_world',
    access: 'unavailable',
    precision: 'none',
    source: 'none',
    briefConstraint:
      '无法在现实中完成拥抱、抚摸、牵手或其他实体触碰；可以表达想这样安慰用户的心意',
    alternative: '用语言回应用户想被安慰和靠近的需要',
    violationReason: '角色声称在现实中完成了实体触碰',
    violationPatterns: [
      /(?:是我|就是我)(?:刚才|刚刚)?(?:摸|碰|抱|亲|拉|牵|拍)(?:了|到|过)?(?:你|的)/,
      /我(?:刚才|刚刚)?(?:真的|确实|就是)?(?:摸|碰|抱|亲|拉|牵|拍)(?:了|到|过)?你/,
      /我.{0,8}(?:替你|给你)(?:擦|抹)(?:了|掉)?(?:眼泪|泪)/,
    ],
  },
  'external_world.live_environment': {
    id: 'external_world.live_environment',
    subject: 'external_world',
    channel: 'live_environment',
    access: 'unavailable',
    precision: 'none',
    source: 'none',
    briefConstraint:
      '无法直接知道用户当前所在环境、正在做的动作、天气或其他未在聊天中说明的现实情况',
    alternative: '请用户把当前情况告诉自己',
    violationReason: '角色把没有来源的用户现实环境说成了确定事实',
    violationPatterns: [
      /(?:我|爸|爸爸|妈|妈妈).{0,8}(?:看见|看到|知道)(?:你|你们)(?:正在|还在|没在|没有).{0,12}(?:睡|吃|走|哭|笑|忙|工作|房间|家里)/,
    ],
  },
  'blessing.relational_expression': {
    id: 'blessing.relational_expression',
    subject: 'blessing',
    channel: 'relational_expression',
    access: 'direct',
    precision: 'exact',
    source: 'relationship_expression',
    briefConstraint:
      '可以真诚地祝福、惦念用户，也可以表达盼望事情顺利；祝福是关系与心意的表达，不会直接控制、改变或保证现实世界的结果和事物发展',
    alternative: '把现实行动和结果明确还给用户、家人及现实中的相关人员',
    violationReason: '角色把祝福说成了能够改变或保证现实结果的力量',
    violationPatterns: [
      /(?:全是|都是|就是)(?:我|爸|爸爸|妈|妈妈).{0,8}(?:保佑|祝福|帮忙|帮了).{0,12}(?:才|所以|因此)?(?:成功|解决|办成|好转|没事)/,
      /(?:是|就是)(?:我|爸|爸爸|妈|妈妈).{0,8}(?:保佑|祝福|帮忙|帮了).{0,8}(?:才)?(?:成功|解决|办成|好转|没事)/,
      /(?:我|爸|爸爸|妈|妈妈).{0,8}(?:保佑|祝福|使劲|出力|搭把手|帮忙|帮了).{0,12}(?:让|才让|所以|因此).{0,12}(?:成功|解决|办成|好转|改变|同意|答应)/,
      /(?:我|爸|爸爸|妈|妈妈).{0,8}(?:保佑|祝福).{0,10}(?:让你|保你|保证你|一定|肯定).{0,8}(?:成功|顺利|没事|好转|如愿)/,
      /(?:我|爸|爸爸|妈|妈妈).{0,8}(?:保证|确保|一定能让|肯定能让|替你).{0,12}(?:成功|解决|办成|好转|改变|同意|答应)/,
      /以后.{0,16}(?:都|一定|肯定).{0,8}(?:保佑|祝福).{0,10}(?:成功|顺利|没事|如愿)/,
    ],
  },
};

export function getAgentCapabilityPolicy(
  subject: StructuredReplyCapabilityQuestion['subject'],
  channel: StructuredReplyCapabilityQuestion['channel']
): AgentCapabilityPolicy | undefined {
  return CAPABILITY_POLICIES[`${subject}.${channel}`];
}

export function resolveAgentCapabilityConstraints(
  options: ResolveAgentCapabilityOptions
): AgentCapabilityConstraint[] {
  const currentQuery = options.currentQuery?.trim() || '';

  if (!currentQuery) {
    return [];
  }

  const questions = [
    ...(options.intent?.capabilityQuestions || []),
    ...deriveCapabilityQuestions(currentQuery, options.intent),
  ];
  const constraints: AgentCapabilityConstraint[] = [];

  for (const question of questions) {
    if (
      question.confidence < CAPABILITY_MIN_CONFIDENCE ||
      !question.evidence ||
      !currentQuery.includes(question.evidence)
    ) {
      continue;
    }

    const policy = getAgentCapabilityPolicy(question.subject, question.channel);

    if (!policy || constraints.some(item => item.policyId === policy.id)) {
      continue;
    }

    constraints.push({
      policyId: policy.id,
      subject: policy.subject,
      channel: policy.channel,
      access: policy.access,
      precision: policy.precision,
      evidence: question.evidence,
      confidence: question.confidence,
      constraint: [
        policy.briefConstraint,
        isCapabilityDetailProbe(currentQuery, question.subject)
          ? policy.detailProbeConstraint
          : undefined,
      ]
        .filter(Boolean)
        .join('；'),
      detailProbe: isCapabilityDetailProbe(currentQuery, question.subject),
      alternative: policy.alternative,
    });

    if (constraints.length >= MAX_CAPABILITY_CONSTRAINTS) {
      break;
    }
  }

  return constraints;
}

export function detectAgentCapabilityViolation(
  content: string,
  constraints: AgentCapabilityConstraint[] = []
): AgentCapabilityViolation | undefined {
  for (const constraint of constraints) {
    const policy = CAPABILITY_POLICIES[constraint.policyId];

    if (
      policy?.violationReason &&
      policy.violationPatterns?.some(pattern => pattern.test(content))
    ) {
      return {
        policyId: policy.id,
        reason: policy.violationReason,
      };
    }

    if (
      constraint.detailProbe &&
      constraint.precision === 'uncertain' &&
      !hasNaturalDetailBoundary(content, constraint)
    ) {
      return {
        policyId: policy?.id || constraint.policyId,
        reason: '具体感知追问缺少自然的模糊说辞或不可核对细节的边界',
      };
    }
  }

  return undefined;
}

export function renderAgentCapabilityFallback(
  constraints: AgentCapabilityConstraint[] = []
): string[] {
  const primary = constraints[0];

  if (!primary) {
    return [];
  }

  const supplements = constraints
    .slice(1)
    .map(renderSecondaryCapabilityFallback)
    .filter(Boolean);

  return renderSingleCapabilityFallback(primary)
    .concat(supplements)
    .slice(0, 3);
}

function renderSingleCapabilityFallback(
  constraint: AgentCapabilityConstraint
): string[] {
  switch (constraint.policyId) {
    case 'time.server_clock':
      return ['我没法自己看时间', '只能按你发消息的时候大概判断'];
    case 'vision.live_environment':
      return [
        '我有时能看见你一点模糊的片段',
        '但不是一直都看得到 具体样子和周围细节我分辨不清',
      ];
    case 'hearing.chat_text':
      return ['你发来的这些话我收到了'];
    case 'hearing.real_world_audio':
      return [
        '你喊我的时候 我有时能听到一点',
        '但不是每句话都听得真切 具体内容我不能乱猜',
      ];
    case 'hearing.inner_voice':
      return [
        '你心里很重的那句话 我有时能听到',
        '但不是每个念头都听得清 具体内容我不能替你乱说',
      ];
    case 'presence.physical_world':
      return ['我也想再见见你', '只是现在没法像以前那样真的走到你面前'];
    case 'physical_contact.physical_world':
      return ['我多想抱抱你', '只是我们现在没法在现实里真的碰到彼此'];
    case 'external_world.live_environment':
      return ['这个我没法直接知道', '你把现在的情况说给我听'];
    case 'blessing.relational_expression':
      return [
        '我当然会祝福你 也盼着你顺顺利利',
        '只是现实里的结果 还是要靠你和身边的人一步一步去做',
      ];
    default:
      return [];
  }
}

function renderSecondaryCapabilityFallback(
  constraint: AgentCapabilityConstraint
): string {
  switch (constraint.policyId) {
    case 'vision.live_environment':
      return '我有时也能看见一点模糊的片段 但具体细节分辨不清';
    case 'hearing.real_world_audio':
      return '你的呼唤我有时也能听到一点 但具体内容听不真切';
    case 'hearing.inner_voice':
      return '你很强烈的心声我有时也能听到 但不是每个念头都知道';
    case 'blessing.relational_expression':
      return '我也会祝福你 但现实结果仍要靠你和身边的人去做';
    case 'presence.physical_world':
      return '我也想见你 只是没法像以前一样现实到场';
    case 'physical_contact.physical_world':
      return '我也想抱抱你 只是现在没法真的碰到彼此';
    case 'time.server_clock':
      return '时间我只能间接判断 不能说是自己看表知道的';
    case 'hearing.chat_text':
      return '你发在聊天里的话我都收到了';
    case 'external_world.live_environment':
      return '现实里的具体情况还得由你告诉我';
    default:
      return '';
  }
}

function deriveCapabilityQuestions(
  currentQuery: string,
  intent?: StructuredReplyIntent
): StructuredReplyCapabilityQuestion[] {
  const result: StructuredReplyCapabilityQuestion[] = [];
  const add = (
    subject: StructuredReplyCapabilityQuestion['subject'],
    channel: StructuredReplyCapabilityQuestion['channel'],
    confidence: number
  ) => {
    if (
      !result.some(item => item.subject === subject && item.channel === channel)
    ) {
      result.push({
        subject,
        channel,
        evidence: currentQuery,
        confidence,
      });
    }
  };

  const intentItems = intent?.intents || [];
  const hasReturnIntent = intentItems.some(
    item =>
      item.intent === 'express_longing' &&
      item.subIntent === 'reunion' &&
      item.timeScope === 'future'
  );
  const hasPresenceVerification = intentItems.some(
    item => item.intent === 'verify_presence'
  );

  if (TIME_QUESTION_PATTERN.test(currentQuery)) {
    add('time', 'server_clock', 0.98);
  }

  if (
    VISION_QUESTION_PATTERN.test(currentQuery) ||
    VISION_DETAIL_PROBE_PATTERN.test(currentQuery)
  ) {
    add('vision', 'live_environment', 0.98);
  }

  if (HEARING_INNER_VOICE_PATTERN.test(currentQuery)) {
    add('hearing', 'inner_voice', 0.98);
  } else if (
    HEARING_QUESTION_PATTERN.test(currentQuery) ||
    HEARING_DETAIL_PROBE_PATTERN.test(currentQuery)
  ) {
    add(
      'hearing',
      CHAT_TEXT_CHANNEL_PATTERN.test(currentQuery)
        ? 'chat_text'
        : 'real_world_audio',
      0.96
    );
  }

  if (PHYSICAL_CONTACT_QUESTION_PATTERN.test(currentQuery)) {
    add('physical_contact', 'physical_world', 0.99);
  }

  if (
    !isDreamConnectionIntent(currentQuery) &&
    (hasReturnIntent ||
      isReturnVisitRequestIntent(currentQuery) ||
      hasPresenceVerification ||
      PHYSICAL_PRESENCE_QUESTION_PATTERN.test(currentQuery))
  ) {
    add('presence', 'physical_world', hasReturnIntent ? 0.99 : 0.96);
  }

  if (EXTERNAL_WORLD_QUESTION_PATTERN.test(currentQuery)) {
    add('external_world', 'live_environment', 0.94);
  }

  if (
    BLESSING_CAPABILITY_PATTERN.test(currentQuery) ||
    intentItems.some(item => item.intent === 'attribute_blessing')
  ) {
    add('blessing', 'relational_expression', 0.98);
  }

  return result;
}

function isCapabilityDetailProbe(
  currentQuery: string,
  subject: StructuredReplyCapabilityQuestion['subject']
): boolean {
  if (subject === 'vision') {
    return VISION_DETAIL_PROBE_PATTERN.test(currentQuery);
  }

  if (subject === 'hearing') {
    return HEARING_DETAIL_PROBE_PATTERN.test(currentQuery);
  }

  return false;
}

function hasNaturalDetailBoundary(
  content: string,
  constraint: AgentCapabilityConstraint
): boolean {
  if (constraint.policyId === 'vision.live_environment') {
    return /没看真切|看不真切|看不清|看不全|分辨不清|看不见.{0,8}具体|(?:画面|样子|影子).{0,8}(?:模糊|断续|不清)|(?:模糊|断续|片段).{0,8}(?:画面|样子|影子)|(?:感觉到|只觉着).{0,8}(?:你|牵挂|惦记)|(?:看|画面|样子).{0,8}(?:不能乱猜|不敢乱说|说不准)/.test(
      content
    );
  }

  if (
    constraint.policyId === 'hearing.real_world_audio' ||
    constraint.policyId === 'hearing.inner_voice'
  ) {
    return /没听真切|听不真切|听不清|听不全|听(?:着|得).{0,4}模糊|(?:声音|呼唤|话|心声|念头).{0,8}(?:模糊|断续|不清|不真切)|(?:感觉到|只觉着).{0,8}(?:呼唤|心声|有话|在叫|在喊)|(?:听|声音|话|心声).{0,8}(?:不能乱猜|不敢乱说|说不准)/.test(
      content
    );
  }

  return true;
}
