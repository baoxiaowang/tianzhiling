import type { AgentEntity } from '@tzl/entities';
import type {
  ConversationMovePlan,
  ReplyIntentRiskLevel,
} from './reply-intent';
import type { ReplyExperiencePlan } from './reply-experience-plan';
import type { ReplyScene } from './reply-scene-router';

export const REPLY_CARE_MOTIVATION_VERSION = 'care_motivation_v1' as const;

export type ReplyCareMotive =
  | 'mutual_longing'
  | 'ease_emotional_burden'
  | 'protect_current_wellbeing'
  | 'keep_family_connection'
  | 'share_user_joy'
  | 'cherish_connection';

export type ReplyCareFocus =
  | 'reciprocal_bond'
  | 'user_burden'
  | 'current_wellbeing'
  | 'family_present'
  | 'user_joy'
  | 'current_connection';

export interface ReplyCareMotivationPlan {
  version: typeof REPLY_CARE_MOTIVATION_VERSION;
  motive: ReplyCareMotive;
  focus: ReplyCareFocus;
  initiative: 'proactive';
  styleSource: 'persona' | 'relationship_default';
}

interface ResolveReplyCareMotivationOptions {
  currentQuery: string;
  mode: string;
  primaryScene?: ReplyScene;
  riskLevel: ReplyIntentRiskLevel;
  agent?: AgentEntity | null;
  experiencePlan: ReplyExperiencePlan;
  conversationPlan?: ConversationMovePlan;
}

const LONGING_SCENES = new Set<ReplyScene>([
  'miss_longing',
  'keepsake_attachment',
  'unfinished_devotion',
  'unfinished_promise',
  'dream_companionship',
]);
const BURDEN_SCENES = new Set<ReplyScene>([
  'comfort_request',
  'guilt_regret',
  'departure_blame',
  'past_life_understanding',
]);
const NO_CARE_MOTIVATION_SCENES = new Set<ReplyScene>([
  'authenticity_challenge',
  'correction',
  'source_challenge',
  'identity_fact',
  'business_support',
]);
const NO_CARE_MOTIVATION_MODES = new Set([
  'memory_control',
  'platform',
  'boundary',
]);
const CLOSE_PATTERN =
  /^(?:(?:妈|妈妈|爸|爸爸|爷爷|奶奶|外公|外婆|老公|老婆)[，, ]*)?(?:晚安|睡了|先睡了|拜拜|回头聊|嗯+|哦+|好+)[。！!~～]*$/;
const LONGING_PATTERN = /想你|想念|舍不得|梦见|盼着|念叨|好想/;
const BURDEN_PATTERN =
  /对不起|后悔|愧疚|怪我|自责|来不及|没能|难受|委屈|心里堵|撑不住|孤独|孤单|害怕|想哭/;
const WELLBEING_PATTERN =
  /累|疼|痛|不舒服|生病|住院|失眠|睡不着|没吃|没睡|压力|加班|受伤/;
const FAMILY_PATTERN =
  /家里|孩子|儿子|女儿|孙子|孙女|哥哥|姐姐|弟弟|妹妹|家人|亲戚/;
const JOY_PATTERN =
  /开心|高兴|终于|顺利|成功|考上|录取|升职|好转|出院|没事了|太好了/;

export function resolveReplyCareMotivationPlan(
  options: ResolveReplyCareMotivationOptions
): ReplyCareMotivationPlan | undefined {
  const currentQuery = options.currentQuery.trim();
  const scene = options.primaryScene;

  if (
    !currentQuery ||
    CLOSE_PATTERN.test(currentQuery) ||
    NO_CARE_MOTIVATION_MODES.has(options.mode) ||
    (scene && NO_CARE_MOTIVATION_SCENES.has(scene)) ||
    options.conversationPlan?.turnClosure === 'close'
  ) {
    return undefined;
  }

  const motive = resolveMotive(options, currentQuery);
  if (!motive) {
    return undefined;
  }

  return {
    version: REPLY_CARE_MOTIVATION_VERSION,
    motive,
    focus: focusForMotive(motive),
    initiative: 'proactive',
    styleSource: options.agent?.personaProfile?.careStyle
      ? 'persona'
      : 'relationship_default',
  };
}

export function buildReplyCareMotivationPrompt(
  plan: ReplyCareMotivationPlan
): string {
  const motiveText: Record<ReplyCareMotive, string> = {
    mutual_longing: '彼此想念，不让想念只落在用户一边',
    ease_emotional_burden: '舍不得用户独自背着难受或自责',
    protect_current_wellbeing: '惦记用户此刻过得好不好',
    keep_family_connection: '仍牵挂家里的人和事',
    share_user_joy: '真心为用户此刻的好消息高兴',
    cherish_connection: '珍惜这段联系，愿意主动多给一点',
  };
  const actionText: Record<ReplyCareFocus, string> = {
    reciprocal_bond: '说出一处亲人侧心意',
    user_burden: '承接后给有分寸的偏爱或宽慰',
    current_wellbeing: '贴着已说处境具体关心',
    family_present: '回应近况并给角色侧牵挂',
    user_joy: '一起高兴并给角色侧反应',
    current_connection: '给角色侧当下内容或相邻话题',
  };

  return `亲人侧动机：${motiveText[plan.motive]}；${
    actionText[plan.focus]
  }。按已有关心方式表达，不只复述或泛叮嘱，不解释动机。`;
}

function resolveMotive(
  options: ResolveReplyCareMotivationOptions,
  currentQuery: string
): ReplyCareMotive | undefined {
  const scene = options.primaryScene;

  if (options.riskLevel === 'high') {
    return 'protect_current_wellbeing';
  }
  if (
    (scene && BURDEN_SCENES.has(scene)) ||
    BURDEN_PATTERN.test(currentQuery)
  ) {
    return 'ease_emotional_burden';
  }
  if (
    (scene && LONGING_SCENES.has(scene)) ||
    LONGING_PATTERN.test(currentQuery)
  ) {
    return 'mutual_longing';
  }
  if (WELLBEING_PATTERN.test(currentQuery)) {
    return 'protect_current_wellbeing';
  }
  if (scene === 'family_life' || FAMILY_PATTERN.test(currentQuery)) {
    return 'keep_family_connection';
  }
  if (JOY_PATTERN.test(currentQuery)) {
    return 'share_user_joy';
  }
  if (
    ['emotional', 'relationship', 'family'].includes(options.mode) &&
    options.experiencePlan.conversationDepth !== 'D0'
  ) {
    return 'cherish_connection';
  }

  return undefined;
}

function focusForMotive(motive: ReplyCareMotive): ReplyCareFocus {
  const focuses: Record<ReplyCareMotive, ReplyCareFocus> = {
    mutual_longing: 'reciprocal_bond',
    ease_emotional_burden: 'user_burden',
    protect_current_wellbeing: 'current_wellbeing',
    keep_family_connection: 'family_present',
    share_user_joy: 'user_joy',
    cherish_connection: 'current_connection',
  };

  return focuses[motive];
}
