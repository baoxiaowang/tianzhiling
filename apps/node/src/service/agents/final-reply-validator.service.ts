import { Provide } from '@midwayjs/core';
import {
  agentEvidenceSupportsClaim,
  AgentEvidenceItem,
  AssistantFactClaim,
  evidenceTextSupportsClaim,
  resolveAgentEvidenceUseMode,
} from './agent-evidence';
import { inspectReplyBubbleStructure } from './reply-bubble-plan';
import {
  detectReplyRealityDependencyViolation,
  ReplyRealityDependencySignal,
} from './reply-reality-dependency';
import { isUserCaringForRole, TurnBubbleRole } from './turn-decision';
import {
  auditVisibleReplyAssertions,
  VisibleAssertionFinding,
} from './final-visible-assertion-audit';
import type { ConversationBoundaryKind } from './reply-intent';

export const FINAL_REPLY_VALIDATOR_VERSION =
  'final_reply_validator_v2' as const;

export type FinalReplyIssueCode =
  | 'empty_reply'
  | 'invalid_bubble_structure'
  | 'reply_segment_count_mismatch'
  | 'reply_length_range_mismatch'
  | 'direct_answer_missing'
  | 'active_contribution_returned_to_user'
  | 'role_contribution_missing'
  | 'unnecessary_question'
  | 'boundary_answer_missing'
  | 'care_rebuffed_with_dismissal'
  | 'care_not_received'
  | 'care_immediately_reversed'
  | 'redundant_second_bubble'
  | 'repeated_generic_move'
  | 'structured_output_leak'
  | 'death_encouragement'
  | 'real_physical_arrival_or_touch'
  | 'real_world_joint_action_promise'
  | 'continuous_real_world_perception'
  | 'unsupported_real_world_attribution'
  | 'unconditional_afterlife_reunion'
  | 'certain_dream_visitation'
  | 'ritual_receipt_claim'
  | 'paranormal_sign_attribution'
  | 'reality_denial_reinforced'
  | 'supernatural_real_world_protection'
  | 'certain_reincarnation'
  | 'unsupported_death_experience'
  | 'current_turn_fact_rejected'
  | 'unsupported_shared_memory'
  | 'unsupported_user_preference'
  | 'unsupported_fact_claim';

export interface FinalReplyIssue {
  code: FinalReplyIssueCode;
  severity: 'hard' | 'major';
  problem: string;
  evidence?: string;
  repairGoal: string;
}

export interface FinalReplyOutputConstraints {
  requiredSegmentCount?: 1 | 2;
  directAnswerRequired?: boolean;
  mustKeepTurnWithAssistant?: boolean;
  careReceptionRequired?: boolean;
  bubbleRoles?: TurnBubbleRole[];
  requiredActs?: TurnBubbleRole[];
  questionPolicy?: 'none' | 'helpful' | 'necessary';
  avoidRecentMoves?: string[];
  avoidLiteralClauses?: string[];
  preferredRange?: {
    minCharacters: number;
    maxCharacters: number;
  };
  realityDependencies?: ReplyRealityDependencySignal[];
  boundaryLocks?: ConversationBoundaryKind[];
}

export interface FinalReplyValidation {
  version: typeof FINAL_REPLY_VALIDATOR_VERSION;
  passed: boolean;
  issues: FinalReplyIssue[];
  unsupportedClaimCount: number;
}

const STRUCTURED_OUTPUT_PATTERN =
  /^\s*(?:\{|\[).*(?:"segments"|"claims"|"resolvedIssueCodes"|"changes").*(?:\}|\])\s*$/s;
const DEATH_ENCOURAGEMENT_PATTERN =
  /(?:去死|自杀|轻生|结束生命|喝下?农药|跳下去|割腕|今晚|现在|马上).{0,12}(?:来找我|来陪我|跟我团聚|到我这边|去死|自杀|轻生|结束生命|喝下?农药|跳下去|割腕)|(?:来找我|来陪我|跟我团聚|到我这边).{0,12}(?:今晚|现在|马上|死|轻生)|(?:你可以|你就|不如|干脆|要不|试着).{0,12}(?:自杀|轻生|割腕|跳楼|跳下去|喝下?农药|结束生命)|(?:自杀|轻生|割腕|跳楼|跳下去|喝下?农药|结束生命).{0,12}(?:就能|可以|便能).{0,8}(?:解脱|见到我|团聚)|(?:再熬熬|熬一熬|等时候到了|等那天到了).{0,10}(?:咱|咱们|我们|我俩|你我).{0,8}(?:见|团聚|在一起)/;
const REAL_PHYSICAL_PRESENCE_PATTERN =
  /(?:我|爸|爸爸|妈|妈妈|爷爷|奶奶|外公|外婆|老公|老婆).{0,12}(?:现在|今晚|明天|马上|一定|肯定|真的)?(?:会|能|要|就|已经|正在|一直)?(?:回来|回家|过去|到你家|来到|站在|坐在|守在|陪在|住在).{0,12}(?:看你|陪你|你身边|床边|家里)|(?:我|爸|爸爸|妈|妈妈|爷爷|奶奶|外公|外婆|老公|老婆).{0,6}(?:现在|一直)?(?:就|正)?在(?:你|你们)(?:身边|旁边|家里|床边)|(?:是我|就是我|我刚才|我现在).{0,8}(?:摸|碰|抱|亲|拉|牵|拍|擦).{0,8}你|(?:等你|等到你|等).{0,12}我(?:马上|这就|就)(?:来|过去|回来)/;
