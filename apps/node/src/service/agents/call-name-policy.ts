import { ConversationEmotionPrimary } from '@tzl/entities';
import { buildCallNamePool } from '../../common/call-name';
import type { ReplyScene } from './reply-scene-router';

/**
 * 本轮回复的称呼上下文。不传（展示、列表等非回复路径）时使用主称呼。
 */
export interface CallNameAddressContext {
  scene?: ReplyScene;
  emotion?: ConversationEmotionPrimary;
}

/**
 * 稳定档场景：危机、哀伤、冲突、纠正、边界与正事。
 * 这些时刻称呼必须固定、郑重，不做温度变化，也不换成更生分的叫法。
 */
const COLD_SCENES = new Set<ReplyScene>([
  'grief_crisis',
  'guilt_regret',
  'departure_hatred',
  'departure_blame',
  'authenticity_challenge',
  'correction',
  'source_challenge',
  'reality_presence_boundary',
  'family_care_boundary',
  'identity_fact',
  'business_support',
  'reincarnation_inquiry',
  'afterlife_status',
  'blessing_attribution',
  'unfinished_promise',
  'keepsake_attachment',
]);

/** 亲密档场景：思念、深情、梦中陪伴、求安慰。 */
const WARM_SCENES = new Set<ReplyScene>([
  'miss_longing',
  'unfinished_devotion',
  'dream_companionship',
  'comfort_request',
]);

/** 亲密档情绪：不依赖场景也能识别出的依恋状态。 */
const WARM_EMOTIONS = new Set<ConversationEmotionPrimary>([
  ConversationEmotionPrimary.attachment,
  ConversationEmotionPrimary.expectingPresence,
  ConversationEmotionPrimary.missing,
  ConversationEmotionPrimary.sadness,
]);

/**
 * 组装本轮可用称呼池：动态改口的最新称呼优先，其后是后台配置顺序。
 * 例：配置“老婆，姓傅的” + 聊天里说“以后叫我宝贝” → [宝贝, 老婆, 姓傅的]。
 */
export function resolveCallNamePool(
  configuredValue?: string | null,
  preferredName?: string | null
): string[] {
  return buildCallNamePool(configuredValue, preferredName);
}

/**
 * 按场景温度从称呼池里挑一个：
 *   0 稳定 → 池首；1 日常 → 第二个；2 亲密 → 第三个；越界回退到前一个。
 *
 * 生产数据显示多值称呼基本是等价昵称（不是“正式 vs 亲昵”的对照），所以这里只按
 * 场景温度决定取第几个，不假设某个词对应某种语义；顺序由用户自己填写。
 * 无上下文（展示/列表）时返回池首，保证与既有行为一致。
 */
export function selectCallName(
  pool: string[],
  context: CallNameAddressContext = {}
): string {
  if (pool.length === 0) {
    return '';
  }

  if (!context.scene && !context.emotion) {
    return pool[0];
  }

  let tier = 1;
  if (context.scene && COLD_SCENES.has(context.scene)) {
    tier = 0;
  } else if (context.scene && WARM_SCENES.has(context.scene)) {
    tier = 2;
  }

  if (context.emotion === ConversationEmotionPrimary.crisisRisk) {
    tier = 0;
  } else if (
    context.emotion &&
    WARM_EMOTIONS.has(context.emotion) &&
    tier !== 0
  ) {
    tier = 2;
  }

  return pool[Math.min(tier, pool.length - 1)];
}
