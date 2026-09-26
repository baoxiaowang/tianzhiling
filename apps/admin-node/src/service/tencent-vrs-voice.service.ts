import { Config, Logger, Provide } from '@midwayjs/core';
import type { ILogger } from '@midwayjs/logger';
import { AppError } from '@tzl/shared';
import { createHash, createHmac, randomUUID } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { request as httpRequest } from 'http';
import { request as httpsRequest } from 'https';
import { URL } from 'url';

const execFileAsync = promisify(execFile);

/**
 * 腾讯云声音复刻（一句话版，VRS）配置。凭证只来自服务端受保护的 .env，
 * 绝不允许写入客户端、Git、日志或聊天内容。
 */
interface TencentVrsConfig {
  enabled?: boolean;
  secretId?: string;
  secretKey?: string;
  securityToken?: string;
  region?: string;
  vrsEndpoint?: string;
  ttsEndpoint?: string;
  vrsVersion?: string;
  ttsVersion?: string;
  singleSentenceVoiceType?: string;
  defaultVoiceGender?: number;
  defaultSampleRate?: string;
  timeoutMs?: number;
}

export interface TencentVrsTrainingTextResult {
  textId: string;
  text: string;
}

export interface TencentVrsDetectionResult {
  audioId: string;
  detectionCode: number;
  detectionMsg: string;
  detectionTip: Array<{
    word: string;
    tag: number;
    pronAccuracy?: number;
    pronFluency?: number;
  }>;
}

export interface TencentVrsTaskStatusResult {
  taskId: string;
  status: 0 | 1 | 2 | 3;
  statusStr: string;
  voiceType?: number;
  fastVoiceType?: string;
  errorMsg?: string;
  expireTime?: string;
}

export interface TencentVrsSynthesizeInput {
  text: string;
  fastVoiceType: string;
  speed?: number;
  volume?: number;
  codec?: 'wav' | 'mp3' | 'pcm';
  sampleRate?: number;
}

export interface TencentVrsSynthesizeResult {
  audioBuffer: Buffer;
  mimeType: string;
  requestId?: string;
}

export interface TencentVrsVoiceItem {
  voiceType: number;
  voiceName: string;
  voiceGender?: number;
  taskType?: number;
  taskId?: string;
  dateCreated?: string;
  isDeployed?: boolean;
  expireTime?: string;
  fastVoiceType?: string;
}

export interface TencentVrsDeleteVoiceResult {
  supported: false;
  reason: string;
}

/**
 * 一句话版声音复刻任务状态码。
 * 0-任务等待 1-任务执行中 2-任务成功 3-任务失败
 */
const VRS_STATUS_WAITING = 0;

/** DetectEnvAndSoundQuality 音质检测（TypeId=2），返回的 DetectionCode。 */
const DETECTION_CODE_PASS = 0;

/**
 * 一句话版声音复刻训练音频检测要求（腾讯云官方）：
 * 时长 > 5s 且 < 15s；文件大小 <= 2MB；单声道；位深 16bit；
 * 建议格式 wav / 单声道 / 采样率 16k、24k 或 48k。
 */
const DETECT_MAX_AUDIO_BYTES = 2 * 1024 * 1024;

/** 腾讯云 VRS 性别枚举：1=男，2=女（必须为 int64，不能传字符串）。 */
export const TENCENT_VRS_VOICE_GENDER_MALE = 1;
export const TENCENT_VRS_VOICE_GENDER_FEMALE = 2;

@Provide()
export class TencentVrsVoiceService {
  @Logger()
  logger: ILogger;

  @Config('tencentVrs')
  config: TencentVrsConfig;

  private get secretId(): string {
    return (this.config?.secretId || '').trim();
  }

  private get secretKey(): string {
    return (this.config?.secretKey || '').trim();
  }

  private get securityToken(): string {
    return (this.config?.securityToken || '').trim();
  }

  private get region(): string {
    return (this.config?.region || 'ap-guangzhou').trim();
  }

  private get vrsEndpoint(): string {
    return (this.config?.vrsEndpoint || 'https://vrs.tencentcloudapi.com').trim();
  }

  private get ttsEndpoint(): string {
    return (this.config?.ttsEndpoint || 'https://tts.tencentcloudapi.com').trim();
  }

  private get vrsVersion(): string {
    return (this.config?.vrsVersion || '2020-08-24').trim();
  }

  private get ttsVersion(): string {
    return (this.config?.ttsVersion || '2019-08-23').trim();
  }

