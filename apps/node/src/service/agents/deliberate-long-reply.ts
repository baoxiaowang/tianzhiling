export const DELIBERATE_LONG_REPLY_VERSION =
  'deliberate_long_reply_v2' as const;
export const DELIBERATE_LONG_REPLY_MIN_VISIBLE_CHARACTERS = 200;

export type DeliberateLongReplyExclusion =
  | 'below_threshold'
  | 'non_text_turn'
  | 'code_or_structured_material'
  | 'list_or_ledger'
  | 'repeated_content'
  | 'explicit_quoted_material';

export interface DeliberateLongReplyCandidateAssessment {
  version: typeof DELIBERATE_LONG_REPLY_VERSION;
  eligible: boolean;
  visibleCharacters: number;
  exclusion?: DeliberateLongReplyExclusion;
  modelReviewRequired: boolean;
  typeHint:
    | 'personal_or_mixed'
    | 'possible_poetry_or_quotation'
    | 'excluded_material'
    | 'below_threshold';
}

export type DeliberateLongReplyDecisionReason =
  | 'personal_disclosure'
  | 'relationship_letter'
  | 'multi_event_life_update'
  | 'mixed_personal_and_quote'
  | 'poetry_or_quotation'
  | 'forwarded_or_reference_material'
  | 'transactional_or_factual'
  | 'already_complete'
  | 'other';

export interface DeliberateLongReplyModelDecision {
  action: 'schedule_next_morning' | 'none';
  reason: DeliberateLongReplyDecisionReason;
  focus: string[];
}

export interface DeliberateLongReplyCommitmentRecovery {
  segments: string[];
  decision?: DeliberateLongReplyModelDecision;
  recovered: boolean;
  source?: 'missing_model_decision' | 'missing_visible_commitment';
}

const DELIBERATE_REPLY_ACKNOWLEDGEMENT =
  '你说的这些我不想匆匆接过去，让我放在心里好好想一晚，明早再认真跟你说。';

export function assessDeliberateLongReplyCandidate(options: {
  texts: string[];
  allMessagesAreText: boolean;
}): DeliberateLongReplyCandidateAssessment {
  const text = options.texts
    .map(item => item.trim())
    .filter(Boolean)
    .join('\n');
  const visibleCharacters = countDeliberateReplyVisibleCharacters(text);
  if (visibleCharacters < DELIBERATE_LONG_REPLY_MIN_VISIBLE_CHARACTERS) {
    return {
      version: DELIBERATE_LONG_REPLY_VERSION,
      eligible: false,
      visibleCharacters,
      exclusion: 'below_threshold',
      modelReviewRequired: false,
      typeHint: 'below_threshold',
    };
  }
  if (!options.allMessagesAreText) {
    return excluded(visibleCharacters, 'non_text_turn');
  }
  if (isHighConfidenceCodeOrStructuredMaterial(text)) {
    return excluded(visibleCharacters, 'code_or_structured_material');
  }
  if (isHighConfidenceListOrLedger(text)) {
    return excluded(visibleCharacters, 'list_or_ledger');
  }
  if (isHighConfidenceQuotedMaterialWithoutPersonalFrame(text)) {
    return excluded(visibleCharacters, 'explicit_quoted_material');
  }
  if (
    isHighConfidenceRepeatedContent(text) &&
    !hasSubstantialPersonalFrameAroundMaterial(text)
  ) {
    return excluded(visibleCharacters, 'repeated_content');
  }

  return {
    version: DELIBERATE_LONG_REPLY_VERSION,
    eligible: true,
    visibleCharacters,
    modelReviewRequired: true,
    typeHint: looksLikeVerseOrQuotation(text)
      ? 'possible_poetry_or_quotation'
      : 'personal_or_mixed',
  };
}

export function countDeliberateReplyVisibleCharacters(value = ''): number {
  return Array.from(value.replace(/\s/gu, '')).length;
}

export function buildDeliberateLongReplyCandidatePrompt(
  assessment: DeliberateLongReplyCandidateAssessment
): string {
  if (!assessment.eligible) return '';
  return [
    '# 次日慎重回应候选',
    `用户本轮约${assessment.visibleCharacters}字。字数只让本轮获得判断资格，不等于必须预约。`,
    '个人长信、重要经历、关系告白、多件重大近况或长期压在心里的话，默认选择 schedule_next_morning；只有内容已经完整收住、主要是诗词转发或单纯资料与事实问答时才选择 none。混合内容以用户自己的个人表达为准。',
    '选择 schedule_next_morning 时，当前回复先具体接住最重要的内容，能当场回答的明确或紧急问题仍要回答，并在给用户看的正文里自然说明：这段话会放在心里认真想，明早再继续回应。不能只在 JSON 字段里选择任务，也不要写成平台受理通知。',
  ].join('\n');
}

