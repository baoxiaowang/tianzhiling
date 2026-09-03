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

  it('forwards assistant voice-to-text conversion', async () => {
    const { controller } = createController();
    const convertMessageVoiceToText = jest
      .fn()
      .mockResolvedValue({ id: 'message-1', type: 'text' });
    controller.conversationService = {
      ...controller.conversationService,
      convertMessageVoiceToText,
    } as any;

    await controller.convertMessageVoiceToText(
      'conversation-1',
      'message-1'
    );

    expect(convertMessageVoiceToText).toHaveBeenCalledWith(
      auth,
      'conversation-1',
      'message-1'
    );
  });

  it('combines messages, agent metadata, and quota in chat bootstrap', async () => {
    const { controller } = createController();
    const listMessages = jest.fn().mockResolvedValue({
      items: [{ id: 'message-1' }],
      pageSize: 30,
      hasMore: true,
    });
    const getChatBootstrapMetadata = jest.fn().mockResolvedValue({
      agent: { id: 'agent-1', name: '妈妈' },
      chatQuota: { isVip: false, remainingCount: 2 },
    });
    controller.messageService = { listMessages } as any;
    controller.conversationService = {
      ...controller.conversationService,
      getChatBootstrapMetadata,
    } as any;

    const result = await controller.getChatBootstrap('conversation-1', {
      pageSize: '30',
      lightweight: 'true',
    });

    expect(listMessages).toHaveBeenCalledWith(auth, 'conversation-1', {
      pageSize: '30',
      lightweight: 'true',
    });
    expect(getChatBootstrapMetadata).toHaveBeenCalledWith(
      auth,
      'conversation-1'
    );
    expect(result).toEqual(
      expect.objectContaining({
        items: [{ id: 'message-1' }],
        agent: { id: 'agent-1', name: '妈妈' },
        chatQuota: { isVip: false, remainingCount: 2 },
      })
    );
  });
});
