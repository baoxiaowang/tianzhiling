import {
  CONVERSATION_RETURN_CONTEXT_VERSION,
  CONVERSATION_TIME_MATERIAL_MIN_GAP_MS,
  describeElapsedTime,
  formatBeijingDateTime,
  resolveConversationReturnContext,
} from '../../src/service/agents/conversation-return-context';
import { ConversationService } from '../../src/service/conversation.service';
import {
  ConversationEntity,
  MessageEntity,
  MessageRole,
  MongoObjectId,
} from '@tzl/entities';

describe('conversation return context', () => {
  const currentTurnAt = new Date('2026-09-05T12:00:00.000Z');

  it('exposes exact cross-time contact facts', () => {
    const result = resolveConversationReturnContext({
      currentTurnAt,
      previousUserContactAt: new Date('2026-09-02T12:00:00.000Z'),
      previousAssistantContactAt: new Date('2026-09-02T12:05:00.000Z'),
    });

    expect(result).toEqual({
      version: CONVERSATION_RETURN_CONTEXT_VERSION,
      currentTurnAt: '2026-09-05T12:00:00.000Z',
      previousContactAt: '2026-09-02T12:05:00.000Z',
      previousUserContactAt: '2026-09-02T12:00:00.000Z',
      previousAssistantContactAt: '2026-09-02T12:05:00.000Z',
      elapsedHours: 71.9,
      elapsedDays: 3,
      isReunion: true,
    });
  });

  it('reports short gaps too, but marks them as continuous chat', () => {
    // 时间是常态参考材料：连着聊也要给出准确间隔，由模型自己判断分寸；
    // isReunion 只保留"隔了一段时间"这个事实，供快路径等上层使用。
    const result = resolveConversationReturnContext({
      currentTurnAt,
      previousUserContactAt: new Date(currentTurnAt.getTime() - 30 * 60 * 1000),
    });

    expect(result).toEqual(
      expect.objectContaining({
        elapsedHours: 0.5,
        elapsedDays: 0.02,
        isReunion: false,
      })
    );
  });

  it('keeps the 6-hour threshold as the point where elapsed time matters', () => {
    // 超过 6 小时的间隔才值得告诉模型"上一次是多久以前"。
    expect(CONVERSATION_TIME_MATERIAL_MIN_GAP_MS).toBe(6 * 60 * 60 * 1000);
  });

  it('requires a prior user contact instead of treating an opening as return', () => {
    expect(
      resolveConversationReturnContext({
        currentTurnAt,
        previousAssistantContactAt: new Date('2026-08-01T12:00:00.000Z'),
      })
    ).toBeUndefined();
  });

  it('uses a more recent assistant contact as the actual contact boundary', () => {
    expect(
      resolveConversationReturnContext({
        currentTurnAt,
        previousUserContactAt: new Date('2026-01-01T00:00:00.000Z'),
        previousAssistantContactAt: new Date('2026-09-05T00:00:00.000Z'),
      })
    ).toEqual(
      expect.objectContaining({
        previousContactAt: '2026-09-05T00:00:00.000Z',
        elapsedHours: 12,
        isReunion: false,
      })
    );
  });

  it('rejects future and invalid timestamps', () => {
    expect(
      resolveConversationReturnContext({
        currentTurnAt,
        previousUserContactAt: new Date('2026-09-06T00:00:00.000Z'),
      })
    ).toBeUndefined();
    expect(
      resolveConversationReturnContext({
        currentTurnAt: new Date('invalid'),
        previousUserContactAt: new Date('2026-01-01T00:00:00.000Z'),
      })
    ).toBeUndefined();
  });

  it('renders Beijing time in plain Chinese with the weekday', () => {
    // 2026-09-05T12:00:00.000Z 是北京时间 2026-09-05 20:00（周六）。
    expect(formatBeijingDateTime(currentTurnAt)).toBe(
      '2026年9月5日（周六）20:00'
    );
    expect(formatBeijingDateTime(new Date('invalid'))).toBe('');
  });

  it('describes elapsed time in plain Chinese across scales', () => {
    const minutes = (value: number) => new Date(value * 60 * 1000);
    expect(describeElapsedTime(minutes(0), minutes(25))).toBe('约 25 分钟');
    expect(describeElapsedTime(minutes(0), minutes(150))).toBe('约 2.5 小时');
    expect(
      describeElapsedTime(new Date('2026-09-01T00:00:00Z'), currentTurnAt)
    ).toBe('约 4.5 天');
    expect(
      describeElapsedTime(new Date('2026-05-05T12:00:00Z'), currentTurnAt)
    ).toBe('约 4 个月');
  });

  it('loads the latest real user and assistant contacts independently', async () => {
    const service = new ConversationService();
    const previousUserAt = new Date('2026-09-01T12:00:00.000Z');
    const previousAssistantAt = new Date('2026-09-01T12:03:00.000Z');
    const findOne = jest.fn(({ where }: { where: { role: MessageRole } }) =>
      Promise.resolve(
        where.role === MessageRole.user
          ? ({ createdAt: previousUserAt } as MessageEntity)
          : ({ createdAt: previousAssistantAt } as MessageEntity)
      )
    );
    service.messageModel = { findOne } as never;

    const result = await (service as any).loadConversationReturnContext({
      conversation: {
        id: new MongoObjectId(),
      } as ConversationEntity,
      currentTurnMessages: [
        { createdAt: currentTurnAt } as MessageEntity,
        { createdAt: new Date('2026-09-05T12:00:03.000Z') } as MessageEntity,
      ],
    });

    expect(result).toEqual(
      expect.objectContaining({
        previousUserContactAt: previousUserAt.toISOString(),
        previousAssistantContactAt: previousAssistantAt.toISOString(),
        previousContactAt: previousAssistantAt.toISOString(),
      })
    );
    expect(findOne).toHaveBeenCalledTimes(2);
    expect(findOne.mock.calls[0][0].where).toEqual(
      expect.objectContaining({
        role: MessageRole.user,
        quotaExempt: { $ne: true },
        replyTrigger: { $ne: false },
        createdAt: { $lt: currentTurnAt },
      })
    );
  });
});
