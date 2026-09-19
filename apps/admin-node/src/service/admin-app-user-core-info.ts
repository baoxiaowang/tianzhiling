/**
 * 后台「核心信息」只读视图的纯组装逻辑（无 DB、无模型、无 IO）。
 *
 * 目标：把已经落库的称呼事实/资料字段、时间断言、籍贯与语言事实、导入七维、
 * 家人事实，组装成"当前采用值 + 来源 + 未采用原因"的只读视图。
 *
 * 与主聊天共用同一套选择规则：语言派生用 @tzl/shared 的 deriveLanguageSettings，
 * 冲突解决用 selectRoleCoreEntry / sourcePriority，后台不复制第二套优先级。
 *
 * 事实真值不在本文件：这里只消费 service 传入的落库记录，绝不写库、绝不触发抽取。
 */
import {
  HOMETOWN_FACT_KEY,
  buildDialectLabel,
  deriveLanguageSettings,
  parseHometownProvince,
  selectRoleCoreEntry,
  sourcePriority,
  type RoleCoreSourceKind,
  type RoleCoreSourceRef,
} from '@tzl/shared';

export type { RoleCoreSourceKind };

export type CoreEntryStatus = 'adopted' | 'pending' | 'rejected';

export interface CoreSourceView {
  kind: RoleCoreSourceKind;
  label: string;
  messageId: string;
  conversationId: string;
  batchId: string;
  field: string;
  at: string;
}

export interface CoreEntryView {
  value: string;
  status: CoreEntryStatus;
  /** 主体/作用范围，例如「角色」「用户」「家人」 */
  subject: string;
  source: CoreSourceView | null;
  /** 产品派生项指回它依据的事实 */
  derivedFrom: CoreSourceView | null;
  updatedAt: string;
  reason: string;
}

export interface CoreFactInput {
  id: string;
  type: string;
  key: string;
  value: string;
  status: string;
  confidence: string;
  priority: number;
  createdAt: string;
  updatedAt: string;
  sourceMessageId: string;
  sourceConversationId: string;
  sourceText: string;
  /** governance.timeKind：stable/current/historical/plan/wish */
  timeKind: string;
  /**
   * governance.reason：d9b2b54 起归档/更正会写入的真实原因原句。
   * 有值就原样展示，缺失时才回退到按 confidence/status 合成。
   */
  governanceReason: string;
}

export interface CorePersonaInput {
  personalityTraits: string;
  languageProfile: Record<string, string | undefined>;
  languageProfileSources: Record<
    string,
    { batchId?: string; confidence?: number } | undefined
  >;
  lifeTraits: string[];
  coreValues: string[];
}

export interface CoreAgentInput {
  id: string;
  name: string;
  realName: string;
  iCallAgent: string;
  agentCallMe: string;
  sex: string;
  birthday: string;
  deathDate: string;
  departureDuration: string;
  /** AgentEntity.languageHabits：资料字段，当前不进主聊天提示 */
  languageHabits: string;
  /** personaProfile.demographics.relationshipType，仅资料补充 */
  relationshipType: string;
  persona: CorePersonaInput;
}

export interface CoreTemporalProfileInput {
  bestAssertionId: string;
  subjectType: string;
  subjectId: string;
  eventType: string;
  calendar: string;
  precision: string;
  resolutionCertainty: string;
  conflictStatus: string;
  normalizedYear?: number;
  normalizedMonth?: number;
  normalizedDay?: number;
  exactDate: string;
  estimatedStart: string;
  estimatedEnd: string;
  updatedAt: string;
}

export interface CoreTemporalAssertionInput {
  id: string;
  eventType: string;
  subjectType: string;
  subjectId: string;
  rawText: string;
  status: string;
  sourceMessageId: string;
  sourceConversationId: string;
  createdAt: string;
}

export interface CoreInfoInput {
  userId: string;
  agent: CoreAgentInput;
  facts: CoreFactInput[];
  temporalProfiles: CoreTemporalProfileInput[];
  temporalAssertions: CoreTemporalAssertionInput[];
  /** key = `${subjectType}:${subjectId}` */
  subjectLabels: Record<string, string>;
}

export interface CoreAddressSection {
  userCallsAgent: CoreEntryView | null;
  agentCallsUser: CoreEntryView | null;
  agentAliases: string[];
  userAliases: string[];
  /** 含未采用候选，便于后台解释"为什么不是另一个" */
  candidates: CoreEntryView[];
  note: string;
}

