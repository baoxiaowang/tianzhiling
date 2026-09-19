import {
  AgentEntity,
  ConversationEntity,
  MessageEntity,
  MessageRole,
  MessageStatus,
  MessageType,
  MongoObjectId,
} from '@tzl/entities';
import { ConversationService } from '../../src/service/conversation.service';
import { AgentService } from '../../src/service/agent.service';
import {
  applyRecognitionJourneyObservation,
  applyRecognitionJourneyObserverUnavailable,
  buildInitialRecognitionJourney,
  markDepartureIntervalAnswered,
  shouldObserveTaskResponse,
  buildLegacyRecognitionJourney,
  buildSubsequentRelativeGreetingPrompt,
  formatFirstRelativeMentionCallName,
  parseRecognitionJourney,
  planRecognitionJourneyTurn,
  RECOGNITION_JOURNEY_MESSAGE_PREFIX,
  serializeRecognitionJourney,
  SUBSEQUENT_RELATIVE_GREETING_TASK_ID,
} from '../../src/service/agents/recognition-journey';
import { FreeChatAgentEligibilityService } from '../../src/service/agents/free-chat-agent-eligibility.service';
import { buildConversationInitiativeResource } from '../../src/service/agents/conversation-initiative-resource';
import { ReplyPromptCompilerService } from '../../src/service/agents/reply-prompt-compiler.service';
import { RecognitionJourneyObserverService } from '../../src/service/agents/recognition-journey-observer.service';

const USER_ID = new MongoObjectId('665000000000000000000001');
const AGENT_ID = new MongoObjectId('665000000000000000000010');
const FIRST_AGENT_ID = new MongoObjectId('665000000000000000000011');
const CONVERSATION_ID = new MongoObjectId('665000000000000000000020');
const BASE_TIME = new Date('2026-09-18T08:00:00.000Z');

const oid = () => new MongoObjectId();

const DEFAULT_OBSERVATION = {
  opening: 'not_observed' as const,
  familyStatus: 'not_observed' as const,
  departureInterval: 'not_observed' as const,
  relativeMentionGreeting: 'not_observed' as const,
};

function makeMessage(
  overrides: Partial<MessageEntity> & {
    conversationId: MongoObjectId;
    userId: MongoObjectId;
    agentId: MongoObjectId;
  }
): MessageEntity {
  const message = new MessageEntity();
  Object.assign(
    message,
    {
      id: oid(),
      type: MessageType.text,
      status: MessageStatus.sent,
      content: '',
      createdAt: BASE_TIME,
      updatedAt: BASE_TIME,
    },
    overrides
  );
  return message;
}

function sameValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left == null || right == null) return left == null && right == null;
  return String(left) === String(right);
}

function matchField(value: unknown, condition: unknown): boolean {
  if (
    condition &&
    typeof condition === 'object' &&
    !(condition instanceof Date) &&
    !(condition instanceof MongoObjectId)
  ) {
    const cond = condition as Record<string, unknown>;
    if ('$ne' in cond) return !sameValue(value, cond.$ne);
    if ('$in' in cond)
      return (cond.$in as unknown[]).some(item => sameValue(item, value));
    if ('$regex' in cond)
      return new RegExp(String(cond.$regex)).test(String(value ?? ''));
    if ('$lt' in cond)
      return (
        value != null &&
        new Date(value as string | Date).getTime() <
          new Date(cond.$lt as string | Date).getTime()
      );
    return false;
  }
  return sameValue(value, condition);
}

function matchesWhere(where: unknown, doc: MessageEntity): boolean {
  if (!where || typeof where !== 'object') return true;
  const query = where as Record<string, unknown>;
  if (Array.isArray(query.$or)) {
    const or = query.$or as Array<Record<string, unknown>>;
    if (!or.some(item => matchesWhere(item, doc))) return false;
  }
  for (const [key, condition] of Object.entries(query)) {
    if (key === '$or') continue;
    const value =
      key === 'id' || key === '_id'
        ? (doc.id as unknown)
        : ((doc as unknown as Record<string, unknown>)[key] as unknown);
    if (!matchField(value, condition)) return false;
  }
  return true;
}

class FakeMessageModel {
  docs: MessageEntity[] = [];

  async count(where: unknown): Promise<number> {
    return this.docs.filter(doc => matchesWhere(where, doc)).length;
  }

  async find(options: {
    where?: unknown;
    order?: Record<string, 'ASC' | 'DESC'>;
    take?: number;
    skip?: number;
  }): Promise<MessageEntity[]> {
    let rows = this.docs.filter(doc => matchesWhere(options?.where, doc));
    if (options?.order) {
      const entries = Object.entries(options.order);
      rows = [...rows].sort((left, right) => {
        for (const [key, direction] of entries) {
          const l = (left as unknown as Record<string, unknown>)[key] as
            | Date
            | string
            | number
            | undefined;
          const r = (right as unknown as Record<string, unknown>)[key] as
            | Date
            | string
            | number
            | undefined;
          const lt = l instanceof Date ? l.getTime() : String(l ?? '');
          const rt = r instanceof Date ? r.getTime() : String(r ?? '');
          if (lt === rt) continue;
          const result = lt < rt ? -1 : 1;
          return direction === 'DESC' ? -result : result;
        }
        return 0;
      });
    }
    if (options?.skip) rows = rows.slice(options.skip);
    if (options?.take != null) rows = rows.slice(0, options.take);
    return rows.map(doc => Object.assign(new MessageEntity(), doc));
  }

  async findOne(options: { where?: unknown }): Promise<MessageEntity | null> {
    const found = this.docs.find(doc => matchesWhere(options?.where, doc));
    return found ? Object.assign(new MessageEntity(), found) : null;
  }

  async save(doc: MessageEntity): Promise<MessageEntity> {
    if (!doc.id) doc.id = oid();
    // Store a detached copy so an in-memory mutation that fails to persist
    // cannot masquerade as a durable write.
    const stored = Object.assign(new MessageEntity(), doc);
    const index = this.docs.findIndex(item => sameValue(item.id, doc.id));
    if (index >= 0) this.docs[index] = stored;
    else this.docs.push(stored);
    return stored;
  }

  async remove(doc: MessageEntity): Promise<void> {
    this.docs = this.docs.filter(item => item !== doc);
  }
}

interface ConversationHarness {
  service: ConversationService;
  store: FakeMessageModel;
  agent: AgentEntity;
  conversation: ConversationEntity;
  welcome: MessageEntity;
  nextObservation: Record<string, string> | undefined;
  observerUnavailable: boolean;
  observerCalls: number;
  observerAssistantTexts: string[];
  observerUserTexts: string[];
}

function createConversationHarness(options: {
  mode: 'first_relative' | 'subsequent_relative';
  mentionCallName?: string;
  accessRole?: string;
  agentCreatedUserId?: MongoObjectId;
  conversationUserId?: MongoObjectId;
}): ConversationHarness {
  const service = new ConversationService();
  const store = new FakeMessageModel();
  const conversationUserId = options.conversationUserId ?? USER_ID;
  const agent = new AgentEntity();
  Object.assign(agent, {
    id: AGENT_ID,
    createdUserId: options.agentCreatedUserId ?? conversationUserId,
    name: '妈妈',
    iCallAgent: '妈妈',
    status: 1,
  });
  const conversation = new ConversationEntity();
  Object.assign(conversation, {
    id: CONVERSATION_ID,
    agentId: AGENT_ID,
    userId: conversationUserId,
    accessRole: options.accessRole ?? 'owner',
  });
  const welcome = makeMessage({
    conversationId: CONVERSATION_ID,
    userId: conversationUserId,
    agentId: AGENT_ID,
    role: MessageRole.assistant,
    content: '哎，妈妈在呢。你今天想跟我聊点什么吗？',
    createdAt: new Date(BASE_TIME.getTime() - 1000),
  });
  store.docs.push(welcome);
  const journey = buildInitialRecognitionJourney({
    mode: options.mode,
    mentionCallName: options.mentionCallName,
    openingAssistantMessageId: String(welcome.id),
    now: BASE_TIME,
  });
  store.docs.push(
    makeMessage({
      conversationId: CONVERSATION_ID,
      userId: conversationUserId,
      agentId: AGENT_ID,
      role: MessageRole.system,
      content: serializeRecognitionJourney(journey),
      isArchived: true,
      replyTrigger: false,
      quotaExempt: true,
      createdAt: BASE_TIME,
      updatedAt: BASE_TIME,
    })
  );

  (service as any).messageModel = store;
  (service as any).logger = {
    info() {},
    warn() {},
    error() {},
    debug() {},
  };
  const harness: ConversationHarness = {
    service,
    store,
    agent,
    conversation,
    welcome,
    nextObservation: undefined,
    observerUnavailable: false,
    observerCalls: 0,
    observerAssistantTexts: [],
    observerUserTexts: [],
  };
  (service as any).recognitionJourneyObserverService = {
    observe: async (observedOptions: {
      currentUserText: string;
      assistantText: string;
    }) => {
      harness.observerCalls += 1;
      harness.observerAssistantTexts.push(observedOptions.assistantText);
      harness.observerUserTexts.push(observedOptions.currentUserText);
      if (harness.observerUnavailable) return { status: 'unavailable' };
      return {
        status: 'observed',
        observation: harness.nextObservation ?? DEFAULT_OBSERVATION,
      };
    },
  };
  return harness;
}

