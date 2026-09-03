import { basename, resolve } from 'path';
import { DataSource } from 'typeorm';
import {
  AgentEntity,
  MongoObjectId,
  UserEntity,
  VoiceTimbreEntity,
  VoiceTimbreMaterialEntity,
} from '@tzl/entities';
import {
  loadEnvFileIfExists,
  readBooleanFrom,
  readNumberFrom,
  readStringFrom,
} from '@tzl/shared';

loadEnvFileIfExists(resolve(__dirname, '../../../../.env'));

const mode = readStringFrom(['VOICE_TIMBRE_BACKFILL_MODE'], 'audit').trim();
const apply = mode === 'apply';

const stringifyId = (value?: MongoObjectId): string =>
  value?.toHexString?.() ?? (value ? String(value) : '');

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
  entities: [
    AgentEntity,
    UserEntity,
    VoiceTimbreEntity,
    VoiceTimbreMaterialEntity,
  ],
} as never);

async function main(): Promise<void> {
  await dataSource.initialize();
  try {
    const timbreRepo = dataSource.getMongoRepository(VoiceTimbreEntity);
    const agentRepo = dataSource.getMongoRepository(AgentEntity);
    const userRepo = dataSource.getMongoRepository(UserEntity);
    const materialRepo = dataSource.getMongoRepository(
      VoiceTimbreMaterialEntity
    );

    const [timbres, agents, users, materials] = await Promise.all([
      timbreRepo.find(),
      agentRepo.find(),
      userRepo.find(),
      materialRepo.find(),
    ]);
    const userIds = new Set(users.map(user => stringifyId(user.id)));
    const existingMaterialKeys = new Set(
      materials.map(
        material => `${stringifyId(material.userId)}:${material.objectKey}`
      )
    );
    const ownersByTimbreId = new Map<string, Set<string>>();

    for (const agent of agents) {
      const ownerId = stringifyId(agent.createdUserId);
      for (const timbreId of [
        stringifyId(agent.voiceTimbreId),
        stringifyId(agent.pendingVoiceTimbreId),
      ]) {
        if (!timbreId || !ownerId) continue;
        const owners = ownersByTimbreId.get(timbreId) ?? new Set<string>();
        owners.add(ownerId);
        ownersByTimbreId.set(timbreId, owners);
      }
    }

    const stats = {
      scannedTimbres: timbres.length,
      linkedUsers: 0,
      createdMaterials: 0,
      existingMaterials: 0,
      skippedNoOwner: 0,
      skippedOwnerConflict: 0,
      skippedMissingUser: 0,
      skippedMissingOriginalFile: 0,
      skippedUnsupportedObjectKey: 0,
      unsupportedObjectKeyPrefixes: {} as Record<string, number>,
    };

    for (const timbre of timbres) {
      if (timbre.deletedAt || timbre.deletionStatus === 'completed') continue;
      const timbreId = stringifyId(timbre.id);
      const boundOwnerIds = ownersByTimbreId.get(timbreId) ?? new Set();
      const existingOwnerId = stringifyId(timbre.userId);
      let ownerId = existingOwnerId;

      if (!ownerId) {
        if (boundOwnerIds.size === 0) {
          stats.skippedNoOwner += 1;
          continue;
        }
        if (boundOwnerIds.size > 1) {
          stats.skippedOwnerConflict += 1;
          continue;
        }
        [ownerId] = boundOwnerIds;
      } else if (
        boundOwnerIds.size > 0 &&
        [...boundOwnerIds].some(boundOwnerId => boundOwnerId !== ownerId)
      ) {
        stats.skippedOwnerConflict += 1;
        continue;
      }

      if (!userIds.has(ownerId)) {
        stats.skippedMissingUser += 1;
        continue;
      }

      if (!existingOwnerId) {
        stats.linkedUsers += 1;
        if (apply) {
          await timbreRepo.updateOne(
            { _id: timbre.id },
            { $set: { userId: new MongoObjectId(ownerId) } }
          );
        }
      }

      const objectKey = timbre.audioObjectKey?.trim().replace(/^\/+/, '');
      if (!objectKey) {
        stats.skippedMissingOriginalFile += 1;
        continue;
      }
      if (
        ![
          'voice-timbres/',
          'voice-training-ready/',
          'voice-timbre-merged/',
        ].some(prefix => objectKey.startsWith(prefix)) ||
        objectKey.includes('..')
      ) {
        stats.skippedUnsupportedObjectKey += 1;
        const prefix = objectKey.split('/')[0] || '(root)';
        stats.unsupportedObjectKeyPrefixes[prefix] =
          (stats.unsupportedObjectKeyPrefixes[prefix] || 0) + 1;
        continue;
      }

      const materialKey = `${ownerId}:${objectKey}`;
      if (existingMaterialKeys.has(materialKey)) {
        stats.existingMaterials += 1;
        continue;
      }

      stats.createdMaterials += 1;
      existingMaterialKeys.add(materialKey);
      if (apply) {
        const createdAt = timbre.createdAt || new Date();
        await materialRepo.save(
          materialRepo.create({
            userId: new MongoObjectId(ownerId),
            name: basename(objectKey) || `${timbre.name || '音色'}-原始文件`,
            objectKey,
            publicUrl: timbre.audioUrl || '',
            createdAt,
            updatedAt: timbre.updatedAt || createdAt,
          })
        );
      }
    }

    console.log(JSON.stringify({ mode, ...stats }, null, 2));
  } finally {
    await dataSource.destroy();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
