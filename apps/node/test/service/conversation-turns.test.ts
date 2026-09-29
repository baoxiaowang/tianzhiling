import {
  countTurnMessages,
  groupMessagesIntoTurns,
  selectRecentHistoryTurns,
} from '../../src/common/conversation-turns';

interface TestMessage {
  id: string;
  role: 'user' | 'assistant';
  replyGroupId?: string;
  content: string;
}

let sequence = 0;
function message(
  role: 'user' | 'assistant',
  content: string,
  replyGroupId?: string
): TestMessage {
  sequence += 1;
  return {
    id: `m${String(sequence).padStart(4, '0')}`,
    role,
    content,
    ...(replyGroupId ? { replyGroupId } : {}),
  };
}

function select(
  messages: TestMessage[],
  options: Partial<{
    turnLimit: number;
    messageCap: number;
    coveredMessageId: string;
    pinnedMessageIds: string[];
    loadBoundaryTruncated: boolean;
  }> = {}
) {
  return selectRecentHistoryTurns({
    messages,
    turnLimit: options.turnLimit ?? 8,
    messageCap: options.messageCap ?? 32,
    coveredMessageId: options.coveredMessageId,
    pinnedMessageIds: options.pinnedMessageIds,
    loadBoundaryTruncated: options.loadBoundaryTruncated,
    stringifyId: item => item.id,
  });
}

/** 生成 turnCount 轮，每轮 1 条用户消息 + (perTurn-1) 条同组助手气泡。 */
function buildTurns(turnCount: number, perTurn = 5): TestMessage[] {
  const messages: TestMessage[] = [];
  for (let index = 0; index < turnCount; index += 1) {
    messages.push(message('user', `用户${index}`));
    for (let bubble = 0; bubble < perTurn - 1; bubble += 1) {
      messages.push(message('assistant', `助手${index}-${bubble}`, `g${index}`));
    }
  }
  return messages;
}

/** 断言：没有任何“孤立助手回复”——保留的助手消息所在轮，其用户依据也在保留集合里。 */
function expectNoOrphanAssistant(
  all: TestMessage[],
  retained: TestMessage[]
): void {
  const retainedIds = new Set(retained.map(item => item.id));
  for (const turn of groupMessagesIntoTurns(all)) {
    const userMessages = turn.filter(item => item.role === 'user');
    const assistants = turn.filter(item => item.role === 'assistant');
    const retainedAssistants = assistants.filter(item =>
      retainedIds.has(item.id)
    );
    if (!retainedAssistants.length) continue;
    // 降级时优先保留用户依据：只要保留了助手，必须至少保留该轮的用户消息。
    expect(userMessages.some(item => retainedIds.has(item.id))).toBe(true);
  }
}