export function inspectDeliberateReplyCommitment(text: string): {
  hasThoughtfulPromise: boolean;
  hasMorningPromise: boolean;
} {
  return {
    hasThoughtfulPromise:
      /(?:认真|好好|仔细|慢慢|静下心)(?:地)?(?:想|看|读|琢磨|理|捋|消化)|想清楚|放在心里想/u.test(
        text
      ),
    hasMorningPromise:
      /(?:明天|明早|明晨|明儿|明早上|明天早上|明儿早上)[^。！？!?]{0,32}(?:回你|跟你说|和你聊|告诉你|来找你|接着说|给你(?:个)?回答)/u.test(
        text
      ),
  };
}

/**
 * The model still owns the semantic choice. This only recovers a malformed
 * or incomplete output contract after a high-confidence personal long-text
 * candidate has already passed deterministic exclusions. An explicit `none`
 * is always respected.
 */
export function recoverDeliberateLongReplyCommitment(options: {
  candidate?: DeliberateLongReplyCandidateAssessment;
  decision?: DeliberateLongReplyModelDecision;
  segments: string[];
}): DeliberateLongReplyCommitmentRecovery {
  if (!options.candidate?.eligible || options.decision?.action === 'none') {
    return {
      segments: [...options.segments],
      decision: options.decision,
      recovered: false,
    };
  }
  if (!options.decision && options.candidate.typeHint !== 'personal_or_mixed') {
    return {
      segments: [...options.segments],
      decision: undefined,
      recovered: false,
    };
  }

  const decision =
    options.decision ??
    ({
      action: 'schedule_next_morning',
      reason: 'other',
      focus: [],
    } as DeliberateLongReplyModelDecision);
  const visible = options.segments.join('\n');
  const commitment = inspectDeliberateReplyCommitment(visible);
  if (commitment.hasThoughtfulPromise && commitment.hasMorningPromise) {
    return {
      segments: [...options.segments],
      decision,
      recovered: options.decision === undefined,
      ...(options.decision === undefined
        ? { source: 'missing_model_decision' as const }
        : {}),
    };
  }

  const segments = [...options.segments];
  if (segments.length >= 3) {
    segments[segments.length - 1] = `${
      segments[segments.length - 1]
    }\n${DELIBERATE_REPLY_ACKNOWLEDGEMENT}`;
  } else {
    segments.push(DELIBERATE_REPLY_ACKNOWLEDGEMENT);
  }
  return {
    segments,
    decision,
    recovered: true,
    source:
      options.decision === undefined
        ? 'missing_model_decision'
        : 'missing_visible_commitment',
  };
}

export function buildDeliberateLongReplyExecutionPrompt(options: {
  focus: string[];
  sourceVisibleCharacters: number;
}): string {
  return [
    '# 次日慎重回应任务',
    '你昨晚已经具体接住用户的一段重要长消息，并说明会认真想过后再回应。现在是第二天早晨，请兑现承诺，主动发出真正有新增内容的正式回应。',
    '理解原文中的人物、事件、明确问题、最重的情绪和关系诉求，自然形成主次；不要机械逐项复述，也不要只给通用安慰。回复可以充分展开，最终展示会按语义自然拆泡。',
    options.focus.length
      ? `创建任务时留下的关注点（只是参考，不替你决策）：${options.focus.join(
          '；'
        )}`
      : '',
    `原消息约${options.sourceVisibleCharacters}个可见字符。这个数字只记录来源规模，不规定回复长短。`,
    '任务所指的原消息会以用户原本的身份固定保留在聊天历史中，此后对话也按真实顺序提供。结合后来聊天自行判断哪些已经说清、哪些仍值得回应；不要重复已经解决的点，也不要因为用户后来转了话题就假装没有这次承诺。',
    '不要提系统、任务、程序或字数，直接像这个具体亲人认真想过以后来跟用户说话。',
  ]
    .filter(Boolean)
    .join('\n');
}

function excluded(
  visibleCharacters: number,
  exclusion: DeliberateLongReplyExclusion
): DeliberateLongReplyCandidateAssessment {
  return {
    version: DELIBERATE_LONG_REPLY_VERSION,
    eligible: false,
    visibleCharacters,
    exclusion,
    modelReviewRequired: false,
    typeHint: 'excluded_material',
  };
}

function normalizedLines(text: string): string[] {
  return text
    .split(/\r?\n/u)
    .map(line => line.trim())
    .filter(Boolean);
}