export interface CoreDateItem {
  eventType: string;
  eventLabel: string;
  subjectType: string;
  subjectId: string;
  subjectLabel: string;
  /** 仅在有真实年份时给出；birthday_observance 一律为 null（不伪造出生年） */
  year: number | null;
  /** MM-DD；没有月日时为空 */
  monthDay: string;
  exactDate: string;
  calendar: string;
  precision: string;
  resolutionCertainty: string;
  conflictStatus: string;
  status: CoreEntryStatus;
  reason: string;
  source: CoreSourceView | null;
  updatedAt: string;
  note: string;
}

export interface CoreDateSection {
  items: CoreDateItem[];
  /** AgentEntity 兼容投影，不等同于 person_temporal 真值 */
  projections: Array<{
    field: string;
    label: string;
    value: string;
    note: string;
  }>;
  note: string;
}

export interface CoreImportDimension {
  key: string;
  label: string;
  value: string;
  batchId: string;
  confidence: number | null;
  source: CoreSourceView | null;
  updatedAt: string;
}

export interface CoreLanguageSection {
  hometown: {
    province: string;
    value: string;
    source: CoreSourceView | null;
    updatedAt: string;
  } | null;
  /** 当前实际采用、可注入主聊天提示的设定 */
  adopted: CoreEntryView | null;
  /** 被覆盖但仍保留解释的设定 */
  superseded: CoreEntryView[];
  /** 用户明确偏好（事实通道） */
  explicitPreference: CoreEntryView | null;
  /** 资料字段 languageHabits：当前不进主聊天提示，仅展示 */
  profileLanguageHabits: string;
  importDimensions: CoreImportDimension[];
  notes: string[];
}

export interface CorePersonalitySection {
  traits: Array<{ value: string; source: CoreSourceView | null }>;
  note: string;
}

export interface CoreFamilyItem {
  key: string;
  value: string;
  personLabel: string;
  status: string;
  learnedAt: string;
  updatedAt: string;
  /** stable | possibly_changing | unknown */
  stability: 'stable' | 'possibly_changing' | 'unknown';
  stabilityLabel: string;
  entryStatus: CoreEntryStatus;
  reason: string;
  source: CoreSourceView | null;
}

export interface CoreFamilySection {
  items: CoreFamilyItem[];
  note: string;
}

export interface CoreInfoView {
  userId: string;
  agentId: string;
  agentName: string;
  generatedAt: string;
  addresses: CoreAddressSection;
  dates: CoreDateSection;
  language: CoreLanguageSection;
  personality: CorePersonalitySection;
  family: CoreFamilySection;
  /** 数据库里没有对应信息、只能标注缺失或按规则合成的说明 */
  limitations: string[];
}

export const AGENT_PREFERRED_NAME_FACT_KEY =
  'relationship.preferred_agent_name';
export const AGENT_PREFERRED_NAME_PREFIX = '当前用户偏好称呼当前角色为';
export const USER_PREFERRED_NAME_FACT_KEY = 'relationship.preferred_user_name';
export const USER_PREFERRED_NAME_PREFIX = '当前用户希望当前角色称呼其为';
export const AGENT_DERIVED_ALIASES_FACT_KEY = 'identity.aliases.derived';
export const AGENT_DERIVED_ALIASES_PREFIX = '当前角色可识别的派生称呼：';
export const AGENT_EXPLICIT_ALIAS_FACT_PREFIX = 'identity.alias.confirmed.';
export const AGENT_EXPLICIT_ALIAS_PREFIX = '当前角色别名或昵称是';
export const USER_DERIVED_ALIASES_FACT_KEY = 'user.identity.aliases.derived';
export const USER_DERIVED_ALIASES_PREFIX = '用户可识别的派生称呼：';
export const USER_EXPLICIT_ALIAS_FACT_PREFIX = 'user.identity.alias.confirmed.';
export const USER_EXPLICIT_ALIAS_PREFIX = '用户别名或昵称是';
export const LANGUAGE_HABITS_FACT_KEY = 'profile_source.language_habits';
export const LANGUAGE_HABITS_VALUE_PREFIX = '当前角色语言习惯：';
export const SHARED_FAMILY_MEMBER_KEY_PREFIX = 'family.shared_member.';

const SOURCE_KIND_LABELS: Record<RoleCoreSourceKind, string> = {
  user_correction: '用户明确更正',
  user_explicit: '用户明确陈述',
  profile_field: '创建资料/资料字段',
  import_style: '导入聊天样本',
  product_derived: '产品派生（由已认可事实生成，非聊天证实）',
  summary: '资料摘要（派生资料，不作为强证据）',
};

const EVENT_TYPE_LABELS: Record<string, string> = {
  death: '离世时间',
  birth: '出生日期',
  birthday_observance: '年度生日（纪念日）',
  expected_birth: '预产期',
};