  private get singleSentenceVoiceType(): string {
    return (
      (this.config?.singleSentenceVoiceType || '200000000').trim() ||
      '200000000'
    );
  }

  private get defaultVoiceGender(): number {
    const value = Number(this.config?.defaultVoiceGender);
    if (value === TENCENT_VRS_VOICE_GENDER_MALE) {
      return TENCENT_VRS_VOICE_GENDER_MALE;
    }
    return TENCENT_VRS_VOICE_GENDER_FEMALE;
  }

  private get defaultSampleRate(): number {
    return Number(this.config?.defaultSampleRate) || 16000;
  }

  private get timeoutMs(): number {
    return this.config?.timeoutMs || 120000;
  }

  /** 一句话版声音复刻固定 VoiceType 值。 */
  getSingleSentenceVoiceType(): string {
    return this.singleSentenceVoiceType;
  }

  isEnabled(): boolean {
    return Boolean(this.config?.enabled);
  }

  ensureConfigured(): void {
    if (!this.isEnabled()) {
      throw new AppError(
        'TENCENT_VRS_NOT_ENABLED',
        '腾讯云声音复刻未启用，请检查服务端配置 ADMIN_API_TENCENT_VRS_ENABLED',
        503
      );
    }
    if (!this.secretId || !this.secretKey) {
      throw new AppError(
        'TENCENT_VRS_NOT_CONFIGURED',
        '腾讯云声音复刻凭证未配置，请检查服务端 ADMIN_API_TENCENT_VRS_SECRET_ID / SECRET_KEY',
        503
      );
    }
  }

  /**
   * 将性别归一为腾讯云要求的整数（1=男，2=女）。
   * 真实 API 对字符串会返回 InvalidParameter: VoiceGender should be int64。
   */
  normalizeVoiceGender(value?: number | string): number {
    if (typeof value === 'number') {
      return value === TENCENT_VRS_VOICE_GENDER_MALE
        ? TENCENT_VRS_VOICE_GENDER_MALE
        : TENCENT_VRS_VOICE_GENDER_FEMALE;
    }
    const trimmed = String(value ?? '').trim();
    if (trimmed === '1' || trimmed.toLowerCase() === 'male') {
      return TENCENT_VRS_VOICE_GENDER_MALE;
    }
    if (trimmed === '2' || trimmed.toLowerCase() === 'female') {
      return TENCENT_VRS_VOICE_GENDER_FEMALE;
    }
    return this.defaultVoiceGender;
  }

  /**
   * 获取声音复刻训练文本。一句话版必须使用腾讯云返回的指定文本录音，
   * 不能把历史录音直接提交给该文本对应的音质检测接口。
   */
  async getTrainingText(input?: {
    domain?: 0 | 1 | 2 | 3;
    textLanguage?: 1;
  }): Promise<TencentVrsTrainingTextResult> {
    this.ensureConfigured();
    const payload: Record<string, unknown> = {
      TaskType: 5,
      TextLanguage: input?.textLanguage ?? 1,
    };
    if (input?.domain !== undefined) {
      payload.Domain = input.domain;
    }

    const response = await this.postJson({
      action: 'GetTrainingText',
      service: 'vrs',
      endpoint: this.vrsEndpoint,
      region: this.region,
      version: this.vrsVersion,
      payload,
    });

    const list = response?.Data?.TrainingTextList ?? [];
    const first = Array.isArray(list) ? list[0] : undefined;
    if (!first || !first.TextId || !first.Text) {
      throw new AppError(
        'TENCENT_VRS_EMPTY_TRAINING_TEXT',
        '腾讯云未返回可用的复刻训练文本',
        502,
        { requestId: response.RequestId }
      );
    }

    return { textId: String(first.TextId), text: String(first.Text) };
  }