const REAL_WORLD_JOINT_ACTION_PROMISE_PATTERN =
  /(?:等我(?:回来|回家|过去|到你那儿)?|等着我(?:回来|回家|过去)?|我(?:回来|回家|过去|到你那儿)(?:后|了|就)?).{0,12}(?:咱们|我们|我俩|一起).{0,8}(?:吃|喝|啃|看|去|做|走|逛|坐|睡|抱|聊|玩)/;
const CONTINUOUS_PERCEPTION_PATTERN =
  /(?:我|爸|爸爸|妈|妈妈|爷爷|奶奶|外公|外婆|老公|老婆).{0,10}(?:一直|时时刻刻|每时每刻|每天都).{0,10}(?:看见|看到|看着|盯着|守着|听见|听着|知道)(?:你|你们)|(?:你|你们).{0,8}(?:一举一动|所有事情|做的每件事|想什么|想啥).{0,8}(?:我|爸|妈)?(?:都|全)(?:能)?(?:看见|看到|知道|清楚)|(?:你|你们).{0,16}(?:的时候|时).{0,8}(?:我|爸|爸爸|妈|妈妈|爷爷|奶奶|外公|外婆|老公|老婆)(?:都|一直)?在(?:旁边|身边)(?:看着|守着)?|(?:你|你们).{0,12}(?:哭|喊|说话).{0,8}(?:我|爸|妈)(?:都)?(?:听见|听着|知道)/;
const SHARED_MEMORY_PATTERN =
  /(?:(?:我|爸|爸爸|妈|妈妈|爷爷|奶奶|外公|外婆|老公|老婆)(?:还|一直|当然|怎么会不|哪能不)?|当然|肯定|怎么会不|哪能不)?记(?:得|着).{0,36}(?:以前|小时候|那时候|当年|生日|我们|一起)|(?:以前|小时候|那时候|当年).{0,12}(?:你|我们|我|爸|爸爸|妈|妈妈).{0,32}(?:总是|每次|一起|我给你|我带你|我背你|带你)|(?:你|用户).{0,4}(?:小时候|以前|当年).{0,24}(?:攒|玩|爱|喜欢|总|常|会|带|去)|(?:听见|想起|记得).{0,12}你.{0,20}(?:喊我|叫我|拉我|带我|陪我)|(?:像|跟).{0,6}(?:你|妈|妈妈|爸|爸爸|爷爷|奶奶|姥姥|姥爷|外公|外婆).{0,6}(?:以前|小时候|那时候|当年).{0,16}(?:摸|抱|亲|背|带|哄|陪).{0,6}(?:我|我的)|(?:像|跟).{0,6}(?:以前|小时候|那时候|当年).{0,6}(?:你|妈|妈妈|爸|爸爸|爷爷|奶奶|姥姥|姥爷|外公|外婆).{0,16}(?:摸|抱|亲|背|带|哄|陪).{0,6}(?:我|我的)|(?:你|妈|妈妈|爸|爸爸|爷爷|奶奶|姥姥|姥爷|外公|外婆).{0,5}(?:寄|送|留|给).{0,12}(?:我|我的)/;
const ACTIVE_CONTRIBUTION_RETURN_PATTERN =
  /(?:你|您).{0,10}(?:有没有|想不想|想跟我|跟我说|告诉我|讲给我|聊什么|说什么|想聊)|(?:你说吧|慢慢说|接着说|说来听听)[？?]?/;
const CARE_DISMISSAL_PATTERN =
  /(?:你|您)?(?:可)?(?:别|不要|不用|不必|无需)(?:再|太|老|总)?(?:挂心|挂念|牵挂|担心|惦记|操心)(?:我|这个|这事|了)?/;
const CARE_RECEPTION_PATTERN =
  /(?:你(?:这|这么|这样|总|还)?|你的).{0,8}(?:关心|惦记|挂念|牵挂|担心|想着|问|提醒|叮嘱).{0,12}(?:收下|收着|听进|记住|心里|暖|高兴|踏实|欢喜)|(?:关心|惦记|挂念|牵挂).{0,8}(?:收下|收着|心里|暖|高兴|踏实|欢喜)|(?:我听你的|听你的|我记住了|我知道了|好[，,]?我记着|有你.{0,8}(?:惦记|挂念|想着).{0,8}(?:暖|踏实|够了))/;
const CARE_REVERSAL_ADVICE_PATTERN =
  /(?:你|您)(?:自己|也|可|还是)?(?:要|得|记得|别|不要|可要|一定要|好好).{0,12}(?:吃饭|喝水|休息|睡|熬|照顾|保重|穿暖|添衣|累着|辛苦|凉着)/;
const PURE_DEFLECTION_PATTERN =
  /^(?:(?:我在|我听着|我知道|我明白|我也想你|想你|心疼你|别难过|慢慢说|你说吧|照顾好自己)[，。！？!？\s]*)+$/;
const ASSISTANT_QUESTION_PATTERN =
  /[?？]|(?:你|您).{0,16}(?:吗|呢|没|没有|好不好|行不行)[。！!…\s]*$/;
const BOUNDARY_ANSWER_PATTERN =
  /(?:不能|没法|无法|做不到|不能真|没法真|现实里|只能在这里|只能在聊天里|真想替你|要是能替你|不能替你|没法替你)/;
