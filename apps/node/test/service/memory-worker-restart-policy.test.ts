// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  resolveRestartReason,
  readPositiveInt,
} = require('../../scripts/memory-worker-bootstrap.js');

describe('memory worker maintenance restart policy', () => {
  const base = {
    minUptimeMs: 20 * 60 * 1000,
    intervalMs: 4 * 60 * 60 * 1000,
    rssLimitMb: 2800,
  };

  it('does not restart before the minimum uptime even when misconfigured limits are hit', () => {
    expect(
      resolveRestartReason({ ...base, uptimeMs: 5 * 60 * 1000, rssMb: 9000 })
    ).toBeNull();
  });

  it('restarts on RSS before the heap reaches the GC pathology', () => {
    expect(
      resolveRestartReason({
        ...base,
        uptimeMs: 60 * 60 * 1000,
        rssMb: 2800,
      })
    ).toBe('rss');
  });

  it('restarts on the interval backstop when RSS stays low', () => {
    expect(
      resolveRestartReason({
        ...base,
        uptimeMs: 4 * 60 * 60 * 1000,
        rssMb: 512,
      })
    ).toBe('interval');
  });

  it('keeps running while both limits are below their thresholds', () => {
    expect(
      resolveRestartReason({
        ...base,
        uptimeMs: 3 * 60 * 60 * 1000,
        rssMb: 1500,
      })
    ).toBeNull();
  });

  it('prefers the RSS reason when both limits trip at once', () => {
    expect(
      resolveRestartReason({
        ...base,
        uptimeMs: 5 * 60 * 60 * 1000,
        rssMb: 3200,
      })
    ).toBe('rss');
  });

  it('falls back to the interval when RSS cannot be read', () => {
    expect(
      resolveRestartReason({
        ...base,
        uptimeMs: 5 * 60 * 60 * 1000,
        rssMb: null,
      })
    ).toBe('interval');
  });

  it('parses positive integers and rejects junk', () => {
    expect(readPositiveInt('__MISSING_TEST_ENV__', 7)).toBe(7);
    process.env.__TZL_TEST_POSITIVE_INT = '1234';
    expect(readPositiveInt('__TZL_TEST_POSITIVE_INT', 7)).toBe(1234);
    process.env.__TZL_TEST_POSITIVE_INT = '-5';
    expect(readPositiveInt('__TZL_TEST_POSITIVE_INT', 7)).toBe(7);
    process.env.__TZL_TEST_POSITIVE_INT = 'abc';
    expect(readPositiveInt('__TZL_TEST_POSITIVE_INT', 7)).toBe(7);
    delete process.env.__TZL_TEST_POSITIVE_INT;
  });
});