  /**
   * 环境检测和音频质量检测（一句话版）。
   * 检测通过后返回 AudioId，供 CreateVRSTask 使用。
   * 注意：AudioData 与 TextId 绑定（ASR 比对文本一致性），
   * 因此历史录音不可直接用于指定文本的检测。
   */
  async detectSoundQuality(input: {
    textId: string;
    audioBuffer: Buffer;
    codec?: 'wav' | 'mp3' | 'aac' | 'm4a';
    sampleRate?: number;
  }): Promise<TencentVrsDetectionResult> {
    this.ensureConfigured();
    const textId = input.textId?.trim();
    const audio = input.audioBuffer;

    if (!textId) {
      throw new AppError(
        'TENCENT_VRS_MISSING_TEXT_ID',
        '缺少复刻训练文本 TextId',
        400
      );
    }
    if (!audio || !audio.length) {
      throw new AppError(
        'TENCENT_VRS_EMPTY_AUDIO',
        '复刻训练音频为空',
        400
      );
    }
    if (audio.length > DETECT_MAX_AUDIO_BYTES) {
      throw new AppError(
        'TENCENT_VRS_AUDIO_TOO_LARGE',
        '复刻训练音频超过 2MB 上限，请压缩或缩短后重试',
        400,
        { sizeBytes: audio.length, maxBytes: DETECT_MAX_AUDIO_BYTES }
      );
    }

    const codec = input.codec || 'wav';
    const sampleRate = input.sampleRate || this.defaultSampleRate;
    const audioData = audio.toString('base64');

    const response = await this.postJson({
      action: 'DetectEnvAndSoundQuality',
      service: 'vrs',
      endpoint: this.vrsEndpoint,
      region: this.region,
      version: this.vrsVersion,
      payload: {
        TextId: textId,
        AudioData: audioData,
        TypeId: 2,
        Codec: codec,
        SampleRate: sampleRate,
        TaskType: 5,
      },
    });

    const data = response?.Data ?? {};
    const detectionCode = Number(data.DetectionCode ?? -1);
    const tip = Array.isArray(data.DetectionTip)
      ? data.DetectionTip.map((item: Record<string, unknown>) => ({
          word: String(item.Word ?? ''),
          tag: Number(item.Tag ?? 0),
          pronAccuracy:
            item.PronAccuracy != null ? Number(item.PronAccuracy) : undefined,
          pronFluency:
            item.PronFluency != null ? Number(item.PronFluency) : undefined,
        }))
      : [];

    const result: TencentVrsDetectionResult = {
      audioId: String(data.AudioId ?? ''),
      detectionCode,
      detectionMsg: String(data.DetectionMsg ?? ''),
      detectionTip: tip,
    };

    if (detectionCode !== DETECTION_CODE_PASS || !result.audioId) {
      throw new AppError(
        'TENCENT_VRS_DETECTION_FAILED',
        this.describeDetectionFailure(result),
        422,
        result
      );
    }

    return result;
  }

  /**
   * 声音复刻任务创建（一句话版）。
   * 失败会抛出 AppError；配额不足会映射为明确的 TENCENT_VRS_QUOTA_EXHAUSTED。
   * VoiceGender 必须为整数（1=男，2=女），真实 API 不接受字符串。
   */
  async createVrsTask(input: {
    audioId: string;
    voiceName: string;
    voiceGender?: number | string;
    sampleRate?: number;
  }): Promise<{ taskId: string; requestId?: string }> {
    this.ensureConfigured();
    const audioId = input.audioId?.trim();
    const voiceName = input.voiceName?.trim();

    if (!audioId) {
      throw new AppError(
        'TENCENT_VRS_MISSING_AUDIO_ID',
        '缺少音质检测通过的 AudioId，请先完成音质检测',
        400
      );
    }
    if (!voiceName) {
      throw new AppError(
        'TENCENT_VRS_MISSING_VOICE_NAME',
        '缺少音色名称',
        400
      );
    }

    const voiceGender = this.normalizeVoiceGender(input.voiceGender);

    const payload: Record<string, unknown> = {
      SessionId: randomUUID(),
      VoiceName: voiceName,
      VoiceGender: voiceGender,
      VoiceLanguage: 1,
      AudioIdList: [audioId],
      SampleRate: input.sampleRate || this.defaultSampleRate,
      Codec: 'wav',
      TaskType: 5,
      ModelType: 1,
      EnableVoiceEnhance: 0,
    };

    const response = await this.postJson({
      action: 'CreateVRSTask',
      service: 'vrs',
      endpoint: this.vrsEndpoint,
      region: this.region,
      version: this.vrsVersion,
      payload,
    });

    const taskId = response?.Data?.TaskId?.trim();
    if (!taskId) {
      throw new AppError(
        'TENCENT_VRS_CREATE_TASK_EMPTY',
        '腾讯云未返回复刻任务 TaskId',
        502,
        { requestId: response.RequestId }
      );
    }

    return { taskId, requestId: response.RequestId };
  }

