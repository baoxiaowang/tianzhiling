import { Config, Provide } from '@midwayjs/core';
import { createHmac, randomInt, randomUUID } from 'crypto';
import { AppError } from '../common/errors';

interface TencentAsrConfig {
  appId?: string;
  secretId?: string;
  secretKey?: string;
  engineModelType?: string;
}

export interface TencentAsrSession {
  url: string;
  expiresAt: string;
  sampleRate: number;
}

const asrHost = 'asr.cloud.tencent.com';
const urlLifetimeSeconds = 60;

/** Only the server holds SecretKey. The returned WebSocket URL expires quickly. */
export function signTencentAsrSession(
  config: TencentAsrConfig,
  now: Date = new Date(),
  voiceId: string = randomUUID(),
  nonce: number = randomInt(1, 1000000000)
): TencentAsrSession {
  const appId = config.appId?.trim() || '';
  const secretId = config.secretId?.trim() || '';
  const secretKey = config.secretKey?.trim() || '';
  if (!/^\d+$/.test(appId) || !secretId || !secretKey) {
    throw new AppError(
      'TENCENT_ASR_NOT_CONFIGURED',
      '腾讯云实时语音识别暂未配置',
      503
    );
  }

  const timestamp = Math.floor(now.getTime() / 1000);
  const expired = timestamp + urlLifetimeSeconds;
  const params: Record<string, string> = {
    engine_model_type: config.engineModelType?.trim() || '16k_zh',
    expired: String(expired),
    needvad: '1',
    nonce: String(nonce),
    secretid: secretId,
    timestamp: String(timestamp),
    voice_format: '1',
    voice_id: voiceId,
  };
  const query = Object.keys(params)
    .sort()
    .map(key => `${key}=${encodeURIComponent(params[key])}`)
    .join('&');
  const signedPath = `${asrHost}/asr/v2/${appId}?${query}`;
  const signature = createHmac('sha1', secretKey)
    .update(signedPath)
    .digest('base64');
  return {
    url: `wss://${signedPath}&signature=${encodeURIComponent(signature)}`,
    expiresAt: new Date(expired * 1000).toISOString(),
    sampleRate: 16000,
  };
}

@Provide()
export class TencentAsrService {
  @Config('tencentAsr')
  config: TencentAsrConfig;

  createSession(): TencentAsrSession {
    return signTencentAsrSession(this.config || {});
  }
}
