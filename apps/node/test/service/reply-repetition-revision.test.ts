import { ReplyRevisionService } from '../../src/service/agents/reply-revision.service';
describe('repeated reply revision transport', () => {
  it('retains full context and bounds call retries', async () => {
    const service = new ReplyRevisionService();
    const createChatCompletion = jest
      .fn()
      .mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({ segments: ['是我刚才理解错了。'] }),
            },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });
    Object.assign(service, { openAIService: { createChatCompletion } });
    const messages = [
      { role: 'system', content: '你是爷爷' },
      { role: 'user', content: '我是你孙女' },
    ] as any;
    const r = await service.reviseRepeatedReply({
      messages,
      userQuery: '我是你孙女',
      segments: ['重复内容'],
    });
    expect(createChatCompletion.mock.calls[0][0].messages.slice(0, 2)).toEqual(
      messages
    );
    expect(createChatCompletion.mock.calls[0][1]).toEqual({
      timeout: 12000,
      maxRetries: 0,
    });
    expect(r?.segments).toEqual(['是我刚才理解错了。']);
    expect(r?.usage.totalTokens).toBe(15);
  });
  it('does not return protocol or blank replies', async () => {
    const service = new ReplyRevisionService();
    Object.assign(service, {
      openAIService: {
        createChatCompletion: jest
          .fn()
          .mockResolvedValue({
            choices: [{ message: { content: '{"segments":[""]}' } }],
          }),
      },
    });
    expect(
      (
        await service.reviseRepeatedReply({
          messages: [],
          userQuery: '？',
          segments: ['重复'],
        })
      )?.segments
    ).toEqual([]);
  });
});
