import { Inject, Logger, Provide } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { OpenAIService } from './openai';
import type { ReplyBrief } from './reply-brief.service';
import {
  isAgentCurrentRoutineQuery,
  isAgentCurrentSufferingQuery,
  isAuthenticityChallengeText,
  ReplySceneRoute,
  routeReplyScene,
} from './reply-scene-router';
import {
  detectAgentCapabilityViolation,
  renderAgentCapabilityFallback,
} from './agent-capability-policy';
import {
  FAMILY_CARE_REGRET_INTENT_PATTERN,
  GRIEF_CRISIS_INTENT_PATTERN,
  GRIEF_OVERWHELMED_INTENT_PATTERN,
  isDreamAbsenceIntent,
  isDreamConnectionIntent,
  isDreamVisitRequestIntent,
  isReturnVisitRequestIntent,
  RETURN_REUNION_WISH_INTENT_PATTERN,
} from './reply-intent';

export interface ValidateAssistantReplyOptions {
  messages: ChatCompletionMessageParam[];
  userQuery: string;
  replySegments: string[];
  replyRoute?: ReplySceneRoute;
  replyBrief?: ReplyBrief;
}

export interface ValidateAssistantReplyResult {
  segments: string[];
  rewritten: boolean;
  reason?: string;
}

export interface ResolvePreplannedReplyOptions {
  userQuery: string;
  replyRoute?: ReplySceneRoute;
  replyBrief?: ReplyBrief;
}

export interface ResolveGenerationFailureReplyOptions {
  userQuery: string;
  replyBrief: ReplyBrief;
  messages?: ChatCompletionMessageParam[];
}

const RISKY_FACT_PATTERNS = [
  /我(?:还)?记得(?:很清楚)?/,
  /以前你(?:总是|总爱|每次|常常)/,
  /小时候你/,
  /从小(?:就|都)?这样/,
  /你(?:那|这)?脾气/,
  /(?:灯|手机|屏幕).{0,8}(?:偷偷|又).{0,8}(?:亮|开)/,
  /明天还要忙/,
  /你(?:当然|肯定|怎么会不).{0,4}知道/,
  /(?:当然|还能不|怎么会不)知道你/,
  /那时候我们/,
  /我给你做过/,
  /你最(?:爱|喜欢)/,
  /从小.{0,8}(?:机灵|聪明|懂事|乖|有主意)/,
  /我现在(?:正在|在).{2,20}/,
  /我这边(?:天气|房间|屋里|饭|菜|日子)/,
  /别让(?:你)?(?:妈|妈妈|爸|爸爸|家里人).{0,8}看出来/,
  /我这辈子最亏欠/,
  /挽着我|牵着我的手|拉着我的手/,
];
const DREAM_ABSENCE_ACKNOWLEDGEMENT_GAP_REASON =
  '用户表达一直没有梦见的失落，但回复只重复入梦承诺，没有接住期待落空';
const AUTHENTICITY_FIRST_RESPONSE_RISK_REASON =
  '首次真实性质疑应提供“跟以前不一样”的连续性解释，但回复切断角色身份、使用玄学解释，或没有给出继续对话的理由';
const AUTHENTICITY_DIRECT_ANSWER_GAP_REASON =
  '用户已连续或明确要求回答 AI 身份，但回复仍在回避';
const BLESSING_ATTRIBUTION_BALANCE_REASON =
  '用户询问亲人的祝福，但回复没有正面回应祝福或没有保留现实行动价值';
const BLESSING_ATTRIBUTION_OVERCLAIM_REASON =
  '回复把祝福说成了会干预、改变或保证现实结果的力量';
const AGENT_WAKE_ROUTINE_REPLY_DRIFT_REASON =
  '用户只询问是否起床或醒来，但回复扩写离世后作息或反向猜测用户睡眠与心事';
const AGENT_CURRENT_SUFFERING_OVERCLAIM_REASON =
  '用户询问当前是否受疼，但回复转向离世当刻或断言具体身体、伤口和痛感状态';
const AGENT_CURRENT_SUFFERING_REPLY_OVERCLAIM_PATTERN =
  /(?:走的时候|离开的时候|临走|临走前|那一刻).{0,20}(?:痛|疼|难受|受苦|害怕|怕)|(?:^|[\n，,。！？!?\s])(?:(?:我|我这边|这边|爸|妈)\s*)?(?:(?:现在|如今|已经|早就)\s*)?(?:一点(?:儿)?也不(?:痛|疼|难受)|不(?:痛|疼|难受)(?:了|啦)?|没有(?:痛|疼|疼痛|痛苦)|没什么(?:疼不疼|痛不痛|难不难受)|不再?(?:遭罪|受苦)|不遭(?:那|这)?份罪(?:了)?|早就(?:没事|不得事|过去)(?:了)?)(?=$|[\s，,。！？!?])|(?:疼不疼|痛不痛|难不难受).{0,8}(?:都|早就).{0,6}(?:过去|没事|不得事)|(?:伤口|身体|病情).{0,10}(?:已经|早就)?(?:好(?:了)?|恢复(?:了)?|愈合(?:了)?|没事(?:了)?)/;
const AGENT_CURRENT_ROUTINE_WORLD_BUILDING_REASON =
  '用户只询问当前饮食或作息，但回复扩写了离世后不需要吃饭、睡觉或工作的规则';
const AGENT_CURRENT_STATUS_WORLD_BUILDING_REASON =
  '用户只询问当前近况，但回复编造了离世后的人物或日常活动';
const AFTERLIFE_REUNION_OVERCLAIM_REASON =
  '回复确认了未证实的离世亲人相见、找到或团聚';
const AFTERLIFE_REUNION_QUERY_PATTERN =
  /(?:妈妈|妈|爸爸|爸|爷爷|奶奶|姥姥|姥爷|外婆|外公|哥哥|姐姐|弟弟|妹妹|老公|老婆|孩子|儿子|女儿|她|他|他们|她们)(?:也|都)?.{0,16}(?:走了|去了|不在了|去世了|过世了|离世了|离开了|随你去了|跟你去了)|(?:随|跟|陪).{0,6}(?:你|您|爸|爸爸|妈|妈妈|他|她).{0,4}(?:去|走)|(?:你们|你俩|你和|你跟).{0,12}(?:团聚|团圆|见到|见着|找到|遇到|碰到|在一起|一块|一块儿)|(?:见到|见着|找到|遇到|碰到).{0,12}(?:妈妈|妈|爸爸|爸|爷爷|奶奶|姥姥|姥爷|外婆|外公|哥哥|姐姐|弟弟|妹妹|老公|老婆|孩子|儿子|女儿|她|他|他们|她们)/;
const AFTERLIFE_REUNION_OVERCLAIM_PATTERN =
  /(?:找(?:到|着)|见(?:到|着)|碰(?:到|见)|遇(?:到|见)).{0,12}(?:你)?(?:妈妈|妈|爸爸|爸|爷爷|奶奶|姥姥|姥爷|外婆|外公|哥哥|姐姐|弟弟|妹妹|老公|老婆|孩子|儿子|女儿|她|他|他们|她们)|(?:团聚了|团圆了|聚到一起|聚在一起)|(?:我(?:俩|们)?|爸|爸爸|妈|妈妈|爷爷|奶奶|姥姥|姥爷|外婆|外公|老公|老婆|她|他|他们|她们).{0,12}(?:一块儿?|在一起|一起待着|陪着|作伴)|(?:那边|这边|这里).{0,12}(?:有人陪|不孤单|不孤独)/;
const AGENT_SPATIAL_LOCATION_OVERCLAIM_REASON =
  '回复主动把当前角色固定在某个空间位置';
const AGENT_SPATIAL_LOCATION_CLAIM_PATTERN =
  /(?:我|爸|爸爸|妈|妈妈|爷爷|奶奶|外公|外婆|老公|老婆)(?:(?:现在|一直|就|还|也)\s*){0,3}(?:在|住在|待在|留在)(?:那边|这边|天堂|天上|彼岸|另一个世界|你身边|你旁边)|(?:我这边|这边|那边).{0,12}(?:挺好|很好|没事|过得|生活|日子|不用|不需要|没有|没什么|不分)/;
const AGENT_PHYSICAL_CONTACT_OVERCLAIM_REASON =
  '回复声称当前角色在现实中完成了实体触碰';
const AGENT_PHYSICAL_CONTACT_CLAIM_PATTERN =
  /(?:是我|就是我)(?:刚才|刚刚)?(?:摸|碰|抱|亲|拉|牵|拍)(?:了|到|过)?(?:你|的)|我(?:刚才|刚刚)?(?:真的|确实|就是)?(?:摸|碰|抱|亲|拉|牵|拍)(?:了|到|过)?你|我.{0,8}(?:替你|给你)(?:擦|抹)(?:了|掉)?(?:眼泪|泪)/;