function runtimeOf(harness: ConversationHarness) {
  return {
    auth: { sub: String(USER_ID) },
    conversation: harness.conversation,
    agent: harness.agent,
  } as any;
}

async function runTurn(
  harness: ConversationHarness,
  options: {
    turn: number;
    text: string;
    assistantText: string;
    observation?: Record<string, string>;
    observerUnavailable?: boolean;
    extraSegments?: string[];
    reuseUserMessage?: MessageEntity;
  }
): Promise<{ plan: any; assistant: MessageEntity; user: MessageEntity }> {
  const startedAt = new Date(BASE_TIME.getTime() + options.turn * 10000);
  const user =
    options.reuseUserMessage ??
    makeMessage({
      conversationId: CONVERSATION_ID,
      userId: USER_ID,
      agentId: AGENT_ID,
      role: MessageRole.user,
      content: options.text,
      createdAt: startedAt,
    });
  if (!options.reuseUserMessage) harness.store.docs.push(user);
  harness.nextObservation = options.observation;
  harness.observerUnavailable = Boolean(options.observerUnavailable);
  const before = {
    searchableText: options.text,
    userMessage: user,
    messagePayload: {},
    deferReply: false,
  } as any;
  const plan = await (harness.service as any).prepareRecognitionJourneyTurn({
    runtime: runtimeOf(harness),
    before,
    currentTurnMessages: [user],
  });
  const assistant = makeMessage({
    conversationId: CONVERSATION_ID,
    userId: USER_ID,
    agentId: AGENT_ID,
    role: MessageRole.assistant,
    content: options.assistantText,
    replySegmentIndex: 0,
    replyGroupId: oid().toHexString(),
    createdAt: new Date(startedAt.getTime() + 500),
  });
  harness.store.docs.push(assistant);
  if (options.extraSegments?.length) {
    for (const [index, segment] of options.extraSegments.entries()) {
      harness.store.docs.push(
        makeMessage({
          conversationId: CONVERSATION_ID,
          userId: USER_ID,
          agentId: AGENT_ID,
          role: MessageRole.assistant,
          content: segment,
          replySegmentIndex: index + 1,
          replyGroupId: assistant.replyGroupId,
          createdAt: new Date(startedAt.getTime() + 600 + index),
        })
      );
    }
  }
  const processed = (harness.service as any).attachRecognitionJourneyPlan(
    { replySegments: [options.assistantText], usage: {}, routing: {} },
    plan
  );
  await (harness.service as any).finalizeRecognitionJourneyTurn({
    runtime: runtimeOf(harness),
    processed,
    assistantMessages: harness.store.docs.filter(
      item =>
        item.role === MessageRole.assistant &&
        item.replyGroupId === assistant.replyGroupId
    ),
  });
  return { plan, assistant, user };
}

function persistedJourney(harness: ConversationHarness) {
  const state = harness.store.docs.find(
    doc =>
      doc.role === MessageRole.system &&
      typeof doc.content === 'string' &&
      doc.content.startsWith(RECOGNITION_JOURNEY_MESSAGE_PREFIX)
  );
  return parseRecognitionJourney(state?.content);
}

function greetingOf(harness: ConversationHarness) {
  return persistedJourney(harness)?.tasks.find(
    task => task.id === SUBSEQUENT_RELATIVE_GREETING_TASK_ID
  );
}

/** The final system-layer task text actually handed to the main model. */
function finalRequestTaskLayer(plan: any): string {
  const initiative = buildConversationInitiativeResource({
    currentQuery: '今天有点累',
    activeExpressionRequested: false,
    recognitionJourneyPrompt: plan?.prompt,
  });
  return new ReplyPromptCompilerService().compile({
    stableParts: ['# 稳定层'],
    taskParts: ['# 本轮任务层', initiative.prompt],
    includeTask: true,
  }).content;
}

