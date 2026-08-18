import { isReplyClosingTurn } from './reply-bubble-plan';
import type { ReplyBriefMode } from './reply-brief.service';
import type { ReplyIntentRiskLevel } from './reply-intent';
import type { ReplyScene } from './reply-scene-router';

export const DIRECT_ACTIVE_CONTRIBUTION_VERSION =
  'direct_active_contribution_v1' as const;

export interface DirectActiveContributionPlan {
  version: typeof DIRECT_ACTIVE_CONTRIBUTION_VERSION;
  mode: 'soft_optional';
}

export interface ResolveDirectActiveContributionOptions {
  planningMode?: 'direct' | 'semantic' | 'disabled';
  currentQuery: string;
  mode: ReplyBriefMode;
  primaryScene?: ReplyScene;
  riskLevel: ReplyIntentRiskLevel;
  hasCorrection: boolean;
  hasExplicitActiveContribution: boolean;
  hasCapabilityConstraints: boolean;
  hasRealityDependencies: boolean;
}

const ELIGIBLE_MODES = new Set<ReplyBriefMode>([
  'relationship',
  'family',
  'status',
  'daily',
  'general',
]);
const PROTECTED_SCENES = new Set<ReplyScene>([
  'grief_crisis',
  'authenticity_challenge',
  'correction',
  'source_challenge',
  'reality_presence_boundary',
  'family_care_boundary',
  'identity_fact',
  'business_support',
]);
const BARE_ACKNOWLEDGMENT_PATTERN =
  /^(?:嗯+|哦+|好+|行|可以|知道了|好的|谢谢|多谢)(?:呀|啊|呢|哦|嘛|哈|了|啦)*[。.!！?？\s]*$/;

/**
 * Only decides whether an ordinary direct turn may see the soft strategy.
 * It deliberately does not select content, bubbles, length, or revision rules.
 */
export function resolveDirectActiveContribution(
  options: ResolveDirectActiveContributionOptions
): DirectActiveContributionPlan | undefined {
  const currentQuery = options.currentQuery.trim();

  if (
    options.planningMode !== 'direct' ||
    !currentQuery ||
    !ELIGIBLE_MODES.has(options.mode) ||
    options.riskLevel === 'high' ||
    options.hasCorrection ||
    options.hasExplicitActiveContribution ||
    options.hasCapabilityConstraints ||
    options.hasRealityDependencies ||
    (options.primaryScene && PROTECTED_SCENES.has(options.primaryScene)) ||
    BARE_ACKNOWLEDGMENT_PATTERN.test(currentQuery) ||
    isReplyClosingTurn(currentQuery)
  ) {
    return undefined;
  }

  return {
    version: DIRECT_ACTIVE_CONTRIBUTION_VERSION,
    mode: 'soft_optional',
  };
}

export function buildDirectActiveContributionPrompt(
  plan: DirectActiveContributionPlan
): string {
  if (plan.mode !== 'soft_optional') {
    return '';
  }

  return [
    '先完整回应用户当前内容，再按人物性格、关系和语境自主判断，要不要自然补一点角色侧内容，例如一个贴题反应、轻微态度、小近况或相邻话题。',
    '这是可选能力，不是每轮必须完成的动作；只在确实有贴题新内容时使用，不用反问把聊天责任推回用户，也不用“我在、想你、照顾好自己”等通用话术充数。',
    '不为主动贡献增加字数或气泡，不因缺少它改写已经完整的回答；没有贴题新内容就自然停住。不得因此新编共同往事、用户现实或具体离世事件。',
  ].join('\n');
}
