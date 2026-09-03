import { Inject, Logger, Provide } from '@midwayjs/core';
import { brandName } from '../config/brand';
import { ILogger } from '@midwayjs/logger';
import * as bullmq from '@midwayjs/bullmq';
import { InjectEntityModel } from '@midwayjs/typeorm';
import {
  AgentEntity,
  MongoObjectId,
  VipPlanEntity,
  VipPlanGroup,
  VipPlanStatus,
  VoiceServiceClipReviewStatus,
  VoiceServiceDataDeletionStatus,
  VoiceServiceEventType,
  VoiceServiceFailureStage,
  VoiceServiceMessageRole,
  VoiceServiceProcessingMode,
  type VoiceServiceBindingStatus,
  VoiceServiceSessionEntity,
  VoiceServiceSessionStatus,
  type VoiceServiceClipRecutAttemptItem,
  type VoiceServiceEventItem,
  type VoiceServiceFilteredClipItem,
  type VoiceServiceClipQualityIssue,
  type VoiceServiceClipQualityIssueCode,
  type VoiceServiceClipQualityMetrics,
  type VoiceServiceMaterialItem,
  type VoiceServiceMessageItem,
  type VoiceServiceObservabilityMetrics,
  type VoiceServicePlatformErrorItem,
  type VoiceServiceProcessingAttemptItem,
  type VoiceServiceProcessingStage,
  type VoiceServiceReviewClipItem,
} from '@tzl/entities';
import type {
  AddVoiceServiceMaterialsDTO,
  RecutVoiceServiceClipDTO,
  ReviewVoiceServiceClipDTO,
  SelectVoiceServiceAgentDTO,
  SendVoiceServiceMessageDTO,
  StartVoiceServiceTrainingDTO,
  SubmitVoiceServiceMaterialsDTO,
  VoiceServiceSessionDTO,
} from '@tzl/shared';
import { createHash, randomBytes } from 'crypto';
import { MongoRepository } from 'typeorm';
import { AppError } from '../common/errors';
import { AuthenticatedUserPayload } from '../interface';
import { OpenAIService } from './agents/openai';
import { TencentCosService } from './tencent-cos.service';
import {
  VoiceClippingService,
  resolveVoiceClipRecutRange,
  type VoiceClippingBatchResult,
  type VoiceClipRecutResult,
  type VoiceClippingMetrics,
  type VoiceClippingPlatformError,
} from './voice-clipping.service';
import {
  buildVoicePreviewText,
  VoiceModelTrainingService,
} from './voice-model-training.service';
import { VoiceServiceDataDeletionService } from './voice-service-data-deletion.service';
import {
  VoiceUsageAccessDecision,
  VoiceUsageAccessService,
} from './voice-usage-access.service';

const MAX_MATERIAL_COUNT = 30;
const MAX_MESSAGE_COUNT = 200;
const MAX_EVENT_COUNT = 500;
const VOICE_CLIP_QUALITY_ISSUE_CODES =
  new Set<VoiceServiceClipQualityIssueCode>([
    'too_short',
    'mostly_silent',
    'severe_clipping',
    'volume_unrecoverable',
    'background_noise_severe',
    'silence_high',
    'clipping_detected',
    'volume_adjusted',
    'background_noise_high',
  ]);
export const VOICE_SERVICE_CLIPPING_QUEUE = 'voice-service-clipping';
export const VOICE_SERVICE_TRAINING_QUEUE = 'voice-service-training';

export interface VoiceServiceClippingJobData {
  sessionId: string;
  clippingJobId?: string;
  jobType?: 'full_clipping' | 'clip_recut';
  clipId?: string;
  recutJobId?: string;
}

export interface VoiceServiceTrainingJobData {
  sessionId: string;
  trainingJobId?: string;
}

export interface ProcessVoiceServiceClippingJobOptions {
  isFinalAttempt?: boolean;
  jobId?: string;
  workerAttempt?: number;
}

export type ProcessVoiceServiceTrainingJobOptions =
  ProcessVoiceServiceClippingJobOptions;

@Provide()
export class VoiceServiceService {
  @Logger()
  logger: ILogger;

  @InjectEntityModel(VoiceServiceSessionEntity)
  voiceServiceSessionModel: MongoRepository<VoiceServiceSessionEntity>;

  @InjectEntityModel(AgentEntity)
  agentModel: MongoRepository<AgentEntity>;

  @InjectEntityModel(VipPlanEntity)
  vipPlanModel: MongoRepository<VipPlanEntity>;

  @Inject()
  openAIService: OpenAIService;

  @Inject()
  tencentCosService: TencentCosService;

  @Inject()
  voiceClippingService: VoiceClippingService;

  @Inject()
  voiceModelTrainingService: VoiceModelTrainingService;

  @Inject()
  voiceServiceDataDeletionService: VoiceServiceDataDeletionService;

  @Inject()
  voiceUsageAccessService: VoiceUsageAccessService;

  @Inject()
  bullmqFramework: bullmq.Framework;

  async getCurrentSession(
    auth: AuthenticatedUserPayload
  ): Promise<VoiceServiceSessionDTO | undefined> {
    const userId = this.parseObjectId(auth.sub, 'INVALID_TOKEN');
    let session = await this.findLatestSession(userId);

    if (session?.status === VoiceServiceSessionStatus.analyzing) {
      await this.ensureClippingQueued(session);
    }
    if (session?.status === VoiceServiceSessionStatus.training) {
      await this.ensureTrainingQueued(session);
    }
    if (
      session?.status === VoiceServiceSessionStatus.reviewing &&
      (session.reviewClips ?? []).some(item =>
        this.isClipRecutActive(item.recutStatus)
      )
    ) {
      await this.ensureClipRecutsQueued(session);
      session = await this.getSessionById(this.stringifyObjectId(session.id));
    }

    if (!session) {
      return undefined;
    }

    if (
      session.status === VoiceServiceSessionStatus.previewReady ||
      session.status === VoiceServiceSessionStatus.completed
    ) {
      const access = await this.voiceUsageAccessService.resolve(userId);
      await this.ensureEligibleVoiceBinding(session, access);
      return this.buildSessionRecord(session, access);
    }

    return this.buildSessionRecord(session);
  }

  async startSession(
    auth: AuthenticatedUserPayload
  ): Promise<VoiceServiceSessionDTO> {
    const userId = this.parseObjectId(auth.sub, 'INVALID_TOKEN');
    const session = await this.getOrCreateCollectingSession(userId);
    const access = await this.voiceUsageAccessService.resolve(userId);
    await this.ensureEligibleVoiceBinding(session, access);
    return this.buildSessionRecord(session, access);
  }

  async addMaterials(
    auth: AuthenticatedUserPayload,
    payload: AddVoiceServiceMaterialsDTO
  ): Promise<VoiceServiceSessionDTO> {
    const userId = this.parseObjectId(auth.sub, 'INVALID_TOKEN');
    const incoming = this.normalizeMaterials(payload?.materials);

    if (incoming.length === 0) {
      throw new AppError(
        'VOICE_SERVICE_MATERIAL_REQUIRED',
        'voice material is required',
        400
      );
    }

    const session = await this.getOrCreateCollectingSession(userId);
    this.assertDataDeletionSettled(session);
    if (
      session.status !== VoiceServiceSessionStatus.collecting &&
      session.status !== VoiceServiceSessionStatus.failed &&
      !this.canReworkReviewedSession(session)
    ) {
      throw new AppError(
        'VOICE_SERVICE_MATERIAL_LOCKED',
        'voice material cannot be added now',
        400
      );
    }
    const existing = session.materials ?? [];
    const existingObjectKeys = new Set(existing.map(item => item.objectKey));
    const remainingCount = Math.max(MAX_MATERIAL_COUNT - existing.length, 0);
    const now = new Date();
    const additions = incoming
      .filter(item => !existingObjectKeys.has(item.objectKey))
      .slice(0, remainingCount)
      .map<VoiceServiceMaterialItem>(item => ({
        id: this.createItemId('material'),
        name: item.name,
        objectKey: item.objectKey,
        publicUrl: this.resolvePublicUrl(item.objectKey, item.publicUrl),
        durationSeconds: item.durationSeconds,
        createdAt: now,
      }));

    if (additions.length === 0) {
      if (remainingCount === 0) {
        throw new AppError(
          'VOICE_SERVICE_MATERIAL_LIMIT',
          `voice material count must be <= ${MAX_MATERIAL_COUNT}`,
          400
        );
      }

      return this.buildSessionRecord(session);
    }

    await this.deleteReviewClipObjects(session);
    session.materials = [...existing, ...additions];
    session.status = VoiceServiceSessionStatus.collecting;
    session.failureReason = '';
    session.failureStage = undefined;
    session.reviewClips = [];
    session.filteredClips = [];
    session.clippingJobId = undefined;
    session.clippingStartedAt = undefined;
    session.clippingCompletedAt = undefined;
    session.observability = this.resetClippingObservability(
      session.observability
    );
    session.trainingJobId = undefined;
    session.trainingAudioObjectKey = undefined;
    session.trainingStartedAt = undefined;
    session.trainingCompletedAt = undefined;
    session.updatedAt = now;
    session.messages = this.appendMessage(
      session.messages,
      VoiceServiceMessageRole.assistant,
      `收到了，你上传的 ${additions.length} 份素材已经保存成功。现在一共有 ${session.materials.length} 份素材。你可以继续添加，确认全部传完后，再点击“开始识别与剪辑”。`,
      now
    );
    session.events = this.appendEvent(
      session.events,
      VoiceServiceEventType.materialsAdded,
      `新增 ${additions.length} 份素材`,
      now,
      {
        addedCount: additions.length,
        totalCount: session.materials.length,
      }
    );
    await this.voiceServiceSessionModel.save(session);

    return this.buildSessionRecord(session);
  }

  async submitMaterials(
    auth: AuthenticatedUserPayload,
    sessionId: string,
    payload: SubmitVoiceServiceMaterialsDTO = {}
  ): Promise<VoiceServiceSessionDTO> {
    const session = await this.getUserSession(auth, sessionId);

    if ((session.materials?.length ?? 0) === 0) {
      throw new AppError(
        'VOICE_SERVICE_MATERIAL_REQUIRED',
        'voice material is required',
        400
      );
    }

    if (
      session.status !== VoiceServiceSessionStatus.collecting &&
      session.status !== VoiceServiceSessionStatus.failed &&
      !this.canReworkReviewedSession(session)
    ) {
      return this.buildSessionRecord(session);
    }

    this.assertDataDeletionSettled(session);
    await this.deleteReviewClipObjects(session);
    const now = new Date();
    const processingMode = this.normalizeProcessingMode(
      payload?.processingMode
    );
    session.status = VoiceServiceSessionStatus.analyzing;
    session.processingMode = processingMode;
    session.failureReason = '';
    session.failureStage = undefined;
    session.reviewClips = [];
    session.filteredClips = [];
    session.clippingJobId = this.buildClippingJobId(session, now);
    session.clippingStartedAt = now;
    session.clippingCompletedAt = undefined;
    session.observability = this.resetClippingObservability(
      session.observability
    );
    session.processingAttempts = this.appendProcessingAttempt(
      session.processingAttempts,
      {
        id: this.createItemId('attempt'),
        stage: 'clipping',
        jobId: session.clippingJobId,
        processingMode,
        queuedAt: now,
        outcome: 'processing',
        platformErrors: [],
      }
    );
    session.updatedAt = now;
    session.messages = this.appendMessage(
      session.messages,
      VoiceServiceMessageRole.assistant,
      processingMode === VoiceServiceProcessingMode.readyToUse
        ? '收到了。我会保留你已经剪好的内容，只统一声音格式。整理完成后，请你试听确认，再交给声音模型训练。'
        : '收到了，素材已经上传成功。我正在区分不同说话人，并按完整语句剪出适合训练的片段，预计需要 2–3 分钟。整理好以后，我会请你逐段试听确认。',
      now
    );
    session.events = this.appendEvent(
      session.events,
      VoiceServiceEventType.materialsSubmitted,
      '用户确认素材上传完成，开始识别与剪辑',
      now,
      {
        materialCount: session.materials?.length ?? 0,
        processingMode,
      }
    );
    await this.voiceServiceSessionModel.save(session);
    await this.enqueueClippingJob(session);

    return this.buildSessionRecord(session);
  }

  async removeMaterial(
    auth: AuthenticatedUserPayload,
    sessionId: string,
    materialId: string
  ): Promise<VoiceServiceSessionDTO> {
    const session = await this.getUserSession(auth, sessionId);

    if (
      session.status !== VoiceServiceSessionStatus.collecting &&
      session.status !== VoiceServiceSessionStatus.failed
    ) {
      throw new AppError(
        'VOICE_SERVICE_MATERIAL_LOCKED',
        'voice material cannot be removed now',
        400
      );
    }

    const materials = session.materials ?? [];
    const removedMaterial = materials.find(item => item.id === materialId);
    const nextMaterials = materials.filter(item => item.id !== materialId);

    if (nextMaterials.length === materials.length) {
      throw new AppError(
        'VOICE_SERVICE_MATERIAL_NOT_FOUND',
        'voice material not found',
        404
      );
    }

    await this.voiceServiceDataDeletionService.deleteRequiredObject(
      removedMaterial!.objectKey
    );
    this.voiceServiceDataDeletionService.recordDeletedObjectAudit(
      session,
      removedMaterial!.objectKey
    );
    const now = new Date();
    session.materials = nextMaterials;
    session.updatedAt = now;
    session.events = this.appendEvent(
      session.events,
      VoiceServiceEventType.materialRemoved,
      `删除素材：${removedMaterial?.name || materialId}`,
      now,
      {
        materialId,
        remainingCount: nextMaterials.length,
      }
    );
    await this.voiceServiceSessionModel.save(session);

    return this.buildSessionRecord(session);
  }