describe('second-relative recognition journey state machine', () => {
  it('keeps the released first-relative journey untouched', () => {
    const journey = buildInitialRecognitionJourney({
      openingAssistantMessageId: 'opening-1',
      hasKnownDepartureDate: false,
      now: BASE_TIME,
    });
    expect(journey.mode).toBe('first_relative');
    expect(journey.opening.status).toBe('opening_attempted');
    expect(journey.tasks.map(task => task.id).sort()).toEqual([
      'departure_interval',
      'family_status',
    ]);
    expect(
      journey.tasks.some(
        task => task.id === SUBSEQUENT_RELATIVE_GREETING_TASK_ID
      )
    ).toBe(false);

    const firstTurn = planRecognitionJourneyTurn({
      journey,
      currentQuery: '妈，我最近有点累',
      userTurnNumber: 1,
    });
    // The released welcome is already the opening delivery, so the first user
    // turn moves straight to the released milestones.
    expect(firstTurn.plan.openingSuggested).toBe(false);
    expect(['departure_interval', 'family_status']).toContain(
      firstTurn.plan.suggestedTaskId
    );
    expect(firstTurn.plan.prompt).toContain('初次相认旅程');
    // Released records without a mode field must parse as first_relative.
    const legacyRaw = `${RECOGNITION_JOURNEY_MESSAGE_PREFIX}${JSON.stringify({
      version: 'recognition_journey_v3',
      stage: 'active',
      opening: { status: 'opening_attempted' },
      tasks: [
        { id: 'departure_interval', status: 'pending' },
        { id: 'family_status', status: 'pending' },
      ],
    })}`;
    expect(parseRecognitionJourney(legacyRaw)?.mode).toBe('first_relative');
  });

  it('formats the first relative call name without guessing relations', () => {
    expect(formatFirstRelativeMentionCallName('我的爸爸')).toBe('你爸爸');
    expect(formatFirstRelativeMentionCallName('我妈妈')).toBe('你妈妈');
    expect(formatFirstRelativeMentionCallName('你奶奶')).toBe('你奶奶');
    expect(formatFirstRelativeMentionCallName('外婆')).toBe('你外婆');
    expect(formatFirstRelativeMentionCallName('张伟')).toBe('张伟');
    expect(formatFirstRelativeMentionCallName('你我爸爸')).toBeUndefined();
    expect(formatFirstRelativeMentionCallName('')).toBeUndefined();
    expect(formatFirstRelativeMentionCallName('a'.repeat(20))).toBeUndefined();
    const prompt = buildSubsequentRelativeGreetingPrompt('我的爸爸');
    expect(prompt).toContain('刚刚你爸爸跟我说到你');
    expect(prompt).not.toContain('你我爸爸');
    expect(prompt).toContain('不声称两人之间已经真实互发过消息');
    expect(prompt).not.toContain('聊天记录');
  });

  it('makes the card mandatory inside the turns 3-5 window', () => {
    const soft = buildSubsequentRelativeGreetingPrompt('我的爸爸');
    const mandatory = buildSubsequentRelativeGreetingPrompt('我的爸爸', {
      mandatory: true,
    });
    // 强制版本只保留用户指定的那一句，不再附加其他约束。
    expect(mandatory).toBe(
      '本轮必须先自然回应用户当前说的话，然后带出“刚刚你爸爸跟我说到你，你能来找我真是太高兴了”这层意思，措辞可以调整。'
    );
    expect(mandatory).not.toContain('不要省略');
    expect(mandatory).not.toContain('只有用户本轮明确拒绝');
    expect(soft).toContain('可以不执行');
    // 规划出的第 3 轮 prompt 必须是强制版本。
    const journey = buildInitialRecognitionJourney({
      mode: 'subsequent_relative',
      mentionCallName: '我的爸爸',
      openingAssistantMessageId: 'opening-1',
    });
    const turn3 = planRecognitionJourneyTurn({
      journey,
      currentQuery: '妈，我今天有点累',
      userTurnNumber: 3,
    }).plan;
    expect(turn3.prompt).toBe(mandatory);
  });

  it('skips the card when no call name can be confirmed', () => {
    const journey = buildInitialRecognitionJourney({
      mode: 'subsequent_relative',
      mentionCallName: '',
      openingAssistantMessageId: 'opening-1',
    });
    expect(journey.stage).toBe('settled');
    expect(journey.tasks.every(task => task.status === 'skipped')).toBe(true);
    for (const turn of [3, 4, 5, 6]) {
      const planned = planRecognitionJourneyTurn({
        journey,
        currentQuery: '今天有点累',
        userTurnNumber: turn,
      });
      expect(planned.plan.prompt).toBeUndefined();
      expect(planned.plan.suggestedTaskId).toBeUndefined();
    }
  });

  it('runs the greeting only on turns 3-5 and completes on model expression', () => {
    let journey = buildInitialRecognitionJourney({
      mode: 'subsequent_relative',
      mentionCallName: '我的爸爸',
      openingAssistantMessageId: 'opening-1',
      now: BASE_TIME,
    });
    expect(journey.mentionCallName).toBe('你爸爸');
    expect(journey.stage).toBe('active');

    for (const turn of [1, 2]) {
      const planned = planRecognitionJourneyTurn({
        journey,
        currentQuery: '今天有点累',
        userTurnNumber: turn,
      });
      journey = planned.journey;
      expect(planned.plan.prompt).toBeUndefined();
      expect(planned.plan.openingSuggested).toBe(false);
      expect(planned.plan.observerCheckpoint).toBeUndefined();
    }

    const turn3 = planRecognitionJourneyTurn({
      journey,
      currentQuery: '今天有点累',
      userTurnNumber: 3,
    });
    journey = turn3.journey;
    expect(turn3.plan.suggestedTaskId).toBe(
      SUBSEQUENT_RELATIVE_GREETING_TASK_ID
    );
    expect(turn3.plan.observerCheckpoint).toBe('task_proposal');
    expect(turn3.plan.prompt).toContain('你爸爸');
    expect(turn3.plan.prompt).not.toContain('离世时间差');
    expect(turn3.plan.prompt).not.toContain('家庭近况');
  });
});

