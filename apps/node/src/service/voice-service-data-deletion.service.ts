import { Inject, Logger, Provide } from '@midwayjs/core';
import type { ILogger } from '@midwayjs/logger';
import { InjectEntityModel } from '@midwayjs/typeorm';
import {
  AgentEntity,
  MongoObjectId,
  VoiceServiceDataDeletionStatus,
  VoiceServiceSessionEntity,
  VoiceServiceSessionStatus,
  VoiceTimbreEntity,
  VoiceTimbreProvider,
  VoiceTimbreStatus,
  type VoiceServiceDataDeletionFailureItem,
  type VoiceServiceDeletedArtifactAuditItem,
} from '@tzl/entities';
import { createHash, randomBytes } from 'crypto';
import { MongoRepository } from 'typeorm';
import { AppError } from '../common/errors';
import { QwenVoiceEnrollmentService } from './qwen-voice-enrollment.service';
import { TencentCosService } from './tencent-cos.service';

const VOICE_OBJECT_PREFIXES = [
  'voice-training-materials',
  'voice-service-analysis',
  'voice-service-clips',
  'voice-training-ready',
  'voice-timbre-previews',
  'voice-timbre-generated',
];

interface TimbreDeletionResult {
  completed: boolean;
  providerModelDeleted: boolean;
}

export interface VoiceServiceDataDeletionResult {
  failures: VoiceServiceDataDeletionFailureItem[];
  deletedObjectCount: number;
  deletedVoiceModelCount: number;
  unboundAgentCount: number;
  deletedTimbreCount: number;
}

@Provide()
export class VoiceServiceDataDeletionService {
  @Logger()
  logger: ILogger;

  @InjectEntityModel(VoiceServiceSessionEntity)
  voiceServiceSessionModel: MongoRepository<VoiceServiceSessionEntity>;

  @InjectEntityModel(VoiceTimbreEntity)
  voiceTimbreModel: MongoRepository<VoiceTimbreEntity>;

  @InjectEntityModel(AgentEntity)
  agentModel: MongoRepository<AgentEntity>;

  @Inject()
  tencentCosService: TencentCosService;

  @Inject()
  qwenVoiceEnrollmentService: QwenVoiceEnrollmentService;

  async deleteRequiredObject(objectKey: string): Promise<void> {
    try {
      await this.tencentCosService.deleteObject(objectKey);
    } catch (error) {
      throw new AppError(
        'VOICE_SERVICE_OBJECT_DELETE_FAILED',
        '声音文件删除失败，请稍后重试',
        502,
        {
          objectKey,
          causeCode: error instanceof AppError ? error.code : undefined,
          causeMessage: error instanceof Error ? error.message : String(error),
        }
      );
    }
  }

  recordDeletedObjectAudit(
    session: VoiceServiceSessionEntity,
    objectKey: string
  ): void {
    this.appendDeletedArtifactAudit(session, new Set([objectKey]));
  }