  async deleteVoiceData(
    auth: AuthenticatedUserPayload,
    sessionId: string
  ): Promise<VoiceServiceSessionDTO> {
    const session = await this.getUserSession(auth, sessionId);
    const now = new Date();
    const materialCount = session.materials?.length ?? 0;
    const clipCount = session.reviewClips?.length ?? 0;

    this.completeProcessingAttempt(
      session,
      'clipping',
      session.clippingJobId,
      'cancelled',
      now
    );
    this.completeProcessingAttempt(
      session,
      'training',
      session.trainingJobId,
      'cancelled',
      now
    );
    session.status = VoiceServiceSessionStatus.collecting;
    session.clippingJobId = undefined;
    session.trainingJobId = undefined;
    session.failureReason = '';
    session.failureStage = undefined;
    session.dataDeletionStatus = VoiceServiceDataDeletionStatus.pending;
    session.dataDeletionRequestedAt = now;
    session.dataDeletionCompletedAt = undefined;
    session.dataDeletionFailureReason = '';
    session.dataDeletionFailures = [];
    session.events = this.appendEvent(
      session.events,
      VoiceServiceEventType.dataDeletionRequested,
      '用户请求删除全部声音数据',
      now,
      {
        materialCount,
        clipCount,
        hadVoiceModel: Boolean(session.voiceTimbreId),
      }
    );
    session.updatedAt = now;
    await this.voiceServiceSessionModel.save(session);

    try {
      const result =
        await this.voiceServiceDataDeletionService.deleteSessionArtifacts(
          session
        );
      const completedAt = new Date();
      const completed = result.failures.length === 0;

      session.dataDeletionStatus = completed
        ? VoiceServiceDataDeletionStatus.completed
        : VoiceServiceDataDeletionStatus.partialFailed;
      session.dataDeletionCompletedAt = completed ? completedAt : undefined;
      session.dataDeletionFailureReason = completed
        ? ''
        : '还有部分声音数据未删除，请稍后重试';
      session.dataDeletionFailures = result.failures;
      session.updatedAt = completedAt;
      session.messages = this.appendMessage(
        session.messages,
        VoiceServiceMessageRole.assistant,
        completed
          ? '你的原始素材、切片、训练音频和声音模型已经全部删除。'
          : '大部分声音数据已经删除，但仍有少量数据删除失败。你可以稍后再次点击删除。',
        completedAt
      );
      session.events = this.appendEvent(
        session.events,
        completed
          ? VoiceServiceEventType.dataDeletionCompleted
          : VoiceServiceEventType.dataDeletionPartialFailed,
        completed ? '全部声音数据删除完成' : '部分声音数据删除失败',
        completedAt,
        {
          deletedObjectCount: result.deletedObjectCount,
          deletedVoiceModelCount: result.deletedVoiceModelCount,
          deletedTimbreCount: result.deletedTimbreCount,
          unboundAgentCount: result.unboundAgentCount,
          failureCount: result.failures.length,
        }
      );
      await this.voiceServiceSessionModel.save(session);
    } catch (error) {
      const failedAt = new Date();
      session.dataDeletionStatus = VoiceServiceDataDeletionStatus.partialFailed;
      session.dataDeletionCompletedAt = undefined;
      session.dataDeletionFailureReason = '声音数据删除失败，请稍后重试';
      session.dataDeletionFailures = [
        {
          id: this.createItemId('delete-failure'),
          artifactType: 'deletion_workflow',
          target: this.stringifyObjectId(session.id),
          code:
            error instanceof AppError
              ? error.code
              : 'VOICE_SERVICE_DATA_DELETE_FAILED',
          message:
            error instanceof Error
              ? error.message.slice(0, 1000)
              : String(error).slice(0, 1000),
          createdAt: failedAt,
        },
      ];
      session.events = this.appendEvent(
        session.events,
        VoiceServiceEventType.dataDeletionPartialFailed,
        '声音数据删除流程失败',
        failedAt,
        { failureCount: 1 }
      );
      session.updatedAt = failedAt;
      await this.voiceServiceSessionModel.save(session);
    }

    return this.buildSessionRecord(session);
  }

  async returnToMaterials(
    auth: AuthenticatedUserPayload,
    sessionId: string
  ): Promise<VoiceServiceSessionDTO> {
    const session = await this.getUserSession(auth, sessionId);

    if (session.status === VoiceServiceSessionStatus.collecting) {
      return this.buildSessionRecord(session);
    }

    const canReturn =
      session.status === VoiceServiceSessionStatus.analyzing ||
      session.status === VoiceServiceSessionStatus.reviewing ||
      (session.status === VoiceServiceSessionStatus.failed &&
        session.failureStage === VoiceServiceFailureStage.clipping);
    if (!canReturn) {
      throw new AppError(
        'VOICE_SERVICE_CANNOT_RETURN_TO_MATERIALS',
        'current voice service stage cannot return to materials',
        400
      );
    }

    const now = new Date();
    await this.deleteReviewClipObjects(session);
    this.completeProcessingAttempt(
      session,
      'clipping',
      session.clippingJobId,
      'cancelled',
      now
    );
    session.status = VoiceServiceSessionStatus.collecting;
    session.reviewClips = [];
    session.filteredClips = [];
    session.failureReason = '';
    session.failureStage = undefined;
    session.clippingJobId = undefined;
    session.clippingStartedAt = undefined;
    session.clippingCompletedAt = undefined;
    session.observability = this.resetClippingObservability(
      session.observability
    );
    session.updatedAt = now;
    session.messages = this.appendMessage(
      session.messages,
      VoiceServiceMessageRole.assistant,
      '已经回到素材准备。之前上传的内容都还在，你可以继续添加或删除，确认好以后再重新整理。',
      now
    );
    session.events = this.appendEvent(
      session.events,
      VoiceServiceEventType.returnedToMaterials,
      '返回声音素材准备',
      now,
      { materialCount: session.materials?.length ?? 0 }
    );
    await this.voiceServiceSessionModel.save(session);

    return this.buildSessionRecord(session);
  }

  async returnToReview(
    auth: AuthenticatedUserPayload,
    sessionId: string
  ): Promise<VoiceServiceSessionDTO> {
    const session = await this.getUserSession(auth, sessionId);
    this.assertDataDeletionSettled(session);

    if (session.status === VoiceServiceSessionStatus.reviewing) {
      return this.buildSessionRecord(session);
    }

    const canReturn =
      session.status === VoiceServiceSessionStatus.training ||
      session.status === VoiceServiceSessionStatus.previewReady ||
      (session.status === VoiceServiceSessionStatus.failed &&
        session.failureStage === VoiceServiceFailureStage.training);
    if (!canReturn) {
      throw new AppError(
        'VOICE_SERVICE_CANNOT_RETURN_TO_REVIEW',
        'current voice service stage cannot return to clip review',
        400
      );
    }

    const clips = session.reviewClips ?? [];
    if (!clips.length) {
      throw new AppError(
        'VOICE_SERVICE_REVIEW_CLIP_REQUIRED',
        'voice review clips are no longer available',
        400
      );
    }

    const now = new Date();
    const discardedTimbreId = session.voiceTimbreId
      ? this.stringifyObjectId(session.voiceTimbreId)
      : '';
    const residualTrainingObjectKeys = discardedTimbreId
      ? []
      : [session.trainingAudioObjectKey, session.previewAudioObjectKey].filter(
          (item): item is string => Boolean(item)
        );
    if (session.status === VoiceServiceSessionStatus.training) {
      this.completeProcessingAttempt(
        session,
        'training',
        session.trainingJobId,
        'cancelled',
        now
      );
    }
    session.status = VoiceServiceSessionStatus.reviewing;
    session.failureReason = '';
    session.failureStage = undefined;
    session.voiceTimbreId = undefined;
    session.previewAudioUrl = undefined;
    session.previewAudioObjectKey = undefined;
    session.trainingAudioObjectKey = undefined;
    session.trainingJobId = undefined;
    session.trainingStartedAt = undefined;
    session.trainingCompletedAt = undefined;
    session.updatedAt = now;
    session.messages = this.appendMessage(
      session.messages,
      VoiceServiceMessageRole.assistant,
      '已经回到声音片段选择。之前的剪辑和选择都还在，你可以重新试听调整，确认后再生成声音。',
      now
    );
    session.events = this.appendEvent(
      session.events,
      VoiceServiceEventType.returnedToReview,
      '从声音生成返回片段选择',
      now,
      {
        clipCount: clips.length,
        acceptedClipCount: clips.filter(
          item => item.reviewStatus === VoiceServiceClipReviewStatus.accepted
        ).length,
      }
    );
    await this.voiceServiceSessionModel.save(session);

    if (discardedTimbreId) {
      await this.voiceServiceDataDeletionService.cleanupLateTimbre(
        sessionId,
        discardedTimbreId
      );
    } else if (residualTrainingObjectKeys.length) {
      await this.voiceServiceDataDeletionService.cleanupLateObjectKeys(
        sessionId,
        residualTrainingObjectKeys
      );
    }

    return this.buildSessionRecord(session);
  }

  async sendMessage(
    auth: AuthenticatedUserPayload,
    sessionId: string | undefined,
    payload: SendVoiceServiceMessageDTO
  ): Promise<VoiceServiceSessionDTO> {
    const userId = this.parseObjectId(auth.sub, 'INVALID_TOKEN');
    const text = this.normalizeText(payload?.text, 500);

    if (!text) {
      throw new AppError(
        'VOICE_SERVICE_MESSAGE_REQUIRED',
        'message is required',
        400
      );
    }

    const session = sessionId
      ? await this.getUserSession(auth, sessionId)
      : await this.getOrCreateCollectingSession(userId);
    const now = new Date();
    session.messages = this.appendMessage(
      session.messages,
      VoiceServiceMessageRole.user,
      text,
      now
    );
    const reply = await this.buildAssistantReply(session, text);
    session.messages = this.appendMessage(
      session.messages,
      VoiceServiceMessageRole.assistant,
      reply,
      new Date()
    );
    session.updatedAt = new Date();
    await this.voiceServiceSessionModel.save(session);

    return this.buildSessionRecord(session);
  }

  async reviewClip(
    auth: AuthenticatedUserPayload,
    sessionId: string,
    clipId: string,
    payload: ReviewVoiceServiceClipDTO
  ): Promise<VoiceServiceSessionDTO> {
    const session = await this.getUserSession(auth, sessionId);

    const retryingTraining =
      session.status === VoiceServiceSessionStatus.failed &&
      session.failureStage === VoiceServiceFailureStage.training;
    if (
      session.status !== VoiceServiceSessionStatus.reviewing &&
      !retryingTraining
    ) {
      throw new AppError(
        'VOICE_SERVICE_NOT_REVIEWING',
        'voice clips are not ready for review',
        400
      );
    }

    const reviewStatus = this.normalizeReviewStatus(payload?.reviewStatus);
    const clips = session.reviewClips ?? [];
    const clip = clips.find(item => item.id === clipId);

    if (!clip) {
      throw new AppError(
        'VOICE_SERVICE_CLIP_NOT_FOUND',
        'voice review clip not found',
        404
      );
    }
    if (this.isClipRecutActive(clip.recutStatus)) {
      throw new AppError(
        'VOICE_SERVICE_CLIP_RECUT_IN_PROGRESS',
        '这个片段正在重新剪辑，请完成后再选择',
        409
      );
    }

    const now = new Date();
    this.clearClipRecutState(clip);
    clip.reviewStatus = reviewStatus;
    clip.rejectionReason =
      reviewStatus === VoiceServiceClipReviewStatus.rejected
        ? this.normalizeText(payload?.rejectionReason, 80)
        : '';
    clip.reviewedAt = now;
    session.updatedAt = now;
    session.events = this.appendEvent(
      session.events,
      VoiceServiceEventType.clipReviewed,
      reviewStatus === VoiceServiceClipReviewStatus.accepted
        ? '确认使用声音片段'
        : '确认不使用声音片段',
      now,
      {
        clipId,
        reviewStatus,
      }
    );

    const pendingCount = clips.filter(
      item => item.reviewStatus === VoiceServiceClipReviewStatus.pending
    ).length;
    const acceptedCount = clips.filter(
      item => item.reviewStatus === VoiceServiceClipReviewStatus.accepted
    ).length;
    const rejectedCount = clips.filter(
      item => item.reviewStatus === VoiceServiceClipReviewStatus.rejected
    ).length;
    this.updateReviewObservability(
      session,
      acceptedCount,
      rejectedCount,
      clips.length
    );

    if (pendingCount === 0) {
      session.messages = this.appendMessage(
        session.messages,
        VoiceServiceMessageRole.assistant,
        acceptedCount > 0
          ? `已经确认完了，其中 ${acceptedCount} 段会用于生成声音。你可以再听一遍，确认后我就开始训练。`
          : '这些片段都没有采用。你可以继续添加其他素材，我会重新帮你整理。',
        now
      );
    }

    await this.voiceServiceSessionModel.save(session);

    return this.buildSessionRecord(session);
  }

  async requestClipRecut(
    auth: AuthenticatedUserPayload,
    sessionId: string,
    clipId: string,
    payload: RecutVoiceServiceClipDTO
  ): Promise<VoiceServiceSessionDTO> {
    const session = await this.getUserSession(auth, sessionId);
    if (session.status !== VoiceServiceSessionStatus.reviewing) {
      throw new AppError(
        'VOICE_SERVICE_NOT_REVIEWING',
        'voice clips are not ready for review',
        400
      );
    }
    this.assertDataDeletionSettled(session);

    const clip = (session.reviewClips ?? []).find(item => item.id === clipId);
    if (!clip) {
      throw new AppError(
        'VOICE_SERVICE_CLIP_NOT_FOUND',
        'voice review clip not found',
        404
      );
    }
    if (this.isClipRecutActive(clip.recutStatus)) {
      throw new AppError(
        'VOICE_SERVICE_CLIP_RECUT_IN_PROGRESS',
        '这个片段已经在重新剪辑',
        409
      );
    }

    const instruction = this.normalizeText(payload?.instruction, 200);
    if (!instruction) {
      throw new AppError(
        'VOICE_SERVICE_RECUT_INSTRUCTION_REQUIRED',
        '请填写这个片段要怎么剪',
        400
      );
    }
    resolveVoiceClipRecutRange(
      instruction,
      clip.qualityMetrics?.durationSeconds ?? clip.durationSeconds ?? 0
    );

    const now = new Date();
    const recutJobId = this.buildClipRecutJobId(session, clipId, now);
    const recutAttempt: VoiceServiceClipRecutAttemptItem = {
      id: this.createItemId('clip-recut'),
      jobId: recutJobId,
      instruction,
      status: 'queued',
      sourceObjectKeyHash: this.hashObjectKey(clip.objectKey),
      sourceDurationSeconds: clip.durationSeconds,
      sourceTranscript: clip.transcript,
      previousReviewStatus: clip.reviewStatus,
      previousRejectionReason: clip.rejectionReason,
      requestedAt: now,
    };
    clip.recutHistory = [...(clip.recutHistory ?? []), recutAttempt].slice(-20);
    clip.reviewStatus = VoiceServiceClipReviewStatus.pending;
    clip.rejectionReason = '';
    clip.reviewedAt = undefined;
    clip.recutStatus = 'queued';
    clip.recutInstruction = instruction;
    clip.recutJobId = recutJobId;
    clip.recutRequestedAt = now;
    clip.recutStartedAt = undefined;
    clip.recutCompletedAt = undefined;
    clip.recutFailureCode = undefined;
    clip.recutFailureReason = undefined;
    session.updatedAt = now;
    session.events = this.appendEvent(
      session.events,
      VoiceServiceEventType.clipRecutRequested,
      '用户要求重新剪辑声音片段',
      now,
      { clipId, recutJobId, instruction }
    );
    this.updateReviewObservabilityFromClips(session);
    await this.voiceServiceSessionModel.save(session);
    await this.enqueueClipRecutJob(session, clip);

    const currentSession = await this.getSessionById(sessionId);
    return this.buildSessionRecord(currentSession);
  }