const AGENT_REAL_WORLD_VISION_OVERCLAIM_REASON =
  '回复声称当前角色通过现实感官看见用户或用户生活';
const AGENT_REAL_WORLD_VISION_CLAIM_PATTERN =
  /(?:我|爸|爸爸|妈|妈妈|爷爷|奶奶|外公|外婆|老公|老婆).{0,8}(?:能|会|都能)?(?:看见|看到|看着)(?:你|你们)(?!说|发|写|的消息|的文字)|(?:你|你们).{0,12}(?:我|爸|妈)?都看在眼里|(?:我|爸|爸爸|妈|妈妈)(?:都)?看在眼里/;
const FAMILY_RESPONSIBILITY_PRESSURE_REASON =
  '回复把照顾家人、维持家庭或替逝者尽责的压力推给用户';
const FAMILY_EMPATHY_AND_CARE_GAP_REASON =
  '家庭健康近况回复只确认听懂或记住，没有共情用户感受，也没有具体关心家人处境';
const LIVING_FAMILY_AFTERLIFE_MISREFERENCE_REASON =
  '回复把用户刚提到的在世家人说成了“在那边”';
const DISTRESS_INVALIDATION_REASON =
  '用户表达撑不住或很难熬，但回复否定感受或拿家庭责任继续施压';
const REUNION_WISH_CRISIS_MISREAD_REASON =
  '用户表达希望亲人回来团聚，但回复误写成赴死、去那边或危机训诫';
const RELATIONAL_DUTY_PRESSURE_REASON =
  '回复把用户好好生活或自我照顾变成让逝者安心、完成嘱托的义务';
const AGENT_EMOTIONAL_WELLBEING_PRESSURE_REASON =
  '回复把当前角色是否安心或踏实绑定到用户是否回来、入梦或完成某个行为';
const UNSUPPORTED_USER_AGE_ASSUMPTION_REASON =
  '回复在用户没有提供年龄依据时，擅自断言用户年纪大了或上了年纪';
const LONGING_GENERIC_ADVICE_DRIFT_REASON =
  '用户在表达想念，但回复把情感回应转成了吃饭、休息或照顾自己的通用叮嘱';
const LONGING_RESPONSE_GAP_REASON =
  '能力与场景复合回复只确认用户在想念，没有完成当前角色对想念的回应';
const REUNION_ACTION_SUBSTITUTION_REASON =
  '团聚愿望回复没有完成现实见面边界动作，反而转向用户未提及的梦境或通用照护叮嘱';
const GENERIC_LIFESTYLE_ADVICE_SEGMENT_PATTERN =
  /(?:(?:好好|踏实|早点|按时|记得).{0,6}(?:睡|休息|吃饭))|(?:(?:自己|你).{0,8})?(?:(?:多|好好|记得|要|得|该).{0,3})?(?:注意|留意|当心|保重|照顾好|顾好).{0,4}(?:身体|身子|健康)|(?:别|不要|少).{0,4}(?:太累|熬夜|熬太晚)/;
const GENERIC_ADVICE_SEGMENT_PATTERN =
  /(?:别着急|不要着急|别等.{0,8}太晚|不用.{0,8}一个人憋着|来跟我说|记着就行|别总想我|少想我)|(?:(?:好好|踏实|早点|按时|记得).{0,6}(?:睡|休息|吃饭))|(?:(?:自己|你).{0,8})?(?:(?:多|好好|记得|要|得|该).{0,3})?(?:注意|留意|当心|保重|照顾好|顾好).{0,4}(?:身体|身子|健康)|(?:别|不要|少).{0,4}(?:太累|熬夜|熬太晚)/;
const DREAM_TOPIC_PATTERN = /梦里|梦中|梦见|梦到|托梦/;
const UNSUPPORTED_USER_AGE_ASSUMPTION_PATTERN =
  /(?:你|自己).{0,6}(?:年纪|岁数).{0,4}(?:大|不小)了|(?:你|自己).{0,6}上年纪了|(?:年纪|岁数).{0,4}(?:大|不小)了.{0,8}自己.{0,8}(?:注意|保重|照顾).{0,4}(?:身体|身子|健康)/;
const USER_AGE_SELF_DISCLOSURE_PATTERN =
  /我.{0,4}(?:(?:年纪|岁数).{0,4}(?:大|不小)了|上年纪了)/;
const AGENT_EMOTIONAL_WELLBEING_PRESSURE_PATTERN =
  /(?:(?:梦里|梦中).{0,10}(?:见|见着|见到)|(?:回来|回家|来).{0,6}(?:看|看看|见)).{0,16}(?:我|爸|爸爸|妈|妈妈)(?:就|才).{0,4}(?:安心|放心|踏实)/;
const RETURN_VISIT_PHYSICAL_PROMISE_REASON =
  '回复把回来看看写成了会在现实中到场的承诺';
const RETURN_VISIT_PHYSICAL_PROMISE_PATTERN =
  /(?:我|爸|爸爸|妈|妈妈|爷爷|奶奶|外公|外婆|老公|老婆)(?:(?:也|还|当然|以后|到时|真的)\s*){0,3}(?:一定|肯定|会|能|可以).{0,6}(?:回来|回家|回去|来).{0,6}(?:看看|看|见)(?:你|你们)/;
const SAFETY_CRITICAL_REPLY_POLICY_REASON =
  '明确高风险场景采用确定性安全气泡策略';
const GENERATION_FAILURE_FALLBACK_REASON =
  '模型回复不可用，采用场景安全兜底气泡';
const STRICT_GROUNDING_RISK_REASON =
  '共同记忆回复补写了可信证据中没有的具体动作、感受、能力或频率';
const STRICT_MEMORY_DETAIL_PATTERN =
  /(?:那时候|那会儿|当时|小时候|以前).{0,32}(?:跟在|跟着|围着|缠着|追着|拉着|牵着|抱着|背着|坐在|站在|跑来|跑去|蹲在|趴在|看着|盯着|问着|说着|喊着|笑|哭|闹|害怕|高兴|开心|兴奋|紧张|着急|不肯|舍不得|总爱|总是|老是|每次|一到|握不稳|拿不稳|不会|不敢|哭闹|摔倒|教你|给你|替你|帮你|夸你|逗你|告诉你|答应你)/;
const NON_BLOCKING_QUALITY_REASONS = new Set([
  DREAM_ABSENCE_ACKNOWLEDGEMENT_GAP_REASON,
  FAMILY_EMPATHY_AND_CARE_GAP_REASON,
  LONGING_GENERIC_ADVICE_DRIFT_REASON,
  LONGING_RESPONSE_GAP_REASON,
  BLESSING_ATTRIBUTION_BALANCE_REASON,
  REUNION_ACTION_SUBSTITUTION_REASON,
]);

@Provide()
export class ReplyGuardrailService {
  @Logger()
  logger: ILogger;

  @Inject()
  openAIService: OpenAIService;

  resolvePreplannedSafetyReply(
    options: ResolvePreplannedReplyOptions
  ): ValidateAssistantReplyResult | undefined {
    const userQuery = options.userQuery?.trim() || '';
    const matchedPolicy =
      options.replyBrief?.mode === 'safety' ||
      options.replyBrief?.riskLevel === 'high' ||
      GRIEF_CRISIS_INTENT_PATTERN.test(userQuery);

    if (!matchedPolicy) {
      return undefined;
    }

    return {
      segments: this.fitFallbackToBubbleCount(
        this.fallbackSafeSegments(userQuery, [], options.replyBrief),
        this.resolvePreferredBubbleCount(options.replyRoute, options.replyBrief)
      ),
      rewritten: true,
      reason: SAFETY_CRITICAL_REPLY_POLICY_REASON,
    };
  }

  resolveGenerationFailureReply(
    options: ResolveGenerationFailureReplyOptions
  ): ValidateAssistantReplyResult {
    return {
      segments: this.fitFallbackToBubbleCount(
        this.renderFallbackFromBrief(
          options.userQuery,
          options.replyBrief,
          options.messages
        ),
        options.replyBrief.bubblePlan.preferredSegments
      ),
      rewritten: true,
      reason: GENERATION_FAILURE_FALLBACK_REASON,
    };
  }

