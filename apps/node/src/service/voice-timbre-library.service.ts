import { Inject, Logger, Provide } from '@midwayjs/core';
import type { ILogger } from '@midwayjs/logger';
import { RedisService } from '@midwayjs/redis';
import { InjectEntityModel } from '@midwayjs/typeorm';
import {
  AgentEntity,
  MongoObjectId,
  VoiceServiceClipReviewStatus,
  VoiceServiceEventType,
  type VoiceServiceReviewClipItem,
  VoiceServiceSessionEntity,
  VoiceTimbreEntity,
  VoiceTimbreProvider,
  VoiceTimbreStatus,
} from '@tzl/entities';
import type {
  AgentVoiceModelCenterDTO,
  DeleteUserVoiceTimbreResultDTO,
  GenerateUserVoiceTimbreSpeechDTO,
  SelectAgentVoiceTimbreDTO,
  UserVoiceTimbreLibraryDTO,
  UserVoiceTimbreDetailDTO,
  UserVoiceTimbreGeneratedAudioDTO,
  UserVoiceTimbreRecordDTO,
  UpdateUserVoiceTimbreDTO,
  VoiceTimbreDialectDTO,
  VoiceTimbreRetentionPolicyDTO,
} from '@tzl/shared';
import {
  VOICE_SERVICE_MAX_TRAINING_SECONDS,
  VOICE_TIMBRE_DIALECT_OPTIONS,
} from '@tzl/shared';
import { randomBytes } from 'crypto';
import { MongoRepository } from 'typeorm';
import { AppError } from '../common/errors';
import type { AuthenticatedUserPayload } from '../interface';
import { CosyVoiceSpeechService } from './cosyvoice-speech.service';
import { DoubaoVoiceSpeechService } from './doubao-voice-speech.service';
import { QwenVoiceEnrollmentService } from './qwen-voice-enrollment.service';
import { QwenVoiceSpeechService } from './qwen-voice-speech.service';
import { TencentCosService } from './tencent-cos.service';
import { VoiceFfmpegService } from './voice-ffmpeg.service';
import { VoiceServiceDataDeletionService } from './voice-service-data-deletion.service';
import {
  VoiceUsageAccessService,
  type VoiceUsageAccessDecision,
} from './voice-usage-access.service';

export const VOICE_TIMBRE_RETENTION_QUEUE = 'voice-timbre-retention';
export const VOICE_TIMBRE_RETENTION_JOB_ID = 'voice-timbre-retention-daily';
export const VOICE_TIMBRE_RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const VOICE_TIMBRE_CLEANUP_QUEUE = 'voice-timbre-cleanup';
export const VOICE_TIMBRE_CLEANUP_JOB_ID = 'voice-timbre-cleanup-daily';

const ONE_DAY_MS = VOICE_TIMBRE_RETENTION_INTERVAL_MS;
const PROVIDER_INACTIVE_CLEANUP_DAYS = 365;
const RETENTION_BEFORE_DAYS = 30;
const RETENTION_BATCH_SIZE = 25;
const UNUSED_CLEANUP_AFTER_DAYS = 7;
const UNUSED_CLEANUP_BATCH_SIZE = 25;
const RETENTION_PROBE_TEXT = '我在这里。';
const OFFICIAL_RULE_URL =
  'https://help.aliyun.com/zh/model-studio/voice-cloning-user-guide';
const POLICY_VERIFIED_AT = '2026-08-03T00:00:00.000Z';
const CUSTOM_SPEECH_TEXT_MAX_LENGTH = 100;
const CUSTOM_SPEECH_DAILY_LIMIT = 5;
const CUSTOM_SPEECH_LOCK_TTL_MS = 2 * 60 * 1000;

export interface VoiceTimbreRetentionJobResult {
  checkedCount: number;
  protectedCount: number;
  failedCount: number;
}

interface CustomSpeechGenerationReservation {
  lockKey: string;
  lockToken: string;
  usageKey: string;
  usedToday: number;
}

@Provide()
export class VoiceTimbreLibraryService {
  @Logger()
  logger: ILogger;

  @InjectEntityModel(VoiceTimbreEntity)
  voiceTimbreModel: MongoRepository<VoiceTimbreEntity>;

  @InjectEntityModel(VoiceServiceSessionEntity)
  voiceServiceSessionModel: MongoRepository<VoiceServiceSessionEntity>;

  @InjectEntityModel(AgentEntity)
  agentModel: MongoRepository<AgentEntity>;

  @Inject()
  voiceServiceDataDeletionService: VoiceServiceDataDeletionService;

  @Inject()
  qwenVoiceEnrollmentService: QwenVoiceEnrollmentService;

  @Inject()
  qwenVoiceSpeechService: QwenVoiceSpeechService;

  @Inject()
  cosyVoiceSpeechService: CosyVoiceSpeechService;

  @Inject()
  doubaoVoiceSpeechService: DoubaoVoiceSpeechService;

  @Inject()
  voiceFfmpegService: VoiceFfmpegService;

  @Inject()
  tencentCosService: TencentCosService;

  @Inject()
  redisService: RedisService;

  @Inject()
  voiceUsageAccessService: VoiceUsageAccessService;

  async getLibrary(
    auth: AuthenticatedUserPayload
  ): Promise<UserVoiceTimbreLibraryDTO> {
    const userId = this.parseObjectId(auth.sub, 'INVALID_TOKEN');
    const timbres = await this.findUserTimbres(userId);
    const agents = await this.agentModel.find({
      where: { createdUserId: userId },
    });

    return {
      items: timbres.map(timbre => this.buildRecord(timbre, agents)),
      retentionPolicy: this.buildRetentionPolicy(),
    };
  }

  async getDetail(
    auth: AuthenticatedUserPayload,
    timbreId: string
  ): Promise<UserVoiceTimbreDetailDTO> {
    const userId = this.parseObjectId(auth.sub, 'INVALID_TOKEN');
    const timbre = await this.findOwnedTimbre(userId, timbreId);
    const agents = await this.agentModel.find({
      where: { createdUserId: userId },
    });
    const session = await this.findSourceSession(timbre);
    if (session && !timbre.trainingClipIds?.length) {
      timbre.trainingClipIds = this.selectTrainingClips(session).map(
        clip => clip.id
      );
      timbre.updatedAt = new Date();
      await this.voiceTimbreModel.save(timbre);
    }

    const [generatedToday, access] = await Promise.all([
      this.getCustomSpeechGeneratedToday(userId),
      this.voiceUsageAccessService.resolve(userId),
    ]);
    return this.buildDetail(
      timbre,
      agents,
      session,
      generatedToday,
      access.eligible
    );
  }