  async startTraining(
    auth: AuthenticatedUserPayload,
    sessionId: string,
    payload: StartVoiceServiceTrainingDTO = {}
  ): Promise<VoiceServiceSessionDTO> {
    const session = await this.getUserSession(auth, sessionId);
    const userId = this.parseObjectId(auth.sub, 'INVALID_TOKEN');
    const clips = session.reviewClips ?? [];
    const acceptedCount = clips.filter(
      item => item.reviewStatus === VoiceServiceClipReviewStatus.accepted
    ).length;

    const retryingTraining =
      session.status === VoiceServiceSessionStatus.failed &&
      session.failureStage === VoiceServiceFailureStage.training;
    if (
      session.status !== VoiceServiceSessionStatus.reviewing &&
      !retryingTraining
    ) {
      throw new AppError(
        'VOICE_SERVICE_NOT_REVIEWING',
        'voice clips are not ready for training',
        400
      );
    }
    if (acceptedCount === 0) {
      throw new AppError(
        'VOICE_SERVICE_ACCEPTED_CLIP_REQUIRED',
        'at least one accepted voice clip is required',
        400
      );
    }

    if (payload?.agentId) {
      const previewAgentId = this.parseObjectId(
        payload.agentId,
        'INVALID_AGENT_ID'
      );
      const previewAgent = await this.findAgent(previewAgentId);
      if (
        !previewAgent ||
        this.stringifyObjectId(previewAgent.createdUserId) !== String(userId)
      ) {
        throw new AppError('AGENT_NOT_FOUND', 'agent not found', 404);
      }
      session.previewAgentId = previewAgentId;
      session.previewText = buildVoicePreviewText(previewAgent.agentCallMe);
    } else if (!session.previewText?.trim()) {
      session.previewAgentId = undefined;
      session.previewText = buildVoicePreviewText();
    }

    const now = new Date();
    session.status = VoiceServiceSessionStatus.training;
    session.failureReason = '';
    session.failureStage = undefined;
    session.voiceTimbreId = undefined;
    session.previewAudioUrl = undefined;
    session.trainingAudioObjectKey = undefined;
    session.trainingJobId = this.buildTrainingJobId(session, now);
    session.trainingStartedAt = now;
    session.trainingCompletedAt = undefined;
    session.observability = {
      ...(session.observability ?? {}),
      trainingQueueDurationMs: undefined,
      trainingAttemptCount:
        (session.observability?.trainingAttemptCount ?? 0) + 1,
    };
    session.processingAttempts = this.appendProcessingAttempt(
      session.processingAttempts,
      {
        id: this.createItemId('attempt'),
        stage: 'training',
        jobId: session.trainingJobId,
        queuedAt: now,
        outcome: 'processing',
        platformErrors: [],
      }
    );
    session.updatedAt = now;
    session.messages = this.appendMessage(
      session.messages,
      VoiceServiceMessageRole.assistant,
      `好的，我会使用你确认的 ${acceptedCount} 段声音开始免费训练。完成后先请你试听，觉得合适再到会员服务看看是否需要开通声音服务。`,
      now
    );
    session.events = this.appendEvent(
      session.events,
      VoiceServiceEventType.trainingStarted,
      `使用 ${acceptedCount} 段声音开始训练`,
      now,
      {
        acceptedClipCount: acceptedCount,
        previewText: session.previewText,
        ...(session.previewAgentId
          ? { previewAgentId: this.stringifyObjectId(session.previewAgentId) }
          : {}),
      }
    );
    await this.voiceServiceSessionModel.save(session);
    await this.enqueueTrainingJob(session);

    return this.buildSessionRecord(session);
  }

  async selectAgent(
    auth: AuthenticatedUserPayload,
    sessionId: string,
    payload: SelectVoiceServiceAgentDTO
  ): Promise<VoiceServiceSessionDTO> {
    const session = await this.getUserSession(auth, sessionId);

    if (
      session.status !== VoiceServiceSessionStatus.previewReady &&
      session.status !== VoiceServiceSessionStatus.completed
    ) {
      throw new AppError(
        'VOICE_SERVICE_TIMBRE_NOT_READY',
        'voice timbre is not ready',
        400
      );
    }

    const userId = this.parseObjectId(auth.sub, 'INVALID_TOKEN');
    const agentId = this.parseObjectId(payload?.agentId, 'INVALID_AGENT_ID');
    const agent = await this.findAgent(agentId);

    if (
      !agent ||
      this.stringifyObjectId(agent.createdUserId) !== String(userId)
    ) {
      throw new AppError('AGENT_NOT_FOUND', 'agent not found', 404);
    }

    const now = new Date();
    const access = await this.voiceUsageAccessService.resolve(userId);
    session.selectedAgentId = agentId;
    session.status = VoiceServiceSessionStatus.completed;
    this.applyVoiceAccessRecord(session, access, now);
    const bindingStatus = await this.bindSessionTimbreToAgent(
      session,
      agent,
      access,
      now
    );
    session.updatedAt = now;
    session.messages = this.appendMessage(
      session.messages,
      VoiceServiceMessageRole.assistant,
      this.buildAgentSelectionMessage(agent.name || '未命名', bindingStatus),
      now
    );
    session.events = this.appendEvent(
      session.events,
      VoiceServiceEventType.agentSelected,
      `选择${brandName()}：${agent.name || '未命名'}`,
      now,
      {
        agentId: this.stringifyObjectId(agentId),
        agentName: agent.name || '未命名',
        voiceAccessEligible: access.eligible,
        voiceBindingStatus: bindingStatus,
      }
    );
    await this.voiceServiceSessionModel.save(session);

    return this.buildSessionRecord(session, access);
  }

  async publishReviewClips(
    sessionId: string,
    clips: Array<{
      sourceMaterialId?: string;
      sourceName?: string;
      objectKey: string;
      publicUrl?: string;
      durationSeconds?: number;
      transcript?: string;
      speakerId?: string;
      qualityScore?: number;
      qualityLabel?: string;
      qualityMetrics?: VoiceServiceClipQualityMetrics;
      qualityIssues?: VoiceServiceClipQualityIssue[];
    }>,
    expectedClippingJobId?: string,
    clippingResult?: VoiceClippingBatchResult,
    workerAttempt?: number
  ): Promise<VoiceServiceSessionDTO> {
    const session = await this.getSessionById(sessionId);
    if (
      session.status !== VoiceServiceSessionStatus.analyzing ||
      (expectedClippingJobId &&
        !this.isCurrentJob(session.clippingJobId, expectedClippingJobId))
    ) {
      return this.buildSessionRecord(session);
    }
    const now = new Date();
    const normalizedClips = clips
      .map<VoiceServiceReviewClipItem | null>(item => {
        const objectKey = this.normalizeObjectKey(item?.objectKey);
        if (!objectKey) {
          return null;
        }

        return {
          id: this.createItemId('clip'),
          sourceMaterialId: this.normalizeText(item?.sourceMaterialId, 80),
          sourceName: this.normalizeText(item?.sourceName, 120),
          objectKey,
          publicUrl: this.resolvePublicUrl(objectKey, item?.publicUrl),
          durationSeconds: this.normalizeDuration(item?.durationSeconds),
          transcript: this.normalizeText(item?.transcript, 300),
          speakerId: this.normalizeText(item?.speakerId, 40),
          qualityScore: this.normalizeScore(item?.qualityScore),
          qualityLabel: this.normalizeText(item?.qualityLabel, 80),
          qualityMetrics: this.normalizeQualityMetrics(item?.qualityMetrics),
          qualityIssues: this.normalizeQualityIssues(item?.qualityIssues),
          reviewStatus: VoiceServiceClipReviewStatus.pending,
          createdAt: now,
        };
      })
      .filter((item): item is VoiceServiceReviewClipItem => Boolean(item));
    const normalizedFilteredClips = (clippingResult?.filteredClips ?? []).map(
      item =>
        ({
          id: this.createItemId('filtered-clip'),
          sourceMaterialId: this.normalizeText(item.sourceMaterialId, 80),
          sourceName: this.normalizeText(item.sourceName, 120),
          durationSeconds: this.normalizePreciseDuration(item.durationSeconds),
          transcript: this.normalizeText(item.transcript, 300),
          speakerId: this.normalizeText(item.speakerId, 40),
          qualityMetrics: this.normalizeQualityMetrics(item.qualityMetrics),
          qualityIssues: this.normalizeQualityIssues(item.qualityIssues),
          createdAt: now,
        } as VoiceServiceFilteredClipItem)
    );

    if (normalizedClips.length === 0 && normalizedFilteredClips.length === 0) {
      throw new AppError(
        'VOICE_SERVICE_REVIEW_CLIP_REQUIRED',
        'voice review clip is required',
        400
      );
    }

    session.reviewClips = normalizedClips;
    session.filteredClips = normalizedFilteredClips;
    session.status = VoiceServiceSessionStatus.reviewing;
    session.failureReason = '';
    session.failureStage = undefined;
    session.clippingCompletedAt = now;
    this.applyClippingTelemetry(
      session,
      expectedClippingJobId || session.clippingJobId,
      clippingResult?.metrics,
      clippingResult?.platformErrors ?? [],
      workerAttempt
    );
    session.observability = {
      ...(session.observability ?? {}),
      generatedClipCount: normalizedClips.length,
      filteredClipCount: normalizedFilteredClips.length,
      volumeAdjustedClipCount: normalizedClips.filter(
        item => item.qualityMetrics?.volumeAdjusted
      ).length,
      reviewedClipCount: 0,
      acceptedClipCount: 0,
      rejectedClipCount: 0,
      userAdoptionRate: undefined,
    };
    const clippingAttempt = this.findProcessingAttempt(
      session,
      'clipping',
      expectedClippingJobId || session.clippingJobId
    );
    if (clippingAttempt) {
      clippingAttempt.generatedClipCount = normalizedClips.length;
      clippingAttempt.filteredClipCount = normalizedFilteredClips.length;
      clippingAttempt.volumeAdjustedClipCount = normalizedClips.filter(
        item => item.qualityMetrics?.volumeAdjusted
      ).length;
      clippingAttempt.reviewedClipCount = 0;
      clippingAttempt.acceptedClipCount = 0;
      clippingAttempt.rejectedClipCount = 0;
      clippingAttempt.userAdoptionRate = undefined;
      clippingAttempt.completedAt = now;
      clippingAttempt.outcome = 'succeeded';
    }
    session.updatedAt = now;
    session.messages = this.appendMessage(
      session.messages,
      VoiceServiceMessageRole.assistant,
      normalizedClips.length > 0
        ? `我整理出了 ${normalizedClips.length} 段可能属于他的声音。${
            normalizedFilteredClips.length
              ? `另有 ${normalizedFilteredClips.length} 段因时长、静音、削波、音量或背景噪声问题已提前排除。`
              : ''
          }请你逐段听一听，只有你确认可以使用的片段才会参加训练。`
        : `检测到的 ${normalizedFilteredClips.length} 段声音都有明显质量问题，已经提前排除。原因列在下面，你可以返回添加其他素材。`,
      now
    );
    session.events = this.appendEvent(
      session.events,
      VoiceServiceEventType.reviewClipsReady,
      `生成 ${normalizedClips.length} 段待确认声音，过滤 ${normalizedFilteredClips.length} 段`,
      now,
      {
        clipCount: normalizedClips.length,
        filteredClipCount: normalizedFilteredClips.length,
        volumeAdjustedClipCount:
          session.observability?.volumeAdjustedClipCount ?? 0,
        clippingQueueDurationMs:
          session.observability?.clippingQueueDurationMs ?? 0,
        recognitionDurationMs:
          session.observability?.recognitionDurationMs ?? 0,
      }
    );
    await this.voiceServiceSessionModel.save(session);
    this.logObservability(session, 'clipping_succeeded');

    return this.buildSessionRecord(session);
  }

  async processClippingJob(
    data: VoiceServiceClippingJobData,
    options: ProcessVoiceServiceClippingJobOptions = {}
  ): Promise<void> {
    const session = await this.getSessionById(data.sessionId);
    const expectedClippingJobId = this.resolveJobId(
      data.clippingJobId,
      options.jobId
    );

    if (
      session.status !== VoiceServiceSessionStatus.analyzing ||
      !this.isCurrentJob(session.clippingJobId, expectedClippingJobId)
    ) {
      return;
    }

    const processingSession = await this.markProcessingStarted(
      session,
      'clipping',
      expectedClippingJobId
    );
    if (!processingSession) {
      return;
    }

    try {
      const clippingResult = this.voiceClippingService
        .createReviewClipsWithMetrics
        ? await this.voiceClippingService.createReviewClipsWithMetrics(
            processingSession.materials ?? [],
            processingSession.processingMode ??
              VoiceServiceProcessingMode.assisted
          )
        : {
            clips: await this.voiceClippingService.createReviewClips(
              processingSession.materials ?? [],
              processingSession.processingMode ??
                VoiceServiceProcessingMode.assisted
            ),
            metrics: {
              recognitionDurationMs: 0,
              recognitionMaterialCount: 0,
            },
            filteredClips: [],
            platformErrors: [],
          };
      const published = await this.publishReviewClips(
        data.sessionId,
        clippingResult.clips,
        expectedClippingJobId,
        clippingResult,
        options.workerAttempt
      );
      if (published.status !== VoiceServiceSessionStatus.reviewing) {
        await this.voiceServiceDataDeletionService.cleanupLateObjectKeys(
          data.sessionId,
          [
            ...clippingResult.clips.map(item => item.objectKey),
            ...(clippingResult.metrics.residualAnalysisObjectKeys ?? []),
          ]
        );
      }
    } catch (error) {
      const clippingMetrics = this.readClippingMetrics(
        this.readRecord(error instanceof AppError ? error.data : null)
          ?.voiceClippingMetrics
      );
      if (clippingMetrics?.residualAnalysisObjectKeys?.length) {
        await this.voiceServiceDataDeletionService.cleanupLateObjectKeys(
          data.sessionId,
          clippingMetrics.residualAnalysisObjectKeys
        );
      }
      await this.recordProcessingError(
        data.sessionId,
        'clipping',
        expectedClippingJobId,
        error,
        options.workerAttempt
      );
      this.logger.error(
        '[voice-clipping] job failed, sessionId=%s, finalAttempt=%s, reason=%s',
        data.sessionId,
        options.isFinalAttempt === true,
        error instanceof Error ? error.message : String(error)
      );

      if (options.isFinalAttempt) {
        await this.markClippingFailed(session, error, expectedClippingJobId);
      }

      throw error;
    }
  }

