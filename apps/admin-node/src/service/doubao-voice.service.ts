import { Config, Logger, Provide } from '@midwayjs/core';
import type { ILogger } from '@midwayjs/logger';
import {
  AppError,
  buildDoubaoIcl2SpeechInstruction,
  getDoubaoIcl2SpeechInstructionSource,
  resolveVoiceTimbreDialect,
} from '@tzl/shared';
import { createHash, createHmac, randomUUID } from 'crypto';
import { request as httpRequest } from 'http';
import { request as httpsRequest } from 'https';
import { URL } from 'url';

interface DoubaoVoiceConfig {
  enabled?: boolean;
  apiKey?: string;
  appId?: string;
  accessToken?: string;
  baseURL?: string;
  resourceId?: string;
  defaultPreviewModel?: string;
  timeoutMs?: number;
  trainingTimeoutMs?: number;
  pollIntervalMs?: number;
  maxTrainingTimes?: number;
  knownSpeakerIds?: string;
  openApiAccessKeyId?: string;
  openApiSecretAccessKey?: string;
  openApiBaseURL?: string;
  openApiRegion?: string;
  openApiService?: string;
  openApiProjectName?: string;
  cloneExtraParams?: Record<string, unknown>;
}

interface DoubaoBaseResponse {
  StatusCode?: number;
  StatusMessage?: string;
}

interface DoubaoTrainingResponse {
  BaseResp?: DoubaoBaseResponse;
  code?: number;
  message?: string;
  status?: number;
  version?: number;
  speaker_id?: string;
  demo_audio?: string;
  create_time?: number;
  request_id?: string;
  speaker_status?: Array<{
    demo_audio?: string;
    model_type?: number;
    status?: number;
  }>;
  available_training_times?: number;
}

interface DoubaoSpeechEvent {
  code?: number;
  message?: string;
  data?: string;
  request_id?: string;
}

export type DoubaoVoiceSlotState =
  | 'Unknown'
  | 'Training'
  | 'Success'
  | 'Active'
  | 'Expired'
  | 'Reclaimed';

interface DoubaoOpenApiSlotStatus {
  SpeakerID?: string;
  InstanceNO?: string;
  IsActivable?: string | boolean;
  State?: DoubaoVoiceSlotState;
  DemoAudio?: string;
  Version?: string | number;
  CreateTime?: number;
  ExpireTime?: number;
  OrderTime?: number;
  Alias?: string;
  AvailableTrainingTimes?: number;
}

interface DoubaoOpenApiListResponse {
  ResponseMetadata?: {
    RequestId?: string;
    Error?: {
      Code?: string;
      Message?: string;
    };
  };
  Result?: {
    NextToken?: string;
    Statuses?: DoubaoOpenApiSlotStatus[];
  };
}

export interface DoubaoVoiceSlot {
  speakerId: string;
  instanceNo: string;
  alias: string;
  state: DoubaoVoiceSlotState;
  isActivable: boolean;
  demoAudio?: string;
  version?: string;
  createTime?: number;
  expireTime?: number;
  orderTime?: number;
  availableTrainingTimes?: number;
}

export interface DoubaoVoiceSlotListResult {
  items: DoubaoVoiceSlot[];
  requestIds: string[];
  openApiSyncAttempted: boolean;
  openApiSyncSucceeded: boolean;
}

const DOUBAO_VOICE_SLOT_STATES: DoubaoVoiceSlotState[] = [
  'Unknown',
  'Training',
  'Success',
  'Active',
  'Expired',
  'Reclaimed',
];

export interface DoubaoCloneInput {
  buffer: Buffer;
  fileName: string;
  speakerId: string;
  extraParams?: Record<string, unknown>;
}

export interface DoubaoCloneResult {
  providerVoiceId: string;
  targetModel: string;
  providerStatus: string;
  version?: number;
  requestId?: string;
}

export interface DoubaoPreviewSpeechInput {
  text: string;
  voiceId: string;
  model?: string;
  instruction?: string;
  dialect?: string;
  speed?: number;
  volume?: number;
}

