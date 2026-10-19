import { MessageEntity, MongoObjectId } from '@tzl/entities';
import { UnifiedUserMemoryService } from '../../src/service/agents/unified-user-memory.service';

function buildService() {
  const service = new UnifiedUserMemoryService();
  service.logger = { warn: jest.fn() } as never;
  const capturePreExtracted = jest.fn().mockResolvedValue(1);
  const recordPreExtracted = jest.fn().mockResolvedValue(2);
  service.relativeMemoryExtractorService = {
    shouldExtractRelative: jest.fn(() => true),
    capturePreExtracted,
  } as never;
  service.userSelfMemoryService = {
    recordPreExtracted,
  } as never;
  return { service, capturePreExtracted, recordPreExtracted };
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
});