describe('conversation service second-relative flow (persisted state)', () => {
  it('injects no card on turns 1-2, injects on turn 3, completes on turn 4, then stops', async () => {
    const harness = createConversationHarness({
      mode: 'subsequent_relative',
      mentionCallName: '我的爸爸',
    });
    const turn1 = await runTurn(harness, {
      turn: 1,
      text: '今天有点累',
      assistantText: '累了就歇会儿，妈妈听着呢。',
    });
    expect(turn1.plan?.prompt).toBeUndefined();
    expect(turn1.plan?.openingSuggested).toBe(false);
    expect(finalRequestTaskLayer(turn1.plan)).not.toContain('刚刚你爸爸');
    expect(turn1.plan?.mode).toBe('subsequent_relative');

    const turn2 = await runTurn(harness, {
      turn: 2,
      text: '嗯，工作有点多',
      assistantText: '别硬扛，慢慢来。',
    });
    expect(turn2.plan?.prompt).toBeUndefined();
    expect(finalRequestTaskLayer(turn2.plan)).not.toContain('刚刚你爸爸');
    expect(greetingOf(harness)?.status).toBe('pending');

    const turn3 = await runTurn(harness, {
      turn: 3,
      text: '今天有点累',
      assistantText: '我在呢。',
      observation: DEFAULT_OBSERVATION,
    });
    expect(turn3.plan?.prompt).toContain('你爸爸');
    const turn3Request = finalRequestTaskLayer(turn3.plan);
    expect(turn3Request).toContain('# 本轮任务层');
    expect(turn3Request).toContain('刚刚你爸爸跟我说到你');
    expect(turn3Request).not.toContain('初次重逢旅程');
    expect(turn3Request).not.toContain('离世时间差');
    expect(turn3Request).not.toContain('家庭近况');
    expect(greetingOf(harness)?.status).toBe('pending');
    expect(greetingOf(harness)?.suggestionMissCount).toBe(1);

    const turn4 = await runTurn(harness, {
      turn: 4,
      text: '嗯，你能这么说我挺开心的',
      assistantText: '刚刚你爸爸跟我说到你，你能来找我，我真是太高兴了。',
      observation: {
        ...DEFAULT_OBSERVATION,
        relativeMentionGreeting: 'expressed',
      },
    });
    expect(turn4.plan?.prompt).toContain('你爸爸');
    const greeting = greetingOf(harness);
    expect(greeting?.status).toBe('completed');
    expect(greeting?.completedAt).toBeInstanceOf(Date);
    // Completion is bound to the persisted assistant reply id.
    expect(greeting?.answerMessageId).toBe(String(turn4.assistant.id));

    const turn5 = await runTurn(harness, {
      turn: 5,
      text: '嗯',
      assistantText: '嗯，妈妈在。',
    });
    expect(turn5.plan?.prompt).toBeUndefined();
    expect(turn5.plan?.observerCheckpoint).toBeUndefined();
    expect(finalRequestTaskLayer(turn5.plan)).not.toContain('刚刚你爸爸');
  });

  it('expires the card after turn 5 when it was never expressed', async () => {
    const harness = createConversationHarness({
      mode: 'subsequent_relative',
      mentionCallName: '我的爸爸',
    });
    for (const turn of [1, 2, 3, 4, 5]) {
      await runTurn(harness, {
        turn,
        text: `第${turn}轮`,
        assistantText: `回复${turn}`,
        observation: DEFAULT_OBSERVATION,
      });
    }
    expect(greetingOf(harness)?.status).toBe('expired');
    expect(greetingOf(harness)?.expiredAt).toBeInstanceOf(Date);

    const turn6 = await runTurn(harness, {
      turn: 6,
      text: '第六轮',
      assistantText: '回复6',
    });
    expect(turn6.plan?.prompt).toBeUndefined();
    expect(turn6.plan?.observerCheckpoint).toBeUndefined();
    expect(persistedJourney(harness)?.stage).toBe('settled');
  });

  it('does not fake completion or repeat the card while the observer is unavailable', async () => {
    const harness = createConversationHarness({
      mode: 'subsequent_relative',
      mentionCallName: '我的爸爸',
    });
    await runTurn(harness, { turn: 1, text: '一', assistantText: '回一' });
    await runTurn(harness, { turn: 2, text: '二', assistantText: '回二' });

    const turn3 = await runTurn(harness, {
      turn: 3,
      text: '三',
      assistantText: '我在。',
      observerUnavailable: true,
    });
    expect(turn3.plan?.prompt).toContain('你爸爸');
    // Unavailable is never treated as success; the delivery is recorded.
    expect(greetingOf(harness)?.status).toBe('proposed');
    expect(greetingOf(harness)?.observerUnavailableCount).toBe(1);
    expect(greetingOf(harness)?.proposedAssistantMessageId).toBe(
      String(turn3.assistant.id)
    );

    const turn4 = await runTurn(harness, {
      turn: 4,
      text: '四',
      assistantText: '还在。',
      observerUnavailable: true,
    });
    expect(turn4.plan?.prompt).toBeUndefined();
    expect(turn4.plan?.reobserveAssistantMessageId).toBe(
      String(turn3.assistant.id)
    );
    expect(turn4.plan?.observerCheckpoint).toBe('task_response');
    expect(greetingOf(harness)?.status).toBe('proposed');
    expect(greetingOf(harness)?.reobservationCount).toBe(1);
    // The delivery record survives so a later turn can still re-read it.
    expect(greetingOf(harness)?.proposedAssistantMessageId).toBe(
      String(turn3.assistant.id)
    );

    const turn5 = await runTurn(harness, {
      turn: 5,
      text: '五',
      assistantText: '一直。',
      observerUnavailable: true,
    });
    // The card was only ever injected on turn 3; the window then closes
    // unconfirmed rather than repeating the same line.
    expect(turn5.plan?.prompt).toBeUndefined();
    expect(turn5.plan?.reobserveAssistantMessageId).toBe(
      String(turn3.assistant.id)
    );
    expect(greetingOf(harness)?.status).toBe('expired');
    expect(greetingOf(harness)?.observationEvidence).toBe(
      'observer_unavailable'
    );
  });

  it('fix1: a confirmed-not-expressed proposal may be re-proposed within the window', async () => {
    const harness = createConversationHarness({
      mode: 'subsequent_relative',
      mentionCallName: '我的爸爸',
    });
    await runTurn(harness, { turn: 1, text: '一', assistantText: '回一' });
    await runTurn(harness, { turn: 2, text: '二', assistantText: '回二' });
    await runTurn(harness, {
      turn: 3,
      text: '三',
      assistantText: '我在。',
      observation: DEFAULT_OBSERVATION,
    });
    // The observer made a definite "not expressed" judgement, so the delivery
    // record is cleared and the pending card may be offered again.
    expect(greetingOf(harness)?.status).toBe('pending');
    expect(greetingOf(harness)?.proposedAssistantMessageId).toBeUndefined();
    const turn4 = await runTurn(harness, {
      turn: 4,
      text: '四',
      assistantText: '还在。',
      observation: DEFAULT_OBSERVATION,
    });
    expect(turn4.plan?.prompt).toContain('你爸爸');
  });

  it('fix1: an expressed reply whose completion write fails is re-read, never re-said', async () => {
    const harness = createConversationHarness({
      mode: 'subsequent_relative',
      mentionCallName: '我的爸爸',
    });
    await runTurn(harness, { turn: 1, text: '一', assistantText: '回一' });
    await runTurn(harness, { turn: 2, text: '二', assistantText: '回二' });

    // The reply expresses the card, but persisting the completed transition
    // fails. The delivery record must already be durable.
    const originalSave = harness.store.save.bind(harness.store);
    let failedOnce = false;
    harness.store.save = async (doc: MessageEntity) => {
      if (
        !failedOnce &&
        typeof doc.content === 'string' &&
        doc.content.startsWith(RECOGNITION_JOURNEY_MESSAGE_PREFIX) &&
        /"id":"relative_mention_greeting","status":"completed"/u.test(
          doc.content
        )
      ) {
        failedOnce = true;
        throw new Error('simulated completion state save failure');
      }
      return originalSave(doc);
    };
    const turn3 = await runTurn(harness, {
      turn: 3,
      text: '三',
      assistantText: '刚刚你爸爸跟我说到你，你能来找我我太高兴了。',
      observation: {
        ...DEFAULT_OBSERVATION,
        relativeMentionGreeting: 'expressed',
      },
    });
    harness.store.save = originalSave;
    expect(failedOnce).toBe(true);
    expect(turn3.plan?.prompt).toContain('你爸爸');
    // The completion transition was not durable, so it is not reported done,
    // but the recorded delivery survives.
    expect(greetingOf(harness)?.status).toBe('proposed');
    expect(greetingOf(harness)?.completedAt).toBeUndefined();
    expect(greetingOf(harness)?.proposedAssistantMessageId).toBe(
      String(turn3.assistant.id)
    );
    expect(greetingOf(harness)?.proposedReplyGroupId).toBe(
      String(turn3.assistant.replyGroupId)
    );

    const turn4 = await runTurn(harness, {
      turn: 4,
      text: '四',
      assistantText: '四的回',
      observation: DEFAULT_OBSERVATION,
    });
    // The card must never be injected a second time: the turn re-reads the
    // original delivery instead.
    expect(turn4.plan?.prompt).toBeUndefined();
    expect(finalRequestTaskLayer(turn4.plan)).not.toContain('刚刚你爸爸');
    expect(turn4.plan?.observerCheckpoint).toBe('task_response');
    expect(turn4.plan?.reobserveAssistantMessageId).toBe(
      String(turn3.assistant.id)
    );
  });

  it('fix2: re-reads the whole reply group and binds completion to the original delivery', async () => {
    const harness = createConversationHarness({
      mode: 'subsequent_relative',
      mentionCallName: '我的爸爸',
    });
    await runTurn(harness, { turn: 1, text: '一', assistantText: '回一' });
    await runTurn(harness, { turn: 2, text: '二', assistantText: '回二' });

    // Turn 3 delivers the card split into two persisted bubbles and the
    // observer is unavailable.
    const turn3 = await runTurn(harness, {
      turn: 3,
      text: '三',
      assistantText: '刚刚你爸爸跟我说到你了，',
      extraSegments: ['你能来找我，我真是太高兴了。'],
      observerUnavailable: true,
    });
    expect(greetingOf(harness)?.proposedReplyGroupId).toBe(
      String(turn3.assistant.replyGroupId)
    );

    // Turn 4 re-reads the original group and the observer sees both segments.
    const turn4 = await runTurn(harness, {
      turn: 4,
      text: '谢谢你',
      assistantText: '这一轮的新回复。',
      observation: {
        ...DEFAULT_OBSERVATION,
        relativeMentionGreeting: 'expressed',
      },
    });
    expect(turn4.plan?.reobserveAssistantMessageId).toBe(
      String(turn3.assistant.id)
    );
    expect(turn4.plan?.reobserveReplyGroupId).toBe(
      String(turn3.assistant.replyGroupId)
    );
    const observedText =
      harness.observerAssistantTexts[
        harness.observerAssistantTexts.length - 1
      ] || '';
    expect(observedText).toContain('刚刚你爸爸跟我说到你了，');
    expect(observedText).toContain('你能来找我，我真是太高兴了。');
    expect(observedText).not.toContain('这一轮的新回复。');
    // Completion evidence is bound to turn 3's original delivery, not turn 4.
    const greeting = greetingOf(harness);
    expect(greeting?.status).toBe('completed');
    expect(greeting?.answerMessageId).toBe(String(turn3.assistant.id));
    expect(greeting?.answerMessageId).not.toBe(String(turn4.assistant.id));
  });

  it('fix3: a refusal of an unrelated topic does not skip the card', async () => {
    const harness = createConversationHarness({
      mode: 'subsequent_relative',
      mentionCallName: '我的爸爸',
    });
    await runTurn(harness, { turn: 1, text: '一', assistantText: '回一' });
    await runTurn(harness, { turn: 2, text: '二', assistantText: '回二' });
    const turn3 = await runTurn(harness, {
      turn: 3,
      text: '我不想聊工作',
      assistantText: '好，那我们不说工作。',
      observation: {
        ...DEFAULT_OBSERVATION,
        relativeMentionGreetingRefusal: 'not_refused',
      },
    });
    // Refusing an unrelated subject is not a refusal of this card.
    expect(greetingOf(harness)?.status).not.toBe('skipped');
    expect(turn3.plan?.prompt).toContain('你爸爸');
    const turn4 = await runTurn(harness, {
      turn: 4,
      text: '嗯，你刚刚想说什么',
      assistantText: '刚刚你爸爸跟我说到你，你能来找我我太高兴了。',
      observation: {
        ...DEFAULT_OBSERVATION,
        relativeMentionGreeting: 'expressed',
      },
    });
    // The card may still advance within the window.
    expect(turn4.plan?.prompt).toContain('你爸爸');
    expect(greetingOf(harness)?.status).toBe('completed');
  });

  it('fix3: an explicit refusal of this relative skips the card forever', async () => {
    const harness = createConversationHarness({
      mode: 'subsequent_relative',
      mentionCallName: '我的爸爸',
    });
    await runTurn(harness, { turn: 1, text: '一', assistantText: '回一' });
    await runTurn(harness, { turn: 2, text: '二', assistantText: '回二' });
    const turn3 = await runTurn(harness, {
      turn: 3,
      text: '别再提爸爸了，我不想聊他',
      assistantText: '好，那先不说这个。',
      observation: {
        ...DEFAULT_OBSERVATION,
        relativeMentionGreetingRefusal: 'refused',
      },
    });
    expect(turn3.plan?.prompt).toContain('你爸爸');
    expect(greetingOf(harness)?.status).toBe('skipped');
    expect(greetingOf(harness)?.observationEvidence).toBe(
      'user_declined_topic'
    );
    const turn4 = await runTurn(harness, {
      turn: 4,
      text: '嗯',
      assistantText: '嗯。',
    });
    expect(turn4.plan?.prompt).toBeUndefined();
    expect(finalRequestTaskLayer(turn4.plan)).not.toContain('刚刚你爸爸');
  });

  it('counts only effective user turns: split bubbles, welcome and system rows do not advance it', async () => {
    const harness = createConversationHarness({
      mode: 'subsequent_relative',
      mentionCallName: '我的爸爸',
    });
    const turn1 = await runTurn(harness, {
      turn: 1,
      text: '一',
      assistantText: '回一',
      extraSegments: ['第二泡', '第三泡'],
    });
    expect(turn1.plan?.userTurnNumber).toBe(1);
    const turn2 = await runTurn(harness, {
      turn: 2,
      text: '二',
      assistantText: '回二',
    });
    expect(turn2.plan?.userTurnNumber).toBe(2);
    // Re-processing the same user turn (retry) must not advance the counter.
    const retry = await runTurn(harness, {
      turn: 2,
      text: '二',
      assistantText: '回二重试',
      reuseUserMessage: turn2.user,
    });
    expect(retry.plan?.userTurnNumber).toBe(2);
  });

  it('keeps the released first-relative injection path', async () => {
    const harness = createConversationHarness({ mode: 'first_relative' });
    const turn1 = await runTurn(harness, {
      turn: 1,
      text: '妈，我最近有点累',
      assistantText: '我在。',
      observation: {
        ...DEFAULT_OBSERVATION,
        opening: 'emotionally_opened',
      },
    });
    expect(turn1.plan?.openingSuggested).toBe(false);
    expect(['departure_interval', 'family_status']).toContain(
      turn1.plan?.suggestedTaskId
    );
    const request = finalRequestTaskLayer(turn1.plan);
    expect(request).toContain('初次相认旅程');
    expect(request).not.toContain('刚刚你爸爸');
    expect(
      persistedJourney(harness)?.tasks.some(
        task => task.id === SUBSEQUENT_RELATIVE_GREETING_TASK_ID
      )
    ).toBe(false);
  });

  it('lets a later relative talk about family and loss normally without released prompts', async () => {
    const harness = createConversationHarness({
      mode: 'subsequent_relative',
      mentionCallName: '我的爸爸',
    });
    const turn1 = await runTurn(harness, {
      turn: 1,
      text: '爸爸走了三年了，我到现在还是难受',
      assistantText: '我知道，这种感觉很难熬。',
      observation: DEFAULT_OBSERVATION,
    });
    expect(turn1.plan?.prompt).toBeUndefined();
    expect(turn1.plan?.suggestedTaskId).toBeUndefined();
    await runTurn(harness, { turn: 2, text: '嗯', assistantText: '嗯。' });
    const turn3 = await runTurn(harness, {
      turn: 3,
      text: '家里人都还好，就是都很想他',
      assistantText: '想他是很自然的事。',
      observation: DEFAULT_OBSERVATION,
    });
    // The only card is the greeting; the released family/departure tasks are gone.
    expect(turn3.plan?.suggestedTaskId).toBe(
      SUBSEQUENT_RELATIVE_GREETING_TASK_ID
    );
    expect(turn3.plan?.observedTaskIds ?? []).not.toContain('family_status');
    expect(turn3.plan?.observedTaskIds ?? []).not.toContain(
      'departure_interval'
    );
  });

  it('rebuilds a missing later-relative state without resurrecting the released tasks', async () => {
    const harness = createConversationHarness({
      mode: 'subsequent_relative',
      mentionCallName: '我的爸爸',
    });
    // Simulate loss of the persisted journey state.
    harness.store.docs = harness.store.docs.filter(
      doc => doc.role !== MessageRole.system
    );
    (harness.service as any).freeChatAgentEligibilityService = {
      resolveRecognitionJourneyOwnership: async () => ({
        mode: 'subsequent_relative',
        firstAgentId: String(FIRST_AGENT_ID),
        firstAgent: Object.assign(new AgentEntity(), {
          id: FIRST_AGENT_ID,
          iCallAgent: '我的爸爸',
          name: '爸爸',
        }),
      }),
    };
    const planned = await (
      harness.service as any
    ).prepareRecognitionJourneyTurn({
      runtime: runtimeOf(harness),
      before: {
        searchableText: '今天有点累',
        userMessage:
          harness.store.docs.find(doc => doc.role === MessageRole.user) ??
          makeMessage({
            conversationId: CONVERSATION_ID,
            userId: USER_ID,
            agentId: AGENT_ID,
            role: MessageRole.user,
            content: '今天有点累',
            createdAt: new Date(BASE_TIME.getTime() + 5000),
          }),
        messagePayload: {},
        deferReply: false,
      },
      currentTurnMessages: [],
    });
    const rebuilt = persistedJourney(harness);
    expect(rebuilt?.mode).toBe('subsequent_relative');
    expect(rebuilt?.mentionCallName).toBe('你爸爸');
    expect(
      rebuilt?.tasks.find(task => task.id === 'departure_interval')?.status
    ).toBe('skipped');
    expect(
      rebuilt?.tasks.find(task => task.id === 'family_status')?.status
    ).toBe('skipped');
    expect(planned?.openingSuggested).toBe(false);
  });

  it('never classifies a shared or cross-account conversation as a later relative', async () => {
    const agentService = new AgentService();
    (agentService as any).logger = { info() {}, warn() {}, error() {} };
    (agentService as any).freeChatAgentEligibilityService = {
      resolveRecognitionJourneyOwnership: async () => ({
        mode: 'subsequent_relative',
        firstAgentId: String(FIRST_AGENT_ID),
        firstAgent: Object.assign(new AgentEntity(), {
          id: FIRST_AGENT_ID,
          iCallAgent: '我的爸爸',
        }),
      }),
    };
    const agent = Object.assign(new AgentEntity(), {
      id: AGENT_ID,
      createdUserId: USER_ID,
      name: '妈妈',
    });
    const shared = await (
      agentService as any
    ).resolveOwnerRecognitionJourneyOwnership({
      agent,
      userId: USER_ID,
      shared: true,
    });
    expect(shared.mode).toBe('first_relative');
    const crossAccount = await (
      agentService as any
    ).resolveOwnerRecognitionJourneyOwnership({
      agent,
      userId: oid(),
      shared: false,
    });
    expect(crossAccount.mode).toBe('first_relative');
    const owner = await (
      agentService as any
    ).resolveOwnerRecognitionJourneyOwnership({
      agent,
      userId: USER_ID,
      shared: false,
    });
    expect(owner.mode).toBe('subsequent_relative');
    expect(owner.mentionCallName).toBe('我的爸爸');
  });

  it('uses the corrected first-relative address from the shared identity contract', async () => {
    const agentService = new AgentService();
    (agentService as any).logger = { info() {}, warn() {}, error() {} };
    (agentService as any).freeChatAgentEligibilityService = {
      resolveRecognitionJourneyOwnership: async () => ({
        mode: 'subsequent_relative',
        firstAgentId: String(FIRST_AGENT_ID),
        firstAgent: Object.assign(new AgentEntity(), {
          id: FIRST_AGENT_ID,
          iCallAgent: '我的爸爸',
          name: '爸爸',
        }),
      }),
    };
    (agentService as any).agentProfileFactService = {
      listFactsForPrompt: async () => [
        {
          type: 'relationship',
          key: 'relationship.preferred_agent_name',
          value: '当前用户偏好称呼当前角色为老爷子',
          polarity: 'positive',
          confidence: 'confirmed',
          priority: 3,
          status: 'active',
        },
      ],
    };
    const agent = Object.assign(new AgentEntity(), {
      id: AGENT_ID,
      createdUserId: USER_ID,
      name: '妈妈',
    });

    const owner = await (
      agentService as any
    ).resolveOwnerRecognitionJourneyOwnership({
      agent,
      userId: USER_ID,
      shared: false,
    });

    expect(owner.mode).toBe('subsequent_relative');
    expect(owner.mentionCallName).toBe('老爷子');
  });

  it('fix4: a temporary ownership failure writes no state and recovers on a later turn', async () => {
    const harness = createConversationHarness({
      mode: 'subsequent_relative',
      mentionCallName: '我的爸爸',
    });
    // No persisted journey state: a legacy conversation that must recover.
    harness.store.docs = harness.store.docs.filter(
      doc => doc.role !== MessageRole.system
    );
    let available = false;
    (harness.service as any).freeChatAgentEligibilityService = {
      resolveRecognitionJourneyOwnership: async () =>
        available
          ? {
              resolution: 'resolved',
              mode: 'subsequent_relative',
              firstAgentId: String(FIRST_AGENT_ID),
              firstAgent: Object.assign(new AgentEntity(), {
                id: FIRST_AGENT_ID,
                iCallAgent: '我的爸爸',
                name: '爸爸',
              }),
            }
          : { resolution: 'temporarily_unavailable', reason: 'timeout' },
    };
    const userMessage = makeMessage({
      conversationId: CONVERSATION_ID,
      userId: USER_ID,
      agentId: AGENT_ID,
      role: MessageRole.user,
      content: '今天有点累',
      createdAt: new Date(BASE_TIME.getTime() + 5000),
    });
    const runtime = runtimeOf(harness);
    const before = {
      searchableText: '今天有点累',
      userMessage,
      messagePayload: {},
      deferReply: false,
    } as any;

    const unresolved = await (
      harness.service as any
    ).prepareRecognitionJourneyTurn({
      runtime,
      before,
      currentTurnMessages: [userMessage],
    });
    expect(unresolved).toBeUndefined();
    // A temporary failure must not persist first_relative (or any mode).
    expect(
      harness.store.docs.filter(doc => doc.role === MessageRole.system)
    ).toHaveLength(0);

    available = true;
    const recovered = await (
      harness.service as any
    ).prepareRecognitionJourneyTurn({
      runtime,
      before,
      currentTurnMessages: [userMessage],
    });
    expect(recovered).toBeDefined();
    const rebuilt = persistedJourney(harness);
    expect(rebuilt?.mode).toBe('subsequent_relative');
    expect(rebuilt?.mentionCallName).toBe('你爸爸');
    expect(
      rebuilt?.tasks.find(task => task.id === 'departure_interval')?.status
    ).toBe('skipped');
    expect(
      rebuilt?.tasks.find(task => task.id === 'family_status')?.status
    ).toBe('skipped');
  });

  it('fix5: corrects a persisted first_relative when an earlier role converges', async () => {
    const harness = createConversationHarness({ mode: 'first_relative' });
    // This conversation first classified itself as first while the earlier
    // role had not yet been persisted. The ledger now converges on that role.
    (harness.service as any).freeChatAgentEligibilityService = {
      resolveRecognitionJourneyOwnership: async () => ({
        resolution: 'resolved',
        mode: 'subsequent_relative',
        firstAgentId: String(FIRST_AGENT_ID),
        firstAgent: Object.assign(new AgentEntity(), {
          id: FIRST_AGENT_ID,
          iCallAgent: '我的爸爸',
          name: '爸爸',
        }),
      }),
    };
    expect(persistedJourney(harness)?.mode).toBe('first_relative');
    const turn1 = await runTurn(harness, {
      turn: 1,
      text: '一',
      assistantText: '回一',
    });
    const corrected = persistedJourney(harness);
    // Exactly one durable "first": this conversation is demoted, so it no
    // longer exposes the released milestones.
    expect(corrected?.mode).toBe('subsequent_relative');
    expect(
      corrected?.tasks.find(task => task.id === 'departure_interval')?.status
    ).toBe('skipped');
    expect(
      corrected?.tasks.find(task => task.id === 'family_status')?.status
    ).toBe('skipped');
    expect(turn1.plan?.prompt).toBeUndefined();
  });
});