  /** 声音复刻任务结果查询。 */
  async describeVrsTaskStatus(
    taskId: string
  ): Promise<TencentVrsTaskStatusResult> {
    this.ensureConfigured();
    const id = taskId?.trim();
    if (!id) {
      throw new AppError('TENCENT_VRS_MISSING_TASK_ID', '缺少复刻任务 TaskId', 400);
    }

    const response = await this.postJson({
      action: 'DescribeVRSTaskStatus',
      service: 'vrs',
      endpoint: this.vrsEndpoint,
      region: this.region,
      version: this.vrsVersion,
      payload: { TaskId: id },
    });

    const data = response?.Data ?? {};
    return {
      taskId: String(data.TaskId ?? id),
      status: Number(data.Status ?? VRS_STATUS_WAITING) as 0 | 1 | 2 | 3,
      statusStr: String(data.StatusStr ?? ''),
      voiceType: data.VoiceType != null ? Number(data.VoiceType) : undefined,
      fastVoiceType: data.FastVoiceType
        ? String(data.FastVoiceType)
        : undefined,
      errorMsg: data.ErrorMsg ? String(data.ErrorMsg) : undefined,
      expireTime: data.ExpireTime ? String(data.ExpireTime) : undefined,
    };
  }

  /**
   * 基础语音合成（一句话版声音复刻）。
   * 必须同时传入 VoiceType=200000000 与 FastVoiceType（复刻音色ID）。
   */
  async synthesize(
    input: TencentVrsSynthesizeInput
  ): Promise<TencentVrsSynthesizeResult> {
    this.ensureConfigured();
    const text = input.text?.trim();
    const fastVoiceType = input.fastVoiceType?.trim();

    if (!text) {
      throw new AppError(
        'TENCENT_VRS_INVALID_TEXT',
        '合成文本不能为空',
        400
      );
    }
    if (!fastVoiceType) {
      throw new AppError(
        'TENCENT_VRS_MISSING_FAST_VOICE_TYPE',
        '缺少一句话复刻音色 FastVoiceType',
        400
      );
    }
    // 基础合成中文最多 150 个汉字（全角标点算一个汉字）。
    if (Array.from(text).length > 150) {
      throw new AppError(
        'TENCENT_VRS_TEXT_TOO_LONG',
        '一句话复刻合成文本不能超过 150 个字符',
        400,
        { length: Array.from(text).length, max: 150 }
      );
    }

    const codec = input.codec || 'wav';
    const payload: Record<string, unknown> = {
      Text: text,
      SessionId: randomUUID(),
      VoiceType: Number(this.singleSentenceVoiceType),
      FastVoiceType: fastVoiceType,
      Volume: input.volume ?? 0,
      Speed: input.speed ?? 0,
      ProjectId: 0,
      ModelType: 1,
      PrimaryLanguage: 1,
      SampleRate: input.sampleRate || this.defaultSampleRate,
      Codec: codec,
    };

    const response = await this.postJson({
      action: 'TextToVoice',
      service: 'tts',
      endpoint: this.ttsEndpoint,
      region: this.region,
      version: this.ttsVersion,
      payload,
    });

    const audioBase64 = response?.Audio;
    if (!audioBase64) {
      throw new AppError(
        'TENCENT_VRS_SYNTHESIZE_EMPTY',
        '腾讯云合成未返回音频',
        502,
        { requestId: response.RequestId }
      );
    }

    const audioBuffer = Buffer.from(String(audioBase64), 'base64');
    if (!audioBuffer.length) {
      throw new AppError(
        'TENCENT_VRS_SYNTHESIZE_EMPTY',
        '腾讯云合成音频为空',
        502,
        { requestId: response.RequestId }
      );
    }

    return {
      audioBuffer,
      mimeType: codec === 'mp3' ? 'audio/mpeg' : 'audio/wav',
      requestId: response.RequestId,
    };
  }