  async processClipRecutJob(
    data: VoiceServiceClippingJobData,
    options: ProcessVoiceServiceClippingJobOptions = {}
  ): Promise<void> {
    const clipId = this.normalizeText(data.clipId, 80);
    const expectedRecutJobId = this.resolveJobId(
      data.recutJobId,
      options.jobId
    );
    if (!clipId || !expectedRecutJobId) {
      return;
    }

    const session = await this.getSessionById(data.sessionId);
    const clip = (session.reviewClips ?? []).find(item => item.id === clipId);
    if (
      session.status !== VoiceServiceSessionStatus.reviewing ||
      !clip ||
      !this.isClipRecutActive(clip.recutStatus) ||
      !this.isCurrentJob(clip.recutJobId, expectedRecutJobId)
    ) {
      return;
    }

    const now = new Date();
    clip.recutStatus = 'processing';
    clip.recutStartedAt ??= now;
    const attempt = this.findClipRecutAttempt(clip, expectedRecutJobId);
    if (attempt) {
      attempt.status = 'processing';
      attempt.startedAt ??= now;
      attempt.queueDurationMs = Math.max(
        0,
        attempt.startedAt.getTime() - attempt.requestedAt.getTime()
      );
    }
    session.updatedAt = now;
    await this.voiceServiceSessionModel.save(session);

    let result: VoiceClipRecutResult | undefined;
    try {
      result = await this.voiceClippingService.recutReviewClip({
        objectKey: clip.objectKey,
        fileName: `${clip.id}.mp3`,
        durationSeconds:
          clip.qualityMetrics?.durationSeconds ?? clip.durationSeconds ?? 0,
        instruction: clip.recutInstruction ?? '',
        sourceMaterialId: clip.sourceMaterialId,
        sourceName: clip.sourceName,
        speakerId: clip.speakerId,
      });
      await this.completeClipRecut(
        data.sessionId,
        clipId,
        expectedRecutJobId,
        result
      );
    } catch (error) {
      if (result?.objectKey) {
        await this.voiceServiceDataDeletionService.cleanupLateObjectKeys(
          data.sessionId,
          [result.objectKey]
        );
      }
      this.logger.error(
        '[voice-clip-recut] job failed, sessionId=%s, clipId=%s, finalAttempt=%s, reason=%s',
        data.sessionId,
        clipId,
        options.isFinalAttempt === true,
        error instanceof Error ? error.message : String(error)
      );
      if (options.isFinalAttempt) {
        await this.markClipRecutFailed(
          data.sessionId,
          clipId,
          expectedRecutJobId,
          error
        );
      }
      throw error;
    }
  }

  private async completeClipRecut(
    sessionId: string,
    clipId: string,
    expectedRecutJobId: string,
    result: VoiceClipRecutResult
  ): Promise<void> {
    const session = await this.getSessionById(sessionId);
    const clip = (session.reviewClips ?? []).find(item => item.id === clipId);
    const objectKey = this.normalizeObjectKey(result.objectKey);
    if (
      session.status !== VoiceServiceSessionStatus.reviewing ||
      !clip ||
      !this.isClipRecutActive(clip.recutStatus) ||
      !this.isCurrentJob(clip.recutJobId, expectedRecutJobId) ||
      !objectKey
    ) {
      if (objectKey) {
        await this.voiceServiceDataDeletionService.cleanupLateObjectKeys(
          sessionId,
          [objectKey]
        );
      }
      return;
    }

    const previousObjectKey = clip.objectKey;
    const now = new Date();
    clip.objectKey = objectKey;
    clip.publicUrl = this.resolvePublicUrl(objectKey, result.publicUrl);
    clip.durationSeconds = this.normalizeDuration(result.durationSeconds);
    clip.transcript = undefined;
    clip.speakerId = this.normalizeText(result.speakerId, 40) || undefined;
    clip.qualityScore = this.normalizeScore(result.qualityScore);
    clip.qualityLabel = this.normalizeText(result.qualityLabel, 80);
    clip.qualityMetrics = this.normalizeQualityMetrics(result.qualityMetrics);
    clip.qualityIssues = this.normalizeQualityIssues(result.qualityIssues);
    clip.reviewStatus = VoiceServiceClipReviewStatus.pending;
    clip.rejectionReason = '';
    clip.reviewedAt = undefined;
    clip.recutStatus = 'completed';
    clip.recutCompletedAt = now;
    clip.recutFailureCode = undefined;
    clip.recutFailureReason = undefined;
    const attempt = this.findClipRecutAttempt(clip, expectedRecutJobId);
    if (attempt) {
      attempt.status = 'completed';
      attempt.completedAt = now;
      attempt.processingDurationMs = Math.max(
        0,
        now.getTime() - (attempt.startedAt ?? attempt.requestedAt).getTime()
      );
      attempt.resultObjectKeyHash = this.hashObjectKey(objectKey);
      attempt.resultDurationSeconds = clip.durationSeconds;
      attempt.failureCode = undefined;
      attempt.failureReason = undefined;
    }
    session.updatedAt = now;
    session.events = this.appendEvent(
      session.events,
      VoiceServiceEventType.clipRecutCompleted,
      '声音片段重新剪辑完成，等待再次确认',
      now,
      {
        clipId,
        recutJobId: expectedRecutJobId,
        durationSeconds: clip.durationSeconds ?? 0,
        startSeconds: result.range.startSeconds,
        endSeconds: result.range.endSeconds,
      }
    );
    await this.voiceServiceSessionModel.save(session);

    if (previousObjectKey && previousObjectKey !== objectKey) {
      await this.voiceServiceDataDeletionService.cleanupLateObjectKeys(
        sessionId,
        [previousObjectKey]
      );
    }
  }

  async processTrainingJob(
    data: VoiceServiceTrainingJobData,
    options: ProcessVoiceServiceTrainingJobOptions = {}
  ): Promise<void> {
    const session = await this.getSessionById(data.sessionId);
    const expectedTrainingJobId = this.resolveJobId(
      data.trainingJobId,
      options.jobId
    );

    if (
      session.status !== VoiceServiceSessionStatus.training ||
      !this.isCurrentJob(session.trainingJobId, expectedTrainingJobId)
    ) {
      return;
    }

    const processingSession = await this.markProcessingStarted(
      session,
      'training',
      expectedTrainingJobId
    );
    if (!processingSession) {
      return;
    }

    try {
      const result = await this.voiceModelTrainingService.train(
        processingSession
      );
      const completed = await this.completeTraining(
        data.sessionId,
        {
          voiceTimbreId: result.voiceTimbreId,
          previewAudioUrl: result.previewAudioUrl,
          previewAudioObjectKey: result.previewAudioObjectKey,
          trainingAudioObjectKey: result.trainingAudioObjectKey,
        },
        expectedTrainingJobId
      );
      if (completed.status !== VoiceServiceSessionStatus.previewReady) {
        await this.voiceServiceDataDeletionService.cleanupLateTimbre(
          data.sessionId,
          result.voiceTimbreId
        );
      }
    } catch (error) {
      const currentSession = await this.getSessionById(data.sessionId);
      if (currentSession.dataDeletionRequestedAt) {
        await this.voiceServiceDataDeletionService.cleanupLateSessionTimbres(
          data.sessionId
        );
      }
      await this.recordProcessingError(
        data.sessionId,
        'training',
        expectedTrainingJobId,
        error,
        options.workerAttempt
      );
      this.logger.error(
        '[voice-training] job failed, sessionId=%s, finalAttempt=%s, reason=%s',
        data.sessionId,
        options.isFinalAttempt === true,
        error instanceof Error ? error.message : String(error)
      );

      if (options.isFinalAttempt) {
        await this.markTrainingFailed(session, error, expectedTrainingJobId);
      }

      throw error;
    }
  }

  async completeTraining(
    sessionId: string,
    input: {
      voiceTimbreId: string;
      previewAudioUrl?: string;
      previewAudioObjectKey?: string;
      trainingAudioObjectKey?: string;
    },
    expectedTrainingJobId?: string
  ): Promise<VoiceServiceSessionDTO> {
    const session = await this.getSessionById(sessionId);
    if (
      session.status !== VoiceServiceSessionStatus.training ||
      (expectedTrainingJobId &&
        !this.isCurrentJob(session.trainingJobId, expectedTrainingJobId))
    ) {
      return this.buildSessionRecord(session);
    }
    const voiceTimbreId = this.parseObjectId(
      input?.voiceTimbreId,
      'INVALID_VOICE_TIMBRE_ID'
    );
    const now = new Date();
    session.voiceTimbreId = voiceTimbreId;
    session.previewAudioUrl = this.normalizeText(input?.previewAudioUrl, 1000);
    session.previewAudioObjectKey = this.normalizeVoiceObjectKey(
      input?.previewAudioObjectKey,
      'voice-timbre-previews'
    );
    session.trainingAudioObjectKey = this.normalizeTrainingObjectKey(
      input?.trainingAudioObjectKey
    );
    session.status = VoiceServiceSessionStatus.previewReady;
    session.failureReason = '';
    session.failureStage = undefined;
    session.trainingCompletedAt = now;
    this.completeProcessingAttempt(
      session,
      'training',
      expectedTrainingJobId || session.trainingJobId,
      'succeeded',
      now
    );
    this.completeTrainingMetric(session, true);
    session.updatedAt = now;
    session.messages = this.appendMessage(
      session.messages,
      VoiceServiceMessageRole.assistant,
      `声音已经生成好了。你可以先试听，确认满意后再选择要使用这个声音的${brandName()}。`,
      now
    );
    session.events = this.appendEvent(
      session.events,
      VoiceServiceEventType.trainingCompleted,
      `声音训练完成，等待试听和选择${brandName()}`,
      now,
      {
        voiceTimbreId: this.stringifyObjectId(voiceTimbreId),
        trainingQueueDurationMs:
          session.observability?.trainingQueueDurationMs ?? 0,
        trainingSuccessRate: session.observability?.trainingSuccessRate ?? 0,
      }
    );
    await this.voiceServiceSessionModel.save(session);
    this.logObservability(session, 'training_succeeded');

    return this.buildSessionRecord(session);
  }

  private async ensureClippingQueued(
    session: VoiceServiceSessionEntity
  ): Promise<void> {
    let changed = false;

    if (!session.clippingStartedAt) {
      session.clippingStartedAt = new Date();
      changed = true;
    }
    if (!session.clippingJobId) {
      session.clippingJobId = this.buildClippingJobId(
        session,
        session.clippingStartedAt
      );
      changed = true;
    }
    if (
      !this.findProcessingAttempt(session, 'clipping', session.clippingJobId)
    ) {
      session.processingAttempts = this.appendProcessingAttempt(
        session.processingAttempts,
        {
          id: this.createItemId('attempt'),
          stage: 'clipping',
          jobId: session.clippingJobId,
          processingMode: session.processingMode,
          queuedAt: session.clippingStartedAt,
          outcome: 'processing',
          platformErrors: [],
        }
      );
      changed = true;
    }
    if (changed) {
      await this.voiceServiceSessionModel.save(session);
    }

    await this.enqueueClippingJob(session);
  }

  private async ensureClipRecutsQueued(
    session: VoiceServiceSessionEntity
  ): Promise<void> {
    for (const clip of session.reviewClips ?? []) {
      if (clip.recutStatus === 'queued' && clip.recutJobId) {
        await this.enqueueClipRecutJob(session, clip);
      }
    }
  }

  private async enqueueClipRecutJob(
    session: VoiceServiceSessionEntity,
    clip: VoiceServiceReviewClipItem
  ): Promise<boolean> {
    const queue = this.bullmqFramework?.getQueue(VOICE_SERVICE_CLIPPING_QUEUE);
    const sessionId = this.stringifyObjectId(session.id);
    const recutJobId = this.normalizeText(clip.recutJobId, 300);
    if (!queue || !recutJobId) {
      const error = new AppError(
        'VOICE_SERVICE_CLIPPING_QUEUE_UNAVAILABLE',
        '重新剪辑服务暂时不可用，请稍后重试',
        503
      );
      await this.markClipRecutFailed(sessionId, clip.id, recutJobId, error);
      return false;
    }

    try {
      await queue.addJobToQueue(
        {
          jobType: 'clip_recut',
          sessionId,
          clipId: clip.id,
          recutJobId,
        },
        {
          jobId: recutJobId,
          attempts: 3,
          removeOnComplete: true,
          removeOnFail: true,
          backoff: {
            type: 'exponential',
            delay: 3000,
          },
        }
      );
      return true;
    } catch (error) {
      this.logger.error(
        '[voice-clip-recut] enqueue failed, sessionId=%s, clipId=%s, reason=%s',
        sessionId,
        clip.id,
        error instanceof Error ? error.message : String(error)
      );
      await this.markClipRecutFailed(sessionId, clip.id, recutJobId, error);
      return false;
    }
  }

