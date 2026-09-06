import { createHash } from 'crypto';
import { resolve } from 'path';
import { DataSource } from 'typeorm';
import {
  AgentEntity,
  MessageEntity,
  MessageRole,
  MongoObjectId,
} from '@tzl/entities';
import {
  loadEnvFileIfExists,
  readBooleanFrom,
  readNumberFrom,
  readStringFrom,
} from '@tzl/shared';

const APPLY_CONFIRMATION = 'write-reviewed-agent-message-counts';

loadEnvFileIfExists(resolve(__dirname, '../../../../.env'));

const stringifyId = (value?: MongoObjectId): string =>
  value?.toHexString?.() ?? (value ? String(value) : '');

async function main(): Promise<void> {
  const mode = readStringFrom(['AGENT_MESSAGE_COUNT_BACKFILL_MODE'], 'audit');
  const dataSource = new DataSource({
    type: 'mongodb',
    database: readStringFrom(
      ['ADMIN_API_MONGO_DB', 'NODE_MONGO_DB', 'MONGO_DB'],
      'tzl'
    ),
    host: readStringFrom(
      ['ADMIN_API_MONGO_HOST', 'NODE_MONGO_HOST', 'MONGO_HOST'],
      '127.0.0.1'
    ),
    port: readNumberFrom(
      ['ADMIN_API_MONGO_PORT', 'NODE_MONGO_PORT', 'MONGO_PORT'],
      17271
    ),
    authSource: readStringFrom(
      [
        'ADMIN_API_MONGO_AUTH_SOURCE',
        'NODE_MONGO_AUTH_SOURCE',
        'MONGO_AUTH_SOURCE',
      ],
      'admin'
    ),
    username: readStringFrom(
      ['ADMIN_API_MONGO_USERNAME', 'NODE_MONGO_USERNAME', 'MONGO_USERNAME'],
      'admin'
    ),
    password: readStringFrom(
      ['ADMIN_API_MONGO_PASSWORD', 'NODE_MONGO_PASSWORD', 'MONGO_PASSWORD'],
      ''
    ),
    synchronize: false,
    logging: readBooleanFrom(['ADMIN_API_DB_LOGGING'], false),
    entities: [AgentEntity, MessageEntity],
  } as never);

  await dataSource.initialize();
  try {
    const agentRepo = dataSource.getMongoRepository(AgentEntity);
    const messageRepo = dataSource.getMongoRepository(MessageEntity);
    const [agents, rows] = await Promise.all([
      agentRepo.find({
        select: ['id', 'userMessageCount', 'userMessageCountBackfilledAt'],
      }),
      messageRepo
        .aggregate([
          { $match: { role: MessageRole.user, agentId: { $exists: true } } },
          { $group: { _id: '$agentId', count: { $sum: 1 } } },
        ])
        .toArray() as Promise<Array<{ _id: MongoObjectId; count: number }>>,
    ]);
    const desired = new Map(rows.map(row => [stringifyId(row._id), row.count]));
    const changes = agents
      .map(agent => ({
        agentId: stringifyId(agent.id),
        from: Number.isFinite(agent.userMessageCount)
          ? Number(agent.userMessageCount)
          : null,
        to: desired.get(stringifyId(agent.id)) ?? 0,
        backfilled: Boolean(agent.userMessageCountBackfilledAt),
      }))
      .filter(change => change.from !== change.to || !change.backfilled);
    const approvalDigest = createHash('sha256')
      .update(JSON.stringify(changes))
      .digest('hex');

    if (mode === 'apply') {
      if (
        readStringFrom(['AGENT_MESSAGE_COUNT_BACKFILL_CONFIRM'], '') !==
          APPLY_CONFIRMATION ||
        readStringFrom(['AGENT_MESSAGE_COUNT_BACKFILL_APPROVAL_DIGEST'], '') !==
          approvalDigest
      ) {
        throw new Error('回填需要确认短语和本次审计 approvalDigest');
      }
      for (let offset = 0; offset < changes.length; offset += 500) {
        const backfilledAt = new Date();
        await agentRepo.bulkWrite(
          changes.slice(offset, offset + 500).map(change => ({
            updateOne: {
              filter: { _id: new MongoObjectId(change.agentId) },
              update: {
                $inc: {
                  userMessageCount: change.to - (change.from ?? 0),
                },
                $set: {
                  userMessageCountBackfilledAt: backfilledAt,
                },
              },
            },
          })) as never
        );
      }
    }

    console.log(
      JSON.stringify(
        {
          mode,
          scannedAgents: agents.length,
          changedAgents: changes.length,
          approvalDigest,
          changes,
        },
        null,
        2
      )
    );
  } finally {
    await dataSource.destroy();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