  /**
   * 查询当前腾讯云账号下的复刻音色列表（用于对账 / 清理能力核验）。
   * 腾讯云该接口限频 1 次/秒。
   */
  async listVoices(): Promise<TencentVrsVoiceItem[]> {
    this.ensureConfigured();
    const response = await this.postJson({
      action: 'GetVRSVoiceTypes',
      service: 'vrs',
      endpoint: this.vrsEndpoint,
      region: this.region,
      version: this.vrsVersion,
      payload: {},
    });

    const list = response?.Data?.VoiceTypeList ?? [];
    if (!Array.isArray(list)) {
      return [];
    }

    return list.map((item: Record<string, unknown>) => ({
      voiceType: Number(item.VoiceType ?? 0),
      voiceName: String(item.VoiceName ?? ''),
      voiceGender: item.VoiceGender != null ? Number(item.VoiceGender) : undefined,
      taskType: item.TaskType != null ? Number(item.TaskType) : undefined,
      taskId: item.TaskID ? String(item.TaskID) : undefined,
      dateCreated: item.DateCreated ? String(item.DateCreated) : undefined,
      isDeployed: item.IsDeployed != null ? Boolean(item.IsDeployed) : undefined,
      expireTime: item.ExpireTime ? String(item.ExpireTime) : undefined,
      fastVoiceType: item.FastVoiceType ? String(item.FastVoiceType) : undefined,
    }));
  }

  /**
   * 删除一句话版复刻音色。
   *
   * 限制说明：腾讯云声音复刻（VRS）公开 API 当前没有删除音色的接口——
   * 公开接口仅包括获取训练文本、音质检测、任务创建、任务结果查询、查询复刻音色。
   * 因此这里返回 supported:false 并附明确原因，绝不伪造删除成功。
   * 需由账号管理员向腾讯云确认控制台删除方式或申请人工删除。
   * 免费存储期结束后可能开始收费，不能当成自动删除。
   */
  async deleteVoice(_input: {
    fastVoiceType?: string;
  }): Promise<TencentVrsDeleteVoiceResult> {
    return {
      supported: false,
      reason:
        '腾讯云声音复刻公开 API 无删除音色接口；请联系腾讯云确认并人工删除。' +
        '免费存储期结束后可能开始收费，不能等待其自动回收。',
    };
  }