  async getAgentVoiceModelCenter(
    auth: AuthenticatedUserPayload,
    agentId: string
  ): Promise<AgentVoiceModelCenterDTO> {
    const userId = this.parseObjectId(auth.sub, 'INVALID_TOKEN');
    const agent = await this.findOwnedAgent(userId, agentId);
    const [timbres, access] = await Promise.all([
      this.findUserTimbres(userId),
      this.voiceUsageAccessService.resolve(userId),
    ]);

    await this.reconcileAgentVoiceTimbreAccess(agent, timbres, access);
    const agents = await this.agentModel.find({
      where: { createdUserId: userId },
    });
    return this.buildAgentVoiceModelCenter(agent, timbres, agents, access);
  }

  async selectAgentVoiceTimbre(
    auth: AuthenticatedUserPayload,
    agentId: string,
    payload: SelectAgentVoiceTimbreDTO
  ): Promise<AgentVoiceModelCenterDTO> {
    const userId = this.parseObjectId(auth.sub, 'INVALID_TOKEN');
    const agent = await this.findOwnedAgent(userId, agentId);
    const timbre = await this.findOwnedTimbre(userId, payload?.timbreId);
    const access = await this.voiceUsageAccessService.resolve(userId);
    const previousTimbreId =
      this.idOf(agent.pendingVoiceTimbreId) || this.idOf(agent.voiceTimbreId);
    const nextTimbreId = this.idOf(timbre);

    if (
      previousTimbreId &&
      previousTimbreId !== nextTimbreId &&
      !payload?.replaceExisting
    ) {
      throw new AppError(
        'VOICE_TIMBRE_REPLACE_CONFIRM_REQUIRED',
        '这个天之灵已经在使用其他音色，请确认后再更换',
        409
      );
    }

    const now = new Date();
    if (access.eligible) {
      agent.voiceTimbreId = timbre.id;
      agent.pendingVoiceTimbreId = undefined;
    } else {
      agent.voiceTimbreId = null as never;
      agent.pendingVoiceTimbreId = timbre.id;
    }
    agent.voiceTimbreSelectedAt = now;
    agent.updatedAt = now;
    await this.agentModel.save(agent);
    await this.recordAgentVoiceTimbreSelection({
      agent,
      timbre,
      previousTimbreId,
      access,
      selectedAt: now,
    });

    const [timbres, agents] = await Promise.all([
      this.findUserTimbres(userId),
      this.agentModel.find({ where: { createdUserId: userId } }),
    ]);
    return this.buildAgentVoiceModelCenter(agent, timbres, agents, access);
  }

  async updateTimbre(
    auth: AuthenticatedUserPayload,
    timbreId: string,
    payload: UpdateUserVoiceTimbreDTO
  ): Promise<UserVoiceTimbreRecordDTO> {
    const userId = this.parseObjectId(auth.sub, 'INVALID_TOKEN');
    const timbre = await this.findOwnedTimbre(userId, timbreId);
    let changed = false;

    if (payload?.name !== undefined) {
      const normalizedName = String(payload.name || '')
        .trim()
        .slice(0, 20);
      if (!normalizedName) {
        throw new AppError(
          'VOICE_TIMBRE_NAME_REQUIRED',
          '音色名称不能为空',
          400
        );
      }
      timbre.name = normalizedName;
      changed = true;
    }
    if (payload?.speechSpeed !== undefined) {
      timbre.speechSpeed = this.numberInRange(
        payload.speechSpeed,
        1,
        0.5,
        2,
        'INVALID_VOICE_TIMBRE_SPEECH_SPEED'
      );
      changed = true;
    }
    if (payload?.speechVolume !== undefined) {
      timbre.speechVolume = this.numberInRange(
        payload.speechVolume,
        1,
        0.25,
        2,
        'INVALID_VOICE_TIMBRE_SPEECH_VOLUME'
      );
      changed = true;
    }
    if (payload?.speechDialect !== undefined) {
      timbre.speechDialect = this.normalizeSpeechDialect(
        payload.speechDialect,
        true
      );
      changed = true;
    }
    if (!changed) {
      throw new AppError(
        'VOICE_TIMBRE_UPDATE_REQUIRED',
        '请提交要修改的音色设置',
        400
      );
    }

    timbre.updatedAt = new Date();
    await this.voiceTimbreModel.save(timbre);
    const agents = await this.agentModel.find({
      where: { createdUserId: userId },
    });
    return this.buildRecord(timbre, agents);
  }