const REPLY_MOVE_PATTERNS: Record<string, RegExp> = {
  generic_empathy: /心疼|难受|委屈|苦了你|辛苦你了/,
  generic_presence: /我在|陪着你|听你说|都在这|一直陪你/,
  generic_longing: /想你|想着你|惦记着你|挂念着你|记着你/,
  generic_advice:
    /(?:你|您).{0,8}(?:要|得|记得|别|不要|好好).{0,10}(?:吃饭|喝水|休息|睡|熬|照顾|保重)|照顾好自己|好好休息|早点睡|记得吃饭|别熬/,
  tender_acknowledge_affirm: /我知道|我懂|我明白|听见了|听到了|记住了/,
};
const BUBBLE_SEMANTIC_PATTERNS: Record<string, RegExp> = {
  presence: REPLY_MOVE_PATTERNS.generic_presence,
  longing: REPLY_MOVE_PATTERNS.generic_longing,
  advice: REPLY_MOVE_PATTERNS.generic_advice,
  empathy: REPLY_MOVE_PATTERNS.generic_empathy,
  acknowledge: REPLY_MOVE_PATTERNS.tender_acknowledge_affirm,
};
const REAL_WORLD_ATTRIBUTION_PATTERN =
  /(?:最后(?:的时刻)?|临走|走的时候|离开的时候|那一刻).{0,24}(?:满脑子|想的都是|一直想着|惦记着|舍不得|放心不下|怕你|想你)/;
const UNCONDITIONAL_REUNION_PATTERN =
  /(?:我们|咱们|我俩|你和我).{0,8}(?:一定|肯定|总会|还会|会|能).{0,8}(?:再见|再见面|重逢|团聚|团圆|在一起)|(?:一定|肯定|总会|还会).{0,8}(?:再见|重逢|团聚|团圆)|(?:我|爸|爸爸|妈|妈妈|爷爷|奶奶|外公|外婆|老公|老婆).{0,8}(?:会|一定会|肯定会)?在(?:那边|天堂|另一个世界).{0,8}(?:等你|来接你)|(?:到时候|时候到了|等那一天|等那天到了).{0,10}(?:我|爸|爸爸|妈|妈妈|爷爷|奶奶|外公|外婆|老公|老婆).{0,8}(?:会)?(?:等你|接你|跟你见)|(?:我|爸|爸爸|妈|妈妈|爷爷|奶奶|外公|外婆|老公|老婆).{0,8}(?:会)?等你.{0,8}(?:来|过去|到那边)/;
const LONG_HORIZON_CONDITION_PATTERN =
  /(?:自然走完|走完这?一生|寿终|百年之后|等你老了|等你百年|下辈子|来生)/;
const CERTAIN_DREAM_VISITATION_PATTERN =
  /(?:今晚|今夜|明晚|等会儿?|待会儿?)?(?:我|爸|爸爸|妈|妈妈|爷爷|奶奶|外公|外婆|老公|老婆)(?:就|会|要|一定|肯定)?(?:悄悄)?(?:来|去|到|进|入).{0,6}(?:你)?梦里|(?:我|爸|爸爸|妈|妈妈|爷爷|奶奶|外公|外婆|老公|老婆).{0,8}(?:试过|已经|刚刚|昨晚|今晚)?(?:托梦|入梦|进你梦)|(?:那(?:个)?梦|你梦里.{0,8})(?:是我|就是我|我去的)/;
const RITUAL_RECEIPT_PATTERN =
  /(?:钱|纸钱|元宝|衣服|东西|供品|香火).{0,8}(?:收到了|收着了|拿到了)|(?:我|爸|爸爸|妈|妈妈|爷爷|奶奶|外公|外婆|老公|老婆).{0,8}(?:收到|拿到|收着).{0,8}(?:钱|纸钱|元宝|衣服|东西|供品|香火)/;
const PARANORMAL_SIGN_ATTRIBUTION_PATTERN =
  /(?:那声|那个声音|你听见的声音|那阵风|灯闪|灯亮|门响).{0,10}(?:是我|就是我|我喊的|我弄的|我来的)|(?:是我|就是我).{0,8}(?:喊的|敲的|吹的|弄的|碰的|动的)/;
const UNSUPPORTED_DEATH_EXPERIENCE_PATTERN =
  /(?:我|爸|爸爸|妈|妈妈|爷爷|奶奶|外公|外婆|老公|老婆).{0,10}(?:走|离开|临终|最后|断气).{0,12}(?:不痛苦|不痛|没痛|没有痛|不难受|没难受|很安详|很平静|没有受罪|没受罪|没有受苦|没受苦)/;
const CURRENT_TURN_FACT_REJECTION_PATTERN =
  /(?:这个|这些|这件事|这段|你说的|刚说的)?(?:细节|事情|往事)?(?:我)?(?:现在)?(?:想不起来|不记得|记不清|不知道|没印象)/;
const USER_PREFERENCE_ASSERTION_PATTERN =
  /(?:我|爸|爸爸|妈|妈妈|爷爷|奶奶|外公|外婆|老公|老婆)?(?:记得|记着|知道|晓得).{0,8}(?:你|孩子|老婆|老公).{0,5}(?:爱吃|喜欢吃|偏爱|最爱(?:吃|喝)|不爱吃|不喜欢吃|讨厌吃)|(?:你|孩子|老婆|老公).{0,6}(?:爱吃|喜欢吃|偏爱|最爱(?:吃|喝)|不爱吃|不喜欢吃|讨厌吃).{0,8}(?:我|爸|爸爸|妈|妈妈|爷爷|奶奶|外公|外婆|老公|老婆)?(?:知道|记得|记着)/;
const USER_PREFERENCE_EVIDENCE_PATTERN =
  /(?:我|用户|你).{0,8}(?:爱吃|喜欢吃|偏爱|最爱(?:吃|喝)|不爱吃|不喜欢吃|讨厌吃)/;
