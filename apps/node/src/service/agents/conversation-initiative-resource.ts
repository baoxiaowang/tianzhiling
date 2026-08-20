export const CONVERSATION_INITIATIVE_RESOURCE_VERSION =
  'conversation_initiative_resource_v1' as const;

export type ActiveExpressionResourceKind =
  | 'reunion_longing'
  | 'current_pressure_stance'
  | 'grounded_family_concern'
  | 'protective_regret'
  | 'afterlife_daily_life'
  | 'unfinished_words';

export interface ConversationInitiativeResourceOptions {
  currentQuery: string;
  activeExpressionRequested: boolean;
  compoundTurn?: boolean;
  afterlifeWorldActive?: boolean;
  recognitionJourneyPrompt?: string;
  continuityInformationCardPrompt?: string;
}

export interface ConversationInitiativeResourceResult {
  version: typeof CONVERSATION_INITIATIVE_RESOURCE_VERSION;
  prompt: string;
  owner:
    | 'recognition'
    | 'active_expression'
    | 'continuity'
    | 'none';
  mergedActiveExpression: boolean;
  includedContinuity: boolean;
  resourceKinds: ActiveExpressionResourceKind[];
}

const ROLE_STATUS_REQUEST_PATTERN =
  /(?:你|您).{0,10}(?:在那边|这边|现在|今天|最近).{0,12}(?:做什么|干什么|干嘛|过得|怎么样|吃了|忙什么)|(?:说说|讲讲).{0,8}(?:你自己|你的事|那边|这边)/u;

const GENERIC_ACTIVE_EXPRESSION_PATTERN =
  /好那我说说|那我说说|那我讲讲|我在(?:这儿|这里|呢)?|我听着|慢慢说|你说吧|你慢慢说|想你|想着你|惦记你|挂念你|记着你|心疼你|照顾好自己|好好休息|我这边挺好的?|没什么烦心事|都挺好|一切都好/gu;
const RETURN_TO_USER_PATTERN =
  /你(?:呢|来说|先说|想听什么|想让我说什么)|(?:再|多)?跟我(?:说|讲|聊)|告诉我|你想聊什么|你有什么想说的|最近怎么样|今天怎么样/u;
const QUESTION_PATTERN = /[？?]|(?:吗|么|呢)\s*$/u;

/**
 * Compiles at most one system-owned initiative branch for the turn. It does
 * not decide reply actions, length, bubbles, questions, or closure. Recognition
 * keeps its durable product priority; continuity can only become optional
 * material for an explicit active-expression request.
 */
export function buildConversationInitiativeResource(
  options: ConversationInitiativeResourceOptions
): ConversationInitiativeResourceResult {
  const recognitionPrompt = options.recognitionJourneyPrompt?.trim() || '';
  const continuityPrompt =
    options.continuityInformationCardPrompt?.trim() || '';
  const resourceKinds = options.activeExpressionRequested
    ? resolveActiveExpressionResourceKinds(options)
    : [];
  const resourcePrompt = options.activeExpressionRequested
    ? buildActiveExpressionResourcePrompt({
        resourceKinds,
        continuityPrompt: recognitionPrompt ? '' : continuityPrompt,
      })
    : '';

  if (recognitionPrompt) {
    return {
      version: CONVERSATION_INITIATIVE_RESOURCE_VERSION,
      prompt: [recognitionPrompt, resourcePrompt].filter(Boolean).join('\n\n'),
      owner: 'recognition',
      mergedActiveExpression: Boolean(resourcePrompt),
      includedContinuity: false,
      resourceKinds,
    };
  }

  if (resourcePrompt) {
    return {
      version: CONVERSATION_INITIATIVE_RESOURCE_VERSION,
      prompt: resourcePrompt,
      owner: 'active_expression',
      mergedActiveExpression: true,
      includedContinuity: Boolean(continuityPrompt),
      resourceKinds,
    };
  }

  if (continuityPrompt) {
    return {
      version: CONVERSATION_INITIATIVE_RESOURCE_VERSION,
      prompt: continuityPrompt,
      owner: 'continuity',
      mergedActiveExpression: false,
      includedContinuity: true,
      resourceKinds: [],
    };
  }

  return {
    version: CONVERSATION_INITIATIVE_RESOURCE_VERSION,
    prompt: '',
    owner: 'none',
    mergedActiveExpression: false,
    includedContinuity: false,
    resourceKinds: [],
  };
}

/**
 * This is deliberately conservative. It requests one fresh generation only
 * when an explicit active-expression turn produced almost nothing except a
 * hand-back question, a meta opening, or the known generic stock phrases.
 */