describe('conversation turns', () => {
  beforeEach(() => {
    sequence = 0;
  });

  it('groups a user batch with its assistant reply group into one turn', () => {
    const messages = [
      message('user', '第一句'),
      message('user', '第二句'),
      message('assistant', '回复一', 'g1'),
      message('assistant', '回复二', 'g1'),
      message('user', '下一句'),
      message('assistant', '回复三', 'g2'),
    ];

    const turns = groupMessagesIntoTurns(messages);

    expect(turns).toHaveLength(2);
    expect(turns[0].map(item => item.content)).toEqual([
      '第一句',
      '第二句',
      '回复一',
      '回复二',
    ]);
    expect(turns[1].map(item => item.content)).toEqual(['下一句', '回复三']);
    expect(countTurnMessages(turns)).toBe(6);
  });

  it('starts a new turn when an assistant reply group changes', () => {
    const messages = [
      message('user', '你说点啥'),
      message('assistant', '主动第一段', 'g1'),
      message('assistant', '主动第二段', 'g2'),
    ];

    const turns = groupMessagesIntoTurns(messages);

    expect(turns).toHaveLength(2);
    expect(turns[0].map(item => item.content)).toEqual([
      '你说点啥',
      '主动第一段',
    ]);
    expect(turns[1].map(item => item.content)).toEqual(['主动第二段']);
  });

  it('keeps the last N complete turns when within budget', () => {
    const messages = buildTurns(12, 3);

    const result = select(messages, { turnLimit: 3 });

    expect(result.turnCount).toBe(3);
    expect(result.partialTurnRetained).toBe(false);
    expect(result.omittedMessageCount).toBe(0);
    expect(result.messages.map(item => item.content)).toEqual([
      '用户9',
      '助手9-0',
      '助手9-1',
      '用户10',
      '助手10-0',
      '助手10-1',
      '用户11',
      '助手11-0',
      '助手11-1',
    ]);
  });

  it('drops whole oldest turns over budget without leaving orphan assistants', () => {
    // 8 轮 × 每轮 5 条 = 40 条，上限 32：应整轮删掉最旧 2 轮，保留 6 轮 30 条。
    const messages = buildTurns(8, 5);

    const result = select(messages, { messageCap: 32 });

    expect(result.messages).toHaveLength(30);
    expect(result.turnCount).toBe(6);
    expect(result.omittedTurnCount).toBe(2);
    expect(result.omittedMessageCount).toBe(10);
    expect(result.partialTurnRetained).toBe(false);
    expect(result.messages[0].role).toBe('user');
    expect(result.messages[0].content).toBe('用户2');
    expectNoOrphanAssistant(messages, result.messages);
  });

  it('recomputes summary coverage for a boundary at the end of a retained turn', () => {
    const messages = buildTurns(8, 5);
    // 第 2 轮的最后一条助手消息；第 0、1 轮会被删掉（在覆盖位置之前）。
    const covered = messages[14];

    const result = select(messages, {
      messageCap: 32,
      coveredMessageId: covered.id,
    });

    expect(result.coversSummaryBoundary).toBe(true);
    expect(result.summaryGapMessageCount).toBe(0);
  });

  it('reports a gap when the summary boundary is inside a dropped turn', () => {
    const messages = buildTurns(8, 5);
    // 第 0 轮中间一条助手消息，会被超预算整轮删除，且其后的消息也被删。
    const covered = messages[2];

    const result = select(messages, {
      messageCap: 32,
      coveredMessageId: covered.id,
    });

    expect(result.coversSummaryBoundary).toBe(false);
    expect(result.summaryGapMessageCount).toBeGreaterThan(0);
  });

  it('handles a summary boundary in the middle of a retained turn', () => {
    const messages = buildTurns(8, 5);
    // 第 5 轮的中间助手消息；整轮被保留。
    const covered = messages[5 * 5 + 2];

    const result = select(messages, {
      messageCap: 32,
      coveredMessageId: covered.id,
    });

    expect(result.messages.some(item => item.id === covered.id)).toBe(true);
    expect(result.coversSummaryBoundary).toBe(true);
    expect(result.summaryGapMessageCount).toBe(0);
  });

  it('reports a gap when the summary boundary predates the retained turn window', () => {
    const messages = buildTurns(20, 2);
    const covered = messages[5]; // 第 2 轮，远早于最近 8 轮

    const result = select(messages, {
      turnLimit: 8,
      messageCap: 32,
      coveredMessageId: covered.id,
    });

    expect(result.coversSummaryBoundary).toBe(false);
    expect(result.summaryGapMessageCount).toBeGreaterThan(0);
  });

  it('marks coverage unverifiable when the coverage id is absent but all messages are kept', () => {
    const messages = buildTurns(4, 2);

    const result = select(messages, { coveredMessageId: 'not-loaded-message' });

    expect(result.messages).toHaveLength(8);
    expect(result.omittedMessageCount).toBe(0);
    expect(result.summaryGapMessageCount).toBe(0);
    // 已加载范围内缺口为零，但覆盖 ID 不存在 → 不可核实，不能声称已衔接。
    expect(result.coverageBoundaryVerifiable).toBe(false);
    expect(result.coversSummaryBoundary).toBe(false);
  });

  it('cannot claim coverage when the boundary is outside the loaded range', () => {
    const overBudget = buildTurns(8, 5);
    const gapped = select(overBudget, {
      messageCap: 32,
      coveredMessageId: 'not-loaded-message',
    });
    expect(gapped.coverageBoundaryVerifiable).toBe(false);
    expect(gapped.coversSummaryBoundary).toBe(false);
    expect(gapped.summaryGapMessageCount).toBeGreaterThan(0);

    const withinBudget = buildTurns(4, 3);
    const clean = select(withinBudget, {
      messageCap: 32,
      coveredMessageId: 'not-loaded-message',
    });
    expect(clean.coverageBoundaryVerifiable).toBe(false);
    expect(clean.coversSummaryBoundary).toBe(false);
  });

  it('treats a verified boundary with no gap as connected', () => {
    const messages = buildTurns(4, 2);
    const covered = messages[2];

    const result = select(messages, { coveredMessageId: covered.id });

    expect(result.coverageBoundaryVerifiable).toBe(true);
    expect(result.coversSummaryBoundary).toBe(true);
    expect(result.summaryGapMessageCount).toBe(0);
  });

  it('degrades a single over-budget turn by keeping user evidence first', () => {
    // 一轮 5 条用户依据 + 35 条助手气泡，上限 32。
    const messages: TestMessage[] = [];
    for (let index = 0; index < 5; index += 1) {
      messages.push(message('user', `依据${index}`));
    }
    for (let bubble = 0; bubble < 35; bubble += 1) {
      messages.push(message('assistant', `长回复${bubble}`, 'g0'));
    }

    const result = select(messages, { messageCap: 32 });

    expect(result.partialTurnRetained).toBe(true);
    expect(result.turnCount).toBe(0);
    expect(result.messages).toHaveLength(32);
    expect(result.messages[0].role).toBe('user');
    expect(
      result.messages.filter(item => item.role === 'user').map(item => item.content)
    ).toEqual(['依据0', '依据1', '依据2', '依据3', '依据4']);
    expect(result.omittedMessageCount).toBe(8);
    expectNoOrphanAssistant(messages, result.messages);
  });

  it('keeps the most recent user evidence when users alone exceed the cap', () => {
    const messages: TestMessage[] = [];
    for (let index = 0; index < 40; index += 1) {
      messages.push(message('user', `连续${index}`));
    }

    const result = select(messages, { messageCap: 32 });

    expect(result.partialTurnRetained).toBe(true);
    expect(result.messages).toHaveLength(32);
    expect(result.messages[0].content).toBe('连续8');
    expect(result.messages[result.messages.length - 1].content).toBe('连续39');
    expect(result.omittedMessageCount).toBe(8);
  });

  it('keeps pinned turns when the budget can fit them', () => {
    const messages = buildTurns(8, 5);
    const pinnedUser = messages[0]; // 第 0 轮用户依据，比 8 轮窗口更旧

    const result = select(messages, {
      messageCap: 32,
      pinnedMessageIds: [pinnedUser.id],
    });

    expect(result.messages.some(item => item.id === pinnedUser.id)).toBe(true);
    expect(result.pinnedOmittedMessageCount).toBe(0);
    expect(result.messages).toHaveLength(30);
    expectNoOrphanAssistant(messages, result.messages);
  });

  it('records pinned messages dropped when the budget cannot fit them', () => {
    // 一轮里固定最早的一条助手气泡；单轮降级会优先保留用户与更新的助手。
    const messages: TestMessage[] = [];
    messages.push(message('user', '用户依据'));
    for (let bubble = 0; bubble < 40; bubble += 1) {
      messages.push(message('assistant', `气泡${bubble}`, 'g0'));
    }
    const pinned = messages[1];

    const result = select(messages, {
      messageCap: 20,
      pinnedMessageIds: [pinned.id],
    });

    expect(result.partialTurnRetained).toBe(true);
    expect(result.messages.length).toBeLessThanOrEqual(20);
    expect(result.pinnedOmittedMessageCount).toBe(1);
  });

  it('marks history incomplete when the load boundary falls mid-turn', () => {
    const messages = buildTurns(4, 3);

    const truncated = select(messages, { loadBoundaryTruncated: true });
    const clean = select(messages);

    expect(truncated.loadBoundaryTruncated).toBe(true);
    expect(clean.loadBoundaryTruncated).toBe(false);
  });

  it('excludes a truncated first turn from the confirmed complete turn count', () => {
    const messages = buildTurns(3, 2);

    const result = select(messages, { loadBoundaryTruncated: true });

    // 3 轮都在窗口内，但最早一轮受加载边界影响，只能算 2 轮确认完整。
    expect(result.messages).toHaveLength(6);
    expect(result.loadBoundaryTurnUnconfirmed).toBe(true);
    expect(result.turnCount).toBe(2);
  });

  it('does not discount turns when the truncated first turn is outside the window', () => {
    const messages = buildTurns(12, 2);

    const result = select(messages, { loadBoundaryTruncated: true });

    expect(result.loadBoundaryTurnUnconfirmed).toBe(false);
    expect(result.turnCount).toBe(8);
  });

  it('preserves user evidence regardless of assistant bubble count', () => {
    const withOneBubble: TestMessage[] = [];
    const withFourBubbles: TestMessage[] = [];
    for (let index = 0; index < 9; index += 1) {
      withOneBubble.push(message('user', `用户${index}`));
      withOneBubble.push(message('assistant', `助手${index}`, `g${index}`));
      withFourBubbles.push(message('user', `用户${index}`));
      for (let bubble = 0; bubble < 4; bubble += 1) {
        withFourBubbles.push(
          message('assistant', `助手${index}-${bubble}`, `g${index}`)
        );
      }
    }

    const one = select(withOneBubble, { messageCap: 32 });
    const four = select(withFourBubbles, { messageCap: 32 });

    for (const [all, result] of [
      [withOneBubble, one],
      [withFourBubbles, four],
    ] as const) {
      expect(result.messages[0].role).toBe('user');
      expectNoOrphanAssistant(all, result.messages);
    }
    // 同一批用户依据在两版里的相对取舍一致：都不会把用户消息单独丢掉。
    const retainedUsers = (result: ReturnType<typeof select>) =>
      result.messages
        .filter(item => item.role === 'user')
        .map(item => item.content);
    expect(retainedUsers(one)).toContain('用户8');
    expect(retainedUsers(four)).toContain('用户8');
  });

  it('extends the window back to the summary coverage boundary', () => {
    const messages = buildTurns(12, 2);
    const coveredMessageId = messages[3].id; // 第 1 轮

    const result = select(messages, { turnLimit: 4, coveredMessageId });

    expect(result.coverageExtended).toBe(true);
    expect(result.messages[0].content).toBe('用户1');
    expect(result.messages.map(item => item.content)).toContain('助手11-0');
  });

  it('keeps the kinship clarification turns inside the default window', () => {
    // 复刻 2026-09-29 “老姑孙子出生 → 我哥的孩子 → 男孩 → 我是你孙女”的结构。
    const messages = [
      message('user', '我老姑的孙子生出来了'),
      message('assistant', '那是好事啊', 'g1'),
      message('assistant', '你老姑身体还好吧', 'g1'),
      message('user', '？'),
      message('assistant', '是爷问的不对？', 'g2'),
      message('user', '我哥的孩子'),
      message('assistant', '是你哥的孩子啊', 'g3'),
      message('assistant', '男孩女孩？', 'g3'),
      message('user', '男孩'),
      message('assistant', '咱们老马家添了个带把的', 'g4'),
      message('assistant', '你哥那性子可得收收心', 'g4'),
      message('user', '？'),
      message('assistant', '咋又愣神了', 'g5'),
      message('user', '？？？'),
      message('assistant', '别光打问号', 'g6'),
      message('assistant', '有啥话跟爷说', 'g6'),
    ];

    const result = select(messages, { turnLimit: 8 });
    const contents = result.messages.map(item => item.content);

    expect(contents).toContain('我老姑的孙子生出来了');
    expect(contents).toContain('我哥的孩子');
    expect(contents).toContain('男孩');
    expect(result.coverageExtended).toBe(false);
    expect(result.omittedMessageCount).toBe(0);
    expectNoOrphanAssistant(messages, result.messages);
  });
});