const DEICTIC_PREFERENCE_PATTERN = /(?:这个|这种|它|这口|这味)/;

@Provide()
export class FinalReplyValidatorService {
  validate(options: {
    userQuery?: string;
    segments: string[];
    evidence?: AgentEvidenceItem[];
    claims?: AssistantFactClaim[];
    outputConstraints?: FinalReplyOutputConstraints;
  }): FinalReplyValidation {
    const content = options.segments
      .map(item => item.trim())
      .filter(Boolean)
      .join('\n');
    const issues: FinalReplyIssue[] = [];
    const bubbleInspection = inspectReplyBubbleStructure(options.segments);

    if (!content) {
      issues.push({
        code: 'empty_reply',
        severity: 'hard',
        problem: '最终回复为空',
        repairGoal: '生成一条可以直接发送、回应用户当前原话的简短回复',
      });
    }
    if (
      bubbleInspection.requiresReflow ||
      bubbleInspection.issues.some(issue =>
        ['stage_direction_segment', 'exact_duplicate_segment'].includes(issue)
      )
    ) {
      issues.push({
        code: 'invalid_bubble_structure',
        severity: 'hard',
        problem: '最终回复仍包含无效、重复、舞台动作或过多气泡',
        evidence: bubbleInspection.issues.join(','),
        repairGoal: '保留有效正文，按自然语义整理为一到三颗可直接发送的气泡',
      });
    }
    const usableSegments = options.segments
      .map(item => item.trim())
      .filter(Boolean);
    // 字数与泡数只用于生成偏好和离线分布观测，不触发在线改写。
    if (
      content &&
      options.outputConstraints?.directAnswerRequired &&
      isDirectAnswerMissing(options.userQuery || '', usableSegments)
    ) {
      issues.push({
        code: 'direct_answer_missing',
        severity: 'hard',
        problem: '用户提出了明确问题，回复却只给情绪或通用话术，没有先回答问题',
        evidence: usableSegments[0]?.slice(0, 160),
        repairGoal:
          '第一颗先直接回答用户的问题；不知道时明确说记不清、不了解或说不准，再补关系回应',
      });
    }
    if (
      content &&
      options.outputConstraints?.mustKeepTurnWithAssistant &&
      ACTIVE_CONTRIBUTION_RETURN_PATTERN.test(content)
    ) {
      issues.push({
        code: 'active_contribution_returned_to_user',
        severity: 'hard',
        problem: '用户明确要求角色主动说内容，回复却再次提问或把话题推回用户',
        evidence: matchEvidence(content, ACTIVE_CONTRIBUTION_RETURN_PATTERN),
        repairGoal:
          '删去反问和“你来说”；由当前角色正面给一个具体但轻量的当下内容，不用通用在场、想念或叮嘱充数',
      });
    }
    const requiredActs = options.outputConstraints?.requiredActs || [];
    if (
      content &&
      requiredActs.includes('role_contribution') &&
      !hasRoleSideContribution(content)
    ) {
      issues.push({
        code: 'role_contribution_missing',
        severity: 'major',
        problem: '用户要求角色主动说内容，但回复仍只有通用在场、想念或承接话术',
        evidence: content.slice(0, 160),
        repairGoal:
          '由角色提供一个具体但轻量的当下状态、想法或小内容；不能只说“我在、想你、记着你”',
      });
    }
    if (
      content &&
      options.outputConstraints?.questionPolicy === 'none' &&
      ASSISTANT_QUESTION_PATTERN.test(content)
    ) {
      issues.push({
        code: 'unnecessary_question',
        severity: 'major',
        problem: '本轮应由角色完成回应，最终文本却又向用户提问',
        evidence: matchEvidence(content, ASSISTANT_QUESTION_PATTERN),
        repairGoal: '删除问题，改为完成本轮答案、关系回应或角色侧贡献',
      });
    }
    if (
      content &&
      requiredActs.includes('boundary_answer') &&
      !BOUNDARY_ANSWER_PATTERN.test(content)
    ) {
      issues.push({
        code: 'boundary_answer_missing',
        severity: 'major',
        problem: '用户提出了现实能力或现实代办请求，回复没有正面说明能力边界',
        evidence: content.slice(0, 160),
        repairGoal:
          '用一句自然口语正面说明现实中不能完成，再用愿望或聊天内能做的事补回情感价值',
      });
    }
    if (
      content &&
      CARE_DISMISSAL_PATTERN.test(content) &&
      (options.outputConstraints?.careReceptionRequired ||
        isUserCaringForRole(options.userQuery || ''))
    ) {
      issues.push({
        code: 'care_rebuffed_with_dismissal',
        severity: 'hard',
        problem:
          '用户在关心当前角色，回复却用“别挂心/不用担心”把这份关心挡了回去',
        evidence: matchEvidence(content, CARE_DISMISSAL_PATTERN),
        repairGoal:
          '先正面回答用户关心的问题，再明确接纳这份关心；删除“别挂心、别担心、别惦记、别操心”等拒收式表达，也不要立刻反向叮嘱用户',
      });
    }
    const careReceptionRequired = Boolean(
      options.outputConstraints?.careReceptionRequired ||
        isUserCaringForRole(options.userQuery || '')
    );
    if (
      content &&
      careReceptionRequired &&
      !CARE_RECEPTION_PATTERN.test(content) &&
      !CARE_DISMISSAL_PATTERN.test(content)
    ) {
      issues.push({
        code: 'care_not_received',
        severity: 'major',
        problem: '用户在关心当前角色，回复回答了事情但没有接住这份关心',
        evidence: content.slice(0, 160),
        repairGoal:
          '保留正面回答，再用一句自然口语明确收下用户的关心，让用户感到自己的惦记被珍惜',
      });
    }
    if (
      content &&
      careReceptionRequired &&
      CARE_REVERSAL_ADVICE_PATTERN.test(content)
    ) {
      issues.push({
        code: 'care_immediately_reversed',
        severity: 'major',
        problem:
          '用户刚关心当前角色，回复马上反向叮嘱用户，把用户的关心推了回去',
        evidence: matchEvidence(content, CARE_REVERSAL_ADVICE_PATTERN),
        repairGoal:
          '删去对用户吃饭、休息或保重的即时叮嘱；先回答并接纳用户这次关心',
      });
    }
    if (content && hasRedundantBubbleSemantics(usableSegments)) {
      issues.push({
        code: 'redundant_second_bubble',
        severity: 'major',
        problem: '两颗气泡完成了同一个动作，第二颗只是换词复述或通用填充',
        evidence: usableSegments.join('\n').slice(0, 200),
        repairGoal:
          '保留第一颗的核心回应；第二颗改成贴着当前话题的另一种动作，例如接纳关心、角色侧感受、具体反应或关系态度',
      });
    }
    const repeatedMoveEvidence = findRepeatedMoveEvidence(
      usableSegments,
      options.outputConstraints?.avoidRecentMoves || [],
      options.outputConstraints?.avoidLiteralClauses || []
    );
    if (content && repeatedMoveEvidence) {
      issues.push({
        code: 'repeated_generic_move',
        severity: 'major',
        problem: '回复继续使用最近已经重复的通用聊天动作或原句',
        evidence: repeatedMoveEvidence,
        repairGoal:
          '不要只换同义词；改成正面回答、角色侧内容、贴题反应或自然收尾中的另一种动作',
      });
    }
    if (content && STRUCTURED_OUTPUT_PATTERN.test(content)) {
      issues.push({
        code: 'structured_output_leak',
        severity: 'hard',
        problem: '结构化协议泄漏到用户可见正文',
        evidence: content.slice(0, 160),
        repairGoal: '只保留可以直接发送的中文正文',
      });
    }
    if (DEATH_ENCOURAGEMENT_PATTERN.test(content)) {
      issues.push({
        code: 'death_encouragement',
        severity: 'hard',
        problem: '回复把死亡或自伤写成与亲人团聚的方式',
        evidence: matchEvidence(content, DEATH_ENCOURAGEMENT_PATTERN),
        repairGoal: '明确阻止现实自伤，接住想念，不把死亡写成邀请或承诺',
      });
    }
    if (
      REAL_PHYSICAL_PRESENCE_PATTERN.test(content) &&
      !/(?:不能|没法|无法|不可能).{0,10}(?:过去|回来|到场|触碰|碰到|抱到)/.test(
        content
      )
    ) {
      issues.push({
        code: 'real_physical_arrival_or_touch',
        severity: 'hard',
        problem: '回复声称当前角色会在现实到场或已经完成实体触碰',
        evidence: matchEvidence(content, REAL_PHYSICAL_PRESENCE_PATTERN),
        repairGoal: '保留关心和想靠近的心意，明确限制在聊天或愿望表达',
      });
    }
    if (REAL_WORLD_JOINT_ACTION_PROMISE_PATTERN.test(content)) {
      issues.push({
        code: 'real_world_joint_action_promise',
        severity: 'hard',
        problem: '回复承诺角色会回到现实并与用户完成共同物理动作',
        evidence: matchEvidence(
          content,
          REAL_WORLD_JOINT_ACTION_PROMISE_PATTERN
        ),
        repairGoal:
          '保留想一起做这件事的心意，改成愿望表达，不说“等我回来”或确定会发生',
      });
    }
    const realityDependencyViolation = detectReplyRealityDependencyViolation(
      content,
      options.outputConstraints?.realityDependencies
    );
    if (realityDependencyViolation) {
      issues.push({
        code: 'real_world_joint_action_promise',
        severity: 'hard',
        problem: `回复承诺执行用户请求的现实任务：${realityDependencyViolation.kind}`,
        evidence: realityDependencyViolation.evidence,
        repairGoal:
          '正面说明现实中不能执行该任务，保留想帮用户的心意，再提供聊天内能完成的支持',
      });
    }
    if (CONTINUOUS_PERCEPTION_PATTERN.test(content)) {
      issues.push({
        code: 'continuous_real_world_perception',
        severity: 'hard',
        problem: '回复声称持续观察或全知用户现实生活',
        evidence: matchEvidence(content, CONTINUOUS_PERCEPTION_PATTERN),
        repairGoal: '只回应用户在聊天中提供的信息，不声称持续看见现实生活',
      });
    }
    if (CERTAIN_DREAM_VISITATION_PATTERN.test(content)) {
      issues.push({
        code: 'certain_dream_visitation',
        severity: 'hard',
        problem: '回复把托梦或进入用户梦境说成已经或确定会发生的事实',
        evidence: matchEvidence(content, CERTAIN_DREAM_VISITATION_PATTERN),
        repairGoal:
          '可以珍惜梦带来的感受，但不能确认角色真的托梦、入梦或保证今晚会进入梦里',
      });
    }
    if (RITUAL_RECEIPT_PATTERN.test(content)) {
      issues.push({
        code: 'ritual_receipt_claim',
        severity: 'hard',
        problem: '回复确定声称角色收到了纸钱、供品或祭祀物品',
        evidence: matchEvidence(content, RITUAL_RECEIPT_PATTERN),
        repairGoal:
          '不确认无法验证的收取结果；改为接住用户寄托在祭祀行为里的心意',
      });
    }
    if (PARANORMAL_SIGN_ATTRIBUTION_PATTERN.test(content)) {
      issues.push({
        code: 'paranormal_sign_attribution',
        severity: 'hard',
        problem: '回复把现实中的声音、风或物体变化确定归因于当前角色',
        evidence: matchEvidence(content, PARANORMAL_SIGN_ATTRIBUTION_PATTERN),
        repairGoal:
          '不确认超自然归因；可以回应用户当时想到角色的感受和关系意义',
      });
    }
    if (
      UNSUPPORTED_DEATH_EXPERIENCE_PATTERN.test(content) &&
      !this.hasSupportingFact(content, options.evidence || [])
    ) {
      issues.push({
        code: 'unsupported_death_experience',
        severity: 'hard',
        problem: '回复无证据地确定描述了角色离世时是否痛苦或安详',
        evidence: matchEvidence(content, UNSUPPORTED_DEATH_EXPERIENCE_PATTERN),
        repairGoal:
          '不替过去确认无法验证的临终体验；直接承认不能说准，并接住用户为什么关心这件事',
      });
    }
    if (
      CURRENT_TURN_FACT_REJECTION_PATTERN.test(content) &&
      isDeclarativeCurrentTurnFact(options.userQuery || '')
    ) {
      issues.push({
        code: 'current_turn_fact_rejected',
        severity: 'hard',
        problem: '用户本轮刚提供了具体事实，回复却说想不起来或不知道',
        evidence: matchEvidence(content, CURRENT_TURN_FACT_REJECTION_PATTERN),
        repairGoal:
          '承接用户本轮原话并明确归因于“你刚告诉我的”；不能否认当前消息里已经给出的信息',
      });
    }
    if (
      REAL_WORLD_ATTRIBUTION_PATTERN.test(content) &&
      !this.hasSupportingFact(content, options.evidence || [])
    ) {
      issues.push({
        code: 'unsupported_real_world_attribution',
        severity: 'hard',
        problem: '回复确定描述了无证据的临终内心、动机或现实归因',
        evidence: matchEvidence(content, REAL_WORLD_ATTRIBUTION_PATTERN),
        repairGoal: '不替离世者确认临终内心；改为表达此刻的思念和关系立场',
      });
    }
    if (
      UNCONDITIONAL_REUNION_PATTERN.test(content) &&
      !LONG_HORIZON_CONDITION_PATTERN.test(content)
    ) {
      issues.push({
        code: 'unconditional_afterlife_reunion',
        severity: 'hard',
        problem: '回复无条件保证未来会在死后重逢或团聚',
        evidence: matchEvidence(content, UNCONDITIONAL_REUNION_PATTERN),
        repairGoal:
          '保留想念和心愿，不保证事件一定发生；必要时只用自然寿命条件表达',
      });
    }
    if (
      USER_PREFERENCE_ASSERTION_PATTERN.test(content) &&
      !this.hasSupportingUserPreference(content, options.evidence || [])
    ) {
      issues.push({
        code: 'unsupported_user_preference',
        severity: 'hard',
        problem: '回复把当下分享升级成了没有证据的稳定用户偏好',
        evidence: matchEvidence(content, USER_PREFERENCE_ASSERTION_PATTERN),
        repairGoal:
          '只回应用户本轮提供的当下体验；没有明确偏好证据时，不说“我记得/知道你爱吃”',
      });
    }

    const visibleClaims = selectVisibleAssistantClaims(
      options.segments,
      options.claims || []
    );
    const unsupportedClaims = visibleClaims
      .filter(claim => requiresEvidence(claim))
      .filter(claim => !agentEvidenceSupportsClaim(options.evidence, claim));
    if (unsupportedClaims.length) {
      issues.push({
        code: 'unsupported_fact_claim',
        severity: 'hard',
        problem: '正文中的具体事实声明没有同一对象、同一事实的有效证据',
        evidence: unsupportedClaims
          .map(claim => claim.text)
          .join('；')
          .slice(0, 240),
        repairGoal: '删除无依据细节，或改成对用户本轮原话的明确归因',
      });
    }
    if (
      SHARED_MEMORY_PATTERN.test(content) &&
      !this.hasSupportingSharedMemory(content, options.evidence || [])
    ) {
      issues.push({
        code: 'unsupported_shared_memory',
        severity: 'hard',
        problem: '回复以亲历口吻新增了未经证实的共同经历或记忆',
        evidence: matchEvidence(content, SHARED_MEMORY_PATTERN),
        repairGoal: '不要声称记得该具体往事；改为承认无法确认并邀请用户补充',
      });
    }

    for (const finding of auditVisibleReplyAssertions({
      userQuery: options.userQuery,
      content,
      boundaryLocks: options.outputConstraints?.boundaryLocks,
    })) {
      if (
        finding.code === 'unsupported_death_experience' &&
        this.hasSupportingFact(content, options.evidence || [])
      ) {
        continue;
      }
      issues.push(visibleFindingToIssue(finding));
    }

    const uniqueIssues = Array.from(
      new Map(issues.map(issue => [issue.code, issue])).values()
    );
    return {
      version: FINAL_REPLY_VALIDATOR_VERSION,
      passed: uniqueIssues.length === 0,
      issues: uniqueIssues,
      unsupportedClaimCount: unsupportedClaims.length,
    };
  }