  async deleteSessionArtifacts(
    session: VoiceServiceSessionEntity
  ): Promise<VoiceServiceDataDeletionResult> {
    const failures: VoiceServiceDataDeletionFailureItem[] = [];
    const deletionCache = new Map<string, Promise<boolean>>();
    const deletedObjectKeys = new Set<string>();
    const timbres = await this.findSessionTimbres(session);
    let deletedVoiceModelCount = 0;
    let deletedTimbreCount = 0;

    for (const timbre of timbres) {
      const result = await this.deleteTimbreArtifacts(
        timbre,
        failures,
        deletionCache,
        deletedObjectKeys
      );
      if (result.providerModelDeleted) {
        deletedVoiceModelCount += 1;
      }
      if (result.completed) {
        deletedTimbreCount += 1;
      }
    }

    const unboundAgentCount = await this.unbindAgents(timbres, failures);
    const objectTargets = this.collectSessionObjectTargets(session);
    for (const [objectKey, artifactType] of objectTargets) {
      await this.deleteObjectOnce(
        objectKey,
        artifactType,
        failures,
        deletionCache,
        deletedObjectKeys
      );
    }

    this.appendDeletedArtifactAudit(session, deletedObjectKeys);
    session.materials = (session.materials ?? []).filter(
      item => !deletedObjectKeys.has(item.objectKey)
    );
    session.reviewClips = (session.reviewClips ?? []).filter(
      item => !deletedObjectKeys.has(item.objectKey)
    );
    session.filteredClips = [];
    if (
      session.trainingAudioObjectKey &&
      deletedObjectKeys.has(session.trainingAudioObjectKey)
    ) {
      session.trainingAudioObjectKey = undefined;
    }
    const sessionPreviewObjectKey = this.resolvePreviewObjectKey(
      session.previewAudioObjectKey,
      session.previewAudioUrl
    );
    if (
      !session.previewAudioUrl ||
      (sessionPreviewObjectKey &&
        deletedObjectKeys.has(sessionPreviewObjectKey))
    ) {
      session.previewAudioUrl = undefined;
      session.previewAudioObjectKey = undefined;
    }
    for (const attempt of session.processingAttempts ?? []) {
      attempt.residualAnalysisObjectKeys = (
        attempt.residualAnalysisObjectKeys ?? []
      ).filter(item => !deletedObjectKeys.has(item));
    }
    session.pendingDeletionObjectKeys = Array.from(
      new Set(
        failures
          .filter(item => item.artifactType !== 'voice_model')
          .map(item => item.target)
          .filter(item => this.isVoiceObjectKey(item))
      )
    );
    if (timbres.every(item => item.deletionStatus === 'completed')) {
      session.voiceTimbreId = undefined;
    }
    session.selectedAgentId = undefined;
    session.voiceAccessSource = undefined;
    session.voiceAccessReferenceId = undefined;
    session.voiceAccessVerifiedAt = undefined;
    session.voiceBindingStatus = undefined;
    session.voiceBoundAgentIds = [];
    session.voiceBoundAt = undefined;

    return {
      failures,
      deletedObjectCount: deletedObjectKeys.size,
      deletedVoiceModelCount,
      unboundAgentCount,
      deletedTimbreCount,
    };
  }

  async deleteSingleTimbreArtifacts(
    timbre: VoiceTimbreEntity
  ): Promise<VoiceServiceDataDeletionResult> {
    const objectTargetCount = this.collectTimbreObjectKeys(timbre).length;
    const failures: VoiceServiceDataDeletionFailureItem[] = [];
    const result = await this.deleteTimbreArtifacts(
      timbre,
      failures,
      new Map<string, Promise<boolean>>(),
      new Set<string>()
    );
    const unboundAgentCount = await this.unbindAgents([timbre], failures);

    return {
      failures,
      deletedObjectCount: result.completed ? objectTargetCount : 0,
      deletedVoiceModelCount: result.providerModelDeleted ? 1 : 0,
      unboundAgentCount,
      deletedTimbreCount: result.completed ? 1 : 0,
    };
  }

  async cleanupLateObjectKeys(
    sessionId: string,
    objectKeys: string[]
  ): Promise<void> {
    const failures: VoiceServiceDataDeletionFailureItem[] = [];
    const deletionCache = new Map<string, Promise<boolean>>();
    const deletedObjectKeys = new Set<string>();

    for (const objectKey of Array.from(new Set(objectKeys.filter(Boolean)))) {
      await this.deleteObjectOnce(
        objectKey,
        'late_worker_artifact',
        failures,
        deletionCache,
        deletedObjectKeys
      );
    }
    if (!failures.length) {
      return;
    }

    const session = await this.findSessionById(sessionId);
    if (!session) {
      return;
    }
    const now = new Date();
    session.pendingDeletionObjectKeys = Array.from(
      new Set([
        ...(session.pendingDeletionObjectKeys ?? []),
        ...failures.map(item => item.target),
      ])
    );
    session.dataDeletionFailures = [
      ...(session.dataDeletionFailures ?? []),
      ...failures,
    ];
    if (this.isCurrentDeletionContext(session)) {
      session.dataDeletionStatus = VoiceServiceDataDeletionStatus.partialFailed;
      session.dataDeletionFailureReason =
        '后台任务产生的声音文件仍有部分未删除，请重试';
      session.dataDeletionCompletedAt = undefined;
    }
    session.updatedAt = now;
    await this.voiceServiceSessionModel.save(session);
  }

