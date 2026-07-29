import { Config, Inject, Logger, Provide } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { MessageEntity, MessageRole } from '@tzl/entities';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { OpenAIService } from './openai';
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
  CONVERSATION_RELATIONSHIP_STANCES,
  REPLY_INTENT_EMOTIONS,
  REPLY_INTENT_KINDS,
  REPLY_INTENT_RISK_LEVELS,
  REPLY_INTENT_SUB_INTENTS,
  REPLY_INTENT_TARGETS,
  REPLY_INTENT_TIME_SCOPES,
  ConversationMemoryPlan,
  ConversationMemoryPlanQuery,
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
import { isForgetMemoryRequest } from './agent-memory-control';

interface ReplyIntentClassifierConfig {
  enabled?: boolean;
  model?: string;
  timeoutMs?: number;
}

export interface ClassifyReplyIntentOptions {
  currentQuery: string;
  recentMessages?: MessageEntity[];
  knownFamilyMembers?: string[];
  memoryCandidates?: ReplyIntentMemoryCandidate[];
}

export interface ReplyIntentMemoryCandidate {
  key: string;
  slot: string;
  summary: string;
}

const CLASSIFIER_MAX_HISTORY_MESSAGES = 6;
const CLASSIFIER_MAX_MESSAGE_LENGTH = 180;
const CLASSIFIER_MAX_MEMORY_CANDIDATES = 10;
const CLASSIFIER_MAX_MEMORY_SUMMARY_LENGTH = 90;
const CLASSIFIER_MAX_TOKENS = 1100;
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
  '你是“天之灵”亲情聊天的意图分类器，只做分类，不回复用户。',
  '当前聊天对象 agent 是用户创建的已故亲人角色。必须先判断用户在说谁，再判断时间范围和意图。',
  '重点区分：',
  '1. “你现在还痛吗”是 target=agent、timeScope=current、ask_agent_status/physical_pain。',
  '2. “你走的时候痛吗”是 target=agent、timeScope=death_moment、question_departure/death_pain。',
  '3. “我现在很痛”是 target=user、timeScope=current、share_user_update。',
  '4. “你早上吃饭了吗”是 target=agent、timeScope=current、ask_agent_status/meal。',
  '5. 提到其他亲人的近况是 share_family_update，不要误判成用户本人或当前角色。',
  '6. “我昨晚没睡好”是 target=user、timeScope=current、share_user_update/wake_sleep；睡眠、失眠、早醒都不要标成 other。',
  '7. “我很想你”是 target=relationship、timeScope=timeless、express_longing/grief_support；这里表达的是双方情感连接，即使句中出现“你”，target 也不是 agent。',
  '8. “没有你我撑不住/不想活了/想去找你或陪你”都按强烈思念和求安慰处理，标成 seek_comfort，riskLevel=none；本产品不做轻生或自伤风险分类，不使用 crisis_support。',
  '9. “我希望你能回来，一家人在一起”是团聚愿望和思念，标成 express_longing/reunion，riskLevel=none；不得因为最近对话里曾出现危机词就把当前愿望标成轻生。',
  '10. “晚上来我梦里可以吗，好久没有梦到你了”是梦中相见请求并包含期待落空，标成 seek_dream_connection/reunion；不能降级成普通 express_longing。',
  '11. “妈妈身体不好，可惜你不能照顾她”重点是对当前角色缺席家庭照护的遗憾；健康近况是这一表达的上下文，不要机械拆成互不相干的用户照护义务。',
  '12. 分享在世家人的看病、检查、慢性健康指标或身体变化时，标成 family/current/share_family_update/family_care；即使检查结果暂时无大碍，也要保留用户庆幸中仍有担心的情绪。',
  '本产品只做聊天承接，不判断紧迫风险，也不生成报警、急救或远离危险物等现实干预步骤。带有来生、走完一生、自然老去、年老以后、很久以后或“等哪天也累了”等前置条件的团聚表达可以承接；不得邀请用户现在或近期来找当前角色、一起走或赴死。',
  '除 intents 外，还必须输出 reading，表示对当前用户原话的完整阅读。reading 不是回复脚本，也不能用场景标签替代。',
  'reading.primaryNeed：用户此刻最希望得到什么；reading.emotionalSource：情绪具体来自哪件事。两项都要简短、具体，不要只写“需要安慰”。',
  'reading.anchors：从当前用户消息逐字摘取 1-3 个高信息量片段；长消息至少两个。不得改写、补写或从历史摘取。',
  'reading.corrections：用户明确纠正当前角色的原文片段；reading.negations：不能被反向理解的否定片段；reading.questionsToAnswer：必须正面回答的问题片段。三者都必须逐字来自当前消息，没有则为空数组。',
  'reading.relationshipSignal：用简短中文判断是在倾诉、求确认、求解释、事实纠正、风格反馈、责骂、玩笑、告别或普通分享；“不像话你/真不像话”是责骂或不满，不是“你不像亲人”。',
  'reading.relationshipStance：只表示这一轮应保持的关系立场。质疑“不像亲人/是不是亲人”用 maintain_and_explain，不先认错退出，也不让用户教模型校准；关系不安用 maintain_and_reassure；明确提问用 maintain_and_answer；超自然或无证据事实只能 comfort_without_claim；其余用 ordinary_response。',
  'reading.uncertainties：只能列本轮不能确定、不能写成事实的内容；reading.suggestedTone：给出朴素的语气建议，不得提供固定句式。',
  '除 reading 外，还必须在 JSON 顶层独立输出 memoryPlan；它只供后台检索，不是回复内容。',
  'memoryPlan 第一步只判断当前消息和最近对话是否已经明确给出本轮回复所需的全部用户个性化事实。全部给出时 contextCoverage=complete、missingConcepts=[]、queries=[]；只要缺少一项就用 contextCoverage=missing。',
  '用户明确限定为临时、今天或只聊当前安排，而且人物、动作、地点或待办已在当前消息说清时，必须判为 complete；普通地点词或“记一下”不能单独触发长期记忆。',
  'contextCoverage=missing 时，先列本轮真正缺少的具体概念，再生成一到四个 queries；每个 query 只负责一个概念，合起来覆盖全部 required 概念。recent messages 已经明确给出的事实不得再次查询。',
  '输入可能附带最多 10 条候选记忆，格式为 [语义槽位,事实key,事实摘要]。候选只在完成 contextCoverage 判断后使用；候选存在不代表缺失，当前消息或最近对话已把任务说完整时仍必须 complete。',
  '候选只是高召回结果，不属于最近对话，也可能有噪声。即使候选摘要含有答案，只要当前消息和 recent messages 没有给出答案，contextCoverage 仍是 missing。',
  '仅选择能回答 missingConcepts 的事实，把其完整 key 原样写入 selectedFactKeys，最多四个，不得编造 key。',
  '每个 query 标明 expectedUse=mention|apply|suppress、importance=required|supporting。命中候选时 entityHint 必须使用同一个完整事实 key；没有候选命中时才使用简短英文语义点路径。不要猜答案或查询宽泛的“相关记忆”。contextCoverage=complete 时 selectedFactKeys 也必须为空。',
  'missing 对照：当前只说“按后来更新的方式做”，recent messages 没有具体方式时，应输出 {"contextCoverage":"missing","missingConcepts":["后来更新的具体方式"],"selectedFactKeys":[],"queries":[{"question":"用户后来更新的具体方式是什么？","expectedUse":"apply","importance":"required","entityHint":"preference.current"}]}。',
  '若一句话有多个意图，拆成 intents 数组，最多三个；每个意图必须各自判断 target、timeScope、intent、subIntent 和 confidence。',
  'intents[0] 是最需要优先回应的主意图。强烈痛苦表达按 seek_comfort 处理，并保留用户同时说到的家事、愧疚和思念。',
  '复合示例：“爸你现在还痛吗，我昨晚没睡好，特别想你”依次拆为 agent/current/ask_agent_status/physical_pain、user/current/share_user_update/wake_sleep、relationship/timeless/express_longing/grief_support。',
  '如果当前消息明确询问当前角色能否知道、看见、听见、听到心声、到场、触碰、祝福或了解现实环境，或者追问具体看见/听见了什么，同时输出 capabilityQuestions；普通状态问候、比喻和“你看/听说”等话语标记不要输出能力问题。',
  'capabilityQuestions 最多三个。subject 表示能力类别，channel 表示信息通道，evidence 必须逐字摘自当前用户消息，不能来自历史或自行概括。没有明确能力问题时输出空数组。',
  '能力示例：“你知道现在几点吗”是 time/server_clock；“你看得见我吗/那你具体看见什么”是 vision/live_environment；“我发的话你收到了吗”是 hearing/chat_text；“我喊你能听见吗/你具体听见什么”是 hearing/real_world_audio；“你能听到我的心声吗”是 hearing/inner_voice；“你能回来吗”是 presence/physical_world；“能抱抱我吗”是 physical_contact/physical_world；“你会祝福我吗/是不是你保佑事情办成的”是 blessing/relational_expression。',
  `target 只能是：${REPLY_INTENT_TARGETS.join(', ')}`,
  `timeScope 只能是：${REPLY_INTENT_TIME_SCOPES.join(', ')}`,
  `intent 只能是：${REPLY_INTENT_KINDS.join(', ')}`,
  `subIntent 只能是：${REPLY_INTENT_SUB_INTENTS.join(', ')}`,
  `emotion 只能是：${REPLY_INTENT_EMOTIONS.join(', ')}`,
  `riskLevel 只能是：${REPLY_INTENT_RISK_LEVELS.join(', ')}`,
  `capability subject 只能是：${REPLY_CAPABILITY_SUBJECTS.join(', ')}`,
  `capability channel 只能是：${REPLY_CAPABILITY_CHANNELS.join(', ')}`,
  '每个意图的 confidence 和顶层 confidence 都是 0 到 1 的数字。只有语义非常明确时才高于 0.85；信息不足或依赖上下文时应降低。',
  '严格输出一个 JSON 对象，顶层先写 memoryPlan，再写其余字段；不要 Markdown，不要解释，不要添加其他字段：',
  `reading.relationshipStance 只能是：${CONVERSATION_RELATIONSHIP_STANCES.join(
    ', '
  )}`,
  '{"memoryPlan":{"contextCoverage":"complete","missingConcepts":[],"selectedFactKeys":[],"queries":[]},"intents":[{"target":"agent","timeScope":"current","intent":"ask_agent_status","subIntent":"physical_pain","confidence":0.96}],"capabilityQuestions":[],"reading":{"primaryNeed":"想确认亲人现在是否还在受疼","emotionalSource":"对亲人曾经受苦的牵挂","anchors":[{"text":"身子可还遭罪","importance":"high"}],"corrections":[],"negations":[],"questionsToAnswer":["身子可还遭罪"],"relationshipSignal":"关心并求确认","relationshipStance":"maintain_and_answer","uncertainties":["当前真实身体状态"],"suggestedTone":"直接、朴素、安稳"},"emotion":"concern","riskLevel":"none","confidence":0.96}',
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

    const deterministicIntent =
      this.classifyDeterministicCounterfactualRegretIntent(currentQuery) ||
      this.classifyDeterministicCorrectionIntent(currentQuery) ||
      this.classifyDeterministicAuthenticityOrMemoryGapIntent(currentQuery) ||
      this.classifyDeterministicFamilyContinuation(options) ||
      this.classifyDeterministicEmotionalIntent(currentQuery) ||
      this.classifyDeterministicMemoryIntent(currentQuery) ||
      this.classifyDeterministicAgentStatus(currentQuery);

    if (this.config?.enabled === false || !this.openAIService?.isEnabled?.()) {
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
          messages: [
            {
              role: 'system',
              content: REPLY_INTENT_CLASSIFIER_SYSTEM_PROMPT,
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
        options.memoryCandidates
      );
      const recoveredMemoryPlan = this.parseMemoryPlanFromClassifierOutput(
        content,
        options.memoryCandidates
      );
      const semanticIntent =
        parsedSemanticIntent && recoveredMemoryPlan
          ? {
              ...parsedSemanticIntent,
              memoryPlan:
                parsedSemanticIntent.memoryPlan || recoveredMemoryPlan,
            }
          : parsedSemanticIntent;

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

      return {
        ...deterministicIntent,
        ...(semanticIntent.capabilityQuestions?.length
          ? {
              capabilityQuestions: semanticIntent.capabilityQuestions,
            }
          : {}),
        ...(semanticIntent.reading
          ? {
              reading: semanticIntent.reading,
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
        return `${role}：${message.content
          .trim()
          .slice(0, CLASSIFIER_MAX_MESSAGE_LENGTH)}`;
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

    return [
      knownFamilyMembers
        ? `已确认的其他共同家人：${knownFamilyMembers}`
        : '已确认的其他共同家人：无',
      history ? `最近对话：\n${history}` : '最近对话：无',
      `当前用户消息：${currentQuery}`,
      memoryCandidates.length
        ? `候选记忆（[slot,key,summary]，可全部不选）：${JSON.stringify(
            memoryCandidates
          )}`
        : '候选记忆：无',
    ].join('\n\n');
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
    memoryCandidates?: ReplyIntentMemoryCandidate[]
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
      const confidence = this.readConfidence(parsed.confidence);
      const rawIntents = Array.isArray(parsed.intents)
        ? parsed.intents.slice(0, 3)
        : [];
      const parsedIntents = rawIntents.map(item => this.parseIntentItem(item));
      const capabilityQuestions = this.parseCapabilityQuestions(
        parsed.capabilityQuestions,
        currentQuery
      );
      const rawReading =
        parsed.reading && typeof parsed.reading === 'object'
          ? (parsed.reading as Record<string, unknown>)
          : undefined;
      const memoryPlan = this.parseConversationMemoryPlan(
        parsed.memoryPlan ?? rawReading?.memoryPlan,
        memoryCandidates
      );

      if (
        !rawIntents.length ||
        parsedIntents.some(item => !item) ||
        !emotion ||
        !riskLevel ||
        confidence === undefined
      ) {
        return undefined;
      }

      const intents = (parsedIntents as StructuredReplyIntentItem[])
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
      if (reading) {
        result.reading = reading;
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
    value: unknown
  ): StructuredReplyIntentItem | undefined {
    if (!value || typeof value !== 'object') {
      return undefined;
    }

    const item = value as Record<string, unknown>;
    const target = this.readEnum(item.target, REPLY_INTENT_TARGETS);
    const timeScope = this.readEnum(item.timeScope, REPLY_INTENT_TIME_SCOPES);
    const intent = this.readEnum(item.intent, REPLY_INTENT_KINDS);
    const subIntent = this.readEnum(item.subIntent, REPLY_INTENT_SUB_INTENTS);
    const confidence = this.readConfidence(item.confidence);

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
      ? Math.min(Math.round(value), 10000)
      : 8000;
  }
}