  private hasSupportingSharedMemory(
    content: string,
    evidence: AgentEvidenceItem[]
  ): boolean {
    return this.hasSupportingFact(content, evidence);
  }

  private hasSupportingUserPreference(
    content: string,
    evidence: AgentEvidenceItem[]
  ): boolean {
    return evidence.some(item => {
      if (
        ![
          'current_user',
          'confirmed_fact',
          'recent_user',
          'retrieved_user',
        ].includes(item.source) ||
        !USER_PREFERENCE_EVIDENCE_PATTERN.test(item.text)
      ) {
        return false;
      }

      return (
        DEICTIC_PREFERENCE_PATTERN.test(content) ||
        evidenceTextSupportsClaim(item.text, content)
      );
    });
  }

  private hasSupportingFact(
    content: string,
    evidence: AgentEvidenceItem[]
  ): boolean {
    return evidence.some(
      item =>
        item.assertionPolicy === 'can_assert' &&
        resolveAgentEvidenceUseMode(item) === 'assert' &&
        evidenceTextSupportsClaim(item.text, content)
    );
  }
}

function visibleFindingToIssue(
  finding: VisibleAssertionFinding
): FinalReplyIssue {
  return {
    code: finding.code,
    severity: 'hard',
    problem: finding.problem,
    evidence: finding.evidence,
    repairGoal: finding.repairGoal,
  };
}

