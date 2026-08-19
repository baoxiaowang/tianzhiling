import { readRequiredStringFrom } from '@tzl/shared';

describe('required environment values', () => {
  const firstKey = 'TZL_TEST_REQUIRED_FIRST';
  const secondKey = 'TZL_TEST_REQUIRED_SECOND';

  afterEach(() => {
    delete process.env[firstKey];
    delete process.env[secondKey];
  });

  it('returns the first non-empty configured value', () => {
    process.env[firstKey] = '  ';
    process.env[secondKey] = 'configured-secret';

    expect(readRequiredStringFrom([firstKey, secondKey])).toBe(
      'configured-secret'
    );
  });

  it('fails closed when every configured value is empty', () => {
    expect(() => readRequiredStringFrom([firstKey, secondKey])).toThrow(
      `missing required environment variable: ${firstKey} or ${secondKey}`
    );
  });
});