export interface DoubaoPreviewSpeechResult {
  audioUrl: string;
  audioBuffer: Buffer;
  mimeType: string;
  requestId?: string;
  nativeSpeechSpeedApplied: true;
  nativeSpeechVolumeApplied: true;
}

export interface DoubaoVoiceStatusResult {
  voiceId: string;
  status: string;
  statusCode: number;
  version?: number;
  demoAudio?: string;
  createTime?: number;
  requestId?: string;
}

@Provide()
export class DoubaoVoiceService {
  @Logger()
  logger: ILogger;

  @Config('doubaoVoice')
  config: DoubaoVoiceConfig;

  getDefaultPreviewModel(): string {
    return (
      this.config?.defaultPreviewModel?.trim() || 'seed-tts-2.0-expressive'
    );
  }

  getKnownSpeakerIds(): string[] {
    return this.normalizeKnownSpeakerIds(
      this.config?.knownSpeakerIds?.split(/[\s,;]+/) || []
    );
  }

  hasOpenApiSlotListingConfigured(): boolean {
    return Boolean(
      this.config?.openApiAccessKeyId?.trim() &&
        this.config?.openApiSecretAccessKey?.trim()
    );
  }

  async listSlots(
    additionalKnownSpeakerIds: string[] = []
  ): Promise<DoubaoVoiceSlotListResult> {
    if (this.config?.enabled === false) {
      throw new AppError(
        'DOUBAO_VOICE_DISABLED',
        'Doubao voice is disabled',
        400
      );
    }
    const bySpeakerId = new Map<string, DoubaoVoiceSlot>();
    const requestIds: string[] = [];
    const openApiSyncAttempted = this.hasOpenApiSlotListingConfigured();
    let openApiSyncSucceeded = false;

    if (openApiSyncAttempted) {
      try {
        const results = await Promise.all(
          DOUBAO_VOICE_SLOT_STATES.map(state => this.listSlotsByState(state))
        );

        for (const result of results) {
          requestIds.push(...result.requestIds);
          for (const slot of result.items) {
            bySpeakerId.set(slot.speakerId, slot);
          }
        }
        openApiSyncSucceeded = true;
      } catch (error) {
        this.logger.warn(
          '[doubao-voice] OpenAPI slot metadata sync failed; using fixed slot pool, error=%s',
          error instanceof Error ? error.message : String(error || 'unknown')
        );
      }
    }

    const knownSpeakerIds = this.normalizeKnownSpeakerIds([
      ...this.getKnownSpeakerIds(),
      ...additionalKnownSpeakerIds,
    ]).filter(speakerId => !bySpeakerId.has(speakerId));
    const queried = await Promise.all(
      knownSpeakerIds.map(async speakerId => {
        try {
          return { result: await this.queryVoice(speakerId) };
        } catch (error) {
          return { error };
        }
      })
    );

    queried.forEach((lookup, index) => {
      const speakerId = knownSpeakerIds[index];
      if (lookup.result) {
        const status = lookup.result;
        if (status.statusCode === 0) {
          this.logger.info(
            '[doubao-voice] fixed voice has not been trained yet, voiceRef=%s',
            this.describeVoiceId(speakerId)
          );
          bySpeakerId.set(speakerId, {
            speakerId,
            instanceNo: '',
            alias: '',
            state: 'Unknown',
            isActivable: true,
            availableTrainingTimes: this.maxTrainingTimes,
          });
          return;
        }
        bySpeakerId.set(speakerId, {
          speakerId,
          instanceNo: '',
          alias: '',
          state: this.statusToSlotState(status.statusCode),
          isActivable: status.statusCode === 2,
          demoAudio: status.demoAudio,
          version:
            status.version === undefined ? undefined : String(status.version),
          createTime: status.createTime,
          availableTrainingTimes: this.remainingTrainingTimes(status.version),
        });
        if (status.requestId) requestIds.push(status.requestId);
        return;
      }

      this.logger.warn(
        '[doubao-voice] known voice status lookup failed, voiceRef=%s, error=%s',
        this.describeVoiceId(speakerId),
        lookup.error instanceof Error
          ? lookup.error.message
          : String(lookup.error || 'unknown')
      );
      bySpeakerId.set(speakerId, {
        speakerId,
        instanceNo: '',
        alias: '',
        state: 'Unknown',
        isActivable: false,
      });
    });

    return {
      items: [...bySpeakerId.values()],
      requestIds,
      openApiSyncAttempted,
      openApiSyncSucceeded,
    };
  }

