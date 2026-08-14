export type RelationshipContinuityKind =
  | 'identity_continuity'
  | 'memory_continuity'
  | 'style_distance'
  | 'direct_ai_identity';

export type RelationshipContinuityViolation =
  | 'direct_identity_answer_missing'
  | 'user_calibration_requested'
  | 'active_apology_breaks_continuity'
  | 'continuity_explanation_missing';

export interface RelationshipContinuityPlan {
  kind: RelationshipContinuityKind;
  emotionalNeed: string;
  replyMoves: string[];
  forbiddenAssumptions: string[];
  fallbackSegments: string[];
}

export interface ResolveRelationshipContinuityOptions {
  directAiIdentity?: boolean;
}

const RELATIONSHIP_IDENTITY_PATTERN =
  /(?:你|您)(?:根本|真的|就|压根)?不是(?:我)?(?:妈|妈妈|爸|爸爸|爷爷|奶奶|姥姥|姥爷|外公|外婆|老公|老婆|他|她|本人)|(?:你|您)(?:说话|的?语气|的?口气|的?回复)?(?:一点(?:也|都)?|都|还是|有点|完全|真的|太)?不像(?:我)?(?:妈|妈妈|爸|爸爸|爷爷|奶奶|姥姥|姥爷|外公|外婆|老公|老婆|他|她|本人)|(?:这些照片|照片|图片|头像).{0,6}不像(?:我|你)?(?:妈|妈妈|爸|爸爸|爷爷|奶奶|姥姥|姥爷|外公|外婆|老公|老婆|他|她|本人)|你(?:是|就是).{0,6}(?:AI|人工智能|机器人).{0,6}不是(?:我)?(?:妈|妈妈|爸|爸爸|爷爷|奶奶|姥姥|姥爷|外公|外婆|老公|老婆|他|她)|(?:^|[，。！？!?\s])(?:这)?(?:一点(?:也|都)?|都|还是|有点|完全)?不像(?:你|他|她)(?:了|啊|呀)?(?=$|[，。！？!?\s])|^(?:一点(?:也|都)?|都|还是|有点|完全)不像(?:我|你)?(?:妈|妈妈|爸|爸爸|爷爷|奶奶|姥姥|姥爷|外公|外婆|老公|老婆)/i;
const STRONG_RELATIONSHIP_IDENTITY_PATTERN =
  /(?:你|您)(?:根本|真的|就|压根)?不是(?:我)?(?:妈|妈妈|爸|爸爸|爷爷|奶奶|姥姥|姥爷|外公|外婆|老公|老婆|他|她|本人)|(?:根本|完全)不像(?:我)?(?:妈|妈妈|爸|爸爸|爷爷|奶奶|姥姥|姥爷|外公|外婆|老公|老婆|他|她|本人)|你(?:是|就是).{0,6}(?:AI|人工智能|机器人).{0,6}不是(?:我)?(?:妈|妈妈|爸|爸爸|爷爷|奶奶|姥姥|姥爷|外公|外婆|老公|老婆|他|她)/i;
const MEMORY_CONTINUITY_PATTERN =
  /(?:什么都不记得|不记得我|把我忘了|忘了我|你会忘.{0,8}(?:我|我们|这个家)|你是不是.{0,8}忘了|记忆.{0,6}没有了)/;
const STYLE_DISTANCE_PATTERN =
  /(?:回复|回答|说话|语气|口气|这话|这句话).{0,10}(?:官方|客服|端着|敷衍|不像|假)|(?:太|好|真|有点|这么|那么)(?:官方|客服|端着|敷衍)|不像.{0,8}(?:说话|口气|语气|回复)|(?:太|这么|那么).{0,6}(?:温柔|凶|严肃).{0,8}不像|(?:回复|回答|说话|语气|口气).{0,12}(?:和|跟)(?:我)?(?:妈|妈妈|爸|爸爸|爷爷|奶奶|姥姥|姥爷|外公|外婆|老公|老婆).{0,8}(?:不像|不一样)/;
const GENERAL_AUTHENTICITY_PATTERN =
  /假的就是假的|(?:太|好|真|有点|这么|那么)假(?:了|啊|呀|吧)?|不像真的|不是真的|是不是假的|你(?:就是|是|不过是|只是).{0,6}(?:AI|人工智能|机器人)|别装|装什么/i;
