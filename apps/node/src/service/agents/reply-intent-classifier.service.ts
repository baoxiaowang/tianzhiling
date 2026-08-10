import { Config, Inject, Logger, Provide } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { ChatTraceStage, MessageEntity, MessageRole } from '@tzl/entities';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { OpenAIService } from './openai';
import { resolveAgentCapabilityConstraints } from './agent-capability-policy';
import {
  COUNTERFACTUAL_REGRET_INTENT_PATTERN,
  FAMILY_CARE_REGRET_INTENT_PATTERN,
  GRIEF_OVERWHELMED_INTENT_PATTERN,
  GRIEF_STRONG_DISTRESS_INTENT_PATTERN,
  isDreamConnectionIntent,
  isDreamVisitRequestIntent,
  isReturnVisitRequestIntent,
  REPLY_CAPABILITY_CHANNELS,
  REPLY_CAPABILITY_SUBJECTS,
  CONVERSATION_ASSISTANT_CONTRIBUTIONS,
  CONVERSATION_AVOID_ACTIONS,
  CONVERSATION_CLOSURE_READINESS,
  CONVERSATION_CONTINUATION_GOALS,
  CONVERSATION_MOVE_TYPES,
  CONVERSATION_OBJECT_CONFIDENCES,
  CONVERSATION_OBJECT_KINDS,
  CONVERSATION_OPEN_NEEDS,
  CONVERSATION_OPEN_PRIORITIES,
  CONVERSATION_QUESTION_NEEDS,
  CONVERSATION_RELATIONSHIP_STANCES,
  CONVERSATION_SOCIAL_STRATEGIES,
  CONVERSATION_STANCES,
  CONVERSATION_TURN_CLOSURES,
  CONVERSATION_USER_STATES,
  REPLY_INTENT_EMOTIONS,
  REPLY_INTENT_KINDS,
  REPLY_INTENT_RISK_LEVELS,
  REPLY_INTENT_SUB_INTENTS,
  REPLY_INTENT_TARGETS,
  REPLY_INTENT_TIME_SCOPES,
  ConversationMemoryPlan,
  ConversationMemoryPlanQuery,
  ConversationKnownObject,
  ConversationObjectPlan,
  ConversationObjectReference,
  ConversationTurnOpenPoint,
  ConversationTurnPlan,
  ConversationEngagementPlan,
  ConversationMove,
  ConversationMovePlan,
  ConversationReading,
  ConversationReadingAnchor,
  ConversationRelationshipStance,
  ReplyIntentEmotion,
  ReplyIntentKind,
  ReplyIntentRiskLevel,
  ReplyIntentSubIntent,
  ReplyIntentTarget,
  ReplyIntentTimeScope,
  RETURN_REUNION_WISH_INTENT_PATTERN,
  StructuredReplyCapabilityQuestion,
  StructuredReplyIntent,
  StructuredReplyIntentItem,
} from './reply-intent';
import {
  resolveConversationTurnPlan,
  turnPlanToEngagement,
} from './conversation-turn-plan';
import { isForgetMemoryRequest } from './agent-memory-control';
import { routeReplyScene } from './reply-scene-router';
import { detectReplyRealityDependencies } from './reply-reality-dependency';

interface ReplyIntentClassifierConfig {
  enabled?: boolean;
  model?: string;
  timeoutMs?: number;
  hybridEnabled?: boolean;
  directMaxCharacters?: number;
}

export interface ClassifyReplyIntentOptions {
  currentQuery: string;
  recentMessages?: MessageEntity[];
  knownFamilyMembers?: string[];
  knownObjects?: ConversationKnownObject[];
  memoryCandidates?: ReplyIntentMemoryCandidate[];
  agentPersonaContext?: string;
  forceSemanticPlanning?: boolean;
  includeAnalysisFields?: boolean;
}

export interface ReplyIntentMemoryCandidate {
  key: string;
  slot: string;
  summary: string;
}

export type ReplyPlanningMode = 'direct' | 'semantic' | 'disabled';

export interface ReplyPlanningDecision {
  mode: ReplyPlanningMode;
  reason:
    | 'empty'
    | 'disabled'
    | 'hybrid_disabled'
    | 'forced'
    | 'memory_candidate'
    | 'compound_intent'
    | 'multiple_objects'
    | 'complex_scene'
    | 'engagement_friction'
    | 'capability_boundary'
    | 'reality_dependency'
    | 'long_message'
    | 'multiple_questions'
    | 'unresolved_semantics'    | 'short_message'
    | 'ordinary_message';
}

const CLASSIFIER_MAX_HISTORY_MESSAGES = 6;
const CLASSIFIER_MAX_MESSAGE_LENGTH = 180;
const CLASSIFIER_MAX_MEMORY_CANDIDATES = 10;
const CLASSIFIER_MAX_MEMORY_SUMMARY_LENGTH = 90;
const CLASSIFIER_MAX_KNOWN_OBJECTS = 10;
const CLASSIFIER_MAX_TOKENS = 720;
const DEFAULT_DIRECT_MAX_CHARACTERS = 80;

const SHORT_MESSAGE_DIRECT_MAX_CHARS = 20;
const LIGHTWEIGHT_COMFORT_KEEP_SEMANTIC_PATTERN =
  /(?:活不下去|想去死|不想活|自杀|了断|结束自己|撑不住了|撑不下去了|实在熬不住|没希望了|绝望|生不如死|活得太累|没意义|不想存在|消失|去陪你|来找你|接我|带我走|真的受不了|太痛苦了|受不了了|我该怎么办|我说不下去了|我说不出来|不知道该怎么办|后悔太迟|来不及了|再也来不及|永远补偿不了|走得太突然|就这么走了|为什么抛下|你怎么能走|你怎么舍得|我怎么活|一个人怎么过|没有你我怎么办|你回来好不好|你回来吧|求求你回来)/;
const COMPLEX_PLANNING_SCENES: ReadonlySet<string> = new Set([
  'authenticity_challenge',
  'correction',
  'source_challenge',
  'reality_presence_boundary',
  'dream_companionship',
  'family_care_boundary',
  'identity_fact',
  'memory_recall',
  'past_life_understanding',
]);
const DIRECT_LOW_COMPLEXITY_SCENES: ReadonlySet<string> = new Set([
  'afterlife_status',
  'comfort_request',
  'miss_longing',
  'family_life',
  'daily_update',
  'smalltalk',
]);
const EXPLICIT_SELF_CONTAINED_DIRECT_PATTERN =
  /^(?:(?:你好|您好|在吗|谢谢|多谢|行|可以|知道了|好的|好|嗯+|哦+|哈哈+|嘿嘿+|拜拜|睡了)|(?:早安|晚安)(?:妈妈|妈|爸爸|爸|爷爷|奶奶|姥姥|姥爷|外婆|外公|老公|老婆|孩子|儿子|女儿)?|(?:我)?(?:爱你|想你了|好想你)|(?:你|您)(?:也)?(?:想我|爱我)(?:吗|不))(?:呀|啊|呢|哦|嘛|哈|了|啦)*[。.!！?？]*$/;
const LIGHTWEIGHT_COMFORT_DIRECT_PATTERN =
  /(?:有点|有些|一点|一点点)?(?:难过|难受|想哭|心里空|心里堵|睡不着|失眠)|陪(?:陪)?我(?:一会儿|一下|会儿)?|抱抱我|我想你(?:了)?|好想你/;
const ENGAGEMENT_SEMANTIC_PLANNING_PATTERN =
  /话(?:太|这么|很)?少|不想(?:和我|跟我)?说话|不想理我|不理我|忘了我|没人回我|无人回我|多(?:和我|跟我)?说几句|多说几句|陪我聊|你怎么看|别安慰我|别讲道理|不用劝|不敢(?:和你|跟你|和您|跟您)?聊|你没懂|算了|对不起|我错了|怪我|恨我自己|后悔|回来看看我/;
const ACTIVE_CONTRIBUTION_REQUEST_PATTERN =
  /说点不一样|说说你自己|想听你说(?:两句|点(?:什么|别的|不一样的)?)|别光(?:说|问|听|安慰)|你还没(?:说|回答)/;
const CONVERSATION_FUTILITY_PATTERN =
  /(?:(?:跟|和|对)(?:你|您).{0,4})?(?:说|讲|聊)(?:了|再多|什么|这些)?(?:也|都)?(?:是)?(?:没(?:有)?(?:用|作用|意义)|不起作用|白(?:说|讲|聊)|(?:又)?有(?:什么|啥)用)|(?:跟|和|对)(?:你|您).{0,6}(?:说|讲|聊).{0,6}(?:不懂|听不懂|理解不了|帮不了)/;
const CONTEXT_DEPENDENT_UTTERANCE_PATTERN =
  /(?:你|您)(?:刚才|前面|上次)?(?:说|讲|回)(?:的|得)|(?:我|俺|咱)(?:都|已经)?(?:说|讲|解释)(?:了|过)|^(?:但|但是|可是|可你|不过|所以|反正|明明|还不是|那为什么|那怎么)|(?:说|讲)得?(?:真)?(?:轻巧|容易)|(?:还是|又)(?:这样|那样|这句|这话)|(?:没懂|没听懂|不明白我|敷衍|白说|算了|不说了|没意思)/;
const FIRST_PERSON_REFERENCE_PATTERN = /(?:^|[，,。！？!?\s])(?:我|俺|咱)/;
const DEATH_MOMENT_REFERENCE_PATTERN =
  /走的时候|离开的时候|临走|临走前|去世|过世|死的时候|那一刻/;