const SUBJECT_TYPE_LABELS: Record<string, string> = {
  user: '用户本人',
  agent: '当前角色',
  relative: '亲人',
};

const IMPORT_LANGUAGE_DIMENSIONS: Array<{ key: string; label: string }> = [
  { key: 'sentenceLength', label: '句长' },
  { key: 'modalParticles', label: '语气词' },
  { key: 'replyBubblePattern', label: '气泡/分段' },
  { key: 'directness', label: '直接程度' },
  { key: 'emotionalExpression', label: '情绪表达' },
  { key: 'addressStyle', label: '称呼习惯' },
  { key: 'distinctiveRhythm', label: '节奏特征' },
];

/** 旧数据没有真实 reason 时，合成原因统一加此前缀，后台据此与库中原句区分。 */
export const SYNTHESIZED_REASON_PREFIX = '【合成】';

/**
 * 旧数据归档/拒绝原因：库里没有写入真实 reason，只能按 confidence/status 合成并如实标注。
 * d9b2b54 起新写入的归档/更正会在 governance.reason 里带真实原句，此说明仅在缺失时使用。
 */
const ARCHIVED_REASON_NOTE =
  '（旧数据归档路径未写原因，本说明按 confidence/status 合成，非库中原句）';

export function buildCoreInfoView(input: CoreInfoInput): CoreInfoView {
  return {
    userId: input.userId,
    agentId: input.agent.id,
    agentName: input.agent.name || input.agent.realName || '',
    generatedAt: new Date().toISOString(),
    addresses: buildAddressSection(input),
    dates: buildDateSection(input),
    language: buildLanguageSection(input),
    personality: buildPersonalitySection(input),
    family: buildFamilySection(input),
    limitations: [
      `事实层更正/归档：d9b2b54 起新数据会在 governance.reason 写入真实原因原句（例如“用户明确更正：原事实「…」被「…」覆盖”），后台优先原样展示；只有旧数据没有 reason 时才回退到按 confidence/status 合成，并以“${SYNTHESIZED_REASON_PREFIX}”前缀与真实原因区分。`,
      '语言/称呼的“当前采用值”按 @tzl/shared 的来源优先级在后台重建；与主聊天共用同一优先级，但主聊天另有一套身份装配代码。',
      '年度生日（birthday_observance）即使库中存了年份也不在后台展示年份，避免把纪念日误当成出生年。',
      '没有来源消息的历史提取事实只能显示“历史提取，证据不完整”，不能定位到左侧原话。',
      '后台只读，不展示模型密钥、完整提示词、模型内部推理，也不读取其它用户的共享角色数据。',
    ],
  };
}