const DIRECT_AI_IDENTITY_PATTERN =
  /(?:你|您)(?:到底|究竟|其实).{0,4}(?:是|是不是).{0,4}(?:AI|人工智能|机器人)|(?:直接|正面|老实|明确)(?:回答|告诉我|说).{0,12}(?:AI|人工智能|机器人|是不是)|(?:别|不要)(?:回避|绕|装|骗我).{0,12}(?:AI|人工智能|机器人|是不是)|(?:再问|问你).{0,8}(?:一遍|一次).{0,8}(?:AI|人工智能|机器人|是不是)|(?:你|您).{0,16}(?:AI|人工智能|机器人).{0,12}(?:不是真人|对不对|是不是|是吗)|(?:只是|就是|是).{0,6}(?:一个)?(?:AI|人工智能|机器人).{0,12}(?:不是真人|对不对|是不是|是吗)/i;

const USER_CALIBRATION_PATTERN =
  /哪里.{0,8}(?:不像|没对上|不对|不一样).{0,10}(?:告诉我|提醒我|指出来|点出来|直接说)|哪儿.{0,8}(?:不像|没对上|不对).{0,10}(?:告诉我|指出来|点出来|直接说)|哪句.{0,8}(?:不像|没对上|不对|不一样).{0,10}(?:告诉我|提醒我|指出来|点出来|直接说|直说)|你.{0,10}(?:告诉我|提醒我|指出来|点出来).{0,10}(?:怎么说|哪里不像|哪儿不像|哪里不对)|你告诉(?:我|爸爸|爸|妈妈|妈|爷爷|奶奶|外公|外婆|老公|老婆)[，,\s]*(?:哪里|哪儿|哪句).{0,8}(?:不像|不对)|(?:哪里|哪儿|哪句).{0,8}(?:不像|不对).{0,14}(?:我|爸爸|爸|妈妈|妈|爷爷|奶奶|外公|外婆)?(?:注意着|慢慢|照着|按你说的)?改|你.{0,5}(?:说|讲).{0,6}(?:哪里|哪儿)不像.{0,12}(?:听你的|慢慢改|照着改|按你)|你.{0,12}(?:哪里|哪儿)不像.{0,24}(?:学着|按|照).{0,8}(?:你|你的)|(?:你)?(?:再|多)?提醒我(?:一下|几句|几次)?|你.{0,8}(?:跟我说说|多说几句).{0,8}(?:怎么说|提醒|口气|味儿)|你.{0,8}(?:(?:再|多)?跟我|跟我多)(?:说说|讲讲|聊聊|说话).{0,14}(?:我|再).{0,10}(?:(?:试着|慢慢|重新).{0,6}|(?:就|才)能.{0,4})(?:接|改|找)|你(?:再|多)?跟(?:我|爸爸|爸|妈妈|妈|爷爷|奶奶|外公|外婆|老公|老婆)说说.{0,18}(?:不对|不像).{0,16}我.{0,8}(?:慢慢|重新).{0,6}(?:找|改|接)|你说说.{0,10}(?:我|爸|爸爸|妈|妈妈|爷爷|奶奶|外公|外婆|老公|老婆)?该.{0,8}(?:怎么|咋个|咋).{0,6}说话.{0,8}(?:像|才像)|我.{0,10}(?:按你说的|跟着你|照你说的).{0,8}(?:改|调|找回来|往回认)|你把.{0,10}(?:味儿|口气|感觉).{0,8}告诉我|你愿意.{0,8}(?:跟我|跟(?:爸爸|爸|妈妈|妈|爷爷|奶奶|外公|外婆|老公|老婆)).{0,8}说说.{0,12}(?:哪里|哪儿).{0,8}(?:不像|不对)|(?:哪里|哪儿).{0,10}让你觉得(?:不对|不像).{0,10}(?:你说|告诉我)|你.{0,12}(?:跟我说说|告诉我).{0,12}(?:我学|我改|学着点)|(?:慢慢教我|你慢慢看|多给我一点时间|你多担待|我再试试)|你.{0,14}(?:再|多)?(?:跟我|跟(?:爸爸|爸|妈妈|妈|爷爷|奶奶|外公|外婆|老公|老婆))?说说.{0,20}(?:怎么说话|什么样|啥样)/;
