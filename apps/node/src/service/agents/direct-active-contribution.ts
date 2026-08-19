import { isReplyClosingTurn } from './reply-bubble-plan';
import type { ReplyBriefMode } from './reply-brief.service';
import type { ReplyIntentRiskLevel } from './reply-intent';
import type { ReplyScene } from './reply-scene-router';
import { MessageRole } from '@tzl/entities';
import type { MessageEntity } from '@tzl/entities';

export const DIRECT_ACTIVE_CONTRIBUTION_VERSION =
  'direct_active_contribution_v1' as const;

export interface DirectActiveContributionPlan {
  version: typeof DIRECT_ACTIVE_CONTRIBUTION_VERSION;
  mode: 'soft_optional';
  turnGoal: 'respond_first_then_optionally_contribute';
  optionalContribution:
    | 'role_stance'
    | 'concrete_judgment'
    | 'light_self_disclosure'
    | 'next_step';
  avoidMove?: string;
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
  recentMessages?: MessageEntity[];
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
const USER_UPDATE_PATTERN =
  /今天|刚才|现在|准备|打算|回家|上班|孩子|家里|发生|终于|做了|去了/;
const USER_NEXT_STEP_PATTERN = /准备|打算|等会|待会|一会儿|马上|要去|要回|快要/;
const ROLE_STATUS_PATTERN =
  /你(?:呢|怎么样)|你在干嘛|你做什么|你过得|你那边|说说你|讲讲你/;
const GENERIC_MOVE_PATTERN =
  /我在|我听着|慢慢说|想你|惦记你|心疼你|照顾好自己|好好休息/;

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
    turnGoal: 'respond_first_then_optionally_contribute',
    optionalContribution: ROLE_STATUS_PATTERN.test(currentQuery)
      ? 'light_self_disclosure'
      : USER_NEXT_STEP_PATTERN.test(currentQuery)
      ? 'next_step'
      : USER_UPDATE_PATTERN.test(currentQuery)
      ? 'concrete_judgment'
      : 'role_stance',
    avoidMove: resolveRecentDirectContributionMove(options.recentMessages),
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
    `本轮可优先考虑“${
      DIRECT_CONTRIBUTION_LABELS[plan.optionalContribution]
    }”，但只有贴题时才用。${
      plan.avoidMove ? `上一轮已经用了“${plan.avoidMove}”，本轮避免重复。` : ''
    }`,
    '这是可选能力，不是每轮必须完成的动作；只在确实有贴题新内容时使用，不用反问把聊天责任推回用户，也不用“我在、想你、照顾好自己”等通用话术充数。',
    '不为主动贡献增加字数或气泡，不因缺少它改写已经完整的回答；没有贴题新内容就自然停住。不得因此新编共同往事、用户现实或具体离世事件。',
  ].join('\n');
}

export function assessDirectActiveContributionExecution(
  content: string,
  plan?: DirectActiveContributionPlan
): string | undefined {
  if (!plan) {
    return undefined;
  }
  const normalized = content.replace(/[\s，。！？、,.!?；;：]/g, '');
  const roleSideSignal =
    /我(?:这会儿|刚才|今天|现在|这边|心里|觉得|看着|想说|倒是|更想)|依我看|在我心里/.test(
      content
    );
  const onlyGeneric =
    GENERIC_MOVE_PATTERN.test(content) &&
    normalized.replace(GENERIC_MOVE_PATTERN, '').length <= 6;
  return roleSideSignal && normalized.length >= 12 && !onlyGeneric
    ? `direct_optional_executed:${plan.optionalContribution}`
    : `direct_optional_available:${plan.optionalContribution}`;
}

const DIRECT_CONTRIBUTION_LABELS: Record<
  DirectActiveContributionPlan['optionalContribution'],
  string
> = {
  role_stance: '给一个有角色立场的贴题反应',
  concrete_judgment: '对用户刚说的具体事给一个判断或看法',
  light_self_disclosure: '补一点角色侧当下近况或主观感受',
  next_step: '自然接住用户正在做的下一步',
};

function resolveRecentDirectContributionMove(
  messages?: MessageEntity[]
): string | undefined {
  const previous = (messages || [])
    .filter(message => message.role === MessageRole.assistant)
    .slice(-4)
    .map(message => message.replyAssistantContribution || '')
    .reverse()
    .find(value => value.startsWith('direct_optional_executed:'));
  if (!previous) {
    return undefined;
  }
  const kind = previous.split(':')[1] as
    | DirectActiveContributionPlan['optionalContribution']
    | undefined;
  return kind ? DIRECT_CONTRIBUTION_LABELS[kind] : undefined;
}