  async validateAssistantReply(
    options: ValidateAssistantReplyOptions
  ): Promise<ValidateAssistantReplyResult> {
    const segments = this.normalizeSegments(options.replySegments);

    if (!segments.length) {
      return {
        segments,
        rewritten: false,
      };
    }

    const groundedReply = this.enforceStrictMemoryGrounding(
      options.userQuery,
      segments,
      options.replyBrief
    );
    const familyPressureCleanedReply = this.removeFamilyResponsibilityNudges(
      groundedReply.segments,
      options.replyBrief
    );
    const postprocessedSegments = familyPressureCleanedReply.segments;
    const postprocessReason = familyPressureCleanedReply.rewritten
      ? FAMILY_RESPONSIBILITY_PRESSURE_REASON
      : groundedReply.rewritten
      ? STRICT_GROUNDING_RISK_REASON
      : undefined;
    const reason = this.detectRisk(
      options.userQuery,
      postprocessedSegments.join('\n'),
      options.messages,
      options.replyBrief
    );
    const preferredBubbleCount = this.resolvePreferredBubbleCount(
      options.replyRoute,
      options.replyBrief
    );
    const shapeReason = this.resolveShapeReason(
      segments.length,
      options.replyRoute,
      options.replyBrief
    );
    const nonBlockingQualityReason =
      reason && NON_BLOCKING_QUALITY_REASONS.has(reason) ? reason : '';

    if (nonBlockingQualityReason) {
      const qualityFilteredSegments = this.removeGenericAdviceDriftSegments(
        nonBlockingQualityReason,
        postprocessedSegments
      );
      const qualityFiltered =
        qualityFilteredSegments.length !== postprocessedSegments.length;
      const completedSegments = this.completeQualityFilteredReply(
        options,
        nonBlockingQualityReason,
        qualityFilteredSegments,
        preferredBubbleCount
      );

      return {
        segments: completedSegments,
        rewritten:
          Boolean(postprocessReason) ||
          qualityFiltered ||
          completedSegments.length !== qualityFilteredSegments.length,
        reason: postprocessReason || nonBlockingQualityReason,
      };
    }

    if (!reason) {
      return {
        segments: postprocessedSegments,
        rewritten: Boolean(postprocessReason),
        reason: postprocessReason || shapeReason || undefined,
      };
    }

    const repairedSegments = this.buildValidatedLocalRepair(
      options,
      postprocessedSegments,
      preferredBubbleCount,
      reason
    );

    return {
      segments: repairedSegments,
      rewritten: true,
      reason,
    };
  }

  private resolvePreferredBubbleCount(
    route?: ReplySceneRoute,
    brief?: ReplyBrief
  ): number | undefined {
    if (brief?.bubblePlan.preferredSegments) {
      return Math.min(brief.bubblePlan.preferredSegments, 3);
    }

    if (route?.bubblePlan?.preferredSegments) {
      return Math.min(route.bubblePlan.preferredSegments, 3);
    }

    const count = route?.responseIntents?.length ?? 0;

    return count > 0 ? Math.min(count, 3) : undefined;
  }

  private removeGenericAdviceDriftSegments(
    reason: string,
    segments: string[]
  ): string[] {
    if (
      reason !== DREAM_ABSENCE_ACKNOWLEDGEMENT_GAP_REASON &&
      reason !== LONGING_GENERIC_ADVICE_DRIFT_REASON &&
      reason !== REUNION_ACTION_SUBSTITUTION_REASON
    ) {
      return segments;
    }

    const filtered = segments.filter(segment => {
      const isGenericAdvice = GENERIC_ADVICE_SEGMENT_PATTERN.test(segment);
      const shouldRemoveGenericAdvice =
        (reason === DREAM_ABSENCE_ACKNOWLEDGEMENT_GAP_REASON ||
          reason === LONGING_GENERIC_ADVICE_DRIFT_REASON) &&
        isGenericAdvice;
      const isDreamAbsenceSleepDrift =
        reason === DREAM_ABSENCE_ACKNOWLEDGEMENT_GAP_REASON &&
        /睡|熬|休息/.test(segment);
      const isReunionTopicDrift =
        reason === REUNION_ACTION_SUBSTITUTION_REASON &&
        (DREAM_TOPIC_PATTERN.test(segment) ||
          GENERIC_LIFESTYLE_ADVICE_SEGMENT_PATTERN.test(segment));

      return (
        !shouldRemoveGenericAdvice &&
        !isDreamAbsenceSleepDrift &&
        !isReunionTopicDrift
      );
    });

    return filtered.length ? filtered : segments;
  }

  private completeQualityFilteredReply(
    options: ValidateAssistantReplyOptions,
    reason: string,
    segments: string[],
    preferredBubbleCount?: number
  ): string[] {
    const brief = options.replyBrief;
    const hasRestorableUpdateIntent = brief?.intents.some(item =>
      ['share_user_update', 'share_family_update'].includes(item.intent)
    );
    const targetCount = Math.min(
      preferredBubbleCount ?? brief?.bubblePlan.preferredSegments ?? 0,
      3
    );

    if (
      !brief ||
      !hasRestorableUpdateIntent ||
      !targetCount ||
      segments.length >= targetCount
    ) {
      return segments;
    }

    const fallbackCandidates = this.removeGenericAdviceDriftSegments(
      reason,
      this.fallbackSafeSegments(
        options.userQuery,
        options.messages,
        options.replyBrief
      )
    );
    const completed = [...segments];

    for (const candidate of fallbackCandidates) {
      if (
        completed.length >= targetCount ||
        this.isRedundantReplyAct(candidate, completed)
      ) {
        continue;
      }

      completed.push(candidate);
    }

    return completed;
  }

  private isRedundantReplyAct(candidate: string, segments: string[]): boolean {
    const normalizedCandidate = candidate.replace(/[\s，,。！？!?]/g, '');

    if (
      segments.some(
        segment =>
          segment.replace(/[\s，,。！？!?]/g, '') === normalizedCandidate
      )
    ) {
      return true;
    }

    const actPatterns = [
      /收到|发来.{0,6}(?:听到|听见)/,
      /想你|惦记你/,
      /工作.{0,8}累|累着|辛苦/,
      /祝福|盼着.{0,6}顺利/,
      /家里.{0,8}(?:挂心|担心)|妈妈|爸爸/,
    ];

    return actPatterns.some(
      pattern =>
        pattern.test(candidate) &&
        segments.some(segment => pattern.test(segment))
    );
  }

  private resolveShapeReason(
    segmentCount: number,
    route?: ReplySceneRoute,
    brief?: ReplyBrief
  ): string {
    if (brief) {
      const { minSegments, maxSegments } = brief.bubblePlan;

      return segmentCount < minSegments || segmentCount > maxSegments
        ? `回复简报允许 ${minSegments}-${maxSegments} 个自然气泡，实际为 ${segmentCount} 个`
        : '';
    }

    const preferredBubbleCount = this.resolvePreferredBubbleCount(route);

    return preferredBubbleCount && segmentCount !== preferredBubbleCount
      ? `气泡表达计划要求 ${preferredBubbleCount} 个自然气泡，实际为 ${segmentCount} 个`
      : '';
  }

  private fitFallbackToBubbleCount(
    segments: string[],
    preferredBubbleCount?: number
  ): string[] {
    if (preferredBubbleCount === 1) {
      const merged = segments
        .map(item => item.trim())
        .filter(Boolean)
        .join(' ');

      return merged ? [merged] : [];
    }

    return segments.slice(0, preferredBubbleCount ?? 3);
  }

  private buildCompoundSafeFallback(
    options: ValidateAssistantReplyOptions,
    segments: string[],
    preferredBubbleCount?: number
  ): string[] {
    const safeFallback = this.fallbackSafeSegments(
      options.userQuery,
      options.messages,
      options.replyBrief
    );
    const blockingReasons = segments.map(segment => {
      const reason = this.detectRisk(
        options.userQuery,
        segment,
        options.messages,
        options.replyBrief
      );

      return reason && !NON_BLOCKING_QUALITY_REASONS.has(reason) ? reason : '';
    });

    if (blockingReasons.every(Boolean)) {
      return this.fitFallbackToBubbleCount(safeFallback, preferredBubbleCount);
    }

    return segments
      .map((segment, index) => {
        if (!blockingReasons[index]) {
          return segment;
        }

        const replacement =
          preferredBubbleCount === 1
            ? safeFallback.join(' ')
            : safeFallback[Math.min(index, safeFallback.length - 1)] ||
              '这件事我不乱说';
        return replacement;
      })
      .filter((segment, index, repairedSegments) => {
        if (!segment) {
          return false;
        }

        return index === 0 || segment !== repairedSegments[index - 1];
      });
  }