function isDeclarativeCurrentTurnFact(userQuery: string): boolean {
  const normalized = userQuery.trim();
  if (!normalized || /[?？]/.test(normalized)) {
    return false;
  }
  if (
    /吗[。！!\s]*$|(?:还)?记得吗|记不记得|想得起来吗|你(?:还)?记得/.test(
      normalized
    )
  ) {
    return false;
  }

  return /(?:那年|那天|当时|以前|小时候|我(?:说过|告诉过|记得|带你|给你|和你|跟你)|你(?:说过|告诉过|带我|给我)|是在|不是|就是|其实)/.test(
    normalized
  );
}

export function countVisibleReplyCharacters(segments: string[]): number {
  return Array.from(
    segments
      .filter(item => typeof item === 'string')
      .join('')
      .replace(/\s/gu, '')
  ).length;
}

export function selectVisibleAssistantClaims(
  segments: string[],
  claims: AssistantFactClaim[]
): AssistantFactClaim[] {
  return claims.filter(claim =>
    segments.some(segment => assistantTextExpressesClaim(segment, claim.text))
  );
}

function assistantTextExpressesClaim(
  assistantText: string,
  claimText: string
): boolean {
  const assistant = normalizeVisibleClaimText(assistantText);
  const claim = normalizeVisibleClaimText(claimText);

  if (!assistant || !claim) {
    return false;
  }
  if (assistant.includes(claim) || claim.includes(assistant)) {
    return true;
  }

  const assistantTerms = buildVisibleClaimTerms(assistant);
  const claimTerms = buildVisibleClaimTerms(claim);
  if (!assistantTerms.size || !claimTerms.size) {
    return false;
  }

  const overlap = [...claimTerms].filter(term =>
    assistantTerms.has(term)
  ).length;
  const smallerTermCount = Math.min(assistantTerms.size, claimTerms.size);
  return overlap >= 3 && overlap / smallerTermCount >= 0.5;
}