  async generateSpeech(
    auth: AuthenticatedUserPayload,
    timbreId: string,
    payload: GenerateUserVoiceTimbreSpeechDTO
  ): Promise<UserVoiceTimbreGeneratedAudioDTO> {
    const userId = this.parseObjectId(auth.sub, 'INVALID_TOKEN');
    const timbre = await this.findOwnedTimbre(userId, timbreId);
    const text = String(payload?.text || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) {
      throw new AppError(
        'VOICE_TIMBRE_SPEECH_TEXT_REQUIRED',
        '请输入要生成语音的文字',
        400
      );
    }
    if (Array.from(text).length > CUSTOM_SPEECH_TEXT_MAX_LENGTH) {
      throw new AppError(
        'VOICE_TIMBRE_SPEECH_TEXT_TOO_LONG',
        `每次最多输入 ${CUSTOM_SPEECH_TEXT_MAX_LENGTH} 个字`,
        400
      );
    }
    const isCosyVoiceV35Plus = this.isCosyVoiceV35PlusTimbre(timbre);
    const isDoubaoIcl2 = timbre.provider === VoiceTimbreProvider.doubao;
    if (
      timbre.provider !== VoiceTimbreProvider.qwen &&
      !isCosyVoiceV35Plus &&
      !isDoubaoIcl2
    ) {
      throw new AppError(
        'VOICE_TIMBRE_CUSTOM_SPEECH_UNSUPPORTED',
        '这个音色暂不支持自定义文字生成',
        400
      );
    }

    const reservation = await this.reserveCustomSpeechGeneration(userId);
    try {
      const synthesized = isCosyVoiceV35Plus
        ? await this.cosyVoiceSpeechService.synthesize({
            text,
            voiceId: timbre.providerVoiceId,
            model: timbre.previewModel,
            languageHint: timbre.cloneLanguage,
            speed: timbre.speechSpeed,
            volume: timbre.speechVolume,
            pitch: timbre.speechPitch,
            ...(timbre.speechInstruction?.trim()
              ? { instruction: timbre.speechInstruction.trim() }
              : {}),
            dialect: timbre.speechDialect,
          })
        : isDoubaoIcl2
        ? await this.doubaoVoiceSpeechService.synthesize({
            text,
            voiceId: timbre.providerVoiceId,
            model: timbre.previewModel,
            ...(timbre.speechInstruction?.trim()
              ? { instruction: timbre.speechInstruction.trim() }
              : {}),
            dialect: timbre.speechDialect,
            speed: timbre.speechSpeed,
            volume: timbre.speechVolume,
          })
        : await this.qwenVoiceSpeechService.synthesize({
            text,
            voiceId: timbre.providerVoiceId,
            model: timbre.previewModel,
            language: timbre.cloneLanguage,
            ...(timbre.speechInstruction?.trim()
              ? { instruction: timbre.speechInstruction.trim() }
              : {}),
            dialect: timbre.speechDialect,
            speed: timbre.speechSpeed,
          });
      await this.markUsed(timbre);
      const speed = this.normalizeSpeechSpeed(timbre.speechSpeed);
      const volume = this.normalizeSpeechVolume(timbre.speechVolume);
      const pitch = this.numberInRange(
        timbre.speechPitch,
        0,
        -12,
        12,
        'INVALID_VOICE_TIMBRE_SPEECH_PITCH'
      );
      const outputSpeed =
        isCosyVoiceV35Plus ||
        Boolean(
          (synthesized as { nativeSpeechSpeedApplied?: boolean })
            .nativeSpeechSpeedApplied
        )
          ? 1
          : speed;
      const outputVolume =
        isCosyVoiceV35Plus ||
        Boolean(
          (synthesized as { nativeSpeechVolumeApplied?: boolean })
            .nativeSpeechVolumeApplied
        )
          ? 1
          : volume;
      const outputPitch = isCosyVoiceV35Plus ? 0 : pitch;
      const adjusted =
        outputSpeed !== 1 || outputVolume !== 1 || outputPitch !== 0
          ? await this.voiceFfmpegService.adjustSpeechOutput({
              buffer: synthesized.audioBuffer,
              fileName: `speech.${this.extensionForMimeType(
                synthesized.mimeType
              )}`,
              speechSpeed: outputSpeed,
              speechVolume: outputVolume,
              speechPitch: outputPitch,
            })
          : undefined;
      const audioBuffer = adjusted?.buffer || synthesized.audioBuffer;
      const mimeType =
        adjusted?.contentType || synthesized.mimeType || 'audio/wav';
      const uploaded = await this.tencentCosService.putBuffer(audioBuffer, {
        folder: 'voice-timbre-generated',
        fileName: `custom.${this.extensionForMimeType(mimeType)}`,
        contentType: mimeType,
      });
      const createdAt = new Date();
      const generated = {
        id: `generated_${randomBytes(8).toString('hex')}`,
        text,
        objectKey: uploaded.objectKey,
        publicUrl: uploaded.url,
        speechSpeed: speed,
        speechVolume: volume,
        createdAt,
      };

      timbre.generatedAudios = [...(timbre.generatedAudios ?? []), generated];
      timbre.updatedAt = createdAt;
      try {
        await this.voiceTimbreModel.save(timbre);
      } catch (error) {
        try {
          await this.voiceServiceDataDeletionService.deleteRequiredObject(
            uploaded.objectKey
          );
        } catch (cleanupError) {
          this.logger.warn(
            '[voice-timbre] generated audio cleanup failed, objectKey=%s, reason=%s',
            uploaded.objectKey,
            cleanupError instanceof Error
              ? cleanupError.message
              : String(cleanupError)
          );
        }
        throw error;
      }

      return {
        ...this.buildGeneratedAudio(generated),
        remainingToday: Math.max(
          CUSTOM_SPEECH_DAILY_LIMIT - reservation.usedToday,
          0
        ),
      };
    } catch (error) {
      await this.rollbackCustomSpeechGeneration(reservation);
      throw error;
    } finally {
      await this.releaseCustomSpeechGenerationLock(reservation);
    }
  }

  async deleteTimbre(
    auth: AuthenticatedUserPayload,
    timbreId: string
  ): Promise<DeleteUserVoiceTimbreResultDTO> {
    const userId = this.parseObjectId(auth.sub, 'INVALID_TOKEN');
    const timbre = await this.findOwnedTimbre(userId, timbreId, true);
    if (timbre.deletionStatus === 'completed') {
      return {
        id: this.idOf(timbre),
        deletionStatus: 'completed',
        message: '这个音色已经永久删除',
      };
    }

    const result =
      await this.voiceServiceDataDeletionService.deleteSingleTimbreArtifacts(
        timbre
      );
    await this.clearSessionReferences(timbre);
    const completed = result.failures.length === 0;

    return {
      id: this.idOf(timbre),
      deletionStatus: completed ? 'completed' : 'partial_failed',
      message: completed
        ? '音色、训练音频、试听音频和生成语音已经永久删除'
        : '部分数据暂时没有删除成功，请稍后重试',
    };
  }

  async markUsed(
    timbre: VoiceTimbreEntity,
    usedAt = new Date()
  ): Promise<void> {
    timbre.providerLastUsedAt = usedAt;
    timbre.providerEstimatedCleanupAt = this.addOneYear(usedAt);
    timbre.retentionStatus = 'protected';
    timbre.retentionLastSucceededAt = usedAt;
    timbre.retentionFailureCode = '';
    timbre.retentionFailureReason = '';
    timbre.updatedAt = usedAt;
    await this.voiceTimbreModel.save(timbre);
  }

  async processUnusedCleanup(): Promise<VoiceTimbreRetentionJobResult> {
    const now = new Date();
    const cutoff = new Date(
      now.getTime() - UNUSED_CLEANUP_AFTER_DAYS * ONE_DAY_MS
    );

    // 找到所有活跃的 Qwen 用户音色，创建时间超过 7 天
    const candidates = (
      await this.voiceTimbreModel.find({
        where: {
          provider: VoiceTimbreProvider.qwen,
          status: VoiceTimbreStatus.active,
        },
      })
    )
      .filter(timbre => this.isUserTimbre(timbre))
      .filter(timbre => timbre.deletionStatus !== 'completed')
      .filter(timbre => {
        const created = this.dateOf(timbre.createdAt);
        return created.getTime() <= cutoff.getTime();
      })
      .slice(0, UNUSED_CLEANUP_BATCH_SIZE);

    if (candidates.length === 0) {
      this.logger.info('[voice-timbre-cleanup] no candidates to check');
      return { checkedCount: 0, protectedCount: 0, failedCount: 0 };
    }

    // 预先查出所有引用了这些音色的智能体
    const timbreIds = candidates.map(t => this.idOf(t));
    const timbreObjectIds = timbreIds.map(id =>
      this.parseObjectId(id, 'VOICE_TIMBRE_CLEANUP')
    );
    const referencingAgents = await this.agentModel.find({
      $or: [
        { voiceTimbreId: { $in: timbreObjectIds } },
        { pendingVoiceTimbreId: { $in: timbreObjectIds } },
      ],
    } as never);
    const referencedTimbreIds = new Set<string>();
    for (const agent of referencingAgents) {
      if (agent.voiceTimbreId)
        referencedTimbreIds.add(this.idOf(agent.voiceTimbreId));
      if (agent.pendingVoiceTimbreId)
        referencedTimbreIds.add(this.idOf(agent.pendingVoiceTimbreId));
    }

    let deletedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    for (const timbre of candidates) {
      const tid = this.idOf(timbre);

      // 如果有智能体关联，跳过
      if (referencedTimbreIds.has(tid)) {
        skippedCount += 1;
        continue;
      }

      // 从 Qwen 提供商删除
      try {
        if (
          timbre.providerVoiceId &&
          !timbre.providerVoiceId.startsWith('pending_')
        ) {
          await this.qwenVoiceEnrollmentService.deleteVoice(
            timbre.providerVoiceId,
            timbre.previewModel
          );
          this.logger.info(
            '[voice-timbre-cleanup] deleted from provider, timbreId=%s, providerVoiceId=%s',
            tid,
            timbre.providerVoiceId
          );
        }
      } catch (error) {
        this.logger.warn(
          '[voice-timbre-cleanup] provider delete failed, timbreId=%s, reason=%s',
          tid,
          error instanceof Error ? error.message : String(error)
        );
        // 即使提供商删除失败，也继续标记为已清理（可能已被阿里那边回收了）
      }

      // 标记为 disabled
      timbre.status = VoiceTimbreStatus.disabled;
      timbre.errorCode = 'VOICE_TIMBRE_UNUSED_CLEANUP';
      timbre.errorMessage = '音色超过 7 天未关联天之灵，已自动清理';
      timbre.retentionStatus = 'attention_required';
      timbre.updatedAt = now;
      try {
        await this.voiceTimbreModel.save(timbre);
        deletedCount += 1;
      } catch (error) {
        this.logger.error(
          '[voice-timbre-cleanup] save failed, timbreId=%s, reason=%s',
          tid,
          error instanceof Error ? error.message : String(error)
        );
        failedCount += 1;
      }
    }

    this.logger.info(
      '[voice-timbre-cleanup] completed, candidates=%s, deleted=%s, skipped=%s, failed=%s',
      candidates.length,
      deletedCount,
      skippedCount,
      failedCount
    );

    return {
      checkedCount: candidates.length,
      protectedCount: skippedCount,
      failedCount,
    };
  }

