import { MessageRole, MongoObjectId } from '@tzl/entities';
import { close, createApp } from '@midwayjs/mock';
import { Framework } from '@midwayjs/koa';
import { MessageUserCountSubscriber } from '../../src/subscriber/message-user-count.subscriber';

describe('MessageUserCountSubscriber', () => {
  it('is resolvable by the Midway container used by TypeORM', async () => {
    const app = await createApp<Framework>();

    try {
      const subscriber = await app
        .getApplicationContext()
        .getAsync(MessageUserCountSubscriber);

      expect(subscriber).toBeInstanceOf(MessageUserCountSubscriber);
    } finally {
      await close(app);
    }
  });

  it('increments the materialized count after a user message is inserted', async () => {
    const updateOne = jest.fn().mockResolvedValue({ acknowledged: true });
    const subscriber = new MessageUserCountSubscriber();
    const agentId = new MongoObjectId();

    await subscriber.afterInsert({
      entity: { role: MessageRole.user, agentId },
      manager: {
        getMongoRepository: jest.fn().mockReturnValue({ updateOne }),
      },
    } as never);

    expect(updateOne).toHaveBeenCalledWith(
      { _id: agentId },
      { $inc: { userMessageCount: 1 } }
    );
  });

  it('does not change the count for an agent-authored message', async () => {
    const updateOne = jest.fn();
    const subscriber = new MessageUserCountSubscriber();

    await subscriber.afterInsert({
      entity: { role: MessageRole.assistant, agentId: new MongoObjectId() },
      manager: {
        getMongoRepository: jest.fn().mockReturnValue({ updateOne }),
      },
    } as never);

    expect(updateOne).not.toHaveBeenCalled();
  });

  it('does not fail message persistence when the counter update fails', async () => {
    const log = jest.fn();
    const subscriber = new MessageUserCountSubscriber();

    await expect(
      subscriber.afterInsert({
        entity: { role: MessageRole.user, agentId: new MongoObjectId() },
        manager: {
          getMongoRepository: jest.fn().mockReturnValue({
            updateOne: jest.fn().mockRejectedValue(new Error('temporary')),
          }),
        },
        connection: { logger: { log } },
      } as never)
    ).resolves.toBeUndefined();

    expect(log).toHaveBeenCalledWith(
      'warn',
      'Failed to update agent user message count: temporary'
    );
  });
});