function buildAddressSection(input: CoreInfoInput): CoreAddressSection {
  const facts = input.facts;
  const preferredAgentFact = findActiveFact(
    facts,
    AGENT_PREFERRED_NAME_FACT_KEY
  );
  const preferredUserFact = findActiveFact(facts, USER_PREFERRED_NAME_FACT_KEY);
  const candidates: CoreEntryView[] = [];

  const userCallsAgentCandidates: Array<{
    value: string;
    source: RoleCoreSourceRef;
    reason: string;
    updatedAt: string;
  }> = [];

  if (preferredAgentFact) {
    userCallsAgentCandidates.push({
      value:
        readAfterPrefix(
          preferredAgentFact.value,
          AGENT_PREFERRED_NAME_PREFIX
        ) || preferredAgentFact.value,
      source: factSourceRef(preferredAgentFact),
      reason: '用户偏好的称呼（事实通道，主聊天优先采用）',
      updatedAt: preferredAgentFact.updatedAt,
    });
  }

  if (input.agent.iCallAgent) {
    userCallsAgentCandidates.push({
      value: input.agent.iCallAgent,
      source: { kind: 'profile_field', field: 'iCallAgent' },
      reason: '创建资料里的关系称呼（无更明确事实时采用）',
      updatedAt: '',
    });
  } else if (input.agent.relationshipType) {
    userCallsAgentCandidates.push({
      value: input.agent.relationshipType,
      source: {
        kind: 'profile_field',
        field: 'personaProfile.demographics.relationshipType',
      },
      reason: '画像里的关系类型（资料补充）',
      updatedAt: '',
    });
  }

  const agentCallsUserCandidates: Array<{
    value: string;
    source: RoleCoreSourceRef;
    reason: string;
    updatedAt: string;
  }> = [];

  if (preferredUserFact) {
    agentCallsUserCandidates.push({
      value:
        readAfterPrefix(preferredUserFact.value, USER_PREFERRED_NAME_PREFIX) ||
        preferredUserFact.value,
      source: factSourceRef(preferredUserFact),
      reason: '用户明确要求的称呼（事实通道，主聊天优先采用）',
      updatedAt: preferredUserFact.updatedAt,
    });
  }

  if (input.agent.agentCallMe) {
    agentCallsUserCandidates.push({
      value: input.agent.agentCallMe,
      source: { kind: 'profile_field', field: 'agentCallMe' },
      reason: '创建资料里的默认称呼（无更明确事实时采用）',
      updatedAt: '',
    });
  }

  const userCallsAgent = selectAndExplain(
    userCallsAgentCandidates,
    '角色',
    candidates
  );
  const agentCallsUser = selectAndExplain(
    agentCallsUserCandidates,
    '用户',
    candidates
  );

  // 归档/拒绝的称呼事实：必须展示真实状态，并如实标注原因只能合成。
  for (const fact of facts) {
    if (!isNameFactKey(fact.key)) continue;
    if (fact.status === 'active') continue;
    candidates.push({
      value: fact.value || '',
      status: 'rejected',
      subject: nameFactSubject(fact.key),
      source: sourceView(factSourceRef(fact), fact.updatedAt, fact),
      derivedFrom: null,
      updatedAt: fact.updatedAt,
      reason: rejectionReason(fact),
    });
  }

  return {
    userCallsAgent,
    agentCallsUser,
    agentAliases: collectActiveAliases(
      facts,
      AGENT_DERIVED_ALIASES_FACT_KEY,
      AGENT_DERIVED_ALIASES_PREFIX,
      AGENT_EXPLICIT_ALIAS_FACT_PREFIX,
      AGENT_EXPLICIT_ALIAS_PREFIX
    ),
    userAliases: collectActiveAliases(
      facts,
      USER_DERIVED_ALIASES_FACT_KEY,
      USER_DERIVED_ALIASES_PREFIX,
      USER_EXPLICIT_ALIAS_FACT_PREFIX,
      USER_EXPLICIT_ALIAS_PREFIX
    ),
    candidates,
    note: '当前采用值由后台按用户明确更正 > 用户明确陈述 > 资料字段 > 导入 > 产品派生的优先级取一条；同优先级取值冲突时保留待定，而不是选最新。',
  };
}

function buildDateSection(input: CoreInfoInput): CoreDateSection {
  const assertionsById = new Map(
    input.temporalAssertions.map(item => [item.id, item])
  );
  const items: CoreDateItem[] = [];

  for (const profile of input.temporalProfiles) {
    const isObservance = profile.eventType === 'birthday_observance';
    const assertion = profile.bestAssertionId
      ? assertionsById.get(profile.bestAssertionId)
      : undefined;
    const monthDay = resolveMonthDay(profile);
    const reason = dateReason(profile, isObservance);
    const status: CoreEntryStatus =
      profile.conflictStatus === 'conflicted'
        ? 'pending'
        : profile.resolutionCertainty === 'unresolved'
        ? 'pending'
        : 'adopted';
    const source: RoleCoreSourceRef | undefined = assertion
      ? {
          kind: 'user_explicit',
          messageId: assertion.sourceMessageId || undefined,
          at: assertion.createdAt ? new Date(assertion.createdAt) : undefined,
        }
      : undefined;

    items.push({
      eventType: profile.eventType,
      eventLabel: EVENT_TYPE_LABELS[profile.eventType] || profile.eventType,
      subjectType: profile.subjectType,
      subjectId: profile.subjectId,
      subjectLabel:
        input.subjectLabels[`${profile.subjectType}:${profile.subjectId}`] ||
        SUBJECT_TYPE_LABELS[profile.subjectType] ||
        '未知主体',
      year: isObservance
        ? null
        : typeof profile.normalizedYear === 'number'
        ? profile.normalizedYear
        : null,
      monthDay,
      exactDate: isObservance ? '' : profile.exactDate || '',
      calendar: profile.calendar,
      precision: profile.precision,
      resolutionCertainty: profile.resolutionCertainty,
      conflictStatus: profile.conflictStatus,
      status,
      reason,
      source: source ? sourceView(source, profile.updatedAt, assertion) : null,
      updatedAt: profile.updatedAt,
      note: isObservance
        ? '年度纪念日：只展示月日，不写年份（避免伪造出生年）。'
        : '',
    });
  }

  const projections: CoreDateSection['projections'] = [];
  if (input.agent.deathDate) {
    projections.push({
      field: 'AgentEntity.deathDate',
      label: '离世时间（兼容投影）',
      value: input.agent.deathDate,
      note: '由 person_temporal 真值回写的兼容字段；以此为准时仍需看上面的时间断言来源。',
    });
  }
  if (input.agent.birthday) {
    projections.push({
      field: 'AgentEntity.birthday',
      label: '角色生日（兼容投影）',
      value: input.agent.birthday,
      note: '仅由创建资料接口写入，目前没有 person_temporal 回写；可能对不上时间记忆。',
    });
  }
  if (input.agent.departureDuration) {
    projections.push({
      field: 'AgentEntity.departureDuration',
      label: '离世时长（预计算）',
      value: input.agent.departureDuration,
      note: '日批预计算的展示字符串，不是原始时间断言。',
    });
  }

  return {
    items,
    projections,
    note: '日期真值在 person_temporal_profile / person_temporal_assertion。冲突或未解析时保留待定，不用兼容投影冒充。',
  };
}