  private async markClipRecutFailed(
    sessionId: string,
    clipId: string,
    expectedRecutJobId: string,
    error: unknown
  ): Promise<void> {
    const session = await this.getSessionById(sessionId);
    const clip = (session.reviewClips ?? []).find(item => item.id === clipId);
    if (
      session.status !== VoiceServiceSessionStatus.reviewing ||
      !clip ||
      !this.isCurrentJob(clip.recutJobId, expectedRecutJobId)
    ) {
      return;
    }

    const now = new Date();
    const failureCode =
      error instanceof AppError ? error.code : 'VOICE_SERVICE_RECUT_FAILED';
    const failureReason =
      error instanceof AppError && /[\u3400-\u9fff]/.test(error.message)
        ? error.message
        : '这次重新剪辑没有完成，原片段还在，请调整剪法后重试';
    clip.recutStatus = 'failed';
    clip.recutCompletedAt = now;
    clip.recutFailureCode = failureCode;
    clip.recutFailureReason = failureReason;
    const attempt = this.findClipRecutAttempt(clip, expectedRecutJobId);
    if (attempt) {
      attempt.status = 'failed';
      attempt.completedAt = now;
      attempt.processingDurationMs = Math.max(
        0,
        now.getTime() - (attempt.startedAt ?? attempt.requestedAt).getTime()
      );
      attempt.failureCode = failureCode;
      attempt.failureReason = failureReason;
    }
    session.updatedAt = now;
    session.events = this.appendEvent(
      session.events,
      VoiceServiceEventType.clipRecutFailed,
      '声音片段重新剪辑失败，原片段已保留',
      now,
      { clipId, recutJobId: expectedRecutJobId, failureCode }
    );
    await this.voiceServiceSessionModel.save(session);
  }

  private async enqueueClippingJob(
    session: VoiceServiceSessionEntity
  ): Promise<boolean> {
    const queue = this.bullmqFramework?.getQueue(VOICE_SERVICE_CLIPPING_QUEUE);

    if (!queue) {
      const error = new AppError(
        'VOICE_SERVICE_CLIPPING_QUEUE_UNAVAILABLE',
        'voice clipping queue is unavailable',
        503
      );
      await this.recordProcessingError(
        this.stringifyObjectId(session.id),
        'clipping',
        session.clippingJobId,
        error
      );
      await this.markClippingFailed(session, error, session.clippingJobId);
      return false;
    }

    const jobId =
      session.clippingJobId || this.buildClippingJobId(session, new Date());
    session.clippingJobId = jobId;

    try {
      await queue.addJobToQueue(
        { sessionId: this.stringifyObjectId(session.id), clippingJobId: jobId },
        {
          jobId,
          attempts: 3,
          removeOnComplete: true,
          removeOnFail: true,
          backoff: {
            type: 'exponential',
            delay: 5000,
          },
        }
      );
      return true;
    } catch (error) {
      this.logger.error(
        '[voice-clipping] enqueue failed, sessionId=%s, reason=%s',
        this.stringifyObjectId(session.id),
        error instanceof Error ? error.message : String(error)
      );
      await this.recordProcessingError(
        this.stringifyObjectId(session.id),
        'clipping',
        jobId,
        error
      );
      await this.markClippingFailed(session, error, jobId);
      return false;
    }
  }

  private async markClippingFailed(
    session: VoiceServiceSessionEntity,
    error: unknown,
    expectedClippingJobId?: string
  ): Promise<void> {
    const currentSession = await this.getSessionById(
      this.stringifyObjectId(session.id)
    );
    if (
      currentSession.status !== VoiceServiceSessionStatus.analyzing ||
      (expectedClippingJobId &&
        !this.isCurrentJob(currentSession.clippingJobId, expectedClippingJobId))
    ) {
      return;
    }

    const now = new Date();
    const noUsableAudio =
      error instanceof AppError &&
      error.code === 'VOICE_SERVICE_NO_USABLE_AUDIO';
    const analysisUnavailable =
      error instanceof AppError &&
      error.code === 'VOICE_SERVICE_ANALYSIS_UNAVAILABLE';
    const userMessage = analysisUnavailable
      ? '这次没能完成声音识别。为了避免把电子音或其他声音当成人声，我没有生成未经确认的切片。素材已经保留，可以稍后直接重新整理。'
      : noUsableAudio
      ? '这次没有从素材里找到清晰、完整的人声。请检查视频是否能正常听到他的声音，也可以换一份微信语音录屏后重新提交。'
      : '这次整理声音时没有成功，素材已经替你保留。你可以稍后重新提交，不需要再次上传。';

    currentSession.status = VoiceServiceSessionStatus.failed;
    currentSession.failureReason = userMessage;
    currentSession.failureStage = VoiceServiceFailureStage.clipping;
    currentSession.clippingCompletedAt = now;
    this.completeProcessingAttempt(
      currentSession,
      'clipping',
      expectedClippingJobId || currentSession.clippingJobId,
      'failed',
      now
    );
    currentSession.updatedAt = now;
    currentSession.messages = this.appendMessage(
      currentSession.messages,
      VoiceServiceMessageRole.assistant,
      userMessage,
      now
    );
    await this.voiceServiceSessionModel.save(currentSession);
    this.logObservability(currentSession, 'clipping_failed');
  }

  private async ensureTrainingQueued(
    session: VoiceServiceSessionEntity
  ): Promise<void> {
    let changed = false;

    if (!session.trainingStartedAt) {
      session.trainingStartedAt = new Date();
      changed = true;
    }
    if (!session.trainingJobId) {
      session.trainingJobId = this.buildTrainingJobId(
        session,
        session.trainingStartedAt
      );
      changed = true;
    }
    if (
      !this.findProcessingAttempt(session, 'training', session.trainingJobId)
    ) {
      session.processingAttempts = this.appendProcessingAttempt(
        session.processingAttempts,
        {
          id: this.createItemId('attempt'),
          stage: 'training',
          jobId: session.trainingJobId,
          queuedAt: session.trainingStartedAt,
          outcome: 'processing',
          platformErrors: [],
        }
      );
      session.observability = {
        ...(session.observability ?? {}),
        trainingAttemptCount: Math.max(
          1,
          session.observability?.trainingAttemptCount ?? 0
        ),
      };
      changed = true;
    }
    if (changed) {
      await this.voiceServiceSessionModel.save(session);
    }

    await this.enqueueTrainingJob(session);
  }

  private async enqueueTrainingJob(
    session: VoiceServiceSessionEntity
  ): Promise<boolean> {
    const queue = this.bullmqFramework?.getQueue(VOICE_SERVICE_TRAINING_QUEUE);

    if (!queue) {
      const error = new AppError(
        'VOICE_SERVICE_TRAINING_QUEUE_UNAVAILABLE',
        'voice training queue is unavailable',
        503
      );
      await this.recordProcessingError(
        this.stringifyObjectId(session.id),
        'training',
        session.trainingJobId,
        error
      );
      await this.markTrainingFailed(session, error, session.trainingJobId);
      return false;
    }

    const jobId =
      session.trainingJobId || this.buildTrainingJobId(session, new Date());
    session.trainingJobId = jobId;

    try {
      await queue.addJobToQueue(
        { sessionId: this.stringifyObjectId(session.id), trainingJobId: jobId },
        {
          jobId,
          attempts: 3,
          removeOnComplete: true,
          removeOnFail: true,
          backoff: {
            type: 'exponential',
            delay: 10000,
          },
        }
      );
      return true;
    } catch (error) {
      this.logger.error(
        '[voice-training] enqueue failed, sessionId=%s, reason=%s',
        this.stringifyObjectId(session.id),
        error instanceof Error ? error.message : String(error)
      );
      await this.recordProcessingError(
        this.stringifyObjectId(session.id),
        'training',
        jobId,
        error
      );
      await this.markTrainingFailed(session, error, jobId);
      return false;
    }
  }

  private async markTrainingFailed(
    session: VoiceServiceSessionEntity,
    error: unknown,
    expectedTrainingJobId?: string
  ): Promise<void> {
    const currentSession = await this.getSessionById(
      this.stringifyObjectId(session.id)
    );
    if (
      currentSession.status !== VoiceServiceSessionStatus.training ||
      (expectedTrainingJobId &&
        !this.isCurrentJob(currentSession.trainingJobId, expectedTrainingJobId))
    ) {
      return;
    }

    const now = new Date();
    const userMessage =
      '这次生成声音没有成功，但你上传的素材和确认结果都还在。可以稍后直接重新生成，不需要再次审核。';
    currentSession.status = VoiceServiceSessionStatus.failed;
    currentSession.failureReason = userMessage;
    currentSession.failureStage = VoiceServiceFailureStage.training;
    currentSession.trainingCompletedAt = now;
    this.completeProcessingAttempt(
      currentSession,
      'training',
      expectedTrainingJobId || currentSession.trainingJobId,
      'failed',
      now
    );
    this.completeTrainingMetric(currentSession, false);
    currentSession.updatedAt = now;
    currentSession.messages = this.appendMessage(
      currentSession.messages,
      VoiceServiceMessageRole.assistant,
      userMessage,
      now
    );
    currentSession.events = this.appendEvent(
      currentSession.events,
      VoiceServiceEventType.trainingFailed,
      '声音生成失败，可保留审核结果后重试',
      now,
      {
        failureCode:
          error instanceof AppError
            ? error.code
            : 'VOICE_MODEL_TRAINING_FAILED',
        trainingSuccessRate:
          currentSession.observability?.trainingSuccessRate ?? 0,
      }
    );
    await this.voiceServiceSessionModel.save(currentSession);
    this.logObservability(currentSession, 'training_failed');
  }

  private async markProcessingStarted(
    session: VoiceServiceSessionEntity,
    stage: VoiceServiceProcessingStage,
    expectedJobId: string
  ): Promise<VoiceServiceSessionEntity | undefined> {
    const currentSession = await this.getSessionById(
      this.stringifyObjectId(session.id)
    );
    const currentJobId =
      stage === 'clipping'
        ? currentSession.clippingJobId
        : currentSession.trainingJobId;
    const expectedStatus =
      stage === 'clipping'
        ? VoiceServiceSessionStatus.analyzing
        : VoiceServiceSessionStatus.training;

    if (
      currentSession.status !== expectedStatus ||
      !this.isCurrentJob(currentJobId, expectedJobId)
    ) {
      return undefined;
    }

    const now = new Date();
    let attempt = this.findProcessingAttempt(
      currentSession,
      stage,
      expectedJobId || currentJobId
    );
    if (!attempt) {
      const queuedAt =
        (stage === 'clipping'
          ? currentSession.clippingStartedAt
          : currentSession.trainingStartedAt) ?? now;
      const createdAttempt: VoiceServiceProcessingAttemptItem = {
        id: this.createItemId('attempt'),
        stage,
        jobId: expectedJobId || currentJobId || '',
        processingMode:
          stage === 'clipping' ? currentSession.processingMode : undefined,
        queuedAt,
        outcome: 'processing',
        platformErrors: [],
      };
      currentSession.processingAttempts = this.appendProcessingAttempt(
        currentSession.processingAttempts,
        createdAttempt
      );
      attempt = createdAttempt;
    }

    if (!attempt.processingStartedAt) {
      attempt.processingStartedAt = now;
      attempt.queueDurationMs = Math.max(
        0,
        now.getTime() - new Date(attempt.queuedAt).getTime()
      );
      currentSession.observability = {
        ...(currentSession.observability ?? {}),
        ...(stage === 'clipping'
          ? { clippingQueueDurationMs: attempt.queueDurationMs }
          : { trainingQueueDurationMs: attempt.queueDurationMs }),
      };
      currentSession.updatedAt = now;
      await this.voiceServiceSessionModel.save(currentSession);
      this.logObservability(currentSession, `${stage}_processing_started`);
    }

    return currentSession;
  }

  private async recordProcessingError(
    sessionId: string,
    stage: VoiceServiceProcessingStage,
    expectedJobId: string | undefined,
    error: unknown,
    workerAttempt?: number
  ): Promise<void> {
    const currentSession = await this.getSessionById(sessionId);
    const currentJobId =
      stage === 'clipping'
        ? currentSession.clippingJobId
        : currentSession.trainingJobId;
    const expectedStatus =
      stage === 'clipping'
        ? VoiceServiceSessionStatus.analyzing
        : VoiceServiceSessionStatus.training;

    if (
      currentSession.status !== expectedStatus ||
      (expectedJobId && !this.isCurrentJob(currentJobId, expectedJobId || ''))
    ) {
      return;
    }

    const data = this.readRecord(error instanceof AppError ? error.data : null);
    const clippingMetrics = this.readClippingMetrics(
      data?.voiceClippingMetrics
    );
    const embeddedErrors = Array.isArray(data?.platformErrors)
      ? data.platformErrors.map(item => this.toPlatformError(item, stage))
      : [];
    const platformErrors = embeddedErrors.length
      ? embeddedErrors
      : [this.toPlatformError(error, stage)];

    if (stage === 'clipping') {
      this.applyClippingTelemetry(
        currentSession,
        expectedJobId || currentJobId,
        clippingMetrics,
        platformErrors,
        workerAttempt
      );
    } else {
      this.appendPlatformErrors(
        currentSession,
        stage,
        expectedJobId || currentJobId,
        platformErrors,
        workerAttempt
      );
    }
    currentSession.updatedAt = new Date();
    await this.voiceServiceSessionModel.save(currentSession);
    this.logObservability(currentSession, `${stage}_platform_error`);
  }

  private applyClippingTelemetry(
    session: VoiceServiceSessionEntity,
    jobId: string | undefined,
    metrics: VoiceClippingMetrics | undefined,
    platformErrors: VoiceClippingPlatformError[],
    workerAttempt?: number
  ): void {
    const attempt = this.findProcessingAttempt(session, 'clipping', jobId);
    const recognitionDurationMs = Math.max(
      0,
      Number(metrics?.recognitionDurationMs) || 0
    );
    const recognitionMaterialCount = Math.max(
      0,
      Math.round(Number(metrics?.recognitionMaterialCount) || 0)
    );

    if (attempt && metrics) {
      attempt.recognitionStartedAt ??= metrics.recognitionStartedAt;
      attempt.recognitionCompletedAt =
        metrics.recognitionCompletedAt ?? attempt.recognitionCompletedAt;
      attempt.recognitionDurationMs =
        (attempt.recognitionDurationMs ?? 0) + recognitionDurationMs;
      attempt.recognitionMaterialCount =
        (attempt.recognitionMaterialCount ?? 0) + recognitionMaterialCount;
      attempt.filteredClipCount = Math.max(
        attempt.filteredClipCount ?? 0,
        Math.round(Number(metrics.filteredClipCount) || 0)
      );
      attempt.volumeAdjustedClipCount = Math.max(
        attempt.volumeAdjustedClipCount ?? 0,
        Math.round(Number(metrics.volumeAdjustedClipCount) || 0)
      );
      attempt.residualAnalysisObjectKeys = Array.from(
        new Set([
          ...(attempt.residualAnalysisObjectKeys ?? []),
          ...(metrics.residualAnalysisObjectKeys ?? []),
        ])
      );
    }

    if (metrics) {
      session.observability = {
        ...(session.observability ?? {}),
        recognitionDurationMs:
          (session.observability?.recognitionDurationMs ?? 0) +
          recognitionDurationMs,
        recognitionMaterialCount:
          (session.observability?.recognitionMaterialCount ?? 0) +
          recognitionMaterialCount,
      };
    }

    this.appendPlatformErrors(
      session,
      'clipping',
      jobId,
      platformErrors,
      workerAttempt
    );
  }