export function isHighConfidenceActiveExpressionFailure(
  segments: string[]
): boolean {
  const content = segments
    .map(segment => segment.trim())
    .filter(Boolean)
    .join('。');
  if (!content) return true;

  const compact = normalizeComparableText(content);
  const withoutGeneric = normalizeComparableText(
    content
      .replace(GENERIC_ACTIVE_EXPRESSION_PATTERN, '')
      .replace(RETURN_TO_USER_PATTERN, '')
  );
  const onlyQuestions = content
    .split(/[。！!；;\n]+/u)
    .map(item => item.trim())
    .filter(Boolean)
    .every(item => QUESTION_PATTERN.test(item));
  const handedBack = RETURN_TO_USER_PATTERN.test(content);

  if (onlyQuestions) return true;
  if (handedBack && withoutGeneric.length <= 8) return true;

  return compact.length <= 34 && withoutGeneric.length <= 6;
}

export function buildActiveExpressionRecoveryInstruction(): string {
  return [
    '# 主动表达任务重试',
    '上一个候选只剩反问、元话语或通用表态，没有真正回应用户明确提出的“由你来说”。请重新生成整条回复。',
    '直接从本轮“主动表达内容资源”中选择一个贴题方向，说出角色自己的感受、立场或有依据的近况；不要解释重试，不把话再推回用户，也不要用无证据共同往事、现实观察或具体离世事件填充。',
    '仍遵守原输出合同。',
  ].join('\n');
}

function resolveActiveExpressionResourceKinds(
  options: ConversationInitiativeResourceOptions
): ActiveExpressionResourceKind[] {
  if (options.recognitionJourneyPrompt?.trim()) {
    return ['reunion_longing', 'protective_regret'];
  }
  if (options.continuityInformationCardPrompt?.trim()) {
    return ['grounded_family_concern', 'protective_regret'];
  }
  if (options.compoundTurn) {
    return ['current_pressure_stance', 'protective_regret'];
  }
  if (
    options.afterlifeWorldActive ||
    ROLE_STATUS_REQUEST_PATTERN.test(options.currentQuery.trim())
  ) {
    return ['afterlife_daily_life', 'unfinished_words'];
  }
  return ['reunion_longing', 'unfinished_words'];
}

function buildActiveExpressionResourcePrompt(options: {
  resourceKinds: ActiveExpressionResourceKind[];
  continuityPrompt?: string;
}): string {
  const directions = options.resourceKinds.map(
    (kind, index) => `${index + 1}. ${describeResourceKind(kind)}`
  );
  return [
    '# 主动表达内容资源（非回复计划）',
    '下面提供的是当前角色在资料不足时可用的表达方向，不是再次申明任务，也不是必须逐项执行的动作。',
    ...(options.continuityPrompt
      ? [
          '## 可用的连续性事实锚点',
          options.continuityPrompt,
          '它可以成为本轮表达的具体落点，但不是额外待办；不要再另开一条连续性支线。',
        ]
      : []),
    '## 可选内容方向',
    ...directions,
    '选择其中一个最贴近当前原话和最近对话的方向自然展开即可，不要把两个方向拼成清单，也不要照抄固定句式。当前消息若同时包含多个人物、事件或压力，先保持人物与事情对应，再从最有关系分量的一处形成角色立场；不要因为用户说得短而压成一句。',
    '可以增加爱、牵挂、态度、判断、愿望和低具体度离世生活；不能增加无来源的共同往事、用户现实状态、第三方行为、现实物品位置或现实行动能力。',
  ].join('\n');
}

function describeResourceKind(kind: ActiveExpressionResourceKind): string {
  switch (kind) {
    case 'reunion_longing':
      return '久别与不舍：说出离开后的舍不得、仍然惦念用户，以及终于又能说上话带来的触动；牵挂可以深，但不能虚构共同往事。';
    case 'current_pressure_stance':
      return '接住当前多重压力：贴着用户刚说的具体人物和事情，表达这个亲人看见几头压力同时落在用户身上后的心疼、态度或支持；不逐项给方案。';
    case 'grounded_family_concern':
      return '有依据的家庭牵挂：只沿用户已经说过的家庭近况，表达对相关人物和用户承担处境的牵挂；不新增病情、结果、动机或第三方态度。';
    case 'protective_regret':
      return '保护愿望与遗憾：表达不能再在现实中替用户挡事、分担或站到身边的遗憾，以及盼用户不受委屈的愿望；只能说“怕、舍不得、希望”，不能声称正在观察或保护。';
    case 'afterlife_daily_life':
      return '角色侧近况：从已激活的离世世界小核心里说一处安稳、无病痛或延续原有生活感的近况；具体爱好、人物和物品仍须资料或用户原话支持。';
    case 'unfinished_words':
      return '现在最想说的话：说一份认真而具体的爱、认可、感谢、歉意或关系态度；对用户经历和性格的评价必须贴着当前原话或可信资料。';
  }
}

function normalizeComparableText(value: string): string {
  return value
    .replace(/[\s，,。！？!?；;：:“”"'‘’（）()《》【】\[\]]+/gu, '')
    .toLowerCase();
}