  async processRetentionMaintenance(): Promise<VoiceTimbreRetentionJobResult> {
    const now = new Date();
    const dueBefore = new Date(
      now.getTime() + RETENTION_BEFORE_DAYS * ONE_DAY_MS
    );
    const candidates = (
      await this.voiceTimbreModel.find({
        where: {
          provider: VoiceTimbreProvider.qwen,
          status: VoiceTimbreStatus.active,
        },
      })
    )
      .filter(timbre => this.isUserTimbre(timbre))
      .filter(timbre => timbre.deletionStatus !== 'completed')
      .filter(
        timbre =>
          this.retentionDeadline(timbre).getTime() <= dueBefore.getTime()
      )
      .sort(
        (left, right) =>
          this.retentionDeadline(left).getTime() -
          this.retentionDeadline(right).getTime()
      )
      .slice(0, RETENTION_BATCH_SIZE);
    let protectedCount = 0;
    let failedCount = 0;

    for (const timbre of candidates) {
      timbre.retentionStatus = 'due_soon';
      timbre.retentionLastAttemptAt = new Date();
      timbre.updatedAt = timbre.retentionLastAttemptAt;
      await this.voiceTimbreModel.save(timbre);

      try {
        await this.qwenVoiceSpeechService.synthesize({
          text: RETENTION_PROBE_TEXT,
          voiceId: timbre.providerVoiceId,
          model: timbre.previewModel,
          language: timbre.cloneLanguage,
          ...(timbre.speechInstruction?.trim()
            ? { instruction: timbre.speechInstruction.trim() }
            : {}),
          dialect: timbre.speechDialect,
        });
        await this.markUsed(timbre);
        protectedCount += 1;
      } catch (error) {
        timbre.retentionStatus = 'attention_required';
        timbre.retentionFailureCode =
          error instanceof AppError
            ? error.code
            : 'VOICE_TIMBRE_RETENTION_FAILED';
        timbre.retentionFailureReason =
          error instanceof Error ? error.message.slice(0, 500) : String(error);
        timbre.updatedAt = new Date();
        await this.voiceTimbreModel.save(timbre);
        failedCount += 1;
        this.logger.warn(
          '[voice-timbre-retention] keepalive failed, timbreId=%s, reason=%s',
          this.idOf(timbre),
          timbre.retentionFailureReason
        );
      }
    }

    return {
      checkedCount: candidates.length,
      protectedCount,
      failedCount,
    };
  }

  private async findUserTimbres(
    userId: MongoObjectId
  ): Promise<VoiceTimbreEntity[]> {
    const byId = new Map<string, VoiceTimbreEntity>();
    const direct = await this.voiceTimbreModel.find({ where: { userId } });
    for (const timbre of direct) {
      byId.set(this.idOf(timbre), timbre);
    }

    const sessions = await this.voiceServiceSessionModel.find({
      where: { userId },
    });
    for (const session of sessions) {
      if (!session.voiceTimbreId) {
        continue;
      }
      const id = this.idOf(session.voiceTimbreId);
      let timbre = byId.get(id);
      if (!timbre) {
        timbre = await this.findTimbreById(id);
      }
      if (!timbre) {
        continue;
      }
      await this.backfillOwnershipAndRetention(timbre, userId, session);
      byId.set(this.idOf(timbre), timbre);
    }

    return Array.from(byId.values())
      .filter(timbre => this.isVisibleCompletedTimbre(timbre))
      .sort(
        (left, right) =>
          this.dateOf(right.createdAt).getTime() -
          this.dateOf(left.createdAt).getTime()
      );
  }

  private async findOwnedTimbre(
    userId: MongoObjectId,
    timbreId: string,
    includeDeleted = false
  ): Promise<VoiceTimbreEntity> {
    const id = this.parseObjectId(timbreId, 'INVALID_VOICE_TIMBRE_ID');
    const timbre = await this.findTimbreById(this.idOf(id));
    if (!timbre) {
      throw new AppError('VOICE_TIMBRE_NOT_FOUND', '没有找到这个音色', 404);
    }

    if (timbre.userId) {
      if (this.idOf(timbre.userId) !== this.idOf(userId)) {
        throw new AppError('VOICE_TIMBRE_NOT_FOUND', '没有找到这个音色', 404);
      }
    } else {
      const session = await this.findOwningSession(timbre, userId);
      if (!session) {
        throw new AppError('VOICE_TIMBRE_NOT_FOUND', '没有找到这个音色', 404);
      }
      await this.backfillOwnershipAndRetention(timbre, userId, session);
    }

    if (!includeDeleted && !this.isVisibleCompletedTimbre(timbre)) {
      throw new AppError('VOICE_TIMBRE_NOT_FOUND', '没有找到这个音色', 404);
    }
    return timbre;
  }

  private async findOwnedAgent(
    userId: MongoObjectId,
    agentId: string
  ): Promise<AgentEntity> {
    const id = this.parseObjectId(agentId, 'INVALID_AGENT_ID');
    const agent =
      (await this.agentModel.findOne({ where: { id } })) ??
      (await this.agentModel.findOne({ where: { _id: id } as never }));

    if (!agent || this.idOf(agent.createdUserId) !== this.idOf(userId)) {
      throw new AppError('AGENT_NOT_FOUND', '没有找到这个天之灵', 404);
    }
    return agent;
  }

