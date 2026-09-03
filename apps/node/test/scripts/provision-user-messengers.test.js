const { ObjectId } = require('mongodb');
const {
  parseOperationArgs,
  resolveAllAgentOwnerTargets,
} = require('../../scripts/provision-user-messengers');

describe('provision-user-messengers script', () => {
  it('accepts the all-users migration mode', () => {
    expect(parseOperationArgs(['--all-users', '--dry-run'])).toEqual({
      activeMembers: false,
      allUsers: true,
      dryRun: true,
      identifiers: [],
    });
  });

  it('rejects combining all-users with another target mode', () => {
    expect(() =>
      parseOperationArgs(['--all-users', '--active-members'])
    ).toThrow('mutually exclusive');
    expect(() =>
      parseOperationArgs(['--all-users', '665000000000000000000001'])
    ).toThrow('mutually exclusive');
  });

  it('resolves every distinct owner who already has a relative agent', async () => {
    const laterUserId = new ObjectId('665000000000000000000002');
    const earlierUserId = new ObjectId('665000000000000000000001');
    const distinct = jest.fn().mockResolvedValue([laterUserId, earlierUserId]);
    const db = {
      collection: jest.fn().mockReturnValue({ distinct }),
    };

    const targets = await resolveAllAgentOwnerTargets(db);

    expect(db.collection).toHaveBeenCalledWith('agent');
    expect(distinct).toHaveBeenCalledWith('createdUserId', {
      messengerOfAgentId: { $exists: false },
      createdUserId: { $type: 'objectId' },
    });
    expect(targets).toEqual([
      { identifier: 'all-users', userId: earlierUserId },
      { identifier: 'all-users', userId: laterUserId },
    ]);
  });
});
