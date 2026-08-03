import {
  AgentEntity,
  MongoObjectId,
  VoiceServiceDataDeletionStatus,
  VoiceServiceSessionEntity,
  VoiceServiceSessionStatus,
  VoiceTimbreEntity,
  VoiceTimbreProvider,
  VoiceTimbreStatus,
} from '@tzl/entities';
import { VoiceServiceDataDeletionService } from '../../src/service/voice-service-data-deletion.service';

const SESSION_ID = '665000000000000000000401';
const TIMBRE_ID = '665000000000000000000402';
const AGENT_ID = '665000000000000000000403';
const PENDING_AGENT_ID = '665000000000000000000404';

function createFixture() {
  const now = new Date('2026-08-03T00:00:00.000Z');
  const session = Object.assign(new VoiceServiceSessionEntity(), {
    id: new MongoObjectId(SESSION_ID),
    status: VoiceServiceSessionStatus.previewReady,
    materials: [
      {
        id: 'material-1',
        name: '原始录音.mp3',
        objectKey: 'voice-training-materials/source.mp3',
        createdAt: now,
      },
    ],
    reviewClips: [
      {
        id: 'clip-1',
        objectKey: 'voice-service-clips/clip.mp3',
        reviewStatus: 'accepted',
        createdAt: now,
      },
    ],
    filteredClips: [
      {
        id: 'filtered-clip-1',
        sourceMaterialId: 'material-1',
        sourceName: '原始录音.mp3',
        durationSeconds: 1.2,
        transcript: '太短的声音',
        qualityMetrics: {
          durationSeconds: 1.2,
          silenceRatio: 0.1,
          clippingRatio: 0,
          rmsDb: -24,
        },
        qualityIssues: [
          {
            code: 'too_short',
            severity: 'rejected',
            message: '时长不足 2 秒',
          },
        ],
        createdAt: now,
      },
    ],
    processingAttempts: [
      {
        id: 'attempt-1',
        stage: 'clipping',
        jobId: 'clipping-job-1',
        queuedAt: now,
        outcome: 'succeeded',
        residualAnalysisObjectKeys: ['voice-service-analysis/source.wav'],
      },
    ],
    trainingAudioObjectKey: 'voice-training-ready/training.wav',
    previewAudioObjectKey: 'voice-timbre-previews/preview.wav',
    previewAudioUrl:
      'https://oss.tianzhiling.chat/voice-timbre-previews/preview.wav',
    voiceTimbreId: new MongoObjectId(TIMBRE_ID),
    selectedAgentId: new MongoObjectId(AGENT_ID),
    createdAt: now,
    updatedAt: now,
  });
  const timbre = Object.assign(new VoiceTimbreEntity(), {
    id: new MongoObjectId(TIMBRE_ID),
    name: '用户声音',
    provider: VoiceTimbreProvider.qwen,
    providerVoiceId: 'qwen_voice_123',
    voiceServiceSessionId: session.id,
    audioObjectKey: 'voice-training-ready/training.wav',
    audioUrl: 'https://oss.tianzhiling.chat/voice-training-ready/training.wav',
    previewAudioObjectKey: 'voice-timbre-previews/preview.wav',
    previewAudioUrl:
      'https://oss.tianzhiling.chat/voice-timbre-previews/preview.wav',
    generatedAudios: [
      {
        id: 'generated-1',
        text: '我一直都在这里。',
        objectKey: 'voice-timbre-generated/custom.mp3',
        publicUrl:
          'https://oss.tianzhiling.chat/voice-timbre-generated/custom.mp3',
        speechSpeed: 1,
        speechVolume: 1,
        createdAt: now,
      },
    ],
    cloneLanguage: 'zh',
    status: VoiceTimbreStatus.active,
    createdAt: now,
    updatedAt: now,
  });
  const agent = Object.assign(new AgentEntity(), {
    id: new MongoObjectId(AGENT_ID),
    voiceTimbreId: timbre.id,
    createdAt: now,
    updatedAt: now,
  });
  const pendingAgent = Object.assign(new AgentEntity(), {
    id: new MongoObjectId(PENDING_AGENT_ID),
    pendingVoiceTimbreId: timbre.id,
    createdAt: now,
    updatedAt: now,
  });
  const deleteObject = jest.fn().mockResolvedValue(undefined);
  const deleteVoice = jest.fn().mockResolvedValue({});
  const service = new VoiceServiceDataDeletionService();
  service.logger = { warn: jest.fn(), error: jest.fn() } as never;
  service.tencentCosService = {
    deleteObject,
    resolveObjectKeyFromPublicUrl: jest.fn().mockReturnValue(undefined),
  } as never;
  service.qwenVoiceEnrollmentService = { deleteVoice } as never;
  service.voiceTimbreModel = {
    findOne: jest.fn(async () => timbre),
    find: jest.fn(async () => [timbre]),
    save: jest.fn(async (value: VoiceTimbreEntity) => value),
  } as never;
  service.agentModel = {
    find: jest.fn(async options => {
      const where = options?.where as Record<string, unknown> | undefined;
      if (where?.voiceTimbreId) {
        return agent.voiceTimbreId ? [agent] : [];
      }
      if (where?.pendingVoiceTimbreId) {
        return pendingAgent.pendingVoiceTimbreId ? [pendingAgent] : [];
      }
      return [];
    }),
    save: jest.fn(async (value: AgentEntity) => value),
  } as never;
  service.voiceServiceSessionModel = {
    findOne: jest.fn(async () => session),
    save: jest.fn(async (value: VoiceServiceSessionEntity) => value),
  } as never;

  return {
    service,
    session,
    timbre,
    agent,
    pendingAgent,
    deleteObject,
    deleteVoice,
  };
}