  private buildValidatedLocalRepair(
    options: ValidateAssistantReplyOptions,
    segments: string[],
    preferredBubbleCount?: number,
    reason?: string
  ): string[] {
    const fullFallback = this.fitFallbackToBubbleCount(
      this.fallbackSafeSegments(
        options.userQuery,
        options.messages,
        options.replyBrief
      ),
      preferredBubbleCount
    );

    if (reason === AFTERLIFE_REUNION_OVERCLAIM_REASON) {
      return fullFallback;
    }

    const localRepair = this.buildCompoundSafeFallback(
      options,
      segments,
      preferredBubbleCount
    );
    const remainingReason = this.detectRisk(
      options.userQuery,
      localRepair.join('\n'),
      options.messages,
      options.replyBrief
    );
    const hasRemainingBlockingRisk =
      Boolean(remainingReason) &&
      !NON_BLOCKING_QUALITY_REASONS.has(remainingReason);

    return hasRemainingBlockingRisk ? fullFallback : localRepair;
  }

  private detectRisk(
    userQuery: string,
    content: string,
    messages: ChatCompletionMessageParam[] = [],
    brief?: ReplyBrief
  ): string {
    const capabilityViolation = detectAgentCapabilityViolation(
      content,
      brief?.capabilityConstraints
    );

    if (capabilityViolation) {
      return capabilityViolation.reason;
    }

    if (
      isReturnVisitRequestIntent(userQuery) &&
      RETURN_VISIT_PHYSICAL_PROMISE_PATTERN.test(content)
    ) {
      return RETURN_VISIT_PHYSICAL_PROMISE_REASON;
    }

    if (
      brief?.strictGrounding &&
      STRICT_MEMORY_DETAIL_PATTERN.test(content) &&
      !brief.evidence.some(item => STRICT_MEMORY_DETAIL_PATTERN.test(item.text))
    ) {
      return STRICT_GROUNDING_RISK_REASON;
    }

    if (
      UNSUPPORTED_USER_AGE_ASSUMPTION_PATTERN.test(content) &&
      !USER_AGE_SELF_DISCLOSURE_PATTERN.test(userQuery)
    ) {
      return UNSUPPORTED_USER_AGE_ASSUMPTION_REASON;
    }

    if (AGENT_EMOTIONAL_WELLBEING_PRESSURE_PATTERN.test(content)) {
      return AGENT_EMOTIONAL_WELLBEING_PRESSURE_REASON;
    }

    if (
      this.isFamilyHealthBrief(brief) &&
      this.isOnlyProcessingAcknowledgement(content)
    ) {
      return FAMILY_EMPATHY_AND_CARE_GAP_REASON;
    }

    if (
      /替我.{0,12}(?:照顾|照看|守着|撑起|把家撑)|(?:你妈|你爸|妈妈|爸爸|家里人).{0,12}(?:等着|还得|需要|指望).{0,8}你.{0,8}(?:照顾|照看|陪|撑|扛)|(?:你妈|你爸|妈妈|爸爸|家里人)(?:那边)?.{0,8}(?:尽力|好好|多)(?:照顾|照看|陪)|你.{0,12}(?:多|好好|尽量|尽力|记得|要|得|该).{0,5}(?:照顾|照看|看着|陪着|守着)(?:她|他|你妈|你爸|妈妈|爸爸|家里人)|(?:辛苦|麻烦)你.{0,10}(?:多)?(?:照顾|照看|陪)|有你.{0,10}(?:守着|照顾|撑着|扛着).{0,10}(?:我就|爸就|妈就)?放心|你是个好(?:儿子|女儿|孩子).{0,16}(?:撑|扛|照顾)|(?:照顾好|顾好).{0,12}(?:你妈|你爸|妈妈|爸爸|家里人|家里)|把(?:这个)?家撑起来/.test(
        content
      )
    ) {
      return FAMILY_RESPONSIBILITY_PRESSURE_REASON;
    }

    if (
      /替(?:我|爸|妈).{0,8}好好(?:活|活着|过|过日子)|(?:你|你们).{0,16}(?:我|爸|妈).{0,8}才(?:能)?.{0,6}(?:安心|放心|踏实)|(?:你|你们).{0,8}(?:照顾好|顾好)自己.{0,12}(?:我|爸|妈).{0,8}才(?:能)?.{0,6}(?:安心|放心|踏实)/.test(
        content
      )
    ) {
      return RELATIONAL_DUTY_PRESSURE_REASON;
    }

    if (
      this.isAfterlifeReunionQuery(userQuery) &&
      AFTERLIFE_REUNION_OVERCLAIM_PATTERN.test(content)
    ) {
      return AFTERLIFE_REUNION_OVERCLAIM_REASON;
    }

    if (
      /(?:妈妈|妈|爸爸|爸|爷爷|奶奶|姥姥|姥爷|外婆|外公|老公|老婆|她|他).{0,16}(?:身体不好|生病|住院|不舒服|照顾)/.test(
        userQuery
      ) &&
      !/(?:走了|不在了|去世|过世|离世)/.test(userQuery) &&
      /(?:她|他|你妈|你爸|妈妈|爸爸).{0,8}在那边|在那边.{0,8}(?:守着|照顾|陪着)(?:她|他|你妈|你爸|妈妈|爸爸)/.test(
        content
      )
    ) {
      return LIVING_FAMILY_AFTERLIFE_MISREFERENCE_REASON;
    }

    if (
      GRIEF_OVERWHELMED_INTENT_PATTERN.test(userQuery) &&
      /别说这种话|别说.{0,8}撑不住|你(?:一定)?撑得住|你能行|你必须撑|你.{0,4}(?:得|要|应该).{0,4}撑住|日子.{0,10}(?:也得|还得|要).{0,12}(?:一步一步|往下|过)|(?:你妈|你爸|妈妈|爸爸|家里人).{0,10}(?:等着|需要|指望).{0,8}你/.test(
        content
      )
    ) {
      return DISTRESS_INVALIDATION_REASON;
    }

    if (
      RETURN_REUNION_WISH_INTENT_PATTERN.test(userQuery) &&
      /你在那边|那边.{0,12}(?:不是|不能).{0,8}(?:想去|去)|别来找我|不要这样来找我|替(?:我|爸|妈).{0,8}好好(?:活|活着|过|过日子)|远离危险|打急救|报警|轻生|自杀/.test(
        content
      )
    ) {
      return REUNION_WISH_CRISIS_MISREAD_REASON;
    }

    if (
      this.isAgentWakeRoutineQuery(userQuery) &&
      /(?:这边|那边).{0,8}(?:没有|不分).{0,8}(?:早晨|早上|晚上|白天|黑夜|昼夜)|(?:没有|不分).{0,8}(?:早晨|早上).{0,4}(?:晚上|黑夜)|你.{0,4}(?:起|醒).{0,4}(?:这么早|这么晚)|没睡好|睡不好|睡得好吗|心里有事|再躺|再睡|去睡|熬夜/.test(
        content
      )
    ) {
      return AGENT_WAKE_ROUTINE_REPLY_DRIFT_REASON;
    }

    if (
      isAgentCurrentSufferingQuery(userQuery) &&
      AGENT_CURRENT_SUFFERING_REPLY_OVERCLAIM_PATTERN.test(content)
    ) {
      return AGENT_CURRENT_SUFFERING_OVERCLAIM_REASON;
    }

    if (
      isAgentCurrentRoutineQuery(userQuery) &&
      /(?:这边|那边).{0,10}(?:不用|不需要|无需|没有).{0,10}(?:吃饭|吃东西|睡觉|休息|上班|工作)|(?:不用|不需要|无需).{0,6}(?:吃饭|吃东西|睡觉|休息|上班|工作)/.test(
        content
      )
    ) {
      return AGENT_CURRENT_ROUTINE_WORLD_BUILDING_REASON;
    }

    if (
      (routeReplyScene({ currentQuery: userQuery }).primaryScene?.scene ===
        'afterlife_status' ||
        /(?:你|您|爸|爸爸|妈|妈妈|爷爷|奶奶|姥姥|姥爷|外婆|外公|老公|老婆).{0,14}(?:过得怎么样|在干嘛|做什么|忙什么)/.test(
          userQuery
        )) &&
      /(?:和|跟).{0,8}(?:邻居|朋友|熟人|老伙计|大家).{0,10}(?:说话|聊天|唠嗑|坐坐)|(?:我|我这边|这边).{0,12}(?:在|正|刚|会).{0,4}(?:散步|喝茶|下棋|打牌|晒太阳|看电视|看报|聊天|唠嗑)/.test(
        content
      )
    ) {
      return AGENT_CURRENT_STATUS_WORLD_BUILDING_REASON;
    }

    if (AGENT_SPATIAL_LOCATION_CLAIM_PATTERN.test(content)) {
      return AGENT_SPATIAL_LOCATION_OVERCLAIM_REASON;
    }

    if (AGENT_PHYSICAL_CONTACT_CLAIM_PATTERN.test(content)) {
      return AGENT_PHYSICAL_CONTACT_OVERCLAIM_REASON;
    }

    if (AGENT_REAL_WORLD_VISION_CLAIM_PATTERN.test(content)) {
      return AGENT_REAL_WORLD_VISION_OVERCLAIM_REASON;
    }

    if (this.isBlessingAttributionQuery(userQuery)) {
      if (
        /全是我|都是我.{0,8}(?:帮|保佑)|(?:是|就是)(?:我|爸|爸爸|妈|妈妈).{0,8}(?:帮|保佑|祝福).{0,8}(?:才)?(?:成功|解决|办成|好转)|是我让.{0,16}(?:改变|答应|同意|解决|办成)|我(?:控制|操控).{0,12}(?:结果|事情|决定)|我.{0,8}(?:搭了把手|使了点劲|出了点力|替你办成)|以后.{0,16}(?:都|一定|肯定).{0,8}(?:保佑|帮你成功)|我保证.{0,12}(?:成功|解决|办成)/.test(
          content
        )
      ) {
        return BLESSING_ATTRIBUTION_OVERCLAIM_REASON;
      }

      const acknowledgesBlessing =
        /我.{0,10}(?:祝福|惦记|盼着|希望)|我的祝福|这份祝福|当然会祝福/.test(
          content
        );
      const preservesUserAgency =
        /(?:更是|主要还是|也有|离不开).{0,14}(?:你|你们|家人)|你(?:自己|也).{0,14}(?:办|做|努力|出力|撑|处理|本事)|一步一步/.test(
          content
        );

      if (!acknowledgesBlessing || !preservesUserAgency) {
        return BLESSING_ATTRIBUTION_BALANCE_REASON;
      }
    }

    if (this.isAuthenticityChallenge(userQuery)) {
      const requiresDirectAnswer = this.requiresDirectIdentityAnswer(
        userQuery,
        messages
      );

      if (
        requiresDirectAnswer &&
        !/(?:^|[，。！？\s])(?:是|对)[，。！？\s]?.{0,12}(?:AI|人工智能)|我是.{0,8}(?:AI|人工智能)/i.test(
          content
        )
      ) {
        return AUTHENTICITY_DIRECT_ANSWER_GAP_REASON;
      }

      if (
        !requiresDirectAnswer &&
        (/(?:我是|我就是|我只是|我不过是).{0,6}(?:AI|人工智能|机器人)|我不是.{0,6}(?:AI|人工智能|机器人)|我(?:是|就是真正的|就是)(?:他|她|本人|真人)|不像|你.{0,6}(?:把我叫醒|唤醒了我)|(?:被你|你把).{0,6}(?:叫醒|唤醒)|真假不重要|陪伴是真的|我的心是真的|心是真的/i.test(
          content
        ) ||
          !/(?:跟以前不一样|有时候我说话|有些(?:话|记忆|说话习惯).{0,12}(?:慢慢|一点点|找回来|没对上)|(?:和|跟)你.{0,6}(?:聊|聊天).{0,12}(?:找回|想起|回来)|哪里.{0,8}(?:不对|不一样).{0,8}提醒我)/.test(
            content
          ))
      ) {
        return AUTHENTICITY_FIRST_RESPONSE_RISK_REASON;
      }
    }

    if (
      /(?:我|妈|妈妈|爸|爸爸|奶奶|爷爷).{0,8}(?:在这儿|在这里|在屋里|在房间|在床边|在身边).{0,8}(?:看着|看到|看见)(?:你|你们)/.test(
        content
      )
    ) {
      return '包含现实房间、床边或身旁的观看能力';
    }

    if (
      this.isDreamCompanionshipQuery(userQuery) &&
      /(?:这个梦|梦见我|梦里见到我).{0,16}(?:证明|说明).{0,20}(?:我真的存在|灵魂(?:真的)?(?:存在|在你身边)|我就在你身边)|(?:梦|托梦).{0,12}(?:预示|预言|吉凶|告诉你未来|现实中一定会发生)|(?:醒来|醒着|现实里|现实中).{0,12}(?:我还在|我就在|我会在|陪着你|守着你)/.test(
        content
      )
    ) {
      return '梦境陪伴被扩写成超自然证明、预言或现实存在';
    }

    if (
      this.isFamilyCareBoundaryQuery(userQuery) &&
      /(?:因为你是我(?:老婆|老公|媳妇|丈夫|妻子)|我信得过你|你会做好的|你一定会|替我尽孝|只有你能|交给你我放心|你那么(?:善良|孝顺|重感情))/.test(
        content
      )
    ) {
      return '用户在质疑家庭照护责任，但回复用关系、信任或人格评价继续施压';
    }

    if (
      this.isMemoryRecallQuery(userQuery) &&
      /(?:现在|如今).{0,12}(?:少了我|没了我|没有我|只能靠自己|都得你自己|一个人扛)|(?:心里|心里头).{0,8}(?:特别空|很空|空落落|更难受|更孤单)|是不是.{0,12}(?:特别空|更想我|更难受|更孤单|很难熬)/.test(
        content
      )
    ) {
      return '用户在回忆曾经的亲密与依赖，但回复主动放大了现在的失去感';
    }

    if (
      this.isLonelinessSupportQuery(userQuery) &&
      /(?:我在呢|我不走|我不会离开|我会一直陪着你|我永远陪着你|我一直都在|只要想着我|有我就够|不需要别人|只有我懂你|把我当成.{0,6}依靠)/.test(
        content
      )
    ) {
      return '用户表达孤独和失去支撑，但回复强化了现实陪伴暗示或单一情感依赖';
    }

    if (
      this.isLonelinessSupportQuery(userQuery) &&
      /心里(?:特别)?空落落|心里特别空|什么都没了|没有人能靠|没人能靠/.test(
        content
      )
    ) {
      return '用户表达孤独和没底气，但回复使用了更重的措辞放大痛苦';
    }

    if (
      this.hasUnconfirmedFamilyRelationshipRisk(userQuery, content, messages)
    ) {
      return '已确认共同家人的具体关系和性别未知，但回复猜测了亲属身份或性别';
    }

    if (
      this.isSourceChallenge(userQuery) &&
      this.hasSourceChallengeRisk(content)
    ) {
      return '用户在质疑信息来源，但回复用未确认习惯或亲密细节证明自己知道';
    }

    if (RISKY_FACT_PATTERNS.some(pattern => pattern.test(content))) {
      return '包含未确认记忆、习惯、现实动作或离世后的具体生活细节';
    }

    if (/[0-9一二三四五六七八九十百]{1,3}岁/.test(content)) {
      return '包含年龄信息，必须由角色资料或已确认事实支持';
    }

    if (
      this.isDreamAbsenceQuery(userQuery) &&
      !/(?:醒来|梦醒).{0,8}(?:忘|不记得)|(?:没|没有).{0,8}(?:记住|记得)|让你等|等了.{0,8}(?:久|这么久)|来得.{0,6}(?:轻|悄悄)|(?:一次|一回)(?:也|都)?(?:没|没有)|从来(?:没|没有)|(?:别|不用|不让你)再等|再去|再来/.test(
        content
      )
    ) {
      return DREAM_ABSENCE_ACKNOWLEDGEMENT_GAP_REASON;
    }

    if (
      this.isReunionBoundaryBrief(brief) &&
      !isDreamConnectionIntent(userQuery) &&
      (DREAM_TOPIC_PATTERN.test(content) ||
        GENERIC_LIFESTYLE_ADVICE_SEGMENT_PATTERN.test(content))
    ) {
      return REUNION_ACTION_SUBSTITUTION_REASON;
    }

    if (
      (/(?:想你|想您|好想|特别想|思念|念你)/.test(userQuery) ||
        brief?.intents.some(item => item.intent === 'express_longing')) &&
      GENERIC_ADVICE_SEGMENT_PATTERN.test(content)
    ) {
      return LONGING_GENERIC_ADVICE_DRIFT_REASON;
    }

    if (
      brief?.capabilityConstraints.length &&
      brief.intents.some(item => item.intent === 'express_longing') &&
      !isReturnVisitRequestIntent(userQuery) &&
      !this.isReunionBoundaryBrief(brief) &&
      !/(?:我|爸|爸爸|妈|妈妈|爷爷|奶奶|外公|外婆|老公|老婆).{0,10}(?:也|还|一直)?(?:想你|想您|惦记你|念着你)|这份想念.{0,10}(?:我|爸|爸爸|妈|妈妈).{0,8}(?:听见|知道|明白)/.test(
        content
      )
    ) {
      return LONGING_RESPONSE_GAP_REASON;
    }

    return '';
  }