  async cleanupLateTimbre(sessionId: string, timbreId: string): Promise<void> {
    const timbre = await this.findTimbreById(timbreId);
    if (!timbre) {
      return;
    }
    const failures: VoiceServiceDataDeletionFailureItem[] = [];
    await this.deleteTimbreArtifacts(
      timbre,
      failures,
      new Map<string, Promise<boolean>>(),
      new Set<string>()
    );
    if (!failures.length) {
      return;
    }

    const session = await this.findSessionById(sessionId);
    if (!session) {
      return;
    }
    session.dataDeletionFailures = [
      ...(session.dataDeletionFailures ?? []),
      ...failures,
    ];
    if (this.isCurrentDeletionContext(session)) {
      session.dataDeletionStatus = VoiceServiceDataDeletionStatus.partialFailed;
      session.dataDeletionFailureReason =
        '后台生成的声音模型仍有部分未删除，请重试';
      session.dataDeletionCompletedAt = undefined;
    }
    session.updatedAt = new Date();
    await this.voiceServiceSessionModel.save(session);
  }

  async cleanupLateSessionTimbres(sessionId: string): Promise<void> {
    const session = await this.findSessionById(sessionId);
    if (!session?.dataDeletionRequestedAt) {
      return;
    }

    const failures: VoiceServiceDataDeletionFailureItem[] = [];
    const deletionCache = new Map<string, Promise<boolean>>();
    const deletedObjectKeys = new Set<string>();
    const timbres = await this.findSessionTimbres(session);

    for (const timbre of timbres) {
      await this.deleteTimbreArtifacts(
        timbre,
        failures,
        deletionCache,
        deletedObjectKeys
      );
    }
    if (!failures.length) {
      return;
    }

    session.dataDeletionFailures = [
      ...(session.dataDeletionFailures ?? []),
      ...failures,
    ];
    if (this.isCurrentDeletionContext(session)) {
      session.dataDeletionStatus = VoiceServiceDataDeletionStatus.partialFailed;
      session.dataDeletionFailureReason =
        '后台生成的声音模型仍有部分未删除，请重试';
      session.dataDeletionCompletedAt = undefined;
    }
    session.updatedAt = new Date();
    await this.voiceServiceSessionModel.save(session);
  }

