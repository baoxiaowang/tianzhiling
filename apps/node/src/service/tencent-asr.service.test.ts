import { createHmac } from 'crypto';
import { signTencentAsrSession } from './tencent-asr.service';

describe('Tencent ASR short-lived session', () => {
  it('signs a one-minute PCM WebSocket URL without exposing SecretKey', () => {
    const result = signTencentAsrSession(
      {
        appId: '1234567890',
        secretId: 'test-secret-id',
        secretKey: 'server-only-key',
        engineModelType: '16k_zh',
      },
      new Date('2026-09-26T10:00:00.000Z'),
      'test-voice-id',
      42
    );
    const url = new URL(result.url);
    expect(url.protocol).toBe('wss:');
    expect(url.hostname).toBe('asr.cloud.tencent.com');
    expect(url.pathname).toBe('/asr/v2/1234567890');
    expect(result.sampleRate).toBe(16000);
    expect(url.searchParams.get('voice_format')).toBe('1');
    expect(url.searchParams.get('voice_id')).toBe('test-voice-id');
    expect(
      Number(url.searchParams.get('expired')) -
        Number(url.searchParams.get('timestamp'))
    ).toBe(60);
    expect(result.url).not.toContain('server-only-key');

    const unsigned = result.url
      .replace(/^wss:\/\//, '')
      .replace(/&signature=[^&]+$/, '');
    const expectedSignature = createHmac('sha1', 'server-only-key')
      .update(unsigned)
      .digest('base64');
    expect(url.searchParams.get('signature')).toBe(expectedSignature);
  });

  it('fails closed without server credentials', () => {
    expect(() => signTencentAsrSession({})).toThrow(
      '腾讯云实时语音识别暂未配置'
    );
  });
});