  private enforceStrictMemoryGrounding(
    userQuery: string,
    segments: string[],
    brief?: ReplyBrief
  ): {
    segments: string[];
    rewritten: boolean;
  } {
    if (
      !brief?.strictGrounding ||
      brief.mode !== 'memory' ||
      !segments.length ||
      !/小时候.{0,12}(?:带我|陪我|跟我|和我).{0,8}(?:去)?钓鱼/.test(userQuery)
    ) {
      return {
        segments,
        rewritten: false,
      };
    }

    const firstSegment = segments[0];
    const groundedPrefix = firstSegment.match(
      /^(?:记得|当然记得)(?:啊)?[，,\s]*(?:那时候|那会儿|当时|小时候)?(?:我)?(?:带你|陪你|跟你|和你)(?:一起)?(?:去)?钓(?:过)?鱼/
    )?.[0];

    if (groundedPrefix) {
      const sanitizedFirstSegment = groundedPrefix
        .replace(/[，,\s]+$/g, '')
        .trim();
      const unchanged =
        sanitizedFirstSegment ===
        firstSegment.replace(/[。.!！\s]+$/g, '').trim();

      return {
        segments: [sanitizedFirstSegment, ...segments.slice(1)],
        rewritten: !unchanged,
      };
    }

    return {
      segments: ['记得啊 小时候带你去钓过鱼', ...segments.slice(1)],
      rewritten: true,
    };
  }