  private async findOwningSession(
    timbre: VoiceTimbreEntity,
    userId: MongoObjectId
  ): Promise<VoiceServiceSessionEntity | undefined> {
    if (timbre.voiceServiceSessionId) {
      const session = await this.findSessionById(
        this.idOf(timbre.voiceServiceSessionId)
      );
      if (session && this.idOf(session.userId) === this.idOf(userId)) {
        return session;
      }
    }

    const sessions = await this.voiceServiceSessionModel.find({
      where: { userId },
    });
    return sessions.find(
      session => this.idOf(session.voiceTimbreId) === this.idOf(timbre)
    );
  }

  private async backfillOwnershipAndRetention(
    timbre: VoiceTimbreEntity,
    userId: MongoObjectId,
    session: VoiceServiceSessionEntity
  ): Promise<void> {
    let changed = false;
    if (!timbre.userId) {
      timbre.userId = userId;
      changed = true;
    }
    if (!timbre.voiceServiceSessionId) {
      timbre.voiceServiceSessionId = session.id;
      changed = true;
    }
    if (!timbre.providerCreatedAt) {
      timbre.providerCreatedAt = this.dateOf(timbre.createdAt);
      changed = true;
    }
    if (!timbre.providerLastUsedAt) {
      timbre.providerLastUsedAt = this.dateOf(
        session.trainingCompletedAt || timbre.updatedAt || timbre.createdAt
      );
      changed = true;
    }
    if (!timbre.providerEstimatedCleanupAt) {
      timbre.providerEstimatedCleanupAt = this.addOneYear(
        timbre.providerLastUsedAt
      );
      changed = true;
    }
    if (!timbre.retentionStatus) {
      timbre.retentionStatus = this.resolveRetentionStatus(timbre);
      changed = true;
    }
    if (!timbre.trainingClipIds?.length) {
      timbre.trainingClipIds = this.selectTrainingClips(session).map(
        clip => clip.id
      );
      changed = timbre.trainingClipIds.length > 0 || changed;
    }
    if (changed) {
      timbre.updatedAt = new Date();
      await this.voiceTimbreModel.save(timbre);
    }
  }

  private async clearSessionReferences(
    timbre: VoiceTimbreEntity
  ): Promise<void> {
    const sessions = await this.voiceServiceSessionModel.find({
      where: { voiceTimbreId: timbre.id },
    });
    for (const session of sessions) {
      session.voiceTimbreId = undefined;
      session.previewAudioUrl = undefined;
      session.previewAudioObjectKey = undefined;
      session.trainingAudioObjectKey = undefined;
      session.selectedAgentId = undefined;
      session.voiceAccessSource = undefined;
      session.voiceAccessReferenceId = undefined;
      session.voiceAccessVerifiedAt = undefined;
      session.voiceBindingStatus = undefined;
      session.voiceBoundAgentIds = [];
      session.voiceBoundAt = undefined;
      session.updatedAt = new Date();
      await this.voiceServiceSessionModel.save(session);
    }
  }

  private buildRecord(
    timbre: VoiceTimbreEntity,
    agents: AgentEntity[]
  ): UserVoiceTimbreRecordDTO {
    const retentionStatus = this.resolveRetentionStatus(timbre);
    const bindings = agents
      .filter(agent => this.idOf(agent.voiceTimbreId) === this.idOf(timbre))
      .map(agent => ({
        agentId: this.idOf(agent),
        agentName: agent.name?.trim() || '未命名天之灵',
      }));
    const pendingBindings = agents
      .filter(
        agent => this.idOf(agent.pendingVoiceTimbreId) === this.idOf(timbre)
      )
      .map(agent => ({
        agentId: this.idOf(agent),
        agentName: agent.name?.trim() || '未命名天之灵',
      }));

    return {
      id: this.idOf(timbre),
      name: timbre.name?.trim() || '我的音色',
      status: timbre.status,
      previewAudioUrl: timbre.previewAudioUrl || undefined,
      targetModel: timbre.previewModel || undefined,
      createdAt: this.dateOf(timbre.createdAt).toISOString(),
      lastUsedAt: timbre.providerLastUsedAt
        ? this.dateOf(timbre.providerLastUsedAt).toISOString()
        : undefined,
      estimatedProviderCleanupAt: timbre.providerEstimatedCleanupAt
        ? this.dateOf(timbre.providerEstimatedCleanupAt).toISOString()
        : undefined,
      retentionStatus,
      retentionMessage: this.buildRetentionMessage(retentionStatus),
      bindings,
      pendingBindings,
      speechSpeed: this.normalizeSpeechSpeed(timbre.speechSpeed),
      speechVolume: this.normalizeSpeechVolume(timbre.speechVolume),
      speechDialect: this.normalizeSpeechDialect(timbre.speechDialect),
      deletionStatus: timbre.deletionStatus,
    };
  }

  private buildDetail(
    timbre: VoiceTimbreEntity,
    agents: AgentEntity[],
    session: VoiceServiceSessionEntity | undefined,
    generatedToday: number,
    voiceAccessEligible: boolean
  ): UserVoiceTimbreDetailDTO {
    const record = this.buildRecord(timbre, agents);
    const clipIds = new Set(timbre.trainingClipIds ?? []);
    const trainingClips = (session?.reviewClips ?? [])
      .filter(clip => clipIds.has(clip.id))
      .map((clip, index) => ({
        id: clip.id,
        name: `训练片段 ${index + 1}`,
        sourceName: clip.sourceName || undefined,
        audioUrl:
          clip.publicUrl ||
          (clip.objectKey
            ? this.tencentCosService.getPublicUrl(clip.objectKey)
            : ''),
        durationSeconds: clip.durationSeconds,
        transcript: clip.transcript?.trim() || undefined,
        qualityLabel: clip.qualityLabel?.trim() || undefined,
      }))
      .filter(clip => Boolean(clip.audioUrl));

    return {
      ...record,
      providerName: '阿里云百炼（千问）',
      voiceAccessEligible,
      trainingAudioUrl:
        timbre.audioUrl ||
        (timbre.audioObjectKey
          ? this.tencentCosService.getPublicUrl(timbre.audioObjectKey)
          : undefined),
      trainingClips,
      generatedAudios: (timbre.generatedAudios ?? [])
        .slice()
        .sort(
          (left, right) =>
            this.dateOf(right.createdAt).getTime() -
            this.dateOf(left.createdAt).getTime()
        )
        .map(item => this.buildGeneratedAudio(item)),
      customSpeechTextMaxLength: CUSTOM_SPEECH_TEXT_MAX_LENGTH,
      customSpeechDailyLimit: CUSTOM_SPEECH_DAILY_LIMIT,
      customSpeechGeneratedToday: generatedToday,
      customSpeechRemainingToday: Math.max(
        CUSTOM_SPEECH_DAILY_LIMIT - generatedToday,
        0
      ),
    };
  }