describe('VoiceServiceDataDeletionService', () => {
  it('deletes every stored artifact, provider model and agent binding', async () => {
    const {
      service,
      session,
      timbre,
      agent,
      pendingAgent,
      deleteObject,
      deleteVoice,
    } = createFixture();

    const result = await service.deleteSessionArtifacts(session);

    expect(new Set(deleteObject.mock.calls.map(([key]) => key))).toEqual(
      new Set([
        'voice-training-materials/source.mp3',
        'voice-service-clips/clip.mp3',
        'voice-service-analysis/source.wav',
        'voice-training-ready/training.wav',
        'voice-timbre-previews/preview.wav',
        'voice-timbre-generated/custom.mp3',
      ])
    );
    expect(deleteVoice).toHaveBeenCalledWith('qwen_voice_123');
    expect(result.unboundAgentCount).toBe(2);
    expect(agent.voiceTimbreId).toBeNull();
    expect(pendingAgent.pendingVoiceTimbreId).toBeUndefined();
    expect(session.materials).toEqual([]);
    expect(session.reviewClips).toEqual([]);
    expect(session.filteredClips).toEqual([]);
    expect(session.trainingAudioObjectKey).toBeUndefined();
    expect(session.previewAudioUrl).toBeUndefined();
    expect(session.voiceTimbreId).toBeUndefined();
    expect(session.deletedArtifactAudit).toEqual([
      expect.objectContaining({
        artifactType: 'original_material',
        sourceRecordId: 'material-1',
        objectKeyHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
      expect.objectContaining({
        artifactType: 'review_clip',
        sourceRecordId: 'clip-1',
        reviewStatus: 'accepted',
        objectKeyHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    ]);
    expect(timbre).toEqual(
      expect.objectContaining({
        providerVoiceId: `deleted_${TIMBRE_ID}`,
        audioObjectKey: '',
        generatedAudios: [],
        status: VoiceTimbreStatus.disabled,
        deletionStatus: 'completed',
        deletedAt: expect.any(Date),
      })
    );
    expect(result).toEqual(
      expect.objectContaining({
        failures: [],
        deletedObjectCount: 6,
        deletedVoiceModelCount: 1,
        deletedTimbreCount: 1,
        unboundAgentCount: 2,
      })
    );
  });

  it('retains failed object references so a later request can retry them', async () => {
    const { service, session, deleteObject } = createFixture();
    deleteObject.mockImplementation(async (objectKey: string) => {
      if (objectKey === 'voice-service-clips/clip.mp3') {
        throw new Error('COS unavailable');
      }
    });

    const first = await service.deleteSessionArtifacts(session);

    expect(first.failures).toEqual([
      expect.objectContaining({
        artifactType: 'review_clip',
        target: 'voice-service-clips/clip.mp3',
      }),
    ]);
    expect(session.reviewClips).toEqual([
      expect.objectContaining({ objectKey: 'voice-service-clips/clip.mp3' }),
    ]);
    expect(session.pendingDeletionObjectKeys).toEqual([
      'voice-service-clips/clip.mp3',
    ]);

    deleteObject.mockResolvedValue(undefined);
    const retried = await service.deleteSessionArtifacts(session);

    expect(retried.failures).toEqual([]);
    expect(session.reviewClips).toEqual([]);
    expect(session.pendingDeletionObjectKeys).toEqual([]);
  });

  it('does not let an old deletion status block a newer training workflow', async () => {
    const { service, session } = createFixture();
    session.status = VoiceServiceSessionStatus.training;
    session.dataDeletionStatus = VoiceServiceDataDeletionStatus.completed;
    session.dataDeletionRequestedAt = new Date('2026-08-01T00:00:00.000Z');
    session.dataDeletionCompletedAt = new Date('2026-08-01T00:00:10.000Z');
    service.qwenVoiceEnrollmentService.deleteVoice = jest
      .fn()
      .mockRejectedValue(new Error('provider unavailable'));

    await service.cleanupLateTimbre(SESSION_ID, TIMBRE_ID);

    expect(session.dataDeletionStatus).toBe(
      VoiceServiceDataDeletionStatus.completed
    );
    expect(session.dataDeletionCompletedAt).toEqual(
      new Date('2026-08-01T00:00:10.000Z')
    );
    expect(session.dataDeletionFailures).toEqual([
      expect.objectContaining({ artifactType: 'voice_model' }),
    ]);
  });
});