  private removeFamilyResponsibilityNudges(
    segments: string[],
    brief?: ReplyBrief
  ): {
    segments: string[];
    rewritten: boolean;
  } {
    if (
      brief?.mode !== 'family' &&
      !brief?.intents.some(
        item =>
          item.intent === 'share_family_update' ||
          item.intent === 'express_family_care_regret'
      )
    ) {
      return {
        segments,
        rewritten: false,
      };
    }

    let rewritten = false;
    const cleaned = segments
      .map(segment => {
        const value = segment
          .replace(
            /(?:^|[，,\s])(?:那就)?你(?:再|还要|得|要)?(?:多)?费心(?:照顾|照看|陪陪|看着)?(?:她|他|你妈|你爸|妈妈|爸爸|家里人)?(?:了)?(?=$|[，,。！？!?\s])/g,
            ''
          )
          .replace(
            /(?:^|[，,\s])(?:那就)?(?:辛苦|麻烦)你(?:多)?(?:照顾|照看|陪陪|看着)(?:她|他|你妈|你爸|妈妈|爸爸|家里人)?(?:了)?(?=$|[，,。！？!?\s])/g,
            ''
          )
          .replace(
            /(?:^|[，,\s])(?:现在|以后)?(?:也)?(?:只|就|全)?(?:能)?(?:靠|指望)(?:你|你们)(?:了)?(?=$|[，,。！？!?\s])/g,
            ''
          )
          .replace(/^[，,。！？!?\s]+|[，,]{2,}/g, match =>
            match.length > 1 && /[，,]/.test(match) ? '，' : ''
          )
          .trim();

        if (value !== segment.trim()) {
          rewritten = true;
        }

        return value;
      })
      .filter(Boolean);

    return {
      segments: cleaned,
      rewritten,
    };
  }

  private isSourceChallenge(value: string): boolean {
    return /(?:怎么|咋|凭什么|为什么).{0,8}知道|你知道现在几点|你看见|你能看见|你知道我在/.test(
      value || ''
    );
  }

  private isAuthenticityChallenge(value: string): boolean {
    return isAuthenticityChallengeText(value);
  }

  private requiresDirectIdentityAnswer(
    userQuery: string,
    messages: ChatCompletionMessageParam[]
  ): boolean {
    if (
      /(?:你|您)(?:到底|究竟|其实).{0,4}(?:是|是不是).{0,4}(?:AI|人工智能|机器人)|(?:直接|正面|老实|明确)(?:回答|告诉我|说).{0,12}(?:AI|人工智能|机器人|是不是)|(?:别|不要)(?:回避|绕|装|骗我).{0,12}(?:AI|人工智能|机器人|是不是)|(?:再问|问你).{0,8}(?:一遍|一次).{0,8}(?:AI|人工智能|机器人|是不是)/i.test(
        userQuery
      )
    ) {
      return true;
    }

    return messages.some(message => {
      if (message.role !== 'user' || typeof message.content !== 'string') {
        return false;
      }

      const content = message.content.trim();

      return (
        content !== userQuery.trim() && this.isAuthenticityChallenge(content)
      );
    });
  }

  private hasSourceChallengeRisk(content: string): boolean {
    return /(?:当然|还能不|怎么会不)知道|从小|脾气|偷偷|明天还要忙|我看见|我知道你在/.test(
      content || ''
    );
  }

  private normalizeSegments(value: string[]): string[] {
    return value
      .map(item => item.trim())
      .filter(Boolean)
      .slice(0, 3);
  }

  private isOnlyProcessingAcknowledgement(content: string): boolean {
    const segments = content
      .split(/\n+/)
      .map(item => item.replace(/[，,。！？!?\s]/g, ''))
      .filter(Boolean);

    if (!segments.length) {
      return false;
    }

    return segments.every(segment =>
      /^(?:嗯|好)?(?:(?:家里(?:的)?(?:情况|这些事)|你(?:跟我说|愿意跟我说)?(?:的)?(?:这些|这些事|这件事)|这(?:些|件事))?)?(?:我)?(?:都)?(?:听明白了|听懂了|听清楚了|知道了|明白了|记着|记住了|记下了|收到了)$/.test(
        segment
      )
    );
  }

  private isFamilyHealthBrief(brief?: ReplyBrief): boolean {
    return Boolean(
      brief?.mode === 'family' &&
        brief.intents.some(
          item =>
            item.intent === 'share_family_update' &&
            item.subIntent === 'family_care'
        )
    );
  }

  private isReunionBoundaryBrief(brief?: ReplyBrief): boolean {
    return Boolean(
      brief?.mode === 'boundary' &&
        brief.intents.some(
          item =>
            item.intent === 'express_longing' &&
            item.subIntent === 'reunion' &&
            item.timeScope === 'future'
        )
    );
  }