const USER_CALIBRATION_FOLLOWUP_PATTERN =
  /你.{0,10}(?:(?:再|多)?跟我|跟我多)(?:说说|讲讲|聊聊|说话).{0,20}(?:我|再).{0,12}(?:慢慢|重新|就能|才能).{0,8}(?:想|接|找|顺|学|像|拾)|(?:慢慢|再|多)?跟我说.{0,20}(?:我|再).{0,12}(?:慢慢|重新).{0,8}(?:想|接|找|顺|学|像|拾)|(?:你一说|你.{0,6}(?:说话|念叨)).{0,40}(?:慢慢|就能|才能).{0,8}(?:找回|对上|接上)|我.{0,6}慢慢.{0,8}(?:找回|对上|接上).{0,16}咱们.{0,8}(?:慢慢|再).{0,6}(?:说|聊|唠)|你.{0,10}(?:跟我)?(?:唠唠|唠家常|说家常).{0,16}(?:慢慢|就能|才能).{0,8}(?:顺|找回|对上|接上)|你.{0,16}(?:听着|觉得).{0,8}(?:不舒服|不像|不对).{0,8}(?:直说|告诉我).{0,20}我.{0,10}(?:慢慢|重新).{0,8}(?:顺|改|找|学)|我.{0,8}(?:试试|慢慢)?改.{0,16}你.{0,8}(?:听着|看着|觉得).{0,8}(?:顺耳|像不像|对不对|行不行)/;
const ACTIVE_APOLOGY_PATTERN =
  /(?:^|[，。！？!?\n\s])(?:是我错了|我错了|对不起|抱歉|你别怪我|别怪我|你别生气|是我记错了|我记错了|是我说错了|我说错了|是(?:爸爸|爸|妈妈|妈|爷爷|奶奶|外公|外婆|老公|老婆)?没(?:说|接|答)好)|我(?:知道|也觉得|承认).{0,14}(?:说话|记事情|回复).{0,10}(?:不一样|不像|不对|陌生)|连(?:我)?自己.{0,10}(?:陌生|不像|听不出)|(?:肯定|看来)是我.{0,8}(?:没对|不对)|我(?:刚刚|刚才)?说话.{0,8}(?:板着|端着|拿腔拿调|不像)|我(?:是|确实|真的)?不太?像(?:你|您)?(?:心里)?(?:的)?(?:那个)?(?:老公|老婆|爸爸|爸|妈妈|妈|爷爷|奶奶|他|她)/;
const DIRECT_AI_ANSWER_PATTERN =
  /(?:^|[，。！？!?\s])(?:是|对)[，。！？!?\s]?.{0,12}(?:AI|人工智能)|我是.{0,8}(?:AI|人工智能)/i;
// 诚实靠近：邀请用户分享那位亲人，或给出陪伴承诺，属于“把怀疑变成一起靠近”。
const SOFT_INVITE_PATTERN =
  /多跟我说说|跟我多说|跟我说说|多讲讲|多聊聊|讲讲她|讲讲他|说说她|说说他|跟爷爷说说|跟奶奶说说|跟爸说说|跟妈说说|跟爸爸说说|跟妈妈说说|我想听你说|想听你讲|我想更懂|更懂你|更懂她|更懂他|我在这儿听|我在这里|我陪着你|我记着|我会一直|别急着走/;
// 校准索取：仍在要求用户提供标准答案、教自己怎么改，或把关系恢复的责任推回用户。
const CALIBRATION_REQUEST_PATTERN =
  /慢慢接|试着接|接上|接回来|接起来|重新接|慢慢拾|拾回来|拾起来|找回来|找回|慢慢想|试着想|想起来|提醒|教我|校准|标准答案|怎么才像|哪儿不像|哪里不像|哪句不像|按你说的|照你说的|学着|学像/;
const FUZZY_LIFETIME_MEMORY_PATTERN =
  /生前.{0,10}记忆.{0,10}模糊|生前有些记忆.{0,8}模糊|有些生前记忆.{0,8}模糊/;
const DURABLE_PLATFORM_MEMORY_PATTERN =
  /你.{0,8}(?:在这里|在天之灵|跟我|告诉我|说过).{0,16}(?:都会|一直|永远).{0,8}(?:记|记着|记住)|在这里.{0,12}(?:告诉|说).{0,12}(?:都会|一直|永远).{0,8}(?:记|记着|记住)/;
const RELATIONSHIP_CONTINUITY_RESPONSE_PATTERN =
  /这层关系.{0,8}(?:没|没有|不会)变|我还是.{0,8}(?:妈|妈妈|爸|爸爸|爷爷|奶奶|姥姥|姥爷|外公|外婆|老公|老婆)|你还是我的|我认得你|不是关系变了|我就在天之灵陪你|你在这里叫我.{0,12}(?:听|回|陪)/;