  private async deleteTimbreArtifacts(
    timbre: VoiceTimbreEntity,
    failures: VoiceServiceDataDeletionFailureItem[],
    deletionCache: Map<string, Promise<boolean>>,
    deletedObjectKeys: Set<string>
  ): Promise<TimbreDeletionResult> {
    const now = new Date();
    let completed = true;
    let providerModelDeleted = false;

    timbre.status = VoiceTimbreStatus.disabled;
    timbre.deletionStatus = 'pending';
    timbre.deletionRequestedAt ??= now;
    timbre.updatedAt = now;
    try {
      await this.voiceTimbreModel.save(timbre);
    } catch (error) {
      failures.push(
        this.buildFailure('voice_timbre_record', this.idOf(timbre), error)
      );
      completed = false;
    }

    const timbreObjectKeys = this.collectTimbreObjectKeys(timbre);
    for (const objectKey of timbreObjectKeys) {
      const deleted = await this.deleteObjectOnce(
        objectKey,
        objectKey === timbre.audioObjectKey
          ? 'training_audio'
          : 'preview_audio',
        failures,
        deletionCache,
        deletedObjectKeys
      );
      completed = completed && deleted;
    }

    if (!timbre.providerDeletedAt) {
      if (
        timbre.provider === VoiceTimbreProvider.qwen &&
        timbre.providerVoiceId &&
        !timbre.providerVoiceId.startsWith('pending_')
      ) {
        try {
          await this.qwenVoiceEnrollmentService.deleteVoice(
            timbre.providerVoiceId,
            timbre.previewModel
          );
          timbre.providerDeletedAt = new Date();
          providerModelDeleted = true;
        } catch (error) {
          failures.push(
            this.buildFailure('voice_model', timbre.providerVoiceId, error)
          );
          completed = false;
        }
      } else if (
        !timbre.providerVoiceId ||
        timbre.providerVoiceId.startsWith('pending_')
      ) {
        timbre.providerDeletedAt = new Date();
      } else {
        failures.push(
          this.buildFailure(
            'voice_model',
            timbre.providerVoiceId || this.idOf(timbre),
            new AppError(
              'VOICE_TIMBRE_PROVIDER_DELETE_UNSUPPORTED',
              `voice provider ${timbre.provider} does not support user deletion`,
              400
            )
          )
        );
        completed = false;
      }
    }

    if (completed) {
      timbre.audioObjectKey = '';
      timbre.audioUrl = '';
      timbre.previewAudioObjectKey = undefined;
      timbre.previewAudioUrl = undefined;
      timbre.generatedAudios = [];
      timbre.providerFileId = undefined;
      timbre.providerVoiceId = `deleted_${this.idOf(timbre)}`;
      timbre.deletionStatus = 'completed';
      timbre.deletedAt = new Date();
      timbre.deletionFailureReason = '';
    } else {
      if (deletedObjectKeys.has(timbre.audioObjectKey)) {
        timbre.audioObjectKey = '';
        timbre.audioUrl = '';
      }
      const previewObjectKey = this.resolvePreviewObjectKey(
        timbre.previewAudioObjectKey,
        timbre.previewAudioUrl
      );
      if (previewObjectKey && deletedObjectKeys.has(previewObjectKey)) {
        timbre.previewAudioObjectKey = undefined;
        timbre.previewAudioUrl = undefined;
      }
      timbre.generatedAudios = (timbre.generatedAudios ?? []).filter(
        item => !deletedObjectKeys.has(item.objectKey)
      );
      timbre.deletionStatus = 'partial_failed';
      timbre.deletionFailureReason = '部分声音数据删除失败，请重试';
    }
    timbre.updatedAt = new Date();
    try {
      await this.voiceTimbreModel.save(timbre);
    } catch (error) {
      failures.push(
        this.buildFailure('voice_timbre_record', this.idOf(timbre), error)
      );
      completed = false;
    }

    return { completed, providerModelDeleted };
  }

  private collectTimbreObjectKeys(timbre: VoiceTimbreEntity): string[] {
    return Array.from(
      new Set(
        [
          timbre.audioObjectKey,
          this.resolvePreviewObjectKey(
            timbre.previewAudioObjectKey,
            timbre.previewAudioUrl
          ),
          ...(timbre.generatedAudios ?? []).map(item => item.objectKey),
        ].filter((item): item is string => Boolean(item))
      )
    );
  }

  private async unbindAgents(
    timbres: VoiceTimbreEntity[],
    failures: VoiceServiceDataDeletionFailureItem[]
  ): Promise<number> {
    let unboundCount = 0;

    for (const timbre of timbres) {
      const [activeAgents, pendingAgents] = await Promise.all([
        this.agentModel.find({ where: { voiceTimbreId: timbre.id } }),
        this.agentModel.find({ where: { pendingVoiceTimbreId: timbre.id } }),
      ]);
      const agents = new Map<
        string,
        { agent: AgentEntity; active: boolean; pending: boolean }
      >();
      for (const agent of activeAgents) {
        agents.set(this.idOf(agent), { agent, active: true, pending: false });
      }
      for (const agent of pendingAgents) {
        const id = this.idOf(agent);
        const existing = agents.get(id);
        agents.set(id, {
          agent: existing?.agent ?? agent,
          active: existing?.active ?? false,
          pending: true,
        });
      }
      for (const { agent, active, pending } of agents.values()) {
        try {
          if (active) {
            agent.voiceTimbreId = null as never;
          }
          if (pending) {
            agent.pendingVoiceTimbreId = undefined;
          }
          agent.updatedAt = new Date();
          await this.agentModel.save(agent);
          unboundCount += 1;
        } catch (error) {
          failures.push(
            this.buildFailure('agent_binding', this.idOf(agent), error)
          );
        }
      }
    }

    return unboundCount;
  }

