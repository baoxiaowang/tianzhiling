import { MongoObjectId, UserKnownPersonEntity } from '@tzl/entities';
import {
  canonicalKinshipRelation,
  normalizeRelationKey,
} from '../../src/service/agents/memory-value';
import { UserIdentityMemoryService } from '../../src/service/agents/user-identity-memory.service';

describe('kinship address canonicalization', () => {
  it('maps regional variants to one relation', () => {
    expect(canonicalKinshipRelation('外公')).toBe('外祖父');
    expect(canonicalKinshipRelation('姥爷')).toBe('外祖父');
    expect(canonicalKinshipRelation('外祖父')).toBe('外祖父');
    expect(canonicalKinshipRelation('家家')).toBe('外祖父');
    expect(canonicalKinshipRelation('外婆')).toBe('外祖母');
    expect(normalizeRelationKey('家家')).toBe('外祖父');
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

    await expect(
      service.resolveKnownPersonReference({
        userId: new MongoObjectId('665000000000000000000a02'),
        referenceName: '家家',
      })
    ).resolves.toBe(person);
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