describe('observer reuse for the later-relative card', () => {
  it('judges the greeting from the existing call and bounds the payload to the card', async () => {
    const service = new RecognitionJourneyObserverService();
    const requests: any[] = [];
    (service as any).logger = { warn() {} };
    (service as any).openAIService = {
      createChatCompletion: async (payload: any) => {
        requests.push(payload);
        return {
          model: 'fake-observer',
          usage: { total_tokens: 120 },
          choices: [
            {
              message: {
                content: JSON.stringify({
                  opening: 'not_observed',
                  familyStatus: 'not_observed',
                  departureInterval: 'not_observed',
                  relativeMentionGreeting: 'expressed',
                  relativeMentionGreetingRefusal: 'refused',
                  evidence: '卡片被自然表达',
                }),
              },
            },
          ],
        };
      },
    };
    const journey = buildInitialRecognitionJourney({
      mode: 'subsequent_relative',
      mentionCallName: '我的爸爸',
      openingAssistantMessageId: 'opening-1',
      now: BASE_TIME,
    });
    const plan = planRecognitionJourneyTurn({
      journey,
      currentQuery: '今天有点累',
      userTurnNumber: 3,
    }).plan;
    const result = await service.observe({
      journey,
      plan,
      currentUserText: '今天有点累',
      assistantText: '刚刚你爸爸跟我说到你，你能来找我真是太高兴了。',
    });
    expect(result.status).toBe('observed');
    expect(result.observation?.relativeMentionGreeting).toBe('expressed');
    expect(result.observation?.relativeMentionGreetingRefusal).toBe('refused');
    expect(requests).toHaveLength(1);
    const systemPrompt = requests[0].messages[0].content as string;
    expect(systemPrompt).toContain('relativeMentionGreeting');
    expect(systemPrompt).toContain('relativeMentionGreetingRefusal');
    const userPayload = JSON.parse(requests[0].messages[1].content as string);
    expect(userPayload.suggestedThisTurn.task).toBe(
      SUBSEQUENT_RELATIVE_GREETING_TASK_ID
    );
    expect(userPayload.journeyState.mentionCallName).toBe('你爸爸');
  });

  it('accepts a real-shaped observer reply that echoes the released milestones', async () => {
    // Real production model output at the card checkpoint: the observer is told
    // not to judge the released milestones, so it echoes their current state
    // ("settled_success"/"skipped"). That must not invalidate the card verdict.
    const service = new RecognitionJourneyObserverService();
    (service as any).logger = { warn() {} };
    (service as any).openAIService = {
      createChatCompletion: async () => ({
        model: 'fake-observer',
        usage: { total_tokens: 150 },
        choices: [
          {
            message: {
              content: JSON.stringify({
                opening: 'settled_success',
                familyStatus: 'skipped',
                departureInterval: 'skipped',
                relativeMentionGreeting: 'expressed',
                relativeMentionGreetingRefusal: 'not_refused',
                evidence: '助手提到刚刚你爸说到你并表达高兴',
              }),
            },
          },
        ],
      }),
    };
    const journey = buildInitialRecognitionJourney({
      mode: 'subsequent_relative',
      mentionCallName: '我的爸爸',
      openingAssistantMessageId: 'opening-1',
      now: BASE_TIME,
    });
    const plan = planRecognitionJourneyTurn({
      journey,
      currentQuery: '妈，我今天有点累。',
      userTurnNumber: 3,
    }).plan;
    const result = await service.observe({
      journey,
      plan,
      currentUserText: '妈，我今天有点累。',
      assistantText: '累了就歇着。刚刚你爸还跟我说到你，你能来找我真是太高兴了。',
    });
    expect(result.status).toBe('observed');
    expect(result.observation?.relativeMentionGreeting).toBe('expressed');
    expect(result.observation?.relativeMentionGreetingRefusal).toBe(
      'not_refused'
    );
    expect(result.observation?.opening).toBe('not_observed');
  });

  it('accepts older observer outputs that omit the new field', async () => {
    const service = new RecognitionJourneyObserverService();
    (service as any).logger = { warn() {} };
    (service as any).openAIService = {
      createChatCompletion: async () => ({
        choices: [
          {
            message: {
              content: JSON.stringify({
                opening: 'not_observed',
                familyStatus: 'not_observed',
                departureInterval: 'not_observed',
              }),
            },
          },
        ],
      }),
    };
    const journey = buildInitialRecognitionJourney({
      mode: 'subsequent_relative',
      mentionCallName: '我的爸爸',
      openingAssistantMessageId: 'opening-1',
      now: BASE_TIME,
    });
    const plan = planRecognitionJourneyTurn({
      journey,
      currentQuery: '今天有点累',
      userTurnNumber: 3,
    }).plan;
    const result = await service.observe({
      journey,
      plan,
      currentUserText: '今天有点累',
      assistantText: '我在。',
    });
    expect(result.status).toBe('observed');
    expect(result.observation?.relativeMentionGreeting).toBe('not_observed');
    // The refusal field also defaults safely for older outputs.
    expect(result.observation?.relativeMentionGreetingRefusal).toBe(
      'not_refused'
    );
  });

  it('does not observe ordinary later-relative turns without a checkpoint', async () => {
    const service = new RecognitionJourneyObserverService();
    let called = false;
    (service as any).logger = { warn() {} };
    (service as any).openAIService = {
      createChatCompletion: async () => {
        called = true;
        return { choices: [] };
      },
    };
    const journey = buildInitialRecognitionJourney({
      mode: 'subsequent_relative',
      mentionCallName: '我的爸爸',
      openingAssistantMessageId: 'opening-1',
      now: BASE_TIME,
    });
    const plan = planRecognitionJourneyTurn({
      journey,
      currentQuery: '今天有点累',
      userTurnNumber: 1,
    }).plan;
    const result = await service.observe({
      journey,
      plan,
      currentUserText: '今天有点累',
      assistantText: '我在。',
    });
    expect(result.status).toBe('unavailable');
    expect(called).toBe(false);
  });
});