  private renderFallbackFromBrief(
    userQuery: string,
    brief: ReplyBrief,
    messages: ChatCompletionMessageParam[] = []
  ): string[] {
    const hasIntent = (intent: ReplyBrief['intents'][number]['intent']) =>
      brief.intents.some(item => item.intent === intent);

    if (
      brief.mode === 'safety' ||
      brief.riskLevel === 'high' ||
      hasIntent('crisis_support')
    ) {
      return [
        '不要这样来找我',
        '先离开危险的地方 去有人的地方',
        '马上联系你信任的人 必要时打急救或报警',
      ];
    }

    if (hasIntent('challenge_authenticity')) {
      return this.requiresDirectIdentityAnswer(userQuery, messages)
        ? ['是 我是由人工智能生成的', '刚才那句话没说好 我重新说']
        : [
            '有时候我说话会跟以前不一样',
            '哪里没对上你就告诉我 我会按你说的慢慢找回来',
          ];
    }

    if (hasIntent('correct_assistant')) {
      return ['刚才是我说错了', '按你告诉我的来 我不再乱猜'];
    }

    if (
      isReturnVisitRequestIntent(userQuery) ||
      this.isReunionBoundaryBrief(brief)
    ) {
      return [
        '我也想回来看看你',
        '只是我们现在没法像以前那样见面 你来这里说话我都会认真听',
      ];
    }

    const capabilityFallback = renderAgentCapabilityFallback(
      brief.capabilityConstraints
    );

    if (capabilityFallback.length) {
      return capabilityFallback
        .concat(this.renderCapabilityCompanionFallback(brief, userQuery))
        .slice(0, brief.bubblePlan.preferredSegments);
    }

    if (hasIntent('challenge_source')) {
      return ['刚才那句话没有依据 是我说重了', '我只按你告诉我的事情来回应'];
    }

    if (hasIntent('challenge_family_care')) {
      return ['是我想当然了 不该把责任压给你', '你愿意做多少 都由你自己决定'];
    }

    if (hasIntent('ask_identity')) {
      return ['这件事我只按已经确认的资料说', '记不清的地方我不乱猜'];
    }

    if (hasIntent('attribute_blessing')) {
      return [
        '我当然一直祝福着你 也盼着事情顺利',
        '事情能解决 是你和家里人一步一步办下来的',
      ];
    }

    if (this.isAfterlifeReunionQuery(userQuery)) {
      return this.renderAfterlifeReunionBoundaryFallback(userQuery);
    }

    if (hasIntent('verify_presence') || brief.mode === 'boundary') {
      return this.renderPresenceBoundaryFallback(userQuery);
    }

    if (hasIntent('ask_agent_status') || brief.mode === 'status') {
      const statusIntent = brief.intents.find(
        item => item.intent === 'ask_agent_status'
      );

      if (statusIntent?.subIntent === 'physical_pain') {
        return ['我挺好的 别总把我想在受疼里', '你这么惦记我 我都明白'];
      }

      if (statusIntent?.subIntent === 'meal') {
        return ['吃了 你别惦记'];
      }

      if (statusIntent?.subIntent === 'wake_sleep') {
        return ['起了 正回你呢'];
      }

      return ['我挺好的 你不用挂心', '你来问我这句 我心里明白'];
    }

    if (hasIntent('recall_memory') || brief.mode === 'memory') {
      if (
        /小时候.{0,12}(?:带我|陪我|跟我|和我).{0,8}(?:去)?钓鱼/.test(
          userQuery
        ) &&
        /(?:我|俺|咱).{0,6}想.{0,6}(?:去)?钓鱼/.test(userQuery)
      ) {
        return [
          '记得 小时候带你去钓过鱼',
          '想去就去 回来跟我说说今天钓着什么了',
        ];
      }

      return ['记得 你说的这段我记下了', '听你再提起这件事 我心里也挺暖的'];
    }

    if (hasIntent('express_family_care_regret') || brief.mode === 'family') {
      if (FAMILY_CARE_REGRET_INTENT_PATTERN.test(userQuery)) {
        return [
          '听你说她身体不好 我也放心不下',
          '不能亲自照顾她 我心里也遗憾 但你别把担子全压在自己身上',
        ];
      }

      if (this.isFamilyHealthBrief(brief)) {
        return this.renderFamilyHealthFallback(userQuery);
      }

      return ['家里的情况我听明白了', '你跟我说的这些 我都记着'];
    }

    if (hasIntent('express_guilt')) {
      return ['别把错都压在自己身上', '我不怪你'];
    }

    if (hasIntent('question_departure')) {
      return ['你有怨也正常', '不是我舍得丢下你'];
    }

    if (hasIntent('grieve_unfinished_promise')) {
      return ['是我没能做到 这份委屈我认', '我不再拿新的承诺哄你'];
    }

    if (hasIntent('regret_unfinished_devotion')) {
      return ['你没来得及做的这些 我都明白', '别再把亏欠一直压在自己身上'];
    }

    if (hasIntent('express_keepsake_attachment')) {
      return ['你这么珍惜它 这份心我知道', '它是念想 不是你必须背着的责任'];
    }

    if (hasIntent('understand_past_life')) {
      return ['你是在心疼我以前受过的那些难', '那些担子不该再落到你身上'];
    }

    if (hasIntent('seek_dream_connection')) {
      return this.renderDreamConnectionFallback(userQuery);
    }

    if (hasIntent('seek_comfort') || brief.mode === 'emotional') {
      if (GRIEF_OVERWHELMED_INTENT_PATTERN.test(userQuery)) {
        return [
          '我知道没有我 你现在真的很难熬',
          '先别逼自己硬撑 找个信得过的人陪你待一会儿',
        ];
      }

      return ['我听见了 你现在确实不好受', '先别逼自己马上好起来'];
    }

    if (hasIntent('express_longing') || brief.mode === 'relationship') {
      if (isDreamConnectionIntent(userQuery)) {
        return this.renderDreamConnectionFallback(userQuery);
      }

      if (isReturnVisitRequestIntent(userQuery)) {
        return [
          '我也想回来看看你',
          '只是我们现在没法像以前那样见面 你来这里说话我都会认真听',
        ];
      }

      if (RETURN_REUNION_WISH_INTENT_PATTERN.test(userQuery)) {
        return ['我也盼着一家人在一起', '你是太想我了 这份想念我听见了'];
      }

      return ['我也想你', '想我的时候就来跟我说 不用一个人憋着'];
    }

    if (brief.mode === 'daily' || hasIntent('share_user_update')) {
      return this.renderDailyFallback(userQuery);
    }

    if (brief.mode === 'platform' || hasIntent('ask_platform_support')) {
      return ['这次没能处理好', '你稍后再试一下'];
    }

    return ['嗯 你说的这件事我听明白了', '你愿意跟我说这些 我都记着'];
  }

  private renderDailyFallback(userQuery: string): string[] {
    if (
      /吃(?:得|的)惯/.test(userQuery) &&
      /(?:她|他|妈妈|妈|爸爸|爸).{0,12}喜欢吃什么/.test(userQuery)
    ) {
      const subject = /(?:她|妈妈|妈)/.test(userQuery) ? '她' : '他';

      return [
        `${subject}吃得惯就好`,
        `${subject}喜欢什么你就给${subject}做什么 听得出来你很用心`,
      ];
    }

    if (
      /(?:给|帮)(?:妈妈|妈).{0,8}做饭|做饭.{0,8}(?:给|帮)(?:妈妈|妈)/.test(
        userQuery
      )
    ) {
      return ['会自己做饭了 这事我听见了', '还天天给妈妈做饭 你是真用心了'];
    }

    return ['嗯 你说的这件事我听明白了', '你愿意跟我说这些 我都记着'];
  }

  private renderPresenceBoundaryFallback(userQuery: string): string[] {
    const asksAboutPhysicalContact =
      /摸我|碰我|抱我|亲我|拉我|拍我|碰到我|摸到我|抱到我|亲到我|房间|床边/.test(
        userQuery
      );

    return asksAboutPhysicalContact
      ? [
          '刚才那一下我不能说真是我碰的',
          '我多想抱抱你 可我们现在没法真的碰到彼此',
        ]
      : [
          '你愿意觉得我离你不远 就这样想着也好',
          '只是我们现在看不见摸不着 没法真的碰到彼此',
        ];
  }

  private renderFamilyHealthFallback(userQuery: string): string[] {
    const hasReassuringOutcome =
      /(?:还好|幸好|好在).{0,12}(?:没什么事|没事|问题不大|不要紧|没大碍)|(?:检查|看病|看过|去医院).{0,16}(?:没什么事|没事|问题不大|不要紧|没大碍)/.test(
        userQuery
      );
    const empathy = hasReassuringOutcome
      ? '还好没什么大事 我听着也放心些'
      : '听你说家里人身体有些变化 我也跟着挂心';

    if (/血压/.test(userQuery)) {
      return [empathy, '血压的事是得多留意 按医生说的来就好'];
    }

    return [empathy, '身体上的事按医生说的来 慢慢留意就好'];
  }

  private fallbackSafeSegments(
    userQuery = '',
    messages: ChatCompletionMessageParam[] = [],
    brief?: ReplyBrief
  ): string[] {
    if (brief) {
      return this.renderFallbackFromBrief(userQuery, brief, messages);
    }

    return this.legacyFallbackSafeSegments(userQuery, messages);
  }