function buildLanguageSection(input: CoreInfoInput): CoreLanguageSection {
  const facts = input.facts;
  const hometownFact = findActiveFact(facts, HOMETOWN_FACT_KEY);
  const province = parseHometownProvince(hometownFact?.value);
  const habitsFact = findActiveFact(facts, LANGUAGE_HABITS_FACT_KEY);
  const explicitValue = readAfterPrefix(
    habitsFact?.value,
    LANGUAGE_HABITS_VALUE_PREFIX
  );

  const derived = deriveLanguageSettings({
    hometown:
      province && hometownFact
        ? {
            province,
            // 与主聊天保持一致：省级标签由程序拼成「<省>话」，方言支系仍不猜。
            languageLabel: buildDialectLabel(province),
            source: factSourceRef(hometownFact),
          }
        : undefined,
    explicit:
      explicitValue && habitsFact
        ? {
            value: explicitValue,
            source: { kind: 'profile_field', field: 'languageHabits' },
          }
        : undefined,
  });

  const notes: string[] = [];
  if (derived.note) notes.push(derived.note);
  if (!hometownFact)
    notes.push('没有 origin.hometown 籍贯事实，无法派生地域语言默认。');
  if (input.agent.languageHabits) {
    notes.push(
      '资料字段 languageHabits 当前不进入主聊天提示，只作为资料展示；实际采用的是上面的事实通道。'
    );
  }

  const importDimensions: CoreImportDimension[] =
    IMPORT_LANGUAGE_DIMENSIONS.map(dimension => {
      const value = input.agent.persona.languageProfile?.[dimension.key] || '';
      const sourceMeta =
        input.agent.persona.languageProfileSources?.[dimension.key];
      return {
        key: dimension.key,
        label: dimension.label,
        value,
        batchId: sourceMeta?.batchId || '',
        confidence:
          typeof sourceMeta?.confidence === 'number'
            ? sourceMeta.confidence
            : null,
        source: value
          ? {
              kind: 'import_style' as RoleCoreSourceKind,
              label: SOURCE_KIND_LABELS.import_style,
              messageId: '',
              conversationId: '',
              batchId: sourceMeta?.batchId || '',
              field: `personaProfile.languageProfile.${dimension.key}`,
              at: '',
            }
          : null,
        updatedAt: '',
      };
    }).filter(item => Boolean(item.value));

  return {
    hometown:
      hometownFact && province
        ? {
            province,
            value: hometownFact.value,
            source: sourceView(
              factSourceRef(hometownFact),
              hometownFact.updatedAt,
              hometownFact
            ),
            updatedAt: hometownFact.updatedAt,
          }
        : null,
    adopted: derived.active
      ? languageSettingToEntry(derived.active, '当前角色')
      : null,
    superseded: derived.superseded.map(setting =>
      languageSettingToEntry(setting, '当前角色')
    ),
    explicitPreference:
      explicitValue && habitsFact
        ? {
            value: explicitValue,
            status: 'adopted',
            subject: '当前角色',
            source: sourceView(
              { kind: 'profile_field', field: 'languageHabits' },
              habitsFact.updatedAt,
              habitsFact
            ),
            derivedFrom: null,
            updatedAt: habitsFact.updatedAt,
            reason: '用户明确的语言/口吻要求（事实通道，优先于籍贯派生）',
          }
        : null,
    profileLanguageHabits: input.agent.languageHabits || '',
    importDimensions,
    notes,
  };
}

