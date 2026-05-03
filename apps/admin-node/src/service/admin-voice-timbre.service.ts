import { Inject, Provide } from '@midwayjs/core';
import { InjectEntityModel } from '@midwayjs/typeorm';
import { AppError } from '@tzl/shared';
import type {
  AdminVoiceTimbreListDTO,
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
import { AdminStorageFileService } from './admin-storage-file.service';
import { MinimaxVoiceService } from './minimax-voice.service';

type MongoWhere = Record<string, unknown>;

@Provide()
export class AdminVoiceTimbreService {
  @InjectEntityModel(VoiceTimbreEntity)
  voiceTimbreModel: MongoRepository<VoiceTimbreEntity>;

  @Inject()
  storageFileService: AdminStorageFileService;

  @Inject()
  minimaxVoiceService: MinimaxVoiceService;

  async listVoiceTimbres(
    query: ListAdminVoiceTimbresQueryDTO
  ): Promise<AdminVoiceTimbreListDTO> {
    const page = this.normalizePositiveInteger(query?.page, 1);
    const pageSize = Math.min(
      this.normalizePositiveInteger(query?.pageSize, 20),
      100
    );
    const where = this.buildSearchWhere(query);
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

    if (provider !== 'minimax') {
      throw new AppError(
        'VOICE_TIMBRE_PROVIDER_UNSUPPORTED',
        'only minimax provider is supported now',
        400
      );
    }

    const audioObjectKey = this.normalizeAudioObjectKey(
      payload.audioObjectKey || payload.audioUrl
    );
    const providerVoiceId = this.normalizeProviderVoiceId(
      payload.providerVoiceId || this.generateProviderVoiceId()
    );
    await this.assertProviderVoiceIdAvailable(provider, providerVoiceId);

    const now = new Date();
    const timbre = new VoiceTimbreEntity();
    timbre.name = this.normalizeName(payload.name);
    timbre.provider = provider;
    timbre.providerVoiceId = providerVoiceId;
    timbre.audioObjectKey = audioObjectKey;
    timbre.audioUrl = this.storageFileService.resolve(audioObjectKey);
    timbre.cloneLanguage = this.normalizeCloneLanguage(payload.cloneLanguage);
    timbre.previewText = this.normalizeOptionalText(payload.previewText, 1000);
    timbre.previewModel = this.normalizePreviewModel(payload.previewModel);
    timbre.previewAudioUrl = '';
    timbre.status = VoiceTimbreStatus.creating;
    timbre.errorCode = '';
    timbre.errorMessage = '';
    timbre.remark = this.normalizeOptionalText(payload.remark, 1000);
    timbre.createdAt = now;
    timbre.updatedAt = now;

    const saved = await this.voiceTimbreModel.save(timbre);

    try {
      await this.createProviderVoice(saved);
    } catch (error) {
      saved.status = VoiceTimbreStatus.failed;
      saved.errorCode =
        (error as { code?: string })?.code || 'VOICE_TIMBRE_CREATE_FAILED';
      saved.errorMessage =
        error instanceof Error ? error.message : 'voice timbre create failed';
      saved.updatedAt = new Date();
      await this.voiceTimbreModel.save(saved);
      throw error;
    }

    return this.buildRecord(saved);
  }

  async updateVoiceTimbre(
    timbreId: string,
    payload: UpdateAdminVoiceTimbreDTO
  ): Promise<AdminVoiceTimbreRecordDTO> {
    const timbre = await this.getVoiceTimbreById(timbreId);
    let changed = false;

    if (payload.name !== undefined) {
      timbre.name = this.normalizeName(payload.name);
      changed = true;
    }

    if (payload.status !== undefined) {
      timbre.status = this.normalizeEditableStatus(payload.status);
      changed = true;
    }

    if (payload.previewText !== undefined) {
      timbre.previewText = this.normalizeOptionalText(
        payload.previewText,
        1000
      );
      changed = true;
    }

    if (payload.remark !== undefined) {
      timbre.remark = this.normalizeOptionalText(payload.remark, 1000);
      changed = true;
    }

    if (changed) {
      timbre.updatedAt = new Date();
      await this.voiceTimbreModel.save(timbre);
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

  private async createProviderVoice(timbre: VoiceTimbreEntity): Promise<void> {
    const audio = await this.storageFileService.download(timbre.audioObjectKey);
    this.validateAudioFile(audio.buffer, audio.fileName, audio.contentType);

    const fileId = await this.minimaxVoiceService.uploadCloneAudio({
      buffer: audio.buffer,
      fileName: audio.fileName,
      contentType: this.resolveAudioContentType(
        audio.fileName,
        audio.contentType
      ),
    });
    const cloneResult = await this.minimaxVoiceService.cloneVoice({
      fileId,
      voiceId: timbre.providerVoiceId,
      text: timbre.previewText,
      model:
        timbre.previewModel ||
        this.minimaxVoiceService.getDefaultPreviewModel(),
      languageBoost: timbre.cloneLanguage,
    });

    timbre.providerFileId = fileId;
    timbre.providerVoiceId = cloneResult.providerVoiceId;
    timbre.previewAudioUrl = cloneResult.demoAudio;
    timbre.status = VoiceTimbreStatus.active;
    timbre.errorCode = '';
    timbre.errorMessage = '';
    timbre.updatedAt = new Date();
    await this.voiceTimbreModel.save(timbre);
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
      cloneLanguage: timbre.cloneLanguage || 'Chinese',
      previewText: timbre.previewText ?? '',
      previewModel: timbre.previewModel ?? '',
      previewAudioUrl: timbre.previewAudioUrl ?? '',
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

  private validateAudioFile(
    buffer: Buffer,
    fileName: string,
    contentType: string
  ): void {
    if (buffer.length > 20 * 1024 * 1024) {
      throw new AppError(
        'VOICE_TIMBRE_AUDIO_TOO_LARGE',
        'audio must be <= 20MB',
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
        'audio must be mp3, m4a or wav',
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

  private normalizeProviderVoiceId(value: string): string {
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

  private generateProviderVoiceId(): string {
    const random = Math.random().toString(36).slice(2, 10);
    return `TzlVoice_${Date.now()}_${random}`;
  }

  private normalizeCloneLanguage(value?: string): string {
    return value?.trim() || 'Chinese';
  }

  private normalizePreviewModel(value?: string): string {
    return value?.trim() || this.minimaxVoiceService.getDefaultPreviewModel();
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

  private normalizePositiveInteger(value: unknown, fallback: number): number {
    const parsed = Number(value);

    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }

    return fallback;
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

  private getFileExt(fileName: string): string {
    return fileName.split('.').pop()?.trim().toLowerCase() || '';
  }
}