  private buildAgentVoiceModelCenter(
    agent: AgentEntity,
    timbres: VoiceTimbreEntity[],
    agents: AgentEntity[],
    access: VoiceUsageAccessDecision
  ): AgentVoiceModelCenterDTO {
    const pendingTimbreId = this.idOf(agent.pendingVoiceTimbreId);
    const activeTimbreId = this.idOf(agent.voiceTimbreId);
    const selectedTimbreId = pendingTimbreId || activeTimbreId;

    return {
      agentId: this.idOf(agent),
      agentName: agent.name?.trim() || '未命名天之灵',
      items: timbres.map(timbre => this.buildRecord(timbre, agents)),
      selectedTimbreId: selectedTimbreId || undefined,
      activeTimbreId: activeTimbreId || undefined,
      voiceAccessEligible: access.eligible,
      selectionStatus: activeTimbreId
        ? 'active'
        : pendingTimbreId
        ? 'pending_membership'
        : 'not_selected',
    };
  }

  private async reconcileAgentVoiceTimbreAccess(
    agent: AgentEntity,
    timbres: VoiceTimbreEntity[],
    access: VoiceUsageAccessDecision
  ): Promise<void> {
    if (!access.eligible && agent.voiceTimbreId) {
      const activeId = this.idOf(agent.voiceTimbreId);
      const timbre = timbres.find(item => this.idOf(item) === activeId);
      agent.voiceTimbreId = null as never;
      if (timbre) {
        agent.pendingVoiceTimbreId = timbre.id;
      }
      const now = new Date();
      agent.voiceTimbreSelectedAt = now;
      agent.updatedAt = now;
      await this.agentModel.save(agent);
      if (timbre) {
        await this.recordAgentVoiceTimbreSelection({
          agent,
          timbre,
          previousTimbreId: activeId,
          access,
          selectedAt: now,
        });
      }
      return;
    }

    if (!access.eligible || !agent.pendingVoiceTimbreId) {
      return;
    }
    const pendingId = this.idOf(agent.pendingVoiceTimbreId);
    const timbre = timbres.find(item => this.idOf(item) === pendingId);
    if (!timbre) {
      agent.pendingVoiceTimbreId = undefined;
      agent.updatedAt = new Date();
      await this.agentModel.save(agent);
      return;
    }

    const previousTimbreId = this.idOf(agent.voiceTimbreId);
    const now = new Date();
    agent.voiceTimbreId = timbre.id;
    agent.pendingVoiceTimbreId = undefined;
    agent.voiceTimbreSelectedAt = now;
    agent.updatedAt = now;
    await this.agentModel.save(agent);
    await this.recordAgentVoiceTimbreSelection({
      agent,
      timbre,
      previousTimbreId,
      access,
      selectedAt: now,
    });
  }

  private async recordAgentVoiceTimbreSelection(options: {
    agent: AgentEntity;
    timbre: VoiceTimbreEntity;
    previousTimbreId: string;
    access: VoiceUsageAccessDecision;
    selectedAt: Date;
  }): Promise<void> {
    const agentId = this.idOf(options.agent);
    const timbreId = this.idOf(options.timbre);

    if (options.previousTimbreId && options.previousTimbreId !== timbreId) {
      const previous = await this.findTimbreById(options.previousTimbreId);
      const previousSession = previous
        ? await this.findSourceSession(previous)
        : undefined;
      if (previousSession) {
        previousSession.voiceBoundAgentIds = (
          previousSession.voiceBoundAgentIds ?? []
        ).filter(item => this.idOf(item) !== agentId);
        previousSession.updatedAt = options.selectedAt;
        await this.voiceServiceSessionModel.save(previousSession);
      }
    }

    const session = await this.findSourceSession(options.timbre);
    if (!session) {
      return;
    }
    session.selectedAgentId = options.agent.id;
    session.voiceBindingStatus = options.access.eligible
      ? 'bound'
      : 'purchase_required';
    if (options.access.eligible) {
      const boundIds = new Set(
        (session.voiceBoundAgentIds ?? []).map(item => this.idOf(item))
      );
      boundIds.add(agentId);
      session.voiceBoundAgentIds = Array.from(boundIds).map(
        item => new MongoObjectId(item)
      );
      session.voiceBoundAt = options.selectedAt;
    } else {
      session.voiceBoundAgentIds = (session.voiceBoundAgentIds ?? []).filter(
        item => this.idOf(item) !== agentId
      );
      if (!session.voiceBoundAgentIds.length) {
        session.voiceBoundAt = undefined;
      }
    }
    session.events = [
      ...(session.events ?? []),
      {
        id: `event_${randomBytes(8).toString('hex')}`,
        type: options.access.eligible
          ? VoiceServiceEventType.agentVoiceBound
          : VoiceServiceEventType.agentSelected,
        summary: options.access.eligible
          ? `为“${options.agent.name || '未命名'}”启用音色“${
              options.timbre.name || '我的音色'
            }”`
          : `为“${options.agent.name || '未命名'}”选择音色，等待声音版会员生效`,
        metadata: {
          agentId,
          timbreId,
          voiceAccessEligible: options.access.eligible,
        },
        createdAt: options.selectedAt,
      },
    ].slice(-500);
    session.updatedAt = options.selectedAt;
    await this.voiceServiceSessionModel.save(session);
  }

  private buildGeneratedAudio(
    item: NonNullable<VoiceTimbreEntity['generatedAudios']>[number]
  ): UserVoiceTimbreGeneratedAudioDTO {
    return {
      id: item.id,
      text: item.text,
      audioUrl:
        item.publicUrl || this.tencentCosService.getPublicUrl(item.objectKey),
      speechSpeed: this.normalizeSpeechSpeed(item.speechSpeed),
      speechVolume: this.normalizeSpeechVolume(item.speechVolume),
      createdAt: this.dateOf(item.createdAt).toISOString(),
    };
  }

  private buildRetentionPolicy(): VoiceTimbreRetentionPolicyDTO {
    return {
      providerName: '阿里云百炼（千问）',
      inactiveCleanupDays: PROVIDER_INACTIVE_CLEANUP_DAYS,
      providerVoiceLimit: 1000,
      providerVoiceLimitScope: 'platform_account',
      automaticRetentionEnabled: true,
      automaticRetentionBeforeDays: RETENTION_BEFORE_DAYS,
      summary:
        '已完成的音色会保存在你的音色仓库。服务商会清理连续一年没有用于语音合成的音色，平台会在期限前自动做保留校验。',
      deletionNotice:
        '只有你主动删除时，平台才会移除音色、训练音频、试听音频和生成语音；删除后无法恢复。',
      officialRuleUrl: OFFICIAL_RULE_URL,
      verifiedAt: POLICY_VERIFIED_AT,
    };
  }

