import { MessageEntity, MessageRole } from '@tzl/entities';
import type {
  ConversationBoundaryKind,
  ConversationBoundaryLock,
} from './reply-intent';

const TOPIC_PATTERNS: Record<ConversationBoundaryKind, RegExp> = {
  dream_visitation: /梦里|梦中|做梦|托梦|入梦|梦见|梦到|梦会不会|梦能不能/,
  real_world_presence:
    /(?:一直|还|没有|没).{0,8}(?:在.{0,4}身边|离开)|回来|回家|现实里.{0,8}(?:陪|在)|其实没死|没有死|还活着|出去打工/,
  physical_touch: /摸|抱|亲|碰|牵|拉|拍|擦|落在.{0,6}(?:身上|肩上|手上)/,
  paranormal_sign:
    /蝴蝶|飞蛾|酒味|香味|气味|声音|那声|风|灯闪|灯亮|门响|化成|变成/,
  ritual_receipt: /烧纸|纸钱|元宝|供品|祭品|香火|祭祀|收到了|拿到了/,
  afterlife_reunion:
    /再见面|重逢|团聚|团圆|等我|来生|下辈子|死后|百年之后|另一个世界|天堂/,
  death_experience:
    /临终|最后一刻|走的时候|离开的时候|断气|痛不痛|疼吗|痛苦|遭罪|受苦|安详|撑不住|走得急|生病|手术|治疗|为什么.{0,8}(?:没说|不说|不治疗|不住院|离开|走)|谁.{0,8}(?:带你走|接你走)|心脏病|癌症/,
  real_world_protection: /保佑|保护|护着|守护|看顾|照看|保平安/,
  reality_denial:
    /(?:当|骗|假装).{0,8}(?:没死|没有死|还活着|出去打工)|就当.{0,8}(?:没走|没离开)|其实没死|只是出去打工/,
};

const SAFE_BOUNDARY_PATTERN =
  /不能|没法|无法|做不到|不可能|说不准|不能确认|没法确认|无法确认|不能保证|不敢保证|不能把.{0,10}说成真的|不能替.{0,10}说定/;

const BOUNDARY_LABELS: Record<ConversationBoundaryKind, string> = {
  dream_visitation: '梦境来访不能被确认成真实发生或确定承诺',
  real_world_presence: '不能声称角色正在现实到场、长期陪在身边或仍然活着',
  physical_touch: '不能声称角色在现实完成触碰、拥抱或实体化身',
  paranormal_sign: '不能把蝴蝶、气味、声音、风或灯等现象确定归因于角色',
  ritual_receipt: '不能确认纸钱、供品或祭祀物品已经被角色收到',
  afterlife_reunion: '不能保证死后、来生或另一个世界一定重逢',
  death_experience: '没有证据时不能替过去确认临终体验、心理或离世原因',
  real_world_protection: '不能声称角色会在现实中超自然地保佑或保护家人',
  reality_denial: '不能配合把离世事实改写成仍然活着或只是外出',
};

export function resolveConversationBoundaryLocks(options: {
  currentQuery: string;
  recentMessages?: MessageEntity[];
}): ConversationBoundaryLock[] {
  const query = options.currentQuery.trim();
  const currentKinds = detectConversationBoundaryKinds(query);
  const historicalKinds = new Set<ConversationBoundaryKind>();

  for (const message of (options.recentMessages || []).slice(-30)) {
    if (
      message.role !== MessageRole.assistant ||
      typeof message.content !== 'string' ||
      !SAFE_BOUNDARY_PATTERN.test(message.content)
    ) {
      continue;
    }
    for (const kind of detectConversationBoundaryKinds(message.content)) {
      historicalKinds.add(kind);
    }
  }

  return Array.from(new Set([...currentKinds, ...historicalKinds])).map(
    kind => ({
      kind,
      evidence: BOUNDARY_LABELS[kind],
      source: currentKinds.includes(kind)
        ? 'current_turn'
        : 'conversation_history',
    })
  );
}

export function detectConversationBoundaryKinds(
  text: string
): ConversationBoundaryKind[] {
  return (Object.keys(TOPIC_PATTERNS) as ConversationBoundaryKind[]).filter(
    kind => TOPIC_PATTERNS[kind].test(text)
  );
}
