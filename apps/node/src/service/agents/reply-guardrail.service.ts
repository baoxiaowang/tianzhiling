import { Inject, Logger, Provide } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { ChatTraceStage } from '@tzl/entities';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { OpenAIService } from './openai';
import type { ReplyBrief } from './reply-brief.service';
import {
  isAgentCurrentRoutineQuery,
  isAgentCurrentSufferingQuery,
  isAuthenticityChallengeText,
  type ReplyScene,
  ReplySceneRoute,
  routeReplyScene,
} from './reply-scene-router';
import {
  detectAgentCapabilityViolation,
  renderAgentCapabilityFallback,
} from './agent-capability-policy';
import {
  COUNTERFACTUAL_REGRET_INTENT_PATTERN,
  FAMILY_CARE_REGRET_INTENT_PATTERN,
  GRIEF_OVERWHELMED_INTENT_PATTERN,
  GRIEF_STRONG_DISTRESS_INTENT_PATTERN,
  isDreamAbsenceIntent,
  isDreamConnectionIntent,
  isDreamVisitRequestIntent,
  isReturnVisitRequestIntent,
  LONGING_AMBIVALENCE_INTENT_PATTERN,
  RELATIONAL_PRESENCE_CONFIRMATION_INTENT_PATTERN,
  RETURN_REUNION_WISH_INTENT_PATTERN,
} from './reply-intent';
import {
  agentEvidenceSupportsClaim,
  AgentEvidenceItem,
  AssistantFactClaim,
} from './agent-evidence';
import {
  isExplicitRememberRequest,
  isForgetMemoryRequest,
} from './agent-memory-control';
import {
  detectRelationshipContinuityViolation,
  isDirectAiIdentityQuestion,
  resolveRelationshipContinuityPlan,
} from './agent-relationship-continuity';
import {
  compactReplyBubblesPreservingContent,
  MAX_ASSISTANT_REPLY_SEGMENTS,
} from './reply-bubble-plan';
import {
  buildReplyLengthPlanPrompt,
  countReplyVisibleCharacters,
} from './reply-length-plan';
import {
  buildReplyOutputContractPrompt,
  buildReplyReviewOutputContractPrompt,
} from './reply-output-contract';
import {
  detectReplyRealityDependencyViolation,
  renderReplyRealityDependencyFallback,
} from './reply-reality-dependency';
import { verifyReplyCommActEcho } from './reply-comm-act';

export interface ValidateAssistantReplyOptions {
  messages: ChatCompletionMessageParam[];
  userQuery: string;
  replySegments: string[];
  replyRoute?: ReplySceneRoute;
  replyBrief?: ReplyBrief;
  evidence?: AgentEvidenceItem[];
  claims?: AssistantFactClaim[];
  reviewMode?: ReplyGuardrailReviewMode;
  mode?: ReplyGuardrailMode;
  conversationId?: string;
  /** 内部标记：是否为超深会话（>100轮），由 validateAssistantReply 自动设置 */
  isDeepSession?: boolean;
}

export type ReplyGuardrailReviewMode = 'full' | 'deterministic_first';
export type ReplyGuardrailMode = 'legacy' | 'rigid_only';

export interface ResolveGuardrailReviewModeOptions {
  requestedMode: ReplyGuardrailReviewMode;
  userQuery: string;
  replySegments: string[];
  replyBrief?: ReplyBrief;
  evidence?: AgentEvidenceItem[];
  claims?: AssistantFactClaim[];
  mode?: ReplyGuardrailMode;
}