  private collectSessionObjectTargets(
    session: VoiceServiceSessionEntity
  ): Map<string, string> {
    const targets = new Map<string, string>();
    for (const item of session.materials ?? []) {
      targets.set(item.objectKey, 'original_material');
    }
    for (const item of session.reviewClips ?? []) {
      targets.set(item.objectKey, 'review_clip');
    }
    if (session.trainingAudioObjectKey) {
      targets.set(session.trainingAudioObjectKey, 'training_audio');
    }
    const previewObjectKey = this.resolvePreviewObjectKey(
      session.previewAudioObjectKey,
      session.previewAudioUrl
    );
    if (previewObjectKey) {
      targets.set(previewObjectKey, 'preview_audio');
    } else if (session.previewAudioUrl) {
      targets.set(session.previewAudioUrl, 'preview_audio_url');
    }
    for (const attempt of session.processingAttempts ?? []) {
      for (const objectKey of attempt.residualAnalysisObjectKeys ?? []) {
        targets.set(objectKey, 'analysis_audio');
      }
    }
    for (const objectKey of session.pendingDeletionObjectKeys ?? []) {
      targets.set(objectKey, 'pending_object');
    }

    return targets;
  }

  private appendDeletedArtifactAudit(
    session: VoiceServiceSessionEntity,
    deletedObjectKeys: Set<string>
  ): void {
    const deletedAt = new Date();
    const additions: VoiceServiceDeletedArtifactAuditItem[] = [];

    for (const material of session.materials ?? []) {
      if (!deletedObjectKeys.has(material.objectKey)) {
        continue;
      }
      additions.push({
        id: `deleted-material_${material.id}`,
        artifactType: 'original_material',
        sourceRecordId: material.id,
        durationSeconds: material.durationSeconds,
        objectKeyHash: this.hashObjectKey(material.objectKey),
        deletedAt,
      });
    }
    for (const clip of session.reviewClips ?? []) {
      if (!deletedObjectKeys.has(clip.objectKey)) {
        continue;
      }
      additions.push({
        id: `deleted-clip_${clip.id}`,
        artifactType: 'review_clip',
        sourceRecordId: clip.id,
        sourceMaterialId: clip.sourceMaterialId,
        durationSeconds: clip.durationSeconds,
        reviewStatus: clip.reviewStatus,
        rejectionReason: clip.rejectionReason,
        objectKeyHash: this.hashObjectKey(clip.objectKey),
        deletedAt,
      });
    }

    const auditById = new Map(
      (session.deletedArtifactAudit ?? []).map(item => [item.id, item])
    );
    for (const item of additions) {
      auditById.set(item.id, item);
    }
    session.deletedArtifactAudit = Array.from(auditById.values());
  }

  private async deleteObjectOnce(
    objectKey: string,
    artifactType: string,
    failures: VoiceServiceDataDeletionFailureItem[],
    cache: Map<string, Promise<boolean>>,
    deletedObjectKeys: Set<string>
  ): Promise<boolean> {
    if (!this.isVoiceObjectKey(objectKey)) {
      failures.push(
        this.buildFailure(
          artifactType,
          objectKey,
          new AppError(
            'VOICE_SERVICE_OBJECT_KEY_UNRESOLVED',
            'voice object key could not be resolved safely',
            422
          )
        )
      );
      return false;
    }

    let deletion = cache.get(objectKey);
    if (!deletion) {
      deletion = this.tencentCosService
        .deleteObject(objectKey)
        .then(() => {
          deletedObjectKeys.add(objectKey);
          return true;
        })
        .catch(error => {
          failures.push(this.buildFailure(artifactType, objectKey, error));
          return false;
        });
      cache.set(objectKey, deletion);
    }

    return deletion;
  }

