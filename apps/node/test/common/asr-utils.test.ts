import {
  extractTranscriptionContent,
  isRetryableTranscriptionError,
} from '../../src/common/asr-utils';

describe('isRetryableTranscriptionError', () => {
  it('does not retry deterministic 4xx provider failures such as illegal audio format', () => {
    expect(
      isRetryableTranscriptionError(
        Object.assign(new Error('The audio format is illegal'), {
          status: 400,
          code: 'invalid_parameter_error',
        })
      )
    ).toBe(false);
    expect(isRetryableTranscriptionError({ status: 415 })).toBe(false);
    expect(isRetryableTranscriptionError({ status: 404 })).toBe(false);
  });

  it('retries transient failures', () => {
    expect(isRetryableTranscriptionError({ status: 500 })).toBe(true);
    expect(isRetryableTranscriptionError({ status: 503 })).toBe(true);
    expect(isRetryableTranscriptionError({ status: 408 })).toBe(true);
    expect(isRetryableTranscriptionError({ status: 429 })).toBe(true);
  });

  it('retries when the status is unknown rather than giving up on a transient fault', () => {
    expect(isRetryableTranscriptionError(new Error('socket hang up'))).toBe(
      true
    );
    expect(isRetryableTranscriptionError(undefined)).toBe(true);
  });
});

describe('extractTranscriptionContent', () => {
  it('normalizes string and array payloads', () => {
    expect(extractTranscriptionContent('  你好  ')).toBe('你好');
    expect(
      extractTranscriptionContent([{ text: '第一句' }, { text: ' 第二句 ' }])
    ).toBe('第一句\n第二句');
  });

  it('returns an empty string for unusable payloads', () => {
    expect(extractTranscriptionContent(undefined)).toBe('');
    expect(extractTranscriptionContent({ text: 'nope' })).toBe('');
    expect(extractTranscriptionContent([null, {}, { text: 42 }])).toBe('');
  });
});
