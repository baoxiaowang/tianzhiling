import { MessageEntity, MongoObjectId } from '@tzl/entities';
import { UnifiedUserMemoryService } from '../../src/service/agents/unified-user-memory.service';

function buildService() {
  const service = new UnifiedUserMemoryService();
  service.logger = { warn: jest.fn() } as never;
  const capturePreExtracted = jest.fn().mockResolvedValue(1);
  const recordPreExtracted = jest.fn().mockResolvedValue(2);
  const persistUnifiedBatchFacts = jest.fn().mockResolvedValue([]);
  service.agentProfileFactService = {
    persistUnifiedBatchFacts,
    hasUnifiedExtractionSignal: jest.fn(() => true),
  } as never;
  service.relativeMemoryExtractorService = {
    shouldExtractRelative: jest.fn(() => true),
    capturePreExtracted,
  } as never;
  service.userSelfMemoryService = {
    recordPreExtracted,
  } as never;
  return {
    service,
    capturePreExtracted,
    recordPreExtracted,
    persistUnifiedBatchFacts,
  };
}

function buildMessage() {
  return Object.assign(new MessageEntity(), {
    id: new MongoObjectId('665000000000000000000901'),
    userId: new MongoObjectId('665000000000000000000902'),
    agentId: new MongoObjectId('665000000000000000000903'),
    createdAt: new Date('2026-10-07T12:27:00.000Z'),
  });
}