  private async findSessionTimbres(
    session: VoiceServiceSessionEntity
  ): Promise<VoiceTimbreEntity[]> {
    const byId = new Map<string, VoiceTimbreEntity>();
    if (session.voiceTimbreId) {
      const linked = await this.findTimbreById(
        this.idOf(session.voiceTimbreId)
      );
      if (linked) {
        byId.set(this.idOf(linked), linked);
      }
    }

    const linkedBySession = await this.voiceTimbreModel.find({
      where: { voiceServiceSessionId: session.id },
    });
    for (const timbre of linkedBySession) {
      byId.set(this.idOf(timbre), timbre);
    }

    const sessionId = this.idOf(session);
    const escapedSessionId = sessionId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const legacy = await this.voiceTimbreModel.find({
      where: {
        remark: { $regex: escapedSessionId },
      } as never,
    });
    for (const timbre of legacy) {
      byId.set(this.idOf(timbre), timbre);
    }

    return Array.from(byId.values());
  }

  private async findTimbreById(
    timbreId: string
  ): Promise<VoiceTimbreEntity | null> {
    let id: MongoObjectId;
    try {
      id = new MongoObjectId(timbreId);
    } catch {
      return null;
    }

    return (
      (await this.voiceTimbreModel.findOne({ where: { id } })) ??
      (await this.voiceTimbreModel.findOne({
        where: { _id: id } as never,
      }))
    );
  }

  private async findSessionById(
    sessionId: string
  ): Promise<VoiceServiceSessionEntity | null> {
    let id: MongoObjectId;
    try {
      id = new MongoObjectId(sessionId);
    } catch {
      return null;
    }

    return (
      (await this.voiceServiceSessionModel.findOne({ where: { id } })) ??
      (await this.voiceServiceSessionModel.findOne({
        where: { _id: id } as never,
      }))
    );
  }

  private resolvePreviewObjectKey(
    objectKey: string | undefined,
    publicUrl: string | undefined
  ): string | undefined {
    if (objectKey && this.isVoiceObjectKey(objectKey)) {
      return objectKey;
    }

    return this.tencentCosService.resolveObjectKeyFromPublicUrl(
      publicUrl,
      VOICE_OBJECT_PREFIXES
    );
  }

  private isVoiceObjectKey(value: string): boolean {
    const normalized = value?.trim().replace(/^\/+/, '');
    return VOICE_OBJECT_PREFIXES.some(prefix =>
      normalized.startsWith(`${prefix}/`)
    );
  }

  private buildFailure(
    artifactType: string,
    target: string,
    error: unknown
  ): VoiceServiceDataDeletionFailureItem {
    return {
      id: `delete-failure_${Date.now().toString(36)}_${randomBytes(4).toString(
        'hex'
      )}`,
      artifactType,
      target: target.slice(0, 1000),
      code:
        error instanceof AppError
          ? error.code
          : 'VOICE_SERVICE_DATA_DELETE_FAILED',
      message:
        error instanceof Error
          ? error.message.slice(0, 1000)
          : String(error).slice(0, 1000),
      createdAt: new Date(),
    };
  }

  private hashObjectKey(objectKey: string): string {
    return createHash('sha256').update(objectKey).digest('hex');
  }

  private isCurrentDeletionContext(
    session: VoiceServiceSessionEntity
  ): boolean {
    if (
      session.dataDeletionStatus === VoiceServiceDataDeletionStatus.pending ||
      session.dataDeletionStatus ===
        VoiceServiceDataDeletionStatus.partialFailed
    ) {
      return true;
    }
    if (
      session.dataDeletionStatus !== VoiceServiceDataDeletionStatus.completed ||
      session.status !== VoiceServiceSessionStatus.collecting
    ) {
      return false;
    }

    return !(
      session.materials?.length ||
      session.reviewClips?.length ||
      session.trainingAudioObjectKey ||
      session.previewAudioUrl ||
      session.voiceTimbreId
    );
  }

  private idOf(value: { id?: unknown } | unknown): string {
    const source =
      value && typeof value === 'object' && 'id' in value
        ? (value as { id?: unknown }).id
        : value;
    const id = source as
      | { toHexString?: () => string; toString?: () => string }
      | undefined;

    return id?.toHexString?.() || id?.toString?.() || '';
  }
}