function buildPersonalitySection(input: CoreInfoInput): CorePersonalitySection {
  const traits: CorePersonalitySection['traits'] = [];
  const seen = new Set<string>();
  const push = (value: string, source: CoreSourceView | null) => {
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (!normalized || seen.has(normalized) || traits.length >= 5) return;
    seen.add(normalized);
    traits.push({ value: normalized, source });
  };

  for (const trait of splitTraitText(input.agent.persona.personalityTraits)) {
    push(trait, {
      kind: 'profile_field',
      label: SOURCE_KIND_LABELS.profile_field,
      messageId: '',
      conversationId: '',
      batchId: '',
      field: 'personalityTraits',
      at: '',
    });
  }
  for (const trait of input.agent.persona.lifeTraits) {
    push(trait, {
      kind: 'summary',
      label: '画像特征（派生资料）',
      messageId: '',
      conversationId: '',
      batchId: '',
      field: 'personaProfile.lifeTraits',
      at: '',
    });
  }
  for (const trait of input.agent.persona.coreValues) {
    push(trait, {
      kind: 'summary',
      label: '画像特征（派生资料）',
      messageId: '',
      conversationId: '',
      batchId: '',
      field: 'personaProfile.coreValues',
      at: '',
    });
  }
  for (const fact of input.facts) {
    if (fact.status !== 'active') continue;
    if (fact.type !== 'style') continue;
    if (importFactBatchId(fact.key)) continue;
    push(fact.value, sourceView(factSourceRef(fact), fact.updatedAt, fact));
  }

  return {
    traits,
    note: '性格只取资料字段与已认可事实，最多 5 条；画像派生特征不作为强证据。',
  };
}

function buildFamilySection(input: CoreInfoInput): CoreFamilySection {
  const items: CoreFamilyItem[] = [];

  for (const fact of input.facts) {
    if (fact.type !== 'family') continue;
    const stability = classifyStability(fact.timeKind);
    items.push({
      key: fact.key,
      value: fact.value,
      personLabel: parseFamilyPersonLabel(fact.key, fact.value),
      status: fact.status,
      learnedAt: fact.createdAt,
      updatedAt: fact.updatedAt,
      stability: stability.kind,
      stabilityLabel: stability.label,
      entryStatus: fact.status === 'active' ? 'adopted' : 'rejected',
      reason:
        fact.status === 'active'
          ? '当前采用（事实层记录）'
          : rejectionReason(fact),
      source: sourceView(factSourceRef(fact), fact.updatedAt, fact),
    });
  }

  return {
    items,
    note: '稳定指不随时间变化的身份/关系；可能变化指处境、近况、计划。只来自当前角色的事实层，不混入用户或其他亲属。',
  };
}

// ---------- selection helpers ----------

function selectAndExplain(
  candidates: Array<{
    value: string;
    source: RoleCoreSourceRef;
    reason: string;
    updatedAt: string;
  }>,
  subject: string,
  sink: CoreEntryView[]
): CoreEntryView | null {
  if (!candidates.length) return null;
  const selected = selectRoleCoreEntry(candidates, {
    isSameValue: (left, right) => normalizeText(left) === normalizeText(right),
  });
  if (!selected) return null;

  const adopted: CoreEntryView = {
    value: selected.value,
    status: selected.status,
    subject,
    source: selected.source ? sourceView(selected.source, '', undefined) : null,
    derivedFrom: null,
    updatedAt:
      candidates.find(
        item => normalizeText(item.value) === normalizeText(selected.value)
      )?.updatedAt || '',
    reason:
      selected.reason ||
      (selected.status === 'pending'
        ? '来源同优先级但取值冲突，保留待定'
        : '按来源优先级采用'),
  };

  // 其余候选作为"未采用"连同真实原因一起展示。
  for (const candidate of candidates) {
    if (normalizeText(candidate.value) === normalizeText(selected.value)) {
      continue;
    }
    const candidatePriority = sourcePriority(candidate.source.kind);
    const adoptedPriority = selected.source
      ? sourcePriority(selected.source.kind)
      : 0;
    sink.push({
      value: candidate.value,
      status: candidatePriority >= adoptedPriority ? 'pending' : 'rejected',
      subject,
      source: sourceView(candidate.source, '', undefined),
      derivedFrom: null,
      updatedAt: candidate.updatedAt,
      reason:
        candidatePriority >= adoptedPriority
          ? '与当前采用值同优先级或更高，但选择规则判定为冲突，保留待定'
          : `被更高优先级来源覆盖（${
              SOURCE_KIND_LABELS[selected.source!.kind]
            }）`,
    });
  }

  sink.unshift(adopted);
  return adopted;
}

