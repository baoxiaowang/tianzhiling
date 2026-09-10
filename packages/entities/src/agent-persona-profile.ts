import type {
  AgentManualPersonaProfile,
  AgentPersonaProfile,
} from "./agent.entity";

export const CUSTOM_CONTEXT_PERSONA_VERSION =
  "custom_context_persona_v1" as const;

const MAX_STYLE_LENGTH = 110;
const MAX_STRATEGY_LENGTH = 70;
const NON_PERSONA_BOUNDARY_PATTERN = /编造|虚构|事实|经历|记忆|身份|安全边界/;

export function buildCustomContextPersonaProfile(
  customContext?: string
): AgentManualPersonaProfile | undefined {
  const source = normalize(customContext);
  if (!source) {
    return undefined;
  }

  const clauses = splitClauses(source);
  const sentenceLength = collectClauses(
    clauses,
    /多说|少说|简短|详细|完整|展开|篇幅|字数|一两句|一句话|长句|短句/,
    MAX_STYLE_LENGTH
  );
  const replyBubblePattern = collectClauses(
    clauses,
    /气泡|分段|分条|一条|多条|连续发送|一次回复/,
    MAX_STYLE_LENGTH
  );
  const directness = collectClauses(
    clauses,
    /直接|委婉|含蓄|坦率|绕弯/,
    MAX_STYLE_LENGTH
  );
  const emotionalExpression = collectClauses(
    clauses,
    /情绪|感受|想法|想念|思念|温柔|克制|热情|冷淡|亲密/,
    MAX_STYLE_LENGTH
  );
  const addressStyle = collectClauses(
    clauses,
    /称呼|怎么叫|叫.{0,12}为|喊.{0,12}为/,
    MAX_STYLE_LENGTH
  );
  const distinctiveRhythm = collectClauses(
    clauses,
    /语气|口头禅|节奏|自然|啰嗦|套话/,
    MAX_STYLE_LENGTH
  );
  const careStyle = collectClauses(
    clauses,
    /关心|安慰|倾诉|思念|难过|情绪|接住|感受|陪伴|回应|回复/,
    MAX_STYLE_LENGTH
  );
  const praiseStyle = collectClauses(
    clauses,
    /夸奖|表扬|肯定|鼓励|赞美/,
    MAX_STYLE_LENGTH
  );
  const criticismStyle = collectClauses(
    clauses,
    /批评|制止|不认同|反对|劝阻/,
    MAX_STYLE_LENGTH
  );
  const conflictStyle = collectClauses(
    clauses,
    /冲突|争吵|吵架|生气|道歉|和好/,
    MAX_STYLE_LENGTH
  );
  const questionStyle = collectClauses(
    clauses,
    /提问|追问|反问|问句|问问题/,
    MAX_STYLE_LENGTH
  );
  const humorStyle = collectClauses(
    clauses,
    /幽默|玩笑|打趣|逗|调侃/,
    MAX_STYLE_LENGTH
  );
  const highEqStrategies = unique([
    ...(/重复安慰/.test(source) ? ["避免重复安慰"] : []),
    ...(/堆.{0,4}套话|套话堆砌/.test(source) ? ["避免堆砌套话"] : []),
    ...clauses
      .filter((clause) =>
        /先.{0,35}再|避免重复|不要重复|少用套话|不要堆.{0,4}套话|别堆.{0,4}套话/.test(
          clause
        )
      )
      .filter((clause) => !NON_PERSONA_BOUNDARY_PATTERN.test(clause))
      .map((clause) => clause.slice(0, MAX_STRATEGY_LENGTH)),
  ]).slice(0, 3);

  const profile: AgentPersonaProfile = compactProfile({
    version: CUSTOM_CONTEXT_PERSONA_VERSION,
    careStyle,
    praiseStyle,
    criticismStyle,
    conflictStyle,
    questionStyle,
    humorStyle,
    languageProfile: compactLanguageProfile({
      sentenceLength,
      replyBubblePattern,
      directness,
      emotionalExpression,
      addressStyle,
      distinctiveRhythm,
    }),
    highEqStrategies,
  });

  if (!hasPersonaContent(profile)) {
    return undefined;
  }

  return {
    version: CUSTOM_CONTEXT_PERSONA_VERSION,
    sourceFingerprint: fingerprint(source),
    profile,
  };
}

export function resolveManualPersonaProfile(
  customContext?: string,
  stored?: AgentManualPersonaProfile
): AgentPersonaProfile | undefined {
  const source = normalize(customContext);
  if (!source) {
    return undefined;
  }
  const sourceFingerprint = fingerprint(source);
  if (
    stored?.version === CUSTOM_CONTEXT_PERSONA_VERSION &&
    stored.sourceFingerprint === sourceFingerprint &&
    hasPersonaContent(stored.profile)
  ) {
    return stored.profile;
  }
  return buildCustomContextPersonaProfile(source)?.profile;
}

export function mergeAgentPersonaProfiles(
  base?: AgentPersonaProfile,
  override?: AgentPersonaProfile
): AgentPersonaProfile | undefined {
  if (!base && !override) {
    return undefined;
  }
  if (!override) {
    return base;
  }
  if (!base) {
    return override;
  }

  return {
    ...base,
    ...override,
    demographics: mergeObjects(base.demographics, override.demographics),
    languageProfile: mergeObjects(
      base.languageProfile,
      override.languageProfile
    ),
    departedTransformation: mergeObjects(
      base.departedTransformation,
      override.departedTransformation
    ),
  };
}

function compactProfile(profile: AgentPersonaProfile): AgentPersonaProfile {
  const result: Record<string, unknown> = {};
  Object.entries(profile).forEach(([key, value]) => {
    if (
      Array.isArray(value)
        ? value.length > 0
        : value !== undefined && value !== null
    ) {
      result[key] = value;
    }
  });
  return result as AgentPersonaProfile;
}

function compactLanguageProfile(
  profile: NonNullable<AgentPersonaProfile["languageProfile"]>
): AgentPersonaProfile["languageProfile"] | undefined {
  const result: Record<string, string> = {};
  Object.entries(profile).forEach(([key, value]) => {
    if (value) {
      result[key] = value;
    }
  });
  return Object.keys(result).length ? result : undefined;
}

function mergeObjects<T extends object>(base?: T, override?: T): T | undefined {
  if (!base && !override) {
    return undefined;
  }
  return { ...(base || {}), ...(override || {}) } as T;
}

function hasPersonaContent(profile?: AgentPersonaProfile): boolean {
  if (!profile) {
    return false;
  }
  return Boolean(
    profile.careStyle ||
      profile.praiseStyle ||
      profile.criticismStyle ||
      profile.conflictStyle ||
      profile.questionStyle ||
      profile.humorStyle ||
      profile.highEqStrategies?.length ||
      (profile.languageProfile &&
        Object.values(profile.languageProfile).some(Boolean))
  );
}

function collectClauses(
  clauses: string[],
  pattern: RegExp,
  maxLength: number
): string | undefined {
  const result = unique(
    clauses.filter(
      (clause) =>
        !NON_PERSONA_BOUNDARY_PATTERN.test(clause) && pattern.test(clause)
    )
  ).join("；");
  return result ? result.slice(0, maxLength) : undefined;
}

function splitClauses(value: string): string[] {
  return unique(
    value
      .replace(/^客户要求\s*[：:]\s*/i, "")
      .split(/[。！？；\n]+/)
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

function normalize(value?: string): string {
  return (value || "").replace(/\s+/g, " ").trim();
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function fingerprint(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