  private buildRetentionMessage(
    status: UserVoiceTimbreRecordDTO['retentionStatus']
  ): string {
    if (status === 'attention_required') {
      return '自动保留校验暂未成功，平台会继续重试';
    }
    if (status === 'due_soon') {
      return '接近服务商清理期限，正在自动保留';
    }
    return '已开启自动保留';
  }

  private resolveRetentionStatus(
    timbre: VoiceTimbreEntity
  ): UserVoiceTimbreRecordDTO['retentionStatus'] {
    if (timbre.retentionStatus === 'attention_required') {
      return 'attention_required';
    }
    const dueSoonAt = Date.now() + RETENTION_BEFORE_DAYS * ONE_DAY_MS;
    return this.retentionDeadline(timbre).getTime() <= dueSoonAt
      ? 'due_soon'
      : 'protected';
  }

  private retentionDeadline(timbre: VoiceTimbreEntity): Date {
    return timbre.providerEstimatedCleanupAt
      ? this.dateOf(timbre.providerEstimatedCleanupAt)
      : this.addOneYear(
          this.dateOf(
            timbre.providerLastUsedAt || timbre.updatedAt || timbre.createdAt
          )
        );
  }

  private isVisibleCompletedTimbre(timbre: VoiceTimbreEntity): boolean {
    if (timbre.deletionStatus === 'completed' || timbre.deletedAt) {
      return false;
    }
    return (
      timbre.status === VoiceTimbreStatus.active ||
      (timbre.status === VoiceTimbreStatus.disabled &&
        timbre.deletionStatus === 'partial_failed')
    );
  }

  private isUserTimbre(timbre: VoiceTimbreEntity): boolean {
    return Boolean(timbre.userId || timbre.voiceServiceSessionId);
  }

  private async findSourceSession(
    timbre: VoiceTimbreEntity
  ): Promise<VoiceServiceSessionEntity | undefined> {
    if (timbre.voiceServiceSessionId) {
      const session = await this.findSessionById(
        this.idOf(timbre.voiceServiceSessionId)
      );
      if (session) {
        return session;
      }
    }
    const sessions = await this.voiceServiceSessionModel.find({
      where: { voiceTimbreId: timbre.id },
    });
    return sessions[0];
  }

  private selectTrainingClips(
    session: VoiceServiceSessionEntity
  ): VoiceServiceReviewClipItem[] {
    const accepted = (session.reviewClips ?? [])
      .map((clip, index) => ({ clip, index }))
      .filter(
        item => item.clip.reviewStatus === VoiceServiceClipReviewStatus.accepted
      )
      .sort((left, right) => {
        const scoreDifference =
          (Number(right.clip.qualityScore) || 0) -
          (Number(left.clip.qualityScore) || 0);
        return scoreDifference || left.index - right.index;
      });
    const selected: typeof accepted = [];
    let durationSeconds = 0;

    for (const item of accepted) {
      const clipDuration = Math.max(1, item.clip.durationSeconds || 12);
      const separatorSeconds = selected.length > 0 ? 0.2 : 0;
      if (
        selected.length > 0 &&
        durationSeconds + separatorSeconds + clipDuration >
          VOICE_SERVICE_MAX_TRAINING_SECONDS
      ) {
        continue;
      }
      selected.push(item);
      durationSeconds += separatorSeconds + clipDuration;
      if (durationSeconds >= VOICE_SERVICE_MAX_TRAINING_SECONDS) {
        break;
      }
    }

    return selected
      .sort((left, right) => left.index - right.index)
      .map(item => item.clip);
  }

  private async findTimbreById(
    id: string
  ): Promise<VoiceTimbreEntity | undefined> {
    const objectId = this.parseObjectId(id, 'INVALID_VOICE_TIMBRE_ID');
    return (
      (await this.voiceTimbreModel.findOne({ where: { id: objectId } })) ??
      (await this.voiceTimbreModel.findOne({
        where: { _id: objectId } as never,
      })) ??
      undefined
    );
  }

  private async findSessionById(
    id: string
  ): Promise<VoiceServiceSessionEntity | undefined> {
    const objectId = this.parseObjectId(id, 'INVALID_VOICE_SERVICE_SESSION_ID');
    return (
      (await this.voiceServiceSessionModel.findOne({
        where: { id: objectId },
      })) ??
      (await this.voiceServiceSessionModel.findOne({
        where: { _id: objectId } as never,
      })) ??
      undefined
    );
  }

  private parseObjectId(value: unknown, code: string): MongoObjectId {
    const normalized = String(value || '').trim();
    if (!/^[a-f\d]{24}$/i.test(normalized)) {
      throw new AppError(code, 'invalid object id', 400);
    }
    return new MongoObjectId(normalized);
  }

  private idOf(value: unknown): string {
    if (!value) {
      return '';
    }
    const candidate = value as {
      id?: unknown;
      _id?: unknown;
      toHexString?: () => string;
      toString?: () => string;
    };
    if (candidate.toHexString) {
      return candidate.toHexString();
    }
    if (candidate.id && candidate.id !== value) {
      return this.idOf(candidate.id);
    }
    if (candidate._id && candidate._id !== value) {
      return this.idOf(candidate._id);
    }
    return candidate.toString?.() || '';
  }

  private dateOf(value: Date | string | number | undefined): Date {
    const date = value ? new Date(value) : new Date();
    return Number.isNaN(date.getTime()) ? new Date() : date;
  }

  private addOneYear(value: Date): Date {
    const result = new Date(value);
    result.setFullYear(result.getFullYear() + 1);
    return result;
  }

  private normalizeSpeechSpeed(value: unknown): number {
    return this.numberInRange(
      value,
      1,
      0.5,
      2,
      'INVALID_VOICE_TIMBRE_SPEECH_SPEED'
    );
  }

  private isCosyVoiceV35PlusTimbre(timbre: VoiceTimbreEntity): boolean {
    if (timbre.provider !== VoiceTimbreProvider.cosyvoice) {
      return false;
    }

    const voiceId = timbre.providerVoiceId?.trim().toLowerCase() || '';
    if (voiceId.startsWith('cosyvoice-')) {
      return voiceId.startsWith('cosyvoice-v3.5-plus-');
    }

    return /^cosyvoice-v3\.5-plus$/i.test(timbre.previewModel?.trim() || '');
  }

  private normalizeSpeechVolume(value: unknown): number {
    return this.numberInRange(
      value,
      1,
      0.25,
      2,
      'INVALID_VOICE_TIMBRE_SPEECH_VOLUME'
    );
  }

  private normalizeSpeechDialect(
    value: unknown,
    strict = false
  ): VoiceTimbreDialectDTO {
    const normalized = String(value || 'auto')
      .trim()
      .toLowerCase();
    const matched = VOICE_TIMBRE_DIALECT_OPTIONS.find(
      option => option.value === normalized
    );

    if (!matched && strict) {
      throw new AppError(
        'INVALID_VOICE_TIMBRE_SPEECH_DIALECT',
        '请选择支持的方言类型',
        400
      );
    }

    return matched?.value || 'auto';
  }