function languageSettingToEntry(
  setting: {
    value: string;
    origin: RoleCoreSourceKind;
    derivedFrom?: RoleCoreSourceRef;
    source?: RoleCoreSourceRef;
    active: boolean;
    reason?: string;
  },
  subject: string
): CoreEntryView {
  const detail = setting.derivedFrom || setting.source;
  const reason =
    setting.origin === 'product_derived'
      ? `${setting.reason || '由籍贯事实生成'}（产品派生，非聊天证实）`
      : setting.reason ||
        (setting.origin === 'user_explicit' ||
        setting.origin === 'user_correction'
          ? '用户明确要求/陈述'
          : '资料字段');
  return {
    value: setting.value,
    status: setting.active ? 'adopted' : 'rejected',
    subject,
    source: {
      kind: setting.origin,
      label: SOURCE_KIND_LABELS[setting.origin] || setting.origin,
      messageId:
        setting.source?.messageId || setting.derivedFrom?.messageId || '',
      conversationId: '',
      batchId: '',
      field: setting.source?.field || '',
      at: detail?.at ? new Date(detail.at).toISOString() : '',
    },
    derivedFrom: setting.derivedFrom
      ? sourceView(
          setting.derivedFrom,
          setting.derivedFrom.at
            ? new Date(setting.derivedFrom.at).toISOString()
            : '',
          undefined
        )
      : null,
    updatedAt: detail?.at ? new Date(detail.at).toISOString() : '',
    reason,
  };
}

function factSourceKind(fact: CoreFactInput): RoleCoreSourceKind {
  if (fact.confidence === 'user_corrected') return 'user_correction';
  const batchId = importFactBatchId(fact.key);
  if (batchId) return 'import_style';
  if (fact.key.startsWith('profile_source.')) return 'profile_field';
  return 'user_explicit';
}

function factSourceRef(fact: CoreFactInput): RoleCoreSourceRef {
  const kind = factSourceKind(fact);
  return {
    kind,
    messageId: fact.sourceMessageId || undefined,
    batchId: importFactBatchId(fact.key),
    at: fact.updatedAt ? new Date(fact.updatedAt) : undefined,
  };
}

function sourceView(
  ref: RoleCoreSourceRef,
  updatedAt: string,
  fact: { sourceMessageId?: string; sourceConversationId?: string } | undefined
): CoreSourceView {
  return {
    kind: ref.kind,
    label: SOURCE_KIND_LABELS[ref.kind] || ref.kind,
    messageId: ref.messageId || fact?.sourceMessageId || '',
    conversationId: fact?.sourceConversationId || '',
    batchId: ref.batchId || '',
    field: ref.field || '',
    at: ref.at ? new Date(ref.at).toISOString() : updatedAt || '',
  };
}

function rejectionReason(fact: CoreFactInput): string {
  // 优先读库里 d9b2b54 起写入的真实 governance.reason 原句，原样展示。
  const storedReason = (fact.governanceReason || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (storedReason) {
    return storedReason;
  }

  // 旧数据没有 reason：回退到合成，并用固定前缀让后台能区分“库中真实原因”与“合成”。
  if (fact.status === 'archived' && fact.confidence === 'user_corrected') {
    return `${SYNTHESIZED_REASON_PREFIX}不采用：被用户明确更正覆盖 ${ARCHIVED_REASON_NOTE}`;
  }
  if (fact.status === 'archived') {
    return `${SYNTHESIZED_REASON_PREFIX}不采用：已归档 ${ARCHIVED_REASON_NOTE}`;
  }
  if (fact.status === 'rejected') {
    return `${SYNTHESIZED_REASON_PREFIX}不采用：事实已被拒绝 ${ARCHIVED_REASON_NOTE}`;
  }
  if (fact.status === 'conflicted') {
    return `${SYNTHESIZED_REASON_PREFIX}不采用：与其它来源冲突，状态为 conflicted，保留待定`;
  }
  if (fact.status === 'pending' || fact.status === 'candidate') {
    return `${SYNTHESIZED_REASON_PREFIX}不采用：仍待确认（pending/candidate），未进入采用值`;
  }
  return `${SYNTHESIZED_REASON_PREFIX}不采用：状态 ${fact.status || '未知'}`;
}

function dateReason(
  profile: CoreTemporalProfileInput,
  isObservance: boolean
): string {
  if (profile.conflictStatus === 'conflicted') {
    return '存在冲突断言，当前保留待定';
  }
  if (profile.resolutionCertainty === 'unresolved') {
    return '尚未解析出可用日期，保留待定';
  }
  if (profile.resolutionCertainty === 'derived_exact') {
    return '由原话推导的日期（derived_exact），不是用户直接给出的精确日期';
  }
  if (profile.resolutionCertainty === 'estimated_range') {
    return '估算范围，不是精确日期';
  }
  if (isObservance) {
    return '年度生日纪念日，按当前采用的月日纪念；不写年份';
  }
  return '当前采用的日期断言';
}

function resolveMonthDay(profile: CoreTemporalProfileInput): string {
  const month =
    typeof profile.normalizedMonth === 'number'
      ? profile.normalizedMonth
      : undefined;
  const day =
    typeof profile.normalizedDay === 'number'
      ? profile.normalizedDay
      : undefined;
  if (month && day) {
    return `${pad2(month)}-${pad2(day)}`;
  }
  if (profile.exactDate) {
    const match = profile.exactDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) return `${match[2]}-${match[3]}`;
  }
  return '';
}