  async cloneVoice(input: DoubaoCloneInput): Promise<DoubaoCloneResult> {
    this.ensureTrainingConfigured();
    const speakerId = this.normalizeSpeakerId(input.speakerId);

    if (!Buffer.isBuffer(input.buffer) || input.buffer.length === 0) {
      throw new AppError(
        'DOUBAO_VOICE_AUDIO_MISSING',
        'Doubao clone audio is missing',
        400
      );
    }

    // A prepaid Speaker ID can already be active from an earlier training.
    // Capture that revision before uploading so the following status poll
    // cannot mistake the old active result for completion of this upload.
    const baselineStatus = await this.queryVoice(speakerId);
    const requestId = randomUUID();
    // V3 extra_params 为对象；合并优先级：安全默认 < 配置(.env) < 调用层传入
    const extraParams: Record<string, unknown> = {
      enable_crop_by_asr: true,
      ...(this.config.cloneExtraParams || {}),
      ...(input.extraParams || {}),
    };
    const payload = {
      speaker_id: speakerId,
      audio: {
        data: input.buffer.toString('base64'),
        format: this.audioFormat(input.fileName),
      },
      language: 0,
      extra_params: extraParams,
    };

    this.logger.info(
      '[doubao-voice] upload ICL voice (V3), voiceRef=%s, bytes=%s, extraParams=%j',
      this.describeVoiceId(speakerId),
      input.buffer.length,
      extraParams
    );

    const uploaded = await this.requestTrainingJson(
      '/api/v3/tts/voice_clone',
      payload,
      requestId
    );
    this.assertProviderSuccess(uploaded, 'DOUBAO_VOICE_UPLOAD_FAILED');
    let status: DoubaoVoiceStatusResult;
    try {
      status = await this.waitUntilReady(speakerId, baselineStatus);
    } catch (error) {
      if (error instanceof AppError) {
        throw new AppError(error.code, error.message, error.status, {
          ...(error.data && typeof error.data === 'object' ? error.data : {}),
          providerUploadAccepted: true,
          requestId: uploaded.request_id || requestId,
        });
      }
      throw error;
    }

    return {
      providerVoiceId: speakerId,
      targetModel: this.getDefaultPreviewModel(),
      providerStatus: status.status,
      version: status.version,
      requestId: status.requestId || uploaded.request_id || requestId,
    };
  }

  async queryVoice(voiceId: string): Promise<DoubaoVoiceStatusResult> {
    this.ensureTrainingConfigured();
    const speakerId = this.normalizeSpeakerId(voiceId);
    const requestId = randomUUID();
    const response = await this.requestTrainingJson(
      '/api/v3/tts/get_voice',
      {
        speaker_id: speakerId,
      },
      requestId
    );
    this.assertProviderSuccess(response, 'DOUBAO_VOICE_STATUS_FAILED');
    const statusCode = Number(response.status);

    if (!Number.isInteger(statusCode)) {
      throw new AppError(
        'DOUBAO_VOICE_INVALID_STATUS',
        'Doubao voice status is missing or invalid',
        502,
        { requestId, response }
      );
    }

    const demoAudio =
      response.speaker_status
        ?.find(item => item.demo_audio)
        ?.demo_audio?.trim() ||
      response.demo_audio?.trim() ||
      undefined;

    return {
      voiceId: response.speaker_id?.trim() || speakerId,
      status: this.statusName(statusCode),
      statusCode,
      version: response.version,
      demoAudio,
      createTime: this.optionalPositiveNumber(response.create_time),
      requestId: response.request_id?.trim() || requestId,
    };
  }