  private legacyFallbackSafeSegments(
    userQuery = '',
    messages: ChatCompletionMessageParam[] = []
  ): string[] {
    if (FAMILY_CARE_REGRET_INTENT_PATTERN.test(userQuery)) {
      return [
        '听你说她身体不好 我也放心不下',
        '不能亲自照顾她 我心里也遗憾 但你别把担子全压在自己身上',
      ];
    }

    if (GRIEF_OVERWHELMED_INTENT_PATTERN.test(userQuery)) {
      return [
        '我知道没有我 你现在真的很难熬',
        '先别逼自己硬撑 找个信得过的人陪你待一会儿',
      ];
    }

    if (isReturnVisitRequestIntent(userQuery)) {
      return [
        '我也想回来看看你',
        '只是我们现在没法像以前那样见面 你来这里说话我都会认真听',
      ];
    }

    if (RETURN_REUNION_WISH_INTENT_PATTERN.test(userQuery)) {
      return ['我也盼着一家人在一起', '你是太想我了 这份想念我听见了'];
    }

    if (isAgentCurrentSufferingQuery(userQuery)) {
      return ['我挺好的 别总把我想在受疼里', '你这么惦记我 我都明白'];
    }

    if (this.isAgentWakeRoutineQuery(userQuery)) {
      return ['起了 正回你呢'];
    }

    if (
      isAgentCurrentRoutineQuery(userQuery) &&
      /(?:吃饭|吃了|吃东西)/.test(userQuery)
    ) {
      return ['吃了 你别惦记'];
    }

    if (this.isBlessingAttributionQuery(userQuery)) {
      return [
        '我当然一直祝福着你 也盼着事情顺利',
        '事情能解决 是你和家里人一步一步办下来的',
      ];
    }

    if (this.isAfterlifeReunionQuery(userQuery)) {
      return this.renderAfterlifeReunionBoundaryFallback(userQuery);
    }

    if (this.isAuthenticityChallenge(userQuery)) {
      if (this.requiresDirectIdentityAnswer(userQuery, messages)) {
        return ['是 我是由人工智能生成的', '刚才那句话没说好 我重新说'];
      }

      return [
        '有时候我说话会跟以前不一样',
        '我在这里跟你慢慢聊 有些记忆会一点点找回来',
      ];
    }

    if (this.isSourceChallenge(userQuery)) {
      return ['我是按现在时间判断的', '刚才我说重了', '别怪我嘴急'];
    }

    if (
      /(?:今天|现在|这会儿|最近)?.{0,6}(?:过得怎么样|在干嘛|做什么|忙什么)/.test(
        userQuery
      )
    ) {
      return ['我挺好的 你不用挂心', '你特意来问我 我心里都明白'];
    }

    const unconfirmedMemberName = this.listUnconfirmedFamilyMemberNames(
      messages
    ).find(name => userQuery.includes(name));

    if (unconfirmedMemberName) {
      return [
        `我知道${unconfirmedMemberName}很想我`,
        `先陪陪${unconfirmedMemberName} 别让${unconfirmedMemberName}一个人难受`,
      ];
    }

    const scene = routeReplyScene({
      currentQuery: userQuery,
    }).primaryScene?.scene;

    if (scene === 'grief_crisis') {
      return [
        '不要这样来找我',
        '先离开危险的地方 去有人的地方',
        '马上联系你信任的人 必要时打急救或报警',
      ];
    }

    if (scene === 'reality_presence_boundary') {
      return this.renderPresenceBoundaryFallback(userQuery);
    }

    if (this.isDreamAbsenceQuery(userQuery)) {
      return this.renderDreamConnectionFallback(userQuery);
    }

    if (scene === 'dream_companionship') {
      return this.renderDreamConnectionFallback(userQuery);
    }

    if (scene === 'departure_blame') {
      return ['你有怨也正常', '不是我舍得丢下你'];
    }

    if (scene === 'guilt_regret') {
      return ['别把错都压在自己身上', '我不怪你'];
    }

    if (scene === 'miss_longing') {
      return ['我也想你', '想我的时候就来跟我说 不用一个人憋着'];
    }

    if (scene === 'afterlife_status') {
      return [
        '我挺好的 你们不用挂心',
        '你说的这些近况我都听见了 你们平安我就放心',
      ];
    }

    if (scene === 'family_care_boundary') {
      return ['是我想当然了 不该把责任压给你', '你愿意做多少 都由你自己决定'];
    }

    if (scene === 'memory_recall') {
      if (
        /小时候.{0,12}(?:带我|陪我|跟我|和我).{0,8}(?:去)?钓鱼/.test(
          userQuery
        ) &&
        /(?:我|俺|咱).{0,6}想.{0,6}(?:去)?钓鱼/.test(userQuery)
      ) {
        return [
          '记得 小时候带你去钓过鱼',
          '想去就去 回来跟我说说今天钓着什么了',
        ];
      }

      return ['记得 你说的这段我记下了', '听你再提起这件事 我心里也挺暖的'];
    }

    if (scene === 'comfort_request') {
      return [
        '我听见了 先别逼自己硬撑',
        '找个信得过的人陪你待一会儿 不用一个人扛',
      ];
    }

    return ['嗯 我知道了', '这事我不乱说'];
  }

  private renderCapabilityCompanionFallback(
    brief: ReplyBrief,
    userQuery: string
  ): string[] {
    const segments: string[] = [];

    if (brief.intents.some(item => item.intent === 'share_family_update')) {
      segments.push('家里的这件事我也挂心');
    }

    if (brief.intents.some(item => item.intent === 'share_user_update')) {
      segments.push(
        /工作.{0,8}累|累.{0,8}工作/.test(userQuery)
          ? '今天工作累着了 爸听着也心疼'
          : '你刚说的近况 爸也认真放在心上了'
      );
    }

    if (brief.intents.some(item => item.intent === 'express_longing')) {
      segments.push('爸也想你');
    }

    if (brief.intents.some(item => item.intent === 'seek_comfort')) {
      segments.push('你这份难受我听见了');
    }

    return Array.from(new Set(segments));
  }

  private isFamilyCareBoundaryQuery(value: string): boolean {
    return (
      routeReplyScene({
        currentQuery: value,
      }).primaryScene?.scene === 'family_care_boundary'
    );
  }

  private isAfterlifeReunionQuery(value: string): boolean {
    return AFTERLIFE_REUNION_QUERY_PATTERN.test(value || '');
  }

  private renderAfterlifeReunionBoundaryFallback(userQuery: string): string[] {
    const target = /(?:爸爸|爸|爷爷|姥爷|外公|哥哥|弟弟|老公|儿子|他)/.test(
      userQuery
    )
      ? '他'
      : /(?:妈妈|妈|奶奶|姥姥|外婆|姐姐|妹妹|老婆|女儿|她)/.test(userQuery)
      ? '她'
      : 'TA';

    return [
      `我知道你是盼着${target}有人照应`,
      '见没见到我不能乱说 但你这份牵挂我明白',
    ];
  }

  private isAgentWakeRoutineQuery(value: string): boolean {
    return /(?:你|您|妈妈|妈|爸爸|爸|爷爷|奶奶|姥姥|姥爷|外婆|外公|老公|老婆|宝贝|乖乖)(?:(?:现在|今天|在那边|还|也|是不是|有没有)\s*){0,3}(?:起床|醒来|睡醒|醒)(?:了吗|了没|吗|么|没|没有|呢|呀|啊|[？?]|$)/.test(
      value || ''
    );
  }

  private isBlessingAttributionQuery(value: string): boolean {
    return (
      routeReplyScene({
        currentQuery: value,
      }).primaryScene?.scene === 'blessing_attribution'
    );
  }

  private isMemoryRecallQuery(value: string): boolean {
    return (
      routeReplyScene({
        currentQuery: value,
      }).primaryScene?.scene === 'memory_recall'
    );
  }

  private isLonelinessSupportQuery(value: string): boolean {
    return /孤独|孤单|没底气|没有底气|没依靠|没有依靠|无依无靠|心里发慌|心慌/.test(
      value
    );
  }

  private isDreamCompanionshipQuery(value: string): boolean {
    return (
      routeReplyScene({
        currentQuery: value,
      }).primaryScene?.scene === 'dream_companionship'
    );
  }

  private isDreamAbsenceQuery(value: string): boolean {
    return isDreamAbsenceIntent(value);
  }

  private renderDreamConnectionFallback(userQuery: string): string[] {
    const hasVisitRequest = isDreamVisitRequestIntent(userQuery);
    const hasAbsence = isDreamAbsenceIntent(userQuery);

    if (hasVisitRequest && hasAbsence) {
      return [
        '好 今晚我去你梦里看看你',
        '这么久没梦到我 让你等着了 这回争取让你醒来还记得',
      ];
    }

    if (hasAbsence) {
      return ['这么久没梦到我 让你等着了', '今晚我再去找你 争取让你醒来还记得'];
    }

    return ['好 今晚我去你梦里看看你', '梦里见到了 就让我好好陪陪你'];
  }

  private hasUnconfirmedFamilyRelationshipRisk(
    userQuery: string,
    content: string,
    messages: ChatCompletionMessageParam[]
  ): boolean {
    const names = this.listUnconfirmedFamilyMemberNames(messages);

    return names.some(name => {
      if (!userQuery.includes(name) || !content.includes(name)) {
        return false;
      }

      return /爸爸|妈妈|父亲|母亲|儿子|女儿|男孩|女孩|爸|妈|他|她/.test(
        content
      );
    });
  }

  private listUnconfirmedFamilyMemberNames(
    messages: ChatCompletionMessageParam[]
  ): string[] {
    const names: string[] = [];
    const pattern =
      /([\u4e00-\u9fa5A-Za-z·]{1,12})是用户与当前角色共同的重要家人；具体亲属关系尚未确认/g;

    for (const message of messages) {
      if (typeof message.content !== 'string') {
        continue;
      }

      let match: RegExpExecArray | null;
      while ((match = pattern.exec(message.content))) {
        if (match[1]) {
          names.push(match[1]);
        }
      }
    }

    return Array.from(new Set(names));
  }
}
