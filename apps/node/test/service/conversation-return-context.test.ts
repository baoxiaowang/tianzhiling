import {
  CONVERSATION_RETURN_CONTEXT_VERSION,
  CONVERSATION_RETURN_MIN_GAP_MS,
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

  it('exposes exact cross-time contact facts after a meaningful gap', () => {
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
    });
  });

  it('does not turn ordinary continuous chat into a return event', () => {
    expect(
      resolveConversationReturnContext({
        currentTurnAt,
        previousUserContactAt: new Date(
          currentTurnAt.getTime() - CONVERSATION_RETURN_MIN_GAP_MS + 1
        ),
      })
    ).toBeUndefined();
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
    ).toBeUndefined();
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