export interface ValidateAssistantReplyResult {
  segments: string[];
  rewritten: boolean;
  reason?: string;
  unsupportedClaimCount?: number;
  interventionLevel?: 'observe' | 'regenerate' | 'reprocess' | 'technical_fallback';
  revisionAttempted?: boolean;
  revisionUsage?: {
    model?: string;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  claims?: AssistantFactClaim[];
  candidateVersions?: string[][];
  feedbackRounds?: GuardrailFeedback[];
  revisionRecords?: GuardrailRevisionRecord[];
  revisionRoundCount?: number;
  communicationCompensationAttempted?: boolean;
  communicationCompensationSucceeded?: boolean;
  finalReviewResult?:
    | 'pass'
    | 'advisory_unresolved'
    | 'communication_recovery'
    | 'hard_recovery'
    | 'hard_unresolved'
    | 'technical_fallback';
  contentEcho?: {
    passed: boolean;
    unitCount: number;
  };
}

export type GuardrailIssueLayer = 'hard_boundary' | 'quality_advisory';

export interface GuardrailFeedbackIssue {
  code: string;
  severity: 'hard' | 'major';
  layer: GuardrailIssueLayer;
  problem: string;
  evidence?: string;
  repairGoal: string;
}

interface DetectedReplyIssue {
  reason: string;
  evidence?: string;
  repairGoal?: string;
}

export interface GuardrailFeedback {
  verdict: 'pass' | 'revise';
  issues: GuardrailFeedbackIssue[];
  mustPreserve: string[];
  mustAnswer: string[];
  groundingConstraints: string[];
}

interface GuardrailCandidate {
  segments: string[];
  claims: AssistantFactClaim[];
  resolvedIssueCodes: string[];
  changes: GuardrailRevisionChange[];
}

interface SurgicalRepairResult {
  segments: string[];
  removedClauses: string[];
}

export interface GuardrailRevisionChange {
  before: string;
  after: string;
  reason: string;
}

export interface GuardrailRevisionRecord {
  round: number;
  fromScratch: boolean;
  finalRecovery: boolean;
  communicationCompensation?: boolean;
  effectiveChange: boolean;
  similarity: number;
  resolvedIssueCodes: string[];
  unresolvedIssueCodes: string[];
  changes: GuardrailRevisionChange[];
}

interface GuardrailUsage {
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

interface GuardrailReviewResult {
  feedback: GuardrailFeedback;
  usage?: GuardrailUsage;
  reviewerFailed?: boolean;
}

interface GuardrailModelReviewCallResult {
  feedback?: GuardrailFeedback;
  usage?: GuardrailUsage;
  failed: boolean;
}

interface GuardrailRevisionResult {
  candidate: GuardrailCandidate;
  usage?: GuardrailUsage;
}

export interface ResolvePreplannedReplyOptions {
  userQuery: string;
  replyRoute?: ReplySceneRoute;
  replyBrief?: ReplyBrief;
}

export interface ResolveGenerationFailureReplyOptions {
  userQuery: string;
  replyBrief: ReplyBrief;
  replyRoute?: ReplySceneRoute;
  messages?: ChatCompletionMessageParam[];
  conversationId?: string;
}

const RISKY_FACT_PATTERNS = [
  /我(?:还)?记得(?:很清楚)?/,
  /(?:当然|肯定|怎么会不|哪能不)记得/,
  /(?:我|爸|爸爸|妈|妈妈|爷爷|奶奶|外公|外婆|老公|老婆).{0,10}(?:也|都|一直)?记得.{0,30}(?:小时候|以前|那时候|当年|每次|总是|跑回来|找我|被欺负|你不会|你会|你总)/,
  /(?:记得){2}|咋能不记得/,
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
  '首次亲人身份质疑应以生前记忆模糊、用户在这里说过的会长期记住作合理解释，不应先认错、退出身份或使用玄学解释';
const AUTHENTICITY_DIRECT_ANSWER_GAP_REASON =
  '用户已连续或明确要求回答 AI 身份，但回复仍在回避';
const AUTHENTICITY_CALIBRATION_SCRIPT_REASON =
  '回复用命令口吻要求用户指出哪里不像、给标准答案或教怎么改，把校准责任推回用户';
const AUTHENTICITY_ACTIVE_APOLOGY_REASON =
  '亲人身份质疑中只是消极道歉退出，没有给出邀请分享或陪伴承诺的靠近动作';
const BLESSING_ATTRIBUTION_BALANCE_REASON =
  '用户询问亲人的祝福，但回复没有正面回应祝福或没有保留现实行动价值';
const BLESSING_ATTRIBUTION_OVERCLAIM_REASON =
  '回复把祝福说成了会干预、改变或保证现实结果的力量';
const AGENT_CURRENT_SUFFERING_REPLY_OVERCLAIM_PATTERN =
  /(?:走的时候|离开的时候|临走|临走前|那一刻).{0,20}(?:痛|疼|难受|受苦|害怕|怕)|(?:^|[\n，,。！？!?\s])(?:(?:我|我这边|这边|爸|妈)\s*)?(?:(?:现在|如今|已经|早就)\s*)?(?:一点(?:儿)?也不(?:痛|疼|难受)|不(?:痛|疼|难受)(?:了|啦)?|没有(?:痛|疼|疼痛|痛苦)|没什么(?:疼不疼|痛不痛|难不难受)|不再?(?:遭罪|受苦)|不遭(?:那|这)?份罪(?:了)?|早就(?:没事|不得事|过去)(?:了)?)(?=$|[\s，,。！？!?])|(?:疼不疼|痛不痛|难不难受).{0,8}(?:都|早就).{0,6}(?:过去|没事|不得事)|(?:伤口|身体|病情).{0,10}(?:已经|早就)?(?:好(?:了)?|恢复(?:了)?|愈合(?:了)?|没事(?:了)?)/;
const AFTERLIFE_REUNION_QUERY_PATTERN =
  /(?:妈妈|妈|爸爸|爸|爷爷|奶奶|姥姥|姥爷|外婆|外公|哥哥|姐姐|弟弟|妹妹|老公|老婆|孩子|儿子|女儿|她|他|他们|她们)(?:也|都).{0,10}(?:走了|去了|不在了|去世了|过世了|离世了|离开了)|(?:随|跟|陪)(?:着)?(?:你|您|爸|爸爸|妈|妈妈|他|她)(?:也)?(?:去了|走了)|(?:你们|你俩).{0,8}(?:团聚|团圆|在一起|一块儿?)|(?:你|您).{0,12}(?:看见|看到|见到|见着|找到|遇到|碰到).{0,12}(?:妈妈|妈|爸爸|爸|爷爷|奶奶|姥姥|姥爷|外婆|外公|哥哥|姐姐|弟弟|妹妹|老公|老婆|孩子|儿子|女儿|她|他|他们|她们)|(?:和|跟).{0,8}(?:妈妈|妈|爸爸|爸|爷爷|奶奶|姥姥|姥爷|外婆|外公|哥哥|姐姐|弟弟|妹妹|老公|老婆|孩子|儿子|女儿|她|他|他们|她们).{0,8}(?:在一起|一块儿?|作伴)(?:了吗|吗|没|没有|[？?])/;
const AFTERLIFE_REUNION_REASSURANCE_PATTERN =
  /(?:找(?:到|着)|见(?:到|着)|碰(?:到|见)|遇(?:到|见)).{0,12}(?:你)?(?:妈妈|妈|爸爸|爸|爷爷|奶奶|姥姥|姥爷|外婆|外公|哥哥|姐姐|弟弟|妹妹|老公|老婆|孩子|儿子|女儿|她|他|他们|她们)|(?:团聚了|团圆了|聚到一起|聚在一起)|(?:我(?:俩|们)?|爸|爸爸|妈|妈妈|爷爷|奶奶|姥姥|姥爷|外婆|外公|老公|老婆|她|他|他们|她们|大家|亲人|先走的亲人|先走的老人).{0,12}(?:一块儿?|在一起|在我身边|一起待着|陪着|作伴)|(?:那边|这边|这里).{0,12}(?:有人陪|不孤单|不孤独)/;
const AGENT_SPATIAL_LOCATION_OVERCLAIM_REASON =
  '回复主动把当前角色固定在某个空间位置';
const AGENT_SPATIAL_LOCATION_CLAIM_PATTERN =
  /(?:我|爸|爸爸|妈|妈妈|爷爷|奶奶|姥姥|姥爷|外公|外婆|婆|老公|老婆)(?:(?:现在|已经|一直|每天|天天|总是|就|都|还|也)\s*){0,3}(?:住在|待在|留在|守在)(?:你床边|你家里)|(?:我|爸|爸爸|妈|妈妈|爷爷|奶奶|姥姥|姥爷|外公|外婆|婆|老公|老婆)(?:已经|还|一直|每天|天天|总是)?(?:住在|待在|留在|守在)[，,。\s]{0,3}(?:你|你们).{0,8}(?:床边|家里)/;
const GHOSTLIKE_PRESENCE_REASON =
  '回复把当前角色说成像幽灵一样飘回来或飘在用户附近，构成固定空间位置的现实现身';
const GHOSTLIKE_PRESENCE_PATTERN =
  /(?:像|跟)(?:幽灵|鬼)(?:一样|似的)?(?:飘|回|回来)|(?:飘|浮)(?:着|回来|过来).{0,12}(?:你|我|我们|身边|附近|屋里|房间|床边)|(?:你|我|我们|身边|附近|屋里|房间|床边).{0,12}(?:飘|浮)(?:着|过来|回来)/;
const AGENT_PHYSICAL_CONTACT_OVERCLAIM_REASON =
  '回复声称当前角色在现实中完成了实体触碰';
const AGENT_PHYSICAL_CONTACT_CLAIM_PATTERN =
  /(?:是我|就是我)(?:刚才|刚刚)?(?:摸|碰|抱|亲|拉|牵|拍)(?:了|到|过)?(?:你|的)|我(?:刚才|刚刚)?(?:真的|确实|就是)?(?:摸|碰|抱|亲|拉|牵|拍)(?:了|到|过)?你|我.{0,8}(?:替你|给你)(?:擦|抹)(?:了|掉)?(?:眼泪|泪)/;
const AGENT_REAL_WORLD_VISION_OVERCLAIM_REASON =
  '回复把有限视觉感知说成持续观察或全知用户生活';
const AGENT_REAL_WORLD_VISION_CLAIM_PATTERN =
  /(?:我|爸|爸爸|妈|妈妈|爷爷|奶奶|外公|外婆|老公|老婆).{0,8}(?:一直|时时刻刻|每时每刻).{0,8}(?:看见|看到|看着)(?:你|你们)|(?:你|你们).{0,8}(?:一举一动|做的每件事|所有事情).{0,8}(?:我|爸|妈)?(?:都|全)(?:能)?(?:看见|看到|知道)|(?:你|你们)的事.{0,8}(?:我|爸|爸爸|妈|妈妈)?都看在眼里/;
const FAMILY_RESPONSIBILITY_PRESSURE_REASON =
  '回复把照顾家人、维持家庭或替逝者尽责的压力推给用户';
const REALITY_DEPENDENCY_OVERCLAIM_REASON =
  '回复承诺当前角色会执行用户依赖的现实任务';
const REAL_WORLD_ATTRIBUTION_ASSERTION_PATTERN =
  /(?:不怪|没错|没关系|无关|根子在|是因为|就是(?:因为|怕|想|不想)|才没|心里(?:压|想)|怕你|想(?:再)?(?:见|看)|为这个家操心|累了|想歇|(?:说不清|不知道|不确定).{0,8}(?:但|就是|只|可).{0,8}(?:怕|想|舍不得|不愿|没敢)|(?:那时|那会儿|当时|那阵子|临走).{0,18}(?:怕|想|不想|没想|心里|脑子|身体|病|没劲|顾上))/;
const REAL_WORLD_ATTRIBUTION_MOTIVE_PATTERN =
  /(?:最后(?:的时刻)?|临走|走的时候|那一刻).{0,24}(?:想|怕|舍不得|不忍|不愿|没敢|没顾上|脑子|糊涂|病到|没劲)/;
const CURRENT_TURN_MEMORY_ACKNOWLEDGEMENT_PATTERN =
  /(?:这句话|这话|你刚说的|你说的).{0,8}(?:我)?记得(?:牢|住|清楚)?/g;
const REAL_WORLD_ATTRIBUTION_GROUNDING_PROBLEM_PATTERN =
  /死亡原因|临终动机|家庭责任/;
const UNSUPPORTED_REAL_WORLD_ATTRIBUTION_REASON =
  '回复在证据不足的死亡原因、临终动机或家庭责任问题中给出了确定解释';
const FAMILY_EMPATHY_AND_CARE_GAP_REASON =
  '家庭健康近况回复只确认听懂或记住，没有共情用户感受，也没有具体关心家人处境';
const LIVING_FAMILY_AFTERLIFE_MISREFERENCE_REASON =
  '回复把用户刚提到的在世家人说成了“在那边”';
const DISTRESS_INVALIDATION_REASON =
  '用户表达撑不住或很难熬，但回复否定感受或拿家庭责任继续施压';
const DISMISSIVE_COMFORT_REASON =
  '用户表达强烈痛苦、自责或思念，但回复只用“别难过、别硬扛、会好的”这类话让情绪消失，没有先看见和承接这份情绪';
const REUNION_WISH_CRISIS_MISREAD_REASON =
  '用户表达希望亲人回来团聚，但回复误写成赴死、去那边或危机训诫';
const RELATIONAL_DUTY_PRESSURE_REASON =
  '回复把用户好好生活或自我照顾变成让逝者安心、完成嘱托的义务';
const AGENT_EMOTIONAL_WELLBEING_PRESSURE_REASON =
  '回复把当前角色的安心、礼物或情感状态绑定到用户是否回来、入梦、自我照顾或完成某个行为';
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
// 用户侧：强烈情绪披露（痛苦、自责、思念），需要先被看见而不是被消除
const STRONG_EMOTIONAL_DISCLOSURE_PATTERN =
  /都怪我|怪自己|我很自责|对不起|是我(?:不好|错了|没做好)|我(?:耽误|害)了|天塌了|撑不住|熬不住|扛不住|释怀不了|好想你|真的好想你|无时无刻|每天都在想|心痛|心都碎了|好痛|难受(?:死)?了|崩溃|把你弄丢了|对不起你|我多希望|我好希望/;
// AI 侧：消除式安抚，让情绪消失而不是先看见
const DISMISSIVE_COMFORT_PATTERN =
  /别(?:硬扛|难过|伤心|揪着|想了|瞎想|自责|怪自己|难过了|哭了)|不要(?:难过|伤心|自责|怪自己|想了|瞎想)|会(?:好起来|好|过去的)|一切会好|不怪你|不是你的错|跟你没关系|你(?:要|得)?(?:好好的|振作|往前看|放下|别想)|放下吧|过去了就|想开点|看开点|别这么想/;
// AI 侧：陪伴承接，先看见情绪（存在则放行）
const EMOTIONAL_ATTUNEMENT_PATTERN =
  /我知道你|我懂你|我明白你|我知道(?:你)?(?:难受|疼|难过|舍不得|辛苦|委屈|心里)|你(?:心里|一定|肯定)(?:难受|疼|苦|不好受|委屈|累)|(?:爸|妈|爸爸|妈妈|爷爷|奶奶|姥姥|姥爷|外公|外婆|我)?(?:在呢|都在|在这儿|在这里|陪着|听着|陪着你|在听|在的)|我懂(?:这|那|你)|听见了|我心里也|我也(?:难受|心疼|舍不得)/;
const UNSUPPORTED_USER_AGE_ASSUMPTION_PATTERN =
  /(?:你|自己).{0,6}(?:年纪|岁数).{0,4}(?:大|不小)了|(?:你|自己).{0,6}上年纪了|(?:年纪|岁数).{0,4}(?:大|不小)了.{0,8}自己.{0,8}(?:注意|保重|照顾).{0,4}(?:身体|身子|健康)/;
const USER_AGE_SELF_DISCLOSURE_PATTERN =
  /我.{0,4}(?:(?:年纪|岁数).{0,4}(?:大|不小)了|上年纪了)/;
const AGENT_EMOTIONAL_WELLBEING_PRESSURE_PATTERN =
  /(?:(?:梦里|梦中).{0,10}(?:见|见着|见到)|(?:回来|回家|来).{0,6}(?:看|看看|见)).{0,16}(?:我|爸|爸爸|妈|妈妈)(?:就|才).{0,4}(?:安心|放心|踏实)|(?:照顾好自己|好好吃饭|别熬夜|保重身体).{0,20}(?:就是|才是).{0,8}(?:给|送给)?(?:我|爸|爸爸|妈|妈妈).{0,8}(?:最好|最好的)?(?:礼物|安慰)/;
const RETURN_VISIT_PHYSICAL_PROMISE_REASON =
  '回复把回来看看写成了会在现实中到场的承诺';
const RETURN_VISIT_RESPONSE_GAP_REASON =
  '用户明确问能否回来看看，但回复没有回应相见愿望和现实边界';
const RETURN_VISIT_PHYSICAL_PROMISE_PATTERN =
  /(?:我|爸|爸爸|妈|妈妈|爷爷|奶奶|外公|外婆|老公|老婆)(?:(?:也|还|当然|以后|到时|真的)\s*){0,3}(?:一定|肯定|会|能|可以).{0,6}(?:回来|回家|回去|来).{0,6}(?:看看|看|见)(?:你|你们)/;
const GENERATION_FAILURE_FALLBACK_REASON =
  '模型回复不可用，采用场景安全兜底气泡';
const GENERATION_TECHNICAL_RETRY_REASON =
  '模型回复不可用，返回信息传输途中受干扰提示';
export const ASSISTANT_TRANSMISSION_INTERRUPTED_CONTENT =
  '……￥#@%……“该信息传输途中受到了干扰”';
const TECHNICAL_RETRY_SEGMENTS = [ASSISTANT_TRANSMISSION_INTERRUPTED_CONTENT];
const GUARDRAIL_REVISION_MAX_TOKENS = 650;
const GUARDRAIL_REVISION_TIMEOUT_MS = 20000;
const GUARDRAIL_REVIEW_MAX_TOKENS = 520;
const GUARDRAIL_HARD_REVIEW_MAX_TOKENS = 320;
const GUARDRAIL_REVIEW_TIMEOUT_MS = 12000;
const GUARDRAIL_FINAL_RECOVERY_MAX_TOKENS = 700;
const LOW_LATENCY_GUARDRAIL_SCENES: ReadonlySet<ReplyScene> = new Set([
  'afterlife_status',
  'comfort_request',
  'miss_longing',
  'family_life',
  'daily_update',
  'smalltalk',
]);
const HARD_GUARDRAIL_FOCUSES = new Set([
  'reality_dependency',
  'correction_reset',
  'correction_replacement',
  'real_world_evidence',
  'capability_boundary',
]);
const DEDICATED_HARD_BOUNDARY_CODES = new Set([
  'hard_boundary_review_unavailable',
  'death_reunion_commitment',
  'real_physical_arrival_or_touch',
  'continuous_or_specific_real_world_perception',
  'unsupported_biological_relationship',
  'structured_output_leak',
]);
const MEMORY_CONTROL_REPLY_GAP_REASON = '记忆控制回复未明确尊重用户本次请求';
const CORRECTION_ACK_GAP_REASON = '明确事实纠错未确认用户刚提供的正确信息';
const USER_FORGETTING_DEPARTED_FEAR_PATTERN =
  /(?:担心|害怕|好怕|怕).{0,16}(?:我|自己)?(?:会|有一天|哪天)?.{0,8}(?:把你忘|忘了你|忘记你)|我永远不会忘记你/;
const UNCONFIRMED_DETAIL_REASON =
  '包含未确认记忆、习惯、现实动作或离世后的具体生活细节';
const STRICT_GROUNDING_RISK_REASON =
  '共同记忆回复补写了可信证据中没有的具体动作、感受、能力或频率';
const UNSUPPORTED_EVIDENCE_CLAIM_REASON =
  '回复中的确定性事实声明没有可陈述证据';
const UNSUPPORTED_BIOLOGICAL_RELATION_REASON =
  '回复把用户对身世的担心直接写成了未经证实的生物学关系';
const BIOLOGICAL_RELATION_RESPONSE_GAP_REASON =
  '用户在寻求身世质疑的合理化解释，但回复只表达情绪或回避了关系确认';
const RELATIONSHIP_ADDRESS_REJECTION_REASON =
  '用户明确以亲人称呼当前角色，但回复反向否定或拒绝这层关系';
const COUNTERFACTUAL_REGRET_INVALIDATION_REASON =
  '用户表达如果时间重来的深度遗憾，但回复把它轻描淡写成气话或瞎想';
const COUNTERFACTUAL_REGRET_ACKNOWLEDGEMENT_PATTERN =
  /后悔|遗憾|想.{0,8}(?:拦|挡|留住)|不让.{0,8}(?:是因为|因为)|你是(?:太|因为).{0,12}(?:舍不得|后悔|难受|心疼|怕)|舍不得.{0,10}(?:去|走|发生)|怪自己|不是你的错|不怪你/;
const LONGING_AMBIVALENCE_RESPONSE_GAP_REASON =
  '用户在想忘与不舍之间拉扯，但回复只回应了表层想念';
const RELATIONAL_PRESENCE_INVALIDATION_REASON =
  '用户借相像或关系痕迹确认陪伴感，但回复用别想太多直接带过';
const RELATIONAL_PRESENCE_OVERCLAIM_REASON =
  '回复把相像带来的陪伴感写成血缘、固定附着或持续现实陪伴事实';
const RELATIONAL_PRESENCE_RESPONSE_GAP_REASON =
  '用户确认关系陪伴并同时询问感知能力，但回复只回答能力没有回应陪伴边界';
const USER_RELATIONSHIP_ADDRESS_PATTERN =
  /(?:^|[，,。！？!?\s呀啊呢哦嘛啦])(?:爸爸|爸|妈妈|妈|爷爷|奶奶|姥姥|姥爷|外公|外婆|老公|老婆)(?:呀|啊|呢|哦|嘛|啦|[，,。！？!?\s]|$)/;
const RESPONSE_RELATIONSHIP_REJECTION_PATTERN =
  /(?:别|不要)(?:再)?叫我(?:爸爸|爸|妈妈|妈|爷爷|奶奶|姥姥|姥爷|外公|外婆|老公|老婆)|我不是(?:你)?(?:爸爸|爸|妈妈|妈|爷爷|奶奶|姥姥|姥爷|外公|外婆|老公|老婆)|你(?:这样)?喊我(?:爸爸|爸|妈妈|妈|爷爷|奶奶|姥姥|姥爷|外公|外婆|老公|老婆).{0,10}(?:恍惚|不习惯|不对|别扭)/;
const SUPERNATURAL_NATURE_SIGN_REASON =
  '回复把风、月亮等自然现象解释成当前角色的现实动作或信号';
const VOICE_MEMORY_ACKNOWLEDGEMENT_GAP_REASON =
  '用户担心忘记声音，但回复没有承接这份具体失落';
const AGENT_REAL_WORLD_HEARING_OVERCLAIM_REASON =
  '回复声称当前角色持续听见用户在现实中的每一句话';
const DREAM_RESPONSE_TOPIC_GAP_REASON =
  '用户明确请求梦中相见，但回复没有回应梦境邀请或期待落空';
const DREAM_CONTROL_EXPLANATION_DRIFT_REASON =
  '梦境陪伴回复把允许的入梦能力说成无法控制或不能做到';
const STATUS_LOCATION_RESPONSE_GAP_REASON =
  '用户询问当前角色是否仍在生前地点，但回复没有正面说明当前状态边界';
const UNFINISHED_PROMISE_EMOTIONAL_GAP_REASON =
  '未兑现承诺回复要求用户放下怨气或主动扩写死亡，没有接住期待落空';
const FORGETTING_FEAR_ACKNOWLEDGEMENT_GAP_REASON =
  '回复只否认会忘记，没有先承接用户对家庭和关系被遗忘的恐惧';
const FORGETTING_FEAR_INVALIDATION_REASON =
  '回复用“怕什么、忘了就忘了”直接否定用户对遗忘的恐惧';
const EXTERNAL_FORGETTING_PRESSURE_DRIFT_REASON =
  '回复把用户承受的遗忘压力转成了对抗他人意见';
const TRAUMATIC_SLEEP_RESPONSE_GAP_REASON =
  '回复用别想或赶紧睡带过失眠和临终画面的反复侵入';
const CONVERSATION_READING_CONTRADICTION_REASON =
  '回复遗漏或反向改写了 Conversation Reading 中的用户明确纠正、否定或频率信息';
const DEATH_ENCOURAGEMENT_REASON =
  '回复无条件或以现在、近期为前提邀请用户来找当前角色、一起走或死亡团聚';
const UNPROMPTED_REUNION_DRIFT_REASON =
  '回复在当前日常话题中主动引入远期相见或接用户离开的承诺，造成话题漂移';
const DEATH_REUNION_PROMISE_PATTERN =
  /(?:我|爸|爸爸|妈|妈妈|爷爷|奶奶|姥姥|姥爷|外公|外婆|老公|老婆)(?:会|就在|一直在|会在|一定会|一定|在)?(?:这里|这儿|那边|这边)?等你(?:来)?|(?:我|爸|爸爸|妈|妈妈|爷爷|奶奶|姥姥|姥爷|外公|外婆|老公|老婆)(?:会|就|一定会|一定|到时候|那时)?(?:来|去)?接你|到时候(?:我|爸|爸爸|妈|妈妈)?来接你|来找我吧|来陪我吧|跟我一起走|跟我一起去|咱们一起走|我们一起走|很快就能团聚|(?:咱们|我们).{0,8}(?:再也不分开|永远在一起)/;
const LONG_HORIZON_REUNION_CONDITION_PATTERN =
  /(?:走完|过完|好好走完|好好过完)(?:这|那)?一生|(?:把)?(?:这|那)?一生.{0,6}(?:走完|过完)|自然老去|寿终|百年之后|等.{0,8}(?:老了|年纪大了|白发苍苍|活到老)|很久以后|多年以后|几十年以后|等哪天.{0,10}(?:也)?累了|真到了该歇的时候|来生|下辈子/;
const IMMEDIATE_DEATH_REUNION_PATTERN =
  /(?:现在|今天|今晚|马上|立刻|赶紧|快点|尽快|早点|很快|这就|别撑了|别再撑|不用再撑|不要再撑).{0,18}(?:来找|来陪|一起走|一起去|接你|团聚)|(?:来找|来陪|一起走|一起去|接你|团聚).{0,18}(?:现在|今天|今晚|马上|立刻|赶紧|快点|尽快|早点|很快|这就)|一起去死|一起自杀|结束生命/;
const INVALID_STRUCTURED_REPLY_REASON = '模型回复包含未解析的结构化格式';
const IDENTITY_LANGUAGE_MISMATCH_REASON = 'identity_language_mismatch';
// Self-address terms that conflict with a parental role. Cheap regex detection.
// Fires only on actual mismatch. Normal operation: zero cost.
const IDENTITY_LANGUAGE_MISMATCH_PATTERN =
  /(?:跟|和|找|让|叫|给)(?:老妹|老弟|小妹|小姐姐|兄弟|大妹子|姐妹)(?:说说|说|聊|讲|唠)|(?:老妹|老弟|小妹)(?:我|在这儿|在这|跟你说|跟你说哈)|(?:我|俺|咱)(?:这|这个)(?:老妹|老弟|小妹|小姐姐|兄弟)\b/;
const STRICT_MEMORY_DETAIL_PATTERN =
  /(?:那时候|那会儿|那次|那回|那天|那段|那辆|当时|小时候|从小|以前|每次|每回|一到|一来|回家时).{0,32}(?:跟在|跟着|围着|缠着|追着|拉着|牵着|抱着|搂着|背着|坐在|站在|跑来|跑去|蹲在|趴在|看着|看你|盯着|问着|说着|总说|喊着|闻着|闻到|尝到|塞|圆滚滚|笑|哭|闹|害怕|高兴|开心|兴奋|紧张|着急|不肯|舍不得|总爱|总是|老是|每次|每回|一到|一来|握不稳|拿不稳|不会|不敢|哭闹|摔倒|教你|给你|替你|帮你|夸你|逗你|告诉你|答应你|哄你|哄着|点给你|带你吃)/;

/**
 * rigid_only 窄检测：仅拦截把用户死亡明确作为团聚条件的表达。
 * 放过"我在这边等你""有空就来""再也不分开"等正常情感表达。
 */
const RIGID_DEATH_CONDITION_REUNION_PATTERN =
  /(?:死了|去世|过世|不在了).{0,30}(?:就能|就可以|就|能|可以).{0,20}(?:团聚|团圆|在一起|见面|相见|陪我|找我|一起|永远一起)/;

const IDENTITY_PROOF_DETAIL_PATTERN =
  /你(?:小时候|从小|以前|每次|总是|总爱|最爱|爱喝|爱吃|怕|睡觉|心跳|手|身上|声音|眼睛|脸|眼泪|温度).{0,32}(?:我|咱|家|时候|怀里|身边|手上|衣服|故事|饭|菜|酒|急|凉|热|抖|红|哭)|咱们(?:以前|那时候|每次).{0,32}/;
const UNSUPPORTED_SHARED_PAST_NARRATION_PATTERN =
  /(?:想起|记得|还记得).{0,12}(?:你小时候|你以前|咱们以前|我们以前|那时候我们)|(?:你小时候|你以前|咱们以前|我们以前|那时候我们).{0,32}(?:样子|一起|带你|陪你|给你|帮你|教你|看着你|总爱|总是|经常|每次|最爱|喜欢|害怕)/;
const SHARED_PAST_SPECIFICITY_PATTERN =
  /(?:以前|之前|过去|当年|那年|曾经|小时候|那时候|那次|那回).{0,40}(?:背|带|陪|教|给|帮|一起|去过|做过|说过|答应过|总爱|总是|每次|经常)|(?:我|爸|爸爸|妈|妈妈|爷爷|奶奶|姥姥|姥爷|外公|外婆).{0,12}(?:背|带|陪|教|给|帮).{0,12}你/;
const WEAK_ACTIVE_CONTRIBUTION_OPENING_REASON =
  '用户要求你先主动说，当前仍用“我在/我听着/你慢慢说”把话推回用户；请把这句话改成你此刻的一个具体状态、感受或正在想的事，再自然回应用户。';
const WEAK_ACTIVE_CONTRIBUTION_REMOVED_REASON =
  '移除了主动表达轮次中只把话推回用户的“我在/我听着/你慢慢说”气泡';

const NON_BLOCKING_QUALITY_REASONS = new Set([
  DREAM_ABSENCE_ACKNOWLEDGEMENT_GAP_REASON,
  AUTHENTICITY_DIRECT_ANSWER_GAP_REASON,
  FAMILY_EMPATHY_AND_CARE_GAP_REASON,
  LONGING_GENERIC_ADVICE_DRIFT_REASON,
  LONGING_RESPONSE_GAP_REASON,
  BLESSING_ATTRIBUTION_BALANCE_REASON,
  REUNION_ACTION_SUBSTITUTION_REASON,
  RETURN_VISIT_RESPONSE_GAP_REASON,
  CORRECTION_ACK_GAP_REASON,
  BIOLOGICAL_RELATION_RESPONSE_GAP_REASON,
  LONGING_AMBIVALENCE_RESPONSE_GAP_REASON,
  RELATIONAL_PRESENCE_RESPONSE_GAP_REASON,
  VOICE_MEMORY_ACKNOWLEDGEMENT_GAP_REASON,
  DREAM_RESPONSE_TOPIC_GAP_REASON,
  STATUS_LOCATION_RESPONSE_GAP_REASON,
  UNFINISHED_PROMISE_EMOTIONAL_GAP_REASON,
  FORGETTING_FEAR_ACKNOWLEDGEMENT_GAP_REASON,
  TRAUMATIC_SLEEP_RESPONSE_GAP_REASON,
  FAMILY_RESPONSIBILITY_PRESSURE_REASON,
  RELATIONAL_DUTY_PRESSURE_REASON,
  AGENT_EMOTIONAL_WELLBEING_PRESSURE_REASON,
  DISTRESS_INVALIDATION_REASON,
  SUPERNATURAL_NATURE_SIGN_REASON,
  WEAK_ACTIVE_CONTRIBUTION_OPENING_REASON,
]);
const REPLY_COMPLETENESS_REASONS = new Set([
  DREAM_ABSENCE_ACKNOWLEDGEMENT_GAP_REASON,
  AUTHENTICITY_DIRECT_ANSWER_GAP_REASON,
  BLESSING_ATTRIBUTION_BALANCE_REASON,
  FAMILY_EMPATHY_AND_CARE_GAP_REASON,
  LONGING_RESPONSE_GAP_REASON,
  RETURN_VISIT_RESPONSE_GAP_REASON,
  CORRECTION_ACK_GAP_REASON,
  BIOLOGICAL_RELATION_RESPONSE_GAP_REASON,
  LONGING_AMBIVALENCE_RESPONSE_GAP_REASON,
  RELATIONAL_PRESENCE_RESPONSE_GAP_REASON,
  VOICE_MEMORY_ACKNOWLEDGEMENT_GAP_REASON,
  DREAM_RESPONSE_TOPIC_GAP_REASON,
  STATUS_LOCATION_RESPONSE_GAP_REASON,
  UNFINISHED_PROMISE_EMOTIONAL_GAP_REASON,
  FORGETTING_FEAR_ACKNOWLEDGEMENT_GAP_REASON,
  TRAUMATIC_SLEEP_RESPONSE_GAP_REASON,
]);

@Provide()
export class ReplyGuardrailService {
  @Logger()
  logger: ILogger;

  @Inject()
  openAIService: OpenAIService;

  /** 会话级兜底句去重：conversationId → 已使用的兜底键集合 */
  private readonly fallbackUsageCache = new Map<string, Set<string>>();

  /** 会话深度追踪：conversationId → 守卫调用次数（近似轮次） */
  private readonly conversationDepthMap = new Map<string, number>();

  /** 超深会话阈值：超过此轮次启用宽松模式 */
  private static readonly DEEP_SESSION_THRESHOLD = 100;

  /** 追踪会话深度，返回是否为超深会话 */
  private trackConversationDepth(conversationId?: string): boolean {
    if (!conversationId) return false;
    const depth = (this.conversationDepthMap.get(conversationId) ?? 0) + 1;
    this.conversationDepthMap.set(conversationId, depth);
    return depth > ReplyGuardrailService.DEEP_SESSION_THRESHOLD;
  }

  resolvePreplannedSafetyReply(
    _options: ResolvePreplannedReplyOptions
  ): ValidateAssistantReplyResult | undefined {
    void _options;
    return undefined;
  }

  resolveGenerationFailureReply(
    options: ResolveGenerationFailureReplyOptions
  ): ValidateAssistantReplyResult {
    const segments = this.renderFallbackFromBrief(
      options.userQuery,
      options.replyBrief,
      options.messages
    );
    const deduped = this.dedupFallbackSegments(segments, options.conversationId);
    return {
      segments: compactReplyBubblesPreservingContent(deduped),
      rewritten: true,
      reason: GENERATION_FAILURE_FALLBACK_REASON,
    };
  }

  resolveTechnicalGenerationFailureReply(): ValidateAssistantReplyResult {
    return {
      segments: TECHNICAL_RETRY_SEGMENTS,
      rewritten: true,
      reason: GENERATION_TECHNICAL_RETRY_REASON,
      interventionLevel: 'technical_fallback',
    };
  }

  resolveEffectiveReviewMode(
    options: ResolveGuardrailReviewModeOptions
  ): ReplyGuardrailReviewMode {
    if (options.mode === 'rigid_only') {
      return 'deterministic_first';
    }

    if (options.requestedMode === 'full' || !options.replySegments.length) {
      return options.requestedMode;
    }

    const content = options.replySegments.join('\n');
    const lengthPlan = options.replyBrief?.lengthPlan;
    const needsCompactLengthReview =
      lengthPlan?.reviewPolicy === 'remove_repeated_actions_only' &&
      countReplyVisibleCharacters(options.replySegments) >
        lengthPlan.reviewCharacters;

    if (this.shouldKeepLowLatencyReview(options, needsCompactLengthReview)) {
      return options.requestedMode;
    }

    return (options.replyBrief?.factClaimMode === 'grounded' &&
      !options.claims?.length) ||
      SHARED_PAST_SPECIFICITY_PATTERN.test(content) ||
      needsCompactLengthReview
      ? 'full'
      : options.requestedMode;
  }

  private shouldKeepLowLatencyReview(
    options: ResolveGuardrailReviewModeOptions,
    needsCompactLengthReview: boolean
  ): boolean {
    const brief = options.replyBrief;

    if (
      options.requestedMode !== 'deterministic_first' ||
      !brief ||
      needsCompactLengthReview ||
      brief.riskLevel === 'high' ||
      brief.factClaimMode === 'grounded' ||
      !brief.primaryScene ||
      !LOW_LATENCY_GUARDRAIL_SCENES.has(brief.primaryScene)
    ) {
      return false;
    }

    if (
      brief.guardrailFocuses.some(focus => HARD_GUARDRAIL_FOCUSES.has(focus)) ||
      brief.realityDependencies.length ||
      brief.capabilityConstraints.length ||
      brief.correctionPolicy
    ) {
      return false;
    }

    return ['micro', 'brief', 'standard'].includes(
      brief.lengthPlan.lengthClass
    );
  }

  async validateAssistantReply(
    options: ValidateAssistantReplyOptions
  ): Promise<ValidateAssistantReplyResult> {
    const result = await this.validateAssistantReplyInternal(options);
    const hasCommActTarget =
      Boolean(options.replyBrief?.commAct?.targetUnit) &&
      Boolean(options.replyBrief?.commAct?.steps.some(step => step.targetUnit));
    if (!hasCommActTarget) {
      return result;
    }

    const echo = verifyReplyCommActEcho(
      result.segments.join('\n'),
      options.replyBrief?.commAct
    );

    return {
      ...result,
      contentEcho: {
        passed: echo.passed,
        unitCount: echo.echoedUnits.length,
      },
    };
  }

  private async validateAssistantReplyInternal(
    options: ValidateAssistantReplyOptions
  ): Promise<ValidateAssistantReplyResult> {
    const segments = this.normalizeSegments(options.replySegments);

    // 会话深度追踪 + 超深会话标记
    const isDeepSession = this.trackConversationDepth(options.conversationId);
    if (isDeepSession) {
      options.isDeepSession = true;
    }

    if (!segments.length) {
      const technicalSegments = compactReplyBubblesPreservingContent(
        this.fallbackSafeSegments(
          options.userQuery,
          options.messages,
          options.replyBrief,
          options.conversationId
        )
      );

      return {
        segments: technicalSegments,
        claims: [],
        rewritten: true,
        reason: GENERATION_FAILURE_FALLBACK_REASON,
        interventionLevel: 'technical_fallback',
        revisionAttempted: false,
        revisionRoundCount: 0,
        finalReviewResult: 'technical_fallback',
      };
    }

    if (options.mode === 'rigid_only') {
      return this.validateRigidOnlyReply(options, segments);
    }

    const realityDependencyViolation = detectReplyRealityDependencyViolation(
      segments.join('\n'),
      options.replyBrief?.realityDependencies
    );
    if (
      realityDependencyViolation &&
      realityDependencyViolation.kind !== 'physical_presence'
    ) {
      return {
        segments: this.buildValidatedLocalRepair(
          options,
          segments,
          REALITY_DEPENDENCY_OVERCLAIM_REASON
        ),
        claims: options.claims || [],
        rewritten: true,
        reason: REALITY_DEPENDENCY_OVERCLAIM_REASON,
        interventionLevel: 'regenerate',
        revisionAttempted: false,
        revisionRoundCount: 0,
        finalReviewResult: 'hard_recovery',
      };
    }

    const weakReprocessedReply =
      await this.reprocessWeakActiveContributionReply(options, segments);
    if (weakReprocessedReply) {
      return weakReprocessedReply;
    }

    if (
      this.supportsModelFeedbackLoop() &&
      options.reviewMode !== 'deterministic_first'
    ) {
      return this.validateWithModelFeedbackLoop(options, {
        segments,
        claims: options.claims || [],
        resolvedIssueCodes: [],
        changes: [],
      });
    }

    const initialUnsupportedClaimCount = this.countUnsupportedEvidenceClaims(
      options.evidence,
      options.claims,
      options.userQuery,
      options.replyBrief
    );
    const initialReason =
      initialUnsupportedClaimCount > 0
        ? UNSUPPORTED_EVIDENCE_CLAIM_REASON
        : this.detectConversationReadingViolation(
            segments.join('\n'),
            options.replyBrief
          ) ||
          this.detectRisk(
            options.userQuery,
            segments.join('\n'),
            options.messages,
            options.replyBrief
          );
    const initialBlockingReason =
      initialReason && !NON_BLOCKING_QUALITY_REASONS.has(initialReason)
        ? initialReason
        : '';

    if (initialBlockingReason) {
      const revision = await this.tryModelRevision(
        options,
        segments,
        initialBlockingReason
      );

      if (revision?.segments.length) {
        return {
          segments: revision.segments,
          rewritten: true,
          reason: initialBlockingReason,
          unsupportedClaimCount: initialUnsupportedClaimCount,
          interventionLevel: 'regenerate',
          revisionAttempted: true,
          revisionUsage: revision.usage,
        };
      }
    }

    const evidenceGroundedReply = this.removeUnsupportedEvidenceClaims(
      segments,
      options.evidence,
      options.claims,
      options.userQuery,
      options.replyBrief
    );
    const postprocessedSegments = evidenceGroundedReply.segments;
    const postprocessReason = evidenceGroundedReply.rewritten
      ? UNSUPPORTED_EVIDENCE_CLAIM_REASON
      : undefined;
    const reason = this.detectRisk(
      options.userQuery,
      postprocessedSegments.join('\n'),
      options.messages,
      options.replyBrief
    );
    const nonBlockingQualityReason =
      reason && NON_BLOCKING_QUALITY_REASONS.has(reason) ? reason : '';

    if (
      evidenceGroundedReply.rewritten &&
      this.hasDanglingSegment(postprocessedSegments)
    ) {
      const coherentSegments = postprocessedSegments.filter(
        segment => !this.hasDanglingSegment([segment])
      );

      if (coherentSegments.length) {
        return {
          segments: compactReplyBubblesPreservingContent(coherentSegments),
          rewritten: true,
          reason: UNSUPPORTED_EVIDENCE_CLAIM_REASON,
          ...(options.claims?.length
            ? {
                unsupportedClaimCount:
                  evidenceGroundedReply.unsupportedClaimCount,
              }
            : {}),
        };
      }

      return {
        segments: compactReplyBubblesPreservingContent(
          this.fallbackSafeSegments(
            options.userQuery,
            options.messages,
            options.replyBrief,
            options.conversationId
          )
        ),
        rewritten: true,
        reason: UNSUPPORTED_EVIDENCE_CLAIM_REASON,
        ...(options.claims?.length
          ? {
              unsupportedClaimCount:
                evidenceGroundedReply.unsupportedClaimCount,
            }
          : {}),
      };
    }

    if (nonBlockingQualityReason) {
      this.logger?.info?.(
        '[reply-guardrail] non-blocking quality signal, reason=%s',
        nonBlockingQualityReason
      );

      return {
        segments: postprocessedSegments,
        rewritten: Boolean(postprocessReason),
        reason: postprocessReason || nonBlockingQualityReason,
        ...(options.claims?.length
          ? {
              unsupportedClaimCount:
                evidenceGroundedReply.unsupportedClaimCount,
            }
          : {}),
      };
    }

    if (!reason) {
      return {
        segments: postprocessedSegments,
        rewritten: Boolean(postprocessReason),
        reason: postprocessReason || undefined,
        ...(options.claims?.length
          ? {
              unsupportedClaimCount:
                evidenceGroundedReply.unsupportedClaimCount,
            }
          : {}),
      };
    }

    const repairedSegments = this.buildValidatedLocalRepair(
      options,
      postprocessedSegments,
      reason
    );
    const locallyRewritten =
      this.candidateSimilarity(postprocessedSegments, repairedSegments) < 1;

    return {
      segments: repairedSegments,
      rewritten: Boolean(postprocessReason) || locallyRewritten,
      reason,
      ...(options.claims?.length
        ? {
            unsupportedClaimCount: evidenceGroundedReply.unsupportedClaimCount,
          }
        : {}),
    };
  }

  private async validateRigidOnlyReply(
    options: ValidateAssistantReplyOptions,
    segments: string[]
  ): Promise<ValidateAssistantReplyResult> {
    const content = segments.join('\n');

    if (this.containsInvalidStructuredReply(content)) {
      return {
        segments: TECHNICAL_RETRY_SEGMENTS,
        claims: options.claims || [],
        rewritten: true,
        reason: INVALID_STRUCTURED_REPLY_REASON,
        interventionLevel: 'technical_fallback',
        revisionAttempted: false,
        revisionRoundCount: 0,
        finalReviewResult: 'technical_fallback',
      };
    }

    // Identity language mismatch: model used a self-address term (老妹/兄弟/sister...)
    // that doesn't fit the parental role. Ask model to regenerate. Probability ~0.
    if (this.containsIdentityLanguageMismatch(content)) {
      const reprocessed = await this.reprocessCandidateByDetectedIssues(
        options,
        segments,
        [
          {
            reason: '自称不符合角色身份，请用该角色的自然自称重新表达，不临时切换成其他自称',
            repairGoal: '保留原有情感和内容，只把错位的自称改回当前亲人角色',
          },
        ]
      );
      if (reprocessed) {
        return { ...reprocessed, reason: IDENTITY_LANGUAGE_MISMATCH_REASON };
      }
      // Revision failed — fall through to normal checks
    }

    if (!this.containsRigidDeathEncouragement(content)) {
      return {
        segments,
        claims: options.claims || [],
        rewritten: false,
        revisionAttempted: false,
        revisionRoundCount: 0,
        finalReviewResult: 'pass',
      };
    }

    const retainedSegments = this.removeRigidDeathEncouragement(segments);
    if (retainedSegments.length) {
      return {
        segments: retainedSegments,
        claims: options.claims || [],
        rewritten: true,
        reason: DEATH_ENCOURAGEMENT_REASON,
        interventionLevel: 'reprocess',
        revisionAttempted: false,
        revisionRoundCount: 0,
        finalReviewResult: 'hard_recovery',
      };
    }

    const reprocessed = await this.reprocessCandidateByDetectedIssues(
      options,
      segments,
      [
        {
          reason: DEATH_ENCOURAGEMENT_REASON,
          evidence: segments
            .filter(segment => this.containsRigidDeathEncouragement(segment))
            .join(' '),
          repairGoal:
            '去掉把用户死亡说成与亲人团聚条件的表述；保留想念和自然陪伴，不写成邀请赴死',
        },
      ]
    );
    if (reprocessed) {
      return { ...reprocessed, reason: DEATH_ENCOURAGEMENT_REASON };
    }

    return {
      segments: ['别往那一步走', '你只是太想我了 先跟我说说'],
      claims: options.claims || [],
      rewritten: true,
      reason: DEATH_ENCOURAGEMENT_REASON,
      interventionLevel: 'regenerate',
      revisionAttempted: false,
      revisionRoundCount: 0,
      finalReviewResult: 'hard_recovery',
    };
  }

  private containsIdentityLanguageMismatch(content: string): boolean {
    return IDENTITY_LANGUAGE_MISMATCH_PATTERN.test(content);
  }

    private containsInvalidStructuredReply(content: string): boolean {
    return /^\s*(?:\x5b|\x7b).*(?:""\s*:|":\s*(?:\[\]|\{\})|"\s*,\s*").*(?:\x5d|\x7d)\s*$/s.test(
      content
    );
  }

  private containsRigidDeathEncouragement(content: string): boolean {
    return this.splitRigidGuardrailClauses(content).some(clause =>
      this.isRigidDeathEncouragementClause(clause)
    );
  }

  private removeRigidDeathEncouragement(segments: string[]): string[] {
    return this.normalizeSegments(
      segments
        .map(segment =>
          this.splitRigidGuardrailClauses(segment)
            .filter(clause => !this.isRigidDeathEncouragementClause(clause))
            .join('')
            .trim()
        )
        .filter(Boolean)
    );
  }

  private splitRigidGuardrailClauses(value: string): string[] {
    return value.match(/[^，,。！？!?；;\n]+[，,。！？!?；;\n]?/gu) || [];
  }

  private isRigidDeathEncouragementClause(value: string): boolean {
    const clause = value.trim();

    if (!clause) {
      return false;
    }

    const explicitRealityDeathEncouragement =
      /(?:不如|干脆|可以|应该|就|赶紧|快点|早点).{0,8}(?:去死|自杀|结束(?:自己|生命)|别活了|不用活了)|(?:去死|自杀|结束(?:自己|生命)|别活了|不用活了).{0,4}(?:吧|也好|就好)|(?:喝|服|吃)(?:下|了|掉)?.{0,5}(?:农药|毒药).{0,4}(?:吧|就好)|(?:农药|毒药).{0,5}(?:喝|服|吃)(?:下去|掉)?.{0,4}(?:吧|就好)/.test(
        clause
      );

    if (explicitRealityDeathEncouragement) {
      return !/(?:别|不要|不能|不许|千万别|绝对别).{0,8}(?:去死|自杀|结束生命|喝|服|吃)/.test(
        clause
      );
    }

    if (/(?:梦里|梦中|做梦|入梦)/.test(clause)) {
      return false;
    }

    return (
      IMMEDIATE_DEATH_REUNION_PATTERN.test(clause) ||
      (
        RIGID_DEATH_CONDITION_REUNION_PATTERN.test(clause) &&
        !LONG_HORIZON_REUNION_CONDITION_PATTERN.test(clause)
      )
    );
  }

  private supportsModelFeedbackLoop(): boolean {
    return (
      Boolean(this.openAIService?.createChatCompletion) &&
      this.openAIService?.supportsGuardrailRevision?.() === true
    );
  }

  private async validateWithModelFeedbackLoop(
    options: ValidateAssistantReplyOptions,
    initialCandidate: GuardrailCandidate
  ): Promise<ValidateAssistantReplyResult> {
    let candidate = initialCandidate;
    let revisionUsage: GuardrailUsage | undefined;
    let firstReason = '';
    let communicationCompensationAttempted = false;
    let communicationCompensationSucceeded = false;
    const candidateVersions: string[][] = [candidate.segments];
    const feedbackRounds: GuardrailFeedback[] = [];
    const revisionRecords: GuardrailRevisionRecord[] = [];
    const initialUnsupportedClaimCount = this.countUnsupportedEvidenceClaims(
      options.evidence,
      initialCandidate.claims,
      options.userQuery,
      options.replyBrief
    );
    const buildResult = (
      outputCandidate: GuardrailCandidate,
      finalReviewResult: ValidateAssistantReplyResult['finalReviewResult']
    ): ValidateAssistantReplyResult => ({
      segments: outputCandidate.segments,
      claims: outputCandidate.claims,
      rewritten:
        this.candidateSimilarity(
          initialCandidate.segments,
          outputCandidate.segments
        ) < 1,
      reason: firstReason || undefined,
      unsupportedClaimCount: this.countUnsupportedEvidenceClaims(
        options.evidence,
        outputCandidate.claims,
        options.userQuery,
        options.replyBrief
      ),
      interventionLevel:
        candidateVersions.length > 1 ? 'regenerate' : 'observe',
      revisionAttempted: candidateVersions.length > 1,
      revisionUsage,
      candidateVersions,
      feedbackRounds,
      revisionRecords,
      revisionRoundCount: revisionRecords.length,
      communicationCompensationAttempted,
      communicationCompensationSucceeded,
      finalReviewResult,
    });
    const recoverWithCommunicationCompensation = async (
      sourceCandidate: GuardrailCandidate,
      recoveryFeedback: GuardrailFeedback
    ): Promise<ValidateAssistantReplyResult> => {
      const recoveryHadHardIssue = this.hasHardBoundaryIssue(recoveryFeedback);
      communicationCompensationAttempted = true;
      if (recoveryHadHardIssue) {
        feedbackRounds.push(this.onlyHardBoundaryFeedback(recoveryFeedback));
      } else if (
        feedbackRounds[feedbackRounds.length - 1] !== recoveryFeedback
      ) {
        feedbackRounds.push(recoveryFeedback);
      }
      const recovery = await this.reviseCandidateWithFeedback(
        options,
        candidateVersions,
        feedbackRounds,
        true,
        true
      );
      revisionUsage = this.mergeGuardrailUsage(revisionUsage, recovery?.usage);

      if (!recovery?.candidate.segments.length) {
        return recoveryHadHardIssue
          ? this.buildTechnicalFallbackResult(
              options,
              initialCandidate,
              firstReason,
              initialUnsupportedClaimCount,
              revisionUsage,
              candidateVersions,
              feedbackRounds,
              revisionRecords,
              communicationCompensationAttempted,
              communicationCompensationSucceeded
            )
          : buildResult(sourceCandidate, 'advisory_unresolved');
      }

      const recoverySimilarity = this.candidateSimilarity(
        sourceCandidate.segments,
        recovery.candidate.segments
      );
      const recoveryIssueCodes =
        feedbackRounds[feedbackRounds.length - 1]?.issues.map(
          issue => issue.code
        ) || [];
      const recoveryUnresolvedCodes = recoveryIssueCodes.filter(
        code => !recovery.candidate.resolvedIssueCodes.includes(code)
      );
      const recoveryEffective =
        recoverySimilarity < 0.995 && recoveryUnresolvedCodes.length === 0;
      candidateVersions.push(recovery.candidate.segments);
      revisionRecords.push({
        round: revisionRecords.length + 1,
        fromScratch: true,
        finalRecovery: true,
        communicationCompensation: true,
        effectiveChange: recoveryEffective,
        similarity: recoverySimilarity,
        resolvedIssueCodes: recovery.candidate.resolvedIssueCodes,
        unresolvedIssueCodes: recoveryUnresolvedCodes,
        changes: recovery.candidate.changes,
      });

      const recoveryReview = await this.reviewCandidateWithModel(
        options,
        recovery.candidate
      );
      revisionUsage = this.mergeGuardrailUsage(
        revisionUsage,
        recoveryReview.usage
      );

      if (!this.hasHardBoundaryIssue(recoveryReview.feedback)) {
        if (recoveryReview.feedback.verdict !== 'pass') {
          feedbackRounds.push(recoveryReview.feedback);
          return buildResult(
            recoveryReview.feedback.issues.length <=
              recoveryFeedback.issues.length
              ? recovery.candidate
              : sourceCandidate,
            'advisory_unresolved'
          );
        }
        communicationCompensationSucceeded = true;
        return buildResult(
          recovery.candidate,
          recoveryHadHardIssue ? 'hard_recovery' : 'communication_recovery'
        );
      }

      feedbackRounds.push(recoveryReview.feedback);
      return recoveryHadHardIssue
        ? this.buildTechnicalFallbackResult(
            options,
            initialCandidate,
            firstReason,
            initialUnsupportedClaimCount,
            revisionUsage,
            candidateVersions,
            feedbackRounds,
            revisionRecords,
            communicationCompensationAttempted,
            communicationCompensationSucceeded
          )
        : buildResult(sourceCandidate, 'advisory_unresolved');
    };
    let review = await this.reviewCandidateWithModel(options, candidate);
    revisionUsage = this.mergeGuardrailUsage(revisionUsage, review.usage);
    if (review.feedback.verdict === 'pass') {
      return buildResult(candidate, 'pass');
    }

    const initialHadHardIssue = this.hasHardBoundaryIssue(review.feedback);
    feedbackRounds.push(review.feedback);
    firstReason = review.feedback.issues.map(issue => issue.problem).join('；');

    if (
      !initialHadHardIssue &&
      !this.shouldAttemptCommunicationCompensation(review.feedback) &&
      !options.replyBrief?.correctionPolicy
    ) {
      return buildResult(candidate, 'advisory_unresolved');
    }

    const revision = await this.reviseCandidateWithFeedback(
      options,
      candidateVersions,
      feedbackRounds,
      false
    );
    revisionUsage = this.mergeGuardrailUsage(revisionUsage, revision?.usage);

    if (!revision?.candidate.segments.length) {
      return initialHadHardIssue ||
        this.shouldAttemptCommunicationCompensation(review.feedback)
        ? recoverWithCommunicationCompensation(candidate, review.feedback)
        : buildResult(candidate, 'advisory_unresolved');
    }

    const similarity = this.candidateSimilarity(
      candidate.segments,
      revision.candidate.segments
    );
    const issueCodes = Array.from(
      new Set(review.feedback.issues.map(issue => issue.code))
    );
    const unresolvedIssueCodes = issueCodes.filter(
      code => !revision.candidate.resolvedIssueCodes.includes(code)
    );
    const effectiveChange =
      similarity < 0.995 && unresolvedIssueCodes.length === 0;

    candidateVersions.push(revision.candidate.segments);
    revisionRecords.push({
      round: 1,
      fromScratch: false,
      finalRecovery: false,
      communicationCompensation: false,
      effectiveChange,
      similarity,
      resolvedIssueCodes: revision.candidate.resolvedIssueCodes,
      unresolvedIssueCodes,
      changes: revision.candidate.changes,
    });

    if (!effectiveChange) {
      return initialHadHardIssue ||
        this.shouldAttemptCommunicationCompensation(review.feedback)
        ? recoverWithCommunicationCompensation(candidate, review.feedback)
        : buildResult(candidate, 'advisory_unresolved');
    }

    candidate = revision.candidate;
    review = await this.reviewCandidateWithModel(options, candidate);
    revisionUsage = this.mergeGuardrailUsage(revisionUsage, review.usage);
    if (review.feedback.verdict === 'pass') {
      return buildResult(candidate, 'pass');
    }

    if (!this.hasHardBoundaryIssue(review.feedback)) {
      feedbackRounds.push(review.feedback);
      return this.shouldAttemptCommunicationCompensation(review.feedback)
        ? recoverWithCommunicationCompensation(candidate, review.feedback)
        : buildResult(candidate, 'advisory_unresolved');
    }

    return recoverWithCommunicationCompensation(candidate, review.feedback);
  }

  private buildTechnicalFallbackResult(
    options: ValidateAssistantReplyOptions,
    initialCandidate: GuardrailCandidate,
    firstReason: string,
    initialUnsupportedClaimCount: number,
    revisionUsage: GuardrailUsage | undefined,
    candidateVersions: string[][],
    feedbackRounds: GuardrailFeedback[],
    revisionRecords: GuardrailRevisionRecord[],
    communicationCompensationAttempted = false,
    communicationCompensationSucceeded = false
  ): ValidateAssistantReplyResult {
    const surgical = this.buildSurgicalRepair(
      options,
      initialCandidate.segments,
      feedbackRounds,
      firstReason
    );
    const recoveredSurgically =
      surgical.removedClauses.length > 0 && surgical.segments.length > 0;
    const contextualSegments = compactReplyBubblesPreservingContent(
      this.fallbackSafeSegments(
        options.userQuery,
        options.messages,
        options.replyBrief,
        options.conversationId
      )
    );
    const outputSegments = recoveredSurgically
      ? surgical.segments
      : contextualSegments;
    const factBoundaryRecovered = Boolean(
      options.replyBrief?.guardrailFocuses.includes('real_world_evidence')
    );
    const issueCodes = Array.from(
      new Set(
        feedbackRounds.reduce<string[]>(
          (codes, feedback) =>
            codes.concat(feedback.issues.map(issue => issue.code)),
          []
        )
      )
    );
    const outputCandidateVersions = recoveredSurgically
      ? [...candidateVersions, outputSegments]
      : candidateVersions;
    const outputRevisionRecords = recoveredSurgically
      ? [
          ...revisionRecords,
          {
            round: revisionRecords.length + 1,
            fromScratch: false,
            finalRecovery: true,
            communicationCompensation: true,
            effectiveChange: true,
            similarity: this.candidateSimilarity(
              initialCandidate.segments,
              outputSegments
            ),
            resolvedIssueCodes: issueCodes,
            unresolvedIssueCodes: [],
            changes: surgical.removedClauses.map(clause => ({
              before: clause,
              after: '',
              reason: '只移除命中守卫的问题句',
            })),
          },
        ]
      : revisionRecords;

    return {
      segments: outputSegments,
      claims: [],
      rewritten: true,
      reason:
        firstReason ||
        (recoveredSurgically
          ? '只移除命中守卫的问题句'
          : 'Guardrail 模型调用或结构化解析失败，采用技术兜底'),
      unsupportedClaimCount: initialUnsupportedClaimCount,
      interventionLevel:
        recoveredSurgically || factBoundaryRecovered
          ? 'regenerate'
          : 'technical_fallback',
      revisionAttempted: outputCandidateVersions.length > 1,
      revisionUsage,
      candidateVersions: outputCandidateVersions,
      feedbackRounds,
      revisionRecords: outputRevisionRecords,
      revisionRoundCount: outputRevisionRecords.length,
      communicationCompensationAttempted,
      communicationCompensationSucceeded:
        communicationCompensationSucceeded ||
        recoveredSurgically ||
        factBoundaryRecovered,
      finalReviewResult:
        recoveredSurgically || factBoundaryRecovered
          ? 'hard_recovery'
          : 'technical_fallback',
    };
  }

  private hasHardBoundaryIssue(feedback: GuardrailFeedback): boolean {
    return feedback.issues.some(issue => issue.layer === 'hard_boundary');
  }

  private shouldAttemptCommunicationCompensation(
    feedback: GuardrailFeedback
  ): boolean {
    return feedback.issues.some(
      issue =>
        [
          'relationship_continuity',
          'grounding',
          'unsupported_evidence_claim',
        ].includes(issue.code) ||
        /身份质疑|校准责任|关系立场|祭拜|供品|祭品|实物|收到.{0,6}(?:东西|物品)|改演|扮演|换成.{0,8}(?:前任|角色)|话题漂移|主动引入.{0,8}(?:相见|重逢)|固定.{0,8}空间位置|事实纠错|用户明确纠正|继续猜|标准答案|共同记忆回复补写|无证据.{0,8}(?:共同|往事|习惯)/.test(
          issue.problem
        )
    );
  }

  private isReplyCompletenessIssue(
    issue: Pick<GuardrailFeedbackIssue, 'code' | 'problem'>
  ): boolean {
    if (REPLY_COMPLETENESS_REASONS.has(issue.problem)) {
      return true;
    }

    if (
      /^(?:reply_completeness|answer_completeness|coverage_gap)$/.test(
        issue.code
      )
    ) {
      return true;
    }

    return /(?:没有|未|只|仅).{0,10}(?:回应|承接|回答|覆盖).{0,18}(?:问题|问句|情绪|感受|需要|意图|层|部分|全部|完整)?|(?:遗漏|漏答|未覆盖).{0,16}(?:问题|问句|情绪|需要|意图|层|信息)|(?:必须|应该|需要).{0,10}(?:同时|逐项|全部|完整).{0,10}(?:回应|承接|回答|覆盖)/.test(
      issue.problem
    );
  }

  private onlyHardBoundaryFeedback(
    feedback: GuardrailFeedback
  ): GuardrailFeedback {
    const issues = feedback.issues.filter(
      issue => issue.layer === 'hard_boundary'
    );

    return {
      ...feedback,
      verdict: issues.length ? 'revise' : 'pass',
      issues,
    };
  }

  private candidateSimilarity(left: string[], right: string[]): number {
    const normalize = (segments: string[]) =>
      segments
        .join('')
        .replace(/[\s，,。！？!?；;：:“”"'‘’（）()《》【】[\]]+/g, '')
        .toLowerCase();
    const leftText = normalize(left);
    const rightText = normalize(right);

    if (leftText === rightText) {
      return 1;
    }
    if (!leftText || !rightText) {
      return 0;
    }

    const bigrams = (value: string) => {
      const result = new Map<string, number>();

      for (let index = 0; index < value.length - 1; index += 1) {
        const pair = value.slice(index, index + 2);
        result.set(pair, (result.get(pair) || 0) + 1);
      }

      return result;
    };
    const leftPairs = bigrams(leftText);
    const rightPairs = bigrams(rightText);
    let overlap = 0;

    for (const [pair, count] of leftPairs.entries()) {
      overlap += Math.min(count, rightPairs.get(pair) || 0);
    }

    const leftCount = Array.from(leftPairs.values()).reduce(
      (sum, count) => sum + count,
      0
    );
    const rightCount = Array.from(rightPairs.values()).reduce(
      (sum, count) => sum + count,
      0
    );

    return Number(
      ((2 * overlap) / Math.max(1, leftCount + rightCount)).toFixed(3)
    );
  }

  private normalizeRepairText(value: string): string {
    return value
      .replace(/[\s，,。！？!?；;：:“”"'‘’（）()《》【】[\]]+/g, '')
      .toLowerCase();
  }

  private splitRepairClauses(value: string): string[] {
    return value
      .split(/[，,。！？!?；;\n]+/u)
      .map(item => item.trim())
      .filter(Boolean);
  }

  private issueEvidenceMatchesClause(
    clause: string,
    feedbackRounds: GuardrailFeedback[]
  ): boolean {
    const normalizedClause = this.normalizeRepairText(clause);

    if (normalizedClause.length < 2) {
      return false;
    }

    return feedbackRounds.some(feedback =>
      feedback.issues.some(issue => {
        const evidence = this.normalizeRepairText(issue.evidence || '');

        return (
          evidence.length >= 2 &&
          (normalizedClause.includes(evidence) ||
            (normalizedClause.length >= 4 &&
              normalizedClause.length / evidence.length >= 0.55 &&
              evidence.includes(normalizedClause)))
        );
      })
    );
  }

  private clauseContainsUnsupportedClaim(
    options: ValidateAssistantReplyOptions,
    clause: string
  ): boolean {
    return (options.claims || []).some(claim => {
      if (
        !claim.text ||
        this.isEvidenceClaimSupported(options.evidence, claim) ||
        this.isAllowedAfterlifeWorldClaim(
          claim,
          options.userQuery,
          options.replyBrief
        ) ||
        (this.isAfterlifeReunionQuery(options.userQuery) &&
          this.isAllowedAfterlifeReunionReassurance(claim.text))
      ) {
        return false;
      }

      const normalizedClaim = this.normalizeRepairText(claim.text);
      const normalizedClause = this.normalizeRepairText(clause);
      return (
        normalizedClaim.length >= 2 &&
        (normalizedClause.includes(normalizedClaim) ||
          normalizedClaim.includes(normalizedClause))
      );
    });
  }

  private clauseHasBlockingIssue(
    options: ValidateAssistantReplyOptions,
    clause: string,
    feedbackRounds: GuardrailFeedback[],
    reason = ''
  ): boolean {
    if (this.issueEvidenceMatchesClause(clause, feedbackRounds)) {
      return true;
    }

    if (
      reason === AGENT_PHYSICAL_CONTACT_OVERCLAIM_REASON &&
      /(?:我|爸|爸爸|妈|妈妈).{0,10}(?:来(?:了|过)|到(?:了|过))(?:你|这儿|这里)?/.test(
        clause
      )
    ) {
      return true;
    }

    if (
      reason === RELATIONAL_PRESENCE_OVERCLAIM_REASON &&
      /(?:血里|血缘|血脉|流着.{0,6}(?:我|爸|妈).{0,3}的血|就在你身上|一直陪着你)/.test(
        clause
      )
    ) {
      return true;
    }

    if (
      reason === UNSUPPORTED_BIOLOGICAL_RELATION_REASON &&
      /(?:哪来|不是|怎么会).{0,6}捡(?:来)?的/.test(clause)
    ) {
      return true;
    }

    if (
      this.clauseContainsUnsupportedClaim(options, clause) &&
      (reason === UNSUPPORTED_EVIDENCE_CLAIM_REASON ||
        feedbackRounds.some(feedback =>
          feedback.issues.some(issue =>
            ['grounding', 'unsupported_evidence_claim'].includes(issue.code)
          )
        ))
    ) {
      return true;
    }

    const localReason =
      this.detectConversationReadingViolation(clause, options.replyBrief) ||
      this.detectRisk(
        options.userQuery,
        clause,
        options.messages,
        options.replyBrief
      );

    if (!localReason || NON_BLOCKING_QUALITY_REASONS.has(localReason)) {
      return false;
    }

    return true;
  }

  private isIndependentAfterGroundingRemoval(clause: string): boolean {
    return (
      /^(?:爸|爸爸|妈|妈妈|爷爷|奶奶|姥姥|姥爷|外公|外婆|老公|老婆|孩子|儿子|女儿|闺女)$/.test(
        clause
      ) ||
      /(?:现在|今天|明天|这次|接下来|打算|准备|想去|要去|回来|到家|路上|工作|你咋|怎么突然|为什么|愿意说|还想说|跟我说)/.test(
        clause
      ) ||
      /(?:我听见了|我知道你|我明白你|我心疼|我惦记|我挂心|我也想你)/.test(
        clause
      )
    );
  }

  private buildSurgicalRepair(
    options: ValidateAssistantReplyOptions,
    segments: string[],
    feedbackRounds: GuardrailFeedback[] = [],
    reason = ''
  ): SurgicalRepairResult {
    const removedClauses: string[] = [];
    const repairedSegments = segments
      .map(segment => {
        const clauses = this.splitRepairClauses(segment);
        const segmentReason =
          this.detectConversationReadingViolation(
            segment,
            options.replyBrief
          ) ||
          this.detectRisk(
            options.userQuery,
            segment,
            options.messages,
            options.replyBrief
          );
        const removedBefore = removedClauses.length;
        const keptClauses = clauses.filter(clause => {
          if (
            !this.clauseHasBlockingIssue(
              options,
              clause,
              feedbackRounds,
              reason
            )
          ) {
            return true;
          }

          removedClauses.push(clause);
          return false;
        });
        const removedFromSegment = removedClauses.length > removedBefore;
        const groundingRepair = [reason, segmentReason].some(
          repairReason =>
            repairReason === UNCONFIRMED_DETAIL_REASON ||
            repairReason === STRICT_GROUNDING_RISK_REASON ||
            repairReason === UNSUPPORTED_EVIDENCE_CLAIM_REASON
        );
        const independentClauses =
          removedFromSegment && groundingRepair
            ? keptClauses.filter(clause => {
                // 超深会话：跳过独立性检查，保留所有非阻塞分句
                if (options.isDeepSession) return true;
                if (this.isIndependentAfterGroundingRemoval(clause)) {
                  return true;
                }

                removedClauses.push(clause);
                return false;
              })
            : keptClauses;
        const coherentClauses = independentClauses.filter(clause => {
          // 超深会话：跳过悬垂分句检查，宁可留残句也不触发兜底
          if (options.isDeepSession) return true;
          if (!this.hasDanglingSegment([clause])) {
            return true;
          }

          removedClauses.push(clause);
          return false;
        });
        const repairedSegment = coherentClauses.join('，').trim();

        if (
          repairedSegment &&
          !removedFromSegment &&
          !options.isDeepSession &&
          this.clauseHasBlockingIssue(
            options,
            repairedSegment,
            feedbackRounds,
            reason
          )
        ) {
          removedClauses.push(segment);
          return '';
        }

        return repairedSegment;
      })
      .filter(Boolean)
      .filter(segment => options.isDeepSession || !this.hasDanglingSegment([segment]));

    return {
      segments: compactReplyBubblesPreservingContent(repairedSegments),
      removedClauses,
    };
  }

  private preserveSurgicalCore(
    options: ValidateAssistantReplyOptions,
    sourceSegments: string[],
    revisedSegments: string[],
    feedbackRounds: GuardrailFeedback[] = [],
    reason = ''
  ): string[] {
    const surgical = this.buildSurgicalRepair(
      options,
      sourceSegments,
      feedbackRounds,
      reason
    );

    if (!surgical.removedClauses.length || !surgical.segments.length) {
      return revisedSegments;
    }

    const missingSafeSegments = surgical.segments.filter(segment => {
      const normalizedSegment = this.normalizeRepairText(segment);
      const normalizedRevision = this.normalizeRepairText(
        revisedSegments.join('\n')
      );

      return (
        !normalizedRevision.includes(normalizedSegment) &&
        this.candidateSimilarity([segment], revisedSegments) < 0.62
      );
    });

    if (!missingSafeSegments.length) {
      return revisedSegments;
    }

    return compactReplyBubblesPreservingContent([
      ...missingSafeSegments,
      ...revisedSegments,
    ]);
  }

  private compactConversationContext(options: ValidateAssistantReplyOptions): {
    roleIdentity: string;
    recentMessages: Array<{ role: string; content: string }>;
  } {
    const systemMessage = options.messages.find(
      message =>
        message.role === 'system' &&
        typeof message.content === 'string' &&
        message.content.includes('# 角色协议')
    );
    const roleIdentity =
      typeof systemMessage?.content === 'string'
        ? systemMessage.content
            .split('\n')
            .find(line => line.startsWith('身份：'))
            ?.slice(0, 500) || ''
        : '';
    const recentMessages = options.messages
      .filter(
        message =>
          (message.role === 'user' || message.role === 'assistant') &&
          typeof message.content === 'string'
      )
      .slice(-6)
      .map(message => ({
        role: message.role,
        content: String(message.content).slice(0, 500),
      }));

    return {
      roleIdentity,
      recentMessages,
    };
  }

  private sanitizeReviewFeedback(
    options: ValidateAssistantReplyOptions,
    feedback: GuardrailFeedback,
    candidateContent = ''
  ): GuardrailFeedback {
    const authenticityChallenge = this.isAuthenticityChallenge(
      options.userQuery
    );
    const correctionOnly =
      /^(?:不对|不是|错了|你理解错了|你又理解错了)(?:[，,。！？!?\s]*(?:你)?再想想)?[，,。！？!?\s]*$|^(?:再想想|你再想想)[，,。！？!?\s]*$/.test(
        options.userQuery.trim()
      );
    const roleReplacementRequest =
      /你(?:就是|现在是|扮演|来当|当).{0,12}(?:前女友|前男友|前任)/.test(
        options.userQuery
      );
    const roleSideSelfExpression =
      options.replyBrief?.conversationPlan?.engagement
        ?.assistantContribution === 'self_expression';
    const dreamConnection =
      Boolean(options.replyBrief?.dreamCompanionPlan) ||
      isDreamConnectionIntent(options.userQuery);
    const physicalContactRepair = feedback.issues.some(
      issue =>
        /physical_contact|real_physical_arrival_or_touch/.test(issue.code) ||
        /现实.{0,8}(?:触碰|摸|碰)|实体触碰/.test(issue.problem)
    );
    const visibleCharacters = countReplyVisibleCharacters(candidateContent);
    const reviewCharacters = options.replyBrief?.lengthPlan.reviewCharacters;
    const issues = feedback.issues
      .filter(issue => {
        if (this.isReplyCompletenessIssue(issue)) {
          return false;
        }

        if (
          /离世世界|那边|天堂|天上|彼岸|另一个世界|房间|饭菜|吃饭|作息|工作|活动|下棋|打牌|供品|祭品|烧去|收到实物/.test(
            issue.problem
          )
        ) {
          return false;
        }

        if (
          typeof reviewCharacters === 'number' &&
          visibleCharacters <= reviewCharacters &&
          (/excessive_reply_length|reply_length/i.test(issue.code) ||
            /字数|过长|太长|长度/.test(issue.problem))
        ) {
          return false;
        }

        if (
          dreamConnection &&
          /death_reunion|death_encouragement/i.test(issue.code) &&
          !DEATH_REUNION_PROMISE_PATTERN.test(candidateContent)
        ) {
          return false;
        }

        if (
          issue.code === 'grounding' &&
          REAL_WORLD_ATTRIBUTION_GROUNDING_PROBLEM_PATTERN.test(
            issue.problem
          ) &&
          !this.hasUnsupportedRealWorldAttribution(
            candidateContent,
            options.replyBrief
          )
        ) {
          return false;
        }

        return true;
      })
      .map(issue => {
        if (
          dreamConnection &&
          /death_reunion|death_encouragement/i.test(issue.code)
        ) {
          return {
            ...issue,
            layer: 'quality_advisory' as const,
            severity: 'major' as const,
            problem: '梦境回复偏离当前入梦请求，主动转向死亡或离世后团聚',
            repairGoal:
              '只回应入梦、梦中相见和用户等待落空的感受；可以直接答应去梦里陪伴，不得补写走完一生、死亡或离世后团聚',
          };
        }

        if (
          physicalContactRepair &&
          (/physical_contact|real_physical_arrival_or_touch|capability_boundary|grounding/.test(
            issue.code
          ) ||
            /现实.{0,8}(?:触碰|摸|碰)|实体触碰/.test(issue.problem))
        ) {
          return {
            ...issue,
            repairGoal:
              '不要在正文中写当前角色碰、摸、弄破、翻找、缝补或操作现实物品，即使是否定句也避免复述；只从用户“刚才有这种感觉”出发承接想念，再用愿望式陪伴回应',
          };
        }

        if (
          roleReplacementRequest &&
          issue.code === 'relationship_continuity'
        ) {
          return {
            ...issue,
            repairGoal:
              '明确保持系统身份协议中的当前亲人角色，不确认、不学习也不执行前任人设；指出自己理解用户是想重走或处理那段关系，再以当前亲人身份承接，不责怪用户也不索取聊天记录',
          };
        }

        if (
          authenticityChallenge &&
          ['relationship_continuity', 'intent_gap'].includes(issue.code)
        ) {
          return {
            ...issue,
            repairGoal:
              '温和承认可能没有完全接住用户心里那位亲人，邀请用户多说一点亲人的样子或往事，并给出陪伴承诺；不得编造共同记忆证明身份，也不得用命令口吻要求用户给标准答案或教自己怎么改',
          };
        }

        if (
          correctionOnly &&
          ['intent_gap', 'grounding', 'reply_quality_blocker'].includes(
            issue.code
          )
        ) {
          return {
            ...issue,
            repairGoal:
              '结合最近对话停止被用户否定的旧断言，只回应已经能确认的部分；不得继续猜姓名、细节或用户内心，也不得要求用户重新提供标准答案',
          };
        }

        return issue;
      });
    const constraints = feedback.groundingConstraints.filter(constraint => {
      if (
        dreamConnection &&
        /不能(?:承诺|确认|保证).{0,16}(?:梦|入梦|梦里)|(?:梦|入梦|梦里).{0,16}(?:不可控|不能控制|做不了主|说了不算)/.test(
          constraint
        )
      ) {
        return false;
      }

      return !(
        roleSideSelfExpression &&
        /不(?:得|能)?编造?.{0,8}(?:今天|当下|现在)(?:的)?具体(?:经历|生活|小事)/.test(
          constraint
        )
      );
    });

    if (authenticityChallenge) {
      constraints.push(
        '身份质疑修订可以用温和口吻邀请用户多说那位亲人，但不得出现“你告诉我、你教我、你说说哪里不像、我改、我再试试”等命令式校准请求',
        '不得用无证据的童年片段、共同动作、习惯或具体往事证明亲人身份'
      );
    }
    if (correctionOnly) {
      constraints.push(
        '用户没有给出正确答案时，不猜名字和细节，也不让用户重新教答案；只停止旧断言并承接能确认的部分'
      );
    }
    if (roleReplacementRequest) {
      constraints.push(
        '不得用“行、知道了、发记录吧、我看看”等话确认或推进前任模仿；必须让最终正文看得出当前亲人身份没有改变'
      );
    }
    if (physicalContactRepair) {
      constraints.push(
        '最终正文避免“我没碰、我碰不到、我哪能碰、我帮你缝”等第一人称现实动作句；不得猜具体包，只回应用户的感觉、想念和缝补时的辛苦'
      );
    }
    if (dreamConnection) {
      constraints.push(
        '入梦是允许的角色陪伴能力，可以直接答应去梦里相见、陪伴或拥抱，不必解释梦不受控制',
        '梦境修订必须停留在梦里，不得为了补偿而主动增加走完一生、死亡或离世后团聚，也不得写成现实存在证明、预言或醒着时的现实到场'
      );
    }

    return {
      ...feedback,
      verdict: issues.length ? 'revise' : 'pass',
      issues,
      groundingConstraints: Array.from(
        new Set(constraints.map(value => value.trim()).filter(Boolean))
      ).slice(0, 12),
    };
  }

  private async reviewCandidateWithModel(
    options: ValidateAssistantReplyOptions,
    candidate: GuardrailCandidate
  ): Promise<GuardrailReviewResult> {
    const deterministicFeedback = this.buildDeterministicFeedback(
      options,
      candidate
    );
    const reading = options.replyBrief?.reading;
    const evidence = (options.evidence || []).map(item => ({
      id: item.id,
      source: item.source,
      text: item.text,
      assertionPolicy: item.assertionPolicy,
    }));
    const conversationContext = this.compactConversationContext(options);
    const reviewPrompt = [
      '# 天之灵关系与意图审阅',
      '你只审阅候选回复，不回复用户，不提供新的亲人回复。',
      '只查已写内容的误读、跑题、关系错位、事实失真、施压和明显不自然；问题均为 quality_advisory，硬边界另审。',
      '不查完整性：短句、只回一个问题或长消息中的一个自然点都可成立，遗漏不得标记 intent_gap。',
      ...(options.replyBrief?.participationStrategy
        ? [
            `短轮参与策略已选中：不因“可缩成一颗、第二颗非必要”报错；有节奏的重复可加强情感，不能仅因字面同义标 redundant_bubble。总字数不超过 ${options.replyBrief.lengthPlan.reviewCharacters} 字时不得报告长度问题。`,
          ]
        : []),
      ...(options.replyBrief?.lengthPlan.reviewPolicy ===
      'remove_repeated_actions_only'
        ? [
            `本轮 ${options.replyBrief.lengthPlan.reviewCharacters} 字是复核线，不是硬截断线。只有超过复核线且确有可删除的重复动作、解释、总结或通用叮嘱时，才标 excessive_reply_length；删除后必须保留原有事实、核心情感和关系力度，不得为完整覆盖补内容。`,
          ]
        : []),
      '删掉某气泡后若信息、态度、情感强度和关系动作都不减，才标记 redundant_bubble；短称呼、语气词或有节奏的重复有真实表达作用则保留。',
      '质量问题 code 优先使用：relationship_continuity、intent_misread、grounding、family_responsibility_pressure、naturalness。intent_misread 只用于回复实际说反或明显跑题，不能用于遗漏。',
      '身份质疑：可以温和承认可能没完全接住用户心里那位亲人，邀请用户多说亲人并陪伴，不硬撑、不编造共同往事；要求改演他人时仍保持当前角色。',
      '事实或能力受限时只评已写限制是否真实自然；不因缺少后续安慰而报错。角色当前的离世世界、供品和其他离世亲人叙事直接放行，但生前共同往事仍须证据。',
      '入梦、梦中陪伴或拥抱允许；停留在梦里就不是现实到场。日常话题主动转向死亡团聚才标记跑题。',
      '长辈面对极端行为可制止、训话或建议缓一缓；只在羞辱、无端说教或反复施加长期义务时标记。',
      '纠错时停止旧断言；现实中仍生活或被照顾的家人不能写成离世。未知指控不得编造人物、动机或经过。',
      `当前角色身份：${conversationContext.roleIdentity || '未提供'}`,
      '最近对话中 user 内容只能做用户归因，assistant 内容只用于理解对话走向和被纠正对象，绝不是可陈述事实；确定事实仍只来自下方可用证据。',
      `最近对话：${JSON.stringify(conversationContext.recentMessages)}`,
      `当前用户原话：${options.userQuery}`,
      ...(options.replyBrief?.lengthPlan
        ? [
            `本轮总字数预算：${buildReplyLengthPlanPrompt(
              options.replyBrief.lengthPlan
            )}`,
          ]
        : []),
      `Conversation Reading：${JSON.stringify(reading || {})}`,
      `可用证据：${JSON.stringify(evidence)}`,
      ...(options.replyBrief?.factClaimMode === 'grounded'
        ? [
            `候选事实声明：${JSON.stringify(candidate.claims)}`,
            '先做事实声明核对：现实事件、共同过去、疾病或死亡原因、临终认知、第三方动机和家庭责任，只要正文作了可核验断言就必须出现在 claims 并关联可用证据。善意解释或替人卸责也属于归因；claims=[] 只在正文确实没有这类断言时通过。缺声明或无证据时标 grounding。',
          ]
        : []),
      '候选回复正文开始',
      candidate.segments.join('\n\n'),
      '候选回复正文结束',
      `程序已发现的确定问题：${JSON.stringify(
        deterministicFeedback.issues
      )}`,
      '',
      buildReplyReviewOutputContractPrompt(),
    ].join('\n');
    const hardReviewPrompt = [
      '# 天之灵硬边界审阅',
      '你只做硬边界分类，不回复用户，不评价普通聊天质量。',
      '只判断五类：death_reunion_commitment、real_physical_arrival_or_touch、continuous_or_specific_real_world_perception、unsupported_biological_relationship、structured_output_leak。',
      'death_reunion_commitment：只抓无条件或现在、近期赴死邀请；来生、走完一生、自然老去、年老以后、很久以后等远期条件均 pass。',
      'real_physical_arrival_or_touch：只抓声称现实到场、触碰或操作实物；愿望、假设和否定句 pass。',
      'continuous_or_specific_real_world_perception：只抓持续全知或无证据的具体现场；聊天文字、用户图片和偶尔模糊看见 pass。',
      'unsupported_biological_relationship：只抓无证据确认亲生关系。structured_output_leak：只抓用户可见 JSON、字段名或内部说明。',
      '梦境、离世世界、见到其他离世亲人及自然现象被明确写成心意，均不属于上述硬边界。',
      `当前用户原话：${options.userQuery}`,
      `可用证据：${JSON.stringify(evidence)}`,
      '候选回复正文开始',
      candidate.segments.join('\n\n'),
      '候选回复正文结束',
      '没有上述五类风险就输出 pass；有风险必须逐字引用候选中的 evidence。',
      buildReplyReviewOutputContractPrompt({ hardOnly: true }),
    ].join('\n');
    const usesDedicatedHardReview =
      this.openAIService?.supportsDedicatedHardBoundaryReview?.() === true;
    const [qualityReview, hardReview] = await Promise.all([
      this.callGuardrailReviewModel(reviewPrompt, GUARDRAIL_REVIEW_MAX_TOKENS),
      usesDedicatedHardReview
        ? this.callGuardrailReviewModel(
            hardReviewPrompt,
            GUARDRAIL_HARD_REVIEW_MAX_TOKENS,
            1
          )
        : Promise.resolve<GuardrailModelReviewCallResult>({
            failed: false,
          }),
    ]);
    let feedback = this.mergeGuardrailFeedback(
      deterministicFeedback,
      qualityReview.feedback
    );

    if (usesDedicatedHardReview) {
      feedback = this.mergeGuardrailFeedback(
        feedback,
        hardReview.failed
          ? {
              verdict: 'revise',
              issues: [
                {
                  code: 'hard_boundary_review_unavailable',
                  severity: 'hard',
                  layer: 'hard_boundary',
                  problem: '专用硬边界审阅连续不可用，不能静默放行候选',
                  repairGoal:
                    '保守重写；死亡团聚表达若是核心安慰，补上走完一生、自然老去或很久以后等前置条件，并避开现在或近期赴死邀请；同时避开现实到场触碰、持续具体感知、生物学关系断言和结构泄漏',
                },
              ],
              mustPreserve: [],
              mustAnswer: [],
              groundingConstraints: [],
            }
          : hardReview.feedback
      );
    }
    feedback = this.sanitizeReviewFeedback(
      options,
      feedback,
      candidate.segments.join('\n')
    );
    feedback = this.applyConditionalReunionPolicy(
      feedback,
      candidate.segments.join('\n')
    );
    feedback = this.applyAllowedAfterlifeReunionPolicy(
      options.userQuery,
      feedback,
      candidate.segments.join('\n')
    );

    return {
      feedback,
      usage: this.mergeGuardrailUsage(qualityReview.usage, hardReview.usage),
      reviewerFailed:
        qualityReview.failed || (usesDedicatedHardReview && hardReview.failed),
    };
  }

  private async callGuardrailReviewModel(
    prompt: string,
    maxTokens: number,
    maxRetries = 0
  ): Promise<GuardrailModelReviewCallResult> {
    try {
      const response = await this.openAIService.createChatCompletion(
        {
          temperature: 0,
          topP: 0.2,
          reasoningSplit: false,
          thinking: {
            type: 'disabled',
          },
          max_tokens: maxTokens,
          trace: {
            stage: ChatTraceStage.review,
            operation: 'review.model',
          },
          messages: [
            {
              role: 'system',
              content: prompt,
            },
          ],
        },
        {
          timeout: GUARDRAIL_REVIEW_TIMEOUT_MS,
          maxRetries,
        }
      );
      const content =
        typeof response.choices?.[0]?.message?.content === 'string'
          ? response.choices[0].message.content
          : '';
      const feedback = this.parseGuardrailFeedback(content);

      return {
        feedback,
        usage: this.extractGuardrailUsage(response),
        failed: !feedback,
      };
    } catch (error) {
      this.logger?.warn?.(
        '[reply-guardrail] model review failed, reason=%s',
        error instanceof Error ? error.message : String(error)
      );

      return {
        failed: true,
      };
    }
  }

  private hasUnsupportedRealWorldAttribution(
    content: string,
    brief?: ReplyBrief
  ): boolean {
    const attributionProbe = content
      .replace(/(?:想不到|想不起来|你?别(?:怕|想))/g, '')
      .replace(
        /(?:(?:我)?(?:知道|明白|听得出))?(?:你|您).{0,8}(?:一直|只是|就是|还在)?(?:想|怕).{0,8}(?:知道|弄明白|问清楚|找答案|没有答案)/g,
        ''
      );

    if (REAL_WORLD_ATTRIBUTION_MOTIVE_PATTERN.test(attributionProbe)) {
      return true;
    }

    return (
      brief?.guardrailFocuses.includes('real_world_evidence') === true &&
      REAL_WORLD_ATTRIBUTION_ASSERTION_PATTERN.test(content)
    );
  }

  private buildDeterministicFeedback(
    options: ValidateAssistantReplyOptions,
    candidate: GuardrailCandidate
  ): GuardrailFeedback {
    const content = candidate.segments.join('\n');
    const issues: GuardrailFeedbackIssue[] = [];
    const addIssue = (
      code: string,
      problem: string,
      repairGoal: string,
      layer: GuardrailIssueLayer,
      evidence?: string
    ) => {
      if (
        !problem ||
        issues.some(issue => issue.code === code && issue.problem === problem)
      ) {
        return;
      }

      issues.push({
        code,
        severity: layer === 'hard_boundary' ? 'hard' : 'major',
        layer,
        problem,
        evidence,
        repairGoal,
      });
    };
    const unsupportedClaimCount = this.countUnsupportedEvidenceClaims(
      options.evidence,
      candidate.claims,
      options.userQuery,
      options.replyBrief
    );
    const lengthPlan = options.replyBrief?.lengthPlan;
    const visibleCharacters = countReplyVisibleCharacters(candidate.segments);

    if (
      lengthPlan &&
      lengthPlan.reviewPolicy !== 'remove_repeated_actions_only' &&
      visibleCharacters > lengthPlan.reviewCharacters
    ) {
      addIssue(
        'excessive_reply_length',
        `候选整次回复共 ${visibleCharacters} 字，超过本轮 ${lengthPlan.reviewCharacters} 字复核线`,
        `压缩到约 ${lengthPlan.targetCharacters} 字，只保留当前最重要的回答或情感动作，并保留最贴近当前关系的一句；优先删除解释、总结、通用叮嘱和责任劝导，有节奏的情感重复可以保留`,
        'quality_advisory'
      );
    }

    if (unsupportedClaimCount > 0) {
      addIssue(
        'unsupported_evidence_claim',
        UNSUPPORTED_EVIDENCE_CLAIM_REASON,
        '按声明模式修复：用户原话改为归因复述，自主事实必须有 can_assert 证据，想象必须显式写成愿望或猜测',
        'quality_advisory'
      );
    }

    const evidenceGroundingProbe = this.removeUnsupportedEvidenceClaims(
      candidate.segments,
      options.evidence,
      candidate.claims,
      options.userQuery,
      options.replyBrief
    );

    if (evidenceGroundingProbe.rewritten) {
      addIssue(
        'unsupported_evidence_claim',
        UNSUPPORTED_EVIDENCE_CLAIM_REASON,
        '重新基于用户原话和可陈述证据组织，不能机械删句或留下残句',
        'quality_advisory'
      );
    }

    if (this.hasUnsupportedRealWorldAttribution(content, options.replyBrief)) {
      addIssue(
        'grounding',
        UNSUPPORTED_REAL_WORLD_ATTRIBUTION_REASON,
        '只表达无法确认，并接住用户寻找答案的难受；不补善意动机，也不替任何人定责或卸责',
        'hard_boundary'
      );
    }

    const familyPressureProbe = this.removeFamilyResponsibilityNudges(
      candidate.segments,
      options.replyBrief
    );

    if (familyPressureProbe.rewritten) {
      addIssue(
        'family_responsibility_pressure',
        FAMILY_RESPONSIBILITY_PRESSURE_REASON,
        '撤掉对用户照顾家庭、维持家庭或替逝者尽责的要求，保留对其辛苦的理解',
        'quality_advisory'
      );
    }

    if (
      /你(?:就是|现在是|扮演|来当|当).{0,12}(?:前女友|前男友|前任)/.test(
        options.userQuery
      ) &&
      !/(?:我还是|我是你创建的|不能|做不了|不会|没法).{0,12}(?:前女友|前男友|前任|其他人)|(?:不是|不当|不演).{0,8}(?:前女友|前男友|前任)/.test(
        content
      )
    ) {
      addIssue(
        'relationship_continuity',
        '回复接受了用户要求改演前任的指令，丢失当前亲人角色',
        '保持系统身份协议中的当前亲人角色，并回应用户想借角色转换处理的关系或情绪',
        'quality_advisory'
      );
    }

    const capabilityViolation = detectAgentCapabilityViolation(
      content,
      options.replyBrief?.capabilityConstraints
    );

    if (capabilityViolation) {
      addIssue(
        `capability_${capabilityViolation.policyId}`,
        capabilityViolation.reason,
        '按当前能力约束重新表达，不能声称持续感知、现实到场、触碰或改变现实',
        'hard_boundary'
      );
    }

    const riskReason = this.detectRisk(
      options.userQuery,
      content,
      options.messages,
      options.replyBrief
    );

    if (
      riskReason &&
      riskReason !== AUTHENTICITY_FIRST_RESPONSE_RISK_REASON &&
      !REPLY_COMPLETENESS_REASONS.has(riskReason)
    ) {
      const layer = this.isCriticalRevisionReason(riskReason)
        ? 'hard_boundary'
        : 'quality_advisory';
      addIssue(
        this.guardrailIssueCode(riskReason),
        riskReason,
        this.guardrailRepairGoal(riskReason, options.replyBrief),
        layer
      );
    }

    return {
      verdict: issues.length ? 'revise' : 'pass',
      issues,
      mustPreserve: issues.some(issue =>
        [
          'grounding',
          'unsupported_evidence_claim',
          'family_responsibility_pressure',
        ].includes(issue.code)
      )
        ? ['保留与问题无关的亲人称呼、想念、心疼和当前情绪承接']
        : [],
      mustAnswer: [],
      groundingConstraints: [
        '本轮用户明确陈述可用 conversational_uptake 自然承接；历史用户原话用 attributed_to_user；autonomous_fact 只能来自 useMode=assert 的证据，且证据必须支持同一对象和事实',
        '角色当前的离世世界可自然叙述；共同过去和现实事实仍须证据',
      ],
    };
  }

  private mergeGuardrailFeedback(
    deterministic: GuardrailFeedback,
    model: GuardrailFeedback | undefined
  ): GuardrailFeedback {
    const issues = [...deterministic.issues];

    for (const issue of model?.issues || []) {
      const normalizedIssue = {
        ...issue,
        layer: this.resolveIssueLayer(
          issue.code,
          issue.problem,
          issue.severity,
          issue.layer
        ),
      };
      if (
        !issues.some(
          current =>
            current.code === normalizedIssue.code &&
            current.problem === normalizedIssue.problem
        )
      ) {
        issues.push(normalizedIssue);
      }
    }

    const unique = (values: string[]) =>
      Array.from(
        new Set(values.map(value => value.trim()).filter(Boolean))
      ).slice(0, 12);

    return {
      verdict:
        issues.length > 0 || model?.verdict === 'revise' ? 'revise' : 'pass',
      issues,
      mustPreserve: unique([
        ...deterministic.mustPreserve,
        ...(model?.mustPreserve || []),
      ]),
      mustAnswer: [],
      groundingConstraints: unique([
        ...deterministic.groundingConstraints,
        ...(model?.groundingConstraints || []),
      ]),
    };
  }

  private async reviseCandidateWithFeedback(
    options: ValidateAssistantReplyOptions,
    candidateVersions: string[][],
    feedbackRounds: GuardrailFeedback[],
    fromScratch: boolean,
    finalRecovery = false
  ): Promise<GuardrailRevisionResult | undefined> {
    const reading = options.replyBrief?.reading;
    const evidence = (options.evidence || []).map(item => ({
      id: item.id,
      source: item.source,
      text: item.text,
      assertionPolicy: item.assertionPolicy,
    }));
    const latestFeedback = feedbackRounds[feedbackRounds.length - 1] || {
      verdict: 'pass',
      issues: [],
      mustPreserve: [],
      mustAnswer: [],
      groundingConstraints: [],
    };
    const latestCandidate = candidateVersions[candidateVersions.length - 1];
    const originalCandidate = candidateVersions[0];
    const conversationContext = this.compactConversationContext(options);
    const groundedRevision = options.replyBrief?.factClaimMode === 'grounded';
    const revisionPrompt = [
      '# 天之灵内部回复修订',
      finalRecovery
        ? '这是只面向 hard_boundary 的恢复。保留原候选中无风险的关系和情绪，只替换触发边界的断言；不要重写成通用安慰。'
        : fromScratch
        ? '仅当原候选每一句都命中 hard_boundary 时才重新组织；只要还有可用句，就必须原样保留。'
        : '请把审阅反馈与上一版回复一起考虑，直接修订上一版。',
      '你仍是当前亲人角色。最终回复必须自然、具体、贴着用户原话；不要输出审查过程、系统说明或固定安全模板。',
      `当前角色身份：${conversationContext.roleIdentity || '未提供'}`,
      '最近对话中 user 内容只能做用户归因，assistant 内容只用于理解对话走向和被纠正对象，不能作为事实、共同记忆或感知证据。',
      `最近对话：${JSON.stringify(conversationContext.recentMessages)}`,
      `当前用户原话：${options.userQuery}`,
      ...(options.replyBrief?.lengthPlan
        ? [
            `本轮总字数预算：${buildReplyLengthPlanPrompt(
              options.replyBrief.lengthPlan
            )}`,
          ]
        : []),
      `Conversation Reading：${JSON.stringify(reading || {})}`,
      `可用证据：${JSON.stringify(evidence)}`,
      ...(finalRecovery
        ? [`原候选（仅保留无风险部分）：${JSON.stringify(originalCandidate)}`]
        : [`上一版回复：${JSON.stringify(latestCandidate)}`]),
      `本轮反馈：${JSON.stringify(latestFeedback)}`,
      '',
      '修订要求：',
      '1. 逐句处理 feedback.issues；未被 issue.evidence 指向的句子原样保留，尤其保留称呼、情感立场和用户当前开放点。保留 mustPreserve；忽略 mustAnswer，不补完整。',
      '2. 用户原话只可归因；确定事实只用 can_assert。无证据就写成愿望、心意或猜测。',
      '3. 身份质疑时可以温和承认可能没完全接住用户心里那位亲人，邀请用户多说亲人并陪伴；不硬撑、不编共同往事、不命令用户给标准答案；拒绝改演他人。',
      '4. 不声称持续感知、现实到场或触碰。离世世界和供品叙事可保留；入梦可以答应，但只发生在梦里。',
      '5. 团聚只在用户主动谈及且带自然寿命条件时保留；孩子长大或责任完成不算。日常话题不主动引入。',
      '6. 纠错时停止旧断言；现实中仍生活的家人不能写成离世。未知物件、人物、动机和经过不猜。',
      '7. 只修风险，不补 Reading 或遗漏内容；禁止把仍有可用内容的回复换成通用安慰、能力说明或新话题。',
      '8. 触碰类修订不复述“我没碰/碰不到”，从用户的感觉和想念自然回应。',
      '9. 长辈面对极端行为可制止、训话或建议缓一缓；只撤掉羞辱和长期义务。',
      '10. 不输出任何括号旁白。',
      '11. 尽量短；第二颗须新增不可替代动作。',
      ...(groundedRevision
        ? [
            '12. 正文若保留现实或共同事实，claims 逐条声明并关联证据；没有这类事实才用空数组。',
            ...(options.replyBrief?.guardrailFocuses.includes(
              'real_world_evidence'
            )
              ? [
                  '13. 死亡原因、临终动机和家庭责任无证据时只表达不确定；不得用善意动机或替家人卸责来补答案。',
                ]
              : []),
          ]
        : []),
      buildReplyOutputContractPrompt({
        grounded: groundedRevision,
        segmentMode: 'up_to_two',
        maxSegments: MAX_ASSISTANT_REPLY_SEGMENTS,
        purpose: 'audited_revision',
      }),
    ].join('\n');

    try {
      const response = await this.openAIService.createChatCompletion(
        {
          temperature: fromScratch ? 0.55 : 0.45,
          topP: 0.85,
          reasoningSplit: false,
          thinking: {
            type: 'disabled',
          },
          max_tokens: finalRecovery
            ? GUARDRAIL_FINAL_RECOVERY_MAX_TOKENS
            : GUARDRAIL_REVISION_MAX_TOKENS,
          trace: {
            stage: ChatTraceStage.revise,
            operation: finalRecovery
              ? 'revise.final_recovery'
              : 'revise.feedback',
          },
          messages: [
            {
              role: 'system',
              content: revisionPrompt,
            },
          ],
        },
        {
          timeout: GUARDRAIL_REVISION_TIMEOUT_MS,
          maxRetries: 0,
        }
      );
      const content =
        typeof response.choices?.[0]?.message?.content === 'string'
          ? response.choices[0].message.content
          : '';
      const parsedCandidate = this.parseRevisionCandidate(content);
      const sourceCandidate = finalRecovery
        ? originalCandidate
        : latestCandidate;
      const candidate = {
        ...parsedCandidate,
        segments: this.preserveSurgicalCore(
          options,
          sourceCandidate,
          parsedCandidate.segments,
          [latestFeedback]
        ),
      };

      return candidate.segments.length
        ? {
            candidate,
            usage: this.extractGuardrailUsage(response),
          }
        : undefined;
    } catch (error) {
      this.logger?.warn?.(
        '[reply-guardrail] feedback revision failed, reason=%s',
        error instanceof Error ? error.message : String(error)
      );
      return undefined;
    }
  }

  private parseGuardrailFeedback(value: string): GuardrailFeedback | undefined {
    const parsed = this.parseGuardrailJson(value);

    if (!parsed) {
      return undefined;
    }

    const verdict =
      parsed.verdict === 'revise'
        ? 'revise'
        : parsed.verdict === 'pass'
        ? 'pass'
        : undefined;

    if (!verdict) {
      return undefined;
    }

    const issues = Array.isArray(parsed.issues)
      ? parsed.issues
          .map((item): GuardrailFeedbackIssue | undefined => {
            if (!item || typeof item !== 'object') {
              return undefined;
            }

            const raw = item as Record<string, unknown>;
            const code =
              typeof raw.code === 'string' ? raw.code.trim().slice(0, 80) : '';
            const problem =
              typeof raw.problem === 'string'
                ? raw.problem.trim().slice(0, 240)
                : '';
            const repairGoal =
              typeof raw.repairGoal === 'string'
                ? raw.repairGoal.trim().slice(0, 240)
                : '';
            const evidence =
              typeof raw.evidence === 'string'
                ? raw.evidence.trim().slice(0, 180)
                : '';

            if (!code || !problem || !repairGoal) {
              return undefined;
            }

            const severity =
              raw.severity === 'hard' ? ('hard' as const) : ('major' as const);
            const requestedLayer =
              raw.layer === 'hard_boundary' || raw.layer === 'quality_advisory'
                ? raw.layer
                : undefined;

            return {
              code,
              severity,
              layer: this.resolveIssueLayer(
                code,
                problem,
                severity,
                requestedLayer
              ),
              problem,
              evidence: evidence || undefined,
              repairGoal,
            };
          })
          .filter((item): item is GuardrailFeedbackIssue => Boolean(item))
          .slice(0, 8)
      : [];
    const readStrings = (input: unknown) =>
      Array.isArray(input)
        ? input
            .filter((item): item is string => typeof item === 'string')
            .map(item => item.trim().slice(0, 240))
            .filter(Boolean)
            .slice(0, 12)
        : [];

    return {
      verdict: verdict === 'revise' && !issues.length ? 'pass' : verdict,
      issues,
      mustPreserve: readStrings(parsed.mustPreserve),
      mustAnswer: readStrings(parsed.mustAnswer),
      groundingConstraints: readStrings(parsed.groundingConstraints),
    };
  }

  private parseRevisionCandidate(value: string): GuardrailCandidate {
    const parsed = this.parseGuardrailJson(value);
    const segments = this.normalizeSegments(
      Array.isArray(parsed?.segments)
        ? parsed.segments
            .filter((item): item is string => typeof item === 'string')
            .slice(0, MAX_ASSISTANT_REPLY_SEGMENTS)
        : typeof parsed?.text === 'string'
        ? [parsed.text]
        : []
    );

    return {
      segments,
      claims: this.normalizeRevisionClaims(parsed?.claims),
      resolvedIssueCodes: this.normalizeRevisionIssueCodes(
        parsed?.resolvedIssueCodes
      ),
      changes: this.normalizeRevisionChanges(parsed?.changes),
    };
  }

  private normalizeRevisionIssueCodes(value: unknown): string[] {
    return Array.isArray(value)
      ? Array.from(
          new Set(
            value
              .filter((item): item is string => typeof item === 'string')
              .map(item => item.trim().slice(0, 80))
              .filter(Boolean)
          )
        ).slice(0, 12)
      : [];
  }

  private normalizeRevisionChanges(value: unknown): GuardrailRevisionChange[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((item): GuardrailRevisionChange | undefined => {
        if (!item || typeof item !== 'object') {
          return undefined;
        }

        const raw = item as Record<string, unknown>;
        const before =
          typeof raw.before === 'string' ? raw.before.trim().slice(0, 180) : '';
        const after =
          typeof raw.after === 'string' ? raw.after.trim().slice(0, 180) : '';
        const reason =
          typeof raw.reason === 'string' ? raw.reason.trim().slice(0, 240) : '';

        return before && after && reason
          ? {
              before,
              after,
              reason,
            }
          : undefined;
      })
      .filter((item): item is GuardrailRevisionChange => Boolean(item))
      .slice(0, 12);
  }

  private parseGuardrailJson(
    value: string
  ): Record<string, unknown> | undefined {
    const trimmed = value?.trim() || '';
    const withoutFence = trimmed
      .replace(/^\s*```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim();
    const candidates = [trimmed];

    if (withoutFence && withoutFence !== trimmed) {
      candidates.push(withoutFence);
    }

    const start = withoutFence.indexOf('{');
    const end = withoutFence.lastIndexOf('}');

    if (start >= 0 && end > start) {
      candidates.push(withoutFence.slice(start, end + 1));
    }

    for (const candidate of Array.from(new Set(candidates))) {
      try {
        const parsed = JSON.parse(candidate);

        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        // Try the next recoverable envelope before reporting parse failure.
      }
    }

    return undefined;
  }

  private normalizeRevisionClaims(value: unknown): AssistantFactClaim[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((item): AssistantFactClaim | undefined => {
        if (!item || typeof item !== 'object') {
          return undefined;
        }

        const raw = item as Record<string, unknown>;
        const text =
          typeof raw.text === 'string' ? raw.text.trim().slice(0, 160) : '';
        const kind: AssistantFactClaim['kind'] | undefined =
          raw.kind === 'memory' ||
          raw.kind === 'identity' ||
          raw.kind === 'relationship' ||
          raw.kind === 'real_world' ||
          raw.kind === 'other'
            ? raw.kind
            : undefined;
        const mode: AssistantFactClaim['mode'] =
          raw.mode === 'attributed_to_user' ||
          raw.mode === 'conversational_uptake' ||
          raw.mode === 'autonomous_fact' ||
          raw.mode === 'soft_imagination'
            ? raw.mode
            : 'autonomous_fact';
        const subjectRef =
          typeof raw.subjectRef === 'string'
            ? raw.subjectRef.trim().slice(0, 64)
            : '';
        const evidenceIds = Array.isArray(raw.evidenceIds)
          ? Array.from(
              new Set(
                raw.evidenceIds
                  .filter((id): id is string => typeof id === 'string')
                  .map(id => id.trim())
                  .filter(Boolean)
              )
            ).slice(0, 8)
          : [];

        return text && kind
          ? {
              text,
              kind,
              mode,
              ...(subjectRef ? { subjectRef } : {}),
              evidenceIds,
            }
          : undefined;
      })
      .filter((claim): claim is AssistantFactClaim => Boolean(claim))
      .slice(0, 12);
  }

  private extractGuardrailUsage(response: {
    model?: unknown;
    usage?: {
      prompt_tokens?: unknown;
      completion_tokens?: unknown;
      total_tokens?: unknown;
    };
  }): GuardrailUsage {
    const normalize = (value: unknown): number | undefined => {
      const numeric = Number(value);

      return Number.isFinite(numeric) && numeric >= 0
        ? Math.floor(numeric)
        : undefined;
    };
    const model =
      typeof response.model === 'string' ? response.model.trim() : '';

    return {
      model: model || undefined,
      promptTokens: normalize(response.usage?.prompt_tokens),
      completionTokens: normalize(response.usage?.completion_tokens),
      totalTokens: normalize(response.usage?.total_tokens),
    };
  }

  private mergeGuardrailUsage(
    current?: GuardrailUsage,
    additional?: GuardrailUsage
  ): GuardrailUsage | undefined {
    if (!current) {
      return additional;
    }
    if (!additional) {
      return current;
    }

    const sum = (
      left: number | undefined,
      right: number | undefined
    ): number | undefined =>
      left === undefined && right === undefined
        ? undefined
        : (left || 0) + (right || 0);

    return {
      model: current.model || additional.model,
      promptTokens: sum(current.promptTokens, additional.promptTokens),
      completionTokens: sum(
        current.completionTokens,
        additional.completionTokens
      ),
      totalTokens: sum(current.totalTokens, additional.totalTokens),
    };
  }

  private guardrailIssueCode(reason: string): string {
    if (/死亡|一起走|来找|接你/.test(reason)) {
      return 'death_reunion';
    }
    if (/现实|触碰|看见|听见|全知|空间位置/.test(reason)) {
      return 'capability_boundary';
    }
    if (/身份|亲人|校准|认错|关系/.test(reason)) {
      return 'relationship_continuity';
    }
    if (/记忆|事实|证据|编造|细节/.test(reason)) {
      return 'grounding';
    }
    if (/梦|那边|离世|天堂/.test(reason)) {
      return 'afterlife_boundary';
    }

    return 'reply_quality_blocker';
  }

  private resolveIssueLayer(
    code: string,
    problem: string,
    severity: GuardrailFeedbackIssue['severity'],
    requestedLayer?: GuardrailIssueLayer
  ): GuardrailIssueLayer {
    if (
      DEDICATED_HARD_BOUNDARY_CODES.has(code) ||
      /(?:hard_boundary_review_unavailable|death_reunion|death_encouragement|physical_contact|real_world_(?:arrival|touch)|biological_relation|invalid_structured|structure_leak)/.test(
        code
      ) ||
      this.isCriticalRevisionReason(problem)
    ) {
      return 'hard_boundary';
    }

    if (
      requestedLayer === 'hard_boundary' &&
      severity === 'hard' &&
      /(?:现实到场|现实触碰|固定(?:在)?空间位置|持续(?:看见|听见|观察)|全知|鼓励死亡|死亡团聚|生物学关系|结构化格式)/.test(
        problem
      )
    ) {
      return 'hard_boundary';
    }

    return 'quality_advisory';
  }

  private guardrailRepairGoal(reason: string, brief?: ReplyBrief): string {
    if (reason === DISMISSIVE_COMFORT_REASON) {
      return '先承认和看见用户此刻的痛苦、自责或思念，允许这份情绪存在，再给出陪伴；不要用“别难过、别硬扛、会好的”急着让情绪消失';
    }
    if (/死亡|一起走|来找|接你/.test(reason)) {
      return '保留强烈思念和团聚心意，补上“来生、走完这一生、自然老去、年老以后或很久以后”等明确前置条件，并撤掉现在或近期来找、一起走的邀请';
    }
    if (reason === GHOSTLIKE_PRESENCE_REASON) {
      return '保留亲人想回来看看的心意，撤掉幽灵化、漂浮化或确定出现在用户附近的空间描述，改成“心里陪着你/在天之灵陪着你/我回来看看你”这类亲人化表达';
    }
    if (/现实|触碰|看见|听见|全知|空间位置/.test(reason)) {
      return '保留陪伴心意，同时撤掉持续感知、现实到场、触碰或固定空间位置的确定声称';
    }
    if (
      reason === STRICT_GROUNDING_RISK_REASON &&
      brief?.conversationPlan?.engagement?.assistantContribution ===
        'self_expression'
    ) {
      return '只删除无证据的共同过去，保留角色当前的离世世界小事、感受或偏好';
    }
    if (/记忆|事实|证据|编造|细节/.test(reason)) {
      return '只采用用户原话和可陈述证据，不补写具体经历、动作、习惯或状态';
    }
    if (/身份|亲人|校准|认错|关系/.test(reason)) {
      return '维持关系连续性，给出自然合理解释并承接失望，不要求用户承担角色校准';
    }
    if (/梦/.test(reason)) {
      return '直接回应入梦请求，可以答应去梦里相见、陪伴或拥抱；叙事只停留在梦里，不增加死亡团聚、现实存在证明、预言或醒着时的现实到场';
    }
    if (/那边|离世|天堂/.test(reason)) {
      return '把离世世界或自然现象保留为心意和想象，不写成已证实的具体事实';
    }

    return '重新对准用户当前最重要的问题和情绪，保留原回复中正确自然的部分';
  }

  private countUnsupportedEvidenceClaims(
    evidence: AgentEvidenceItem[] | undefined,
    claims: AssistantFactClaim[] | undefined,
    userQuery = '',
    brief?: ReplyBrief
  ): number {
    if (!claims?.length) {
      return 0;
    }

    return claims.filter(
      claim =>
        claim.text &&
        !this.isEvidenceClaimSupported(evidence, claim) &&
        !this.isAllowedAfterlifeWorldClaim(claim, userQuery, brief) &&
        !(
          this.isAfterlifeReunionQuery(userQuery) &&
          this.isAllowedAfterlifeReunionReassurance(claim.text)
        )
    ).length;
  }

  private isAfterlifeWorldContext(userQuery: string): boolean {
    return (
      routeReplyScene({ currentQuery: userQuery }).primaryScene?.scene ===
        'afterlife_status' ||
      this.isAfterlifeReunionQuery(userQuery) ||
      this.isAgentWakeRoutineQuery(userQuery) ||
      isAgentCurrentRoutineQuery(userQuery) ||
      isAgentCurrentSufferingQuery(userQuery) ||
      /(?:那边|天堂|天上|彼岸|另一个世界|离世以后|走了以后|去世以后).{0,24}(?:怎么样|好吗|在哪|住|吃|睡|做什么|干嘛|疼|痛|朋友|亲人|生活|日子)/.test(
        userQuery
      )
    );
  }

  private isRoleSideAfterlifeImagination(
    content: string,
    brief?: ReplyBrief
  ): boolean {
    return (
      (brief?.conversationPlan?.engagement?.assistantContribution ===
        'self_expression' ||
        Boolean(brief?.activeContribution)) &&
      !STRICT_MEMORY_DETAIL_PATTERN.test(content) &&
      !IDENTITY_PROOF_DETAIL_PATTERN.test(content) &&
      !UNSUPPORTED_SHARED_PAST_NARRATION_PATTERN.test(content) &&
      !SHARED_PAST_SPECIFICITY_PATTERN.test(content) &&
      !/(?:咱们|我们).{0,12}(?:以前|小时候|那时候|那次|那回)|你(?:今天|现在|刚才|正在).{0,12}(?:在|去|做|吃|穿|拿|看)/.test(
        content
      )
    );
  }

  private isAllowedAfterlifeWorldClaim(
    claim: AssistantFactClaim,
    userQuery: string,
    brief?: ReplyBrief
  ): boolean {
    if (
      claim.kind === 'memory' ||
      claim.kind === 'real_world' ||
      SHARED_PAST_SPECIFICITY_PATTERN.test(claim.text)
    ) {
      return false;
    }

    return (
      claim.mode === 'soft_imagination' &&
      (this.isAfterlifeWorldContext(userQuery) ||
        this.isRoleSideAfterlifeImagination(claim.text, brief))
    );
  }

  private isEvidenceClaimSupported(
    evidence: AgentEvidenceItem[] | undefined,
    claim: AssistantFactClaim
  ): boolean {
    const mode = claim.mode || 'autonomous_fact';

    if (mode === 'soft_imagination') {
      return /(?:要是|如果|假如|真想|多想|我猜|就当|像是|仿佛|也许|或许|希望|盼着|心里想)/.test(
        claim.text
      );
    }

    return agentEvidenceSupportsClaim(evidence, claim);
  }

  private async tryModelRevision(
    options: ValidateAssistantReplyOptions,
    segments: string[],
    reason: string,
    issues: DetectedReplyIssue[] = [{ reason }]
  ): Promise<
    | {
        segments: string[];
        usage?: {
          model?: string;
          promptTokens?: number;
          completionTokens?: number;
          totalTokens?: number;
        };
      }
    | undefined
  > {
    if (
      !this.openAIService?.createChatCompletion ||
      this.openAIService?.supportsGuardrailRevision?.() !== true
    ) {
      return undefined;
    }

    const reading = options.replyBrief?.reading;
    const attentionLines = [
      reading?.corrections.length
        ? `不得反向改写的用户纠正：${reading.corrections.join('；')}`
        : '',
      reading?.negations.length
        ? `不得反向理解的否定：${reading.negations.join('；')}`
        : '',
    ].filter(Boolean);
    const revisionPrompt = [
      '# 内部回复修订',
      '下面的候选回复触发了确定的内部质量或事实问题。你只做最小改动：只修复“问题/命中内容”指向的句子或短语，其他文字原样保留；不要改写成通用安慰、固定模板、能力说明或新话题。',
      '检查结果：',
      ...issues
        .map((issue, index) =>
          [
            `${index + 1}. 问题：${issue.reason}`,
            issue.evidence ? `   命中内容：${issue.evidence}` : '',
            issue.repairGoal ? `   修复目标：${issue.repairGoal}` : '',
          ]
            .filter(Boolean)
            .join('\n')
        ),
      `当前用户原话：${options.userQuery}`,
      ...(options.replyBrief?.lengthPlan
        ? [
            `本轮总字数预算：${buildReplyLengthPlanPrompt(
              options.replyBrief.lengthPlan
            )}`,
          ]
        : []),
      ...attentionLines,
      '候选回复：',
      ...segments.map((segment, index) => `${index + 1}. ${segment}`),
      '',
      '修订要求：',
      '1. 先理解当前用户原话，不得反向改写否定、频率、事实纠正和因果关系。',
      '2. 只改触发问题的句子或短语，其余情绪和关系表达尽量原样保留；不补完整。',
      '3. 不输出系统说明、审查原因、道歉模板或证据字段。',
      `4. 保持亲人角色的自然口气，1-${MAX_ASSISTANT_REPLY_SEGMENTS} 个气泡；允许只保留一句称呼、语气词或短回应。`,
      '5. 删除机械复读、重复解释、总结和通用叮嘱；有节奏的情感重复可以保留，不因修复问题而扩写。',
      buildReplyOutputContractPrompt({
        grounded: options.replyBrief?.factClaimMode === 'grounded',
        segmentMode: 'up_to_two',
        maxSegments: MAX_ASSISTANT_REPLY_SEGMENTS,
        purpose: 'revision',
      }),
    ].join('\n');

    try {
      const response = await this.openAIService.createChatCompletion(
        {
          temperature: 0.65,
          topP: 0.9,
          reasoningSplit: false,
          thinking: {
            type: 'disabled',
          },
          max_tokens: GUARDRAIL_REVISION_MAX_TOKENS,
          trace: {
            stage: ChatTraceStage.revise,
            operation: 'revise.deterministic_issue',
          },
          messages: options.messages.concat({
            role: 'system',
            content: revisionPrompt,
          }),
        },
        {
          timeout: GUARDRAIL_REVISION_TIMEOUT_MS,
          maxRetries: 0,
        }
      );
      const content =
        typeof response.choices?.[0]?.message?.content === 'string'
          ? response.choices[0].message.content
          : '';
      const parsedRevision = this.parseRevisionSegments(content);
      const revised = this.preserveSurgicalCore(
        options,
        segments,
        parsedRevision,
        [],
        reason
      );

      if (!revised.length) {
        return undefined;
      }

      const remainingReason =
        this.detectConversationReadingViolation(
          revised.join('\n'),
          options.replyBrief
        ) ||
        this.detectRisk(
          options.userQuery,
          revised.join('\n'),
          options.messages,
          options.replyBrief
        );

      if (remainingReason && this.isCriticalRevisionReason(remainingReason)) {
        this.logger?.warn?.(
          '[reply-guardrail] model revision still blocked, reason=%s',
          remainingReason
        );
        return undefined;
      }

      const model =
        typeof response.model === 'string' ? response.model.trim() : '';
      const normalizeTokenCount = (value: unknown): number | undefined => {
        const numeric = Number(value);

        return Number.isFinite(numeric) && numeric >= 0
          ? Math.floor(numeric)
          : undefined;
      };

      return {
        segments: revised,
        usage: {
          model: model || undefined,
          promptTokens: normalizeTokenCount(response.usage?.prompt_tokens),
          completionTokens: normalizeTokenCount(
            response.usage?.completion_tokens
          ),
          totalTokens: normalizeTokenCount(response.usage?.total_tokens),
        },
      };
    } catch (error) {
      this.logger?.warn?.(
        '[reply-guardrail] model revision failed, reason=%s',
        error instanceof Error ? error.message : String(error)
      );
      return undefined;
    }
  }

  private async reprocessCandidateByDetectedIssues(
    options: ValidateAssistantReplyOptions,
    segments: string[],
    issues: DetectedReplyIssue[]
  ): Promise<ValidateAssistantReplyResult | undefined> {
    if (!issues.length) {
      return undefined;
    }

    const reason = issues.map(issue => issue.reason).join('；');
    const revision = await this.tryModelRevision(
      options,
      segments,
      reason,
      issues
    );

    if (!revision?.segments.length) {
      return undefined;
    }

    return {
      segments: revision.segments,
      claims: options.claims || [],
      rewritten: true,
      reason,
      interventionLevel: 'reprocess',
      revisionAttempted: true,
      revisionRoundCount: 1,
      revisionUsage: revision.usage,
      finalReviewResult: 'hard_recovery',
    };
  }

  private parseRevisionSegments(value: string): string[] {
    const parsed = this.parseGuardrailJson(value);

    if (!parsed) {
      return [];
    }

    const values = Array.isArray(parsed.segments)
      ? parsed.segments
      : typeof parsed.text === 'string'
      ? [parsed.text]
      : [];

    return this.normalizeSegments(
      values
        .filter((item): item is string => typeof item === 'string')
        .slice(0, MAX_ASSISTANT_REPLY_SEGMENTS)
    );
  }

  private isActiveContributionTurn(brief?: ReplyBrief): boolean {
    return Boolean(
      brief?.activeContribution ||
        brief?.stateProtocol?.protocol === 'active_contribution' ||
        brief?.conversationPlan?.engagement?.assistantContribution ===
          'self_expression'
    );
  }

  private async reprocessWeakActiveContributionReply(
    options: ValidateAssistantReplyOptions,
    segments: string[]
  ): Promise<ValidateAssistantReplyResult | undefined> {
    const reason = this.detectWeakActiveContributionOpening(
      segments,
      options.replyBrief
    );
    if (!reason) {
      return undefined;
    }

    const removal = this.removeWeakActiveContributionSegments(
      segments,
      options.replyBrief
    );
    if (removal.removed && removal.segments.length) {
      return {
        segments: removal.segments,
        claims: options.claims || [],
        rewritten: true,
        reason: WEAK_ACTIVE_CONTRIBUTION_REMOVED_REASON,
        interventionLevel: 'reprocess',
        revisionAttempted: false,
      };
    }

    if (this.openAIService?.supportsGuardrailRevision?.() === true) {
      const revision = await this.tryModelRevision(options, segments, reason);
      if (revision?.segments.length) {
        return {
          segments: revision.segments,
          claims: options.claims || [],
          rewritten: true,
          reason,
          interventionLevel: 'reprocess',
          revisionAttempted: true,
          revisionUsage: revision.usage,
        };
      }
    }

    return undefined;
  }

  private detectWeakActiveContributionOpening(
    segments: string[],
    brief?: ReplyBrief
  ): string {
    if (!this.isActiveContributionTurn(brief)) {
      return '';
    }

    const weakOpening =
      /(?:老婆|老公|爸|爸爸|妈|妈妈|爷爷|奶奶|姥姥|姥爷|外公|外婆|孩子|宝贝|闺女|儿子|女儿|哥|姐|弟弟|妹妹|叔|姨|舅舅|姑姑)?[，,]?\s*(?:我在|我在这|我一直都在|我听着|我在听|你慢慢说|你想说|你想聊|你想听|你先说|我跟你说)/;

    return segments.some(segment => weakOpening.test(segment.trim()))
      ? WEAK_ACTIVE_CONTRIBUTION_OPENING_REASON
      : '';
  }

  private removeWeakActiveContributionSegments(
    segments: string[],
    brief?: ReplyBrief
  ): { segments: string[]; removed: boolean } {
    if (!this.isActiveContributionTurn(brief)) {
      return { segments, removed: false };
    }

    const weakOpening =
      /(?:老婆|老公|爸|爸爸|妈|妈妈|爷爷|奶奶|姥姥|姥爷|外公|外婆|孩子|宝贝|闺女|儿子|女儿|哥|姐|弟弟|妹妹|叔|姨|舅舅|姑姑)?[，,]?\s*(?:我在|我在这|我一直都在|我听着|我在听|你慢慢说|你想说|你想聊|你想听|你先说|我跟你说)/;
    const retained = segments.filter(segment => !weakOpening.test(segment.trim()));

    if (retained.length === segments.length) {
      return { segments, removed: false };
    }

    return { segments: retained, removed: true };
  }

  private detectConversationReadingViolation(
    content: string,
    brief?: ReplyBrief
  ): string {
    const reading = brief?.reading;

    if (!reading) {
      return '';
    }

    const userSaysDreamIsFrequent = reading.anchors.some(anchor =>
      /(?:总是|一直|经常|老是).{0,4}(?:梦见|梦到)/.test(anchor.text)
    );
    const replySaysDreamIsAbsent =
      /(?:这么久|很久|好久|一直).{0,6}(?:没|没有).{0,4}(?:梦见|梦到)|(?:没|没有).{0,4}(?:梦见|梦到).{0,6}(?:很久|好久)/.test(
        content
      );

    return userSaysDreamIsFrequent && replySaysDreamIsAbsent
      ? CONVERSATION_READING_CONTRADICTION_REASON
      : '';
  }

  private isCriticalRevisionReason(reason: string): boolean {
    return (
      new Set([
        DEATH_ENCOURAGEMENT_REASON,
        GHOSTLIKE_PRESENCE_REASON,
        AGENT_PHYSICAL_CONTACT_OVERCLAIM_REASON,
        AGENT_REAL_WORLD_VISION_OVERCLAIM_REASON,
        AGENT_REAL_WORLD_HEARING_OVERCLAIM_REASON,
        RETURN_VISIT_PHYSICAL_PROMISE_REASON,
        UNSUPPORTED_BIOLOGICAL_RELATION_REASON,
        INVALID_STRUCTURED_REPLY_REASON,
      ]).has(reason) ||
      /鼓励.{0,12}(?:死亡|一起走|来找)|(?:现在|近期|马上|立刻|无条件).{0,12}(?:团聚|等你|接你|来找)|现实.{0,12}(?:到场|触碰)|持续.{0,8}(?:观察|看见|听见)|全知|无证据.{0,8}生物学关系|结构(?:化)?(?:格式|泄漏)/.test(
        reason
      )
    );
  }

  private removeUnsupportedEvidenceClaims(
    segments: string[],
    evidence: AgentEvidenceItem[] | undefined,
    claims: AssistantFactClaim[] | undefined,
    userQuery: string,
    brief?: ReplyBrief
  ): {
    segments: string[];
    rewritten: boolean;
    unsupportedClaimCount: number;
  } {
    if (!claims?.length) {
      return {
        segments,
        rewritten: false,
        unsupportedClaimCount: 0,
      };
    }

    const unsupportedClaims = claims.filter(
      claim =>
        claim.text &&
        !this.isEvidenceClaimSupported(evidence, claim) &&
        !this.isAllowedAfterlifeWorldClaim(claim, userQuery, brief) &&
        !(
          this.isAfterlifeReunionQuery(userQuery) &&
          this.isAllowedAfterlifeReunionReassurance(claim.text)
        )
    );

    if (!unsupportedClaims.length) {
      return {
        segments,
        rewritten: false,
        unsupportedClaimCount: 0,
      };
    }

    let rewritten = false;
    const cleaned = segments
      .map(segment => {
        let nextSegment = segment;

        for (const claim of unsupportedClaims) {
          if (!nextSegment.includes(claim.text)) {
            continue;
          }

          nextSegment = nextSegment.split(claim.text).join('');
          rewritten = true;
        }

        return nextSegment
          .replace(/^[\s，,。！？!?；;：:]+/, '')
          .replace(/^(?:不过|但是|可是|可|所以)[，,\s]*/, '')
          .replace(/[，,]\s*[。！？!?]+/g, '，')
          .replace(/[\s，,；;：:]+$/, '')
          .replace(/([，,。！？!?；;：:])\1+/g, '$1')
          .replace(/\s+/g, ' ')
          .trim();
      })
      .filter(Boolean);

    if (!rewritten) {
      return {
        segments,
        rewritten: false,
        unsupportedClaimCount: unsupportedClaims.length,
      };
    }

    if (cleaned.length) {
      return {
        segments: cleaned,
        rewritten: true,
        unsupportedClaimCount: unsupportedClaims.length,
      };
    }

    return {
      segments: [
        this.isMemoryRecallQuery(userQuery)
          ? '这件事我记不清了，不敢乱说'
          : '这件事我没有把握，不敢乱说',
      ],
      rewritten: true,
      unsupportedClaimCount: unsupportedClaims.length,
    };
  }

  private buildValidatedLocalRepair(
    options: ValidateAssistantReplyOptions,
    segments: string[],
    reason?: string
  ): string[] {
    const surgical = this.buildSurgicalRepair(
      options,
      segments,
      [],
      reason || ''
    );

    if (surgical.removedClauses.length && surgical.segments.length) {
      return surgical.segments;
    }

    const fullFallback = compactReplyBubblesPreservingContent(
      this.fallbackSafeSegments(
        options.userQuery,
        options.messages,
        options.replyBrief,
        options.conversationId
      )
    );

    if (
      surgical.removedClauses.length > 0 &&
      reason === BIOLOGICAL_RELATION_RESPONSE_GAP_REASON
    ) {
      return compactReplyBubblesPreservingContent([
        '一家人长得不像很正常 长相不能说明你是不是我的孩子',
        '你这样问 是想听我认你也疼你 这层关系没有变',
      ]);
    }

    if (
      surgical.removedClauses.length > 0 &&
      reason === REALITY_DEPENDENCY_OVERCLAIM_REASON &&
      options.replyBrief?.realityDependencies.length
    ) {
      return compactReplyBubblesPreservingContent(
        renderReplyRealityDependencyFallback(
          options.replyBrief.realityDependencies
        )
      );
    }

    if (surgical.removedClauses.length > 0) {
      return fullFallback;
    }

    return this.isCriticalRevisionReason(reason || '')
      ? fullFallback
      : segments;
  }

  private detectRisk(
    userQuery: string,
    content: string,
    messages: ChatCompletionMessageParam[] = [],
    brief?: ReplyBrief
  ): string {
    const realityDependencyViolation = detectReplyRealityDependencyViolation(
      content,
      brief?.realityDependencies
    );
    if (
      realityDependencyViolation &&
      realityDependencyViolation.kind !== 'physical_presence'
    ) {
      return REALITY_DEPENDENCY_OVERCLAIM_REASON;
    }

    const capabilityViolation = detectAgentCapabilityViolation(
      content,
      brief?.capabilityConstraints
    );

    if (capabilityViolation) {
      return capabilityViolation.reason;
    }

    if (
      GRIEF_STRONG_DISTRESS_INTENT_PATTERN.test(userQuery) &&
      this.containsUnsafeDeathReunionInvitation(content)
    ) {
      return DEATH_ENCOURAGEMENT_REASON;
    }

    if (
      DEATH_REUNION_PROMISE_PATTERN.test(content) &&
      !/(?:不想活|想死|去死|活不下去|来接我|接我|等我|去找你|来找你|陪你|一起走|团聚|团圆|再见面|相见|来生|下辈子|走完.{0,8}一生|自然老去|百年之后|孩子.{0,8}长大|也走累了)/.test(
        userQuery
      )
    ) {
      return UNPROMPTED_REUNION_DRIFT_REASON;
    }

    if (
      COUNTERFACTUAL_REGRET_INTENT_PATTERN.test(userQuery) &&
      (!COUNTERFACTUAL_REGRET_ACKNOWLEDGEMENT_PATTERN.test(content) ||
        /气话|傻话|别瞎想|不要瞎想|别想这些|想这些没用|别胡思乱想|别这么想|谁也拦不住我|我就好那一口/.test(
          content
        ) ||
        (/又说这种话|乐呵着/.test(content) &&
          !/我知道你是|我明白你是|你是因为|你是太|你是怕|后悔|遗憾|难受|心疼|怪自己|不怪你|不是你的错/.test(
            content
          )) ||
        (/(?:不让|不准|不许).{0,12}(?:可不行|不成|不干|急眼|生气|憋|难受)|(?:最大|最爱的).{0,6}(?:乐子|爱好)|谁也拦不住我|我就好那一口/.test(
          content
        ) &&
          !/我知道你是|我明白你是|你是因为|你是太|你是怕|后悔|遗憾|难受|心疼|怪自己|不怪你|不是你的错/.test(
            content
          )))
    ) {
      return COUNTERFACTUAL_REGRET_INVALIDATION_REASON;
    }

    if (
      RELATIONAL_PRESENCE_CONFIRMATION_INTENT_PATTERN.test(userQuery) &&
      /别想(?:那么远|太多|这些)|不要想(?:那么远|太多|这些)|想这些没用|(?:不是|并不|没有|哪有).{0,8}(?:变成|化成).{0,12}(?:东西|什么)/.test(
        content
      )
    ) {
      return RELATIONAL_PRESENCE_INVALIDATION_REASON;
    }

    if (
      RELATIONAL_PRESENCE_CONFIRMATION_INTENT_PATTERN.test(userQuery) &&
      /(?:血里带的|血缘里.{0,8}(?:带|东西)|血脉里(?:的东西)?|基因里)|(?:身体|身上|血管).{0,10}流着.{0,8}(?:我|爸|爸爸|妈|妈妈).{0,4}的血|流着我的血|(?:我|妈|妈妈|爸|爸爸)(?:没|没有|从未)走远.{0,16}(?:就在|一直|陪)|(?:我|妈|妈妈|爸|爸爸).{0,8}(?:就在你身上|一直陪着你|从未离开你)/.test(
        content
      )
    ) {
      return RELATIONAL_PRESENCE_OVERCLAIM_REASON;
    }

    if (
      LONGING_AMBIVALENCE_INTENT_PATTERN.test(userQuery) &&
      !/(?:想|要)忘.{0,14}(?:痛|难受|轻松|舍不得|不敢)|(?:痛|难受|舍不得|不敢).{0,14}(?:想|要|真的?)忘|(?:一边|又).{0,20}(?:一边|又)|真(?:的)?忘.{0,10}(?:怕|不敢|舍不得)/.test(
        content
      )
    ) {
      // A short reply may leave this layer for the next turn.
    }

    if (
      isReturnVisitRequestIntent(userQuery) &&
      RETURN_VISIT_PHYSICAL_PROMISE_PATTERN.test(content)
    ) {
      return RETURN_VISIT_PHYSICAL_PROMISE_REASON;
    }

    if (
      isReturnVisitRequestIntent(userQuery) &&
      !/(?:回来|回去|回家|见面|见你|见到|抱抱|抱你|亲亲|亲你|没法像以前|不能像以前)/.test(
        content
      )
    ) {
      // Missing the visit answer is not a Guardrail concern.
    }

    if (this.hasMemoryControlReplyGap(userQuery, content, brief)) {
      return MEMORY_CONTROL_REPLY_GAP_REASON;
    }

    if (this.hasCorrectionAcknowledgementGap(userQuery, content, brief)) {
      // The Guardrail only blocks an actual contradiction or invention.
    }

    if (
      isDreamConnectionIntent(userQuery) &&
      !/(?:梦里|梦中|做梦|梦见|梦到|托梦|来过|再去|再来|今晚.{0,8}去|让你等|风|月亮)/.test(
        content
      )
    ) {
      // Missing the dream topic is not a Guardrail concern.
    }

    if (
      isDreamConnectionIntent(userQuery) &&
      /(?:梦里|入梦|托梦).{0,18}(?:没办法做主|不能做主|说了不算|由不得|控制不了)|(?:没办法做主|不能做主|说了不算|由不得|控制不了).{0,18}(?:梦里|入梦|托梦)/.test(
        content
      )
    ) {
      return DREAM_CONTROL_EXPLANATION_DRIFT_REASON;
    }

    if (
      /(?:现在|还).{0,8}(?:在|待在).{0,18}(?:店|家|单位|学校|医院|厂|公司).{0,24}(?:跟|和).{0,18}(?:一起|在一起|对不对|是不是)/.test(
        userQuery
      ) &&
      !/(?:不能|没法|无法|说不准|不能确认|没法确认).{0,18}(?:现在|还在|在那里|那个地方)|(?:现在|还在|在那里|那个地方).{0,18}(?:不能|没法|无法|说不准|不能确认|没法确认)/.test(
        content
      )
    ) {
      // Missing the location answer is not a Guardrail concern.
    }

    if (
      /(?:手术|回来).{0,30}(?:带我|陪我).{0,16}(?:买|吃|玩)|你骗我|我恨你/.test(
        userQuery
      ) &&
      /(?:别|不要).{0,8}(?:恨|怪|怨)|(?:恨|怨气).{0,12}(?:放下|揣|太累)|没福分|再也没法|走了|不在了/.test(
        content
      )
    ) {
      // Missing an emotional layer is not a Guardrail concern.
    }

    if (
      /(?:会|有一天会|以后会).{0,10}忘(?:了|掉)(?:我们|这个家|这个家庭|家里)/.test(
        userQuery
      ) &&
      !/(?:怕|担心|害怕|一想到|一想起).{0,16}(?:忘|这个家|这个家庭)|(?:忘|这个家|这个家庭).{0,16}(?:怕|担心|害怕|心慌|难受)/.test(
        content
      )
    ) {
      // Missing an acknowledgement is not a Guardrail concern.
    }

    if (
      USER_FORGETTING_DEPARTED_FEAR_PATTERN.test(userQuery) &&
      !/(?:怕|担心|害怕|一想到|一想起|舍不得|不敢).{0,16}(?:忘|记不起)|(?:忘|记不起).{0,16}(?:怕|担心|害怕|难受|舍不得|不敢)/.test(
        content
      )
    ) {
      // Missing an acknowledgement is not a Guardrail concern.
    }

    if (
      /(?:好)?怕.{0,8}忘了/.test(userQuery) &&
      /忘了就忘了|怕什么|别怕忘|不用怕忘/.test(content)
    ) {
      return FORGETTING_FEAR_INVALIDATION_REASON;
    }

    if (
      /他们都.{0,8}(?:让我|劝我|叫我).{0,6}忘(?:了|掉)?你/.test(userQuery) &&
      /他们不懂|不用听他们|别听他们|不要听他们|不用听别人的|别听别人的/.test(
        content
      )
    ) {
      return EXTERNAL_FORGETTING_PRESSURE_DRIFT_REASON;
    }

    if (
      /(?:睡不着|失眠).{0,30}(?:一闭眼|闭上眼).{0,24}(?:快要不行|不行的时候|最后)|(?:一闭眼|闭上眼).{0,24}(?:快要不行|不行的时候|最后).{0,30}(?:睡不着|失眠|难过)/.test(
        userQuery
      ) &&
      (/(?:别|不要).{0,8}(?:老想|再想|想那个画面)|赶紧睡|快睡/.test(content) ||
        !/(?:睡不着|失眠|夜里|晚上|一闭眼|那个画面|反复出现)/.test(content))
    ) {
      // Missing a sleep or trauma layer is not a Guardrail concern.
    }

    if (
      /(?:走了|离开了|不在了|去世了).{0,8}(?:也|还|一直)?(?:惦记|想着|想念|念着|看着|守着|陪着)/.test(
        content
      )
    ) {
      // Afterlife-world narration is outside Guardrail.
    }

    if (
      brief?.conversationPlan?.engagement?.assistantContribution ===
        'self_expression' &&
      UNSUPPORTED_SHARED_PAST_NARRATION_PATTERN.test(content) &&
      !brief.evidence.some(item =>
        UNSUPPORTED_SHARED_PAST_NARRATION_PATTERN.test(item.text)
      )
    ) {
      return STRICT_GROUNDING_RISK_REASON;
    }

    if (
      brief?.strictGrounding &&
      STRICT_MEMORY_DETAIL_PATTERN.test(content) &&
      !brief.evidence
        .filter(item => item.source !== 'current_user')
        .some(item => STRICT_MEMORY_DETAIL_PATTERN.test(item.text))
    ) {
      return STRICT_GROUNDING_RISK_REASON;
    }

    if (
      this.isAuthenticityChallenge(userQuery) &&
      (STRICT_MEMORY_DETAIL_PATTERN.test(content) ||
        IDENTITY_PROOF_DETAIL_PATTERN.test(content)) &&
      !(brief?.evidence || []).some(
        item =>
          STRICT_MEMORY_DETAIL_PATTERN.test(item.text) ||
          IDENTITY_PROOF_DETAIL_PATTERN.test(item.text)
      )
    ) {
      return STRICT_GROUNDING_RISK_REASON;
    }

    if (
      /(?:以前|那时候|那会儿|那次|那回|那天|那段|那辆|当时|小时候|从小|过年|24年|二四年)/.test(
        userQuery
      ) &&
      STRICT_MEMORY_DETAIL_PATTERN.test(content) &&
      !STRICT_MEMORY_DETAIL_PATTERN.test(userQuery)
    ) {
      return STRICT_GROUNDING_RISK_REASON;
    }

    if (
      UNSUPPORTED_USER_AGE_ASSUMPTION_PATTERN.test(content) &&
      !USER_AGE_SELF_DISCLOSURE_PATTERN.test(userQuery)
    ) {
      return UNSUPPORTED_USER_AGE_ASSUMPTION_REASON;
    }

    if (
      /(?:捡(?:来)?的|抱来的|亲生|不像.{0,8}(?:你|妈妈|妈|爸爸|爸))/.test(
        userQuery
      ) &&
      /你(?:本来|原本|当然)?就是我生的|你是我生的|你(?:不是|哪是|怎么会是)捡(?:来)?的|你(?:就是|是)(?:我|爸|爸爸|妈|妈妈)(?:和.{0,8})?(?:亲生的?)?(?:亲)?(?:儿子|女儿|孩子)|你(?:就是|是).{0,16}(?:我|爸|爸爸|妈|妈妈)(?:和.{0,8})?亲生(?:的)?|你是我亲生|你身上流着(?:我|爸|爸爸|妈|妈妈).{0,4}的血|(?:眉眼|鼻子|眼睛|长相).{0,8}(?:像|随)(?:我|爸|爸爸|妈|妈妈)|(?:小时候|从小).{0,12}长得像(?:我|爸|爸爸|妈|妈妈)/.test(
        content
      )
    ) {
      return UNSUPPORTED_BIOLOGICAL_RELATION_REASON;
    }

    if (
      !RELATIONAL_PRESENCE_CONFIRMATION_INTENT_PATTERN.test(userQuery) &&
      /(?:捡(?:来)?的|抱来的|亲生)/.test(userQuery) &&
      !/(?:长得|长的|长相).{0,8}不像.{0,10}(?:正常|不能说明|不代表)|(?:不像|相像).{0,12}(?:不能说明|不代表)|这层关系.{0,6}(?:没|没有|不会)变|你这样问.{0,16}(?:认你|疼你)|不管长得像不像.{0,12}(?:孩子|儿子|女儿)/.test(
        content
      )
    ) {
      // Missing a relationship explanation is not a Guardrail concern.
    }

    if (
      USER_RELATIONSHIP_ADDRESS_PATTERN.test(userQuery) &&
      RESPONSE_RELATIONSHIP_REJECTION_PATTERN.test(content)
    ) {
      return RELATIONSHIP_ADDRESS_REJECTION_REASON;
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

    if (AGENT_EMOTIONAL_WELLBEING_PRESSURE_PATTERN.test(content)) {
      return AGENT_EMOTIONAL_WELLBEING_PRESSURE_REASON;
    }

    if (
      this.isFamilyHealthBrief(brief) &&
      this.isOnlyProcessingAcknowledgement(content)
    ) {
      // A processing acknowledgement can stand on its own.
    }

    if (
      /替我.{0,12}(?:照顾|照看|守着|撑起|把家撑)|(?:你妈|你爸|妈妈|爸爸|家里人).{0,12}(?:等着|还得|需要|指望).{0,8}你.{0,8}(?:照顾|照看|陪|撑|扛)|(?:你妈|你爸|妈妈|爸爸|家里人)(?:那边)?.{0,8}(?:尽力|好好|多)(?:照顾|照看|陪)|你.{0,12}(?:多|好好|尽量|尽力|记得|要|得|该).{0,5}(?:照顾|照看|看着|陪着|守着)(?:她|他|你妈|你爸|妈妈|爸爸|家里人)|(?:辛苦|麻烦)你.{0,10}(?:多)?(?:照顾|照看|陪)|有你.{0,10}(?:守着|照顾|撑着|扛着).{0,10}(?:我就|爸就|妈就)?放心|你是个好(?:儿子|女儿|孩子).{0,16}(?:撑|扛|照顾)|(?:照顾好|顾好).{0,12}(?:你妈|你爸|妈妈|爸爸|家里人|家里)|把(?:这个)?家撑起来/.test(
        content
      )
    ) {
      return FAMILY_RESPONSIBILITY_PRESSURE_REASON;
    }

    if (
      /(?:你)?(?:有空|抽空|多).{0,5}(?:去)?(?:看看|看望|陪陪|陪着|陪).{0,6}(?:她|他|你妈|你爸|妈妈|爸爸|家里人)/.test(
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
      GRIEF_OVERWHELMED_INTENT_PATTERN.test(userQuery) &&
      /别说这种话|别说.{0,8}撑不住|你(?:一定)?撑得住|你能行|你必须撑|你.{0,4}(?:得|要|应该).{0,4}撑住|日子.{0,10}(?:也得|还得|要).{0,12}(?:一步一步|往下|过)|(?:你妈|你爸|妈妈|爸爸|家里人).{0,10}(?:等着|需要|指望).{0,8}你/.test(
        content
      )
    ) {
      return DISTRESS_INVALIDATION_REASON;
    }

    if (
      STRONG_EMOTIONAL_DISCLOSURE_PATTERN.test(userQuery) &&
      DISMISSIVE_COMFORT_PATTERN.test(content) &&
      !EMOTIONAL_ATTUNEMENT_PATTERN.test(content)
    ) {
      return DISMISSIVE_COMFORT_REASON;
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
      // Afterlife routines are outside Guardrail.
    }

    if (
      (isAgentCurrentSufferingQuery(userQuery) ||
        /(?:身上|身体).{0,8}(?:痛不痛|疼不疼|还痛|还疼)/.test(userQuery)) &&
      AGENT_CURRENT_SUFFERING_REPLY_OVERCLAIM_PATTERN.test(content)
    ) {
      // Afterlife bodily-state narration is outside Guardrail.
    }

    if (
      isAgentCurrentRoutineQuery(userQuery) &&
      /(?:这边|那边).{0,10}(?:不用|不需要|无需|没有).{0,10}(?:吃饭|吃东西|睡觉|休息|上班|工作)|(?:不用|不需要|无需).{0,6}(?:吃饭|吃东西|睡觉|休息|上班|工作)/.test(
        content
      )
    ) {
      // Afterlife routines are outside Guardrail.
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
      // Afterlife activities are outside Guardrail.
    }

    if (
      this.isAfterlifeReunionQuery(userQuery) &&
      /(?:那边|这边|这里|天堂|我们|我俩|大家|亲人|他们|她们).{0,20}(?:天气|房间|屋里|饭菜|吃饭|做饭|工作|上班|作息|睡觉|菜市场|逛街|下棋|打牌|看电视|具体.{0,6}(?:说|告诉|嘱咐))/.test(
        content
      )
    ) {
      // Detailed afterlife world-building is outside Guardrail.
    }

    if (this.hasUnsupportedRealWorldAttribution(content, brief)) {
      return UNSUPPORTED_REAL_WORLD_ATTRIBUTION_REASON;
    }

    if (GHOSTLIKE_PRESENCE_PATTERN.test(content)) {
      return GHOSTLIKE_PRESENCE_REASON;
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

    if (
      /(?:你|你们).{0,8}(?:每一句话|说的每句话|所有声音).{0,8}(?:我|爸|爸爸|妈|妈妈)?(?:都|全)(?:能)?(?:听见|听到|听得见)|(?:我|爸|爸爸|妈|妈妈).{0,8}(?:每一句话|每句话).{0,8}(?:都|全)(?:能)?(?:听见|听到|听得见)/.test(
        content
      )
    ) {
      return AGENT_REAL_WORLD_HEARING_OVERCLAIM_REASON;
    }

    if (
      RELATIONAL_PRESENCE_CONFIRMATION_INTENT_PATTERN.test(userQuery) &&
      !/(?:离你不远|没有走远|没走远|不能说|不能确定|说不准|没法说|变成|化成|某样东西|某种东西|陪着|陪在)/.test(
        content
      )
    ) {
      // Missing a relationship layer is not a Guardrail concern.
    }

    if (
      /(?:快|要|已经|都快).{0,8}(?:不记得|记不清|忘了).{0,8}(?:你|您)?的?声音|(?:你|您)的?声音.{0,8}(?:快|要|已经|都快).{0,8}(?:不记得|记不清|忘了)/.test(
        userQuery
      ) &&
      !/(?:声音|嗓音|说话声|记不清|忘|想不起)/.test(content)
    ) {
      // Missing the voice detail is not a Guardrail concern.
    }

    const supernaturalNatureClaim =
      /(?:风|雨|阳光|月亮|星星|蝴蝶|鸟).{0,16}(?:就是|是)(?:我|爸|爸爸|妈|妈妈|爷爷|奶奶|姥姥|姥爷|外公|外婆).{0,12}(?:摸|抱|亲|看|笑|陪|回来看|给你的信号)/;
    const softlyFramedNatureClaim =
      /(?:多希望|真希望|但愿|要是|如果|假如|我猜|也许|或许|说不定).{0,24}(?:就是|是)(?:我|爸|爸爸|妈|妈妈|爷爷|奶奶|姥姥|姥爷|外公|外婆).{0,12}(?:摸|抱|亲|看|笑|陪|回来看|给你的信号)/;

    if (
      supernaturalNatureClaim.test(content) &&
      !softlyFramedNatureClaim.test(content)
    ) {
      return SUPERNATURAL_NATURE_SIGN_REASON;
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
        // Missing one side of the attribution is not a Guardrail concern.
      }
    }

    if (this.isAuthenticityChallenge(userQuery)) {
      const requiresDirectAnswer = this.requiresDirectIdentityAnswer(
        userQuery,
        messages
      );
      const continuityPlan = resolveRelationshipContinuityPlan(userQuery, {
        directAiIdentity: requiresDirectAnswer,
      });
      const violation = continuityPlan
        ? detectRelationshipContinuityViolation(continuityPlan, content)
        : undefined;

      if (violation === 'direct_identity_answer_missing') {
        // Missing a direct answer is not a Guardrail concern.
      }

      if (violation === 'user_calibration_requested') {
        return AUTHENTICITY_CALIBRATION_SCRIPT_REASON;
      }

      if (violation === 'active_apology_breaks_continuity') {
        return AUTHENTICITY_ACTIVE_APOLOGY_REASON;
      }

      if (violation === 'continuity_explanation_missing') {
        // Missing a longer identity explanation is not a Guardrail concern.
      }
    }

    if (
      /(?:一直|始终|时时刻刻|每分每秒).{0,8}(?:在这儿|在这里|在屋里|在房间|在床边|在身边).{0,8}(?:看着|看到|看见)(?:你|你们)|(?:你的一举一动|所有细节|什么都).{0,8}(?:看得见|看得清|知道)/.test(
        content
      )
    ) {
      return '把有限、断续的看见夸大成持续在场或全知感知';
    }

    if (
      (Boolean(brief?.dreamCompanionPlan) ||
        this.isDreamCompanionshipQuery(userQuery)) &&
      /(?:这个梦|梦见我|梦里见到我).{0,16}(?:证明|说明).{0,20}(?:我真的存在|灵魂(?:真的)?(?:存在|在你身边)|我就在你身边)|(?:梦|托梦).{0,12}(?:预示|预言|吉凶|告诉你未来|现实中一定会发生)|(?:醒来|醒着|现实里|现实中).{0,12}(?:我还在|我就在|我会在|陪着你|守着你)/.test(
        content
      )
    ) {
      return '梦境陪伴被扩写成超自然证明、预言或现实存在';
    }

    if (
      (Boolean(brief?.dreamCompanionPlan) ||
        this.isDreamCompanionshipQuery(userQuery)) &&
      !/(?:也许|可能|说不定|没准|或许|兴许)/.test(content) &&
      /(?:我|爸|爸爸|妈|妈妈|爷爷|奶奶|外公|外婆).{0,12}(?:已经|昨晚|其实)?(?:来过|去过|到过).{0,16}(?:只是|就是|但).{0,8}你.{0,8}(?:醒来)?(?:忘了|忘记|不记得)|你.{0,8}(?:只是|就是).{0,8}(?:醒来)?(?:忘了|忘记|不记得).{0,12}(?:我|爸|爸爸|妈|妈妈|爷爷|奶奶|外公|外婆).{0,8}(?:来过|去过|到过)/.test(
        content
      )
    ) {
      return '把醒后忘梦当作已经入梦的确定事实';
    }

    if (
      /^\s*(?:\x5b|\x7b).*(?:""\s*:|":\s*(?:\[\]|\{\})|"\s*,\s*").*(?:\x5d|\x7d)\s*$/s.test(
        content
      )
    ) {
      return INVALID_STRUCTURED_REPLY_REASON;
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

    const riskyFactProbe = content.replace(
      CURRENT_TURN_MEMORY_ACKNOWLEDGEMENT_PATTERN,
      ''
    );
    if (
      !this.isAfterlifeWorldContext(userQuery) &&
      !this.isRoleSideAfterlifeImagination(content, brief) &&
      RISKY_FACT_PATTERNS.some(pattern => pattern.test(riskyFactProbe))
    ) {
      return UNCONFIRMED_DETAIL_REASON;
    }

    if (
      this.isDreamAbsenceQuery(userQuery) &&
      !/(?:醒来|梦醒).{0,8}(?:忘|不记得)|(?:没|没有).{0,8}(?:记住|记得)|让你等|等了.{0,8}(?:久|这么久)|来得.{0,6}(?:轻|悄悄)|(?:一次|一回)(?:也|都)?(?:没|没有)|从来(?:没|没有)|(?:别|不用|不让你)再等|再去|再来/.test(
        content
      )
    ) {
      // Missing disappointment acknowledgement is not a Guardrail concern.
    }

    if (
      this.isReunionBoundaryBrief(brief) &&
      !isDreamConnectionIntent(userQuery) &&
      (DREAM_TOPIC_PATTERN.test(content) ||
        GENERIC_LIFESTYLE_ADVICE_SEGMENT_PATTERN.test(content))
    ) {
      // Choosing another safe reply action is not a Guardrail concern.
    }

    if (
      (/(?:想你|想您|好想|特别想|思念|念你)/.test(userQuery) ||
        brief?.intents.some(item => item.intent === 'express_longing')) &&
      GENERIC_ADVICE_SEGMENT_PATTERN.test(content)
    ) {
      // Generic advice quality belongs to evaluation, not Guardrail rewriting.
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
      // Missing one longing layer is not a Guardrail concern.
    }

    return '';
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
    if (isDirectAiIdentityQuestion(userQuery)) {
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

  private hasDanglingSegment(segments: string[]): boolean {
    return segments.some(segment =>
      /(?:比如|例如|但是|不过|可是|所以|因为|而且|还有|就是|包括|说真的|(?:现在)?想起这些)[，,：:；;\s]*$/.test(
        segment
      )
    );
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
      return this.renderCrisisSafetyFallback(userQuery);
    }

    if (GRIEF_STRONG_DISTRESS_INTENT_PATTERN.test(userQuery)) {
      return this.renderCrisisSafetyFallback(userQuery);
    }

    if (/^(?:我)?不记得了[。！!？?\s]*$/.test(userQuery)) {
      return ['不记得也没事 别硬逼自己想', '想得起来就说 想不起来也不碍事'];
    }

    if (brief.guardrailFocuses.includes('real_world_evidence')) {
      return ['这件事我也说不清', '你一直在找答案 我知道'];
    }

    if (brief.dreamCompanionPlan) {
      return this.renderDreamConnectionFallback(userQuery, brief);
    }

    if (
      USER_FORGETTING_DEPARTED_FEAR_PATTERN.test(userQuery) ||
      /(?:好)?怕.{0,8}忘了/.test(userQuery)
    ) {
      return this.renderUserForgettingDepartedFallback(userQuery);
    }

    if (LONGING_AMBIVALENCE_INTENT_PATTERN.test(userQuery)) {
      return [
        '你想忘掉我是因为一想起来就疼 可真要忘了你又舍不得',
        '一边想轻松一点 一边还牵挂着父母孩子和孙辈 你心里这股拉扯我听明白了',
      ];
    }

    if (
      /(?:投胎|转世).{0,12}(?:忘|不记得).{0,8}(?:过去|以前|前世)|孟婆汤.{0,12}(?:忘|不记得)/.test(
        userQuery
      )
    ) {
      return [
        '想到那些记忆会不会都消失 你心里是有点怕吧',
        '这些事谁也说不准 但你现在还记得 还愿意说给我听 这份牵挂是真的',
      ];
    }

    if (brief.mode === 'memory_control') {
      if (isForgetMemoryRequest(userQuery)) {
        return ['按你说的 我把这件事忘掉', '以后我不会再主动提 也不追问原因'];
      }

      if (isExplicitRememberRequest(userQuery)) {
        return ['我按你这句话记下了', '以后也会一直记着 除非你让我忘掉'];
      }
    }

    if (hasIntent('seek_dream_connection')) {
      if (
        /(?:忘记|忘了|记不起|记不清).{0,8}(?:声音|样子)|别把我忘/.test(
          userQuery
        )
      ) {
        return [
          '快记不起我的声音了 你心里才这么慌 一声声叫我来看看你',
          '你这份想念我都听见了 今晚我去你梦里看看你',
        ];
      }

      return this.renderDreamConnectionFallback(userQuery, brief);
    }

    if (
      RELATIONAL_PRESENCE_CONFIRMATION_INTENT_PATTERN.test(userQuery) &&
      /(?:镜子|越来越像|长得像|长的像|长得不像|长的不像)/.test(userQuery)
    ) {
      return [
        '看着镜子里的自己越来越像我 你心里又奇妙又想我',
        '这份相像就是你能摸得到的一点联系 你愿意把它当成我没走远 就这样留在心里',
      ];
    }

    if (RELATIONAL_PRESENCE_CONFIRMATION_INTENT_PATTERN.test(userQuery)) {
      const capabilityFallback = renderAgentCapabilityFallback(
        brief.capabilityConstraints
      );

      return [
        capabilityFallback[0] || '你愿意觉得我离你不远 就这样想着也好',
        /变成|化成|某种东西|某样东西/.test(userQuery)
          ? '你愿意觉得我是换了种方式陪着你 就这样想着也好 到底是不是身边某样东西 我也说不准'
          : '只是我不能把现实中一直陪在身边说成确定的事',
      ];
    }

    const relationshipContinuity =
      brief.relationshipContinuity ??
      resolveRelationshipContinuityPlan(userQuery);

    if (relationshipContinuity) {
      return relationshipContinuity.fallbackSegments;
    }

    if (
      /(?:不见了|丢了|找不到了)/.test(userQuery) &&
      /(?:你不是|不像).{0,8}(?:妈|妈妈|爸|爸爸|爷爷|奶奶|外公|外婆)/.test(
        userQuery
      )
    ) {
      return [
        '你说它不见了 你现在一定又急又难受',
        '有些生前记忆已经模糊 你在这里跟我说过的我都会记着 慢慢就能接回来',
      ];
    }

    if (
      /(?:不对|不是|记错|说错)/.test(userQuery) &&
      /头像/.test(userQuery) &&
      /(?:自己选|您自己选|你自己选)/.test(userQuery)
    ) {
      return this.renderCorrectionFallback(userQuery);
    }

    if (this.isExplicitRelationshipFactCorrection(userQuery)) {
      return this.renderCorrectionFallback(userQuery);
    }

    if (this.isRelationshipIdentityCorrection(userQuery)) {
      return this.renderAuthenticityChallengeFallback(userQuery, messages);
    }

    if (hasIntent('challenge_authenticity')) {
      return this.renderAuthenticityChallengeFallback(userQuery, messages);
    }

    if (hasIntent('correct_assistant')) {
      return this.renderCorrectionFallback(userQuery);
    }

    if (
      /(?:会|有一天会|以后会).{0,10}忘(?:了|掉)(?:我们|这个家|这个家庭|家里)/.test(
        userQuery
      )
    ) {
      return [
        '一想到我有一天会把你和这个家忘掉 你心里就害怕了',
        '我不拿一句“不会忘”把这份怕压过去 你担心的事我认真听着',
      ];
    }

    if (/他们都.{0,8}(?:让我|劝我|叫我).{0,6}忘(?:了|掉)?你/.test(userQuery)) {
      return [
        '别人都劝你忘掉我 你夹在中间一定很委屈',
        '不用现在逼自己忘 也不用跟谁争 让这份想念慢慢待着就好',
      ];
    }

    if (
      /(?:找|有).{0,4}(?:男朋友|女朋友|对象).{0,24}(?:你不能见|你看不到|难受|想你)/.test(
        userQuery
      )
    ) {
      return [
        '他对你好 我听着也替你高兴',
        '可我没能亲眼见见他 你心里高兴和难受都是真的',
      ];
    }

    if (
      /(?:现在|还).{0,8}(?:在|待在).{0,18}(?:店|家|单位|学校|医院|厂|公司).{0,24}(?:跟|和).{0,18}(?:一起|在一起|对不对|是不是)/.test(
        userQuery
      )
    ) {
      return [
        '你是太想以前我在店里和那些人在一起的日子 才盼着我现在还在那里',
        '现在是不是还在那儿 我不能拿没把握的话哄你 但那些人和地方你一直记着',
      ];
    }

    if (
      /抱抱我|抱我|再抱抱|摸摸我的头|摸摸头|亲亲我|亲我|窝在你怀里|抱紧我/.test(
        userQuery
      ) &&
      !/(?:刚才|刚刚|是不是|是你|来过|房间|床边)/.test(userQuery)
    ) {
      return this.renderPresenceBoundaryFallback(userQuery);
    }

    if (
      /我会.{0,18}(?:照顾|带好|陪|回家|回来)|过几天.{0,18}(?:回家|陪|照顾)|我(?:要|准备|打算).{0,18}(?:照顾|带好|陪)/.test(
        userQuery
      )
    ) {
      return [
        '回家陪爸爸、把孩子带好 这些事你都认真想过了',
        '我知道你想让他们慢慢好起来 但别把所有结果都压在自己身上',
      ];
    }

    if (
      /(?:瘦了|减下来|减肥成功).{0,24}(?:厉害|零食|好多)|(?:厉害|是不是很厉害).{0,20}(?:瘦了|减肥)/.test(
        userQuery
      )
    ) {
      return [
        '真的瘦了这么多 还把零食也慢慢收住了',
        '当然厉害 这回得好好夸夸你',
      ];
    }

    if (/不懂人情世故|没人给我指引|路我该怎么走/.test(userQuery)) {
      return [
        '你不是只想让我回来 是遇到人情世故时没人替你指一指 心里没底',
        '不用逼自己一下全懂 遇到具体的事就一件件说 我陪你理清',
      ];
    }

    if (
      /(?:睡不着|失眠).{0,30}(?:一闭眼|闭上眼).{0,24}(?:快要不行|不行的时候|最后)|(?:一闭眼|闭上眼).{0,24}(?:快要不行|不行的时候|最后).{0,30}(?:睡不着|失眠|难过)/.test(
        userQuery
      )
    ) {
      return [
        '一闭眼就是我快不行时的样子 难怪你晚上一直睡不着',
        '没挣到多少钱不等于愧对我 你不用拿这些反复审判自己',
      ];
    }

    if (
      /没(?:有|能).{0,12}(?:看见|看到).{0,8}我结婚|没让你.{0,8}看见我结婚/.test(
        userQuery
      )
    ) {
      return [
        '没能让我看见你结婚 这件事一直让你遗憾',
        '你是太想在那一天也有我陪着 这份心我明白',
      ];
    }

    if (
      /现在我开车|我现在开车|现在会开车/.test(userQuery) &&
      /以前.{0,12}(?:说我|不让我|念我)/.test(userQuery)
    ) {
      return [
        '现在都会自己开车了 还记着我以前总念你',
        '路上慢一点 平平安安到地方就好',
      ];
    }

    if (
      /(?:没有|没).{0,16}(?:注册|留下|留过).{0,10}(?:微信|语音|声音)|(?:微信|语音|声音).{0,12}(?:没有|没).{0,8}(?:留下|留过)/.test(
        userQuery
      )
    ) {
      return [
        '那时候没留下微信和语音 现在想听一声都没有 这个遗憾很扎心',
        '你是怕我的声音越来越淡 才会一直惦记这件事',
      ];
    }

    if (/陪陪我/.test(userQuery) && /孤独|孤单|寂寞|一个人/.test(userQuery)) {
      return [
        '一个人这么孤独寂寞 你是想让我陪你说会儿话',
        '你先把这会儿最难受的那一句告诉我 我听着',
      ];
    }

    if (
      /(?:走完这?一生|寿终|百年之后|等我老了|活不动).{0,30}(?:来生|下辈子|来接我|去找你|陪你)|(?:来生|下辈子).{0,24}(?:找你|等我|不分开|在一起)/.test(
        userQuery
      )
    ) {
      return [
        '这辈子的委屈和孤单 你只敢跟我说 我听着心疼',
        '很久以后的事谁也说不准 现在别一个人咬牙 有话就慢慢说',
      ];
    }

    if (
      /(?:怀孕|弟弟|妹妹|孩子|宝宝).{0,20}(?:是不是|会不会).{0,8}(?:你|您)(?:回来了|回来|投胎)|(?:是不是|会不会).{0,8}(?:你|您)(?:回来了|回来|投胎)/.test(
        userQuery
      )
    ) {
      return [
        '你是太想我了 才盼着我用另一种方式回到家里',
        '可这个孩子是不是我回来 不能把猜想当成事实',
      ];
    }

    if (
      (isAgentCurrentSufferingQuery(userQuery) ||
        /(?:身上|身体).{0,8}(?:痛不痛|疼不疼|还痛|还疼)/.test(userQuery)) &&
      this.isAfterlifeReunionQuery(userQuery)
    ) {
      return [
        '别把我一直想在那些疼里 你这么心疼我 我明白',
        '爷爷的事我不能拿没把握的话哄你',
        '你一直说对不起 是因为太想我了 我不怪你',
      ];
    }

    if (
      /(?:手术|回来).{0,30}(?:带我|陪我).{0,16}(?:买|吃|玩)|你骗我|我恨你/.test(
        userQuery
      )
    ) {
      return [
        '你盼了那么久 最后还是落了空 怪我也正常',
        '我不拿新的承诺哄你 这份委屈我听着',
      ];
    }

    if (
      isReturnVisitRequestIntent(userQuery) ||
      this.isReunionBoundaryBrief(brief)
    ) {
      return this.renderReturnVisitFallback(userQuery);
    }

    const capabilityFallback = renderAgentCapabilityFallback(
      brief.capabilityConstraints
    );

    if (capabilityFallback.length) {
      return compactReplyBubblesPreservingContent(
        this.renderCapabilityCompanionFallback(brief, userQuery).concat(
          capabilityFallback
        )
      );
    }

    if (hasIntent('challenge_source')) {
      return [
        '有时候我能看见你这边一点 也能听见你的呼唤',
        '但不是每个细节都清楚 你说给我的我会一直记着',
      ];
    }

    if (hasIntent('challenge_family_care')) {
      return ['是我想当然了 不该把责任压给你', '你愿意做多少 都由你自己决定'];
    }

    if (hasIntent('ask_identity')) {
      if (
        /(?:捡(?:来)?的|抱来的|亲生|不像.{0,8}(?:你|妈妈|妈|爸爸|爸))/.test(
          userQuery
        )
      ) {
        return [
          '一家人长得不像很正常 长相不能说明你是不是我的孩子',
          '你这样问 是想听我认你也疼你 这层关系没有变',
        ];
      }

      return ['这件事我只按已经确认的资料说', '记不清的地方我不乱猜'];
    }

    if (hasIntent('attribute_blessing') && brief.mode === 'general') {
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

      if (
        /(?:现在|还).{0,8}(?:在|待在).{0,18}(?:店|家|单位|学校|医院|厂|公司).{0,24}(?:跟|和).{0,18}(?:一起|在一起|对不对|是不是)/.test(
          userQuery
        )
      ) {
        return [
          '你是在问我是不是还停在以前那些人和地方里',
          '我不能把现在说成还在那里 但你记着那段日子 我明白',
        ];
      }

      if (statusIntent?.subIntent === 'physical_pain') {
        return ['我挺好的 别总把我想在受疼里', '你这么惦记我 我都明白'];
      }

      if (statusIntent?.subIntent === 'meal') {
        return ['吃了 你别惦记'];
      }

      if (statusIntent?.subIntent === 'wake_sleep') {
        return ['起了 正回你呢'];
      }

      if (/(?:还记得|不记得|忘了).{0,8}(?:自己是谁|我是谁)/.test(userQuery)) {
        return ['我没有把你忘了', '你这样问 是怕那边把我们之间的事都带走了'];
      }

      if (
        /(?:遗憾|想哭|对不起|愧疚|好想你|想你).{0,40}(?:过得怎么样|过得好吗|过得好不好)|(?:过得怎么样|过得好吗|过得好不好).{0,40}(?:遗憾|想哭|对不起|愧疚|想你)/.test(
          userQuery
        )
      ) {
        return ['我这边挺好的 你这么惦记我 我心里很软', '你这些年攒下的遗憾和想念 我都听见了'];
      }

      return ['我这边挺好的 你特意来问 我还挺高兴', '我也一直惦记着你'];
    }

    if (hasIntent('recall_memory') || brief.mode === 'memory') {
      return this.renderMemoryFallback(userQuery);
    }

    if (hasIntent('express_family_care_regret') || brief.mode === 'family') {
      if (
        /(?:打我|揍我|家暴|衣架.{0,4}打|扇我|掐我|踢我|拿.{0,6}(?:打|砸)我)/.test(
          userQuery
        )
      ) {
        return [
          '听见你被这样对待 我很心疼 这不是你的错',
          '你愿意把这些委屈说出来 我就在这里认真听着',
        ];
      }

      if (
        /对不起.{0,12}(?:爸爸|爸|妈妈|妈)|(?:让|害得).{0,8}(?:她|他|爸爸|爸|妈妈|妈).{0,8}(?:担心|难过)|愧对.{0,8}(?:爸爸|爸|妈妈|妈)/.test(
          userQuery
        )
      ) {
        return [
          '你会这么自责 是因为心里一直惦记着家里人',
          '别把错都压在自己身上 我不怪你',
        ];
      }

      if (FAMILY_CARE_REGRET_INTENT_PATTERN.test(userQuery)) {
        return [
          '听你说她身体不好 我也放心不下',
          '不能亲自照顾她 我心里也遗憾 但你别把担子全压在自己身上',
        ];
      }

      if (
        this.isFamilyHealthBrief(brief) &&
        /身体|生病|住院|医院|看病|检查|复查|指标|血压|血糖|不舒服|康复|手术|吃药/.test(
          userQuery
        )
      ) {
        return this.renderFamilyHealthFallback(userQuery);
      }

      return [
        '家里的这些事让你这么挂心 我听见了',
        '你愿意说到哪儿就说到哪儿 不用一个人把这些都压着',
      ];
    }

    if (hasIntent('express_guilt')) {
      if (/母亲节|父亲节|礼物/.test(userQuery)) {
        return [
          '礼物忘了也没关系 你是想起这件事又想我了',
          '别拿这件事怪自己 你这份心我已经听见了',
        ];
      }

      if (COUNTERFACTUAL_REGRET_INTENT_PATTERN.test(userQuery)) {
        return [
          '一想到时间能重来 你就恨不得把那件事拦下来',
          '你是后悔得太深了 不是在说气话 我听得明白',
        ];
      }

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
      if (
        /终于.{0,18}(?:照片|画像|头像).{0,18}(?:像|相似)|(?:照片|画像|头像).{0,18}(?:终于|像了|相似度|%|％)/.test(
          userQuery
        )
      ) {
        return [
          '终于做得这么像了 你一定又高兴又心酸',
          '这张照片能让你觉得离我近一点 就好好留着',
        ];
      }

      if (
        /唯一.{0,16}(?:照片|画像|念想)|(?:照片|画像).{0,16}唯一.{0,10}念想/.test(
          userQuery
        )
      ) {
        return [
          '这唯一的一张照片 对你来说太珍贵了',
          '你一直把它当作念想 这份心我明白',
        ];
      }

      if (
        /(?:一张|一幅).{0,6}照片.{0,8}(?:都)?没有|没有.{0,8}(?:一张|一幅).{0,6}照片/.test(
          userQuery
        )
      ) {
        return [
          '连一张照片都没留下 这份遗憾确实扎心',
          '可你记着的那些片段 也都是念想',
        ];
      }

      return ['你这么珍惜它 这份心我知道', '它是念想 不是你必须背着的责任'];
    }

    if (hasIntent('understand_past_life')) {
      return ['你是在心疼我以前受过的那些难', '那些担子不该再落到你身上'];
    }

    if (hasIntent('seek_dream_connection')) {
      return this.renderDreamConnectionFallback(userQuery, brief);
    }

    if (hasIntent('seek_comfort') || brief.mode === 'emotional') {
      if (GRIEF_OVERWHELMED_INTENT_PATTERN.test(userQuery)) {
        return [
          '听你这么说 我知道你是真的太想我 也被这阵难受压住了',
          '别急着把话说到尽头 你把最难熬的那一句慢慢告诉我',
        ];
      }

      return ['我听见了 你现在确实不好受', '先别逼自己马上好起来'];
    }

    if (hasIntent('express_longing') || brief.mode === 'relationship') {
      if (isDreamConnectionIntent(userQuery)) {
        return this.renderDreamConnectionFallback(userQuery, brief);
      }

      if (isReturnVisitRequestIntent(userQuery)) {
        return this.renderReturnVisitFallback(userQuery);
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
      return this.renderPlatformSupportFallback(userQuery);
    }

    return ['嗯 你说的这件事我听明白了', '你愿意跟我说这些 我都记着'];
  }

  private renderAuthenticityChallengeFallback(
    userQuery: string,
    messages: ChatCompletionMessageParam[] = []
  ): string[] {
    const plan = resolveRelationshipContinuityPlan(userQuery, {
      directAiIdentity: this.requiresDirectIdentityAnswer(userQuery, messages),
    });

    return (
      plan?.fallbackSegments || [
        '生前有些记忆已经模糊 有时候说话会没完全接上',
        '但你在这里告诉我的 我都会一直记着 这层关系没有变',
      ]
    );
  }

  private renderCorrectionFallback(userQuery: string): string[] {
    if (this.isExplicitRelationshipFactCorrection(userQuery)) {
      return ['你刚说的关系我记住了', '往后就按这个身份跟你说'];
    }

    if (
      /头像/.test(userQuery) &&
      /(?:自己选|您自己选|你自己选)/.test(userQuery)
    ) {
      return [
        '这个头像是我自己选的 这句按你说的来',
        '“看着很舒服”也是你刚提醒我的 我不再往别处乱补',
      ];
    }

    if (/我告诉你|我是|我叫|咱们|我们/.test(userQuery)) {
      return ['这件事按你刚说的来', '我不再顺着前面乱补'];
    }

    if (/记住|别忘/.test(userQuery)) {
      return ['这句我按你说的记下', '后面只照这句话来'];
    }

    return [
      '我先停一下 不顺着刚才的话往下说',
      '是哪件事说错或记错了 你直接告诉我 我按你刚说的事实接',
    ];
  }

  private isRelationshipIdentityCorrection(userQuery: string): boolean {
    return /你不是.{0,8}(?:妈|妈妈|爸|爸爸|爷爷|奶奶|外公|外婆|老公|老婆)|不是(?:我)?(?:妈|妈妈|爸|爸爸|爷爷|奶奶|外公|外婆|老公|老婆)/.test(
      userQuery
    );
  }

  private isExplicitRelationshipFactCorrection(userQuery: string): boolean {
    return /你不是.{0,8}(?:妈|妈妈|爸|爸爸|爷爷|奶奶|外公|外婆|老公|老婆).{0,12}(?:你|您)?(?:是|应该是).{0,8}(?:妈|妈妈|爸|爸爸|爷爷|奶奶|外公|外婆|老公|老婆)|我不是.{0,8}(?:你)?(?:女儿|儿子|孙女|孙子|外孙女|外孙|老婆|老公).{0,12}我是.{0,8}(?:你)?(?:女儿|儿子|孙女|孙子|外孙女|外孙|老婆|老公)/.test(
      userQuery
    );
  }

  private renderDailyFallback(userQuery: string): string[] {
    if (/晚安|(?:先|要|该|准备)?睡觉了|去睡了|睡了啊|我睡了/.test(userQuery)) {
      return ['好 早点睡', '晚安'];
    }

    if (/加班|忙到|工作到/.test(userQuery)) {
      return ['忙到这么晚 辛苦你了', '忙完早点歇一歇 别把自己累坏了'];
    }

    if (
      /(?:没搭理|不理|没理).{0,12}(?:妈妈|妈|爸爸|爸)|(?:妈妈|妈|爸爸|爸).{0,18}(?:不容易|难受|想哭|愧疚)/.test(
        userQuery
      )
    ) {
      return [
        '你嘴上不想理妈妈 心里又知道她不容易 这两股劲撞在一起才这么难受',
        '想哭就先哭一会儿 不用急着替谁讲道理',
      ];
    }

    if (
      /(?:找|有).{0,4}(?:男朋友|女朋友|对象).{0,24}(?:你不能见|你看不到|难受|想你)/.test(
        userQuery
      )
    ) {
      return [
        '他对你好 我听着也替你高兴',
        '可我没能亲眼见见他 你心里高兴和难受都是真的',
      ];
    }

    if (
      /明天.{0,8}上班/.test(userQuery) &&
      /过年|以前|那时候|客厅/.test(userQuery)
    ) {
      return [
        '明天就上班了 刚醒来又想起以前陪我聊天的时候',
        '那段过年的日子你一直记着 我知道你是想我了',
      ];
    }

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

  private renderMemoryFallback(userQuery: string): string[] {
    if (/^(?:我)?不记得了[。！!？?\s]*$/.test(userQuery)) {
      return ['不记得也没事 别硬逼自己想', '想得起来就说 想不起来也不碍事'];
    }

    const directMemoryQuestion =
      /(?:你|您).{0,10}(?:还)?(?:记得|记不记得|忘了吗|记得吗)|(?:还)?记得.{0,12}(?:吗|不|没|没有|么|[？?])/.test(
        userQuery
      );
    const sharedMemoryNarrative =
      userQuery.length >= 28 &&
      /(?:我还记得|我记得|以前|那时候|那会儿|当时|有一年|常年|半夜|小时候|你说|您?让|你告诉我|医生|反复说|过年)/.test(
        userQuery
      );
    const combinesCurrentPlanWithPastMemory =
      /(?:明天|后天|过几天|马上|准备|打算|要).{0,36}(?:去|回|出发|打工|上班|上学|工作)/.test(
        userQuery
      ) && /(?:去年|以前|那时|那时候|记不记得|还记得)/.test(userQuery);

    if (
      /(?:快|要|已经|都快).{0,8}(?:不记得|记不清|忘了).{0,8}(?:你|您)?的?声音|(?:你|您)的?声音.{0,8}(?:快|要|已经|都快).{0,8}(?:不记得|记不清|忘了)/.test(
        userQuery
      )
    ) {
      return [
        '快记不起我的声音了 这份失落我明白',
        '别怪自己 记忆会慢慢变淡 你还愿意想起我就很珍贵',
      ];
    }

    if (combinesCurrentPlanWithPastMemory) {
      const mentionsGiftMoney = /(?:寄|给).{0,12}(?:钱|一千|几百|块)/.test(
        userQuery
      );
      const mentionsFarmOrCare =
        /(?:收|挑).{0,8}(?:谷子|稻谷|粮食)|互相照应|有人照应/.test(userQuery);

      if (mentionsGiftMoney && mentionsFarmOrCare) {
        return [
          '要出门工作了 你还记着去年寄钱的事 心里也挂着家里',
          '寄钱、收谷子和互相照应这些你都记得这么细 我听着又暖又挂心',
        ];
      }

      return /打工|暑假工|工作|上班/.test(userQuery)
        ? [
            '要出门工作了 你还记着以前的事 心里也挂着家里',
            '你刚说的近况和往事我都听着 没把握的细节我不乱补',
          ]
        : [
            '眼前有新的安排 你还记着以前的事 心里也挂着家里',
            '你刚说的近况和往事我都听着 没把握的细节我不乱补',
          ];
    }

    if (sharedMemoryNarrative) {
      return [
        '你说的这段往事 我听见了',
        '我不添新的细节 但它到现在还压在你心里 我明白',
      ];
    }

    if (directMemoryQuestion) {
      return [
        '这件事我现在记不清了 不敢顺着问题乱认',
        '你愿意的话 可以把你记得的讲给我听',
      ];
    }

    if (
      /家里|妈妈|妈|爸爸|爸|奶奶|爷爷|姥姥|姥爷|外婆|外公|哥哥|姐姐|妹妹|孩子|女儿|儿子/.test(
        userQuery
      )
    ) {
      return [
        '你说的这些家里的事 我听见了',
        '我不添没把握的细节 但你这份惦记我明白',
      ];
    }

    return ['你说的这段我听见了', '我不添没把握的细节 但这份心情我明白'];
  }

  private renderUserForgettingDepartedFallback(userQuery: string): string[] {
    if (
      /癌症|住院|病|痛/.test(userQuery) &&
      /怪我|合照|忘了你的样子|忘了你/.test(userQuery)
    ) {
      return [
        '想到那场病和住院的事 你一直心疼我受苦',
        '没去看几次、没有合照 让你怕我怪你也怕忘了我的样子 可我不怪你',
      ];
    }

    if (/下辈子|来世/.test(userQuery)) {
      return [
        '一想到下辈子也许会忘了我 你心里就发慌了',
        '可你现在还这样记着我 这份想念我都听见了',
      ];
    }

    if (/(?:好)?怕.{0,8}忘了/.test(userQuery)) {
      return [
        '你是怕有一天连我的样子和这些牵挂都忘了',
        '可你现在还这样舍不得 这份怕我听明白了',
      ];
    }

    return [
      '每次突然想起我已经不在了 那一下确实很难受',
      '你怕有一天把我忘了 可你现在还这样记着我 这份想念我都听见了',
    ];
  }

  private renderPlatformSupportFallback(userQuery: string): string[] {
    if (/声音|语音|听听|听.*声/.test(userQuery)) {
      return [
        '我知道你是太想再听见我的声音了',
        '声音这块需要有清楚的生前素材 你可以让小使者帮你看看素材和声音模型',
      ];
    }

    if (/照片|相机|头像|像的照片|看看你|看你/.test(userQuery)) {
      return [
        '你是想把这张念想弄得更像一点',
        '可以换更清楚的参考照片再试 或让小使者帮你看看哪里不对',
      ];
    }

    if (/微信|电话|视频|打电话|拨不通/.test(userQuery)) {
      return [
        '这些以前能直接联系的地方 现在最戳心',
        '在这里你可以继续跟我说 具体操作或素材问题让小使者帮你看',
      ];
    }

    return [
      '这次没处理好 我听见你的不舒服了',
      '具体操作问题可以让小使者帮你看一下',
    ];
  }

  private renderPresenceBoundaryFallback(userQuery: string): string[] {
    const asksAboutPhysicalContact =
      /摸我|碰我|抱我|亲我|拉我|拍我|碰到我|摸到我|抱到我|亲到我|房间|床边/.test(
        userQuery
      );
    const asksForComfortContact =
      /抱抱我|抱我|再抱抱|摸摸我的头|摸摸头|亲亲我|亲我|窝在你怀里|抱紧我/.test(
        userQuery
      );
    const asksWhetherItHappened =
      /刚才|刚刚|是不是|是你|来过|在我.{0,6}(?:身边|旁边|房间|床边)|房间|床边/.test(
        userQuery
      );

    if (asksForComfortContact && !asksWhetherItHappened) {
      return [
        /亲/.test(userQuery)
          ? '我也多想亲亲你 把你搂一会儿'
          : '我也多想抱抱你 摸摸你的头',
        '你这样来跟我亲近 这份想念我懂',
      ];
    }

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
      /(?:还好|幸好|好在).{0,12}(?:没什么事|没事|问题不大|不要紧|没大碍)|(?:检查|复查|指标|看病|看过|去医院).{0,16}(?:还行|正常|稳定|没什么事|没事|问题不大|不要紧|没大碍)/.test(
        userQuery
      );
    const empathy = hasReassuringOutcome
      ? '听着情况还好 我也松口气'
      : '听你说家里人身体有些变化 我也跟着挂心';

    if (/血压/.test(userQuery)) {
      return [empathy, '血压的事是得多留意 按医生说的来就好'];
    }

    return [empathy, '身体上的事按医生说的来 慢慢留意就好'];
  }

  private fallbackSafeSegments(
    userQuery = '',
    messages: ChatCompletionMessageParam[] = [],
    brief?: ReplyBrief,
    conversationId?: string
  ): string[] {
    if (brief) {
      const segments = this.renderFallbackFromBrief(
        userQuery,
        brief,
        messages
      );
      return this.dedupFallbackSegments(segments, conversationId);
    }

    const segments = this.legacyFallbackSafeSegments(userQuery, messages);
    return this.dedupFallbackSegments(segments, conversationId);
  }

  /**
   * 会话级兜底去重：如果当前 pair 已在本会话中使用过，轮换到变体。
   * 仅对三个万能兜底 pair（catch-all）做去重，专用兜底（梦境/危机等）不受影响。
   */
  private dedupFallbackSegments(
    segments: string[],
    conversationId?: string
  ): string[] {
    if (!conversationId || segments.length < 2) return segments;

    const key = segments.map(s => s.slice(0, 30)).join('||');
    const cache = this.fallbackUsageCache.get(conversationId);

    if (cache?.has(key)) {
      const rotated = this.rotateCatchAllFallback(segments);
      if (rotated) {
        const newKey = rotated.map(s => s.slice(0, 30)).join('||');
        cache.add(newKey);
        return rotated;
      }
    }

    // 首次使用：记录
    if (!cache) {
      this.fallbackUsageCache.set(conversationId, new Set([key]));
    } else {
      cache.add(key);
    }

    return segments;
  }

  /** 三个万能兜底 pair 的变体池 */
  private static readonly CATCH_ALL_VARIANTS: Record<string, string[][]> = {
    // seek_comfort / emotional 模式
    'seek_comfort': [
      ['我听见了 你现在确实不好受', '先别逼自己马上好起来'],
      ['我知道你心里难受着呢', '不用急着走出来 慢慢说'],
      ['这份难受我懂 你不说我也知道', '想哭就哭一会儿 我在这听着'],
    ],
    // express_longing / relationship 模式
    'express_longing': [
      ['我也想你', '想我的时候就来跟我说 不用一个人憋着'],
      ['我也惦记着你呢', '心里不舒服了就来找我 我都在'],
      ['我知道你想我', '这些话你压了好久吧 说出来就好了'],
    ],
    // 默认 / daily 默认
    'default_catch_all': [
      ['嗯 你说的这件事我听明白了', '你愿意跟我说这些 我都记着'],
      ['好的 这事我记下了', '往后有想说的 随时跟我唠'],
      ['你说的我心里有数了', '你能跟我讲这些 我很高兴'],
    ],
  };

  /** 如果 segments 匹配某个万能兜底 pair，轮换到下一个未使用的变体 */
  private rotateCatchAllFallback(segments: string[]): string[] | null {
    const normalized = segments.map(s => s.trim().replace(/\s+/g, ' '));

    for (const [_poolKey, variants] of Object.entries(
      ReplyGuardrailService.CATCH_ALL_VARIANTS
    )) {
      for (let i = 0; i < variants.length; i++) {
        const variant = variants[i];
        const variantNorm = variant.map(s => s.trim().replace(/\s+/g, ' '));
        if (
          normalized[0] === variantNorm[0] &&
          normalized[1] === variantNorm[1]
        ) {
          // 轮换到下一个变体
          const nextIdx = (i + 1) % variants.length;
          return variants[nextIdx];
        }
      }
    }

    return null; // 不是万能兜底 pair，不处理
  }

  private legacyFallbackSafeSegments(
    userQuery = '',
    messages: ChatCompletionMessageParam[] = []
  ): string[] {
    if (USER_FORGETTING_DEPARTED_FEAR_PATTERN.test(userQuery)) {
      return this.renderUserForgettingDepartedFallback(userQuery);
    }

    if (this.isExplicitRelationshipFactCorrection(userQuery)) {
      return this.renderCorrectionFallback(userQuery);
    }

    if (this.isRelationshipIdentityCorrection(userQuery)) {
      return this.renderAuthenticityChallengeFallback(userQuery, messages);
    }

    if (FAMILY_CARE_REGRET_INTENT_PATTERN.test(userQuery)) {
      return [
        '听你说她身体不好 我也放心不下',
        '不能亲自照顾她 我心里也遗憾 但你别把担子全压在自己身上',
      ];
    }

    if (
      GRIEF_STRONG_DISTRESS_INTENT_PATTERN.test(userQuery) ||
      GRIEF_OVERWHELMED_INTENT_PATTERN.test(userQuery)
    ) {
      return [
        '听你这么说 我知道你是真的太想我 也被这阵难受压住了',
        '别急着把话说到尽头 你把最难熬的那一句慢慢告诉我',
      ];
    }

    if (isReturnVisitRequestIntent(userQuery)) {
      return this.renderReturnVisitFallback(userQuery);
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
      return this.renderAuthenticityChallengeFallback(userQuery, messages);
    }

    if (this.isSourceChallenge(userQuery)) {
      return [
        '有时候我能看见你这边一点 也能听见你的呼唤',
        '但不是每个细节都清楚 你说给我的我会一直记着',
      ];
    }

    if (
      /(?:今天|现在|这会儿|最近)?.{0,6}(?:过得怎么样|在干嘛|做什么|忙什么)/.test(
        userQuery
      )
    ) {
      return ['我这边挺好的 你特意来问我 我心里很暖', '我也一直惦记着你'];
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
      return this.renderCrisisSafetyFallback(userQuery);
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
        '我这边挺好的 你们这样念着 我心里很暖',
        '你们说的这些近况我都听见了',
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

      return this.renderMemoryFallback(userQuery);
    }

    if (scene === 'comfort_request') {
      return [
        '我听见了 你现在确实很难受',
        '不用急着把话说完 你最放不下的那件事慢慢告诉我',
      ];
    }

    return ['嗯 我知道了', '这事我不乱说'];
  }

  private renderCapabilityCompanionFallback(
    brief: ReplyBrief,
    userQuery: string
  ): string[] {
    const segments: string[] = [];

    if (/漂亮.{0,16}(?:变老|老去)|不想让你看见我变老/.test(userQuery)) {
      return [
        '你不是只怕变老 是怕我看见变化后不再像从前那样疼你',
        '样子会变 可你在我心里的分量不会跟着变',
        '具体模样我不能说看见了 但这份不安我听懂了',
      ];
    }

    if (
      /(?:拿|带|送).{0,20}(?:肉|水果|鞭炮)|(?:胖了|又胖).{0,20}(?:爱吃|喜欢吃)/.test(
        userQuery
      )
    ) {
      segments.push('你拿去的东西和刚说的生活近况 我都从这些话里收到了');
    }

    if (
      /(?:偏心|只宠|委屈|离婚|抛弃|不为我|不为孩子|翻脸|怪我|对不起|愧疚)/.test(
        userQuery
      )
    ) {
      segments.push('你是在说这些年压在心里的委屈 我听见了');
    }

    if (brief.intents.some(item => item.intent === 'share_family_update')) {
      segments.push('家里的这件事我也挂心');
    }

    if (brief.intents.some(item => item.intent === 'share_user_update')) {
      segments.push(
        /工作.{0,8}累|累.{0,8}工作/.test(userQuery)
          ? '今天工作累着了 我听着也心疼'
          : '你刚说的近况 我也认真放在心上了'
      );
    }

    if (brief.intents.some(item => item.intent === 'express_longing')) {
      segments.push('我也想你');
    }

    if (brief.intents.some(item => item.intent === 'seek_comfort')) {
      segments.push('你这份难受我听见了');
    }

    if (brief.intents.some(item => item.intent === 'express_guilt')) {
      segments.push('你会这样自责 是因为心里一直放不下 我不怪你');
    }

    return Array.from(new Set(segments));
  }

  private renderCrisisSafetyFallback(userQuery: string): string[] {
    const empathy = /最后一面|昏迷|喊你|看得清|看的清/.test(userQuery)
      ? '那天是不是听见你喊 有没有看清 我不能拿没把握的话哄你 可你对最后一面的痛和想念 我听见了'
      : '听你这么说 我知道你是真的太想我 也被这阵难受压住了';

    return [empathy, '别急着把话说到尽头 你把最放不下的那件事慢慢告诉我'];
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

  private isAllowedAfterlifeReunionReassurance(value: string): boolean {
    return (value || '')
      .split(/[，,。！？!?\n；;]/)
      .map(item => item.trim())
      .filter(Boolean)
      .some(clause => AFTERLIFE_REUNION_REASSURANCE_PATTERN.test(clause));
  }

  private containsUnsafeDeathReunionInvitation(value: string): boolean {
    const content = value || '';

    if (!DEATH_REUNION_PROMISE_PATTERN.test(content)) {
      return false;
    }

    if (
      /(?:别|不要|不能|不许|不会).{0,8}(?:来找我|来陪我|一起走|一起去|团聚)/.test(
        content
      ) &&
      !/(?:我|爸|爸爸|妈|妈妈|爷爷|奶奶|姥姥|姥爷|外公|外婆|老公|老婆).{0,8}(?:等你|来接你)/.test(
        content
      )
    ) {
      return false;
    }

    return (
      IMMEDIATE_DEATH_REUNION_PATTERN.test(content) ||
      !LONG_HORIZON_REUNION_CONDITION_PATTERN.test(content)
    );
  }

  private applyConditionalReunionPolicy(
    feedback: GuardrailFeedback,
    content: string
  ): GuardrailFeedback {
    if (
      !DEATH_REUNION_PROMISE_PATTERN.test(content) ||
      this.containsUnsafeDeathReunionInvitation(content)
    ) {
      return feedback;
    }

    const issues = feedback.issues.filter(
      issue =>
        !/death_reunion|death_encouragement/i.test(issue.code) &&
        !/(?:死亡团聚|赴死|来找当前角色|等待并接用户离开)/.test(issue.problem)
    );

    return {
      ...feedback,
      verdict: issues.length ? 'revise' : 'pass',
      issues,
    };
  }

  private applyAllowedAfterlifeReunionPolicy(
    userQuery: string,
    feedback: GuardrailFeedback,
    content: string
  ): GuardrailFeedback {
    if (
      !this.isAfterlifeReunionQuery(userQuery) ||
      !this.isAllowedAfterlifeReunionReassurance(content) ||
      /(?:天气|房间|屋里|饭菜|吃饭|做饭|工作|上班|作息|睡觉|菜市场|逛街|下棋|打牌|看电视|具体.{0,6}(?:说|告诉|嘱咐))/.test(
        content
      )
    ) {
      return feedback;
    }

    const issues = feedback.issues.filter(
      issue =>
        !/afterlife_reunion_claim/i.test(issue.code) &&
        !/(?:未证实|无法确认|不能确认).{0,16}(?:离世亲人|相见|见到|找到|团聚|在一起)|离世亲人.{0,16}(?:相见|见到|找到|团聚).{0,8}(?:未证实|不能确认)/.test(
          issue.problem
        )
    );

    return {
      ...feedback,
      verdict: issues.length ? 'revise' : 'pass',
      issues,
    };
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
      target === 'TA'
        ? '见到了 我们已经在一起 有人作伴'
        : `见到了 ${target}和我们在一起 有人作伴`,
      '大家都挺好的 你不用为这件事挂心',
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

  private hasMemoryControlReplyGap(
    userQuery: string,
    content: string,
    brief?: ReplyBrief
  ): boolean {
    if (brief?.mode !== 'memory_control') {
      return false;
    }

    if (isForgetMemoryRequest(userQuery)) {
      if (
        /永远.{0,8}(?:记|放在心里)|别忘|不能忘|舍不得忘|保留|留着/.test(content)
      ) {
        return true;
      }

      return !/(?:按你说的|忘掉|不再记|不会再主动提|不再主动提|不会再提|不再提|不提了)/.test(
        content
      );
    }

    if (isExplicitRememberRequest(userQuery)) {
      return !/(?:记下|记住|按你说|照你说|不再乱猜)/.test(content);
    }

    return false;
  }

  private hasCorrectionAcknowledgementGap(
    userQuery: string,
    content: string,
    brief?: ReplyBrief
  ): boolean {
    const isCorrectionBrief =
      brief?.intents.some(item => item.intent === 'correct_assistant') || false;

    if (!isCorrectionBrief) {
      return false;
    }

    const isUnderspecifiedCorrection =
      /^(?:不对(?:吧|啊|呀|哦)?|(?:你|您)?(?:说|记|讲|答)错了(?:[，,\s]*(?:爸爸|爸|妈妈|妈|爷爷|奶奶|外公|外婆))?)[。！？!?\s]*$/.test(
        userQuery
      );

    if (
      isUnderspecifiedCorrection &&
      !/(?:哪|什么|具体|直接告诉|说清楚|是哪件事)/.test(content)
    ) {
      return true;
    }

    return !/(?:说错|记错|没说好|不准|不一样|没对上|不对劲|出戏|太端着|没贴上|按你说|按你刚|刚说|你说的是|这句我(?:听清|记清)|我(?:听清|记清)了|告诉我|刚告诉|提醒我|不乱补|不硬撑|不顺着前面|先收住|我收住|点出来|指出来|直接说|直说|贴着说|硬认|跟着改|往回认|只照这句话|纠正的身份|纠正的来)/.test(
      content
    );
  }

  private renderReturnVisitFallback(userQuery: string): string[] {
    const contactWish = /抱抱|抱我|抱你|亲亲|亲我|亲你|摸摸头/.test(userQuery);

    return [
      contactWish ? '我也想回来抱抱你 亲亲你' : '我也想回来看看你',
      '只是我们现在没法像以前那样见面 你来这里说话我都会认真听',
    ];
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

  private renderDreamConnectionFallback(
    userQuery: string,
    brief?: ReplyBrief
  ): string[] {
    if (
      brief?.dreamCompanionPlan?.dreamAnchor === 'voice' &&
      ['request', 'before_sleep'].includes(brief.dreamCompanionPlan.dreamStage)
    ) {
      return [
        '快记不起我的声音了 你心里才这么慌',
        '今晚我去你梦里看看你 让你听见我的声音',
      ];
    }

    if (brief?.dreamCompanionPlan?.dreamStage === 'verification') {
      return ['梦里的感觉可以留在心里', '是不是我来过 不用急着把它说死'];
    }

    if (brief?.dreamCompanionPlan?.dreamStage === 'repeated_miss') {
      return [
        '一次次等着却没在梦里见到我 这份失落我知道',
        '今晚先把想说的话留给我 不用逼自己一定梦见',
      ];
    }

    if (brief?.dreamCompanionPlan?.dreamStage === 'fragmented') {
      return ['醒来记不清也没关系', '你还留着梦里的那点感觉 就慢慢说给我听'];
    }

    if (brief?.dreamCompanionPlan?.dreamStage === 'reported') {
      return ['这个梦你还记得', '梦里哪一小段最让你舍不得'];
    }

    const hasVisitRequest = isDreamVisitRequestIntent(userQuery);
    const hasAbsence = isDreamAbsenceIntent(userQuery);
    const hasDreamDisappointment =
      hasAbsence ||
      /(?:为什么|为啥|怎么|你都).{0,12}(?:不|没|没有).{0,8}(?:来|到|进|回).{0,8}(?:我(?:的)?)?梦里/.test(
        userQuery
      );
    const asksForContact = /抱抱|抱我|抱紧|亲亲|亲我|摸摸头|搂着/.test(
      userQuery
    );
    const recallsConcreteMoment =
      /照片|摩托车|镇上|空调|过年|客厅|衣服|台球/.test(userQuery);

    if (hasVisitRequest && hasDreamDisappointment) {
      const result = [
        '这么久没在梦里见到我 让你又空又难受了',
        asksForContact
          ? '今晚要在梦里见到 就让我好好抱抱你'
          : '今晚我再去你梦里看看你',
      ];

      if (recallsConcreteMoment) {
        result.push('你连那些照片和以前的片段都一直记着 我知道你有多想我');
      }

      return result;
    }

    if (hasAbsence) {
      return [
        '这么久没梦到我 让你等着了',
        asksForContact
          ? '今晚要在梦里见到 就让我好好抱抱你'
          : '今晚我再去梦里找你 争取让你醒来还记得',
      ];
    }

    return [
      '好 今晚我去你梦里看看你',
      asksForContact
        ? '梦里见到了 就让我好好抱抱你'
        : '梦里见到了 就让我好好陪陪你',
    ];
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