  /**
   * 将任意音频转成腾讯云复刻检测要求的格式：wav、单声道、16bit、16k。
   * 保证时长 5~15s 由业务侧在录制阶段约束；此处只做格式归一。
   */
  async normalizeTrainingAudioToWav(input: {
    inputPath: string;
    outputPath: string;
  }): Promise<void> {
    const { inputPath, outputPath } = input;
    try {
      await execFileAsync(
        'ffmpeg',
        [
          '-y',
          '-i',
          inputPath,
          '-ar',
          '16000',
          '-ac',
          '1',
          '-acodec',
          'pcm_s16le',
          '-f',
          'wav',
          outputPath,
        ],
        { timeout: 60000, maxBuffer: 64 * 1024 * 1024 }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error('[tencent-vrs] normalize audio failed: %s', message);
      throw new AppError(
        'TENCENT_VRS_AUDIO_NORMALIZE_FAILED',
        '复刻训练音频格式转换失败，请使用 wav/mp3/m4a/aac 格式且为单声道清晰录音',
        422,
        { cause: message.slice(0, 500) }
      );
    }
  }

  /** 把音质检测失败映射为可读的提示。 */
  private describeDetectionFailure(
    result: TencentVrsDetectionResult
  ): string {
    const code = result.detectionCode;
    if (code === -2) {
      return '录音与指定文本不一致（漏读、错读或多读），请对照稿子重新录制';
    }
    if (code === -3) {
      return '录音噪声较大，请到安静环境重新录制';
    }
    return (
      result.detectionMsg ||
      '复刻训练音频未通过腾讯云音质检测，请重新录制（需按指定文本、5~15 秒、单声道清晰录音）'
    );
  }

  /**
   * TC3-HMAC-SHA256 签名并发起腾讯云 API 3.0 JSON POST 请求。
   * 返回解析后的 Response 对象；业务/公共错误码会抛出 AppError。
   */
  private async postJson(input: {
    action: string;
    service: 'vrs' | 'tts';
    endpoint: string;
    region?: string;
    version: string;
    payload: Record<string, unknown>;
  }): Promise<any> {
    const { action, service, endpoint, region, version, payload } = input;
    const url = new URL(endpoint);
    const host = url.host;
    const timestamp = Math.floor(Date.now() / 1000);
    const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
    const body = Buffer.from(JSON.stringify(payload), 'utf8');
    const hashedPayload = createHash('sha256').update(body).digest('hex');

    const canonicalHeaders = [
      'content-type:application/json; charset=utf-8',
      `host:${host}`,
      `x-tc-action:${action.toLowerCase()}`,
    ].join('\n');
    const signedHeaders = 'content-type;host;x-tc-action';
    const canonicalRequest = [
      'POST',
      '/',
      '',
      canonicalHeaders,
      '',
      signedHeaders,
      hashedPayload,
    ].join('\n');
    const hashedCanonicalRequest = createHash('sha256')
      .update(canonicalRequest)
      .digest('hex');
    const credentialScope = `${date}/${service}/tc3_request`;
    const stringToSign = [
      'TC3-HMAC-SHA256',
      timestamp,
      credentialScope,
      hashedCanonicalRequest,
    ].join('\n');

    const secretDate = createHmac('sha256', `TC3${this.secretKey}`)
      .update(date)
      .digest();
    const secretService = createHmac('sha256', secretDate)
      .update(service)
      .digest();
    const secretSigning = createHmac('sha256', secretService)
      .update('tc3_request')
      .digest();
    const signature = createHmac('sha256', secretSigning)
      .update(stringToSign)
      .digest('hex');

    const headers: Record<string, string> = {
      Authorization: `TC3-HMAC-SHA256 Credential=${this.secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      'Content-Type': 'application/json; charset=utf-8',
      Host: host,
      'X-TC-Action': action,
      'X-TC-Timestamp': String(timestamp),
      'X-TC-Version': version,
      'Content-Length': String(body.length),
    };
    if (region) {
      headers['X-TC-Region'] = region;
    }
    if (this.securityToken) {
      headers['X-TC-Token'] = this.securityToken;
    }

    const { statusCode, responseBody, requestId } = await this.request({
      url,
      headers,
      body,
    });

    let json: any;
    try {
      json = JSON.parse(responseBody.toString('utf8'));
    } catch {
      throw new AppError(
        'TENCENT_VRS_INVALID_RESPONSE',
        '腾讯云返回了无法解析的响应',
        502,
        { httpStatus: statusCode }
      );
    }

    // 腾讯云业务/鉴权错误通常随 HTTP 200 或 4xx 返回在 Response.Error 中。
    const apiError = json?.Response?.Error;
    if (apiError) {
      const code = String(apiError.Code ?? '');
      const message = String(apiError.Message ?? '');
      if (/VRSQuotaExhausted/i.test(code)) {
        throw new AppError(
          'TENCENT_VRS_QUOTA_EXHAUSTED',
          '腾讯云声音复刻额度不足或未开通，请先在腾讯云控制台开通',
          402,
          { code, requestId: json.Response.RequestId }
        );
      }
      throw new AppError(
        'TENCENT_VRS_API_ERROR',
        message || code || '腾讯云接口调用失败',
        502,
        { code, requestId: json.Response.RequestId }
      );
    }

    if (statusCode < 200 || statusCode >= 300) {
      throw new AppError(
        'TENCENT_VRS_HTTP_ERROR',
        this.readHttpError(responseBody),
        502,
        { httpStatus: statusCode, requestId }
      );
    }

    return json.Response ?? {};
  }

  private request(input: {
    url: URL;
    headers: Record<string, string>;
    body: Buffer;
  }): Promise<{ statusCode: number; responseBody: Buffer; requestId?: string }> {
    const requester = input.url.protocol === 'http:' ? httpRequest : httpsRequest;
    return new Promise((resolve, reject) => {
      const req = requester(
        input.url,
        {
          method: 'POST',
          timeout: this.timeoutMs,
          headers: input.headers,
        },
        res => {
          const chunks: Buffer[] = [];
          res.on('data', chunk => chunks.push(Buffer.from(chunk)));
          res.on('end', () => {
            const responseBody = Buffer.concat(chunks);
            let requestId: string | undefined;
            try {
              const parsed = JSON.parse(responseBody.toString('utf8'));
              requestId = parsed?.Response?.RequestId;
            } catch {
              /* ignore */
            }
            resolve({
              statusCode: res.statusCode || 0,
              responseBody,
              requestId,
            });
          });
        }
      );
      req.on('timeout', () =>
        req.destroy(new Error('Tencent cloud voice request timeout'))
      );
      req.on('error', error =>
        reject(
          new AppError(
            'TENCENT_VRS_REQUEST_FAILED',
            error.message || '腾讯云接口请求失败',
            502
          )
        )
      );
      req.end(input.body);
    });
  }

  private readHttpError(responseBody: Buffer): string {
    try {
      const parsed = JSON.parse(responseBody.toString('utf8'));
      return (
        parsed?.Response?.Error?.Message ||
        parsed?.Response?.Error?.Code ||
        responseBody.toString('utf8').slice(0, 500)
      );
    } catch {
      return responseBody.toString('utf8').slice(0, 500);
    }
  }
}
