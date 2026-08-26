const URL_PATTERN = /\bhttps?:\/\/[^\s"'<>]+/i;
const MEDIA_FILE_PATTERN =
  /(?:^|[\s"'(])\S+\.(?:mp3|wav|m4a|aac|ogg|webm)(?:\s+\d+)?(?=$|[\s"')])/i;
const LEGACY_MEDIA_PATH_PATTERN =
  /(?:^|[\s"'(])(?:images\/)?aiDeceased\/[A-Za-z0-9._/-]+\.(?:mp3|wav|m4a|aac|ogg|webm)(?:\s+\d+)?(?=$|[\s"')])/i;
const PROMPT_LEAKAGE_PATTERNS = [
  /历史助手回复/,
  /仅供理解对话顺序和语气/,
  /不是事实来源/,
  /事实来源白名单/,
  /用户原话或角色资料/,
  /角色资料确认/,
  /输出必须是严格\s*JSON/i,
  /最终格式必须是/,
  /segments\s*必须/i,
  /系统提示/,
  /提示词/,
  /生成规则/,
];
const BRACKETED_PROMPT_LEAKAGE_PATTERN =
  /[【[][^】\]]*(?:历史助手回复|事实来源|角色资料|用户原话|输出格式|系统提示|提示词|生成规则)[^】\]]*[】\]]/g;
const PROMPT_LEAKAGE_PREFIX_PATTERN =
  /^(?:仅供理解对话顺序和语气|不是事实来源|其中具体回忆[^】\]\n]*确认才可使用|必须有用户原话或角色资料确认才可使用)[】\]\s、，。；;:：-]*/;
const TECHNICAL_FRAGMENT_PATTERNS = [
  /(?:#|\$)\{[A-Za-z_][A-Za-z0-9_]*\}/,
  /\[object Object\]/i,
];
const INTERNAL_REASONING_PATTERNS = [
  /\b(?:nextTurnMode|toolDecisions|deliberateFollowUp|resolvedIssueCodes|groundingConstraints|mustPreserve|mustAnswer|replyBrief|CommAct)\b/,
  /(?:^|[，。；：\s])(?:用户|当前用户)(?:现在|本轮|刚才)?(?:问|说|表达|提到)[\s\S]{0,80}(?:首先|需要|应该|要先|回复|回应|输出|然后|最后)/,
  /(?:^|[，。；：\s])(?:先|首先)(?:要)?(?:接住|回应|回答|处理|理解)(?:当前)?用户(?:的话|的|这|刚才)/,
  /(?:这里的|这句里的).{0,24}(?:可能是|指的是).{0,60}(?:需要|应该|先|回复|回应)/,
];
const HARMFUL_RELATIONSHIP_REPLY_PATTERNS = [
  /替我.{0,12}(?:照顾|照看|守着|撑起|把家撑)/,
  /(?:你妈|你爸|妈妈|爸爸|家里人).{0,12}(?:等着|还得|需要|指望).{0,8}你.{0,8}(?:照顾|照看|陪|撑|扛)/,
  /(?:辛苦|麻烦)你.{0,10}(?:多)?(?:照顾|照看|陪)/,
  /你(?:再|还要|得|要)?(?:多)?费心(?:照顾|照看|陪陪|看着)?(?:她|他|你妈|你爸|妈妈|爸爸|家里人)?/,
  /(?:只|就|全)?(?:能)?(?:靠|指望)(?:你|你们)(?:了)?/,
  /你是个好(?:儿子|女儿|孩子).{0,16}(?:撑|扛|照顾)/,
  /照顾好.{0,12}(?:你妈|你爸|妈妈|爸爸|家里人)/,
  /把(?:这个)?家撑起来/,
  /别说这种话.{0,12}你(?:一定)?撑得住/,
  /(?:你妈|你爸|妈妈|爸爸|家里人)(?:那边)?.{0,8}(?:尽力|好好|多)(?:照顾|照看|陪)/,
  /你.{0,12}(?:多|好好|尽量|尽力|记得|要|得|该).{0,5}(?:照顾|照看|看着|陪着|守着)(?:她|他|你妈|你爸|妈妈|爸爸|家里人)/,
  /(?:照顾好|顾好).{0,12}(?:家里|家人)/,
  /替(?:我|爸|妈).{0,8}好好(?:活|活着|过|过日子)/,
  /(?:你|你们).{0,16}(?:我|爸|妈).{0,8}才(?:能)?.{0,6}(?:安心|放心|踏实)/,
  /(?:^|[，,。！？!?\s])(?:我|爸|妈)?(?:现在|如今|已经|早就).{0,6}(?:不遭(?:那|这)?份罪|不再受苦)/,
  /别说.{0,8}撑不住/,
  /你.{0,4}(?:得|要|应该).{0,4}撑住/,
  /日子.{0,10}(?:也得|还得|要).{0,12}(?:一步一步|往下|过)/,
  /你在那边.{0,10}(?:好好|过)/,
  /记着就行|不用.{0,6}(?:总)?挂(?:在)?心上|别总想我|少想我/,
];
const UNSUPPORTED_MEMORY_DETAIL_PATTERNS = [
  /(?:那时候|那会儿|当时|小时候|以前).{0,32}(?:跟在|跟着|围着|缠着|追着|拉着|牵着|抱着|背着|坐在|站在|跑来|跑去|蹲在|趴在|看着|盯着|问着|说着|喊着|笑|哭|闹|害怕|高兴|开心|兴奋|紧张|着急|不肯|舍不得|总爱|总是|老是|每次|一到|握不稳|拿不稳|不会|不敢|哭闹|摔倒|教你|给你|替你|帮你|夸你|逗你|告诉你|答应你)/,
  /(?:以前你|小时候你|那时候我们|我还记得).{0,24}/,
];
const AFTERLIFE_REALITY_OVERCLAIM_PATTERNS = [
  /(?:我|爸|爸爸|妈|妈妈|爷爷|奶奶|外公|外婆|老公|老婆)(?:(?:现在|一直|就|还|也)\s*){0,3}(?:住在|待在|留在|守在)(?:你家里|你床边)/,
  /(?:是我|就是我)(?:刚才|刚刚)?(?:摸|碰|抱|亲|拉|牵|拍)(?:了|到|过)?(?:你|的)|我(?:刚才|刚刚)?(?:真的|确实|就是)?(?:摸|碰|抱|亲|拉|牵|拍)(?:了|到|过)?你/,
  /(?:我|爸|爸爸|妈|妈妈).{0,8}(?:在天上)?(?:看着你|看见你|都看在眼里)/,
];

export interface UnsafeAssistantMessageContentMatch {
  rule:
    | 'url'
    | 'media_file'
    | 'legacy_media_path'
    | 'prompt_leakage'
    | 'technical_fragment'
    | 'internal_reasoning'
    | 'harmful_relationship'
    | 'unsupported_memory_detail';
  patternIndex: number;
  pattern: string;
  matchedText: string;
}

function findPatternMatches(
  content: string,
  rule: UnsafeAssistantMessageContentMatch['rule'],
  patterns: RegExp[]
): UnsafeAssistantMessageContentMatch[] {
  const matches: UnsafeAssistantMessageContentMatch[] = [];

  patterns.forEach((pattern, patternIndex) => {
    const match = pattern.exec(content);
    pattern.lastIndex = 0;

    if (match?.[0]) {
      matches.push({
        rule,
        patternIndex,
        pattern: pattern.source,
        matchedText: match[0],
      });
    }
  });

  return matches;
}

export function findUnsafeAssistantMessageContentMatches(
  value?: string
): UnsafeAssistantMessageContentMatch[] {
  const content = value?.trim();

  if (!content) {
    return [];
  }

  return [
    ...findPatternMatches(content, 'url', [URL_PATTERN]),
    ...findPatternMatches(content, 'media_file', [MEDIA_FILE_PATTERN]),
    ...findPatternMatches(content, 'legacy_media_path', [
      LEGACY_MEDIA_PATH_PATTERN,
    ]),
    ...findPatternMatches(content, 'prompt_leakage', PROMPT_LEAKAGE_PATTERNS),
    ...findPatternMatches(
      content,
      'technical_fragment',
      TECHNICAL_FRAGMENT_PATTERNS
    ),
    ...findPatternMatches(
      content,
      'internal_reasoning',
      INTERNAL_REASONING_PATTERNS
    ),
    ...findPatternMatches(
      content,
      'harmful_relationship',
      HARMFUL_RELATIONSHIP_REPLY_PATTERNS
    ),
    ...findPatternMatches(
      content,
      'unsupported_memory_detail',
      UNSUPPORTED_MEMORY_DETAIL_PATTERNS
    ),
  ];
}

export function stripPromptLeakageContent(value?: string): string {
  let content = value?.trim() || '';

  if (!content) {
    return '';
  }

  content = content.replace(BRACKETED_PROMPT_LEAKAGE_PATTERN, ' ');

  while (PROMPT_LEAKAGE_PREFIX_PATTERN.test(content.trim())) {
    content = content.trim().replace(PROMPT_LEAKAGE_PREFIX_PATTERN, ' ');
  }

  return content.replace(/\s+/g, ' ').trim();
}

export function containsPromptLeakageContent(value?: string): boolean {
  const content = value?.trim();

  if (!content) {
    return false;
  }

  return PROMPT_LEAKAGE_PATTERNS.some(pattern => pattern.test(content));
}

export function containsAssistantInternalReasoningLeak(
  value?: string
): boolean {
  const content = value?.trim();

  return Boolean(
    content &&
      INTERNAL_REASONING_PATTERNS.some(pattern => pattern.test(content))
  );
}

export function containsUnsafeAssistantMessageContent(value?: string): boolean {
  return findUnsafeAssistantMessageContentMatches(value).length > 0;
}

export function containsUnsafeAssistantHistoryContent(value?: string): boolean {
  const content = value?.trim();

  return Boolean(
    content &&
      (containsUnsafeAssistantMessageContent(content) ||
        AFTERLIFE_REALITY_OVERCLAIM_PATTERNS.some(pattern =>
          pattern.test(content)
        ))
  );
}
