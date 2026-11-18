import { MessageEntity, MessageRole, MongoObjectId } from '@tzl/entities';
import { ConversationService } from '../../src/service/conversation.service';

// Exercise the service adapter with persisted entities, including current inputs.
describe('conversation state shadow persisted metadata', () => {
  afterEach(() => jest.useRealTimers());

  it('resets across midnight and counts only prior user turns and assistant shadow markers', async () => {
    const now = new Date(2026, 10, 18, 4, 12);
    jest.useFakeTimers().setSystemTime(now);
    const service = new ConversationService();
    service.relationshipOpenLoopService = {
      loadShadowCandidates: jest.fn().mockResolvedValue([{
        kind: 'open_loop', ref: 'task-1', subject: '待办',
        updatedAt: now.toISOString(),
      }]),
    } as never;
    let sequence = 0;
    const message = (role: MessageRole, createdAt: Date, injected = false) =>
      Object.assign(new MessageEntity(), {
        id: new MongoObjectId((++sequence).toString(16).padStart(24, '0')),
        role, createdAt, replyStateShadowWouldInject: injected,
      });
    const yesterday = new Date(2026, 10, 17, 20, 52);
    const current = message(MessageRole.user, now);
    const messages = [
      message(MessageRole.user, yesterday),
      message(MessageRole.assistant, yesterday, true), current,
    ];
    const decide = () => service['resolveLowInfoStateShadowDecision']({
      conversationId: new MongoObjectId(), momentType: 'low_info_status',
      currentQuery: '到家了', messages, currentTurnMessages: [current],
    });
    expect(await decide()).toMatchObject({ wouldInject: true });
    messages.push(message(MessageRole.user, new Date(2026, 10, 18, 1)));
    expect(await decide()).toMatchObject({
      wouldInject: false, reason: 'shadow:skip|not_opening',
    });
    messages.push(message(MessageRole.assistant, new Date(2026, 10, 18, 1, 1), true));
    expect(await decide()).toMatchObject({
      wouldInject: false, reason: 'shadow:skip|not_opening,budget_used',
    });
  });
});
