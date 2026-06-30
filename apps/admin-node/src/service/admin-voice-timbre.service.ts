import { Inject, Logger, Provide } from '@midwayjs/core';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { AppError } from '@tzl/shared';
import * as bullmq from '@midwayjs/bullmq';
import type { ILogger } from '@midwayjs/logger';
import type {
  AdminVoiceTimbreListDTO,
  AdminVoiceTimbreProviderValidationDTO,
  AdminVoiceTimbreRecordDTO,
  VoiceTimbreProviderDTO,
  VoiceTimbreStatusDTO,
} from '@tzl/shared';
import {
  MongoObjectId,
  VoiceTimbreEntity,
  VoiceTimbreProvider,
  VoiceTimbreStatus,
} from '@tzl/entities';
import { MongoRepository } from 'typeorm';
import {
  CreateAdminVoiceTimbreDTO,
  ListAdminVoiceTimbresQueryDTO,
  UpdateAdminVoiceTimbreDTO,
} from '../dto/admin-voice-timbre.dto';
import { AdminFfmpegService } from './admin-ffmpeg.service';
import { AdminStorageFileService } from './admin-storage-file.service';
import { AdminStorageService } from './admin-storage.service';
import { CosyVoiceVoiceService } from './cosyvoice-voice.service';
import { MinimaxVoiceService } from './minimax-voice.service';
import { QwenVoiceService } from './qwen-voice.service';

type MongoWhere = Record<string, unknown>;

export const VOICE_TIMBRE_CREATE_QUEUE = 'voice-timbre-create';
export const DEFAULT_VOICE_TIMBRE_PREVIEW_TEXT =
  '我好想你，最近过得好吗，有没有好好吃饭';
const DEFAULT_SPEECH_SPEED = 1;
const DEFAULT_SPEECH_VOLUME = 1;
const DEFAULT_SPEECH_PITCH = 0;

export interface VoiceTimbreCreateJobData {
  timbreId: string;
}

@Provide()
export class AdminVoiceTimbreService {
  @Logger()
  logger: ILogger;

  @InjectEntityModel(VoiceTimbreEntity)
  voiceTimbreModel: MongoRepository<VoiceTimbreEntity>;

  @Inject()
  bullmqFramework: bullmq.Framework;

  @Inject()
  storageFileService: AdminStorageFileService;

  @Inject()
  storageService: AdminStorageService;

  @Inject()
  ffmpegService: AdminFfmpegService;

  @Inject()
  minimaxVoiceService: MinimaxVoiceService;

  @Inject()
  cosyVoiceVoiceService: CosyVoiceVoiceService;

  @Inject()
  qwenVoiceService: QwenVoiceService;