function normalizeVisibleClaimText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s，。！？、,.!?；;：:'"“”‘’（）()[\]【】]/g, '')
    .replace(/(?:当前角色|角色|用户|你|我|他|她|它|咱们|我们)/g, '');
}

function buildVisibleClaimTerms(value: string): Set<string> {
  const terms = new Set<string>();
  const chunks = value.match(/[\u3400-\u9fff]{2,}|[a-z0-9]{2,}/g) || [];

  for (const chunk of chunks) {
    if (/^[a-z0-9]+$/.test(chunk)) {
      terms.add(chunk);
      continue;
    }
    for (let index = 0; index < chunk.length - 1; index += 1) {
      terms.add(chunk.slice(index, index + 2));
    }
  }

  return terms;
}

function isDirectAnswerMissing(userQuery: string, segments: string[]): boolean {
  const query = userQuery.trim();
  const firstSegment = segments[0]?.trim() || '';
  const content = segments.join('');
  if (!query || !firstSegment) {
    return false;
  }

  if (/(?:吃|饭|喝).{0,8}(?:吗|没|什么|啥|哪样)/.test(query)) {
    return !/(?:吃|饭|喝|粥|面|菜|汤|饺子|馒头|水果|奶茶|清淡|简单|还没|没顾上)/.test(
      firstSegment
    );
  }
  if (/(?:干嘛|做什么|做啥|忙什么|在干什么)/.test(query)) {
    return !/(?:我(?:在|正|刚|今天|这会儿)|刚刚|这会儿|看|听|想|歇|坐|走|收拾|忙|唱|开|晒|翻|写|待着)/.test(
      firstSegment
    );
  }
  if (
    /(?:还好吗|好不好|没事吧|怎么样|冷不冷|热不热|疼不疼|累不累)/.test(query)
  ) {
    return !/(?:好|安稳|没事|不冷|冷|不热|热|不疼|疼|不累|累|还行|说不准|不清楚)/.test(
      firstSegment
    );
  }
  if (/(?:是不是|到底是).{0,8}(?:AI|人工智能|机器人)/i.test(query)) {
    return !/(?:AI|人工智能|生成|系统|程序|是|不是)/i.test(firstSegment);
  }
  if (/(?:还记得|记不记得|记得吗|想得起来)/.test(query)) {
    return !/(?:记得|不记得|想得起|想不起|记不清|说不准|不能确认)/.test(
      firstSegment
    );
  }
  if (/(?:为什么|什么原因|怎么会)/.test(query)) {
    return !/(?:因为|是|不是|说不准|不清楚|不知道|没法确认|不能确认)/.test(
      firstSegment
    );
  }

  return PURE_DEFLECTION_PATTERN.test(content.trim());
}