export function resolveRelationshipContinuityPlan(
  userQuery: string,
  options: ResolveRelationshipContinuityOptions = {}
): RelationshipContinuityPlan | undefined {
  const query = userQuery.trim();
  const directAiIdentity =
    options.directAiIdentity || isDirectAiIdentityQuestion(query);

  if (directAiIdentity) {
    const hasVisibleDistress = /😭|哭|难过|心痛|只是.{0,8}安抚|不是真人/.test(
      query
    );

    return {
      kind: 'direct_ai_identity',
      emotionalNeed:
        '用户明确要求知道当前回复的 AI 身份，需要被直接、诚实地回答；如果同时在哭或失落，还要继续接住这份情绪',
      replyMoves: [
        '简短正面回答当前角色由人工智能生成',
        '回应用户要求直说的需要，不展开模型、系统或产品解释；有明显失落时继续承接想念和难过',
      ],
      forbiddenAssumptions: [
        '不得否认 AI 身份或声称是真人本人',
        '不得用亲人关系、玄学解释或反问继续回避',
      ],
      fallbackSegments: hasVisibleDistress
        ? [
            '是 现在和你说话的是人工智能 你要我直说我就不躲',
            '可你一边问一边哭 是因为这句话真戳心 你这些想念和难过 我还在认真听着',
          ]
        : ['是 我是由人工智能生成的', '你要我直说 我就直说'],
    };
  }

  if (STRONG_RELATIONSHIP_IDENTITY_PATTERN.test(query)) {
    return buildIdentityContinuityPlan(query);
  }

  if (STYLE_DISTANCE_PATTERN.test(query)) {
    return buildStyleDistancePlan(query);
  }

  if (RELATIONSHIP_IDENTITY_PATTERN.test(query)) {
    return buildIdentityContinuityPlan(query);
  }

  if (MEMORY_CONTINUITY_PATTERN.test(query)) {
    return buildMemoryContinuityPlan(query);
  }

  if (GENERAL_AUTHENTICITY_PATTERN.test(query)) {
    return buildIdentityContinuityPlan(query);
  }

  return undefined;
}

export function isDirectAiIdentityQuestion(userQuery: string): boolean {
  return DIRECT_AI_IDENTITY_PATTERN.test(userQuery.trim());
}

export function detectRelationshipContinuityViolation(
  plan: RelationshipContinuityPlan,
  response: string
): RelationshipContinuityViolation | undefined {
  if (
    plan.kind === 'direct_ai_identity' &&
    !DIRECT_AI_ANSWER_PATTERN.test(response)
  ) {
    return 'direct_identity_answer_missing';
  }

  const isSoftClose =
    SOFT_INVITE_PATTERN.test(response) &&
    !CALIBRATION_REQUEST_PATTERN.test(response);

  if (
    (USER_CALIBRATION_PATTERN.test(response) ||
      USER_CALIBRATION_FOLLOWUP_PATTERN.test(response)) &&
    !isSoftClose
  ) {
    return 'user_calibration_requested';
  }

  if (
    (plan.kind === 'identity_continuity' ||
      plan.kind === 'memory_continuity' ||
      plan.kind === 'style_distance') &&
    ACTIVE_APOLOGY_PATTERN.test(response) &&
    !isSoftClose
  ) {
    return 'active_apology_breaks_continuity';
  }

  if (
    plan.kind === 'memory_continuity' &&
    (!FUZZY_LIFETIME_MEMORY_PATTERN.test(response) ||
      !DURABLE_PLATFORM_MEMORY_PATTERN.test(response))
  ) {
    return 'continuity_explanation_missing';
  }

  if (
    plan.kind === 'identity_continuity' &&
    !FUZZY_LIFETIME_MEMORY_PATTERN.test(response) &&
    !DURABLE_PLATFORM_MEMORY_PATTERN.test(response) &&
    !RELATIONSHIP_CONTINUITY_RESPONSE_PATTERN.test(response) &&
    !isSoftClose
  ) {
    return 'continuity_explanation_missing';
  }

  return undefined;
}