describe('UnifiedUserMemoryService', () => {
  it('extracts relatives and user self facts with one model call', async () => {
    const { service, capturePreExtracted, recordPreExtracted } = buildService();
    const generateMemoryText = jest.fn().mockResolvedValue({
      content: JSON.stringify({
        people: [
          {
            referenceName: '核桃',
            relationToUser: '儿子',
            facts: [
              {
                domain: 'growth',
                key: 'growth.age',
                value: '核桃快十岁了',
                status: 'current',
              },
            ],
          },
        ],
        selfFacts: [
          {
            domain: 'work',
            key: 'work.pressure',
            value: '用户最近工作压力大',
            status: 'current',
          },
        ],
      }),
    });
    service.openAIService = {
      isEnabled: jest.fn(() => true),
      generateMemoryText,
    } as never;

    await expect(
      service.captureFromUserMessage(
        buildMessage(),
        '我最近工作压力很大，家里那个快十岁了'
      )
    ).resolves.toBe(3);

    expect(generateMemoryText).toHaveBeenCalledTimes(1);
    expect(capturePreExtracted).toHaveBeenCalledTimes(1);
    expect(capturePreExtracted.mock.calls[0][2]).toHaveLength(1);
    expect(recordPreExtracted).toHaveBeenCalledTimes(1);
    expect(recordPreExtracted.mock.calls[0][2]).toHaveLength(1);
  });

  it('skips the model call when neither side is worth extracting', async () => {
    const { service } = buildService();
    (
      service.relativeMemoryExtractorService as never as {
        shouldExtractRelative: jest.Mock;
      }
    ).shouldExtractRelative = jest.fn(() => false);
    const generateMemoryText = jest.fn();
    service.openAIService = {
      isEnabled: jest.fn(() => true),
      generateMemoryText,
    } as never;

    await expect(
      service.captureFromUserMessage(buildMessage(), '好的')
    ).resolves.toBe(0);
    expect(generateMemoryText).not.toHaveBeenCalled();
  });

  it('does not persist a truncated or non-JSON output', async () => {
    const { service, capturePreExtracted, recordPreExtracted } = buildService();
    const generateMemoryText = jest.fn().mockResolvedValue({
      content: '{"people":[{"referenceName":"核',
      response: { choices: [{ finish_reason: 'length' }] },
    });
    service.openAIService = {
      isEnabled: jest.fn(() => true),
      generateMemoryText,
    } as never;

    await expect(
      service.captureFromUserMessage(buildMessage(), '核桃是我儿子')
    ).resolves.toBe(0);
    expect(capturePreExtracted).not.toHaveBeenCalled();
    expect(recordPreExtracted).not.toHaveBeenCalled();
  });

  it('persists all three namespaces from one batch call', async () => {
    const {
      service,
      capturePreExtracted,
      recordPreExtracted,
      persistUnifiedBatchFacts,
    } = buildService();
    const first = buildMessage();
    const second = Object.assign(new MessageEntity(), {
      id: new MongoObjectId('665000000000000000000911'),
      userId: first.userId,
      agentId: first.agentId,
      createdAt: new Date('2026-10-07T12:28:00.000Z'),
    });
    persistUnifiedBatchFacts.mockResolvedValue([
      { messageId: first.id.toString(), total: 1, facts: [] },
      { messageId: second.id.toString(), total: 0, facts: [] },
    ]);
    const generateMemoryText = jest.fn().mockResolvedValue({
      content: JSON.stringify({
        agent: [
          {
            messageId: first.id.toString(),
            type: 'identity',
            key: 'identity.real_name',
            value: '当前角色正式姓名是李明',
            polarity: 'positive',
            confidence: 'extracted',
            priority: 1,
          },
        ],
        user: [
          {
            messageId: first.id.toString(),
            domain: 'work',
            key: 'work.pressure',
            value: '用户最近工作压力大',
            status: 'current',
          },
        ],
        people: [
          {
            messageId: second.id.toString(),
            referenceName: '核桃',
            relationToUser: '儿子',
            facts: [],
          },
        ],
      }),
    });
    service.openAIService = {
      isEnabled: jest.fn(() => true),
      generateMemoryText,
    } as never;

    const result = await service.captureBatch([
      { message: first, searchableText: '我叫李明，最近工作压力大' },
      { message: second, searchableText: '核桃是我儿子' },
    ]);

    expect(generateMemoryText).toHaveBeenCalledTimes(1);
    expect(persistUnifiedBatchFacts).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      agentCount: 1,
      userCount: 2,
      relativeCount: 1,
    });
    expect(result?.agentCountByMessageId.get(first.id.toString())).toBe(1);
    expect(result?.agentCountByMessageId.get(second.id.toString())).toBe(0);
    expect(recordPreExtracted).toHaveBeenCalledTimes(1);
    expect(recordPreExtracted.mock.calls[0][2]).toHaveLength(1);
    expect(capturePreExtracted).toHaveBeenCalledTimes(1);
    expect(capturePreExtracted.mock.calls[0][2]).toHaveLength(1);
  });

  it('returns null when batch messageIds do not belong to the batch', async () => {
    const { service } = buildService();
    const generateMemoryText = jest.fn().mockResolvedValue({
      content: JSON.stringify({
        agent: [{ messageId: 'not-in-batch', key: 'x', value: 'y' }],
        user: [],
        people: [],
      }),
    });
    service.openAIService = {
      isEnabled: jest.fn(() => true),
      generateMemoryText,
    } as never;

    await expect(
      service.captureBatch([
        { message: buildMessage(), searchableText: '我叫李明' },
      ])
    ).resolves.toBeNull();
  });

  it('skips the batch model call when no entry has a signal, but still persists rule facts', async () => {
    const { service, persistUnifiedBatchFacts } = buildService();
    (
      service.agentProfileFactService as never as {
        hasUnifiedExtractionSignal: jest.Mock;
      }
    ).hasUnifiedExtractionSignal = jest.fn(() => false);
    (
      service.relativeMemoryExtractorService as never as {
        shouldExtractRelative: jest.Mock;
      }
    ).shouldExtractRelative = jest.fn(() => false);
    const generateMemoryText = jest.fn();
    service.openAIService = {
      isEnabled: jest.fn(() => true),
      generateMemoryText,
    } as never;

    const result = await service.captureBatch([
      { message: buildMessage(), searchableText: '好的' },
    ]);

    expect(generateMemoryText).not.toHaveBeenCalled();
    expect(persistUnifiedBatchFacts).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      agentCount: 0,
      userCount: 0,
      relativeCount: 0,
    });
  });
});
