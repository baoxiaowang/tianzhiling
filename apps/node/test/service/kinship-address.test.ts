import { MongoObjectId, UserKnownPersonEntity } from '@tzl/entities';
import {
  canonicalKinshipRelation,
  normalizeRelationKey,
} from '../../src/service/agents/memory-value';
import { UserIdentityMemoryService } from '../../src/service/agents/user-identity-memory.service';
import { isRelativeRelation } from '../../src/service/agents/user-relative-profile.service';

describe('kinship address canonicalization', () => {
  it('maps regional variants to one relation', () => {
    expect(canonicalKinshipRelation('外公')).toBe('外祖父');
    expect(canonicalKinshipRelation('姥爷')).toBe('外祖父');
    expect(canonicalKinshipRelation('外祖父')).toBe('外祖父');
    expect(canonicalKinshipRelation('家家')).toBe('外祖母');
    expect(canonicalKinshipRelation('外婆')).toBe('外祖母');
    expect(canonicalKinshipRelation('婆婆')).toBeUndefined();
    expect(canonicalKinshipRelation('公公')).toBeUndefined();
    expect(normalizeRelationKey('家家')).toBe('外祖母');
  });

  it('recognizes long-tail kinship terms without merging them globally', () => {
    for (const term of [
      '继父',
      '继母',
      '后爸',
      '后妈',
      '养父',
      '养母',
      '养子',
      '养女',
      '继子',
      '继女',
      '前夫',
      '前妻',
      '干爹',
      '干妈',
      '干儿子',
      '干女儿',
      '未婚夫',
      '未婚妻',
    ]) {
      expect(isRelativeRelation(term)).toBe(true);
    }
    expect(canonicalKinshipRelation('后妈')).toBeUndefined();
    expect(canonicalKinshipRelation('养女')).toBeUndefined();
    expect(normalizeRelationKey('后妈')).toBe('后妈');
    expect(normalizeRelationKey('干儿子')).toBe('干儿子');
    expect(normalizeRelationKey('养女')).toBe('养女');
    expect(normalizeRelationKey('前妻')).toBe('前妻');
  });

  it('resolves a kinship reference to the person with the same relation group', async () => {
    const person = Object.assign(new UserKnownPersonEntity(), {
      id: new MongoObjectId('665000000000000000000a01'),
      relationToUser: '外公',
      realName: null,
      preferredName: null,
      aliases: [],
    });
    const service = new UserIdentityMemoryService();
    service.knownPersonModel = {
      find: jest.fn().mockResolvedValue([person]),
    } as never;

    await expect(
      service.resolveKnownPersonReference({
        userId: new MongoObjectId('665000000000000000000a02'),
        referenceName: '姥爷',
      })
    ).resolves.toBe(person);

  });

  it('maps 家家 to the maternal grandmother, not the grandfather', async () => {
    const grandmother = Object.assign(new UserKnownPersonEntity(), {
      id: new MongoObjectId('665000000000000000000a05'),
      relationToUser: '外婆',
      realName: null,
      preferredName: null,
      aliases: [],
    });
    const service = new UserIdentityMemoryService();
    service.knownPersonModel = {
      find: jest.fn().mockResolvedValue([grandmother]),
    } as never;

    await expect(
      service.resolveKnownPersonReference({
        userId: new MongoObjectId('665000000000000000000a06'),
        referenceName: '家家',
      })
    ).resolves.toBe(grandmother);
  });

  it('resolves an ambiguous term per user when that user built the person', async () => {
    const motherInLaw = Object.assign(new UserKnownPersonEntity(), {
      id: new MongoObjectId('665000000000000000000a09'),
      relationToUser: '婆婆',
      realName: null,
      preferredName: null,
      aliases: [],
    });
    const service = new UserIdentityMemoryService();
    service.knownPersonModel = {
      find: jest.fn().mockResolvedValue([motherInLaw]),
    } as never;

    await expect(
      service.resolveKnownPersonReference({
        userId: new MongoObjectId('665000000000000000000a0a'),
        referenceName: '婆婆',
      })
    ).resolves.toBe(motherInLaw);
  });

  it('resolves a long-tail relation per user', async () => {
    const stepmother = Object.assign(new UserKnownPersonEntity(), {
      id: new MongoObjectId('665000000000000000000a0f'),
      relationToUser: '后妈',
      realName: null,
      preferredName: null,
      aliases: [],
    });
    const service = new UserIdentityMemoryService();
    service.knownPersonModel = {
      find: jest.fn().mockResolvedValue([stepmother]),
    } as never;

    await expect(
      service.resolveKnownPersonReference({
        userId: new MongoObjectId('665000000000000000000a10'),
        referenceName: '后妈',
      })
    ).resolves.toBe(stepmother);
  });

  it('does not merge 婆婆 into 外祖母 automatically', async () => {
    const grandmother = Object.assign(new UserKnownPersonEntity(), {
      id: new MongoObjectId('665000000000000000000a07'),
      relationToUser: '外祖母',
      realName: null,
      preferredName: null,
      aliases: [],
    });
    const service = new UserIdentityMemoryService();
    service.knownPersonModel = {
      find: jest.fn().mockResolvedValue([grandmother]),
    } as never;

    await expect(
      service.resolveKnownPersonReference({
        userId: new MongoObjectId('665000000000000000000a08'),
        referenceName: '婆婆',
      })
    ).resolves.toBeNull();
  });

  it('does not merge a different relation group', async () => {
    const person = Object.assign(new UserKnownPersonEntity(), {
      id: new MongoObjectId('665000000000000000000a03'),
      relationToUser: '爷爷',
      realName: null,
      preferredName: null,
      aliases: [],
    });
    const service = new UserIdentityMemoryService();
    service.knownPersonModel = {
      find: jest.fn().mockResolvedValue([person]),
    } as never;

    await expect(
      service.resolveKnownPersonReference({
        userId: new MongoObjectId('665000000000000000000a04'),
        referenceName: '姥爷',
      })
    ).resolves.toBeNull();
  });
});