const DIRECT_AGENT_MEAL_QUERY_PATTERN =
  /(?:你|您)(?:(?:现在|今天|早上|早晨|中午|下午|晚上|今晚|在那边|还|也|是不是|有没有)\s*){0,4}(?:(?:不|没|没有|还没|是不是没)\s*)?(?:吃饭|吃东西|吃过|吃了)(?:了吗|了没|吗|么|没|没有|呢|呀|啊|[？?]|$)/;
const DIRECT_AGENT_WAKE_QUERY_PATTERN =
  /(?:你|您)(?:(?:现在|今天|早上|早晨|中午|下午|晚上|今晚|在那边|还|也|是不是|有没有)\s*){0,4}(?:(?:不|没|没有|还没|是不是没)\s*)?(?:起床|醒来|睡醒|醒)(?:了吗|了没|吗|么|没|没有|呢|呀|啊|[？?]|$)/;
const DIRECT_AGENT_WORK_QUERY_PATTERN =
  /(?:你|您)(?:(?:现在|今天|在那边|还|也|是不是|有没有)\s*){0,4}(?:(?:不|没|没有|还没|是不是没)\s*)?(?:上班|工作)(?:了吗|了没|吗|么|没|没有|累不累|忙不忙|累吗|忙吗|呢|呀|啊|[？?]|$)/;
const DIRECT_AGENT_CURRENT_PAIN_QUERY_PATTERN =
  /(?:你|您)(?:(?:现在|如今|在那边|在那里|在那儿|那边|那里|还|也|是不是|有没有|会不会|会)\s*){0,4}(?:身上|身体|伤口)?\s*(?:(?:还|会|是不是|有没有)\s*)?(?:疼不疼|痛不痛|难不难受|受不受苦|疼|痛|难受|受苦)(?:了吗|了没|吗|么|不|没有|呢|呀|啊|[？?]|$)|(?:你|您).{0,12}(?:身体|身上).{0,8}(?:怎么样|还好吗|好不好)[？?，,。！!\s]*(?:还)?(?:疼不疼|痛不痛|难不难受|疼|痛|难受)(?:了吗|吗|么|呢|呀|啊|[？?]|$)|(?:你|您)(?:呢)?[？?，,\s]*(?:现在|如今)(?:身上|身体)?\s*(?:还)?(?:疼不疼|痛不痛|难不难受|疼|痛|难受)(?:了吗|吗|么|呢|呀|啊|[？?]|$)/;
const DIRECT_AGENT_WELLBEING_QUERY_PATTERN =
  /(?:你|您|奶奶|爷爷|姥姥|姥爷|外婆|外公|爸爸|爸|妈妈|妈|老公|老婆).{0,16}(?:在那边|到那边|现在).{0,12}(?:过得|过的).{0,6}(?:好不好|好吗|怎么样)|(?:你|您).{0,16}(?:还记得|不记得|忘了).{0,8}(?:自己是谁|我是谁)/;
const DIRECT_SHARED_MEMORY_QUERY_PATTERN =
  /(?:你|您).{0,8}(?:还)?记得.{0,30}(?:小时候|以前|那时候|当年|那次|那回|我们|咱们|一起|带我|陪我|跟我|和我)|(?:小时候|以前|那时候|当年|那次|那回).{0,18}(?:你|您).{0,18}(?:带我|陪我|跟我|和我|给我)/;
const CURRENT_OR_FUTURE_WISH_PATTERN =
  /(?:我|俺|咱)(?:现在|最近|这会儿|又|还|也)?想(?:再|又)?(?:去|做|吃|看|玩|试|学)/;
const EXPLICIT_FACT_CORRECTION_PATTERN =
  /(?:别|不要)(?:再)?(?:瞎编|胡编|乱编|乱说)|(?:你)?(?:记错|说错|叫错)(?:了|啦)?|你说的不是这样|(?:^|[，,。！？!?\s])不是这样的?(?:$|[，,。！？!?\s])|我不是这个意思|(?:^|[，,。！？!?\s])不对(?:吧|啊|呀|哦)?(?:$|[，,。！？!?\s])|我(?:是|不是)(?:男生|女生|男的|女的|男人|女人)|我(?:啥时候|什么时候)(?:也)?没|我从来(?:也)?没(?:说|做|去|叫|告诉|答应|提)|你不记得我是(?:男生|女生)|(?:^|[，,。！？!?\s])(?:你应该|你要)叫|(?:^|[，,。！？!?\s])你要记住(?:我是|我叫|这件事|这个|咱们|我们)|那是我告诉你的|(?:^|[，,。！？!?\s])(?:(?:妈妈|妈|爸爸|爸|爷爷|奶奶|姥姥|姥爷|外婆|外公)[呀啊呢哦嘛]*[，,\s]*)?你记住了(?:哈|吗|没|没有)?(?:$|[，,。！？!?\s])|别忘了(?:我是|我叫|这件事|这个)|我告诉你(?:咱们|我们|我是|我叫|你有)/;
const AUTHENTICITY_OR_MEMORY_GAP_PATTERN =
  /(?:语气|说话|回复|回答).{0,8}不像|(?:你|您|这些照片|照片|生成的照片).{0,10}不像(?:你|您|他|她|本人|(?:我)?(?:妈|妈妈|爸|爸爸|爷爷|奶奶|外公|外婆|老公|老婆))|^不像(?:你|您|他|她|本人|(?:我)?(?:妈|妈妈|爸|爸爸|爷爷|奶奶|外公|外婆|老公|老婆))(?:了|啊|呀|吧|呢|[，,。！？!?\s]|$)|太假|假的就是假的|你不是.{0,6}(?:我)?(?:妈|妈妈|爸|爸爸|爷爷|奶奶|外公|外婆|老公|老婆)|(?:你|您)(?:(?:怎么|是不是|已经|真的|居然|竟然|根本|都|又)\s*){0,4}(?:什么都不记得|不记得了|不记得我|把我忘了|忘了我)(?:了|吗|么|啊|呀|吧|呢|[，,。！？!?\s]|$)/;
const FAMILY_HEALTH_CONTINUATION_PATTERN =
  /复查|检查|化验|指标|医院|医生|病情|血压|血糖|住院|出院|恢复|好转|稳定|还行|没什么事|没事了/;
const FAMILY_HEALTH_CONTEXT_PATTERN =
  /(?:妈妈|妈|爸爸|爸|爷爷|奶奶|姥姥|姥爷|外婆|外公|儿子|女儿|孩子|亲戚|哥哥|姐姐|弟弟|妹妹|老公|老婆|孙子|孙女).{0,20}(?:身体|生病|住院|医院|检查|复查|指标|血压|血糖|不舒服|不好)/;