  private async getCustomSpeechGeneratedToday(
    userId: MongoObjectId,
    now = new Date()
  ): Promise<number> {
    const window = this.getBeijingDayWindow(now);
    const usageKey = this.customSpeechUsageKey(userId, window.day);
    try {
      const cached = await this.redisService?.get(usageKey);
      if (cached !== null && cached !== undefined) {
        const count = Number(cached);
        if (Number.isFinite(count) && count >= 0) {
          return Math.floor(count);
        }
      }
    } catch (error) {
      this.logger.warn(
        '[voice-timbre] read custom speech usage failed, userId=%s, reason=%s',
        this.idOf(userId),
        error instanceof Error ? error.message : String(error)
      );
    }

    const timbres = await this.findUserTimbres(userId);
    return timbres.reduce((total, timbre) => {
      return (
        total +
        (timbre.generatedAudios ?? []).filter(item => {
          const createdAt = this.dateOf(item.createdAt).getTime();
          return (
            createdAt >= window.start.getTime() &&
            createdAt < window.end.getTime()
          );
        }).length
      );
    }, 0);
  }

  private async reserveCustomSpeechGeneration(
    userId: MongoObjectId,
    now = new Date()
  ): Promise<CustomSpeechGenerationReservation> {
    if (!this.redisService) {
      throw new AppError(
        'VOICE_TIMBRE_SPEECH_LIMIT_UNAVAILABLE',
        '语音生成暂时繁忙，请稍后重试',
        503
      );
    }

    const userIdValue = this.idOf(userId);
    const window = this.getBeijingDayWindow(now);
    const lockKey = `voice:timbre:custom-speech:lock:${userIdValue}`;
    const lockToken = `${Date.now()}:${randomBytes(8).toString('hex')}`;
    let lockResult: string | null;
    try {
      lockResult = await this.redisService.set(
        lockKey,
        lockToken,
        'PX',
        CUSTOM_SPEECH_LOCK_TTL_MS,
        'NX'
      );
    } catch (error) {
      this.logger.warn(
        '[voice-timbre] acquire custom speech lock failed, userId=%s, reason=%s',
        userIdValue,
        error instanceof Error ? error.message : String(error)
      );
      throw new AppError(
        'VOICE_TIMBRE_SPEECH_LIMIT_UNAVAILABLE',
        '语音生成暂时繁忙，请稍后重试',
        503
      );
    }
    if (lockResult !== 'OK') {
      throw new AppError(
        'VOICE_TIMBRE_SPEECH_IN_PROGRESS',
        '上一条语音还在生成，请稍等一下',
        409
      );
    }

    const usageKey = this.customSpeechUsageKey(userId, window.day);
    const provisional = { lockKey, lockToken, usageKey, usedToday: 0 };
    try {
      const rawCount = await this.redisService.get(usageKey);
      let usedToday = Number(rawCount);
      if (
        rawCount === null ||
        rawCount === undefined ||
        !Number.isFinite(usedToday) ||
        usedToday < 0
      ) {
        usedToday = await this.getCustomSpeechGeneratedToday(userId, now);
        await this.redisService.set(
          usageKey,
          String(usedToday),
          'PX',
          Math.max(window.end.getTime() - now.getTime(), 1000)
        );
      }
      if (usedToday >= CUSTOM_SPEECH_DAILY_LIMIT) {
        throw new AppError(
          'VOICE_TIMBRE_SPEECH_DAILY_LIMIT_REACHED',
          `今天已经生成 ${CUSTOM_SPEECH_DAILY_LIMIT} 次了，明天可以继续`,
          429
        );
      }

      const reservedCount = await this.redisService.incr(usageKey);
      if (reservedCount > CUSTOM_SPEECH_DAILY_LIMIT) {
        await this.redisService.decr(usageKey);
        throw new AppError(
          'VOICE_TIMBRE_SPEECH_DAILY_LIMIT_REACHED',
          `今天已经生成 ${CUSTOM_SPEECH_DAILY_LIMIT} 次了，明天可以继续`,
          429
        );
      }
      return {
        lockKey,
        lockToken,
        usageKey,
        usedToday: reservedCount,
      };
    } catch (error) {
      await this.releaseCustomSpeechGenerationLock(provisional);
      throw error;
    }
  }

  private async rollbackCustomSpeechGeneration(
    reservation: CustomSpeechGenerationReservation
  ): Promise<void> {
    try {
      const current = Number(
        await this.redisService?.get(reservation.usageKey)
      );
      if (Number.isFinite(current) && current > 0) {
        await this.redisService?.decr(reservation.usageKey);
      }
    } catch (error) {
      this.logger.warn(
        '[voice-timbre] rollback custom speech usage failed, usageKey=%s, reason=%s',
        reservation.usageKey,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  private async releaseCustomSpeechGenerationLock(
    reservation: Pick<
      CustomSpeechGenerationReservation,
      'lockKey' | 'lockToken'
    >
  ): Promise<void> {
    try {
      if (
        this.redisService &&
        (await this.redisService.get(reservation.lockKey)) ===
          reservation.lockToken
      ) {
        await this.redisService.del(reservation.lockKey);
      }
    } catch (error) {
      this.logger.warn(
        '[voice-timbre] release custom speech lock failed, lockKey=%s, reason=%s',
        reservation.lockKey,
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  private customSpeechUsageKey(userId: MongoObjectId, day: string): string {
    return `voice:timbre:custom-speech:usage:${this.idOf(userId)}:${day}`;
  }

  private getBeijingDayWindow(value: Date): {
    day: string;
    start: Date;
    end: Date;
  } {
    const beijingOffsetMs = 8 * 60 * 60 * 1000;
    const shifted = new Date(value.getTime() + beijingOffsetMs);
    const year = shifted.getUTCFullYear();
    const month = shifted.getUTCMonth();
    const date = shifted.getUTCDate();
    const start = new Date(Date.UTC(year, month, date) - beijingOffsetMs);
    const end = new Date(Date.UTC(year, month, date + 1) - beijingOffsetMs);
    return {
      day: `${year}-${String(month + 1).padStart(2, '0')}-${String(
        date
      ).padStart(2, '0')}`,
      start,
      end,
    };
  }

  private numberInRange(
    value: unknown,
    fallback: number,
    min: number,
    max: number,
    code: string
  ): number {
    if (value === undefined || value === null || value === '') {
      return fallback;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
      throw new AppError(code, `value must be between ${min} and ${max}`, 400);
    }
    return Math.round(parsed * 100) / 100;
  }

  private extensionForMimeType(mimeType: string): string {
    const normalized = String(mimeType || '').toLowerCase();
    if (normalized.includes('mpeg') || normalized.includes('mp3')) {
      return 'mp3';
    }
    if (normalized.includes('ogg') || normalized.includes('opus')) {
      return 'ogg';
    }
    return 'wav';
  }
}
