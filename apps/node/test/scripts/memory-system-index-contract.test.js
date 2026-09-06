const { INDEXES } = require('../../scripts/ensure-memory-system-indexes');

describe('memory system index contract', () => {
  it('accepts the deployed temporal semantic cache partial index', () => {
    const [, options] = INDEXES.message.find(
      ([, definition]) =>
        definition.name === 'idx_message_temporal_semantic_cache'
    );

    expect(options.partialFilterExpression).toEqual({
      temporalMemorySemanticHash: { $exists: true },
    });
  });

  it('excludes legacy null person links from the unique agent index', () => {
    const [, options] = INDEXES.user_known_person.find(
      ([, definition]) =>
        definition.name === 'uniq_user_known_person_linked_agent'
    );

    expect(options).toEqual(
      expect.objectContaining({
        unique: true,
        partialFilterExpression: {
          linkedAgentId: { $type: 'objectId' },
        },
      })
    );
  });
});