  async synthesizePreview(
    input: DoubaoPreviewSpeechInput
  ): Promise<DoubaoPreviewSpeechResult> {
    this.ensureSpeechConfigured();
    const text = input.text?.trim();
    const voiceId = this.normalizeSpeakerId(input.voiceId);

    if (!text) {
      throw new AppError(
        'DOUBAO_PREVIEW_TEXT_MISSING',
        'Doubao preview text is missing',
        400
      );
    }

    const instruction = buildDoubaoIcl2SpeechInstruction(input);
    const instructionSource = getDoubaoIcl2SpeechInstructionSource(input);
    const dialect = resolveVoiceTimbreDialect(input.dialect, input.instruction);
    const model = input.model?.trim() || this.getDefaultPreviewModel();
    const requestId = randomUUID();
    const additions = {
      model_type: 4,
      disable_markdown_filter: true,
      ...(instruction ? { context_texts: [instruction] } : {}),
    };
    const body = Buffer.from(
      JSON.stringify({
        user: { uid: 'tianzhiling-admin' },
        req_params: {
          text,
          speaker: voiceId,
          model,
          audio_params: {
            format: 'mp3',
            sample_rate: 24000,
            speech_rate: this.toProviderRate(input.speed, 1),
            loudness_rate: this.toProviderRate(input.volume, 1),
          },
          additions: JSON.stringify(additions),
        },
      })
    );

    this.logger.info(
      '[doubao-voice] synthesize preview, model=%s, voiceRef=%s, dialect=%s, instructionSource=%s, instructionLength=%s, textLength=%s',
      model,
      this.describeVoiceId(voiceId),
      dialect,
      instructionSource,
      instruction?.length || 0,
      text.length
    );

    const response = await this.requestBinary({
      path: '/api/v3/tts/unidirectional',
      headers: this.speechHeaders(requestId),
      body,
    });

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new AppError(
        'DOUBAO_PREVIEW_HTTP_ERROR',
        response.body.toString('utf8') ||
          `Doubao http status ${response.statusCode}`,
        502,
        { httpStatus: response.statusCode, requestId }
      );
    }