  private appendPlatformErrors(
    session: VoiceServiceSessionEntity,
    stage: VoiceServiceProcessingStage,
    jobId: string | undefined,
    errors: VoiceClippingPlatformError[],
    workerAttempt?: number
  ): void {
    if (!errors.length) {
      return;
    }

    const attempt = this.findProcessingAttempt(session, stage, jobId);
    if (!attempt) {
      return;
    }

    const now = new Date();
    const additions = errors.map<VoiceServicePlatformErrorItem>(item => ({
      id: this.createItemId('platform-error'),
      provider: this.normalizeText(item.provider, 80) || 'internal',
      operation: this.normalizeText(item.operation, 80) || stage,
      code:
        this.normalizeText(item.code, 200) ||
        `VOICE_SERVICE_${stage.toUpperCase()}_FAILED`,
      message: this.normalizeText(item.message, 1000),
      requestId: this.normalizeText(item.requestId, 200) || undefined,
      httpStatus: this.normalizePositiveInteger(item.httpStatus),
      workerAttempt: this.normalizePositiveInteger(workerAttempt),
      createdAt: now,
    }));
    attempt.platformErrors = [...(attempt.platformErrors ?? []), ...additions];
    const lastError = additions[additions.length - 1];
    session.observability = {
      ...(session.observability ?? {}),
      lastPlatformErrorCode: lastError.code,
      lastPlatformErrorAt: now,
    };
  }

  private toPlatformError(
    value: unknown,
    stage: VoiceServiceProcessingStage
  ): VoiceClippingPlatformError {
    const appError = value instanceof AppError ? value : undefined;
    const raw = this.readRecord(value);
    const data = this.readRecord(appError?.data);
    const providerError = this.readRecord(data?.providerError);
    const source = providerError ?? raw;
    const code =
      this.normalizeText(source?.code, 200) ||
      appError?.code ||
      `VOICE_SERVICE_${stage.toUpperCase()}_FAILED`;

    return {
      provider:
        this.normalizeText(source?.provider, 80) || this.inferProvider(code),
      operation:
        this.normalizeText(source?.operation, 80) ||
        (stage === 'clipping' ? 'clipping' : 'training'),
      code,
      message:
        this.normalizeText(source?.message, 1000) ||
        (value instanceof Error ? value.message : String(value)),
      requestId:
        this.normalizeText(source?.requestId ?? source?.request_id, 200) ||
        undefined,
      httpStatus: this.normalizePositiveInteger(
        source?.httpStatus ?? source?.statusCode ?? appError?.status
      ),
    };
  }

  private readClippingMetrics(
    value: unknown
  ): VoiceClippingMetrics | undefined {
    const raw = this.readRecord(value);
    if (!raw) {
      return undefined;
    }

    return {
      recognitionStartedAt: this.normalizeDate(raw.recognitionStartedAt),
      recognitionCompletedAt: this.normalizeDate(raw.recognitionCompletedAt),
      recognitionDurationMs: Math.max(
        0,
        Number(raw.recognitionDurationMs) || 0
      ),
      recognitionMaterialCount: Math.max(
        0,
        Math.round(Number(raw.recognitionMaterialCount) || 0)
      ),
      residualAnalysisObjectKeys: Array.isArray(raw.residualAnalysisObjectKeys)
        ? raw.residualAnalysisObjectKeys
            .map(item => this.normalizeText(item, 500))
            .filter(Boolean)
        : [],
      filteredClipCount: Math.max(
        0,
        Math.round(Number(raw.filteredClipCount) || 0)
      ),
      volumeAdjustedClipCount: Math.max(
        0,
        Math.round(Number(raw.volumeAdjustedClipCount) || 0)
      ),
    };
  }

  private updateReviewObservability(
    session: VoiceServiceSessionEntity,
    acceptedCount: number,
    rejectedCount: number,
    generatedClipCount: number,
    logEvent = 'clip_reviewed'
  ): void {
    const reviewedClipCount = acceptedCount + rejectedCount;
    const userAdoptionRate =
      reviewedClipCount > 0
        ? this.roundRate(acceptedCount / reviewedClipCount)
        : undefined;
    session.observability = {
      ...(session.observability ?? {}),
      generatedClipCount,
      reviewedClipCount,
      acceptedClipCount: acceptedCount,
      rejectedClipCount: rejectedCount,
      userAdoptionRate,
    };
    const attempt = this.findProcessingAttempt(
      session,
      'clipping',
      session.clippingJobId
    );
    if (attempt) {
      attempt.generatedClipCount = generatedClipCount;
      attempt.reviewedClipCount = reviewedClipCount;
      attempt.acceptedClipCount = acceptedCount;
      attempt.rejectedClipCount = rejectedCount;
      attempt.userAdoptionRate = userAdoptionRate;
    }
    this.logObservability(session, logEvent);
  }

  private updateReviewObservabilityFromClips(
    session: VoiceServiceSessionEntity
  ): void {
    const clips = session.reviewClips ?? [];
    this.updateReviewObservability(
      session,
      clips.filter(
        item => item.reviewStatus === VoiceServiceClipReviewStatus.accepted
      ).length,
      clips.filter(
        item => item.reviewStatus === VoiceServiceClipReviewStatus.rejected
      ).length,
      clips.length,
      'clip_recut_requested'
    );
  }

  private completeTrainingMetric(
    session: VoiceServiceSessionEntity,
    succeeded: boolean
  ): void {
    const successCount =
      (session.observability?.trainingSuccessCount ?? 0) + (succeeded ? 1 : 0);
    const failureCount =
      (session.observability?.trainingFailureCount ?? 0) + (succeeded ? 0 : 1);
    const completedCount = successCount + failureCount;
    session.observability = {
      ...(session.observability ?? {}),
      trainingAttemptCount: Math.max(
        session.observability?.trainingAttemptCount ?? 0,
        completedCount
      ),
      trainingSuccessCount: successCount,
      trainingFailureCount: failureCount,
      trainingSuccessRate: this.roundRate(successCount / completedCount),
    };
  }

  private completeProcessingAttempt(
    session: VoiceServiceSessionEntity,
    stage: VoiceServiceProcessingStage,
    jobId: string | undefined,
    outcome: VoiceServiceProcessingAttemptItem['outcome'],
    completedAt: Date
  ): void {
    const attempt = this.findProcessingAttempt(session, stage, jobId);
    if (!attempt) {
      return;
    }

    attempt.outcome = outcome;
    attempt.completedAt = completedAt;
  }

  private appendProcessingAttempt(
    attempts: VoiceServiceProcessingAttemptItem[] | undefined,
    attempt: VoiceServiceProcessingAttemptItem
  ): VoiceServiceProcessingAttemptItem[] {
    return [...(attempts ?? []), attempt];
  }

  private findProcessingAttempt(
    session: VoiceServiceSessionEntity,
    stage: VoiceServiceProcessingStage,
    jobId: string | undefined
  ): VoiceServiceProcessingAttemptItem | undefined {
    if (!jobId) {
      return undefined;
    }

    return [...(session.processingAttempts ?? [])]
      .reverse()
      .find(item => item.stage === stage && item.jobId === jobId);
  }

  private findClipRecutAttempt(
    clip: VoiceServiceReviewClipItem,
    jobId: string
  ): VoiceServiceClipRecutAttemptItem | undefined {
    return [...(clip.recutHistory ?? [])]
      .reverse()
      .find(item => item.jobId === jobId);
  }

  private resetClippingObservability(
    metrics: VoiceServiceObservabilityMetrics | undefined
  ): VoiceServiceObservabilityMetrics {
    const preserved = { ...(metrics ?? {}) };
    delete preserved.clippingQueueDurationMs;
    delete preserved.recognitionDurationMs;
    delete preserved.recognitionMaterialCount;
    delete preserved.generatedClipCount;
    delete preserved.filteredClipCount;
    delete preserved.volumeAdjustedClipCount;
    delete preserved.reviewedClipCount;
    delete preserved.acceptedClipCount;
    delete preserved.rejectedClipCount;
    delete preserved.userAdoptionRate;

    return preserved;
  }

  private inferProvider(code: string): string {
    if (/QWEN/i.test(code)) {
      return 'qwen';
    }
    if (/DASHSCOPE|VOICE_ANALYSIS|PARAFORMER/i.test(code)) {
      return 'dashscope';
    }
    if (/COS/i.test(code)) {
      return 'tencent_cos';
    }

    return 'internal';
  }

  private normalizePositiveInteger(value: unknown): number | undefined {
    const parsed = Number(value);

    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
  }

