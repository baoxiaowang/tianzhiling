import {
  EntitySubscriberInterface,
  EventSubscriber,
  InsertEvent,
  RemoveEvent,
} from 'typeorm';
import {
  AgentEntity,
  MessageEntity,
  MessageRole,
  MongoObjectId,
} from '@tzl/entities';

@EventSubscriber()
export class MessageUserCountSubscriber
  implements EntitySubscriberInterface<MessageEntity>
{
  listenTo() {
    return MessageEntity;
  }

  async afterInsert(event: InsertEvent<MessageEntity>): Promise<void> {
    await this.adjust(event, event.entity, 1);
  }

  async afterRemove(event: RemoveEvent<MessageEntity>): Promise<void> {
    await this.adjust(event, event.entity, -1);
  }

  private async adjust(
    event: InsertEvent<MessageEntity> | RemoveEvent<MessageEntity>,
    message: MessageEntity | undefined,
    delta: 1 | -1
  ): Promise<void> {
    if (message?.role !== MessageRole.user || !message.agentId) {
      return;
    }

    const rawId = String(message.agentId);
    const agentId = MongoObjectId.isValid(rawId)
      ? new MongoObjectId(rawId)
      : message.agentId;
    try {
      await event.manager
        .getMongoRepository(AgentEntity)
        .updateOne(
          { _id: agentId } as never,
          { $inc: { userMessageCount: delta } } as never
        );
    } catch (error) {
      event.connection.logger.log(
        'warn',
        `Failed to update agent user message count: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
}