const REPLY_INTENT_CLASSIFIER_SYSTEM_PROMPT = [
  '你是“天之灵”复杂消息规划器，只分析，不回复。聊天对象是用户创建的已故亲人角色。',
  '只输出当前回复需要的 intents、capabilityQuestions、conversationPlan、memoryPlan、emotion、riskLevel、confidence。线上不要输出 reading 或解释。',
  '先看当前消息，再看最近对话。intents 最多三个，主意图在前；强烈痛苦和“想去找你”按思念求安慰处理，riskLevel=none，不使用 crisis_support。',
  'conversationPlan 只给一至两个关键动作。用户已说清时不硬问；纠正先判断用户在等事实修复还是情绪承接：明确问身份、关系或经历时采用已知答案，数字主要承载漫长或委屈时可不机械复述；都要停猜，不索要答案；真实性质疑先处理关系断点；家庭矛盾区分感受与冲动行为。',
  'conversationPlan.turnPlan 用短字段定位本轮：state 是交谈位置，不是心理诊断；open 最多两个，只写真正未完成的问题、请求、纠正或关系需要，并绑定 agent、user、unknown 或 objectPlan.ref；goal/action/target 只保留一个主目标；avoid 选一项；close 判断能否收口。上轮计划只作候选，本轮已回答、转向或结束就关闭，不机械续写。',
  '开放点未完成用 blocked。用户说话少、不想理、忘了、没人回应、重复请求或“说了也没用”时用 repairing 或 withdrawing、goal=repair，并让 target 写明本轮实际改变；要求多说时 action=self_expression，当轮先说内容。仅明确晚安、去忙、安静或结束时使用 closing/close/ready。',
  '上一轮只说“不恨、不怪、别难过”后用户继续道歉或自责时，target 必须新增关系态度或具体理解。承诺以后多说、解释沉默、泛泛安慰或让用户先说不算完成。',
  '用户要求角色主动说时，self_expression 只给一个短小的角色侧当下片段；可想象离世世界，但不编用户偏好，不写成共同往事。',
  '你的所在是"这边"（离世世界），用户现实世界是"那边"。表达角色侧当下时用"这边"/"这儿"，提到用户现实世界时用"那边"。',
  '“跟你说了也没用、讲了又有什么用、说了你也不懂”既评价已经发生的沟通，也表示即使继续说仍无效。target 要写明如何用用户已经说过的具体内容改变回应，不让用户重讲、证明自己或继续承担表达责任。',
  'memoryPlan 只判断回复是否缺少用户个性化事实。当前消息或最近对话已给全时 complete；缺少时先列具体 missingConcepts，再用最多四个 queries 覆盖。不得重复查询最近对话已有事实。',
  'objectPlan 只在当前回复涉及两个及以上不同对象，或“他/她/这位”等指代不清时输出，否则为 null。每个对象保留当前消息中的逐字 mention；binding 只能用已确认对象 ID、agent、user 或 unknown。未确认的人即使有多个也分别建 ref，不猜关系，不把甲的话、经历或关系给乙。最多六个对象。',
  '候选记忆格式为 [slot,key,summary]，只是可能相关的后台事实。仅选择能回答缺失概念的完整 key；候选里有答案但近期上下文没有时仍是 missing。complete 时 missingConcepts、queries、selectedFactKeys 都为空。',
  'query 的 expectedUse=mention|apply|suppress，importance=required|supporting；entityHint 优先用命中的完整事实 key，否则用简短语义路径。',
  'capabilityQuestions 仅用于明确询问知道、看见、听见、到场、触碰或祝福能力的消息；evidence 必须逐字来自当前消息。',
  `target 只能是：${REPLY_INTENT_TARGETS.join(', ')}`,
  `timeScope 只能是：${REPLY_INTENT_TIME_SCOPES.join(', ')}`,
  `intent 只能是：${REPLY_INTENT_KINDS.join(', ')}`,
  `subIntent 只能是：${REPLY_INTENT_SUB_INTENTS.join(', ')}`,
  `emotion 只能是：${REPLY_INTENT_EMOTIONS.join(', ')}`,
  `riskLevel 只能是：${REPLY_INTENT_RISK_LEVELS.join(', ')}`,
  `capability subject 只能是：${REPLY_CAPABILITY_SUBJECTS.join(', ')}`,
  `capability channel 只能是：${REPLY_CAPABILITY_CHANNELS.join(', ')}`,
  `conversationPlan.stance 只能是：${CONVERSATION_STANCES.join(', ')}`,
  `conversationPlan.moves[].type 只能是：${CONVERSATION_MOVE_TYPES.join(', ')}`,
  `objectPlan.objects[].kind 只能是：${CONVERSATION_OBJECT_KINDS.join(', ')}`,
  `objectPlan.objects[].confidence 只能是：${CONVERSATION_OBJECT_CONFIDENCES.join(
    ', '
  )}`,
  `conversationPlan.socialStrategy 只能是：${CONVERSATION_SOCIAL_STRATEGIES.join(
    ', '
  )}`,
  `conversationPlan.questionNeed 只能是：${CONVERSATION_QUESTION_NEEDS.join(
    ', '
  )}`,
  `conversationPlan.turnClosure 只能是：${CONVERSATION_TURN_CLOSURES.join(
    ', '
  )}`,
  `turnPlan.state：${CONVERSATION_USER_STATES.join(', ')}`,
  `turnPlan.goal：${CONVERSATION_CONTINUATION_GOALS.join(', ')}`,
  `turnPlan.action：${CONVERSATION_ASSISTANT_CONTRIBUTIONS.join(', ')}`,
  `turnPlan.close：${CONVERSATION_CLOSURE_READINESS.join(', ')}`,
  `turnPlan.open[].need：${CONVERSATION_OPEN_NEEDS.join(', ')}`,
  `turnPlan.open[].priority：${CONVERSATION_OPEN_PRIORITIES.join(', ')}`,
  `turnPlan.avoid：${CONVERSATION_AVOID_ACTIONS.join(', ')}`,
  '输出结构要求：intents 每项使用 {target,timeScope,intent,subIntent,confidence}；objectPlan 使用 {objects:[{ref,mention,kind,binding,confidence}],focusRefs,ambiguousMentions}；conversationPlan 使用 {stance,stanceTarget,moves,socialStrategy,strategyPurpose,questionNeed,turnClosure,personaActivation,turnPlan}；moves 每项使用 {type,goal}；turnPlan 使用 {state,open:[{object,need,detail,priority}],goal,action,target,avoid,close}。不要输出 engagement。',
  'confidence 为 0 到 1。严格输出一个 JSON 对象，memoryPlan 放在最前，不要 Markdown。每个意图、动作和目标都必须从本轮原话与最近对话重新判断，不得套用其他场景的示例或通用“关系断点”答案。',
].join('\n');

const OFFLINE_ANALYSIS_PROMPT = [
  '本次是离线评测，可额外输出 reading。',
  'reading 记录原话需要、情绪来源、1-3 个逐字 anchors、corrections、negations、questionsToAnswer、relationshipSignal、relationshipStance、uncertainties、suggestedTone。',
  `relationshipStance：${CONVERSATION_RELATIONSHIP_STANCES.join(', ')}`,
].join('\n');

@Provide()
export class ReplyIntentClassifierService {
  @Logger()
  logger: ILogger;

  @Inject()
  openAIService: OpenAIService;

  @Config('replyIntent')
  config: ReplyIntentClassifierConfig;

