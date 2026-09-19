import { RelativeMemoryExtractorService } from '../../src/service/agents/relative-memory-extractor.service';

/**
 * P0-2：前缀缓存的前提是稳定内容在最前、且共享前缀长度超过服务端最小可缓存
 * 前缀（DeepSeek 为 64 token）。这里锁住"模式说明后置"这一行为，避免以后
 * 有人把随请求变化的行又插回系统提示前半段。
 */
describe('RelativeMemoryExtractor prompt prefix stability (P0-2)', () => {
  function captureSystemPrompts() {
    const service = new RelativeMemoryExtractorService() as any;
    service.logger = { warn: jest.fn() };
    const prompts: string[] = [];
    service.openAIService = {
      generateMemoryText: jest.fn(async (request: { systemPrompt: string }) => {
        prompts.push(request.systemPrompt);
        return { content: '{"people":[]}', response: { choices: [] } };
      }),
    };
    return { service, prompts };
  }

  it('普通对话与小使者访谈共享同一段长前缀，模式说明只在最后', async () => {
    const { service, prompts } = captureSystemPrompts();
    const now = new Date('2026-09-19T00:00:00.000Z');
    const text = '我妈妈身体不太好';

    await service.extract(text, { boundAgent: { id: 'agent-a' } as any }, now);
    await service.extract(
      text,
      { messengerParent: { name: '爸爸' } as any },
      now
    );
    // 两种模式都不命中的兜底分支：不应拼接模式说明。
    await service.extract(text, {}, now);

    expect(prompts).toHaveLength(3);
    const [bound, messenger, neither] = prompts;

    const boundModeIndex = bound.indexOf('本次对话对象是当前AI亲人本人');
    const messengerModeIndex = messenger.indexOf('这是小使者访谈');
    expect(boundModeIndex).toBeGreaterThan(0);
    expect(messengerModeIndex).toBeGreaterThan(0);

    // 两种模式的公共前缀覆盖全部稳定规则（JSON schema 行之后才分叉）。
    let common = 0;
    while (
      common < bound.length &&
      bound[common] === messenger[common]
    ) {
      common++;
    }
    const schemaIndex = bound.indexOf('{"people"');
    expect(schemaIndex).toBeGreaterThan(0);
    expect(common).toBeGreaterThan(schemaIndex);
    // 远大于 DeepSeek 的 64-token 最小缓存单位（中文约 1 字/token 量级）。
    expect(common).toBeGreaterThan(200);

    // 稳定规则本身在两种模式下逐字一致。
    expect(bound.slice(0, schemaIndex)).toBe(
      messenger.slice(0, schemaIndex)
    );
    // 兜底分支没有模式说明，但稳定前缀同样一致。
    expect(neither.slice(0, schemaIndex)).toBe(bound.slice(0, schemaIndex));
    expect(neither).not.toContain('本次对话对象是当前AI亲人本人');
    expect(bound.startsWith('你是独立的账户人物记忆抽取器')).toBe(true);
  });
});