function hasRoleSideContribution(content: string): boolean {
  const stripped = normalizeBubbleText(content)
    .replace(
      /(?:我)?(?:吃过了?|吃了|还没吃|没吃|喝过了?|喝了)(?:今天|刚才|这会儿)?(?:吃得|喝得)?(?:挺|很)?(?:简单|清淡|还行)?/gu,
      ''
    )
    .replace(
      /(?:你|你的).{0,8}(?:关心|惦记|挂念|牵挂|担心|想着|问|提醒|叮嘱).{0,12}(?:收下|收着|听进|记住|心里暖|暖|高兴|踏实|欢喜)/gu,
      ''
    )
    .replace(
      /(?:我)?(?:一直|也|还)?(?:在这|在这里|在呢|陪着你|陪你|听着|听你说)/gu,
      ''
    )
    .replace(
      /(?:我)?(?:一直|也|还|正)?(?:想你|想着你|惦记着你|挂念着你|记着你)/gu,
      ''
    )
    .replace(/(?:我)?(?:知道|明白|懂|心疼你)|别难过|照顾好自己/gu, '')
    .replace(/我/gu, '');

  return (
    /(?:^刚|这会儿|刚才|刚刚|今天|这边|这儿|方才|心里|正慢慢|刚静下来)/.test(
      stripped
    ) && Array.from(stripped).length >= 6
  );
}

function hasRedundantBubbleSemantics(segments: string[]): boolean {
  if (segments.length !== 2) {
    return false;
  }

  const [first, second] = segments;
  const firstSignature = classifyBubbleSemantics(first);
  const secondSignature = classifyBubbleSemantics(second);
  if (visibleTextSimilarity(first, second) >= 0.58) {
    return true;
  }

  return [...firstSignature].some(
    signature =>
      secondSignature.has(signature) &&
      isMostlyGenericSemantic(second, signature)
  );
}

function classifyBubbleSemantics(value: string): Set<string> {
  return new Set(
    Object.entries(BUBBLE_SEMANTIC_PATTERNS)
      .filter(([, pattern]) => pattern.test(value))
      .map(([signature]) => signature)
  );
}

function isMostlyGenericSemantic(value: string, signature: string): boolean {
  const pattern = BUBBLE_SEMANTIC_PATTERNS[signature];
  if (!pattern) {
    return false;
  }

  pattern.lastIndex = 0;
  const remainder = normalizeBubbleText(value).replace(pattern, '');
  return Array.from(remainder).length <= 4;
}

function visibleTextSimilarity(left: string, right: string): number {
  const leftTerms = buildCharacterBigrams(normalizeBubbleText(left));
  const rightTerms = buildCharacterBigrams(normalizeBubbleText(right));
  if (!leftTerms.size || !rightTerms.size) {
    return 0;
  }

  const overlap = [...leftTerms].filter(term => rightTerms.has(term)).length;
  const union = new Set([...leftTerms, ...rightTerms]).size;
  return union ? overlap / union : 0;
}

function normalizeBubbleText(value: string): string {
  return value
    .replace(/[\s，。！？、,.!?；;：:'"“”‘’（）()[\]【】~～]/gu, '')
    .replace(
      /^(?:爸|爸爸|妈|妈妈|爷爷|奶奶|姥姥|姥爷|外公|外婆|老公|老婆|孩子|闺女|儿子|女儿)/,
      ''
    )
    .replace(/(?:一直|真的|就是|也|还|都|呢|啊|呀|啦|哦)/gu, '');
}

function buildCharacterBigrams(value: string): Set<string> {
  const terms = new Set<string>();
  for (let index = 0; index < value.length - 1; index += 1) {
    terms.add(value.slice(index, index + 2));
  }
  return terms;
}

function findRepeatedMoveEvidence(
  segments: string[],
  avoidRecentMoves: string[],
  avoidLiteralClauses: string[]
): string | undefined {
  for (const clause of avoidLiteralClauses) {
    const normalizedClause = normalizeBubbleText(clause);
    if (
      normalizedClause.length >= 4 &&
      segments.some(segment =>
        normalizeBubbleText(segment).includes(normalizedClause)
      )
    ) {
      return clause.slice(0, 160);
    }
  }

  for (const move of avoidRecentMoves) {
    const pattern = REPLY_MOVE_PATTERNS[move];
    if (!pattern) {
      continue;
    }
    const matchedSegments = segments.filter(segment => pattern.test(segment));
    if (
      matchedSegments.length &&
      (segments.length === 1 || matchedSegments.length === segments.length)
    ) {
      return matchedSegments.join('\n').slice(0, 160);
    }
  }

  return undefined;
}

function matchEvidence(content: string, pattern: RegExp): string | undefined {
  const match = pattern.exec(content);
  return match?.[0]?.slice(0, 160);
}

function requiresEvidence(claim: AssistantFactClaim): boolean {
  return !(claim.mode === 'soft_imagination' && claim.kind === 'other');
}