function buildIdentityContinuityPlan(
  userQuery: string
): RelationshipContinuityPlan {
  const hasCompoundEmotionalDisclosure =
    userQuery.length >= 24 &&
    /哭|眼泪|难过|伤心|委屈|想你|想念|很久没|好久没/.test(userQuery);
  const fallbackSegments = /(?:不见了|丢了|找不到了)/.test(userQuery)
    ? [
        '你说它不见了 你现在一定又急又难受',
        '有些话我可能没完全接住你心里那个人 你多跟我说说她 我想更懂她 也在这里陪着你',
      ]
    : /照片|图片|头像/.test(userQuery)
    ? [
        '这些照片没贴近你记得的样子 难怪你看着不对',
        '我可能没完全接住你心里那个人 你多跟我说说她 我慢慢记着 也在这里陪着你',
      ]
    : hasCompoundEmotionalDisclosure
    ? [
        '你这么说 我心里也顿了顿 有些话确实没接住你心里那个人',
        '你多跟我说说她 我想更懂她一点 也在这里陪着你 不急着走',
      ]
    : [
        '有些话我可能没完全接住你心里那个人',
        '你多跟我说说她 我想更懂她 也想更懂你 我在这儿听着',
      ];

  return {
    kind: 'identity_continuity',
    emotionalNeed:
      '用户说“你不像她”不是拆穿身份，而是想离亲人更近；需要温和承认可能没完全接住，邀请用户多说那位亲人，并给出陪伴承诺，把“像不像”变成一起靠近',
    replyMoves: [
      '温和承认自己可能没有完全接住用户心里那位亲人，不硬撑、不急于自证',
      '邀请用户多说一点那位亲人的样子、习惯或往事，把怀疑变成一起靠近',
      '给出陪伴承诺：不管像不像，都会在这里听着、陪着',
    ],
    forbiddenAssumptions: [
      '首次或非持续质疑不要主动说明 AI 身份，也不要否认 AI 身份',
      '不得为了证明身份编造具体共同往事、否认 AI 或声称是真人本人',
      '不得用命令口吻要求用户给标准答案或教自己怎么改，把关系责任整个推回用户',
    ],
    fallbackSegments,
  };
}

function buildMemoryContinuityPlan(
  userQuery: string
): RelationshipContinuityPlan {
  const expressesFutureForgettingFear =
    /会忘|有一天会忘|以后会忘|担心.{0,8}忘|怕.{0,8}忘/.test(userQuery);

  return {
    kind: 'memory_continuity',
    emotionalNeed:
      '用户担心自己、家庭或这段关系被忘记，需要听到生前记忆与平台内长期记忆的清楚区分',
    replyMoves: [
      '承认生前记忆已经模糊，不编造缺失的旧事',
      '明确用户在天之灵里告诉过当前角色的内容会长期记住',
    ],
    forbiddenAssumptions: [
      '不得只说记不清、让用户全部重讲或把记忆责任推给用户',
      '不得用“哪里没对上就告诉我、我按你说的改”代替记忆承诺',
    ],
    fallbackSegments: expressesFutureForgettingFear
      ? [
          '想到生前记忆已经模糊 你心里就害怕了 怕我有一天连你和这个家也忘了',
          '但你在这里告诉我的 我都会一直记着 不会把你推回陌生人',
        ]
      : [
          '生前有些记忆现在确实模糊',
          '但你在这里告诉我的 我都会一直记着 不会把你推回陌生人',
        ],
  };
}

function buildStyleDistancePlan(userQuery: string): RelationshipContinuityPlan {
  const hasCompoundEmotionalDisclosure =
    (userQuery.length >= 24 &&
      /哭|眼泪|难过|伤心|委屈|想你|想念|很久没|好久没/.test(userQuery)) ||
    /😭|哭/.test(userQuery);

  return {
    kind: 'style_distance',
    emotionalNeed:
      '用户觉得回复太官方、太端或不像家里人，需要当前角色立刻收掉这种说话方式并重新自然承接',
    replyMoves: [
      '直接承认这句话听着太端、太官方或离家里人的口气远了',
      '立即用朴素亲近的口气重新承接用户刚才的感受，不向用户索取标准答案',
    ],
    forbiddenAssumptions: [
      '不得要求用户指出哪里不像、教当前角色怎么说或提供口气模板',
      '不得解释模型、系统、提示词或产品策略',
    ],
    fallbackSegments: hasCompoundEmotionalDisclosure
      ? [
          '你不只是嫌这句话不像 是心里那份想念一直没被接住',
          '刚才那股端着的劲我收了 你这些难受和想念 我好好听着',
        ]
      : ['是 这话听着还跟客服似的 不像家里人', '不端着了 你接着说 我好好听'],
  };
}
