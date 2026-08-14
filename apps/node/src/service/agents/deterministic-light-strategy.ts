import type { ReplyScene } from './reply-scene-router';
import type {
  ConversationMovePlan,
  ConversationMove,
  ConversationStance,
  ConversationSocialStrategy,
  ConversationQuestionNeed,
  ConversationTurnClosure,
  ReplyIntentEmotion,
  StructuredReplyIntentItem,
} from './reply-intent';

/**
 * 确定性轻量策略 — 零模型调用，为 direct 路径生成最小 conversationPlan。
 *
 * 语义规划器的 direct 分流已通过正则和场景路由确定了消息的简单性，
 * 这一步只是把"简单"翻译成结构化策略字段，消除 direct 路径的裸奔状态。
 */

interface SceneStrategyTemplate {
  stance: ConversationStance;
  moves: ConversationMove[];
  socialStrategy: ConversationSocialStrategy;
  strategyPurpose: string;
  questionNeed: ConversationQuestionNeed;
  turnClosure: ConversationTurnClosure;
}

const SCENE_STRATEGY: Partial<Record<ReplyScene, SceneStrategyTemplate>> = {
  daily_update: {
    stance: 'tender',
    moves: [{ type: 'acknowledge', goal: '接住用户的日常分享，给一点角色侧的回应温度' }],
    socialStrategy: 'direct',
    strategyPurpose: '用户分享日常时，只需接住和回应，不追问不扩展',
    questionNeed: 'none',
    turnClosure: 'close',
  },
  smalltalk: {
    stance: 'tender',
    moves: [{ type: 'acknowledge', goal: '自然闲聊回应' }],
    socialStrategy: 'direct',
    strategyPurpose: '日常闲聊，保持轻松自然的回应',
    questionNeed: 'none',
    turnClosure: 'neutral',
  },
  miss_longing: {
    stance: 'tender',
    moves: [
      { type: 'acknowledge', goal: '接住用户的思念' },
      { type: 'affirm', goal: '回应用户的情感，给一点角色侧当下的温度' },
    ],
    socialStrategy: 'direct',
    strategyPurpose: '用户表达思念时，接住情绪并回应温度，不追问',
    questionNeed: 'none',
    turnClosure: 'close',
  },
  comfort_request: {
    stance: 'tender',
    moves: [{ type: 'comfort', goal: '承接用户的情绪，给予情感安慰' }],
    socialStrategy: 'direct',
    strategyPurpose: '用户寻求安慰时，先接住情绪，不急于转移或追问',
    questionNeed: 'none',
    turnClosure: 'close',
  },
  family_life: {
    stance: 'tender',
    moves: [{ type: 'acknowledge', goal: '接住用户关于家庭近况的分享' }],
    socialStrategy: 'direct',
    strategyPurpose: '用户分享家庭近况，只需接住，不追问不扩展',
    questionNeed: 'none',
    turnClosure: 'close',
  },
  afterlife_status: {
    stance: 'tender',
    moves: [{ type: 'answer', goal: '简短回应在离世世界的状态，不展开编造细节' }],
    socialStrategy: 'protective_fiction',
    strategyPurpose: '用户问"在那边过得怎样"，简短回应，保护离世世界设定不崩塌',
    questionNeed: 'none',
    turnClosure: 'close',
  },
  blessing_attribution: {
    stance: 'tender',
    moves: [{ type: 'affirm', goal: '承认祝福和牵挂，同时明确现实结果来自用户自己' }],
    socialStrategy: 'direct',
    strategyPurpose: '用户将现实顺利归因于逝者祝福时，接住感情但不确认超自然因果',
    questionNeed: 'none',
    turnClosure: 'close',
  },
  guilt_regret: {
    stance: 'tender',
    moves: [{ type: 'acknowledge', goal: '接住用户的自责和不甘，不反驳也不确认，只表达亲人视角的理解' }],
    socialStrategy: 'direct',
    strategyPurpose: '用户自责或表达不甘时，先接住情绪，不把内疚反弹回用户',
    questionNeed: 'none',
    turnClosure: 'close',
  },
  departure_blame: {
    stance: 'tender',
    moves: [{ type: 'acknowledge', goal: '承认用户的失落和不舍，不辩解不走的原因' }],
    socialStrategy: 'protective_concealment',
    strategyPurpose: '用户责问"为什么走/丢下我们"时，接纳怨气但不解释死因',
    questionNeed: 'none',
    turnClosure: 'close',
  },
  business_support: {
    stance: 'tender',
    moves: [{ type: 'acknowledge', goal: '语音消息转为文字后可能不完整，接住用户的大致意图即可' }],
    socialStrategy: 'direct',
    strategyPurpose: '用户发语音/问平台相关，简短回应，不展开追问',
    questionNeed: 'none',
    turnClosure: 'close',
  },
};

/**
 * 为 direct 路径的消息生成确定性轻量 conversationPlan。
 * 只在场景明确且模板已定义时返回；未覆盖的场景返回 undefined，由上游继续走裸奔路径。
 */
export function buildDeterministicLightStrategy(options: {
  scene?: ReplyScene;
  currentQuery?: string;
  emotion?: ReplyIntentEmotion;
  intents?: StructuredReplyIntentItem[];
}): ConversationMovePlan | undefined {
  const { scene, intents } = options;

  if (!scene) return undefined;

  if (
    scene === 'family_life' &&
    intents?.some(
      item =>
        item.intent === 'share_family_update' &&
        item.subIntent === 'family_care'
    )
  ) {
    return {
      stance: 'tender',
      stanceTarget: 'user',
      moves: [
        { type: 'acknowledge', goal: '接住用户对家人健康的庆幸、担心或心疼' },
        { type: 'comfort', goal: '表达具体关心，不把照护责任推给用户' },
      ],
      socialStrategy: 'direct',
      strategyPurpose: '共情家人健康近况并表达具体关心',
      questionNeed: 'none',
      turnClosure: 'neutral',
      personaActivation: [],
    };
  }

  if (
    scene === 'comfort_request' &&
    /(?:不想活|想死|去死|撑不住|撑不下去|想去陪你|去找你|没有你|你不在)/.test(
      options.currentQuery || ''
    )
  ) {
    return {
      stance: 'tender',
      stanceTarget: 'user',
      moves: [
        { type: 'comfort', goal: '接住用户当前强烈的情绪' },
        { type: 'affirm', goal: '表达牵挂，不把当前表达判断成现实危险' },
      ],
      socialStrategy: 'direct',
      strategyPurpose: '承接强烈痛苦，不做危机判断',
      questionNeed: 'none',
      turnClosure: 'neutral',
      personaActivation: [],
    };
  }

  const template = SCENE_STRATEGY[scene];
  if (!template) return undefined;

  return {
    stance: template.stance,
    stanceTarget: 'user',
    moves: template.moves,
    socialStrategy: template.socialStrategy,
    strategyPurpose: template.strategyPurpose,
    questionNeed: template.questionNeed,
    turnClosure: template.turnClosure,
    personaActivation: [],
  };
}