function isHighConfidenceCodeOrStructuredMaterial(text: string): boolean {
  if (/```[\s\S]{80,}```/u.test(text)) return true;
  const lines = normalizedLines(text);
  const codeLines = lines.filter(line =>
    /^(?:import |export |const |let |var |function |class |interface |type |SELECT |INSERT |UPDATE |DELETE |\{|\}|\[|\]|<\/?[a-z])/iu.test(
      line
    )
  ).length;
  return lines.length >= 6 && codeLines / lines.length >= 0.7;
}

function isHighConfidenceListOrLedger(text: string): boolean {
  const lines = normalizedLines(text);
  if (lines.length < 8) return false;
  const listLines = lines.filter(line =>
    /^(?:[-*•·]|\d{1,3}[.、）)]|[一二三四五六七八九十]+[、.）)])/u.test(line)
  ).length;
  const moneyOrTableLines = lines.filter(line =>
    /(?:¥|￥|\d+(?:\.\d+)?元|\t|\|[^|]+\|)/u.test(line)
  ).length;
  if (moneyOrTableLines / lines.length >= 0.65) return true;

  const hasPersonalRelationshipContent =
    /(?:我|我们|爸爸|妈妈|爸|妈|爷爷|奶奶|姥姥|姥爷|外公|外婆|老公|老婆|丈夫|妻子|孩子|儿子|女儿|家里|想你|难过|害怕|委屈|后悔|舍不得|对不起)/u.test(
      text
    );
  return listLines / lines.length >= 0.85 && !hasPersonalRelationshipContent;
}

function isHighConfidenceRepeatedContent(text: string): boolean {
  const compact = text.replace(/\s/gu, '');
  if (/(.{12,80})\1{2,}/u.test(compact)) return true;
  const chunks = compact.match(/.{1,12}/gu) || [];
  if (chunks.length < 12) return false;
  return new Set(chunks).size / chunks.length < 0.35;
}

function isHighConfidenceQuotedMaterialWithoutPersonalFrame(
  text: string
): boolean {
  const explicitMaterialMarker =
    /(?:转发|转载|摘录|原文如下|全文如下|歌词|古诗|诗词|经文|祭文|悼词范文|文案模板|通知如下)/u.test(
      text
    );
  if (!explicitMaterialMarker) return false;
  const laterPersonalReflection =
    /(?:读完|看完|听完|这首诗让我|这段话让我|我真正想说|我想告诉你|对我来说|我读到这里)[：:，,\s]*([\s\S]+)/u.exec(
      text
    );
  if (
    laterPersonalReflection &&
    countDeliberateReplyVisibleCharacters(laterPersonalReflection[1]) >= 80
  ) {
    return false;
  }
  const materialStart =
    /(?:古诗|诗词|歌词|经文|祭文|悼词|摘录|原文|转发|转载)[^\n]{0,12}[：:]/u.exec(
      text
    );
  if (
    materialStart &&
    countDeliberateReplyVisibleCharacters(text.slice(0, materialStart.index)) <
      80
  ) {
    return true;
  }
  const personalFrame = text
    .replace(/[“”「」『』《》][\s\S]{30,}?[“”「」『』《》]/gu, '')
    .split(/\r?\n/u)
    .filter(
      line => !/^(?:转发|转载|摘录|原文|歌词|古诗|诗词|经文|祭文)/u.test(line)
    )
    .join('');
  return countDeliberateReplyVisibleCharacters(personalFrame) < 80;
}

function hasSubstantialPersonalFrameAroundMaterial(text: string): boolean {
  const marker =
    /(?:古诗|诗词|歌词|经文|祭文|悼词|摘录|原文|转发|转载)[：:]/u.exec(text);
  if (
    marker?.index &&
    countDeliberateReplyVisibleCharacters(text.slice(0, marker.index)) >= 80
  ) {
    return true;
  }
  const laterPersonalReflection =
    /(?:读完|看完|听完|这首诗让我|这段话让我|我真正想说|我想告诉你|对我来说|我读到这里)[：:，,\s]*([\s\S]+)/u.exec(
      text
    );
  return Boolean(
    laterPersonalReflection &&
      countDeliberateReplyVisibleCharacters(laterPersonalReflection[1]) >= 80
  );
}

function looksLikeVerseOrQuotation(text: string): boolean {
  if (/(?:歌词|古诗|诗词|经文|祭文|悼词|摘录|原文|转发|转载)/u.test(text)) {
    return true;
  }
  const lines = normalizedLines(text);
  if (lines.length < 6) return false;
  const shortLines = lines.filter(line => {
    const length = countDeliberateReplyVisibleCharacters(line);
    return length >= 4 && length <= 24;
  }).length;
  return shortLines / lines.length >= 0.8;
}