function classifyStability(timeKind: string): {
  kind: CoreFamilyItem['stability'];
  label: string;
} {
  if (timeKind === 'stable')
    return { kind: 'stable', label: '稳定（身份/关系）' };
  if (timeKind === 'current') {
    return { kind: 'possibly_changing', label: '可能变化（处境/近况）' };
  }
  if (timeKind === 'plan' || timeKind === 'wish') {
    return { kind: 'possibly_changing', label: '可能变化（计划/愿望）' };
  }
  if (timeKind === 'historical') {
    return { kind: 'stable', label: '历史事实' };
  }
  return { kind: 'unknown', label: '稳定性未知（库中无 timeKind）' };
}

function parseFamilyPersonLabel(key: string, value: string): string {
  if (key.startsWith(SHARED_FAMILY_MEMBER_KEY_PREFIX)) {
    return key.slice(SHARED_FAMILY_MEMBER_KEY_PREFIX.length) || '共同家人';
  }
  const match = value.match(/(?:名字叫|名叫|叫)([\u4e00-\u9fa5A-Za-z·]{1,12})/);
  if (match) return match[1];
  return key || '家人';
}

function isNameFactKey(key: string): boolean {
  return (
    // 明确更正会生成 `<canonicalKey>.superseded.<hash>` 的归档派生记录，
    // 这里用 startsWith 才能把它一并展示（旧值 + 真实 reason）。
    key.startsWith(AGENT_PREFERRED_NAME_FACT_KEY) ||
    key.startsWith(USER_PREFERRED_NAME_FACT_KEY) ||
    key === AGENT_DERIVED_ALIASES_FACT_KEY ||
    key === USER_DERIVED_ALIASES_FACT_KEY ||
    key.startsWith(AGENT_EXPLICIT_ALIAS_FACT_PREFIX) ||
    key.startsWith(USER_EXPLICIT_ALIAS_FACT_PREFIX)
  );
}

function nameFactSubject(key: string): string {
  if (key.startsWith('user.')) return '用户';
  return '角色';
}

function collectActiveAliases(
  facts: CoreFactInput[],
  derivedKey: string,
  derivedPrefix: string,
  explicitPrefix: string,
  explicitValuePrefix: string
): string[] {
  const aliases: string[] = [];
  for (const fact of facts) {
    if (fact.status !== 'active') continue;
    if (fact.key === derivedKey) {
      const raw = fact.value || '';
      const list = raw.startsWith(derivedPrefix)
        ? raw.slice(derivedPrefix.length)
        : '';
      for (const alias of list.split('、')) {
        pushAlias(aliases, alias);
      }
      continue;
    }
    if (fact.key.startsWith(explicitPrefix)) {
      pushAlias(
        aliases,
        readAfterPrefix(fact.value, explicitValuePrefix) || ''
      );
    }
  }
  return aliases;
}

function pushAlias(aliases: string[], value: string): void {
  const normalized = normalizeText(value);
  if (normalized && !aliases.includes(normalized)) {
    aliases.push(normalized);
  }
}

function findActiveFact(
  facts: CoreFactInput[],
  key: string
): CoreFactInput | undefined {
  return facts.find(fact => fact.key === key && fact.status === 'active');
}

function importFactBatchId(key: string): string | undefined {
  const prefix = 'style.wechat_import.';
  return key.startsWith(prefix) ? key.slice(prefix.length) : undefined;
}

function readAfterPrefix(value: string | undefined, prefix: string): string {
  const normalized = (value || '').trim();
  return normalized.startsWith(prefix)
    ? normalized.slice(prefix.length).trim()
    : '';
}

function splitTraitText(value: string): string[] {
  return (value || '')
    .split(/[、,，;；\n]+/)
    .map(item => item.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function normalizeText(value: string | undefined): string {
  return (value || '').replace(/\s+/g, '').trim();
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}
