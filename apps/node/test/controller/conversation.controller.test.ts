import { ConversationController } from '../../src/controller/conversation.controller';

describe('ConversationController', () => {
  const auth = {
    userId: 'user-1',
  };

  function createController(clientRequestIdHeader = '') {
    const controller = new ConversationController();
    const sendMessage = jest.fn().mockResolvedValue({ replyPending: true });
    const sendMessageAsync = jest
      .fn()
      .mockResolvedValue({ replyPending: true });

    controller.ctx = {
      state: { auth },
      get: jest.fn().mockReturnValue(clientRequestIdHeader),
    } as any;
    controller.conversationService = {
      sendMessage,
      sendMessageAsync,
    } as any;

    return {
      controller,
      sendMessage,
      sendMessageAsync,
    };
  }

  it('reads the client request id from the compatibility header', async () => {
    const { controller, sendMessageAsync } = createController(
      ' local-1722150000000 '
    );

    await controller.sendMessageAsync('conversation-1', {
      content: '你好',
      type: 'text',
    });

    expect(sendMessageAsync).toHaveBeenCalledWith(
      auth,
      'conversation-1',
      expect.objectContaining({
        clientRequestId: 'local-1722150000000',
      })
    );
  });

  it('keeps the body client request id for released compatible clients', async () => {
    const { controller, sendMessage } = createController('header-request-id');

    await controller.sendMessage('conversation-1', {
      content: '你好',
      type: 'text',
      clientRequestId: 'body-request-id',
    });

    expect(sendMessage).toHaveBeenCalledWith(
      auth,
      'conversation-1',
      expect.objectContaining({
        clientRequestId: 'body-request-id',
      })
    );
  });

  it('limits header request ids to the DTO maximum length', async () => {
    const { controller, sendMessageAsync } = createController('a'.repeat(80));

    await controller.sendMessageAsync('conversation-1', {
      content: '你好',
      type: 'text',
    });

    expect(sendMessageAsync.mock.calls[0][2].clientRequestId).toHaveLength(64);
  });
});
