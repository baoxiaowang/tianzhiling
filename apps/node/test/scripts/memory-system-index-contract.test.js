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
});
