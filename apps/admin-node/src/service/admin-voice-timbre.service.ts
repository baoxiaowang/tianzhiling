import { Inject, Logger, Provide } from '@midwayjs/core';
import { brandName } from '../config/brand';
import { InjectEntityModel } from '@midwayjs/typeorm';
import {
  AppError,
  buildCosyVoiceSpeechInstruction,
  buildDoubaoIcl2SpeechInstruction,
  buildQwenAudioSpeechInstruction,
  COSYVOICE_V35_DIALECT_OPTIONS,
  QWEN_AUDIO_DIALECT_OPTIONS,
  VOICE_TIMBRE_DIALECT_OPTIONS,
} from '@tzl/shared';
import * as bullmq from '@midwayjs/bullmq';
import type { ILogger } from '@midwayjs/logger';
import type {
  AdminVoiceTimbreListDTO,
  AdminDoubaoVoiceSlotDTO,
  AdminDoubaoVoiceSlotListDTO,
  BindAdminDoubaoVoiceSlotResultDTO,
  AdminVoiceTimbreProviderValidationDTO,
  AdminVoiceTimbreRecordDTO,
  DeleteAdminVoiceTimbreResultDTO,
  VoiceTimbreProviderDTO,
  VoiceTimbreDialectDTO,
  VoiceTimbreStatusDTO,
} from '@tzl/shared';
import {
  AgentEntity,
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
import {
  DoubaoVoiceService,
  type DoubaoVoiceSlot,
} from './doubao-voice.service';
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

  @InjectEntityModel(AgentEntity)
  agentModel: MongoRepository<AgentEntity>;

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

  @Inject()
  doubaoVoiceService: DoubaoVoiceService;

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
        items: await this.buildRecords(timbres),
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
      items: await this.buildRecords(timbres),
      total,
      page,
      pageSize,
    };
  }

  async listDoubaoVoiceSlots(): Promise<AdminDoubaoVoiceSlotListDTO> {
    const syncedAt = new Date();
    const timbres = await this.voiceTimbreModel.find({
      where: {
        provider: VoiceTimbreProvider.doubao,
      } as never,
      order: { updatedAt: 'DESC' },
    });
    const knownSpeakerIds = this.collectDoubaoSpeakerIds(timbres);
    const providerResult = await this.doubaoVoiceService.listSlots(
      knownSpeakerIds
    );
    const boundBySpeakerId = new Map<string, VoiceTimbreEntity>();
    for (const timbre of timbres) {
      const speakerId = timbre.providerVoiceId?.trim();
      if (
        timbre.deletionStatus !== 'completed' &&
        this.isDoubaoSpeakerId(speakerId) &&
        !boundBySpeakerId.has(speakerId)
      ) {
        boundBySpeakerId.set(speakerId, timbre);
      }
    }
    const boundTimbres = [...boundBySpeakerId.values()];
    const boundTimbreIds = boundTimbres.map(timbre => timbre.id);
    const agents = boundTimbreIds.length
      ? await this.agentModel.find({
          where: {
            $or: [
              { voiceTimbreId: { $in: boundTimbreIds } },
              { pendingVoiceTimbreId: { $in: boundTimbreIds } },
            ],
          } as never,
        })
      : [];
    const agentsByTimbreId = this.buildAgentsByTimbreId(agents);

    const fixedSpeakerIds = this.doubaoVoiceService.getKnownSpeakerIds();
    const fixedOrder = new Map(
      fixedSpeakerIds.map((speakerId, index) => [speakerId, index])
    );
    const providerSlots = [...providerResult.items].sort((left, right) => {
      const leftFixedIndex = fixedOrder.get(left.speakerId);
      const rightFixedIndex = fixedOrder.get(right.speakerId);
      if (leftFixedIndex !== undefined || rightFixedIndex !== undefined) {
        if (leftFixedIndex === undefined) return 1;
        if (rightFixedIndex === undefined) return -1;
        return leftFixedIndex - rightFixedIndex;
      }

      const orderDelta = (left.orderTime || 0) - (right.orderTime || 0);
      const createDelta = (left.createTime || 0) - (right.createTime || 0);
      return (
        orderDelta ||
        createDelta ||
        left.instanceNo.localeCompare(right.instanceNo) ||
        left.speakerId.localeCompare(right.speakerId)
      );
    });
    const items = providerSlots.map((slot, index) => {
      const boundTimbre = boundBySpeakerId.get(slot.speakerId);
      return this.buildDoubaoSlotRecord(
        index + 1,
        slot,
        boundTimbre,
        agentsByTimbreId.get(this.stringifyObjectId(boundTimbre?.id))
      );
    });
    const soonDeadline = syncedAt.getTime() + 7 * 24 * 60 * 60 * 1000;
    const metadataMessage = providerResult.openApiSyncSucceeded
      ? '到期时间和剩余训练次数已从火山引擎同步。'
      : providerResult.openApiSyncAttempted
      ? '火山引擎元数据本次同步失败，不影响上传素材和训练。'
      : '未配置 OpenAPI AK/SK，暂不显示到期时间和剩余训练次数。';

    return {
      configured:
        providerResult.openApiSyncAttempted ||
        fixedSpeakerIds.length > 0 ||
        items.length > 0,
      message: items.length
        ? `已按 ${items.length} 个真实 Speaker ID 固定槽位关系；“本地音色”表示天之灵当前占用记录，智能体绑定请统一在音色列表管理。${metadataMessage}`
        : `没有发现可固定的 Speaker ID；请配置已购 Speaker ID 或火山引擎 OpenAPI。${metadataMessage}`,
      items,
      total: items.length,
      availableCount: items.filter(item => item.availableForTraining).length,
      boundCount: items.filter(item => Boolean(item.boundTimbre)).length,
      expiringSoonCount: items.filter(item => {
        const expiry = item.expireTime ? Date.parse(item.expireTime) : 0;
        return expiry > syncedAt.getTime() && expiry <= soonDeadline;
      }).length,
      syncedAt: syncedAt.toISOString(),
      requestIds: providerResult.requestIds,
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
    const previewModel = this.normalizePreviewModel(
      payload.previewModel,
      provider
    );
    const providerVoiceId = this.normalizeInitialProviderVoiceId(
      provider,
      payload.providerVoiceId,
      previewModel
    );
    await this.assertDoubaoSlotTrainable(provider, providerVoiceId);
    await this.assertProviderVoiceIdAvailable(provider, providerVoiceId);

    const now = new Date();
    const timbre = new VoiceTimbreEntity();
    timbre.name = this.normalizeName(payload.name);
    timbre.provider = provider;
    timbre.providerVoiceId = providerVoiceId;
    timbre.audioObjectKey = audioObjectKey;
    timbre.audioUrl = '';
    timbre.cloneLanguage = this.defaultCloneLanguage(provider);
    timbre.speechDialect = this.normalizeSpeechDialect(
      payload.speechDialect,
      provider,
      previewModel
    );
    timbre.speechInstruction = this.normalizeSpeechInstruction(
      payload.speechInstruction
    );
    timbre.previewText = this.normalizePreviewText(payload.previewText);
    timbre.previewModel = previewModel;
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

  async bindDoubaoVoiceSlotAgent(
    timbreId: string,
    agentId: string
  ): Promise<BindAdminDoubaoVoiceSlotResultDTO> {
    const timbre = await this.getVoiceTimbreById(timbreId);
    if (
      timbre.provider !== VoiceTimbreProvider.doubao ||
      timbre.status !== VoiceTimbreStatus.active ||
      !this.isDoubaoSpeakerId(timbre.providerVoiceId)
    ) {
      throw new AppError(
        'DOUBAO_SLOT_NOT_READY_FOR_BINDING',
        'Doubao voice slot must finish training before binding an agent',
        409
      );
    }

    const agentObjectId = this.parseAgentObjectId(agentId);
    const agent =
      (await this.agentModel.findOne({ where: { id: agentObjectId } })) ??
      (await this.agentModel.findOne({
        where: { _id: agentObjectId } as never,
      }));
    if (!agent) {
      throw new AppError('AGENT_NOT_FOUND', 'agent not found', 404);
    }

    agent.voiceTimbreId = timbre.id;
    agent.pendingVoiceTimbreId = undefined;
    agent.voiceTimbreSelectedAt = new Date();
    agent.updatedAt = new Date();
    const savedAgent = await this.agentModel.save(agent);

    return {
      agentId: this.stringifyObjectId(savedAgent.id),
      agentName: savedAgent.name?.trim() || '未命名智能体',
      timbreId: this.stringifyObjectId(timbre.id),
      speakerId: timbre.providerVoiceId,
    };
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
    const previousPreviewSignature = this.buildProviderPreviewSignature(timbre);

    if (payload.name !== undefined) {
      timbre.name = this.normalizeName(payload.name);
      changed = true;
    }

    if (payload.status !== undefined) {
      timbre.status = this.normalizeEditableStatus(payload.status);
      changed = true;
    }

    if (payload.previewText !== undefined) {
      const previewText = this.normalizePreviewText(payload.previewText);
      shouldRetrain ||=
        previewText !== this.normalizePreviewText(timbre.previewText);
      timbre.previewText = previewText;
      changed = true;
    }

    if (payload.speechDialect !== undefined) {
      const speechDialect = this.normalizeSpeechDialect(
        payload.speechDialect,
        timbre.provider,
        timbre.previewModel
      );
      timbre.speechDialect = speechDialect;
      changed = true;
    }

    if (payload.speechInstruction !== undefined) {
      timbre.speechInstruction = this.normalizeSpeechInstruction(
        payload.speechInstruction
      );
      changed = true;
    }

    if (payload.speechSpeed !== undefined) {
      const speechSpeed = this.normalizeSpeechSpeed(payload.speechSpeed);
      timbre.speechSpeed = speechSpeed;
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
      const shouldRefreshProviderPreview =
        previousPreviewSignature !== this.buildProviderPreviewSignature(timbre);

      if (shouldRetrain && timbre.status !== VoiceTimbreStatus.disabled) {
        this.prepareTimbreRetrain(timbre);
      }

      if (
        shouldRefreshProviderPreview &&
        !shouldRetrain &&
        timbre.status === VoiceTimbreStatus.active &&
        this.supportsTimbreSpeechInstruction(timbre) &&
        timbre.providerVoiceId?.trim()
      ) {
        timbre.previewAudioUrl = await this.createProviderPreviewAudio(
          timbre,
          timbre.providerVoiceId,
          this.normalizePreviewText(timbre.previewText)
        );
      }

      timbre.updatedAt = new Date();
      const saved = await this.voiceTimbreModel.save(timbre);

      if (saved.status === VoiceTimbreStatus.creating) {
        await this.enqueueCreateVoiceTimbreJob(saved);
      }
    }

    return this.buildRecord(timbre);
  }

  async deleteVoiceTimbre(
    timbreId: string
  ): Promise<DeleteAdminVoiceTimbreResultDTO> {
    const timbre = await this.getVoiceTimbreById(timbreId);

    if (timbre.deletionStatus === 'completed') {
      return {
        id: timbreId,
        deletionStatus: 'completed',
        message: '音色已删除',
      };
    }

    const boundAgentCount = await this.countAgentBindings(timbre.id);
    if (boundAgentCount > 0) {
      throw new AppError(
        'VOICE_TIMBRE_DELETE_BOUND',
        `该音色已绑定 ${boundAgentCount} 个智能体，请先解除绑定后再删除`,
        409,
        { boundAgentCount }
      );
    }

    const previousStatus = timbre.status;
    const now = new Date();
    timbre.status = VoiceTimbreStatus.disabled;
    timbre.deletionStatus = 'pending';
    timbre.deletionRequestedAt ??= now;
    timbre.deletionFailureReason = '';
    timbre.updatedAt = now;
    await this.voiceTimbreModel.save(timbre);

    const lateBoundAgentCount = await this.countAgentBindings(timbre.id);
    if (lateBoundAgentCount > 0) {
      timbre.status = previousStatus;
      timbre.deletionStatus = undefined;
      timbre.deletionRequestedAt = undefined;
      timbre.updatedAt = new Date();
      await this.voiceTimbreModel.save(timbre);

      throw new AppError(
        'VOICE_TIMBRE_DELETE_BOUND',
        `该音色已绑定 ${lateBoundAgentCount} 个智能体，请先解除绑定后再删除`,
        409,
        { boundAgentCount: lateBoundAgentCount }
      );
    }

    const failures: string[] = [];
    const deletedObjectKeys = new Set<string>();

    await this.deleteProviderVoice(
      timbre,
      failures,
      previousStatus === VoiceTimbreStatus.creating
    );
    await this.deleteTimbreObjects(timbre, failures, deletedObjectKeys);

    if (failures.length === 0) {
      timbre.audioObjectKey = '';
      timbre.audioUrl = '';
      timbre.previewAudioObjectKey = undefined;
      timbre.previewAudioUrl = undefined;
      timbre.generatedAudios = [];
      timbre.providerFileId = undefined;
      if (
        timbre.provider === VoiceTimbreProvider.doubao &&
        this.isDoubaoSpeakerId(timbre.providerVoiceId)
      ) {
        timbre.retainedProviderVoiceId = timbre.providerVoiceId;
      }
      timbre.providerVoiceId = `deleted_${this.stringifyObjectId(timbre.id)}`;
      timbre.deletionStatus = 'completed';
      timbre.deletedAt = new Date();
      timbre.deletionFailureReason = '';
    } else {
      if (deletedObjectKeys.has(timbre.audioObjectKey)) {
        timbre.audioObjectKey = '';
        timbre.audioUrl = '';
      }
      const previewObjectKey = this.resolveTimbreObjectKey(
        timbre.previewAudioObjectKey || timbre.previewAudioUrl
      );
      if (previewObjectKey && deletedObjectKeys.has(previewObjectKey)) {
        timbre.previewAudioObjectKey = undefined;
        timbre.previewAudioUrl = undefined;
      }
      timbre.generatedAudios = (timbre.generatedAudios ?? []).filter(
        item => !deletedObjectKeys.has(item.objectKey)
      );
      timbre.deletionStatus = 'partial_failed';
      timbre.deletionFailureReason = failures.join('；').slice(0, 1000);
    }

    timbre.updatedAt = new Date();
    await this.voiceTimbreModel.save(timbre);

    return {
      id: timbreId,
      deletionStatus:
        timbre.deletionStatus === 'completed' ? 'completed' : 'partial_failed',
      message:
        timbre.deletionStatus === 'completed'
          ? '音色已删除'
          : '音色仍有部分数据删除失败，请重试',
    };
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

    if (
      timbre.provider !== VoiceTimbreProvider.cosyvoice &&
      timbre.provider !== VoiceTimbreProvider.doubao
    ) {
      throw new AppError(
        'VOICE_TIMBRE_PROVIDER_VALIDATE_UNSUPPORTED',
        'only CosyVoice and Doubao timbres support provider validation now',
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

    if (timbre.provider === VoiceTimbreProvider.doubao) {
      const result = await this.doubaoVoiceService.queryVoice(providerVoiceId);
      this.syncDoubaoProviderStatus(timbre, result.statusCode);
      const saved = await this.voiceTimbreModel.save(timbre);

      return {
        provider: saved.provider as VoiceTimbreProviderDTO,
        providerVoiceId: saved.providerVoiceId ?? providerVoiceId,
        providerStatus: result.status,
        targetModel: saved.previewModel,
        resourceLink: result.demoAudio,
        requestId: result.requestId,
        record: this.buildRecord(saved),
      };
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

    if (timbre.provider === VoiceTimbreProvider.doubao) {
      await this.createDoubaoProviderVoice(timbre, audio, previewText);
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
        timbre.previewModel || this.qwenVoiceService.getDefaultPreviewModel(),
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

  private async createDoubaoProviderVoice(
    timbre: VoiceTimbreEntity,
    audio: {
      buffer: Buffer;
      fileName: string;
      contentType: string;
    },
    previewText: string
  ): Promise<void> {
    const cloneAudio = await this.ffmpegService.extractAudioToWav({
      buffer: audio.buffer,
      fileName: audio.fileName,
    });
    this.validateCloneAudioFile(
      cloneAudio.buffer,
      cloneAudio.fileName,
      cloneAudio.contentType
    );

    const cloneResult = await this.doubaoVoiceService.cloneVoice({
      buffer: cloneAudio.buffer,
      fileName: cloneAudio.fileName,
      speakerId: timbre.providerVoiceId,
    });
    timbre.previewModel = cloneResult.targetModel;
    const previewAudioUrl = await this.createDoubaoPreviewAudio(
      timbre,
      cloneResult.providerVoiceId,
      previewText
    );

    await this.markProviderVoiceActive(timbre, {
      providerFileId:
        cloneResult.requestId ||
        (cloneResult.version === undefined ? '' : String(cloneResult.version)),
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
      ...(timbre.speechInstruction?.trim()
        ? { instruction: timbre.speechInstruction.trim() }
        : {}),
      dialect: timbre.speechDialect,
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
        timbre.previewModel || this.qwenVoiceService.getDefaultPreviewModel(),
      language: timbre.cloneLanguage,
      ...(timbre.speechInstruction?.trim()
        ? { instruction: timbre.speechInstruction.trim() }
        : {}),
      dialect: timbre.speechDialect,
      speed: timbre.speechSpeed,
    });

    if (!previewAudio.audioBuffer.length && previewAudio.audioUrl) {
      return previewAudio.audioUrl;
    }

    const speechVolume = Math.min(
      2,
      Math.max(0.25, this.normalizeSpeechVolume(timbre.speechVolume))
    );
    const speechPitch = this.normalizeSpeechPitch(timbre.speechPitch);
    const adjustedPreview =
      this.isQwenAudioModel(timbre.previewModel) &&
      (speechVolume !== 1 || speechPitch !== 0)
        ? await this.ffmpegService.adjustSpeechOutput({
            buffer: previewAudio.audioBuffer,
            speechVolume,
            speechPitch,
          })
        : undefined;
    const audioBuffer = adjustedPreview?.buffer || previewAudio.audioBuffer;
    const mimeType = adjustedPreview?.contentType || previewAudio.mimeType;

    const previewFile = await this.storageService.uploadCosBuffer({
      buffer: audioBuffer,
      fileName: this.buildPreviewAudioFileName(mimeType),
      folder: 'voice-timbre-previews',
      contentType: mimeType,
    });

    return previewFile.publicUrl;
  }

  private async createDoubaoPreviewAudio(
    timbre: VoiceTimbreEntity,
    voiceId: string,
    previewText: string
  ): Promise<string> {
    const previewAudio = await this.doubaoVoiceService.synthesizePreview({
      text: previewText,
      voiceId,
      model:
        timbre.previewModel || this.doubaoVoiceService.getDefaultPreviewModel(),
      ...(timbre.speechInstruction?.trim()
        ? { instruction: timbre.speechInstruction.trim() }
        : {}),
      dialect: timbre.speechDialect,
      speed: timbre.speechSpeed,
      volume: timbre.speechVolume,
    });

    const speechPitch = this.normalizeSpeechPitch(timbre.speechPitch);
    const adjustedPreview =
      speechPitch !== 0
        ? await this.ffmpegService.adjustSpeechOutput({
            buffer: previewAudio.audioBuffer,
            speechVolume: 1,
            speechPitch,
          })
        : undefined;
    const audioBuffer = adjustedPreview?.buffer || previewAudio.audioBuffer;
    const mimeType = adjustedPreview?.contentType || previewAudio.mimeType;
    const previewFile = await this.storageService.uploadCosBuffer({
      buffer: audioBuffer,
      fileName: this.buildPreviewAudioFileName(mimeType),
      folder: 'voice-timbre-previews',
      contentType: mimeType,
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

    if (timbre.provider === VoiceTimbreProvider.doubao) {
      return this.createDoubaoPreviewAudio(timbre, voiceId, previewText);
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
    const current = await this.getVoiceTimbreById(
      this.stringifyObjectId(timbre.id)
    );

    if (
      current.deletionStatus === 'pending' ||
      current.deletionStatus === 'completed' ||
      current.status === VoiceTimbreStatus.disabled
    ) {
      const failures: string[] = [];
      const deletedObjectKeys = new Set<string>();
      current.providerFileId = input.providerFileId;
      current.providerVoiceId = input.providerVoiceId;
      current.previewAudioUrl = input.previewAudioUrl;
      current.providerDeletedAt = undefined;
      await this.deleteProviderVoice(current, failures, false);
      await this.deleteTimbreObjects(current, failures, deletedObjectKeys);
      current.status = VoiceTimbreStatus.disabled;
      if (
        current.provider === VoiceTimbreProvider.doubao &&
        this.isDoubaoSpeakerId(current.providerVoiceId)
      ) {
        current.retainedProviderVoiceId = current.providerVoiceId;
      }
      current.providerVoiceId = `deleted_${this.stringifyObjectId(current.id)}`;
      current.providerFileId = undefined;
      current.previewAudioObjectKey = undefined;
      current.previewAudioUrl = undefined;
      current.deletionStatus =
        failures.length === 0 ? 'completed' : 'partial_failed';
      current.deletedAt =
        failures.length === 0 ? new Date() : current.deletedAt;
      current.deletionFailureReason = failures.join('；').slice(0, 1000);
      current.updatedAt = new Date();
      await this.voiceTimbreModel.save(current);
      return;
    }

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
    const providerVoiceId = timbre.providerVoiceId;
    timbre.status = VoiceTimbreStatus.creating;
    timbre.errorCode = '';
    timbre.errorMessage = '';
    timbre.providerFileId = '';
    timbre.providerVoiceId =
      timbre.provider === VoiceTimbreProvider.doubao
        ? this.normalizeDoubaoSpeakerId(providerVoiceId)
        : this.generateInitialProviderVoiceId(
            timbre.provider,
            timbre.previewModel
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
    const current = await this.getVoiceTimbreById(
      this.stringifyObjectId(timbre.id)
    );
    if (
      current.deletionStatus === 'pending' ||
      current.deletionStatus === 'completed' ||
      current.status === VoiceTimbreStatus.disabled
    ) {
      return;
    }

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

  private syncDoubaoProviderStatus(
    timbre: VoiceTimbreEntity,
    providerStatusCode: number
  ): void {
    if (providerStatusCode === 2 || providerStatusCode === 4) {
      timbre.status = VoiceTimbreStatus.active;
      timbre.errorCode = '';
      timbre.errorMessage = '';
    } else if (providerStatusCode === 1) {
      timbre.status = VoiceTimbreStatus.creating;
      timbre.errorCode = 'DOUBAO_VOICE_TRAINING';
      timbre.errorMessage = '豆包 Seed ICL 2.0 音色仍在训练';
    } else {
      timbre.status = VoiceTimbreStatus.failed;
      timbre.errorCode = `DOUBAO_VOICE_STATUS_${providerStatusCode}`;
      timbre.errorMessage = `豆包音色不可用：${providerStatusCode}`;
    }
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
        'DOUBAO_VOICE_DISABLED',
        'DOUBAO_VOICE_APP_ID_MISSING',
        'DOUBAO_VOICE_CREDENTIAL_MISSING',
        'DOUBAO_VOICE_AUDIO_MISSING',
        'DOUBAO_SPEAKER_ID_REQUIRED',
        'INVALID_DOUBAO_SPEAKER_ID',
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
      [
        VoiceTimbreProvider.cosyvoice,
        VoiceTimbreProvider.qwen,
        VoiceTimbreProvider.doubao,
      ].includes(timbre.provider) &&
        timbre.status === VoiceTimbreStatus.active &&
        timbre.providerVoiceId?.trim() &&
        !timbre.previewAudioUrl?.trim()
    );
  }

  private buildDoubaoSlotRecord(
    slotNumber: number,
    slot: DoubaoVoiceSlot,
    boundTimbre?: VoiceTimbreEntity,
    boundAgents: Array<{
      id: string;
      name: string;
      status: 'active' | 'pending';
    }> = []
  ): AdminDoubaoVoiceSlotDTO {
    const now = Date.now();
    const expiredByTime = Boolean(slot.expireTime && slot.expireTime <= now);
    let availabilityReason = '';

    if (boundTimbre) {
      availabilityReason = `已绑定音色“${boundTimbre.name}”`;
    } else if (slot.state === 'Expired' || expiredByTime) {
      availabilityReason = '槽位已到期，请先续费';
    } else if (slot.state === 'Reclaimed') {
      availabilityReason = '槽位已回收';
    } else if (slot.state === 'Training') {
      availabilityReason = '音色正在训练';
    } else if (slot.availableTrainingTimes === 0) {
      availabilityReason = '可训练次数已用完';
    }

    return {
      slotKey: `doubao-slot-${slot.speakerId}`,
      slotNumber,
      empty: slot.state === 'Unknown' && !boundTimbre,
      speakerId: slot.speakerId,
      instanceNo: slot.instanceNo,
      alias: slot.alias,
      state: slot.state,
      isActivable: slot.isActivable,
      demoAudio: slot.demoAudio,
      version: slot.version,
      createTime: this.toOptionalIsoDate(slot.createTime),
      orderTime: this.toOptionalIsoDate(slot.orderTime),
      expireTime: this.toOptionalIsoDate(slot.expireTime),
      availableTrainingTimes: slot.availableTrainingTimes,
      availableForTraining: !availabilityReason,
      availabilityReason:
        availabilityReason ||
        (slot.state === 'Active'
          ? `已有服务商音色，可重新训练后接入${brandName()}`
          : '空闲，可用于训练新音色'),
      ...(boundTimbre
        ? {
            boundTimbre: {
              id: this.stringifyObjectId(boundTimbre.id),
              name: boundTimbre.name,
              provider: boundTimbre.provider as VoiceTimbreProviderDTO,
              status: boundTimbre.status as VoiceTimbreStatusDTO,
              providerVoiceId: boundTimbre.providerVoiceId,
              previewAudioUrl: boundTimbre.previewAudioUrl ?? '',
              audioUrl: this.storageFileService.resolve(
                boundTimbre.audioObjectKey || boundTimbre.audioUrl
              ),
              previewText: boundTimbre.previewText ?? '',
              errorCode: boundTimbre.errorCode ?? '',
              errorMessage: boundTimbre.errorMessage ?? '',
              deletionStatus: boundTimbre.deletionStatus,
              deletionFailureReason:
                boundTimbre.deletionFailureReason || undefined,
              boundAgentCount: boundAgents.length,
              canDelete: boundAgents.length === 0,
            },
          }
        : {}),
      ...(boundAgents.length ? { boundAgents } : {}),
    };
  }

  private buildAgentsByTimbreId(
    agents: AgentEntity[]
  ): Map<
    string,
    Array<{ id: string; name: string; status: 'active' | 'pending' }>
  > {
    const result = new Map<
      string,
      Array<{ id: string; name: string; status: 'active' | 'pending' }>
    >();

    for (const agent of agents) {
      const activeId = this.stringifyObjectId(agent.voiceTimbreId);
      const pendingId = this.stringifyObjectId(agent.pendingVoiceTimbreId);
      const timbreId = pendingId || activeId;
      if (!timbreId) continue;
      const current = result.get(timbreId) || [];
      current.push({
        id: this.stringifyObjectId(agent.id),
        name: agent.name?.trim() || '未命名智能体',
        status: pendingId ? 'pending' : 'active',
      });
      result.set(timbreId, current);
    }

    return result;
  }

  private toOptionalIsoDate(value?: number): string | undefined {
    if (!value || !Number.isFinite(value)) return undefined;
    return new Date(value).toISOString();
  }

  private buildSearchWhere(query: ListAdminVoiceTimbresQueryDTO): MongoWhere {
    const where: MongoWhere = {
      deletionStatus: { $ne: 'completed' },
    };
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

  private async buildRecords(
    timbres: VoiceTimbreEntity[]
  ): Promise<AdminVoiceTimbreRecordDTO[]> {
    if (!timbres.length) {
      return [];
    }

    const timbreIds = timbres.map(timbre => timbre.id);
    const agents = await this.agentModel.find({
      where: {
        $or: [
          { voiceTimbreId: { $in: timbreIds } },
          { pendingVoiceTimbreId: { $in: timbreIds } },
        ],
      } as never,
    });
    const bindingCounts = new Map<string, number>();

    for (const agent of agents) {
      const boundTimbreIds = new Set(
        [agent.voiceTimbreId, agent.pendingVoiceTimbreId]
          .filter(Boolean)
          .map(value => this.stringifyObjectId(value as MongoObjectId))
      );
      for (const id of boundTimbreIds) {
        bindingCounts.set(id, (bindingCounts.get(id) || 0) + 1);
      }
    }

    return timbres.map(timbre =>
      this.buildRecord(
        timbre,
        bindingCounts.get(this.stringifyObjectId(timbre.id)) || 0
      )
    );
  }

  private buildRecord(
    timbre: VoiceTimbreEntity,
    boundAgentCount = 0
  ): AdminVoiceTimbreRecordDTO {
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
      speechDialect: this.normalizeSpeechDialect(timbre.speechDialect),
      speechInstruction: timbre.speechInstruction?.trim() || '',
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
      boundAgentCount,
      canDelete: boundAgentCount === 0,
      deletionStatus: timbre.deletionStatus,
      deletionFailureReason: timbre.deletionFailureReason || undefined,
      createdAt: this.formatDate(timbre.createdAt),
      updatedAt: this.formatDate(timbre.updatedAt),
    };
  }

  private countAgentBindings(timbreId: MongoObjectId): Promise<number> {
    return this.agentModel.count({
      $or: [{ voiceTimbreId: timbreId }, { pendingVoiceTimbreId: timbreId }],
    });
  }

  private async deleteProviderVoice(
    timbre: VoiceTimbreEntity,
    failures: string[],
    wasCreating: boolean
  ): Promise<void> {
    if (timbre.providerDeletedAt) {
      return;
    }

    const providerVoiceId = timbre.providerVoiceId?.trim();
    if (
      !providerVoiceId ||
      providerVoiceId.startsWith('pending_') ||
      providerVoiceId.startsWith('deleted_') ||
      (wasCreating && !timbre.providerFileId)
    ) {
      timbre.providerDeletedAt = new Date();
      return;
    }

    try {
      if (timbre.provider === VoiceTimbreProvider.minimax) {
        await this.minimaxVoiceService.deleteVoice(providerVoiceId);
      } else if (timbre.provider === VoiceTimbreProvider.cosyvoice) {
        await this.cosyVoiceVoiceService.deleteVoice(providerVoiceId);
      } else if (timbre.provider === VoiceTimbreProvider.qwen) {
        await this.qwenVoiceService.deleteVoice(
          providerVoiceId,
          timbre.previewModel
        );
      } else if (timbre.provider === VoiceTimbreProvider.doubao) {
        await this.doubaoVoiceService.releaseVoice(providerVoiceId);
      } else {
        throw new AppError(
          'VOICE_TIMBRE_PROVIDER_DELETE_UNSUPPORTED',
          `voice provider ${timbre.provider} does not support deletion`,
          400
        );
      }
      timbre.providerDeletedAt = new Date();
    } catch (error) {
      if (this.isAlreadyDeletedProviderError(error)) {
        timbre.providerDeletedAt = new Date();
        return;
      }

      failures.push(
        `服务商音色删除失败：${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  private async deleteTimbreObjects(
    timbre: VoiceTimbreEntity,
    failures: string[],
    deletedObjectKeys: Set<string>
  ): Promise<void> {
    const objectKeys = new Set(
      [
        timbre.audioObjectKey,
        timbre.audioUrl,
        timbre.previewAudioObjectKey,
        timbre.previewAudioUrl,
        ...(timbre.generatedAudios ?? []).map(item => item.objectKey),
      ]
        .map(value => this.resolveTimbreObjectKey(value))
        .filter((value): value is string => Boolean(value))
    );

    for (const objectKey of objectKeys) {
      try {
        await this.storageService.deleteCosObject(objectKey);
        deletedObjectKeys.add(objectKey);
      } catch (error) {
        failures.push(
          `声音文件删除失败：${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
  }

  private resolveTimbreObjectKey(value?: string): string | undefined {
    const objectKey = this.storageFileService
      .normalizeForStorage(value)
      ?.trim()
      .replace(/^\/+/, '');
    const allowedPrefixes = [
      'voice-timbres/',
      'voice-training-ready/',
      'voice-timbre-previews/',
      'voice-timbre-generated/',
    ];

    return objectKey &&
      !objectKey.includes('..') &&
      allowedPrefixes.some(prefix => objectKey.startsWith(prefix))
      ? objectKey
      : undefined;
  }

  private isAlreadyDeletedProviderError(error: unknown): boolean {
    const code = String((error as { code?: string })?.code || '').toLowerCase();
    const message =
      error instanceof Error ? error.message.toLowerCase() : String(error);

    return (
      /not[_ -]?found|not[_ -]?exist|already[_ -]?deleted/.test(code) ||
      /not found|not exist|does not exist|already deleted|不存在|已删除/.test(
        message
      )
    );
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

  private async assertDoubaoSlotTrainable(
    provider: VoiceTimbreProvider,
    providerVoiceId: string
  ): Promise<void> {
    if (provider !== VoiceTimbreProvider.doubao) {
      return;
    }

    const timbres = await this.voiceTimbreModel.find({
      where: { provider: VoiceTimbreProvider.doubao } as never,
      order: { updatedAt: 'DESC' },
    });
    const { items } = await this.doubaoVoiceService.listSlots(
      this.collectDoubaoSpeakerIds(timbres)
    );

    const slot = items.find(item => item.speakerId === providerVoiceId);

    if (!slot) {
      throw new AppError(
        'DOUBAO_SLOT_NOT_FOUND',
        'Doubao speaker id is not present in the purchased slot list',
        400
      );
    }

    const isExpired = Boolean(slot.expireTime && slot.expireTime <= Date.now());
    const isUnavailableState = ['Training', 'Expired', 'Reclaimed'].includes(
      slot.state
    );

    if (isExpired || isUnavailableState || slot.availableTrainingTimes === 0) {
      throw new AppError(
        'DOUBAO_SLOT_NOT_TRAINABLE',
        'Doubao slot is not available for a new training job',
        400,
        {
          state: slot.state,
          expireTime: slot.expireTime,
          availableTrainingTimes: slot.availableTrainingTimes,
        }
      );
    }
  }

  private assertCreatableProvider(provider: VoiceTimbreProvider): void {
    if (
      provider === VoiceTimbreProvider.minimax ||
      provider === VoiceTimbreProvider.cosyvoice ||
      provider === VoiceTimbreProvider.qwen ||
      provider === VoiceTimbreProvider.doubao
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
    value?: string,
    model?: string
  ): string {
    const rawValue = value?.trim();

    if (provider === VoiceTimbreProvider.cosyvoice) {
      return this.normalizeCosyVoicePrefix(
        rawValue || this.generateCosyVoicePrefix()
      );
    }

    if (provider === VoiceTimbreProvider.qwen) {
      return this.normalizeQwenPreferredName(
        rawValue ||
          this.generateQwenPreferredName(this.isQwenAudioModel(model)),
        this.isQwenAudioModel(model)
      );
    }

    if (provider === VoiceTimbreProvider.doubao) {
      if (!rawValue) {
        throw new AppError(
          'DOUBAO_SLOT_SPEAKER_ID_REQUIRED',
          'Doubao voice creation requires a fixed purchased Speaker ID',
          400
        );
      }
      return this.normalizeDoubaoSpeakerId(rawValue);
    }

    return this.normalizeMinimaxProviderVoiceId(
      rawValue || this.generateMinimaxProviderVoiceId()
    );
  }

  private generateInitialProviderVoiceId(
    provider: VoiceTimbreProvider,
    model?: string
  ): string {
    if (provider === VoiceTimbreProvider.cosyvoice) {
      return this.generateCosyVoicePrefix();
    }

    if (provider === VoiceTimbreProvider.qwen) {
      return this.generateQwenPreferredName(this.isQwenAudioModel(model));
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

  private normalizeQwenPreferredName(value: string, qwenAudio = false): string {
    const preferredName = value.trim();

    const pattern = qwenAudio ? /^[A-Za-z0-9]{1,10}$/ : /^[A-Za-z0-9_]{1,16}$/;
    if (!pattern.test(preferredName)) {
      throw new AppError(
        'INVALID_QWEN_PREFERRED_NAME',
        qwenAudio
          ? 'Qwen Audio prefix must be 1-10 letters or digits'
          : 'Qwen preferred name must be 1-16 letters, digits or _',
        400
      );
    }

    return preferredName;
  }

  private normalizeDoubaoSpeakerId(value: string): string {
    const speakerId = value.trim();
    if (!/^S_[A-Za-z0-9_-]{4,128}$/.test(speakerId)) {
      throw new AppError(
        'INVALID_DOUBAO_SPEAKER_ID',
        'Doubao speaker id must start with S_ and come from a purchased slot',
        400
      );
    }
    return speakerId;
  }

  private isDoubaoSpeakerId(value?: string): value is string {
    return /^S_[A-Za-z0-9_-]{4,128}$/.test(value?.trim() || '');
  }

  private collectDoubaoSpeakerIds(timbres: VoiceTimbreEntity[]): string[] {
    const values: string[] = [];
    for (const timbre of timbres) {
      if (this.isDoubaoSpeakerId(timbre.providerVoiceId)) {
        values.push(timbre.providerVoiceId);
      }
      if (this.isDoubaoSpeakerId(timbre.retainedProviderVoiceId)) {
        values.push(timbre.retainedProviderVoiceId);
      }
    }
    return [...new Set(values)];
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

  private generateQwenPreferredName(qwenAudio = false): string {
    if (!qwenAudio) {
      const timestamp = Date.now().toString(36).slice(-7);
      const random = Math.random().toString(36).slice(2, 5);
      return `tzl_${timestamp}${random}`;
    }

    const timestamp = Date.now().toString(36).slice(-5);
    const random = Math.random().toString(36).slice(2, 4);
    return `tzl${timestamp}${random}`;
  }

  private isQwenAudioModel(model?: string): boolean {
    return /^qwen-audio-/i.test(model?.trim() || '');
  }

  private defaultCloneLanguage(provider: VoiceTimbreProvider): string {
    return provider === VoiceTimbreProvider.minimax ? 'Chinese' : 'zh';
  }

  private normalizeSpeechDialect(
    value?: string,
    provider?: VoiceTimbreProvider,
    model?: string
  ): VoiceTimbreDialectDTO {
    const normalized = value?.trim().toLowerCase() || 'auto';
    const options =
      provider === VoiceTimbreProvider.qwen && this.isQwenAudioModel(model)
        ? QWEN_AUDIO_DIALECT_OPTIONS
        : provider === VoiceTimbreProvider.cosyvoice &&
          this.isCosyVoiceV35PlusModel(model)
        ? COSYVOICE_V35_DIALECT_OPTIONS
        : VOICE_TIMBRE_DIALECT_OPTIONS;
    return options.find(option => option.value === normalized)?.value || 'auto';
  }

  private normalizeSpeechInstruction(value?: string): string {
    return this.normalizeOptionalText(value, 50);
  }

  private buildProviderPreviewSignature(timbre: VoiceTimbreEntity): string {
    let instruction = '';

    if (
      timbre.provider === VoiceTimbreProvider.qwen &&
      this.isQwenAudioModel(timbre.previewModel)
    ) {
      instruction =
        buildQwenAudioSpeechInstruction({
          instruction: timbre.speechInstruction,
          dialect: timbre.speechDialect,
          speechSpeed: timbre.speechSpeed,
        }) || '';
    } else if (
      timbre.provider === VoiceTimbreProvider.cosyvoice &&
      this.supportsTimbreSpeechInstruction(timbre)
    ) {
      instruction =
        buildCosyVoiceSpeechInstruction({
          instruction: timbre.speechInstruction,
          dialect: timbre.speechDialect,
        }) || '';
    } else if (timbre.provider === VoiceTimbreProvider.doubao) {
      instruction =
        buildDoubaoIcl2SpeechInstruction({
          instruction: timbre.speechInstruction,
          dialect: timbre.speechDialect,
        }) || '';
    }

    return [
      instruction,
      this.normalizeSpeechSpeed(timbre.speechSpeed),
      this.normalizeSpeechVolume(timbre.speechVolume),
      this.normalizeSpeechPitch(timbre.speechPitch),
    ].join('|');
  }

  private supportsTimbreSpeechInstruction(timbre: VoiceTimbreEntity): boolean {
    if (timbre.provider === VoiceTimbreProvider.qwen) {
      return this.isQwenAudioModel(timbre.previewModel);
    }

    if (timbre.provider === VoiceTimbreProvider.doubao) {
      return true;
    }

    if (timbre.provider !== VoiceTimbreProvider.cosyvoice) {
      return false;
    }

    const voiceId = timbre.providerVoiceId?.trim().toLowerCase() || '';
    if (voiceId.startsWith('cosyvoice-')) {
      return voiceId.startsWith('cosyvoice-v3.5-plus-');
    }

    return this.isCosyVoiceV35PlusModel(timbre.previewModel);
  }

  private isCosyVoiceV35PlusModel(model?: string): boolean {
    return /^cosyvoice-v3\.5-plus$/i.test(model?.trim() || '');
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

    if (provider === VoiceTimbreProvider.doubao) {
      return this.doubaoVoiceService.getDefaultPreviewModel();
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

  private parseAgentObjectId(value: string): MongoObjectId {
    if (!MongoObjectId.isValid(value?.trim())) {
      throw new AppError('INVALID_AGENT_ID', 'invalid agent id', 400);
    }

    return new MongoObjectId(value.trim());
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