  async listVoiceTimbres(
    query: ListAdminVoiceTimbresQueryDTO
  ): Promise<AdminVoiceTimbreListDTO> {
    const page = this.normalizePositiveInteger(query?.page, 1);
    const pageSize = Math.min(
      this.normalizePositiveInteger(query?.pageSize, 20),
      100
    );
    const shouldListAll = this.normalizeBoolean(query?.all);
    const where = this.buildSearchWhere(query);

    if (shouldListAll) {
      const timbres = await this.voiceTimbreModel.find({
        where: where as never,
        order: {
          updatedAt: 'DESC',
        },
      });

      return {
        items: timbres.map(timbre => this.buildRecord(timbre)),
        total: timbres.length,
        page: 1,
        pageSize: timbres.length,
      };
    }

    const [total, timbres] = await Promise.all([
      this.voiceTimbreModel.count(where),
      this.voiceTimbreModel.find({
        where: where as never,
        order: {
          updatedAt: 'DESC',
        },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      items: timbres.map(timbre => this.buildRecord(timbre)),
      total,
      page,
      pageSize,
    };
  }

  async createVoiceTimbre(
    payload: CreateAdminVoiceTimbreDTO
  ): Promise<AdminVoiceTimbreRecordDTO> {
    const provider = this.normalizeProvider(payload.provider);
    this.assertCreatableProvider(provider);

    const audioObjectKey = this.normalizeAudioObjectKey(
      payload.audioObjectKey || payload.audioUrl
    );
    const providerVoiceId = this.normalizeInitialProviderVoiceId(
      provider,
      payload.providerVoiceId
    );
    await this.assertProviderVoiceIdAvailable(provider, providerVoiceId);

    const now = new Date();
    const timbre = new VoiceTimbreEntity();
    timbre.name = this.normalizeName(payload.name);
    timbre.provider = provider;
    timbre.providerVoiceId = providerVoiceId;
    timbre.audioObjectKey = audioObjectKey;
    timbre.audioUrl = '';
    timbre.cloneLanguage = this.normalizeCloneLanguage(payload.cloneLanguage);
    timbre.previewText = this.normalizePreviewText(payload.previewText);
    timbre.previewModel = this.normalizePreviewModel(
      payload.previewModel,
      provider
    );
    timbre.previewAudioUrl = '';
    timbre.speechSpeed = this.normalizeSpeechSpeed(payload.speechSpeed);
    timbre.speechVolume = this.normalizeSpeechVolume(payload.speechVolume);
    timbre.speechPitch = this.normalizeSpeechPitch(payload.speechPitch);
    timbre.status = VoiceTimbreStatus.creating;
    timbre.errorCode = '';
    timbre.errorMessage = '';
    timbre.remark = this.normalizeOptionalText(payload.remark, 1000);
    timbre.createdAt = now;
    timbre.updatedAt = now;

    const saved = await this.voiceTimbreModel.save(timbre);
    await this.enqueueCreateVoiceTimbreJob(saved);

    return this.buildRecord(saved);
  }

  async retryVoiceTimbreCreate(
    timbreId: string
  ): Promise<AdminVoiceTimbreRecordDTO> {
    const timbre = await this.getVoiceTimbreById(timbreId);

    if (
      timbre.status !== VoiceTimbreStatus.failed &&
      timbre.status !== VoiceTimbreStatus.active
    ) {
      throw new AppError(
        'VOICE_TIMBRE_RETRY_NOT_ALLOWED',
        'only failed or active voice timbre can be retrained',
        400
      );
    }

    if (this.shouldGenerateMissingProviderPreview(timbre)) {
      timbre.previewText = this.normalizePreviewText(timbre.previewText);
      timbre.previewAudioUrl = await this.createProviderPreviewAudio(
        timbre,
        timbre.providerVoiceId,
        timbre.previewText
      );
      timbre.errorCode = '';
      timbre.errorMessage = '';
      timbre.updatedAt = new Date();

      return this.buildRecord(await this.voiceTimbreModel.save(timbre));
    }

    this.prepareTimbreRetrain(timbre);
    timbre.updatedAt = new Date();
    const saved = await this.voiceTimbreModel.save(timbre);
    await this.enqueueCreateVoiceTimbreJob(saved);

    return this.buildRecord(saved);
  }

  async processCreateVoiceTimbreJob(
    data: VoiceTimbreCreateJobData
  ): Promise<void> {
    const timbre = await this.getVoiceTimbreById(data.timbreId);

    if (timbre.status === VoiceTimbreStatus.active) {
      return;
    }

    if (timbre.status === VoiceTimbreStatus.disabled) {
      return;
    }

    timbre.status = VoiceTimbreStatus.creating;
    timbre.errorCode = '';
    timbre.errorMessage = '';
    timbre.updatedAt = new Date();
    await this.voiceTimbreModel.save(timbre);

    try {
      await this.createProviderVoice(timbre);
    } catch (error) {
      await this.markCreateFailed(timbre, error);

      if (this.shouldRetryCreateError(error)) {
        throw error;
      }
    }
  }

  async updateVoiceTimbre(
    timbreId: string,
    payload: UpdateAdminVoiceTimbreDTO
  ): Promise<AdminVoiceTimbreRecordDTO> {
    const timbre = await this.getVoiceTimbreById(timbreId);
    let changed = false;
    let shouldRetrain = false;

    if (payload.name !== undefined) {
      timbre.name = this.normalizeName(payload.name);
      changed = true;
    }

    if (payload.status !== undefined) {
      timbre.status = this.normalizeEditableStatus(payload.status);
      changed = true;
    }

    if (payload.previewText !== undefined) {
      timbre.previewText = this.normalizePreviewText(payload.previewText);
      changed = true;
      shouldRetrain = true;
    }

    if (payload.speechSpeed !== undefined) {
      timbre.speechSpeed = this.normalizeSpeechSpeed(payload.speechSpeed);
      changed = true;
    }

    if (payload.speechVolume !== undefined) {
      timbre.speechVolume = this.normalizeSpeechVolume(payload.speechVolume);
      changed = true;
    }

    if (payload.speechPitch !== undefined) {
      timbre.speechPitch = this.normalizeSpeechPitch(payload.speechPitch);
      changed = true;
    }

    if (payload.remark !== undefined) {
      timbre.remark = this.normalizeOptionalText(payload.remark, 1000);
      changed = true;
    }

    if (changed) {
      if (shouldRetrain && timbre.status !== VoiceTimbreStatus.disabled) {
        this.prepareTimbreRetrain(timbre);
      }

      timbre.updatedAt = new Date();
      const saved = await this.voiceTimbreModel.save(timbre);

      if (saved.status === VoiceTimbreStatus.creating) {
        await this.enqueueCreateVoiceTimbreJob(saved);
      }
    }

    return this.buildRecord(timbre);
  }

  async ensureActiveTimbre(timbreId: string): Promise<VoiceTimbreEntity> {
    const timbre = await this.getVoiceTimbreById(timbreId);

    if (timbre.status !== VoiceTimbreStatus.active) {
      throw new AppError(
        'VOICE_TIMBRE_NOT_ACTIVE',
        'voice timbre is not active',
        400
      );
    }

    return timbre;
  }

  async validateProviderVoice(
    timbreId: string
  ): Promise<AdminVoiceTimbreProviderValidationDTO> {
    const timbre = await this.getVoiceTimbreById(timbreId);

    if (timbre.provider !== VoiceTimbreProvider.cosyvoice) {
      throw new AppError(
        'VOICE_TIMBRE_PROVIDER_VALIDATE_UNSUPPORTED',
        'only CosyVoice timbres support provider validation now',
        400
      );
    }

    const providerVoiceId = timbre.providerVoiceId?.trim();

    if (!providerVoiceId) {
      throw new AppError(
        'VOICE_TIMBRE_PROVIDER_VOICE_ID_MISSING',
        'provider voice id is missing',
        400
      );
    }

    const result = await this.cosyVoiceVoiceService.queryVoice(providerVoiceId);

    if (result.targetModel?.trim()) {
      timbre.previewModel = result.targetModel.trim();
    }

    this.syncCosyVoiceProviderStatus(timbre, result.status);
    const saved = await this.voiceTimbreModel.save(timbre);

    return {
      provider: saved.provider as VoiceTimbreProviderDTO,
      providerVoiceId: saved.providerVoiceId ?? providerVoiceId,
      providerStatus: result.status,
      targetModel: result.targetModel,
      resourceLink: result.resourceLink,
      requestId: result.requestId,
      record: this.buildRecord(saved),
    };
  }

  private async createProviderVoice(timbre: VoiceTimbreEntity): Promise<void> {
    const previewText = this.normalizePreviewText(timbre.previewText);

    timbre.previewText = previewText;
    const audio = await this.storageFileService.download(timbre.audioObjectKey);
    this.validateSourceMediaFile(
      audio.buffer,
      audio.fileName,
      audio.contentType
    );

    if (timbre.provider === VoiceTimbreProvider.minimax) {
      await this.createMinimaxProviderVoice(timbre, audio, previewText);
      return;
    }

    if (timbre.provider === VoiceTimbreProvider.cosyvoice) {
      await this.createCosyVoiceProviderVoice(timbre, audio, previewText);
      return;
    }

    if (timbre.provider === VoiceTimbreProvider.qwen) {
      await this.createQwenProviderVoice(timbre, audio, previewText);
      return;
    }

    throw new AppError(
      'VOICE_TIMBRE_PROVIDER_UNSUPPORTED',
      'voice timbre provider is not supported',
      400
    );
  }

  private async createMinimaxProviderVoice(
    timbre: VoiceTimbreEntity,
    audio: {
      buffer: Buffer;
      fileName: string;
      contentType: string;
    },
    previewText: string
  ): Promise<void> {
    const cloneAudio = await this.prepareCloneAudio(audio);
    const fileId = await this.minimaxVoiceService.uploadCloneAudio({
      buffer: cloneAudio.buffer,
      fileName: cloneAudio.fileName,
      contentType: cloneAudio.contentType,
    });
    const cloneResult = await this.cloneMinimaxProviderVoice({
      fileId,
      voiceId: timbre.providerVoiceId,
      text: previewText,
      model:
        timbre.previewModel ||
        this.minimaxVoiceService.getDefaultPreviewModel(),
      languageBoost: timbre.cloneLanguage,
    });

    await this.markProviderVoiceActive(timbre, {
      providerFileId: fileId,
      providerVoiceId: cloneResult.providerVoiceId,
      previewAudioUrl: cloneResult.demoAudio,
    });
  }

  private async createCosyVoiceProviderVoice(
    timbre: VoiceTimbreEntity,
    audio: {
      buffer: Buffer;
      fileName: string;
      contentType: string;
      url: string;
    },
    previewText: string
  ): Promise<void> {
    if (this.isMp4Media(audio.fileName, audio.contentType)) {
      throw new AppError(
        'VOICE_TIMBRE_AUDIO_FORMAT_INVALID',
        'CosyVoice clone audio must be mp3, m4a or wav',
        400
      );
    }

    this.validateCloneAudioFile(
      audio.buffer,
      audio.fileName,
      audio.contentType
    );

    const cloneResult = await this.cosyVoiceVoiceService.cloneVoice({
      audioUrl: audio.url,
      prefix: timbre.providerVoiceId,
      targetModel:
        timbre.previewModel ||
        this.cosyVoiceVoiceService.getDefaultPreviewModel(),
      languageHint: timbre.cloneLanguage,
    });

    if (cloneResult.targetModel?.trim()) {
      timbre.previewModel = cloneResult.targetModel.trim();
    }

    const previewAudioUrl = await this.createCosyVoicePreviewAudio(
      timbre,
      cloneResult.providerVoiceId,
      previewText
    );

    await this.markProviderVoiceActive(timbre, {
      providerFileId: cloneResult.requestId || '',
      providerVoiceId: cloneResult.providerVoiceId,
      previewAudioUrl,
    });
  }

  private async createQwenProviderVoice(
    timbre: VoiceTimbreEntity,
    audio: {
      buffer: Buffer;
      fileName: string;
      contentType: string;
      url: string;
    },
    previewText: string
  ): Promise<void> {
    this.validateQwenCloneAudioFile(
      audio.buffer,
      audio.fileName,
      audio.contentType
    );

    const cloneResult = await this.qwenVoiceService.cloneVoice({
      audioUrl: audio.url,
      preferredName: timbre.providerVoiceId,
      targetModel:
        timbre.previewModel ||
        this.qwenVoiceService.getDefaultPreviewModel(),
      language: timbre.cloneLanguage,
    });
    const previewAudioUrl = await this.createQwenPreviewAudio(
      timbre,
      cloneResult.providerVoiceId,
      previewText
    );

    if (cloneResult.fallbackMode) {
      this.logger?.warn?.(
        '[voice-timbre-create] Qwen voice fallback mode, timbreId=%s, reason=%s',
        this.stringifyObjectId(timbre.id),
        cloneResult.fallbackReason || ''
      );
    }

    await this.markProviderVoiceActive(timbre, {
      providerFileId: cloneResult.requestId || '',
      providerVoiceId: cloneResult.providerVoiceId,
      previewAudioUrl,
    });
  }

  private async createCosyVoicePreviewAudio(
    timbre: VoiceTimbreEntity,
    voiceId: string,
    previewText: string
  ): Promise<string> {
    const previewAudio = await this.cosyVoiceVoiceService.synthesizePreview({
      text: previewText,
      voiceId,
      model:
        timbre.previewModel ||
        this.cosyVoiceVoiceService.getDefaultPreviewModel(),
      languageHint: timbre.cloneLanguage,
      speed: timbre.speechSpeed,
      volume: timbre.speechVolume,
      pitch: timbre.speechPitch,
    });

    if (!previewAudio.audioBuffer.length && previewAudio.audioUrl) {
      return previewAudio.audioUrl;
    }

    const previewFile = await this.storageService.uploadCosBuffer({
      buffer: previewAudio.audioBuffer,
      fileName: this.buildPreviewAudioFileName(previewAudio.mimeType),
      folder: 'voice-timbre-previews',
      contentType: previewAudio.mimeType,
    });

    return previewFile.publicUrl;
  }

  private async createQwenPreviewAudio(
    timbre: VoiceTimbreEntity,
    voiceId: string,
    previewText: string
  ): Promise<string> {
    const previewAudio = await this.qwenVoiceService.synthesizePreview({
      text: previewText,
      voiceId,
      model:
        timbre.previewModel ||
        this.qwenVoiceService.getDefaultPreviewModel(),
      language: timbre.cloneLanguage,
    });

    if (!previewAudio.audioBuffer.length && previewAudio.audioUrl) {
      return previewAudio.audioUrl;
    }

    const previewFile = await this.storageService.uploadCosBuffer({
      buffer: previewAudio.audioBuffer,
      fileName: this.buildPreviewAudioFileName(previewAudio.mimeType),
      folder: 'voice-timbre-previews',
      contentType: previewAudio.mimeType,
    });

    return previewFile.publicUrl;
  }

  private async createProviderPreviewAudio(
    timbre: VoiceTimbreEntity,
    voiceId: string,
    previewText: string
  ): Promise<string> {
    if (timbre.provider === VoiceTimbreProvider.cosyvoice) {
      return this.createCosyVoicePreviewAudio(timbre, voiceId, previewText);
    }

    if (timbre.provider === VoiceTimbreProvider.qwen) {
      return this.createQwenPreviewAudio(timbre, voiceId, previewText);
    }

    throw new AppError(
      'VOICE_TIMBRE_PROVIDER_UNSUPPORTED',
      'voice timbre provider is not supported for preview audio',
      400
    );
  }

  private async markProviderVoiceActive(
    timbre: VoiceTimbreEntity,
    input: {
      providerFileId: string;
      providerVoiceId: string;
      previewAudioUrl: string;
    }
  ): Promise<void> {
    timbre.providerFileId = input.providerFileId;
    timbre.providerVoiceId = input.providerVoiceId;
    timbre.previewAudioUrl = input.previewAudioUrl;
    timbre.status = VoiceTimbreStatus.active;
    timbre.errorCode = '';
    timbre.errorMessage = '';
    timbre.updatedAt = new Date();
    await this.voiceTimbreModel.save(timbre);
  }

  private prepareTimbreRetrain(timbre: VoiceTimbreEntity): void {
    timbre.status = VoiceTimbreStatus.creating;
    timbre.errorCode = '';
    timbre.errorMessage = '';
    timbre.providerFileId = '';
    timbre.providerVoiceId = this.generateInitialProviderVoiceId(
      timbre.provider
    );
    timbre.previewText = this.normalizePreviewText(timbre.previewText);
    timbre.previewAudioUrl = '';
  }

  private async cloneMinimaxProviderVoice(input: {
    fileId: string;
    voiceId: string;
    text: string;
    model: string;
    languageBoost: string;
  }): Promise<{ providerVoiceId: string; demoAudio: string }> {
    try {
      return await this.minimaxVoiceService.cloneVoice(input);
    } catch (error) {
      if (!this.isMinimaxVoiceIdDuplicate(error)) {
        throw error;
      }

      const voiceId = this.generateMinimaxProviderVoiceId();

      this.logger?.warn?.(
        '[voice-timbre-create] MiniMax voice_id duplicate, retry with new voiceId=%s',
        voiceId
      );

      return this.minimaxVoiceService.cloneVoice({
        ...input,
        voiceId,
      });
    }
  }

  private async enqueueCreateVoiceTimbreJob(
    timbre: VoiceTimbreEntity
  ): Promise<void> {
    const timbreId = this.stringifyObjectId(timbre.id);
    const queue = this.bullmqFramework?.getQueue(VOICE_TIMBRE_CREATE_QUEUE);

    if (!queue) {
      await this.markCreateFailed(
        timbre,
        new AppError(
          'VOICE_TIMBRE_QUEUE_NOT_FOUND',
          'voice timbre queue is not available',
          500
        )
      );
      return;
    }

    try {
      const jobId = `voice-timbre-create:${timbreId}:${timbre.updatedAt.getTime()}`;

      await queue.addJobToQueue(
        {
          timbreId,
        },
        {
          jobId,
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 5000,
          },
        }
      );
    } catch (error) {
      this.logger?.warn?.(
        '[voice-timbre-create] enqueue failed, timbreId=%s, error=%s',
        timbreId,
        error instanceof Error ? error.message : String(error)
      );
      await this.markCreateFailed(timbre, error);
    }
  }

  private async markCreateFailed(
    timbre: VoiceTimbreEntity,
    error: unknown
  ): Promise<void> {
    timbre.status = VoiceTimbreStatus.failed;
    timbre.errorCode =
      (error as { code?: string })?.code || 'VOICE_TIMBRE_CREATE_FAILED';
    timbre.errorMessage =
      error instanceof Error ? error.message : 'voice timbre create failed';
    timbre.updatedAt = new Date();
    await this.voiceTimbreModel.save(timbre);
  }

  private syncCosyVoiceProviderStatus(
    timbre: VoiceTimbreEntity,
    providerStatus: string
  ): void {
    const normalizedStatus = providerStatus.trim().toUpperCase();

    if (this.isCosyVoiceProviderStatusActive(normalizedStatus)) {
      timbre.status = VoiceTimbreStatus.active;
      timbre.errorCode = '';
      timbre.errorMessage = '';
      timbre.updatedAt = new Date();
      return;
    }

    if (this.isCosyVoiceProviderStatusPending(normalizedStatus)) {
      timbre.status = VoiceTimbreStatus.creating;
      timbre.errorCode = 'COSYVOICE_VOICE_DEPLOYING';
      timbre.errorMessage = `CosyVoice 音色仍在部署：${normalizedStatus}`;
      timbre.updatedAt = new Date();
      return;
    }

    timbre.status = VoiceTimbreStatus.failed;
    timbre.errorCode = `COSYVOICE_VOICE_${normalizedStatus || 'UNAVAILABLE'}`;
    timbre.errorMessage = `CosyVoice 音色不可用：${
      normalizedStatus || 'UNKNOWN'
    }`;
    timbre.updatedAt = new Date();
  }

  private isCosyVoiceProviderStatusActive(providerStatus: string): boolean {
    return ['OK', 'DEPLOYED', 'SUCCEEDED', 'SUCCESS'].includes(providerStatus);
  }

  private isCosyVoiceProviderStatusPending(providerStatus: string): boolean {
    return ['CREATING', 'PENDING', 'DEPLOYING', 'RUNNING'].includes(
      providerStatus
    );
  }

  private shouldRetryCreateError(error: unknown): boolean {
    const code = (error as { code?: string })?.code || '';
    const status = (error as { status?: number })?.status;

    if (
      [
        'COSYVOICE_API_KEY_MISSING',
        'COSYVOICE_AUDIO_URL_MISSING',
        'INVALID_COSYVOICE_PREFIX',
        'QWEN_VOICE_API_KEY_MISSING',
        'QWEN_VOICE_AUDIO_URL_MISSING',
        'INVALID_QWEN_PREFERRED_NAME',
        'MINIMAX_VOICE_API_KEY_MISSING',
        'VOICE_TIMBRE_AUDIO_FORMAT_INVALID',
        'VOICE_TIMBRE_AUDIO_TOO_LARGE',
        'VOICE_TIMBRE_MEDIA_TOO_LARGE',
        'MINIMAX_INVALID_AUDIO',
      ].includes(code)
    ) {
      return false;
    }

    if (this.isPermanentMinimaxError(error)) {
      return false;
    }

    if (typeof status === 'number' && status >= 400 && status < 500) {
      return false;
    }

    return true;
  }

  private isPermanentMinimaxError(error: unknown): boolean {
    const data = (error as { data?: { status_code?: number } })?.data;

    return data?.status_code === 2049;
  }

  private isMinimaxVoiceIdDuplicate(error: unknown): boolean {
    const data = (error as { data?: { status_code?: number } })?.data;

    return data?.status_code === 2039;
  }

  private shouldGenerateMissingProviderPreview(
    timbre: VoiceTimbreEntity
  ): boolean {
    return Boolean(
      [VoiceTimbreProvider.cosyvoice, VoiceTimbreProvider.qwen].includes(
        timbre.provider
      ) &&
        timbre.status === VoiceTimbreStatus.active &&
        timbre.providerVoiceId?.trim() &&
        !timbre.previewAudioUrl?.trim()
    );
  }

  private buildSearchWhere(query: ListAdminVoiceTimbresQueryDTO): MongoWhere {
    const where: MongoWhere = {};
    const keyword = query?.keyword?.trim() ?? '';
    const provider = this.normalizeOptionalProvider(query?.provider);
    const status = this.normalizeOptionalStatus(query?.status);

    if (provider) {
      where.provider = provider;
    }

    if (status) {
      where.status = status;
    }

    if (!keyword) {
      return where;
    }

    const escapedKeyword = this.escapeRegExp(keyword);
    const keywordFilters: MongoWhere[] = [
      { name: { $regex: escapedKeyword, $options: 'i' } },
      { providerVoiceId: { $regex: escapedKeyword, $options: 'i' } },
      { providerFileId: { $regex: escapedKeyword, $options: 'i' } },
      { remark: { $regex: escapedKeyword, $options: 'i' } },
    ];

    if (MongoObjectId.isValid(keyword)) {
      const objectId = new MongoObjectId(keyword);
      keywordFilters.push({ id: objectId });
      keywordFilters.push({ _id: objectId });
    }

    return {
      ...where,
      $or: keywordFilters,
    };
  }

  private buildRecord(timbre: VoiceTimbreEntity): AdminVoiceTimbreRecordDTO {
    return {
      id: this.stringifyObjectId(timbre.id),
      name: timbre.name,
      provider: timbre.provider as VoiceTimbreProviderDTO,
      providerVoiceId: timbre.providerVoiceId ?? '',
      providerFileId: timbre.providerFileId || undefined,
      audioObjectKey: timbre.audioObjectKey ?? '',
      audioUrl: this.storageFileService.resolve(
        timbre.audioObjectKey || timbre.audioUrl
      ),
      cloneLanguage: timbre.cloneLanguage || 'auto',
      previewText: timbre.previewText ?? '',
      previewModel: timbre.previewModel ?? '',
      previewAudioUrl: timbre.previewAudioUrl ?? '',
      speechSpeed: this.normalizeSpeechSpeed(timbre.speechSpeed),
      speechVolume: this.normalizeSpeechVolume(timbre.speechVolume),
      speechPitch: this.normalizeSpeechPitch(timbre.speechPitch),
      status: timbre.status as VoiceTimbreStatusDTO,
      errorCode: timbre.errorCode ?? '',
      errorMessage: timbre.errorMessage ?? '',
      remark: timbre.remark ?? '',
      createdAt: this.formatDate(timbre.createdAt),
      updatedAt: this.formatDate(timbre.updatedAt),
    };
  }

  private async getVoiceTimbreById(
    timbreId: string
  ): Promise<VoiceTimbreEntity> {
    const objectId = this.parseObjectId(timbreId);
    const timbre =
      (await this.voiceTimbreModel.findOne({
        where: {
          id: objectId,
        },
      })) ??
      (await this.voiceTimbreModel.findOne({
        where: {
          _id: objectId,
        } as never,
      }));

    if (!timbre) {
      throw new AppError(
        'VOICE_TIMBRE_NOT_FOUND',
        'voice timbre not found',
        404
      );
    }

    return timbre;
  }

  private async assertProviderVoiceIdAvailable(
    provider: VoiceTimbreProvider,
    providerVoiceId: string
  ): Promise<void> {
    const existing = await this.voiceTimbreModel.findOne({
      where: {
        provider,
        providerVoiceId,
      },
    });

    if (existing) {
      throw new AppError(
        'VOICE_TIMBRE_PROVIDER_VOICE_ID_EXISTS',
        'provider voice id already exists',
        400
      );
    }
  }

  private assertCreatableProvider(provider: VoiceTimbreProvider): void {
    if (
      provider === VoiceTimbreProvider.minimax ||
      provider === VoiceTimbreProvider.cosyvoice ||
      provider === VoiceTimbreProvider.qwen
    ) {
      return;
    }

    throw new AppError(
      'VOICE_TIMBRE_PROVIDER_UNSUPPORTED',
      'voice timbre provider is not supported now',
      400
    );
  }

  private async prepareCloneAudio(input: {
    buffer: Buffer;
    fileName: string;
    contentType: string;
  }): Promise<{ buffer: Buffer; fileName: string; contentType: string }> {
    if (!this.isMp4Media(input.fileName, input.contentType)) {
      return {
        buffer: input.buffer,
        fileName: input.fileName,
        contentType: this.resolveAudioContentType(
          input.fileName,
          input.contentType
        ),
      };
    }

    const extracted = await this.ffmpegService.extractAudioToWav({
      buffer: input.buffer,
      fileName: input.fileName,
    });
    this.validateCloneAudioFile(
      extracted.buffer,
      extracted.fileName,
      extracted.contentType
    );

    return extracted;
  }

  private validateSourceMediaFile(
    buffer: Buffer,
    fileName: string,
    contentType: string
  ): void {
    if (buffer.length > 200 * 1024 * 1024) {
      throw new AppError(
        'VOICE_TIMBRE_MEDIA_TOO_LARGE',
        'media file must be <= 200MB',
        400
      );
    }

    const ext = this.getFileExt(fileName);
    const normalizedContentType = contentType.toLowerCase();
    const validExt = ['mp3', 'm4a', 'wav', 'mp4'].includes(ext);
    const validMime =
      normalizedContentType.includes('audio/mpeg') ||
      normalizedContentType.includes('audio/mp3') ||
      normalizedContentType.includes('audio/mp4') ||
      normalizedContentType.includes('audio/x-m4a') ||
      normalizedContentType.includes('audio/wav') ||
      normalizedContentType.includes('audio/x-wav') ||
      normalizedContentType.includes('video/mp4') ||
      normalizedContentType.includes('application/octet-stream');

    if (!validExt && !validMime) {
      throw new AppError(
        'VOICE_TIMBRE_AUDIO_FORMAT_INVALID',
        'media file must be mp3, m4a, wav or mp4',
        400
      );
    }
  }

  private validateCloneAudioFile(
    buffer: Buffer,
    fileName: string,
    contentType: string
  ): void {
    if (buffer.length > 20 * 1024 * 1024) {
      throw new AppError(
        'VOICE_TIMBRE_AUDIO_TOO_LARGE',
        'converted audio must be <= 20MB',
        400
      );
    }

    const ext = this.getFileExt(fileName);
    const normalizedContentType = contentType.toLowerCase();
    const validExt = ['mp3', 'm4a', 'wav'].includes(ext);
    const validMime =
      normalizedContentType.includes('audio/mpeg') ||
      normalizedContentType.includes('audio/mp3') ||
      normalizedContentType.includes('audio/mp4') ||
      normalizedContentType.includes('audio/x-m4a') ||
      normalizedContentType.includes('audio/wav') ||
      normalizedContentType.includes('audio/x-wav') ||
      normalizedContentType.includes('application/octet-stream');

    if (!validExt && !validMime) {
      throw new AppError(
        'VOICE_TIMBRE_AUDIO_FORMAT_INVALID',
        'clone audio must be mp3, m4a or wav',
        400
      );
    }
  }

  private validateQwenCloneAudioFile(
    buffer: Buffer,
    fileName: string,
    contentType: string
  ): void {
    if (buffer.length > 10 * 1024 * 1024) {
      throw new AppError(
        'VOICE_TIMBRE_AUDIO_TOO_LARGE',
        'Qwen clone audio must be <= 10MB',
        400
      );
    }

    const ext = this.getFileExt(fileName);
    const normalizedContentType = contentType.toLowerCase();
    const validExt = ['mp3', 'm4a', 'wav'].includes(ext);
    const validMime =
      normalizedContentType.includes('audio/mpeg') ||
      normalizedContentType.includes('audio/mp3') ||
      normalizedContentType.includes('audio/mp4') ||
      normalizedContentType.includes('audio/x-m4a') ||
      normalizedContentType.includes('audio/wav') ||
      normalizedContentType.includes('audio/x-wav') ||
      normalizedContentType.includes('application/octet-stream');

    if (!validExt && !validMime) {
      throw new AppError(
        'VOICE_TIMBRE_AUDIO_FORMAT_INVALID',
        'Qwen clone audio must be mp3, m4a or wav',
        400
      );
    }
  }

  private resolveAudioContentType(
    fileName: string,
    contentType: string
  ): string {
    const normalized = contentType?.trim();

    if (normalized && normalized !== 'application/octet-stream') {
      return normalized;
    }

    const ext = this.getFileExt(fileName);

    if (ext === 'mp3') {
      return 'audio/mpeg';
    }

    if (ext === 'm4a') {
      return 'audio/mp4';
    }

    if (ext === 'wav') {
      return 'audio/wav';
    }

    return 'application/octet-stream';
  }

  private normalizeProvider(value?: string): VoiceTimbreProvider {
    const provider = value?.trim() as VoiceTimbreProvider;

    if (
      provider === 'minimax' ||
      provider === 'cosyvoice' ||
      provider === 'qwen' ||
      provider === 'doubao'
    ) {
      return provider;
    }

    throw new AppError(
      'INVALID_VOICE_TIMBRE_PROVIDER',
      'invalid voice timbre provider'
    );
  }

  private normalizeOptionalProvider(
    value?: string
  ): VoiceTimbreProvider | undefined {
    if (value === undefined || value === '') {
      return undefined;
    }

    return this.normalizeProvider(value);
  }

  private normalizeOptionalStatus(
    value?: string
  ): VoiceTimbreStatus | undefined {
    if (value === undefined || value === '') {
      return undefined;
    }

    if (
      value === VoiceTimbreStatus.creating ||
      value === VoiceTimbreStatus.active ||
      value === VoiceTimbreStatus.failed ||
      value === VoiceTimbreStatus.disabled
    ) {
      return value;
    }

    throw new AppError(
      'INVALID_VOICE_TIMBRE_STATUS',
      'invalid voice timbre status'
    );
  }

  private normalizeEditableStatus(value: string): VoiceTimbreStatus {
    if (
      value === VoiceTimbreStatus.active ||
      value === VoiceTimbreStatus.disabled
    ) {
      return value;
    }

    throw new AppError(
      'INVALID_VOICE_TIMBRE_STATUS',
      'invalid voice timbre status'
    );
  }

  private normalizeName(value: string): string {
    const name = value?.trim();

    if (!name) {
      throw new AppError(
        'INVALID_VOICE_TIMBRE_NAME',
        'voice timbre name is required'
      );
    }

    if (name.length > 60) {
      throw new AppError(
        'INVALID_VOICE_TIMBRE_NAME',
        'voice timbre name is too long'
      );
    }

    return name;
  }

  private normalizeAudioObjectKey(value?: string): string {
    const normalized = this.storageFileService.normalizeForStorage(value);

    if (!normalized) {
      throw new AppError(
        'INVALID_VOICE_TIMBRE_AUDIO',
        'audio is required',
        400
      );
    }

    if (normalized.length > 1000) {
      throw new AppError(
        'INVALID_VOICE_TIMBRE_AUDIO',
        'audio reference is too long',
        400
      );
    }

    return normalized;
  }

  private normalizeInitialProviderVoiceId(
    provider: VoiceTimbreProvider,
    value?: string
  ): string {
    const rawValue = value?.trim();

    if (provider === VoiceTimbreProvider.cosyvoice) {
      return this.normalizeCosyVoicePrefix(
        rawValue || this.generateCosyVoicePrefix()
      );
    }

    if (provider === VoiceTimbreProvider.qwen) {
      return this.normalizeQwenPreferredName(
        rawValue || this.generateQwenPreferredName()
      );
    }

    return this.normalizeMinimaxProviderVoiceId(
      rawValue || this.generateMinimaxProviderVoiceId()
    );
  }

  private generateInitialProviderVoiceId(
    provider: VoiceTimbreProvider
  ): string {
    if (provider === VoiceTimbreProvider.cosyvoice) {
      return this.generateCosyVoicePrefix();
    }

    if (provider === VoiceTimbreProvider.qwen) {
      return this.generateQwenPreferredName();
    }

    return this.generateMinimaxProviderVoiceId();
  }

  private normalizeMinimaxProviderVoiceId(value: string): string {
    const voiceId = value.trim();

    if (!/^[A-Za-z][A-Za-z0-9_-]{6,254}[A-Za-z0-9]$/.test(voiceId)) {
      throw new AppError(
        'INVALID_PROVIDER_VOICE_ID',
        'provider voice id must be 8-256 chars, start with letter and contain letters, digits, - or _',
        400
      );
    }

    return voiceId;
  }

  private normalizeCosyVoicePrefix(value: string): string {
    const prefix = value.trim().toLowerCase();

    if (!/^[a-z0-9]{1,10}$/.test(prefix)) {
      throw new AppError(
        'INVALID_COSYVOICE_PREFIX',
        'CosyVoice prefix must be 1-10 lowercase letters or digits',
        400
      );
    }

    return prefix;
  }

  private normalizeQwenPreferredName(value: string): string {
    const preferredName = value.trim();

    if (!/^[A-Za-z0-9_]{1,16}$/.test(preferredName)) {
      throw new AppError(
        'INVALID_QWEN_PREFERRED_NAME',
        'Qwen preferred name must be 1-16 letters, digits or _',
        400
      );
    }

    return preferredName;
  }

  private generateMinimaxProviderVoiceId(): string {
    const random = Math.random().toString(36).slice(2, 10);
    return `TzlVoice_${Date.now()}_${random}`;
  }

  private generateCosyVoicePrefix(): string {
    const timestamp = Date.now().toString(36).slice(-5);
    const random = Math.random().toString(36).slice(2, 4);
    return `tzl${timestamp}${random}`;
  }

  private generateQwenPreferredName(): string {
    const timestamp = Date.now().toString(36).slice(-7);
    const random = Math.random().toString(36).slice(2, 5);
    return `tzl_${timestamp}${random}`;
  }

  private normalizeCloneLanguage(value?: string): string {
    return value?.trim() || 'auto';
  }

  private normalizePreviewModel(
    value: string | undefined,
    provider: VoiceTimbreProvider
  ): string {
    if (value?.trim()) {
      return value.trim();
    }

    if (provider === VoiceTimbreProvider.cosyvoice) {
      return this.cosyVoiceVoiceService.getDefaultPreviewModel();
    }

    if (provider === VoiceTimbreProvider.qwen) {
      return this.qwenVoiceService.getDefaultPreviewModel();
    }

    return this.minimaxVoiceService.getDefaultPreviewModel();
  }

  private normalizeSpeechSpeed(value?: number): number {
    return this.normalizeNumberInRange(value, DEFAULT_SPEECH_SPEED, 0.5, 2);
  }

  private normalizeSpeechVolume(value?: number): number {
    return this.normalizeNumberInRange(value, DEFAULT_SPEECH_VOLUME, 0, 10);
  }

  private normalizeSpeechPitch(value?: number): number {
    return this.normalizeNumberInRange(value, DEFAULT_SPEECH_PITCH, -12, 12);
  }

  private normalizeNumberInRange(
    value: unknown,
    fallback: number,
    min: number,
    max: number
  ): number {
    const parsed = Number(value);

    if (!Number.isFinite(parsed)) {
      return fallback;
    }

    const clamped = Math.min(max, Math.max(min, parsed));
    return Math.round(clamped * 100) / 100;
  }

  private normalizeOptionalText(
    value: string | undefined,
    maxLength: number
  ): string {
    const text = value?.trim() ?? '';

    if (text.length > maxLength) {
      throw new AppError('TEXT_TOO_LONG', 'text is too long', 400);
    }

    return text;
  }

  private normalizePreviewText(value: string | undefined): string {
    return (
      this.normalizeOptionalText(value, 1000) ||
      DEFAULT_VOICE_TIMBRE_PREVIEW_TEXT
    );
  }

  private normalizePositiveInteger(value: unknown, fallback: number): number {
    const parsed = Number(value);

    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }

    return fallback;
  }

  private normalizeBoolean(value: unknown): boolean {
    return value === true || value === 'true' || value === '1';
  }

  private parseObjectId(value: string): MongoObjectId {
    if (!MongoObjectId.isValid(value)) {
      throw new AppError('INVALID_VOICE_TIMBRE_ID', 'invalid voice timbre id');
    }

    return new MongoObjectId(value);
  }

  private stringifyObjectId(value: MongoObjectId): string {
    return value?.toString?.() ?? '';
  }

  private formatDate(value?: Date): string {
    return value instanceof Date && !Number.isNaN(value.getTime())
      ? value.toISOString()
      : '';
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private buildPreviewAudioFileName(mimeType?: string): string {
    const map: Record<string, string> = {
      'audio/mpeg': 'mp3',
      'audio/mp3': 'mp3',
      'audio/wav': 'wav',
      'audio/x-wav': 'wav',
      'audio/pcm': 'pcm',
      'audio/opus': 'opus',
    };
    const normalized = mimeType?.split(';')[0]?.trim().toLowerCase() || '';
    const ext = map[normalized] || 'mp3';

    return `voice_timbre_preview_${Date.now()}.${ext}`;
  }

  private getFileExt(fileName: string): string {
    return fileName.split('.').pop()?.trim().toLowerCase() || '';
  }

  private isMp4Media(fileName: string, contentType: string): boolean {
    const ext = this.getFileExt(fileName);
    const normalizedContentType = contentType.toLowerCase();

    return ext === 'mp4' || normalizedContentType.includes('video/mp4');
  }
}