    return {
      audioUrl: '',
      audioBuffer: this.parseSpeechAudio(response.body, requestId),
      mimeType: 'audio/mpeg',
      requestId,
      nativeSpeechSpeedApplied: true,
      nativeSpeechVolumeApplied: true,
    };
  }

  /**
   * Prepaid Doubao speaker slots are account resources and the public clone
   * API does not expose a destructive delete operation. Local deletion keeps
   * the paid slot reusable instead of expiring or overwriting it.
   */
  async releaseVoice(voiceId: string): Promise<{ retainedSlot: true }> {
    const speakerId = this.normalizeSpeakerId(voiceId);
    this.logger.info(
      '[doubao-voice] local voice released; prepaid provider slot retained, voiceRef=%s',
      this.describeVoiceId(speakerId)
    );
    return { retainedSlot: true };
  }

  private async waitUntilReady(
    voiceId: string,
    baselineStatus: DoubaoVoiceStatusResult
  ): Promise<DoubaoVoiceStatusResult> {
    const deadline = Date.now() + this.trainingTimeoutMs;
    const baselineWasReady =
      baselineStatus.statusCode === 2 || baselineStatus.statusCode === 4;
    let observedTraining = false;

    while (Date.now() <= deadline) {
      const result = await this.queryVoice(voiceId);
      if (result.statusCode === 1) {
        observedTraining = true;
      }
      if (
        (result.statusCode === 2 || result.statusCode === 4) &&
        (!baselineWasReady ||
          observedTraining ||
          this.hasTrainingRevisionAdvanced(baselineStatus, result))
      ) {
        return result;
      }
      if (result.statusCode === 3) {
        throw new AppError(
          'DOUBAO_VOICE_TRAINING_FAILED',
          'Doubao ICL 2.0 voice training failed',
          502,
          result
        );
      }
      await this.sleep(this.pollIntervalMs);
    }

    throw new AppError(
      'DOUBAO_VOICE_TRAINING_TIMEOUT',
      'Doubao ICL 2.0 voice training timed out',
      504
    );
  }

  private hasTrainingRevisionAdvanced(
    baseline: DoubaoVoiceStatusResult,
    current: DoubaoVoiceStatusResult
  ): boolean {
    if (
      baseline.version !== undefined &&
      current.version !== undefined &&
      current.version !== baseline.version
    ) {
      return true;
    }

    return Boolean(
      baseline.createTime &&
        current.createTime &&
        current.createTime > baseline.createTime
    );
  }

  private async listSlotsByState(state: DoubaoVoiceSlotState): Promise<{
    items: DoubaoVoiceSlot[];
    requestIds: string[];
  }> {
    const items: DoubaoVoiceSlot[] = [];
    const requestIds: string[] = [];
    let nextToken = '';
    let pageCount = 0;

    do {
      pageCount += 1;
      const response = await this.requestOpenApiJson(
        'BatchListMegaTTSTrainStatus',
        '2025-05-21',
        {
          ProjectName: this.openApiProjectName,
          State: state,
          PageNumber: 1,
          PageSize: 100,
          ...(nextToken ? { NextToken: nextToken, MaxResults: 100 } : {}),
        }
      );
      const requestId = response.ResponseMetadata?.RequestId?.trim();
      if (requestId) requestIds.push(requestId);

      const providerError = response.ResponseMetadata?.Error;
      if (providerError?.Code) {
        throw new AppError(
          providerError.Code,
          providerError.Message || 'Doubao slot list request failed',
          502,
          { requestId, state }
        );
      }

      for (const raw of response.Result?.Statuses || []) {
        const slot = this.normalizeOpenApiSlot(raw, state);
        if (slot) items.push(slot);
      }
      nextToken = response.Result?.NextToken?.trim() || '';
    } while (nextToken && pageCount < 100);

    if (nextToken) {
      throw new AppError(
        'DOUBAO_SLOT_LIST_TOO_MANY_PAGES',
        'Doubao slot list exceeded the safe pagination limit',
        502,
        { state }
      );
    }

    return { items, requestIds };
  }

  private normalizeOpenApiSlot(
    raw: DoubaoOpenApiSlotStatus,
    fallbackState: DoubaoVoiceSlotState
  ): DoubaoVoiceSlot | undefined {
    const speakerId = raw.SpeakerID?.trim();
    if (!speakerId || !/^S_[A-Za-z0-9_-]{4,128}$/.test(speakerId)) {
      return undefined;
    }

    return {
      speakerId,
      instanceNo: raw.InstanceNO?.trim() || '',
      alias: raw.Alias?.trim() || '',
      state: raw.State || fallbackState,
      isActivable:
        raw.IsActivable === true ||
        String(raw.IsActivable || '').toLowerCase() === 'true',
      demoAudio: raw.DemoAudio?.trim() || undefined,
      version:
        raw.Version === undefined || raw.Version === null
          ? undefined
          : String(raw.Version),
      createTime: this.optionalPositiveNumber(raw.CreateTime),
      expireTime: this.optionalPositiveNumber(raw.ExpireTime),
      orderTime: this.optionalPositiveNumber(raw.OrderTime),
      availableTrainingTimes: this.optionalNonNegativeNumber(
        raw.AvailableTrainingTimes
      ),
    };
  }

  private async requestOpenApiJson(
    action: string,
    version: string,
    payload: Record<string, unknown>
  ): Promise<DoubaoOpenApiListResponse> {
    const url = new URL('/', `${this.openApiBaseURL}/`);
    url.searchParams.set('Action', action);
    url.searchParams.set('Version', version);
    url.searchParams.sort();

    const body = Buffer.from(JSON.stringify(payload));
    const headers = this.signOpenApiRequest(url, body);
    const requester = url.protocol === 'http:' ? httpRequest : httpsRequest;
    const response = await new Promise<{ statusCode: number; body: Buffer }>(
      (resolve, reject) => {
        const req = requester(
          url,
          {
            method: 'POST',
            timeout: this.timeoutMs,
            headers,
          },
          res => {
            const chunks: Buffer[] = [];
            res.on('data', chunk => chunks.push(Buffer.from(chunk)));
            res.on('end', () =>
              resolve({
                statusCode: res.statusCode || 0,
                body: Buffer.concat(chunks),
              })
            );
          }
        );
        req.on('timeout', () =>
          req.destroy(new Error('Doubao slot list request timeout'))
        );
        req.on('error', error =>
          reject(
            new AppError('DOUBAO_SLOT_LIST_REQUEST_FAILED', error.message, 502)
          )
        );
        req.end(body);
      }
    );
    const raw = response.body.toString('utf8');

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new AppError(
        'DOUBAO_SLOT_LIST_HTTP_ERROR',
        raw || `Doubao OpenAPI http status ${response.statusCode}`,
        502,
        { httpStatus: response.statusCode }
      );
    }

    try {
      return JSON.parse(raw) as DoubaoOpenApiListResponse;
    } catch {
      throw new AppError(
        'DOUBAO_SLOT_LIST_INVALID_RESPONSE',
        'Doubao slot list response is not valid JSON',
        502
      );
    }
  }

  private signOpenApiRequest(url: URL, body: Buffer): Record<string, string> {
    const contentType = 'application/json; charset=UTF-8';
    const xDate = new Date()
      .toISOString()
      .replace(/[-:]/g, '')
      .replace(/\.\d{3}Z$/, 'Z');
    const shortDate = xDate.slice(0, 8);
    const payloadHash = createHash('sha256').update(body).digest('hex');
    const signedHeaders = 'host;x-content-sha256;x-date';
    const canonicalHeaders = [
      `host:${url.host}`,
      `x-content-sha256:${payloadHash}`,
      `x-date:${xDate}`,
      '',
    ].join('\n');
    const canonicalRequest = [
      'POST',
      '/',
      url.searchParams.toString(),
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');
    const credentialScope = `${shortDate}/${this.openApiRegion}/${this.openApiService}/request`;
    const stringToSign = [
      'HMAC-SHA256',
      xDate,
      credentialScope,
      createHash('sha256').update(canonicalRequest).digest('hex'),
    ].join('\n');
    const dateKey = this.hmac(
      this.config.openApiSecretAccessKey || '',
      shortDate
    );
    const regionKey = this.hmac(dateKey, this.openApiRegion);
    const serviceKey = this.hmac(regionKey, this.openApiService);
    const signingKey = this.hmac(serviceKey, 'request');
    const signature = createHmac('sha256', signingKey)
      .update(stringToSign)
      .digest('hex');

    return {
      Host: url.host,
      'Content-Type': contentType,
      'Content-Length': String(body.length),
      'X-Date': xDate,
      'X-Content-Sha256': payloadHash,
      Authorization: `HMAC-SHA256 Credential=${this.config.openApiAccessKeyId?.trim()}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    };
  }

  private hmac(key: Buffer | string, value: string): Buffer {
    return createHmac('sha256', key).update(value).digest();
  }

  private optionalPositiveNumber(value: unknown): number | undefined {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return undefined;

    // Current OpenAPI uses millisecond timestamps. Accept seconds as well so
    // a provider-side serialization change cannot make a live slot look old.
    return parsed < 10_000_000_000 ? parsed * 1000 : parsed;
  }

  private optionalNonNegativeNumber(value: unknown): number | undefined {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
  }

  private async requestTrainingJson(
    path: string,
    payload: Record<string, unknown>,
    requestId: string
  ): Promise<DoubaoTrainingResponse> {
    const body = Buffer.from(JSON.stringify(payload));
    const response = await this.requestBinary({
      path,
      headers: {
        ...this.trainingHeaders(requestId),
        'Content-Type': 'application/json',
        'Content-Length': String(body.length),
      },
      body,
    });
    const raw = response.body.toString('utf8');

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new AppError(
        'DOUBAO_VOICE_HTTP_ERROR',
        raw || `Doubao http status ${response.statusCode}`,
        502,
        { httpStatus: response.statusCode, requestId }
      );
    }

    try {
      return JSON.parse(raw) as DoubaoTrainingResponse;
    } catch {
      throw new AppError(
        'DOUBAO_VOICE_INVALID_RESPONSE',
        'Doubao response is not valid JSON',
        502,
        { requestId }
      );
    }
  }

  private requestBinary(input: {
    path: string;
    headers: Record<string, string>;
    body: Buffer;
  }): Promise<{
    statusCode: number;
    body: Buffer;
  }> {
    const url = new URL(input.path, `${this.baseURL}/`);
    const requester = url.protocol === 'http:' ? httpRequest : httpsRequest;

    return new Promise((resolve, reject) => {
      const req = requester(
        url,
        {
          method: 'POST',
          timeout: this.timeoutMs,
          headers: input.headers,
        },
        res => {
          const chunks: Buffer[] = [];
          res.on('data', chunk => chunks.push(Buffer.from(chunk)));
          res.on('end', () =>
            resolve({
              statusCode: res.statusCode || 0,
              body: Buffer.concat(chunks),
            })
          );
        }
      );
      req.on('timeout', () =>
        req.destroy(new Error('Doubao voice request timeout'))
      );
      req.on('error', error =>
        reject(new AppError('DOUBAO_VOICE_REQUEST_FAILED', error.message, 502))
      );
      req.end(input.body);
    });
  }

  private trainingHeaders(requestId: string): Record<string, string> {
    const apiKey = this.config?.apiKey?.trim();
    if (apiKey) {
      return {
        'X-Api-Key': apiKey,
        'X-Api-Request-Id': requestId,
      };
    }

    return {
      'X-Api-App-Key': this.config.appId?.trim() || '',
      'X-Api-Access-Key': this.config.accessToken?.trim() || '',
      'X-Api-Request-Id': requestId,
    };
  }

  private speechHeaders(requestId: string): Record<string, string> {
    const apiKey = this.config?.apiKey?.trim();
    const authHeaders = apiKey
      ? { 'X-Api-Key': apiKey }
      : {
          'X-Api-App-Id': this.config.appId?.trim() || '',
          'X-Api-Access-Key': this.config.accessToken?.trim() || '',
        };

    return {
      ...authHeaders,
      'X-Api-Resource-Id': this.resourceId,
      'X-Api-Request-Id': requestId,
      'Content-Type': 'application/json',
    };
  }

  private parseSpeechAudio(body: Buffer, requestId: string): Buffer {
    const chunks: Buffer[] = [];
    const lines = body
      .toString('utf8')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);

    for (const line of lines) {
      let event: DoubaoSpeechEvent;
      try {
        event = JSON.parse(line) as DoubaoSpeechEvent;
      } catch {
        continue;
      }
      if (event.code === 20000000) {
        break;
      }
      if (event.code !== undefined && event.code !== 0 && event.code !== 3000) {
        throw new AppError(
          'DOUBAO_SPEECH_FAILED',
          event.message || `Doubao speech code ${event.code}`,
          502,
          { ...event, requestId }
        );
      }
      if (event.data) {
        chunks.push(Buffer.from(event.data, 'base64'));
      }
    }

    const audio = Buffer.concat(chunks);
    if (!audio.length) {
      throw new AppError(
        'DOUBAO_SPEECH_EMPTY_AUDIO',
        'Doubao speech response is missing audio',
        502,
        { requestId }
      );
    }
    return audio;
  }

  private assertProviderSuccess(
    response: DoubaoTrainingResponse,
    fallbackCode: string
  ): void {
    // V3 返回 code；V1 返回 BaseResp.StatusCode；成功时可能无 code（HTTP 2xx 即成功）
    const v3Code = response?.code;
    const v1Code = Number(response?.BaseResp?.StatusCode ?? 0);
    const failed =
      (v3Code !== undefined && v3Code !== 0) ||
      (v3Code === undefined && v1Code !== 0);
    if (failed) {
      const code = String(v3Code ?? v1Code ?? fallbackCode);
      const message =
        response?.message || response?.BaseResp?.StatusMessage || fallbackCode;
      throw new AppError(code, message, 502, response);
    }
  }

  private ensureTrainingConfigured(): void {
    this.ensureEnabled();
    const hasApiKey = Boolean(this.config?.apiKey?.trim());
    const hasLegacyCredentials = Boolean(
      this.config?.appId?.trim() && this.config?.accessToken?.trim()
    );
    if (!hasApiKey && !hasLegacyCredentials) {
      throw new AppError(
        'DOUBAO_VOICE_CREDENTIALS_MISSING',
        'Doubao voice api key (or legacy app id + access token) is missing',
        500
      );
    }
  }

  private ensureSpeechConfigured(): void {
    this.ensureEnabled();
    if (!this.config?.apiKey?.trim() && !this.config?.appId?.trim()) {
      throw new AppError(
        'DOUBAO_VOICE_APP_ID_MISSING',
        'Doubao voice app id is missing',
        500
      );
    }
  }

  private get maxTrainingTimes(): number {
    const configured = Number(this.config?.maxTrainingTimes);
    return Number.isFinite(configured) && configured > 0
      ? Math.floor(configured)
      : 15;
  }

  private remainingTrainingTimes(version?: number): number | undefined {
    const trainedTimes = Number(version);
    if (!Number.isFinite(trainedTimes) || trainedTimes < 0) {
      return undefined;
    }
    return Math.max(0, this.maxTrainingTimes - Math.floor(trainedTimes));
  }

  private ensureEnabled(): void {
    if (this.config?.enabled === false) {
      throw new AppError(
        'DOUBAO_VOICE_DISABLED',
        'Doubao voice is disabled',
        400
      );
    }
    if (!this.config?.apiKey?.trim() && !this.config?.accessToken?.trim()) {
      throw new AppError(
        'DOUBAO_VOICE_CREDENTIAL_MISSING',
        'Doubao voice credential is missing',
        500
      );
    }
  }

  private normalizeSpeakerId(value: string): string {
    const speakerId = value?.trim();
    if (!/^S_[A-Za-z0-9_-]{4,128}$/.test(speakerId)) {
      throw new AppError(
        'INVALID_DOUBAO_SPEAKER_ID',
        'Doubao speaker id must start with S_',
        400
      );
    }
    return speakerId;
  }

  private audioFormat(fileName: string): string {
    const extension = fileName.split('.').pop()?.toLowerCase();
    return extension === 'mp3' || extension === 'm4a' ? extension : 'wav';
  }

  private statusName(status: number): string {
    return (
      {
        0: 'not_found',
        1: 'training',
        2: 'ready',
        3: 'failed',
        4: 'active',
      }[status] || `unknown_${status}`
    );
  }

  private statusToSlotState(status: number): DoubaoVoiceSlotState {
    return ({
      1: 'Training',
      2: 'Success',
      4: 'Active',
    }[status] || 'Unknown') as DoubaoVoiceSlotState;
  }

  private normalizeKnownSpeakerIds(values: string[]): string[] {
    return [
      ...new Set(values.map(value => value?.trim()).filter(Boolean)),
    ].filter(value => /^S_[A-Za-z0-9_-]{4,128}$/.test(value));
  }

  private toProviderRate(value: unknown, fallback: number): number {
    const parsed = Number(value);
    const multiplier = Number.isFinite(parsed) ? parsed : fallback;
    return Math.round(Math.min(100, Math.max(-50, (multiplier - 1) * 100)));
  }

  private describeVoiceId(value: string): string {
    return value.length <= 10
      ? value
      : `${value.slice(0, 4)}...${value.slice(-4)}`;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private get baseURL(): string {
    return (
      this.config?.baseURL?.trim() || 'https://openspeech.bytedance.com'
    ).replace(/\/+$/, '');
  }

  private get resourceId(): string {
    return this.config?.resourceId?.trim() || 'seed-icl-2.0';
  }

  private get openApiBaseURL(): string {
    return (
      this.config?.openApiBaseURL?.trim() || 'https://open.volcengineapi.com'
    ).replace(/\/+$/, '');
  }

  private get openApiRegion(): string {
    return this.config?.openApiRegion?.trim() || 'cn-beijing';
  }

  private get openApiService(): string {
    return this.config?.openApiService?.trim() || 'speech_saas_prod';
  }

  private get openApiProjectName(): string {
    return this.config?.openApiProjectName?.trim() || 'default';
  }

  private get timeoutMs(): number {
    return Number(this.config?.timeoutMs) > 0
      ? Number(this.config.timeoutMs)
      : 120000;
  }

  private get trainingTimeoutMs(): number {
    return Number(this.config?.trainingTimeoutMs) > 0
      ? Number(this.config.trainingTimeoutMs)
      : 300000;
  }

  private get pollIntervalMs(): number {
    return Number(this.config?.pollIntervalMs) > 0
      ? Number(this.config.pollIntervalMs)
      : 2000;
  }
}