describe('stable first-relative classification from the creation ledger', () => {
  function buildEligibility(
    agents: AgentEntity[],
    seededLedger?: unknown[],
    options: { activatedAt?: Date } = {}
  ) {
    const ledgerStore = new Map<string, any>();
    const agentModel = {
      aggregate: (pipeline: any[]) => {
        const owner = pipeline[0]?.$match?.createdUserId;
        const rows = agents
          .filter(
            item =>
              sameValue(item.createdUserId, owner) && !item.messengerOfAgentId
          )
          .sort(
            (left, right) =>
              left.createdAt.getTime() - right.createdAt.getTime() ||
              String(left.id).localeCompare(String(right.id))
          );
        return {
          toArray: async () =>
            rows.slice(0, 3).map(item => ({
              _id: item.id,
              createdAt: item.createdAt,
            })),
        };
      },
      findOne: async ({ where }: any) =>
        agents.find(item => sameValue(item.id, where?._id)) ?? null,
    };
    const ledgerModel = {
      findOne: async ({ where }: any) =>
        ledgerStore.get(String(where?._id)) ?? null,
      findOneAndUpdate: async (filter: any, update: any, opts: any) => {
        const key = String(filter?._id);
        let doc = ledgerStore.get(key);
        if (doc) {
          if (update?.$set) Object.assign(doc, update.$set);
          return doc;
        }
        if (opts?.upsert) {
          doc = { _id: filter._id, ...update?.$setOnInsert };
          ledgerStore.set(key, doc);
          return doc;
        }
        return null;
      },
    };
    const service = new FreeChatAgentEligibilityService();
    (service as any).agentModel = agentModel;
    (service as any).ledgerModel = ledgerModel;
    (service as any).logger = { warn() {}, error() {} };
    // Tests run as if the later-relative mode was released long ago unless a
    // specific boundary is injected.
    (service as any).recognitionJourneyModeActivatedAt =
      options.activatedAt ?? new Date('2020-01-01T00:00:00.000Z');
    if (seededLedger) {
      ledgerStore.set(String(USER_ID), {
        _id: USER_ID,
        userId: USER_ID,
        slots: seededLedger,
        policyVersion: 'first_three_created_v1',
        createdAt: BASE_TIME,
        updatedAt: BASE_TIME,
      });
    }
    return { service, ledgerStore };
  }

  function buildAgent(
    id: MongoObjectId,
    createdAt: Date,
    overrides: Partial<AgentEntity> = {}
  ) {
    return Object.assign(new AgentEntity(), {
      id,
      createdUserId: USER_ID,
      name: `角色${id.toHexString().slice(-2)}`,
      iCallAgent: '我的爸爸',
      status: 1,
      createdAt,
      updatedAt: createdAt,
      ...overrides,
    });
  }

  it('uses stable creation order, not the default flag or recent chats', async () => {
    const first = buildAgent(FIRST_AGENT_ID, new Date('2026-01-01T00:00:00Z'));
    const second = buildAgent(
      new MongoObjectId('665000000000000000000012'),
      new Date('2026-02-01T00:00:00Z'),
      { isDefault: true, updatedAt: new Date('2026-09-01T00:00:00Z') }
    );
    const { service } = buildEligibility([first, second]);
    const firstOwnership = await service.resolveRecognitionJourneyOwnership(
      first
    );
    expect(firstOwnership.mode).toBe('first_relative');
    const secondOwnership = await service.resolveRecognitionJourneyOwnership(
      second
    );
    expect(secondOwnership.mode).toBe('subsequent_relative');
    expect(secondOwnership.firstAgent?.id).toBe(FIRST_AGENT_ID);
    expect(secondOwnership.firstAgent?.iCallAgent).toBe('我的爸爸');
  });

  it('keeps a deleted first relative in its slot so later roles never run the old tasks', async () => {
    const second = buildAgent(
      new MongoObjectId('665000000000000000000013'),
      new Date('2026-02-01T00:00:00Z')
    );
    const { service } = buildEligibility(
      [second],
      [{ agentId: FIRST_AGENT_ID, createdAt: new Date('2026-01-01T00:00:00Z') }]
    );
    const ownership = await service.resolveRecognitionJourneyOwnership(second);
    expect(ownership.mode).toBe('subsequent_relative');
    // The first record is physically gone: no call name, so the card is skipped.
    expect(ownership.firstAgent).toBeUndefined();
    const journey = buildInitialRecognitionJourney({
      mode: ownership.mode,
      mentionCallName: ownership.firstAgent?.iCallAgent,
    });
    expect(
      journey.tasks.some(
        task =>
          task.id === SUBSEQUENT_RELATIVE_GREETING_TASK_ID &&
          task.status === 'pending'
      )
    ).toBe(false);
  });

  it('excludes messenger roles and converges concurrent creations to exactly one first', async () => {
    const first = buildAgent(FIRST_AGENT_ID, new Date('2026-01-01T00:00:00Z'));
    const second = buildAgent(
      new MongoObjectId('665000000000000000000014'),
      new Date('2026-01-01T00:00:00Z')
    );
    const messenger = buildAgent(
      new MongoObjectId('665000000000000000000015'),
      new Date('2025-01-01T00:00:00Z'),
      { messengerOfAgentId: FIRST_AGENT_ID }
    );
    const { service } = buildEligibility([first, second, messenger]);
    const [a, b] = await Promise.all([
      service.resolveRecognitionJourneyOwnership(first),
      service.resolveRecognitionJourneyOwnership(second),
    ]);
    const modes = [a.mode, b.mode].sort();
    expect(modes).toEqual(['first_relative', 'subsequent_relative']);
    const messengerOwnership = await service.resolveRecognitionJourneyOwnership(
      messenger
    );
    expect(messengerOwnership.mode).toBe('first_relative');
  });

  it('recovers a legacy later-relative state without reviving the released tasks', () => {
    const legacy = buildLegacyRecognitionJourney(
      BASE_TIME,
      'subsequent_relative',
      '我的爸爸'
    );
    expect(legacy.mode).toBe('subsequent_relative');
    expect(legacy.mentionCallName).toBe('你爸爸');
    expect(legacy.tasks.map(task => task.status)).toEqual([
      'skipped',
      'skipped',
      'expired',
    ]);
    const planned = planRecognitionJourneyTurn({
      journey: legacy,
      currentQuery: '今天有点累',
      userTurnNumber: 3,
    });
    expect(planned.plan.prompt).toBeUndefined();
    expect(planned.plan.suggestedTaskId).toBeUndefined();
  });

  it('applies observation helpers only to the greeting task in later mode', () => {
    const journey = buildInitialRecognitionJourney({
      mode: 'subsequent_relative',
      mentionCallName: '我的爸爸',
      openingAssistantMessageId: 'opening-1',
      now: BASE_TIME,
    });
    const plan = planRecognitionJourneyTurn({
      journey,
      currentQuery: '今天有点累',
      userTurnNumber: 3,
    }).plan;
    const delivered = applyRecognitionJourneyObservation({
      journey,
      plan,
      assistantMessageId: 'msg-1',
      observation: {
        opening: 'emotionally_received',
        familyStatus: 'provided',
        departureInterval: 'provided',
        relativeMentionGreeting: 'expressed',
        evidence: 'later card expressed',
      },
      now: BASE_TIME,
    });
    expect(
      delivered.tasks.find(
        item => item.id === SUBSEQUENT_RELATIVE_GREETING_TASK_ID
      )?.status
    ).toBe('completed');
    // Released tasks stay skipped even when the observer reports them.
    expect(
      delivered.tasks.find(item => item.id === 'family_status')?.status
    ).toBe('skipped');
    expect(
      delivered.tasks.find(item => item.id === 'departure_interval')?.status
    ).toBe('skipped');

    const unavailable = applyRecognitionJourneyObserverUnavailable({
      journey,
      plan,
      assistantMessageId: 'msg-1',
      now: BASE_TIME,
    });
    expect(
      unavailable.tasks.find(
        item => item.id === SUBSEQUENT_RELATIVE_GREETING_TASK_ID
      )?.status
    ).toBe('pending');
    expect(
      unavailable.tasks.find(
        item => item.id === SUBSEQUENT_RELATIVE_GREETING_TASK_ID
      )?.proposedAssistantMessageId
    ).toBe('msg-1');
  });

  it('fix4: a temporary ledger read failure is unresolved, never first_relative', async () => {
    const second = buildAgent(
      new MongoObjectId('665000000000000000000016'),
      new Date('2026-02-01T00:00:00Z')
    );
    const { service } = buildEligibility([second]);
    (service as any).ledgerModel.findOne = async () => {
      throw new Error('mongo read timeout');
    };
    const ownership = await service.resolveRecognitionJourneyOwnership(second);
    expect(ownership.resolution).toBe('temporarily_unavailable');
    expect(ownership.mode).toBeUndefined();
  });

  it('fix4: a damaged ledger keeps first_relative but records unrecoverable history', async () => {
    const second = buildAgent(
      new MongoObjectId('665000000000000000000017'),
      new Date('2026-02-01T00:00:00Z')
    );
    const firstSlot = {
      agentId: FIRST_AGENT_ID,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    };
    const { service, ledgerStore } = buildEligibility([second], [firstSlot]);
    const doc = ledgerStore.get(String(USER_ID));
    doc.policyVersion = 'unknown_policy_v0';
    const ownership = await service.resolveRecognitionJourneyOwnership(second);
    expect(ownership.resolution).toBe('resolved');
    expect(ownership.mode).toBe('first_relative');
    expect(ownership.historyUnrecoverable).toBe(true);
  });

  it('fix4: a role created before the mode boundary keeps first_relative on recovery', async () => {
    const first = buildAgent(
      FIRST_AGENT_ID,
      new Date('2026-01-01T00:00:00Z')
    );
    const second = buildAgent(
      new MongoObjectId('665000000000000000000018'),
      new Date('2026-02-01T00:00:00Z')
    );
    const { service } = buildEligibility([first, second], undefined, {
      activatedAt: BASE_TIME,
    });
    const ownership = await service.resolveRecognitionJourneyOwnership(second);
    expect(ownership.resolution).toBe('resolved');
    expect(ownership.mode).toBe('first_relative');
    expect(ownership.reason).toBe('created_before_subsequent_relative_mode');
  });

  it('fix5: an out-of-order persistence interleaving converges to exactly one first', async () => {
    const second = buildAgent(
      new MongoObjectId('665000000000000000000019'),
      new Date('2026-02-01T00:00:00Z')
    );
    // The later request persists and classifies first before the earlier
    // request's document lands.
    const agents = [second];
    const { service } = buildEligibility(agents);
    const beforeConvergence =
      await service.resolveRecognitionJourneyOwnership(second);
    expect(beforeConvergence.mode).toBe('first_relative');

    // The earlier-created role is now durable.
    agents.push(
      buildAgent(FIRST_AGENT_ID, new Date('2026-01-01T00:00:00Z'))
    );
    const [earlier, later] = await Promise.all([
      service.resolveRecognitionJourneyOwnership(agents[1]),
      service.resolveRecognitionJourneyOwnership(second),
    ]);
    const modes = [earlier.mode, later.mode].sort();
    expect(modes).toEqual(['first_relative', 'subsequent_relative']);
    expect(earlier.firstAgentId).toBe(String(FIRST_AGENT_ID));
    expect(later.firstAgentId).toBe(String(FIRST_AGENT_ID));
  });

  it('stops asking the departure interval question once the time is recorded', () => {
    const journey = buildInitialRecognitionJourney({ mode: 'first_relative' });
    const departure = journey.tasks.find(
      item => item.id === 'departure_interval'
    );
    expect(departure?.status).toBe('pending');

    const marked = markDepartureIntervalAnswered(
      journey,
      new Date('2026-09-19T07:25:42.748Z')
    );
    expect(marked.tasks.find(item => item.id === 'departure_interval')).toMatchObject(
      {
        status: 'completed',
        observationEvidence: 'departure_time_recorded',
      }
    );
    // 不越权改动另一个任务
    expect(marked.tasks.find(item => item.id === 'family_status')?.status).toBe(
      'pending'
    );
    // 幂等：再次标记不改变已完成的结论
    expect(
      markDepartureIntervalAnswered(marked).tasks.find(
        item => item.id === 'departure_interval'
      )?.observationEvidence
    ).toBe('departure_time_recorded');
  });

  it('leaves the later-relative mode untouched', () => {
    const journey = buildInitialRecognitionJourney({
      mode: 'subsequent_relative',
      mentionCallName: '爸爸',
    });
    const marked = markDepartureIntervalAnswered(journey);
    expect(marked).toEqual(journey);
  });

  it('routes day-only and clock-only departure answers to the observation checkpoint', () => {
    // 真实案例：用户回答"你15号凌晨12:23分走的"，此前的正则会把它判为
    // "没有回答"，答案根本进不了观察点，任务永远完不成。
    expect(
      shouldObserveTaskResponse('departure_interval', '你15号凌晨12:23分走的')
    ).toBe(true);
    expect(shouldObserveTaskResponse('departure_interval', '15号')).toBe(true);
    expect(
      shouldObserveTaskResponse('departure_interval', '凌晨十二点走的')
    ).toBe(true);
    // 既有写法不回退
    expect(
      shouldObserveTaskResponse('departure_interval', '走了三年了')
    ).toBe(true);
    expect(
      shouldObserveTaskResponse('departure_interval', '爷爷')
    ).toBe(false);
  });
});