  private normalizeDate(value: unknown): Date | undefined {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value;
    }
    if (typeof value !== 'string' && typeof value !== 'number') {
      return undefined;
    }

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }

  private readRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  }

  private roundRate(value: number): number {
    return Math.round(value * 10000) / 10000;
  }

  private logObservability(
    session: VoiceServiceSessionEntity,
    event: string
  ): void {
    const metrics = session.observability ?? {};
    this.logger.info(
      '[voice-observability] event=%s sessionId=%s clipping_queue_ms=%s recognition_ms=%s generated_clips=%s filtered_clips=%s volume_adjusted_clips=%s reviewed_clips=%s accepted_clips=%s adoption_rate=%s training_queue_ms=%s training_attempts=%s training_success_rate=%s platform_error_code=%s',
      event,
      this.stringifyObjectId(session.id),
      metrics.clippingQueueDurationMs ?? '',
      metrics.recognitionDurationMs ?? '',
      metrics.generatedClipCount ?? '',
      metrics.filteredClipCount ?? '',
      metrics.volumeAdjustedClipCount ?? '',
      metrics.reviewedClipCount ?? '',
      metrics.acceptedClipCount ?? '',
      metrics.userAdoptionRate ?? '',
      metrics.trainingQueueDurationMs ?? '',
      metrics.trainingAttemptCount ?? '',
      metrics.trainingSuccessRate ?? '',
      metrics.lastPlatformErrorCode ?? ''
    );
  }

  private buildClippingJobId(
    session: VoiceServiceSessionEntity,
    createdAt: Date
  ): string {
    return `voice-service-clipping:${this.stringifyObjectId(
      session.id
    )}:${createdAt.getTime()}`;
  }

  private buildClipRecutJobId(
    session: VoiceServiceSessionEntity,
    clipId: string,
    createdAt: Date
  ): string {
    return `voice-service-clip-recut:${this.stringifyObjectId(
      session.id
    )}:${clipId}:${createdAt.getTime()}`;
  }

  private buildTrainingJobId(
    session: VoiceServiceSessionEntity,
    createdAt: Date
  ): string {
    return `voice-service-training:${this.stringifyObjectId(
      session.id
    )}:${createdAt.getTime()}`;
  }

  private hashObjectKey(objectKey: string): string {
    return createHash('sha256').update(objectKey).digest('hex');
  }

  private resolveJobId(...values: Array<string | undefined>): string {
    for (const value of values) {
      const normalized = this.normalizeText(value, 300);
      if (normalized) {
        return normalized;
      }
    }

    return '';
  }

  private isCurrentJob(
    currentJobId: string | undefined,
    expectedJobId: string
  ): boolean {
    return (
      !currentJobId || Boolean(expectedJobId && currentJobId === expectedJobId)
    );
  }

  private async getOrCreateCollectingSession(
    userId: MongoObjectId
  ): Promise<VoiceServiceSessionEntity> {
    const latest = await this.findLatestSession(userId);

    if (latest && latest.status !== VoiceServiceSessionStatus.completed) {
      return latest;
    }

    const now = new Date();
    return this.voiceServiceSessionModel.save(
      this.voiceServiceSessionModel.create({
        userId,
        status: VoiceServiceSessionStatus.collecting,
        materials: [],
        reviewClips: [],
        observability: {
          trainingAttemptCount: 0,
          trainingSuccessCount: 0,
          trainingFailureCount: 0,
        },
        processingAttempts: [],
        messages: [
          this.buildMessage(
            VoiceServiceMessageRole.assistant,
            '各种留有他声音的素材，你发给我就行。音频、视频都可以，不用提前剪辑或整理，我会帮你处理好。',
            now
          ),
        ],
        events: [
          this.buildEvent(
            VoiceServiceEventType.sessionCreated,
            '创建声音服务记录',
            now
          ),
        ],
        createdAt: now,
        updatedAt: now,
      })
    );
  }

  private async buildAssistantReply(
    session: VoiceServiceSessionEntity,
    userText: string
  ): Promise<string> {
    const isPricingQuestion = this.isPricingQuestion(userText);
    const isMaterialImportQuestion = this.isMaterialImportQuestion(userText);
    const annualPricing = isPricingQuestion
      ? await this.getAnnualMembershipPricingText()
      : '';
    const fallback = this.buildFallbackReply(
      userText,
      session.status,
      annualPricing
    );

    if (isPricingQuestion || isMaterialImportQuestion) {
      return fallback;
    }

    if (!this.openAIService?.isEnabled?.()) {
      return fallback;
    }

    try {
      const recentMessages = (session.messages ?? [])
        .slice(-10)
        .map(
          item =>
            `${
              item.role === VoiceServiceMessageRole.user ? '用户' : '小使者'
            }：${item.text}`
        )
        .join('\n');
      const generated = await this.openAIService.generateText({
        temperature: 0.25,
        topP: 0.55,
        maxTokens: 260,
        reasoningSplit: false,
        systemPrompt: [
          `你是“${brandName()}小使者”，在声音模型训练页面担任温和、专业的客服。`,
          '你的职责是解答声音素材、剪辑确认、训练、试听和使用方式的问题，并根据当前真实状态指导下一步。',
          `${brandName()}的购买逻辑：声音训练和试听免费，不要求用户提前购买；用户试听后觉得效果合适，准备实际使用声音能力时，再自行考虑是否开通包含声音服务的会员。`,
          '不含声音服务的会员价格相对低一些，包含声音服务的会员价格会高一些。用户询问价格时，只能引用下方“当前一年期会员价格”的实时数据，并优先报一年期价格；不得引用其他金额或猜测价格。报价后提醒用户以“会员服务”展示的最新方案为准。',
          '当前声音技术还不是很成熟，方言或口音较重时，可能训练不出与亲人相近的声音模型。必须坦诚这种不确定性，不得保证相似度或训练效果。',
          '当用户询问收费、套餐、购买、为什么免费或效果能否保证时，要完整说明“先免费训练和试听，再考虑购买”的逻辑，不要催促购买或销售套餐。',
          '声音素材只有两种添加入口：从微信聊天选择文件，或从手机相册选择。不得虚构第三种入口。',
          '微信原生语音消息不能直接导入。用户需要先播放微信语音并录屏，录屏视频会保存到手机相册，再从手机相册选择；微信聊天入口只用于选择会话中可作为文件选择的音频或视频。',
          '支持一次添加多个素材，也可以分多次添加，单个文件不能超过 50MB。',
          `剪辑完成后必须请用户逐段试听，只有用户确认的片段才能训练。音色生成后才选择${brandName()}。`,
          '用户选择“再剪一下”时，要让他填写明确时间，例如去掉开头 2 秒、只保留 3 秒到 8 秒。该片段单独处理，其他片段不受影响；无法定位的模糊描述要请用户改成具体时间。',
          '审核片段时建议精选 1 分钟以内。声音不是越多越好；素材充足时，优先保留最清楚、最自然的 1 分钟。',
          '不得编造素材数量、剪辑结果、训练进度、音色效果或付款状态。不得说自己已经完成后台未完成的工作。',
          '统一用“他”，不要使用 TA、Ta、她。回答控制在 2 至 4 句，先直接回答，再告诉用户下一步。',
        ].join('\n'),
        prompt: [
          `当前服务状态：${session.status}`,
          `当前已上传素材数：${session.materials?.length ?? 0}`,
          `当前待确认片段数：${
            (session.reviewClips ?? []).filter(
              item => item.reviewStatus === VoiceServiceClipReviewStatus.pending
            ).length
          }`,
          `当前一年期会员价格：${
            annualPricing ||
            '暂未读取到，请引导用户到会员服务查看，不得猜测价格'
          }`,
          `最近对话：\n${recentMessages}`,
          `用户当前问题：${JSON.stringify(userText)}`,
        ].join('\n'),
      });

      return this.normalizeText(generated.content, 500) || fallback;
    } catch {
      return fallback;
    }
  }

  private buildFallbackReply(
    input: string,
    status: VoiceServiceSessionStatus,
    annualPricing = ''
  ): string {
    if (
      /钱|费用|收费|套餐|购买|支付|免费|价格|方言|口音|效果|像不像|相似|保证/.test(
        input
      )
    ) {
      const priceText = this.isPricingQuestion(input)
        ? annualPricing
          ? `不含声音服务的会员价格相对低一些，包含声音服务的会员价格会高一些。目前一年期方案是：${annualPricing}。价格可能调整，请以会员服务展示的最新信息为准。`
          : '不含声音服务的会员价格相对低一些，包含声音服务的会员价格会高一些。具体一年期方案和价格请到会员服务查看。'
        : '你可以先试听训练结果，觉得合适，再考虑是否开通包含声音服务的会员。';

      return `声音训练是免费的。现在声音技术还不是很成熟，方言、口音较重时，可能训练不出与亲人相近的声音模型，所以我们先免费为你训练和试听。${priceText}你再考虑要不要购买。`;
    }
    if (/微信|语音|录屏|素材|视频|录音|格式/.test(input)) {
      return '声音素材只有两种添加方式：一是从微信聊天选择音频、视频等文件，二是从手机相册选择录屏或视频。微信原生语音消息不能直接导入；请先播放他的语音并录屏，录屏会保存在手机相册，再从相册选择。一次可以添加多份素材。';
    }
    if (/再剪|重新剪|怎么剪|剪法/.test(input)) {
      return '点击“再剪一下”后，请把时间写具体，例如“去掉开头 2 秒”或“只保留 3 秒到 8 秒”。我会只重新处理这一段，其他片段和已经做好的选择不会受影响；剪好后它会回到原位置，请你再次试听确认。';
    }
    if (
      /片段|选择|训练/.test(input) &&
      /多少|多久|多长|时长|分钟/.test(input)
    ) {
      return '建议把确认使用的声音精选在 1 分钟以内。声音不是越多越好，素材充足时，优先保留最清楚、最自然、只有他说话的片段。';
    }
    if (/多少|多久|多长|几段|几个/.test(input)) {
      return '不用先凑够固定时长，能找到的都可以发给我。素材越清楚、他的单独说话越多越好，我整理后会告诉你实际可用多少。';
    }
    if (/别人|不是他|多人|重叠|杂音|听不清/.test(input)) {
      return '没有关系，我会先剪出可能可用的声音，再请你逐段确认。需要调整起止位置的可以选择再剪一下，不合适的片段直接选择不使用。';
    }
    if (/隐私|安全|授权|删除/.test(input)) {
      return '请只上传你有权使用的声音素材。你可以单独删除未提交的素材，也可以在页面底部一次删除原始素材、切片、训练音频和声音模型；全部删除后无法恢复。';
    }
    if (
      status === VoiceServiceSessionStatus.collecting ||
      status === VoiceServiceSessionStatus.failed
    ) {
      return '声音素材可以从微信聊天选择音频、视频等文件，或从手机相册选择录屏和视频。微信语音需要先播放并录屏，再从相册添加；一次可以添加多份素材。';
    }
    if (status === VoiceServiceSessionStatus.analyzing) {
      return '我正在识别并剪辑声音，预计需要 2–3 分钟。完成后会把剪好的片段逐段发给你试听，由你确认哪些可以用于训练。';
    }
    if (status === VoiceServiceSessionStatus.reviewing) {
      return '请先逐段试听剪辑结果，确认每一段可以使用、需要再剪一下，还是不使用。全部确认后才能开始训练。';
    }
    if (status === VoiceServiceSessionStatus.training) {
      return '声音正在免费训练中，完成后会先提供试听。你觉得效果合适，再到会员服务查看是否需要开通包含声音服务的会员。';
    }

    return `声音生成后可以先免费试听，再选择要使用这个声音的${brandName()}。你觉得效果合适，准备实际使用时，再到会员服务查看包含声音服务的会员方案和最新价格。`;
  }

  private isPricingQuestion(input: string): boolean {
    return /钱|费用|收费|套餐|购买|支付|免费|价格|会员|一年|年费|怎么卖/.test(
      input
    );
  }

  private isMaterialImportQuestion(input: string): boolean {
    return /导入|从微信|微信聊天|语音消息|语音气泡|录屏|相册|(?:素材.*(?:添加|上传|选择))|(?:(?:添加|上传|选择).*素材)/.test(
      input
    );
  }

  private async getAnnualMembershipPricingText(): Promise<string> {
    if (!this.vipPlanModel?.find) {
      return '';
    }

    try {
      const plans = await this.vipPlanModel.find({
        where: {
          status: VipPlanStatus.active,
        },
        order: {
          sort: 'ASC',
          priceAmount: 'ASC',
        },
      });
      const annualPlans = plans.filter(
        plan =>
          !plan.lifetime &&
          Number(plan.durationDays) >= 360 &&
          Number(plan.durationDays) <= 370
      );
      const basicPlan = annualPlans.find(
        plan => plan.planGroup !== VipPlanGroup.voice
      );
      const voicePlan = annualPlans.find(
        plan => plan.planGroup === VipPlanGroup.voice
      );

      return [
        basicPlan
          ? `${basicPlan.name}（不含声音服务）${this.formatPriceAmount(
              basicPlan.priceAmount
            )}/年`
          : '',
        voicePlan
          ? `${voicePlan.name}（含声音服务）${this.formatPriceAmount(
              voicePlan.priceAmount
            )}/年`
          : '',
      ]
        .filter(Boolean)
        .join('，');
    } catch {
      return '';
    }
  }

  private formatPriceAmount(priceAmount: number): string {
    const amount = Number(priceAmount) / 100;
    const text = Number.isInteger(amount)
      ? String(amount)
      : amount.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');

    return `${text} 元`;
  }

  private async getUserSession(
    auth: AuthenticatedUserPayload,
    sessionId: string
  ): Promise<VoiceServiceSessionEntity> {
    const userId = this.parseObjectId(auth.sub, 'INVALID_TOKEN');
    const session = await this.getSessionById(sessionId);

    if (this.stringifyObjectId(session.userId) !== String(userId)) {
      throw new AppError(
        'VOICE_SERVICE_SESSION_NOT_FOUND',
        'voice service session not found',
        404
      );
    }

    return session;
  }

  private async getSessionById(
    sessionId: string
  ): Promise<VoiceServiceSessionEntity> {
    const id = this.parseObjectId(
      sessionId,
      'INVALID_VOICE_SERVICE_SESSION_ID'
    );
    const session =
      (await this.voiceServiceSessionModel.findOne({ where: { id } })) ??
      (await this.voiceServiceSessionModel.findOne({
        where: { _id: id } as never,
      }));

    if (!session) {
      throw new AppError(
        'VOICE_SERVICE_SESSION_NOT_FOUND',
        'voice service session not found',
        404
      );
    }

    return session;
  }

  private async findLatestSession(
    userId: MongoObjectId
  ): Promise<VoiceServiceSessionEntity | null> {
    const sessions = await this.voiceServiceSessionModel.find({
      where: { userId },
      order: { updatedAt: 'DESC' },
      take: 1,
    });

    return sessions[0] ?? null;
  }

  private async findAgent(agentId: MongoObjectId): Promise<AgentEntity | null> {
    return (
      (await this.agentModel.findOne({ where: { id: agentId } })) ??
      (await this.agentModel.findOne({
        where: { _id: agentId } as never,
      }))
    );
  }

  private normalizeMaterials(
    materials?: AddVoiceServiceMaterialsDTO['materials']
  ): Array<{
    name: string;
    objectKey: string;
    publicUrl?: string;
    durationSeconds?: number;
  }> {
    if (!Array.isArray(materials)) {
      return [];
    }

    return materials
      .map(item => ({
        name: this.normalizeText(item?.name, 120) || '声音素材',
        objectKey: this.normalizeObjectKey(item?.objectKey),
        publicUrl: this.normalizeText(item?.publicUrl, 1000),
        durationSeconds: this.normalizeDuration(item?.durationSeconds),
      }))
      .filter(item => Boolean(item.objectKey));
  }

  private normalizeReviewStatus(
    value: ReviewVoiceServiceClipDTO['reviewStatus']
  ): VoiceServiceClipReviewStatus {
    if (value === VoiceServiceClipReviewStatus.accepted) {
      return VoiceServiceClipReviewStatus.accepted;
    }
    if (value === VoiceServiceClipReviewStatus.rejected) {
      return VoiceServiceClipReviewStatus.rejected;
    }

    throw new AppError(
      'VOICE_SERVICE_CLIP_REVIEW_INVALID',
      'voice clip review status is invalid',
      400
    );
  }

  private isClipRecutActive(status: string | undefined): boolean {
    return status === 'queued' || status === 'processing';
  }

  private clearClipRecutState(clip: VoiceServiceReviewClipItem): void {
    clip.recutStatus = undefined;
    clip.recutInstruction = undefined;
    clip.recutJobId = undefined;
    clip.recutRequestedAt = undefined;
    clip.recutStartedAt = undefined;
    clip.recutCompletedAt = undefined;
    clip.recutFailureCode = undefined;
    clip.recutFailureReason = undefined;
  }

  private canReworkReviewedSession(
    session: VoiceServiceSessionEntity
  ): boolean {
    const clips = session.reviewClips ?? [];

    return (
      session.status === VoiceServiceSessionStatus.reviewing &&
      clips.length > 0 &&
      clips.every(
        item => item.reviewStatus !== VoiceServiceClipReviewStatus.pending
      ) &&
      clips.every(
        item => item.reviewStatus !== VoiceServiceClipReviewStatus.accepted
      )
    );
  }

  private assertDataDeletionSettled(session: VoiceServiceSessionEntity): void {
    if (
      session.dataDeletionStatus === VoiceServiceDataDeletionStatus.pending ||
      session.dataDeletionStatus ===
        VoiceServiceDataDeletionStatus.partialFailed
    ) {
      throw new AppError(
        'VOICE_SERVICE_DATA_DELETION_INCOMPLETE',
        '声音数据尚未完全删除，请先重试删除',
        409
      );
    }
  }

  private async deleteReviewClipObjects(
    session: VoiceServiceSessionEntity
  ): Promise<void> {
    for (const clip of session.reviewClips ?? []) {
      await this.voiceServiceDataDeletionService.deleteRequiredObject(
        clip.objectKey
      );
      this.voiceServiceDataDeletionService.recordDeletedObjectAudit(
        session,
        clip.objectKey
      );
    }
  }

  private resolvePublicUrl(objectKey: string, fallback?: string): string {
    if (this.tencentCosService?.isEnabled?.()) {
      try {
        return this.tencentCosService.getPublicUrl(objectKey);
      } catch {
        return this.normalizeText(fallback, 1000);
      }
    }

    return this.normalizeText(fallback, 1000);
  }

  private appendMessage(
    messages: VoiceServiceMessageItem[] | undefined,
    role: VoiceServiceMessageRole,
    text: string,
    createdAt: Date
  ): VoiceServiceMessageItem[] {
    return [
      ...(messages ?? []),
      this.buildMessage(role, text, createdAt),
    ].slice(-MAX_MESSAGE_COUNT);
  }

  private buildMessage(
    role: VoiceServiceMessageRole,
    text: string,
    createdAt: Date
  ): VoiceServiceMessageItem {
    return {
      id: this.createItemId('message'),
      role,
      text,
      createdAt,
    };
  }

  private appendEvent(
    events: VoiceServiceEventItem[] | undefined,
    type: VoiceServiceEventType,
    summary: string,
    createdAt: Date,
    metadata?: Record<string, string | number | boolean>
  ): VoiceServiceEventItem[] {
    return [
      ...(events ?? []),
      this.buildEvent(type, summary, createdAt, metadata),
    ].slice(-MAX_EVENT_COUNT);
  }

  private buildEvent(
    type: VoiceServiceEventType,
    summary: string,
    createdAt: Date,
    metadata?: Record<string, string | number | boolean>
  ): VoiceServiceEventItem {
    return {
      id: this.createItemId('event'),
      type,
      summary,
      metadata,
      createdAt,
    };
  }

  private async ensureEligibleVoiceBinding(
    session: VoiceServiceSessionEntity,
    access: VoiceUsageAccessDecision
  ): Promise<void> {
    if (!session.selectedAgentId || !session.voiceTimbreId) {
      return;
    }

    const agent = await this.findAgent(session.selectedAgentId);
    if (
      !agent ||
      this.stringifyObjectId(agent.createdUserId) !==
        this.stringifyObjectId(session.userId)
    ) {
      return;
    }

    const previousStatus = session.voiceBindingStatus;
    const previousSource = session.voiceAccessSource;
    const previousReferenceId = session.voiceAccessReferenceId;
    const previousSessionStatus = session.status;
    const previousUpdatedAt = session.updatedAt;
    const now = new Date();

    this.applyVoiceAccessRecord(session, access, now);
    const bindingStatus = await this.bindSessionTimbreToAgent(
      session,
      agent,
      access,
      now
    );
    session.status = VoiceServiceSessionStatus.completed;

    if (
      access.eligible &&
      previousStatus === 'purchase_required' &&
      bindingStatus === 'bound'
    ) {
      session.messages = this.appendMessage(
        session.messages,
        VoiceServiceMessageRole.assistant,
        `已经确认你的声音权益，这个声音已接入“${agent.name || '未命名'}”。`,
        now
      );
    }

    const changed =
      previousStatus !== session.voiceBindingStatus ||
      previousSource !== session.voiceAccessSource ||
      previousReferenceId !== session.voiceAccessReferenceId ||
      previousSessionStatus !== session.status ||
      previousUpdatedAt !== session.updatedAt;

    if (changed) {
      session.updatedAt = now;
      await this.voiceServiceSessionModel.save(session);
    }
  }

  private applyVoiceAccessRecord(
    session: VoiceServiceSessionEntity,
    access: VoiceUsageAccessDecision,
    now: Date
  ): void {
    const source = access.eligible ? access.source : undefined;
    const referenceId = access.eligible ? access.referenceId : undefined;

    if (
      session.voiceAccessSource !== source ||
      session.voiceAccessReferenceId !== referenceId ||
      !session.voiceAccessVerifiedAt
    ) {
      session.voiceAccessSource = source;
      session.voiceAccessReferenceId = referenceId;
      session.voiceAccessVerifiedAt = now;
      session.updatedAt = now;
    }
  }

  private async bindSessionTimbreToAgent(
    session: VoiceServiceSessionEntity,
    agent: AgentEntity,
    access: VoiceUsageAccessDecision,
    now: Date
  ): Promise<VoiceServiceBindingStatus> {
    const previousStatus = session.voiceBindingStatus;

    if (!access.eligible) {
      session.voiceBindingStatus = 'purchase_required';
      if (previousStatus !== session.voiceBindingStatus) {
        session.updatedAt = now;
      }
      return session.voiceBindingStatus;
    }

    if (!session.voiceTimbreId) {
      session.voiceBindingStatus = 'ready';
      if (previousStatus !== session.voiceBindingStatus) {
        session.updatedAt = now;
      }
      return session.voiceBindingStatus;
    }

    const currentTimbreId = agent.voiceTimbreId
      ? this.stringifyObjectId(agent.voiceTimbreId)
      : '';
    const sessionTimbreId = this.stringifyObjectId(session.voiceTimbreId);
    if (currentTimbreId && currentTimbreId !== sessionTimbreId) {
      session.voiceBindingStatus = 'existing_voice_preserved';
      if (previousStatus !== session.voiceBindingStatus) {
        session.updatedAt = now;
      }
      return session.voiceBindingStatus;
    }

    if (!currentTimbreId) {
      agent.voiceTimbreId = session.voiceTimbreId;
      await this.agentModel.save(agent);
    }

    const agentId = this.stringifyObjectId(agent.id);
    const boundAgentIds = new Set(
      (session.voiceBoundAgentIds ?? []).map(item =>
        this.stringifyObjectId(item)
      )
    );
    if (!boundAgentIds.has(agentId)) {
      session.voiceBoundAgentIds = [
        ...(session.voiceBoundAgentIds ?? []),
        agent.id,
      ];
      session.events = this.appendEvent(
        session.events,
        VoiceServiceEventType.agentVoiceBound,
        `声音已接入${brandName()}：${agent.name || '未命名'}`,
        now,
        {
          agentId,
          agentName: agent.name || '未命名',
          voiceTimbreId: sessionTimbreId,
          voiceAccessSource: access.source || '',
          voiceAccessReferenceId: access.referenceId || '',
        }
      );
      session.voiceBoundAt = now;
      session.updatedAt = now;
    }

    session.voiceBindingStatus = 'bound';
    session.voiceBoundAt ??= now;
    if (previousStatus !== session.voiceBindingStatus) {
      session.updatedAt = now;
    }
    return session.voiceBindingStatus;
  }

  private buildAgentSelectionMessage(
    agentName: string,
    bindingStatus: VoiceServiceBindingStatus
  ): string {
    if (bindingStatus === 'bound') {
      return `已经确认你的声音权益，这个声音已接入“${agentName}”。之后他可以用这个声音回复你。`;
    }

    if (bindingStatus === 'existing_voice_preserved') {
      return `“${agentName}”已经接有后台配置的声音，我保留了原来的声音服务，没有覆盖。`;
    }

    return `已经为“${agentName}”选好这个声音。真正使用声音回复时，请到会员服务查看包含声音服务的会员方案和最新价格。`;
  }

  private buildSessionRecord(
    session: VoiceServiceSessionEntity,
    access?: VoiceUsageAccessDecision
  ): VoiceServiceSessionDTO {
    return {
      id: this.stringifyObjectId(session.id),
      status: session.status,
      processingMode: session.processingMode,
      materials: (session.materials ?? []).map(item => ({
        id: item.id,
        name: item.name,
        objectKey: item.objectKey,
        publicUrl: item.publicUrl,
        durationSeconds: item.durationSeconds,
        createdAt: this.formatDate(item.createdAt) ?? '',
      })),
      reviewClips: (session.reviewClips ?? []).map(item => ({
        id: item.id,
        sourceMaterialId: item.sourceMaterialId,
        sourceName: item.sourceName,
        objectKey: item.objectKey,
        publicUrl: item.publicUrl,
        durationSeconds: item.durationSeconds,
        transcript: item.transcript,
        speakerId: item.speakerId,
        qualityScore: item.qualityScore,
        qualityLabel: item.qualityLabel,
        qualityMetrics: item.qualityMetrics,
        qualityIssues: item.qualityIssues,
        reviewStatus: item.reviewStatus,
        rejectionReason: item.rejectionReason,
        recutStatus: item.recutStatus,
        recutInstruction: item.recutInstruction,
        recutRequestedAt: this.formatDate(item.recutRequestedAt),
        recutStartedAt: this.formatDate(item.recutStartedAt),
        recutCompletedAt: this.formatDate(item.recutCompletedAt),
        recutFailureCode: item.recutFailureCode,
        recutFailureReason: item.recutFailureReason,
        createdAt: this.formatDate(item.createdAt) ?? '',
        reviewedAt: this.formatDate(item.reviewedAt),
      })),
      filteredClips: (session.filteredClips ?? []).map(item => ({
        id: item.id,
        sourceMaterialId: item.sourceMaterialId,
        sourceName: item.sourceName,
        durationSeconds: item.durationSeconds,
        transcript: item.transcript,
        speakerId: item.speakerId,
        qualityMetrics: item.qualityMetrics,
        qualityIssues: item.qualityIssues,
        createdAt: this.formatDate(item.createdAt) ?? '',
      })),
      messages: (session.messages ?? []).map(item => ({
        id: item.id,
        role: item.role,
        text: item.text,
        createdAt: this.formatDate(item.createdAt) ?? '',
      })),
      events: (session.events ?? []).map(item => ({
        id: item.id,
        type: item.type,
        summary: item.summary,
        metadata: item.metadata,
        createdAt: this.formatDate(item.createdAt) ?? '',
      })),
      voiceTimbreId: session.voiceTimbreId
        ? this.stringifyObjectId(session.voiceTimbreId)
        : undefined,
      selectedAgentId: session.selectedAgentId
        ? this.stringifyObjectId(session.selectedAgentId)
        : undefined,
      previewAgentId: session.previewAgentId
        ? this.stringifyObjectId(session.previewAgentId)
        : undefined,
      previewText: session.previewText,
      voiceAccessEligible:
        access?.eligible ?? Boolean(session.voiceAccessSource),
      voiceAccessSource: (access?.source ?? session.voiceAccessSource) as
        | VoiceServiceSessionDTO['voiceAccessSource']
        | undefined,
      voiceBindingStatus: session.voiceBindingStatus,
      voiceBoundAgentIds: (session.voiceBoundAgentIds ?? []).map(item =>
        this.stringifyObjectId(item)
      ),
      voiceBoundAt: this.formatDate(session.voiceBoundAt),
      previewAudioUrl: session.previewAudioUrl,
      failureReason: session.failureReason,
      failureStage: session.failureStage,
      trainingAudioObjectKey: session.trainingAudioObjectKey,
      dataDeletionStatus: session.dataDeletionStatus,
      dataDeletionRequestedAt: this.formatDate(session.dataDeletionRequestedAt),
      dataDeletionCompletedAt: this.formatDate(session.dataDeletionCompletedAt),
      dataDeletionFailureReason: session.dataDeletionFailureReason,
      createdAt: this.formatDate(session.createdAt) ?? '',
      updatedAt: this.formatDate(session.updatedAt) ?? '',
    };
  }

  private normalizeObjectKey(value: unknown): string {
    const objectKey = this.normalizeText(value, 500)
      .replace(/\\/g, '/')
      .replace(/^\/+/, '');

    if (
      !objectKey ||
      objectKey.includes('..') ||
      (!objectKey.startsWith('voice-training-materials/') &&
        !objectKey.startsWith('voice-service-clips/'))
    ) {
      return '';
    }

    return objectKey;
  }

  private normalizeTrainingObjectKey(value: unknown): string | undefined {
    const objectKey = this.normalizeText(value, 500)
      .replace(/\\/g, '/')
      .replace(/^\/+/, '');

    return objectKey.startsWith('voice-training-ready/') &&
      !objectKey.includes('..')
      ? objectKey
      : undefined;
  }

  private normalizeVoiceObjectKey(
    value: unknown,
    prefix: string
  ): string | undefined {
    const objectKey = this.normalizeText(value, 500)
      .replace(/\\/g, '/')
      .replace(/^\/+/, '');

    return objectKey.startsWith(`${prefix}/`) && !objectKey.includes('..')
      ? objectKey
      : undefined;
  }

  private normalizeProcessingMode(value: unknown): VoiceServiceProcessingMode {
    return value === VoiceServiceProcessingMode.readyToUse
      ? VoiceServiceProcessingMode.readyToUse
      : VoiceServiceProcessingMode.assisted;
  }

  private normalizeScore(value: unknown): number | undefined {
    const score = Number(value);

    return Number.isFinite(score)
      ? Math.max(0, Math.min(100, Math.round(score)))
      : undefined;
  }

  private normalizeQualityMetrics(
    value: unknown
  ): VoiceServiceClipQualityMetrics | undefined {
    const raw = this.readRecord(value);
    const durationSeconds = this.normalizePreciseDuration(raw?.durationSeconds);
    if (!raw || durationSeconds == null) {
      return undefined;
    }

    return {
      durationSeconds,
      silenceRatio: this.normalizeRatio(raw.silenceRatio),
      rmsDb: this.normalizeFiniteNumber(raw.rmsDb, -160, 20),
      peakDb: this.normalizeFiniteNumber(raw.peakDb, -160, 20),
      clippingRatio: this.normalizeRatio(raw.clippingRatio),
      noiseFloorDb: this.normalizeFiniteNumber(raw.noiseFloorDb, -160, 20),
      signalToNoiseDb: this.normalizeFiniteNumber(raw.signalToNoiseDb, 0, 160),
      volumeAdjusted: raw.volumeAdjusted === true || undefined,
      volumeGainDb: this.normalizeFiniteNumber(raw.volumeGainDb, 0, 60),
    };
  }

  private normalizeQualityIssues(
    value: unknown
  ): VoiceServiceClipQualityIssue[] {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .slice(0, 12)
      .map(item => {
        const raw = this.readRecord(item);
        const code = this.normalizeText(raw?.code, 80);
        const severity =
          raw?.severity === 'rejected'
            ? 'rejected'
            : raw?.severity === 'warning'
            ? 'warning'
            : undefined;
        const message = this.normalizeText(raw?.message, 200);
        if (
          !code ||
          !VOICE_CLIP_QUALITY_ISSUE_CODES.has(
            code as VoiceServiceClipQualityIssueCode
          ) ||
          !severity ||
          !message
        ) {
          return null;
        }

        return {
          code: code as VoiceServiceClipQualityIssueCode,
          severity,
          message,
        };
      })
      .filter((item): item is VoiceServiceClipQualityIssue => Boolean(item));
  }

  private normalizePreciseDuration(value: unknown): number | undefined {
    const duration = Number(value);

    return Number.isFinite(duration) && duration > 0
      ? Math.min(24 * 60 * 60, Math.round(duration * 100) / 100)
      : undefined;
  }

  private normalizeRatio(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed)
      ? Math.max(0, Math.min(1, Math.round(parsed * 10000) / 10000))
      : 0;
  }

  private normalizeFiniteNumber(
    value: unknown,
    minimum: number,
    maximum: number
  ): number | undefined {
    const parsed = Number(value);
    return Number.isFinite(parsed)
      ? Math.max(minimum, Math.min(maximum, Math.round(parsed * 10) / 10))
      : undefined;
  }

  private normalizeDuration(value: unknown): number | undefined {
    const duration = Number(value);

    return Number.isFinite(duration) && duration > 0
      ? Math.min(24 * 60 * 60, Math.round(duration))
      : undefined;
  }

  private normalizeText(value: unknown, maxLength: number): string {
    return (typeof value === 'string' ? value : '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, maxLength);
  }

  private createItemId(prefix: string): string {
    return `${prefix}_${randomBytes(8).toString('hex')}`;
  }

  private parseObjectId(value: string, code: string): MongoObjectId {
    if (!MongoObjectId.isValid(value)) {
      throw new AppError(
        code,
        'object id is invalid',
        code === 'INVALID_TOKEN' ? 401 : 400
      );
    }

    return new MongoObjectId(value);
  }

  private stringifyObjectId(value: MongoObjectId): string {
    return value?.toHexString?.() ?? String(value);
  }

  private formatDate(value?: Date): string | undefined {
    if (!value) {
      return undefined;
    }

    return value instanceof Date
      ? value.toISOString()
      : new Date(value).toISOString();
  }
}
