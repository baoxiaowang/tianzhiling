/**
 * 微信导入语言风格：按维度合并规则（纯函数，无模型、无 IO）。
 *
 * 背景：`style.wechat_import.<batch>` 事实与 `personaProfile.languageProfile`
 * 里的七维风格来自不同批次的样本。样本量置信只是启发值：
 * 一个 10–29 条的新批次（confidence=0.48）不应把 ≥30 条且跨 2 天的可靠旧结果
 * （confidence=0.82）整体冲掉。
 *
 * 规则：
 * - 新批次置信 >= 旧批次置信时，可以改写已采用维度；
 * - 否则只补旧结果里为空的维度，已采用维度保持旧值；
 * - 每个被新批次写入的维度都要记录来源批次与置信；
 * - 整体 confidence 取新旧最大值，不低于旧值。
 *
 * 与 admin-node 共用：本文件不 import 任何 Midway/Nest/模型/队列运行时。
 */

/** 与 `AgentEntity.AgentPersonaLanguageProfile` 结构一致的七维语言风格。 */
export interface ChatImportLanguageProfile {
  sentenceLength?: string;
  modalParticles?: string;
  replyBubblePattern?: string;
  directness?: string;
  emotionalExpression?: string;
  addressStyle?: string;
  distinctiveRhythm?: string;
}

export type ChatImportLanguageDimension = keyof ChatImportLanguageProfile;

/** 单个维度的来源批次与样本量置信（启发值，不是校准后的准确率）。 */
export interface ChatImportLanguageDimensionSource {
  batchId?: string;
  confidence?: number;
}

export type ChatImportLanguageProfileSources = Partial<
  Record<ChatImportLanguageDimension, ChatImportLanguageDimensionSource>
>;

export interface MergeChatImportLanguageProfileOptions {
  previousLanguageProfile?: ChatImportLanguageProfile;
  previousLanguageProfileSources?: ChatImportLanguageProfileSources;
  /** 旧 personaProfile 的整体 confidence；缺省视为 0。 */
  previousConfidence?: number;
  incomingLanguageProfile: ChatImportLanguageProfile;
  incomingConfidence: number;
  incomingBatchId: string;
}

export interface MergedChatImportLanguageProfile {
  languageProfile: ChatImportLanguageProfile;
  languageProfileSources: ChatImportLanguageProfileSources;
  confidence: number;
}

const LANGUAGE_DIMENSIONS: ChatImportLanguageDimension[] = [
  'sentenceLength',
  'modalParticles',
  'replyBubblePattern',
  'directness',
  'emotionalExpression',
  'addressStyle',
  'distinctiveRhythm',
];

/**
 * 合并一个导入批次的语言风格结果。返回新对象，不修改入参。
 */
export function mergeChatImportLanguageProfile(
  options: MergeChatImportLanguageProfileOptions
): MergedChatImportLanguageProfile {
  const previousConfidence = options.previousConfidence ?? 0;
  const incomingStronger = options.incomingConfidence >= previousConfidence;
  const previous = options.previousLanguageProfile || {};
  const sources: ChatImportLanguageProfileSources = {
    ...(options.previousLanguageProfileSources || {}),
  };
  const merged: ChatImportLanguageProfile = {};

  for (const dimension of LANGUAGE_DIMENSIONS) {
    const existing = previous[dimension];
    const incoming = options.incomingLanguageProfile[dimension];
    if (!incoming) {
      // 新批次没有该维度（或为空）：保留旧值，来源不变。
      if (existing) merged[dimension] = existing;
      continue;
    }
    if (!existing || incomingStronger) {
      merged[dimension] = incoming;
      sources[dimension] = {
        batchId: options.incomingBatchId,
        confidence: options.incomingConfidence,
      };
      continue;
    }
    // 弱新批遇到可靠旧值：已采用维度不被覆盖。
    merged[dimension] = existing;
  }

  return {
    languageProfile: merged,
    languageProfileSources: sources,
    confidence: Math.max(previousConfidence, options.incomingConfidence),
  };
}