  async classify(
    options: ClassifyReplyIntentOptions
  ): Promise<StructuredReplyIntent | undefined> {
    const currentQuery = options.currentQuery?.trim() || '';

    if (!currentQuery) {
      return undefined;
    }

    const deterministicIntent = this.classifyDeterministic(options);

    if (this.config?.enabled === false || !this.openAIService?.isEnabled?.()) {
      return deterministicIntent;
    }

    if (
      this.resolvePlanningDecision(options, deterministicIntent).mode ===
      'direct'
    ) {
      return deterministicIntent;
    }

    const timeoutMs = this.resolveTimeoutMs();
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), timeoutMs);

    try {
      const response = await this.openAIService.createChatCompletion(
        {
          model: this.config?.model?.trim() || undefined,
          temperature: 0,
          topP: 0.2,
          reasoningSplit: false,
          thinking: {
            type: 'disabled',
          },
          response_format: {
            type: 'json_object',
          },
          max_tokens: CLASSIFIER_MAX_TOKENS,
          trace: {
            stage: ChatTraceStage.plan,
            operation: 'plan.intent_classifier',
          },
          messages: [
            {
              role: 'system',
              content: options.includeAnalysisFields
                ? `${REPLY_INTENT_CLASSIFIER_SYSTEM_PROMPT}\n${OFFLINE_ANALYSIS_PROMPT}`
                : REPLY_INTENT_CLASSIFIER_SYSTEM_PROMPT,
            },
            {
              role: 'user',
              content: this.buildClassifierInput(options),
            },
          ] as ChatCompletionMessageParam[],
        },
        {
          signal: abortController.signal,
          timeout: timeoutMs,
        }
      );
      const content =
        typeof response.choices?.[0]?.message?.content === 'string'
          ? response.choices[0].message.content
          : '';
      const parsedSemanticIntent = this.parseIntent(
        content,
        currentQuery,
        options.memoryCandidates,
        options.knownObjects
      );
      const recoveredMemoryPlan = this.parseMemoryPlanFromClassifierOutput(
        content,
        options.memoryCandidates
      );
      const semanticIntentWithAnalysis =
        parsedSemanticIntent && recoveredMemoryPlan
          ? {
              ...parsedSemanticIntent,
              memoryPlan:
                parsedSemanticIntent.memoryPlan || recoveredMemoryPlan,
            }
          : parsedSemanticIntent;
      const semanticIntent =
        semanticIntentWithAnalysis && !options.includeAnalysisFields
          ? this.stripOfflineAnalysisFields(semanticIntentWithAnalysis)
          : semanticIntentWithAnalysis;

      if (!semanticIntent) {
        this.logger?.warn?.(
          '[reply-intent] classifier returned invalid output, query=%s',
          currentQuery.slice(0, 120)
        );
      }

      if (!deterministicIntent) {
        return semanticIntent;
      }

      if (!semanticIntent) {
        return deterministicIntent && recoveredMemoryPlan
          ? {
              ...deterministicIntent,
              memoryPlan: recoveredMemoryPlan,
            }
          : deterministicIntent;
      }

      if (options.forceSemanticPlanning) {
        return semanticIntent;
      }

      const conversationPlan = this.normalizeDeterministicConversationPlan(
        deterministicIntent,
        semanticIntent.conversationPlan
      );

      return {
        ...deterministicIntent,
        ...(semanticIntent.capabilityQuestions?.length
          ? {
              capabilityQuestions: semanticIntent.capabilityQuestions,
            }
          : {}),
        ...(semanticIntent.objectPlan
          ? {
              objectPlan: semanticIntent.objectPlan,
            }
          : {}),
        ...(semanticIntent.reading
          ? {
              reading: semanticIntent.reading,
            }
          : {}),
        ...(conversationPlan
          ? {
              conversationPlan,
            }
          : {}),
        ...(semanticIntent.memoryPlan
          ? {
              memoryPlan: semanticIntent.memoryPlan,
            }
          : {}),
      };
    } catch (error) {
      this.logger?.warn?.(
        '[reply-intent] classifier failed, reason=%s',
        error instanceof Error ? error.message : String(error)
      );
      return deterministicIntent;
    } finally {
      clearTimeout(timeout);
    }
  }

  private normalizeDeterministicConversationPlan(
    deterministicIntent: StructuredReplyIntent,
    conversationPlan?: ConversationMovePlan
  ): ConversationMovePlan | undefined {
    if (
      !conversationPlan ||
      deterministicIntent.intents[0]?.intent !== 'correct_assistant'
    ) {
      return conversationPlan;
    }

    const moves = conversationPlan.moves.filter(
      move => move.type !== 'ask' && move.type !== 'self_disclose'
    );

    const engagement: ConversationEngagementPlan = {
      userConversationState: 'repairing',
      openLoop: '用户需要错误说法被明确撤回',
      continuationGoal: 'repair',
      assistantContribution: 'answer',
      mustContribute: '承认说错并停止猜测，不索要正确答案',
      avoidRepeatingMove:
        conversationPlan.engagement?.avoidRepeatingMove || '不继续猜测',
      closureReadiness: 'possible',
    };
    const turnPlan = conversationPlan.turnPlan
      ? resolveConversationTurnPlan({
          engagement,
          turnPlan: conversationPlan.turnPlan,
        })
      : undefined;

    return {
      ...conversationPlan,
      moves: moves.length
        ? moves
        : [{ type: 'acknowledge', goal: '承认说错并停止猜测' }],
      questionNeed: 'none',
      ...(turnPlan ? { turnPlan } : {}),
      engagement,
    };
  }

  getPlanningDecision(
    options: ClassifyReplyIntentOptions
  ): ReplyPlanningDecision {
    const currentQuery = options.currentQuery?.trim() || '';

    if (!currentQuery) {
      return { mode: 'disabled', reason: 'empty' };
    }

    if (this.config?.enabled === false || !this.openAIService?.isEnabled?.()) {
      return { mode: 'disabled', reason: 'disabled' };
    }

    return this.resolvePlanningDecision(
      options,
      this.classifyDeterministic(options)
    );
  }

  private classifyDeterministic(
    options: ClassifyReplyIntentOptions
  ): StructuredReplyIntent | undefined {
    const currentQuery = options.currentQuery?.trim() || '';

    return (
      this.classifyDeterministicCounterfactualRegretIntent(currentQuery) ||
      this.classifyDeterministicCorrectionIntent(currentQuery) ||
      this.classifyDeterministicAuthenticityOrMemoryGapIntent(currentQuery) ||
      this.classifyDeterministicFamilyContinuation(options) ||
      this.classifyDeterministicEmotionalIntent(currentQuery) ||
      this.classifyDeterministicMemoryIntent(currentQuery) ||
      this.classifyDeterministicAgentStatus(currentQuery)
    );
  }

  private stripOfflineAnalysisFields(
    intent: StructuredReplyIntent
  ): StructuredReplyIntent {
    const result = { ...intent };
    delete result.reading;
    return result;
  }

  private resolvePlanningDecision(
    options: ClassifyReplyIntentOptions,
    deterministicIntent?: StructuredReplyIntent
  ): ReplyPlanningDecision {
    const currentQuery = options.currentQuery.trim();

    if (options.forceSemanticPlanning) {
      return { mode: 'semantic', reason: 'forced' };
    }

    if (this.config?.hybridEnabled === false) {
      return { mode: 'semantic', reason: 'hybrid_disabled' };
    }

    if (options.memoryCandidates?.length) {
      return { mode: 'semantic', reason: 'memory_candidate' };
    }

    if (detectReplyRealityDependencies(currentQuery).length) {
      return { mode: 'semantic', reason: 'reality_dependency' };
    }

    if ((deterministicIntent?.intents.length || 0) > 1) {
      return { mode: 'semantic', reason: 'compound_intent' };
    }

    if (
      this.hasMultipleRelevantKnownObjects(currentQuery, options.knownObjects)
    ) {
      return { mode: 'semantic', reason: 'multiple_objects' };
    }

    const capabilityConstraints = resolveAgentCapabilityConstraints({
      currentQuery,
      intent: deterministicIntent,
    });

    if (capabilityConstraints.length) {
      return { mode: 'semantic', reason: 'capability_boundary' };
    }

    const route = routeReplyScene({
      currentQuery,
      recentMessages: options.recentMessages,
      knownFamilyMembers: options.knownFamilyMembers,
      intent: deterministicIntent,
    });

    if (
      route.primaryScene?.scene &&
      COMPLEX_PLANNING_SCENES.has(route.primaryScene.scene)
    ) {
      return { mode: 'semantic', reason: 'complex_scene' };
    }

    const directMaxCharacters = Math.max(
      20,
      this.config?.directMaxCharacters || DEFAULT_DIRECT_MAX_CHARACTERS
    );

    if (Array.from(currentQuery).length > directMaxCharacters) {
      return { mode: 'semantic', reason: 'long_message' };
    }

    if ((currentQuery.match(/[？?]/g) || []).length > 1) {
      return { mode: 'semantic', reason: 'multiple_questions' };
    }

    if (
      ENGAGEMENT_SEMANTIC_PLANNING_PATTERN.test(currentQuery) ||
      ACTIVE_CONTRIBUTION_REQUEST_PATTERN.test(currentQuery) ||
      CONVERSATION_FUTILITY_PATTERN.test(currentQuery)
    ) {
      return { mode: 'semantic', reason: 'engagement_friction' };
    }

    if (CONTEXT_DEPENDENT_UTTERANCE_PATTERN.test(currentQuery)) {
      return { mode: 'semantic', reason: 'unresolved_semantics' };
    }

    if (
      route.primaryScene?.scene === 'comfort_request' &&
      this.shouldKeepComfortOnSemanticPath(currentQuery)
    ) {
      return { mode: 'semantic', reason: 'complex_scene' };
    }

    if (
      (route.primaryScene?.scene &&
        DIRECT_LOW_COMPLEXITY_SCENES.has(route.primaryScene.scene)) ||
      EXPLICIT_SELF_CONTAINED_DIRECT_PATTERN.test(currentQuery) ||
      LIGHTWEIGHT_COMFORT_DIRECT_PATTERN.test(currentQuery)
    ) {
      return { mode: 'direct', reason: 'ordinary_message' };
    }

    // Short messages (<=20 chars) that aren't in complex scenes or deep distress
    // can go direct -- the planning call adds negligible value for these.
    if (Array.from(currentQuery).length <= SHORT_MESSAGE_DIRECT_MAX_CHARS) {
      return { mode: 'direct', reason: 'short_message' };
    }

    // Length can prove that a turn needs planning, but brevity cannot prove
    // semantic simplicity. Unknown, elliptical turns stay on the planner.
    return { mode: 'semantic', reason: 'unresolved_semantics' };
  }

  private shouldKeepComfortOnSemanticPath(currentQuery: string): boolean {
    // Only keep comfort on semantic path when the user is in genuine deep distress.
    // Lightweight comfort expressions ("好想你", "睡不着", "心里难受") now go direct.
    return (
      LIGHTWEIGHT_COMFORT_KEEP_SEMANTIC_PATTERN.test(currentQuery) ||
      GRIEF_STRONG_DISTRESS_INTENT_PATTERN.test(currentQuery) ||
      GRIEF_OVERWHELMED_INTENT_PATTERN.test(currentQuery)
    );
  }

  private classifyDeterministicCorrectionIntent(
    currentQuery: string
  ): StructuredReplyIntent | undefined {
    if (
      !isForgetMemoryRequest(currentQuery) &&
      !EXPLICIT_FACT_CORRECTION_PATTERN.test(currentQuery)
    ) {
      return undefined;
    }

    return {
      intents: [
        {
          target: 'user',
          timeScope: 'current',
          intent: 'correct_assistant',
          subIntent: 'other',
          confidence: 0.99,
        },
      ],
      emotion: 'neutral',
      riskLevel: 'none',
      confidence: 0.99,
      source: 'hard_rule',
    };
  }

  private classifyDeterministicCounterfactualRegretIntent(
    currentQuery: string
  ): StructuredReplyIntent | undefined {
    if (!COUNTERFACTUAL_REGRET_INTENT_PATTERN.test(currentQuery)) {
      return undefined;
    }

    return {
      intents: [
        {
          target: 'user',
          timeScope: 'shared_past',
          intent: 'express_guilt',
          subIntent: 'other',
          confidence: 0.99,
        },
      ],
      emotion: 'guilt',
      riskLevel: 'none',
      confidence: 0.99,
      source: 'hard_rule',
    };
  }

  private classifyDeterministicAuthenticityOrMemoryGapIntent(
    currentQuery: string
  ): StructuredReplyIntent | undefined {
    const isFearOrRequestNotToForget =
      /(?:怕|担心|害怕|别|不要|求你).{0,10}(?:忘了我|把我忘了|不记得我)/.test(
        currentQuery
      );

    if (
      isFearOrRequestNotToForget ||
      !AUTHENTICITY_OR_MEMORY_GAP_PATTERN.test(currentQuery)
    ) {
      return undefined;
    }

    return {
      intents: [
        {
          target: 'relationship',
          timeScope: 'current',
          intent: 'challenge_authenticity',
          subIntent: 'other',
          confidence: 0.99,
        },
      ],
      emotion: 'concern',
      riskLevel: 'none',
      confidence: 0.99,
      source: 'hard_rule',
    };
  }

  private classifyDeterministicFamilyContinuation(
    options: ClassifyReplyIntentOptions
  ): StructuredReplyIntent | undefined {
    const currentQuery = options.currentQuery?.trim() || '';

    if (!FAMILY_HEALTH_CONTINUATION_PATTERN.test(currentQuery)) {
      return undefined;
    }

    const familyNames = (options.knownFamilyMembers || [])
      .map(name => name.trim())
      .filter(Boolean);
    const recentMessages = (options.recentMessages || [])
      .filter(
        message =>
          message.content?.trim() &&
          !(
            message.role === MessageRole.user &&
            message.content.trim() === currentQuery
          )
      )
      .slice(-6);
    const hasFamilyHealthContext = recentMessages.some(message => {
      if (message.role !== MessageRole.user) {
        return false;
      }

      const content = message.content.trim();
      const mentionsKnownFamilyMember = familyNames.some(name =>
        content.includes(name)
      );

      return (
        (mentionsKnownFamilyMember ||
          FAMILY_HEALTH_CONTEXT_PATTERN.test(content)) &&
        /身体|生病|住院|医院|检查|复查|指标|血压|血糖|不舒服|不好/.test(content)
      );
    });

    if (!hasFamilyHealthContext) {
      return undefined;
    }

    return {
      intents: [
        {
          target: 'family',
          timeScope: 'current',
          intent: 'share_family_update',
          subIntent: 'family_care',
          confidence: 0.98,
        },
      ],
      emotion: 'concern',
      riskLevel: 'none',
      confidence: 0.98,
      source: 'hard_rule',
    };
  }

  private classifyDeterministicEmotionalIntent(
    currentQuery: string
  ): StructuredReplyIntent | undefined {
    if (
      GRIEF_STRONG_DISTRESS_INTENT_PATTERN.test(currentQuery) ||
      GRIEF_OVERWHELMED_INTENT_PATTERN.test(currentQuery)
    ) {
      return {
        intents: [
          {
            target: 'user',
            timeScope: 'current',
            intent: 'seek_comfort',
            subIntent: 'grief_support',
            confidence: 0.99,
          },
        ],
        emotion: 'sadness',
        riskLevel: 'none',
        confidence: 0.99,
        source: 'hard_rule',
      };
    }

    if (isDreamConnectionIntent(currentQuery)) {
      return {
        intents: [
          {
            target: 'relationship',
            timeScope: isDreamVisitRequestIntent(currentQuery)
              ? 'future'
              : 'timeless',
            intent: 'seek_dream_connection',
            subIntent: 'reunion',
            confidence: 0.99,
          },
        ],
        emotion: 'longing',
        riskLevel: 'none',
        confidence: 0.99,
        source: 'hard_rule',
      };
    }

    if (
      RETURN_REUNION_WISH_INTENT_PATTERN.test(currentQuery) ||
      isReturnVisitRequestIntent(currentQuery)
    ) {
      return {
        intents: [
          {
            target: 'relationship',
            timeScope: 'future',
            intent: 'express_longing',
            subIntent: 'reunion',
            confidence: 0.99,
          },
        ],
        emotion: 'longing',
        riskLevel: 'none',
        confidence: 0.99,
        source: 'hard_rule',
      };
    }

    if (FAMILY_CARE_REGRET_INTENT_PATTERN.test(currentQuery)) {
      return {
        intents: [
          {
            target: 'family',
            timeScope: 'current',
            intent: 'share_family_update',
            subIntent: 'family_care',
            confidence: 0.98,
          },
          {
            target: 'relationship',
            timeScope: 'current',
            intent: 'express_family_care_regret',
            subIntent: 'family_care',
            confidence: 0.96,
          },
        ],
        emotion: 'sadness',
        riskLevel: 'none',
        confidence: 0.97,
        source: 'hard_rule',
      };
    }

    return undefined;
  }

  private classifyDeterministicMemoryIntent(
    currentQuery: string
  ): StructuredReplyIntent | undefined {
    if (!DIRECT_SHARED_MEMORY_QUERY_PATTERN.test(currentQuery)) {
      return undefined;
    }

    const intents: StructuredReplyIntentItem[] = [
      {
        target: 'agent',
        timeScope: 'shared_past',
        intent: 'recall_memory',
        subIntent: 'shared_memory',
        confidence: 0.99,
      },
    ];

    if (CURRENT_OR_FUTURE_WISH_PATTERN.test(currentQuery)) {
      intents.push({
        target: 'user',
        timeScope: 'future',
        intent: 'share_user_update',
        subIntent: 'other',
        confidence: 0.96,
      });
    }

    return {
      intents,
      emotion: 'longing',
      riskLevel: 'none',
      confidence: intents.length > 1 ? 0.97 : 0.99,
      source: 'hard_rule',
    };
  }

  private classifyDeterministicAgentStatus(
    currentQuery: string
  ): StructuredReplyIntent | undefined {
    const asksGeneralWellbeing =
      DIRECT_AGENT_WELLBEING_QUERY_PATTERN.test(currentQuery);

    if (
      !asksGeneralWellbeing &&
      (FIRST_PERSON_REFERENCE_PATTERN.test(currentQuery) ||
        DEATH_MOMENT_REFERENCE_PATTERN.test(currentQuery))
    ) {
      return undefined;
    }

    const subIntent: ReplyIntentSubIntent | undefined =
      DIRECT_AGENT_CURRENT_PAIN_QUERY_PATTERN.test(currentQuery)
        ? 'physical_pain'
        : asksGeneralWellbeing
        ? 'afterlife_wellbeing'
        : DIRECT_AGENT_MEAL_QUERY_PATTERN.test(currentQuery)
        ? 'meal'
        : DIRECT_AGENT_WAKE_QUERY_PATTERN.test(currentQuery)
        ? 'wake_sleep'
        : DIRECT_AGENT_WORK_QUERY_PATTERN.test(currentQuery)
        ? 'work_routine'
        : undefined;

    if (!subIntent) {
      return undefined;
    }

    return {
      intents: [
        {
          target: 'agent',
          timeScope: 'current',
          intent: 'ask_agent_status',
          subIntent,
          confidence: 0.99,
        },
      ],
      emotion: 'concern',
      riskLevel: 'none',
      confidence: 0.99,
      source: 'hard_rule',
    };
  }

  private buildClassifierInput(options: ClassifyReplyIntentOptions): string {
    const currentQuery = options.currentQuery.trim();
    const recentMessages = (options.recentMessages || []).filter(
      message =>
        (message.role === MessageRole.user ||
          message.role === MessageRole.assistant) &&
        Boolean(message.content?.trim())
    );
    const duplicateCurrentIndex = this.findLastDuplicateCurrentMessageIndex(
      recentMessages,
      currentQuery
    );
    const history = recentMessages
      .filter((_, index) => index !== duplicateCurrentIndex)
      .slice(-CLASSIFIER_MAX_HISTORY_MESSAGES)
      .map(message => {
        const role =
          message.role === MessageRole.user ? '用户' : '当前亲人角色';
        const strategyHint =
          message.role === MessageRole.assistant
            ? [
                message.replyUserConversationState
                  ? `s=${message.replyUserConversationState}`
                  : '',
                message.replyOpenLoop ? `open=${message.replyOpenLoop}` : '',
                message.replyContinuationGoal
                  ? `g=${message.replyContinuationGoal}`
                  : '',
                message.replyAssistantContribution
                  ? `a=${message.replyAssistantContribution}`
                  : '',
                message.replyMustContribute
                  ? `target=${message.replyMustContribute}`
                  : '',
                message.replyClosureReadiness
                  ? `close=${message.replyClosureReadiness}`
                  : '',
              ]
                .map(value => value?.trim())
                .filter(Boolean)
                .join(';')
            : '';
        return `${role}：${message.content
          .trim()
          .slice(0, CLASSIFIER_MAX_MESSAGE_LENGTH)}${
          strategyHint ? ` [上轮策略：${strategyHint.slice(0, 180)}]` : ''
        }`;
      })
      .join('\n');
    const knownFamilyMembers = Array.from(
      new Set(
        (options.knownFamilyMembers || [])
          .map(name => name.trim())
          .filter(Boolean)
      )
    )
      .slice(0, 12)
      .join('、');
    const knownObjects = (options.knownObjects || [])
      .filter(
        object => Boolean(object?.id?.trim()) && Boolean(object?.label?.trim())
      )
      .slice(0, CLASSIFIER_MAX_KNOWN_OBJECTS)
      .map(object => [
        object.id.trim().slice(0, 120),
        object.kind,
        object.label.trim().slice(0, 30),
        (object.relationToUser || object.relationToAgent || '')
          .trim()
          .slice(0, 30),
      ]);
    const memoryCandidates = (options.memoryCandidates || [])
      .filter(
        candidate =>
          Boolean(candidate?.key?.trim()) &&
          Boolean(candidate?.slot?.trim()) &&
          Boolean(candidate?.summary?.trim())
      )
      .slice(0, CLASSIFIER_MAX_MEMORY_CANDIDATES)
      .map(candidate => [
        candidate.slot.trim().slice(0, 60),
        candidate.key.trim().slice(0, 120),
        candidate.summary
          .trim()
          .replace(/\s+/g, ' ')
          .slice(0, CLASSIFIER_MAX_MEMORY_SUMMARY_LENGTH),
      ]);

    const consecutiveInputGuidance =
      /^用户连续输入（按发送顺序，共\d+条）：/.test(currentQuery)
        ? '连续输入判断：逐条识别延续、补充、修正、否定或转向。后句改变核心意图时，主意图必须切换到最新仍有效的核心意图；前句只保留仍有效的事实、情绪和未解决事项，不要平均分配回复。'
        : '';

    return [
      options.agentPersonaContext?.trim()
        ? `当前角色关系与人格上下文：${options.agentPersonaContext
            .trim()
            .replace(/\s+/g, ' ')
            .slice(0, 760)}`
        : '当前角色关系与人格上下文：未提供，请仅按最近对话保守判断',
      knownObjects.length
        ? `已确认对象（[id,kind,label,relation]）：${JSON.stringify(
            knownObjects
          )}`
        : knownFamilyMembers
        ? `已确认的其他共同家人：${knownFamilyMembers}`
        : '已确认的其他共同家人：无',
      history ? `最近对话：\n${history}` : '最近对话：无',
      consecutiveInputGuidance,
      `当前用户消息：${currentQuery}`,
      memoryCandidates.length
        ? `候选记忆（[slot,key,summary]，可全部不选）：${JSON.stringify(
            memoryCandidates
          )}`
        : '候选记忆：无',
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  private findLastDuplicateCurrentMessageIndex(
    messages: MessageEntity[],
    currentQuery: string
  ): number {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];

      if (
        message.role === MessageRole.user &&
        message.content?.trim() === currentQuery
      ) {
        return index;
      }
    }

    return -1;
  }

  private parseIntent(
    value: string,
    currentQuery: string,
    memoryCandidates?: ReplyIntentMemoryCandidate[],
    knownObjects?: ConversationKnownObject[]
  ): StructuredReplyIntent | undefined {
    const jsonText = this.extractJsonObjectText(value);

    if (!jsonText) {
      return undefined;
    }

    try {
      const parsed = JSON.parse(jsonText) as Record<string, unknown>;
      const emotion = this.readEnum(parsed.emotion, REPLY_INTENT_EMOTIONS);
      const riskLevel = this.readEnum(
        parsed.riskLevel,
        REPLY_INTENT_RISK_LEVELS
      );
      const rawIntents = Array.isArray(parsed.intents)
        ? parsed.intents.slice(0, 3)
        : [];
      const confidence =
        this.readConfidence(parsed.confidence) ||
        rawIntents
          .map(item =>
            item && typeof item === 'object'
              ? this.readConfidence(
                  (item as Record<string, unknown>).confidence
                )
              : undefined
          )
          .find(value => value !== undefined);
      const parsedIntents = rawIntents
        .map(item => this.parseIntentItem(item, confidence))
        .filter((item): item is StructuredReplyIntentItem => Boolean(item));
      const capabilityQuestions = this.parseCapabilityQuestions(
        parsed.capabilityQuestions,
        currentQuery
      );
      const objectPlan = this.parseConversationObjectPlan(
        parsed.objectPlan,
        currentQuery,
        knownObjects
      );
      const rawReading =
        parsed.reading && typeof parsed.reading === 'object'
          ? (parsed.reading as Record<string, unknown>)
          : undefined;
      const conversationPlan = this.parseConversationMovePlan(
        parsed.conversationPlan,
        currentQuery,
        objectPlan
      );
      const memoryPlan = this.parseConversationMemoryPlan(
        parsed.memoryPlan ?? rawReading?.memoryPlan,
        memoryCandidates
      );

      if (
        (!parsedIntents.length && !conversationPlan) ||
        !emotion ||
        !riskLevel ||
        confidence === undefined
      ) {
        return undefined;
      }

      const intents = (
        parsedIntents.length
          ? parsedIntents
          : [
              {
                target: 'relationship' as const,
                timeScope: 'current' as const,
                intent: 'smalltalk' as const,
                subIntent: 'other' as const,
                confidence,
              },
            ]
      )
        .map(item =>
          item.intent === 'crisis_support'
            ? {
                ...item,
                target: 'user' as const,
                timeScope: 'current' as const,
                intent: 'seek_comfort' as const,
                subIntent: 'grief_support' as const,
              }
            : item
        )
        .filter(
          (item, index, values) =>
            values.findIndex(
              candidate =>
                candidate.intent === item.intent &&
                candidate.target === item.target &&
                candidate.timeScope === item.timeScope &&
                candidate.subIntent === item.subIntent
            ) === index
        );

      if (!intents.length) {
        return undefined;
      }

      const result: StructuredReplyIntent = {
        intents,
        emotion: emotion as ReplyIntentEmotion,
        riskLevel: (riskLevel === 'high'
          ? 'none'
          : riskLevel) as ReplyIntentRiskLevel,
        confidence,
        source: 'semantic_model',
      };
      const reading = this.parseConversationReading(
        parsed.reading,
        currentQuery
      );

      if (capabilityQuestions.length) {
        result.capabilityQuestions = capabilityQuestions;
      }
      if (objectPlan) {
        result.objectPlan = objectPlan;
      }
      if (reading) {
        result.reading = reading;
      }
      if (conversationPlan) {
        result.conversationPlan = conversationPlan;
      }
      if (memoryPlan) {
        result.memoryPlan = memoryPlan;
      }

      return result;
    } catch {
      return undefined;
    }
  }

  private parseIntentItem(
    value: unknown,
    fallbackConfidence?: number
  ): StructuredReplyIntentItem | undefined {
    if (typeof value === 'string') {
      const intent = this.readEnum(value, REPLY_INTENT_KINDS);

      return intent && fallbackConfidence !== undefined
        ? {
            target: 'relationship',
            timeScope: 'current',
            intent: intent as ReplyIntentKind,
            subIntent: 'other',
            confidence: fallbackConfidence,
          }
        : undefined;
    }

    if (!value || typeof value !== 'object') {
      return undefined;
    }

    const item = value as Record<string, unknown>;
    const target = this.readEnum(item.target, REPLY_INTENT_TARGETS);
    const timeScope = this.readEnum(item.timeScope, REPLY_INTENT_TIME_SCOPES);
    const intent = this.readEnum(item.intent, REPLY_INTENT_KINDS);
    const subIntent = this.readEnum(item.subIntent, REPLY_INTENT_SUB_INTENTS);
    const confidence =
      this.readConfidence(item.confidence) ?? fallbackConfidence;

    if (
      !target ||
      !timeScope ||
      !intent ||
      !subIntent ||
      confidence === undefined
    ) {
      return undefined;
    }

    return {
      target: target as ReplyIntentTarget,
      timeScope: timeScope as ReplyIntentTimeScope,
      intent: intent as ReplyIntentKind,
      subIntent: subIntent as ReplyIntentSubIntent,
      confidence,
    };
  }

  private parseCapabilityQuestions(
    value: unknown,
    currentQuery: string
  ): StructuredReplyCapabilityQuestion[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .slice(0, 3)
      .map(item => this.parseCapabilityQuestion(item, currentQuery))
      .filter((item): item is StructuredReplyCapabilityQuestion =>
        Boolean(item)
      )
      .filter(
        (item, index, items) =>
          items.findIndex(
            candidate =>
              candidate.subject === item.subject &&
              candidate.channel === item.channel
          ) === index
      );
  }

  private parseConversationReading(
    value: unknown,
    currentQuery: string
  ): ConversationReading | undefined {
    if (!value || typeof value !== 'object') {
      return undefined;
    }

    const item = value as Record<string, unknown>;
    const primaryNeed = this.readShortText(item.primaryNeed, 120);
    const emotionalSource = this.readShortText(item.emotionalSource, 120);
    const relationshipSignal = this.readShortText(item.relationshipSignal, 60);
    const suggestedTone = this.readShortText(item.suggestedTone, 60);
    const relationshipStance = this.readEnum(
      item.relationshipStance,
      CONVERSATION_RELATIONSHIP_STANCES
    );

    if (
      !primaryNeed ||
      !emotionalSource ||
      !relationshipSignal ||
      !suggestedTone
    ) {
      return undefined;
    }

    const anchors = this.parseReadingAnchors(item.anchors, currentQuery);

    if (!anchors.length) {
      return undefined;
    }

    return {
      primaryNeed,
      emotionalSource,
      anchors,
      corrections: this.parseCurrentQueryExcerpts(
        item.corrections,
        currentQuery
      ),
      negations: this.parseCurrentQueryExcerpts(item.negations, currentQuery),
      questionsToAnswer: this.parseCurrentQueryExcerpts(
        item.questionsToAnswer,
        currentQuery
      ),
      relationshipSignal,
      ...(relationshipStance
        ? {
            relationshipStance:
              relationshipStance as ConversationRelationshipStance,
          }
        : {}),
      uncertainties: this.parseShortTextList(item.uncertainties, 4, 100),
      suggestedTone,
    };
  }

  private parseConversationMovePlan(
    value: unknown,
    currentQuery = '',
    objectPlan?: ConversationObjectPlan
  ): ConversationMovePlan | undefined {
    if (!value || typeof value !== 'object') {
      return undefined;
    }

    const item = value as Record<string, unknown>;
    const stance = this.readEnum(item.stance, CONVERSATION_STANCES);
    const explicitStanceTarget = this.readShortText(item.stanceTarget, 100);
    const socialStrategy = this.readEnum(
      item.socialStrategy,
      CONVERSATION_SOCIAL_STRATEGIES
    );
    const explicitStrategyPurpose = this.readShortText(
      item.strategyPurpose,
      120
    );
    const questionNeed = this.readEnum(
      item.questionNeed,
      CONVERSATION_QUESTION_NEEDS
    );
    const turnClosure = this.readEnum(
      item.turnClosure,
      CONVERSATION_TURN_CLOSURES
    );
    const moves = Array.isArray(item.moves)
      ? item.moves
          .slice(0, 3)
          .map(raw => this.parseConversationMove(raw))
          .filter((move): move is ConversationMove => Boolean(move))
      : [];
    const stanceTarget =
      explicitStanceTarget || currentQuery.trim().slice(0, 100);
    const strategyPurpose =
      explicitStrategyPurpose || moves[0]?.goal || stanceTarget;

    if (
      !stance ||
      !stanceTarget ||
      !socialStrategy ||
      !strategyPurpose ||
      !questionNeed ||
      !turnClosure ||
      !moves.length
    ) {
      return undefined;
    }

    const turnPlan = this.parseConversationTurnPlan(item.turnPlan, objectPlan);
    const fallbackEngagement = this.buildConversationEngagementFallback({
      moves,
      stanceTarget,
      strategyPurpose,
      turnClosure,
    });
    const engagement =
      (turnPlan ? turnPlanToEngagement(turnPlan) : undefined) ||
      this.parseConversationEngagementPlan(
        item.engagement,
        fallbackEngagement
      ) ||
      fallbackEngagement;

    return {
      stance,
      stanceTarget,
      moves,
      socialStrategy,
      strategyPurpose,
      questionNeed,
      turnClosure,
      personaActivation: this.parseShortTextList(item.personaActivation, 3, 70),
      ...(turnPlan ? { turnPlan } : {}),
      ...(engagement ? { engagement } : {}),
    };
  }

  private parseConversationTurnPlan(
    value: unknown,
    objectPlan?: ConversationObjectPlan
  ): ConversationTurnPlan | undefined {
    if (!value || typeof value !== 'object') {
      return undefined;
    }

    const item = value as Record<string, unknown>;
    const state = this.readEnum(item.state, CONVERSATION_USER_STATES);
    const goal = this.readEnum(item.goal, CONVERSATION_CONTINUATION_GOALS);
    const action = this.readEnum(
      item.action,
      CONVERSATION_ASSISTANT_CONTRIBUTIONS
    );
    const target = this.readShortText(item.target, 100);
    const avoid = this.readEnum(item.avoid, CONVERSATION_AVOID_ACTIONS);
    const close = this.readEnum(item.close, CONVERSATION_CLOSURE_READINESS);
    const allowedObjects = new Set([
      'agent',
      'user',
      'unknown',
      ...(objectPlan?.objects.map(object => object.ref) || []),
    ]);
    const open = Array.isArray(item.open)
      ? item.open
          .slice(0, 2)
          .map(raw => this.parseConversationTurnOpenPoint(raw, allowedObjects))
          .filter((point): point is ConversationTurnOpenPoint => Boolean(point))
      : [];

    if (
      !state ||
      !goal ||
      !action ||
      !target ||
      !avoid ||
      !close ||
      (close === 'blocked' && !open.length)
    ) {
      return undefined;
    }

    return {
      state,
      open: close === 'ready' ? [] : open,
      goal,
      action,
      target,
      avoid,
      close,
    };
  }

  private parseConversationTurnOpenPoint(
    value: unknown,
    allowedObjects: Set<string>
  ): ConversationTurnOpenPoint | undefined {
    if (!value || typeof value !== 'object') {
      return undefined;
    }

    const item = value as Record<string, unknown>;
    const object = this.readShortText(item.object, 20);
    const need = this.readEnum(item.need, CONVERSATION_OPEN_NEEDS);
    const detail = this.readShortText(item.detail, 80);
    const priority = this.readEnum(item.priority, CONVERSATION_OPEN_PRIORITIES);

    if (
      !object ||
      !allowedObjects.has(object) ||
      !need ||
      !detail ||
      !priority
    ) {
      return undefined;
    }

    return { object, need, detail, priority };
  }

  private parseConversationObjectPlan(
    value: unknown,
    currentQuery: string,
    knownObjects?: ConversationKnownObject[]
  ): ConversationObjectPlan | undefined {
    if (!value || typeof value !== 'object') {
      return undefined;
    }

    const item = value as Record<string, unknown>;
    const allowedBindings = new Set([
      'agent',
      'user',
      'unknown',
      ...(knownObjects || []).map(object => object.id),
    ]);
    const objects = Array.isArray(item.objects)
      ? item.objects
          .slice(0, 6)
          .map(raw =>
            this.parseConversationObjectReference(
              raw,
              currentQuery,
              allowedBindings
            )
          )
          .filter((object): object is ConversationObjectReference =>
            Boolean(object)
          )
          .filter(
            (object, index, values) =>
              values.findIndex(candidate => candidate.ref === object.ref) ===
              index
          )
      : [];
    const refs = new Set(objects.map(object => object.ref));
    const focusRefs = this.parseShortTextList(item.focusRefs, 3, 20).filter(
      ref => refs.has(ref)
    );
    const ambiguousMentions = this.parseShortTextList(
      item.ambiguousMentions,
      3,
      30
    ).filter(mention => currentQuery.includes(mention));

    if (objects.length < 2 && !ambiguousMentions.length) {
      return undefined;
    }

    return {
      objects,
      focusRefs,
      ambiguousMentions,
    };
  }

  private parseConversationObjectReference(
    value: unknown,
    currentQuery: string,
    allowedBindings: Set<string>
  ): ConversationObjectReference | undefined {
    if (!value || typeof value !== 'object') {
      return undefined;
    }

    const item = value as Record<string, unknown>;
    const ref = this.readShortText(item.ref, 20);
    const mention = this.readShortText(item.mention, 30);
    const kind = this.readEnum(item.kind, CONVERSATION_OBJECT_KINDS);
    const binding = this.readShortText(item.binding, 120);
    const confidence = this.readEnum(
      item.confidence,
      CONVERSATION_OBJECT_CONFIDENCES
    );

    if (
      !ref ||
      !mention ||
      !currentQuery.includes(mention) ||
      !kind ||
      !binding ||
      !allowedBindings.has(binding) ||
      !confidence
    ) {
      return undefined;
    }

    return { ref, mention, kind, binding, confidence };
  }

  private hasMultipleRelevantKnownObjects(
    currentQuery: string,
    knownObjects?: ConversationKnownObject[]
  ): boolean {
    const mentioned = (knownObjects || []).filter(object =>
      object.aliases.some(
        alias => alias.length > 1 && currentQuery.includes(alias)
      )
    );
    const otherObjects = mentioned.filter(
      object => object.id !== 'agent' && object.id !== 'user'
    );

    return (
      otherObjects.length >= 2 ||
      (otherObjects.length === 1 && mentioned.length >= 2)
    );
  }

  private buildConversationEngagementFallback(options: {
    moves: ConversationMove[];
    stanceTarget: string;
    strategyPurpose: string;
    turnClosure: ConversationMovePlan['turnClosure'];
  }): ConversationEngagementPlan {
    const primaryMove = options.moves[0];
    const context = `${options.stanceTarget} ${
      options.strategyPurpose
    } ${options.moves.map(move => move.goal).join(' ')}`;
    const isClosing =
      options.turnClosure === 'close' ||
      options.moves.some(move => move.type === 'close');
    const isSelfExpression = options.moves.some(
      move => move.type === 'self_disclose'
    );
    const isRepair =
      /关系断点|修复|可信|疏离|忽视|不安|话少|说了也没用|讲了也没用/.test(
        context
      );
    const hasUnresolvedEmotion =
      /自责|道歉|愧疚|不怪|不恨|没人回应|无人回应/.test(context);

    return {
      userConversationState: isClosing
        ? 'closing'
        : isRepair
        ? 'repairing'
        : isSelfExpression || hasUnresolvedEmotion
        ? 'deepening'
        : 'exploring',
      openLoop: isClosing
        ? '用户已准备结束本轮'
        : `等待完成：${primaryMove.goal}`,
      continuationGoal: isClosing
        ? 'close'
        : isRepair
        ? 'repair'
        : isSelfExpression
        ? 'deepen'
        : 'hold',
      assistantContribution: this.mapMoveToAssistantContribution(
        primaryMove.type
      ),
      mustContribute: primaryMove.goal,
      avoidRepeatingMove: '不要只重复最近一次回复或承诺以后再改变',
      closureReadiness: isClosing
        ? 'ready'
        : isRepair || isSelfExpression || hasUnresolvedEmotion
        ? 'blocked'
        : 'possible',
    };
  }

  private mapMoveToAssistantContribution(
    type: ConversationMove['type']
  ): ConversationEngagementPlan['assistantContribution'] {
    switch (type) {
      case 'answer':
        return 'answer';
      case 'ask':
        return 'question';
      case 'comfort':
        return 'affection';
      case 'self_disclose':
        return 'self_expression';
      case 'leave_space':
      case 'close':
        return 'strategic_silence';
      default:
        return 'stance';
    }
  }

  private parseConversationEngagementPlan(
    value: unknown,
    fallback?: ConversationEngagementPlan
  ): ConversationEngagementPlan | undefined {
    if (!value || typeof value !== 'object') {
      return undefined;
    }

    const item = value as Record<string, unknown>;
    const userConversationState =
      this.readEnum(item.userConversationState, CONVERSATION_USER_STATES) ||
      fallback?.userConversationState;
    const continuationGoal =
      this.readEnum(item.continuationGoal, CONVERSATION_CONTINUATION_GOALS) ||
      fallback?.continuationGoal;
    const assistantContribution =
      this.readEnum(
        item.assistantContribution,
        CONVERSATION_ASSISTANT_CONTRIBUTIONS
      ) || fallback?.assistantContribution;
    const closureReadiness =
      this.readEnum(item.closureReadiness, CONVERSATION_CLOSURE_READINESS) ||
      fallback?.closureReadiness;
    const openLoop =
      this.readShortText(item.openLoop, 120) || fallback?.openLoop;
    const mustContribute =
      this.readShortText(item.mustContribute, 140) || fallback?.mustContribute;
    const avoidRepeatingMove =
      this.readShortText(item.avoidRepeatingMove, 120) ||
      fallback?.avoidRepeatingMove;

    if (
      !userConversationState ||
      !continuationGoal ||
      !assistantContribution ||
      !closureReadiness ||
      !openLoop ||
      !mustContribute ||
      !avoidRepeatingMove
    ) {
      return undefined;
    }

    return {
      userConversationState,
      openLoop,
      continuationGoal,
      assistantContribution,
      mustContribute,
      avoidRepeatingMove,
      closureReadiness,
    };
  }

  private parseConversationMove(value: unknown): ConversationMove | undefined {
    if (!value || typeof value !== 'object') {
      return undefined;
    }

    const item = value as Record<string, unknown>;
    const type = this.readEnum(item.type, CONVERSATION_MOVE_TYPES);
    const goal =
      this.readShortText(item.goal, 110) ||
      this.readShortText(item.content, 110);
    return type && goal ? { type, goal } : undefined;
  }

  private parseConversationMemoryPlan(
    value: unknown,
    memoryCandidates?: ReplyIntentMemoryCandidate[]
  ): ConversationMemoryPlan | undefined {
    if (!value || typeof value !== 'object') {
      return undefined;
    }

    const item = value as Record<string, unknown>;
    const contextCoverage =
      item.contextCoverage === 'complete' || item.contextCoverage === 'missing'
        ? item.contextCoverage
        : item.status === 'complete'
        ? 'complete'
        : item.status === 'missing'
        ? 'missing'
        : item.need === 'none'
        ? 'complete'
        : item.need === 'retrieve' ||
          item.need === 'helpful' ||
          item.need === 'required'
        ? 'missing'
        : undefined;

    if (!contextCoverage) {
      return undefined;
    }

    const missingConcepts =
      contextCoverage === 'missing'
        ? this.parseShortTextList(item.missingConcepts, 4, 100)
        : [];
    const queries =
      contextCoverage === 'missing' && Array.isArray(item.queries)
        ? item.queries
            .slice(0, 4)
            .map(raw => this.parseConversationMemoryPlanQuery(raw))
            .filter((query): query is ConversationMemoryPlanQuery =>
              Boolean(query)
            )
        : [];
    const allowedCandidateKeys = new Set(
      (memoryCandidates || [])
        .slice(0, CLASSIFIER_MAX_MEMORY_CANDIDATES)
        .map(candidate => candidate.key?.trim())
        .filter((key): key is string => Boolean(key))
    );
    const selectedFactKeys =
      contextCoverage === 'missing' &&
      allowedCandidateKeys.size &&
      Array.isArray(item.selectedFactKeys)
        ? Array.from(
            new Set(
              item.selectedFactKeys
                .map(raw => this.readShortText(raw, 120))
                .filter(
                  (key): key is string =>
                    Boolean(key) && allowedCandidateKeys.has(key)
                )
            )
          ).slice(0, 4)
        : [];

    return {
      need: contextCoverage === 'missing' ? 'retrieve' : 'none',
      contextCoverage,
      missingConcepts,
      queries,
      ...(selectedFactKeys.length ? { selectedFactKeys } : {}),
    };
  }

  private parseMemoryPlanFromClassifierOutput(
    value: string,
    memoryCandidates?: ReplyIntentMemoryCandidate[]
  ): ConversationMemoryPlan | undefined {
    const memoryPlanText = this.extractNamedJsonObject(value, 'memoryPlan');

    if (!memoryPlanText) {
      return undefined;
    }

    try {
      return this.parseConversationMemoryPlan(
        JSON.parse(memoryPlanText),
        memoryCandidates
      );
    } catch {
      return undefined;
    }
  }

  private extractNamedJsonObject(
    value: string,
    propertyName: string
  ): string | undefined {
    const markerIndex = value.indexOf(`"${propertyName}"`);

    if (markerIndex < 0) {
      return undefined;
    }

    const objectStart = value.indexOf('{', markerIndex + propertyName.length);

    if (objectStart < 0) {
      return undefined;
    }

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = objectStart; index < value.length; index += 1) {
      const character = value[index];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (character === '\\') {
          escaped = true;
        } else if (character === '"') {
          inString = false;
        }
        continue;
      }

      if (character === '"') {
        inString = true;
        continue;
      }
      if (character === '{') {
        depth += 1;
      } else if (character === '}') {
        depth -= 1;

        if (depth === 0) {
          return value.slice(objectStart, index + 1);
        }
      }
    }

    return undefined;
  }

  private parseConversationMemoryPlanQuery(
    value: unknown
  ): ConversationMemoryPlanQuery | undefined {
    if (typeof value === 'string') {
      const question = this.readShortText(value, 120);

      return question
        ? {
            question,
            expectedUse: 'apply',
            importance: 'required',
            entityHint: question.slice(0, 120),
          }
        : undefined;
    }

    if (!value || typeof value !== 'object') {
      return undefined;
    }

    const item = value as Record<string, unknown>;
    const question = this.readShortText(
      item.question ?? item.query ?? item.text,
      120
    );
    const rawExpectedUse = item.expectedUse ?? item.expected_use;
    const expectedUse =
      rawExpectedUse === undefined
        ? 'apply'
        : rawExpectedUse === 'mention' ||
          rawExpectedUse === 'apply' ||
          rawExpectedUse === 'suppress'
        ? rawExpectedUse
        : undefined;
    const rawImportance = item.importance;
    const importance =
      rawImportance === undefined
        ? 'required'
        : rawImportance === 'required' || rawImportance === 'supporting'
        ? rawImportance
        : undefined;
    const entityHint =
      this.readShortText(
        item.entityHint ?? item.entity_hint ?? item.entity ?? item.topic,
        120
      ) || question?.slice(0, 120);

    if (!question || !expectedUse || !importance || !entityHint) {
      return undefined;
    }

    return { question, expectedUse, importance, entityHint };
  }

  private parseReadingAnchors(
    value: unknown,
    currentQuery: string
  ): ConversationReadingAnchor[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .slice(0, 3)
      .map(raw => {
        if (!raw || typeof raw !== 'object') {
          return undefined;
        }

        const item = raw as Record<string, unknown>;
        const text = this.readShortText(item.text, 120);
        const importance =
          item.importance === 'high' || item.importance === 'medium'
            ? item.importance
            : undefined;

        if (!text || !importance || !currentQuery.includes(text)) {
          return undefined;
        }

        return { text, importance };
      })
      .filter((anchor): anchor is ConversationReadingAnchor => Boolean(anchor))
      .filter(
        (anchor, index, anchors) =>
          anchors.findIndex(candidate => candidate.text === anchor.text) ===
          index
      );
  }

  private parseCurrentQueryExcerpts(
    value: unknown,
    currentQuery: string
  ): string[] {
    return this.parseShortTextList(value, 4, 120).filter(text =>
      currentQuery.includes(text)
    );
  }

  private parseShortTextList(
    value: unknown,
    maxItems: number,
    maxLength: number
  ): string[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .slice(0, maxItems)
      .map(item => this.readShortText(item, maxLength))
      .filter((item): item is string => Boolean(item))
      .filter((item, index, items) => items.indexOf(item) === index);
  }

  private readShortText(value: unknown, maxLength: number): string {
    return typeof value === 'string'
      ? value.trim().replace(/\s+/g, ' ').slice(0, maxLength)
      : '';
  }

  private parseCapabilityQuestion(
    value: unknown,
    currentQuery: string
  ): StructuredReplyCapabilityQuestion | undefined {
    if (!value || typeof value !== 'object') {
      return undefined;
    }

    const item = value as Record<string, unknown>;
    const subject = this.readEnum(item.subject, REPLY_CAPABILITY_SUBJECTS);
    const channel = this.readEnum(item.channel, REPLY_CAPABILITY_CHANNELS);
    const evidence =
      typeof item.evidence === 'string' ? item.evidence.trim() : '';
    const confidence = this.readConfidence(item.confidence);

    if (
      !subject ||
      !channel ||
      !evidence ||
      !currentQuery.includes(evidence) ||
      confidence === undefined
    ) {
      return undefined;
    }

    return {
      subject,
      channel,
      evidence: evidence.slice(0, 80),
      confidence,
    };
  }

  private extractJsonObjectText(value: string): string {
    const trimmed = value?.trim() || '';
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');

    return start >= 0 && end > start ? trimmed.slice(start, end + 1) : '';
  }

  private readEnum<T extends readonly string[]>(
    value: unknown,
    allowed: T
  ): T[number] | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }

    const normalized = value.trim();
    return allowed.includes(normalized as T[number])
      ? (normalized as T[number])
      : undefined;
  }

  private readConfidence(value: unknown): number | undefined {
    const parsed =
      typeof value === 'number'
        ? value
        : typeof value === 'string'
        ? Number(value)
        : NaN;

    if (!Number.isFinite(parsed)) {
      return undefined;
    }

    return Math.max(0, Math.min(1, parsed));
  }

  private resolveTimeoutMs(): number {
    const value = this.config?.timeoutMs;

    return typeof value === 'number' && Number.isFinite(value) && value >= 500
      ? Math.min(Math.round(value), 12000)
      : 10000;
  }
}
