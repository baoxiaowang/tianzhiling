import {
  AgentEntity,
  AgentSex,
  MongoObjectId,
  VipPlanEntity,
  VipPlanGroup,
  VipPlanStatus,
  VoiceServiceSessionEntity,
  VoiceServiceSessionStatus,
} from '@tzl/entities';
import { AppError } from '../../src/common/errors';
import { VoiceServiceService } from '../../src/service/voice-service.service';

const USER_ID = '665000000000000000000101';
const SESSION_ID = '665000000000000000000102';
const AGENT_ID = '665000000000000000000103';
const TIMBRE_ID = '665000000000000000000104';

function objectIdText(value: unknown) {
  return value && typeof value === 'object' && 'toHexString' in value
    ? (value as MongoObjectId).toHexString()
    : String(value ?? '');
}

function createService() {
  const sessions: VoiceServiceSessionEntity[] = [];
  const addJobToQueue = jest.fn().mockResolvedValue(undefined);
  const createReviewClips = jest.fn();
  const recutReviewClip = jest.fn();
  const trainVoiceModel = jest.fn();
  const deleteRequiredObject = jest.fn().mockResolvedValue(undefined);
  const recordDeletedObjectAudit = jest.fn();
  const cleanupLateObjectKeys = jest.fn().mockResolvedValue(undefined);
  const cleanupLateTimbre = jest.fn().mockResolvedValue(undefined);
  const cleanupLateSessionTimbres = jest.fn().mockResolvedValue(undefined);
  const resolveVoiceUsageAccess = jest
    .fn()
    .mockResolvedValue({ eligible: false });
  const deleteSessionArtifacts = jest.fn(
    async (session: VoiceServiceSessionEntity) => {
      session.materials = [];
      session.reviewClips = [];
      session.filteredClips = [];
      session.trainingAudioObjectKey = undefined;
      session.previewAudioUrl = undefined;
      session.previewAudioObjectKey = undefined;
      session.voiceTimbreId = undefined;
      session.selectedAgentId = undefined;
      return {
        failures: [],
        deletedObjectCount: 4,
        deletedVoiceModelCount: 1,
        unboundAgentCount: 1,
        deletedTimbreCount: 1,
      };
    }
  );
  const agent = Object.assign(new AgentEntity(), {
    id: new MongoObjectId(AGENT_ID),
    createdUserId: new MongoObjectId(USER_ID),
    name: '妈妈',
    avatar: '',
    sex: AgentSex.woman,
    agentCallMe: '孩子',
  });
  const vipPlans = [
    Object.assign(new VipPlanEntity(), {
      id: new MongoObjectId('665000000000000000000201'),
      code: 'vip_year_basic',
      name: '基础年会员',
      planGroup: VipPlanGroup.basic,
      priceAmount: 9900,
      currency: 'CNY',
      durationDays: 365,
      lifetime: false,
      status: VipPlanStatus.active,
      sort: 1,
    }),
    Object.assign(new VipPlanEntity(), {
      id: new MongoObjectId('665000000000000000000202'),
      code: 'vip_year_voice',
      name: '声音年会员',
      planGroup: VipPlanGroup.voice,
      priceAmount: 19900,
      currency: 'CNY',
      durationDays: 365,
      lifetime: false,
      status: VipPlanStatus.active,
      sort: 2,
    }),
  ];
  const sessionRepository = {
    create: jest.fn((value: Partial<VoiceServiceSessionEntity>) =>
      Object.assign(new VoiceServiceSessionEntity(), value)
    ),
    save: jest.fn(async (value: VoiceServiceSessionEntity) => {
      if (!value.id) {
        value.id = new MongoObjectId(SESSION_ID);
        sessions.push(value);
      }
      return value;
    }),
    find: jest.fn(async (options: Record<string, unknown>) => {
      const where = (options.where ?? {}) as Record<string, unknown>;
      return sessions.filter(item => {
        return (
          !where.userId ||
          objectIdText(item.userId) === objectIdText(where.userId)
        );
      });
    }),
    findOne: jest.fn(async (options: Record<string, unknown>) => {
      const where = (options.where ?? {}) as Record<string, unknown>;
      const id = where.id ?? where._id;
      return (
        sessions.find(item => objectIdText(item.id) === objectIdText(id)) ??
        null
      );
    }),
  };
  const service = new VoiceServiceService();
  service.voiceServiceSessionModel = sessionRepository as never;
  service.agentModel = {
    findOne: jest.fn(async (options: Record<string, unknown>) => {
      const where = (options.where ?? {}) as Record<string, unknown>;
      const id = where.id ?? where._id;
      return objectIdText(id) === AGENT_ID ? agent : null;
    }),
    save: jest.fn(async (value: AgentEntity) => value),
  } as never;
  service.vipPlanModel = {
    find: jest.fn(async () => vipPlans),
  } as never;
  service.openAIService = {
    isEnabled: jest.fn().mockReturnValue(false),
  } as never;
  service.tencentCosService = {
    isEnabled: jest.fn().mockReturnValue(false),
  } as never;
  service.voiceClippingService = {
    createReviewClips,
    recutReviewClip,
  } as never;
  service.voiceModelTrainingService = {
    train: trainVoiceModel,
  } as never;
  service.voiceServiceDataDeletionService = {
    deleteRequiredObject,
    recordDeletedObjectAudit,
    deleteSessionArtifacts,
    cleanupLateObjectKeys,
    cleanupLateTimbre,
    cleanupLateSessionTimbres,
  } as never;
  service.voiceUsageAccessService = {
    resolve: resolveVoiceUsageAccess,
  } as never;
  service.bullmqFramework = {
    getQueue: jest.fn(() => ({ addJobToQueue })),
  } as never;
  service.logger = {
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
  } as never;

  return {
    service,
    sessions,
    sessionRepository,
    agent,
    vipPlans,
    addJobToQueue,
    createReviewClips,
    recutReviewClip,
    trainVoiceModel,
    deleteRequiredObject,
    recordDeletedObjectAudit,
    deleteSessionArtifacts,
    cleanupLateObjectKeys,
    cleanupLateTimbre,
    cleanupLateSessionTimbres,
    resolveVoiceUsageAccess,
  };
}

describe('VoiceServiceService', () => {
  it('collects multiple materials before choosing an agent or package', async () => {
    const { service } = createService();

    const result = await service.addMaterials({ sub: USER_ID } as never, {
      materials: [
        {
          name: '微信语音录屏.mp4',
          objectKey: 'voice-training-materials/2026/08/wechat.mp4',
          durationSeconds: 35,
        },
        {
          name: '家庭视频.mp4',
          objectKey: 'voice-training-materials/2026/08/family.mp4',
          durationSeconds: 64,
        },
      ],
    });

    expect(result.status).toBe('collecting');
    expect(result.materials).toHaveLength(2);
    expect(result.selectedAgentId).toBeUndefined();
    expect(result.messages[result.messages.length - 1]?.text).toContain(
      '2 份素材已经保存成功'
    );
    expect(result.events.map(item => item.type)).toEqual([
      'session_created',
      'materials_added',
    ]);

    const resumed = await service.getCurrentSession({ sub: USER_ID } as never);
    expect(resumed).toEqual(
      expect.objectContaining({
        id: result.id,
        status: 'collecting',
        materials: expect.arrayContaining([
          expect.objectContaining({ name: '微信语音录屏.mp4' }),
          expect.objectContaining({ name: '家庭视频.mp4' }),
        ]),
      })
    );
    expect(resumed?.events.map(item => item.type)).toEqual([
      'session_created',
      'materials_added',
    ]);
  });

  it('starts a new collecting session after the previous voice is completed', async () => {
    const { service, sessions } = createService();
    const first = await service.startSession({ sub: USER_ID } as never);
    sessions[0].status = VoiceServiceSessionStatus.completed;
    sessions[0].voiceTimbreId = new MongoObjectId(TIMBRE_ID);

    const next = await service.startSession({ sub: USER_ID } as never);

    expect(first.status).toBe('collecting');
    expect(next.status).toBe('collecting');
    expect(sessions).toHaveLength(2);
    expect(sessions[0].status).toBe(VoiceServiceSessionStatus.completed);
    expect(sessions[1]).toEqual(
      expect.objectContaining({
        status: VoiceServiceSessionStatus.collecting,
        materials: [],
        reviewClips: [],
      })
    );
  });

  it('resumes an unfinished voice session instead of creating another one', async () => {
    const { service, sessions } = createService();
    const first = await service.startSession({ sub: USER_ID } as never);
    sessions[0].status = VoiceServiceSessionStatus.reviewing;

    const resumed = await service.startSession({ sub: USER_ID } as never);

    expect(resumed.id).toBe(first.id);
    expect(resumed.status).toBe('reviewing');
    expect(sessions).toHaveLength(1);
  });

  it('deletes the stored object before removing an individual material', async () => {
    const { service, deleteRequiredObject, recordDeletedObjectAudit } =
      createService();
    const collected = await service.addMaterials({ sub: USER_ID } as never, {
      materials: [
        {
          name: '原始录音.mp3',
          objectKey: 'voice-training-materials/2026/08/source.mp3',
        },
      ],
    });

    const result = await service.removeMaterial(
      { sub: USER_ID } as never,
      collected.id,
      collected.materials[0].id
    );

    expect(deleteRequiredObject).toHaveBeenCalledWith(
      'voice-training-materials/2026/08/source.mp3'
    );
    expect(recordDeletedObjectAudit).toHaveBeenCalledWith(
      expect.any(VoiceServiceSessionEntity),
      'voice-training-materials/2026/08/source.mp3'
    );
    expect(result.materials).toEqual([]);
  });

  it('keeps the material record when physical deletion fails', async () => {
    const { service, deleteRequiredObject } = createService();
    const collected = await service.addMaterials({ sub: USER_ID } as never, {
      materials: [
        {
          name: '原始录音.mp3',
          objectKey: 'voice-training-materials/2026/08/source.mp3',
        },
      ],
    });
    deleteRequiredObject.mockRejectedValueOnce(
      new AppError('VOICE_SERVICE_OBJECT_DELETE_FAILED', 'delete failed', 502)
    );

    await expect(
      service.removeMaterial(
        { sub: USER_ID } as never,
        collected.id,
        collected.materials[0].id
      )
    ).rejects.toMatchObject({ code: 'VOICE_SERVICE_OBJECT_DELETE_FAILED' });
    expect(await service.getCurrentSession({ sub: USER_ID } as never)).toEqual(
      expect.objectContaining({ materials: collected.materials })
    );
  });

  it('cancels active work and records a complete voice data deletion', async () => {
    const { service, sessions, deleteSessionArtifacts } = createService();
    const now = new Date();
    sessions.push(
      Object.assign(new VoiceServiceSessionEntity(), {
        id: new MongoObjectId(SESSION_ID),
        userId: new MongoObjectId(USER_ID),
        status: VoiceServiceSessionStatus.training,
        materials: [
          {
            id: 'material-1',
            name: '原始录音.mp3',
            objectKey: 'voice-training-materials/source.mp3',
            createdAt: now,
          },
        ],
        reviewClips: [],
        messages: [],
        events: [],
        processingAttempts: [
          {
            id: 'attempt-training',
            stage: 'training',
            jobId: 'training-job-1',
            queuedAt: now,
            outcome: 'processing',
          },
        ],
        trainingJobId: 'training-job-1',
        voiceTimbreId: new MongoObjectId(TIMBRE_ID),
        selectedAgentId: new MongoObjectId(AGENT_ID),
        createdAt: now,
        updatedAt: now,
      })
    );

    const result = await service.deleteVoiceData(
      { sub: USER_ID } as never,
      SESSION_ID
    );

    expect(deleteSessionArtifacts).toHaveBeenCalledWith(sessions[0]);
    expect(result).toEqual(
      expect.objectContaining({
        status: 'collecting',
        materials: [],
        reviewClips: [],
        voiceTimbreId: undefined,
        selectedAgentId: undefined,
        dataDeletionStatus: 'completed',
        dataDeletionCompletedAt: expect.any(String),
      })
    );
    expect(sessions[0].processingAttempts?.[0].outcome).toBe('cancelled');
    expect(result.events.map(item => item.type)).toEqual([
      'data_deletion_requested',
      'data_deletion_completed',
    ]);
  });

  it('explains free training and the purchase logic before payment', async () => {
    const { service } = createService();

    const result = await service.sendMessage(
      { sub: USER_ID } as never,
      undefined,
      { text: '语音训练为什么免费？方言重的话效果能保证吗？' }
    );

    expect(result.messages[result.messages.length - 1]?.text).toContain(
      '声音训练是免费的'
    );
    expect(result.messages[result.messages.length - 1]?.text).toContain(
      '方言、口音较重'
    );
    expect(result.messages[result.messages.length - 1]?.text).toContain(
      '再考虑要不要购买'
    );
    expect(result.messages[result.messages.length - 1]?.text).toContain(
      '不含声音服务的会员价格相对低一些'
    );
    expect(result.messages[result.messages.length - 1]?.text).toContain(
      '基础年会员（不含声音服务）99 元/年'
    );
    expect(result.messages[result.messages.length - 1]?.text).toContain(
      '声音年会员（含声音服务）199 元/年'
    );
    expect(result.messages[result.messages.length - 1]?.text).toContain(
      '以会员服务展示的最新信息为准'
    );
  });

  it('explains the two supported material import paths', async () => {
    const { service } = createService();

    const result = await service.sendMessage(
      { sub: USER_ID } as never,
      undefined,
      { text: '微信聊天里的语音消息怎么导入？' }
    );
    const reply = result.messages[result.messages.length - 1]?.text;

    expect(reply).toContain('只有两种添加方式');
    expect(reply).toContain('从微信聊天选择');
    expect(reply).toContain('从手机相册选择');
    expect(reply).toContain('微信原生语音消息不能直接导入');
    expect(reply).toContain('先播放他的语音并录屏');
  });

  it('recommends selecting no more than one minute of the best clips', async () => {
    const { service } = createService();

    const result = await service.sendMessage(
      { sub: USER_ID } as never,
      undefined,
      { text: '训练片段应该选择多长？' }
    );
    const reply = result.messages[result.messages.length - 1]?.text;

    expect(reply).toContain('精选在 1 分钟以内');
    expect(reply).toContain('声音不是越多越好');
    expect(reply).toContain('最清楚、最自然');
  });

  it('explains how an independent clip recut works', async () => {
    const { service } = createService();

    const result = await service.sendMessage(
      { sub: USER_ID } as never,
      undefined,
      { text: '再剪一下要怎么写？' }
    );
    const reply = result.messages[result.messages.length - 1]?.text;

    expect(reply).toContain('去掉开头 2 秒');
    expect(reply).toContain('只重新处理这一段');
    expect(reply).toContain('回到原位置');
  });

  it('uses the latest annual membership prices for every pricing question', async () => {
    const { service, vipPlans } = createService();
    const first = await service.sendMessage(
      { sub: USER_ID } as never,
      undefined,
      { text: '一年会员多少钱？' }
    );

    expect(first.messages[first.messages.length - 1]?.text).toContain(
      '声音年会员（含声音服务）199 元/年'
    );

    vipPlans[1].priceAmount = 22900;
    const second = await service.sendMessage(
      { sub: USER_ID } as never,
      first.id,
      { text: '现在一年多少钱？' }
    );

    expect(second.messages[second.messages.length - 1]?.text).toContain(
      '声音年会员（含声音服务）229 元/年'
    );
    expect(service.vipPlanModel.find).toHaveBeenCalledTimes(2);
  });

  it('starts training after any clip is selected while keeping pending clips', async () => {
    const { service, addJobToQueue } = createService();
    const collected = await service.addMaterials({ sub: USER_ID } as never, {
      materials: [
        {
          name: '微信语音录屏.mp4',
          objectKey: 'voice-training-materials/2026/08/wechat.mp4',
        },
      ],
    });
    const analyzing = await service.submitMaterials(
      { sub: USER_ID } as never,
      collected.id
    );
    expect(analyzing.status).toBe('analyzing');
    expect(analyzing.messages[analyzing.messages.length - 1]?.text).toContain(
      '预计需要 2–3 分钟'
    );
    expect(analyzing.events.map(item => item.type)).toContain(
      'materials_submitted'
    );
    expect(addJobToQueue).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: collected.id,
        clippingJobId: expect.stringContaining(
          `voice-service-clipping:${collected.id}`
        ),
      }),
      expect.objectContaining({ attempts: 3 })
    );
    const reviewing = await service.publishReviewClips(collected.id, [
      {
        sourceName: '微信语音录屏.mp4',
        objectKey: 'voice-service-clips/2026/08/clip-1.mp3',
        durationSeconds: 12,
      },
      {
        sourceName: '微信语音录屏.mp4',
        objectKey: 'voice-service-clips/2026/08/clip-2.mp3',
        durationSeconds: 9,
      },
    ]);

    expect(reviewing.status).toBe('reviewing');
    expect(reviewing.events.map(item => item.type)).toContain(
      'review_clips_ready'
    );
    await expect(
      service.startTraining({ sub: USER_ID } as never, collected.id)
    ).rejects.toMatchObject({
      code: 'VOICE_SERVICE_ACCEPTED_CLIP_REQUIRED',
    });

    const first = await service.reviewClip(
      { sub: USER_ID } as never,
      collected.id,
      reviewing.reviewClips[0].id,
      { reviewStatus: 'accepted' }
    );
    const training = await service.startTraining(
      { sub: USER_ID } as never,
      collected.id,
      { agentId: AGENT_ID }
    );

    expect(training.status).toBe('training');
    expect(training.previewAgentId).toBe(AGENT_ID);
    expect(training.previewText).toBe(
      '孩子，最近过得好吗？有没有好好吃饭，好好睡觉？'
    );
    expect(first.reviewClips[1].reviewStatus).toBe('pending');
    expect(training.messages[training.messages.length - 1]?.text).toContain(
      '开始免费训练'
    );
    expect(training.events.map(item => item.type)).toEqual(
      expect.arrayContaining(['clip_reviewed', 'training_started'])
    );
  });

  it('returns from training to clip review and cleans a late model result', async () => {
    const { service, sessions, trainVoiceModel, cleanupLateTimbre } =
      createService();
    const now = new Date();
    sessions.push(
      Object.assign(new VoiceServiceSessionEntity(), {
        id: new MongoObjectId(SESSION_ID),
        userId: new MongoObjectId(USER_ID),
        status: VoiceServiceSessionStatus.reviewing,
        materials: [],
        reviewClips: [
          {
            id: 'clip-accepted',
            objectKey: 'voice-service-clips/accepted.mp3',
            reviewStatus: 'accepted',
            createdAt: now,
          },
          {
            id: 'clip-rejected',
            objectKey: 'voice-service-clips/rejected.mp3',
            reviewStatus: 'rejected',
            rejectionReason: '不使用',
            createdAt: now,
          },
        ],
        messages: [],
        events: [],
        processingAttempts: [],
        createdAt: now,
        updatedAt: now,
      })
    );

    const training = await service.startTraining(
      { sub: USER_ID } as never,
      SESSION_ID
    );
    expect(training.status).toBe('training');
    const trainingJobId = sessions[0].trainingJobId;
    let resolveTrainingStarted: (() => void) | undefined;
    const trainingStarted = new Promise<void>(resolve => {
      resolveTrainingStarted = resolve;
    });
    let resolveTraining:
      | ((value: {
          voiceTimbreId: string;
          previewAudioUrl: string;
          previewAudioObjectKey: string;
          trainingAudioObjectKey: string;
        }) => void)
      | undefined;
    trainVoiceModel.mockImplementation(
      () =>
        new Promise(resolve => {
          resolveTraining = resolve;
          resolveTrainingStarted?.();
        })
    );
    const processing = service.processTrainingJob({
      sessionId: SESSION_ID,
      trainingJobId,
    });
    await trainingStarted;

    const returned = await service.returnToReview(
      { sub: USER_ID } as never,
      SESSION_ID
    );
    expect(returned).toEqual(
      expect.objectContaining({
        status: 'reviewing',
        reviewClips: [
          expect.objectContaining({
            id: 'clip-accepted',
            reviewStatus: 'accepted',
          }),
          expect.objectContaining({
            id: 'clip-rejected',
            reviewStatus: 'rejected',
          }),
        ],
      })
    );
    expect(returned.events.map(item => item.type)).toContain(
      'returned_to_review'
    );
    expect(sessions[0].trainingJobId).toBeUndefined();
    expect(sessions[0].processingAttempts?.[0]).toEqual(
      expect.objectContaining({
        jobId: trainingJobId,
        outcome: 'cancelled',
      })
    );

    resolveTraining?.({
      voiceTimbreId: TIMBRE_ID,
      previewAudioUrl: 'https://example.com/late-preview.mp3',
      previewAudioObjectKey: 'voice-timbre-previews/late-preview.mp3',
      trainingAudioObjectKey: 'voice-training-ready/late-training.wav',
    });
    await processing;

    expect(sessions[0].status).toBe(VoiceServiceSessionStatus.reviewing);
    expect(sessions[0].voiceTimbreId).toBeUndefined();
    expect(cleanupLateTimbre).toHaveBeenCalledWith(SESSION_ID, TIMBRE_ID);
  });

  it('returns from preview to clip review without rewriting training success', async () => {
    const { service, sessions, cleanupLateTimbre } = createService();
    const now = new Date();
    sessions.push(
      Object.assign(new VoiceServiceSessionEntity(), {
        id: new MongoObjectId(SESSION_ID),
        userId: new MongoObjectId(USER_ID),
        status: VoiceServiceSessionStatus.previewReady,
        materials: [],
        reviewClips: [
          {
            id: 'clip-accepted',
            objectKey: 'voice-service-clips/accepted.mp3',
            reviewStatus: 'accepted',
            createdAt: now,
          },
        ],
        messages: [],
        events: [],
        voiceTimbreId: new MongoObjectId(TIMBRE_ID),
        previewAudioUrl: 'https://example.com/preview.mp3',
        previewAudioObjectKey: 'voice-timbre-previews/preview.mp3',
        trainingAudioObjectKey: 'voice-training-ready/training.wav',
        trainingJobId: 'voice-service-training:completed',
        processingAttempts: [
          {
            id: 'attempt-training',
            stage: 'training',
            jobId: 'voice-service-training:completed',
            queuedAt: now,
            completedAt: now,
            outcome: 'succeeded',
            platformErrors: [],
          },
        ],
        createdAt: now,
        updatedAt: now,
      })
    );

    const returned = await service.returnToReview(
      { sub: USER_ID } as never,
      SESSION_ID
    );

    expect(returned.status).toBe('reviewing');
    expect(returned.voiceTimbreId).toBeUndefined();
    expect(returned.previewAudioUrl).toBeUndefined();
    expect(sessions[0].processingAttempts?.[0].outcome).toBe('succeeded');
    expect(cleanupLateTimbre).toHaveBeenCalledWith(SESSION_ID, TIMBRE_ID);
  });

  it('recuts one clip independently and returns it to pending review', async () => {
    const {
      service,
      sessions,
      addJobToQueue,
      recutReviewClip,
      cleanupLateObjectKeys,
    } = createService();
    const collected = await service.addMaterials({ sub: USER_ID } as never, {
      materials: [
        {
          name: '家庭视频.mp4',
          objectKey: 'voice-training-materials/2026/08/family.mp4',
        },
      ],
    });
    await service.submitMaterials({ sub: USER_ID } as never, collected.id);
    const reviewing = await service.publishReviewClips(collected.id, [
      {
        sourceMaterialId: collected.materials[0].id,
        sourceName: '家庭视频.mp4',
        objectKey: 'voice-service-clips/2026/08/original.mp3',
        publicUrl: 'https://example.com/original.mp3',
        durationSeconds: 10,
        transcript: '今天早点回家。',
      },
    ]);
    const clipId = reviewing.reviewClips[0].id;

    const queued = await service.requestClipRecut(
      { sub: USER_ID } as never,
      collected.id,
      clipId,
      { instruction: '去掉开头 2 秒' }
    );
    const recutJobId = sessions[0].reviewClips?.[0].recutJobId ?? '';

    expect(queued.reviewClips[0]).toEqual(
      expect.objectContaining({
        id: clipId,
        reviewStatus: 'pending',
        recutStatus: 'queued',
        recutInstruction: '去掉开头 2 秒',
      })
    );
    expect(addJobToQueue).toHaveBeenLastCalledWith(
      expect.objectContaining({
        jobType: 'clip_recut',
        sessionId: collected.id,
        clipId,
        recutJobId,
      }),
      expect.objectContaining({ jobId: recutJobId, attempts: 3 })
    );

    recutReviewClip.mockResolvedValue({
      sourceMaterialId: collected.materials[0].id,
      sourceName: '家庭视频.mp4',
      objectKey: 'voice-service-clips/2026/08/recut.mp3',
      publicUrl: 'https://example.com/recut.mp3',
      durationSeconds: 8,
      qualityScore: 92,
      qualityLabel: '已按要求重新剪辑，请试听确认',
      qualityMetrics: {
        durationSeconds: 8,
        silenceRatio: 0.1,
        rmsDb: -24,
        peakDb: -4,
        clippingRatio: 0,
      },
      qualityIssues: [],
      instruction: '去掉开头 2 秒',
      range: { startSeconds: 2, endSeconds: 10 },
    });
    await service.processClipRecutJob(
      {
        jobType: 'clip_recut',
        sessionId: collected.id,
        clipId,
        recutJobId,
      },
      { jobId: recutJobId, isFinalAttempt: true, workerAttempt: 1 }
    );

    const completed = await service.getCurrentSession({
      sub: USER_ID,
    } as never);
    expect(completed?.reviewClips[0]).toEqual(
      expect.objectContaining({
        id: clipId,
        objectKey: 'voice-service-clips/2026/08/recut.mp3',
        durationSeconds: 8,
        reviewStatus: 'pending',
        recutStatus: 'completed',
      })
    );
    expect(cleanupLateObjectKeys).toHaveBeenCalledWith(collected.id, [
      'voice-service-clips/2026/08/original.mp3',
    ]);
    expect(sessions[0].reviewClips?.[0].recutHistory?.[0]).toEqual(
      expect.objectContaining({
        jobId: recutJobId,
        status: 'completed',
        resultDurationSeconds: 8,
      })
    );

    const accepted = await service.reviewClip(
      { sub: USER_ID } as never,
      collected.id,
      clipId,
      { reviewStatus: 'accepted' }
    );
    expect(accepted.reviewClips[0].reviewStatus).toBe('accepted');
    expect(accepted.reviewClips[0].recutStatus).toBeUndefined();
  });

  it('keeps the original clip when independent recutting fails', async () => {
    const { service, sessions, recutReviewClip } = createService();
    const collected = await service.addMaterials({ sub: USER_ID } as never, {
      materials: [
        {
          name: '录音.mp3',
          objectKey: 'voice-training-materials/2026/08/source.mp3',
        },
      ],
    });
    await service.submitMaterials({ sub: USER_ID } as never, collected.id);
    const reviewing = await service.publishReviewClips(collected.id, [
      {
        objectKey: 'voice-service-clips/2026/08/original.mp3',
        durationSeconds: 8,
      },
    ]);
    const clipId = reviewing.reviewClips[0].id;
    await service.requestClipRecut(
      { sub: USER_ID } as never,
      collected.id,
      clipId,
      { instruction: '去掉开头 2 秒' }
    );
    const recutJobId = sessions[0].reviewClips?.[0].recutJobId ?? '';
    recutReviewClip.mockRejectedValue(
      new AppError(
        'VOICE_SERVICE_RECUT_UNUSABLE',
        '按这个范围剪完后，有效声音不足或质量不适合训练',
        422
      )
    );

    await expect(
      service.processClipRecutJob(
        {
          jobType: 'clip_recut',
          sessionId: collected.id,
          clipId,
          recutJobId,
        },
        { jobId: recutJobId, isFinalAttempt: true, workerAttempt: 3 }
      )
    ).rejects.toMatchObject({
      code: 'VOICE_SERVICE_RECUT_UNUSABLE',
    });

    const failed = await service.getCurrentSession({ sub: USER_ID } as never);
    expect(failed?.reviewClips[0]).toEqual(
      expect.objectContaining({
        objectKey: 'voice-service-clips/2026/08/original.mp3',
        reviewStatus: 'pending',
        recutStatus: 'failed',
        recutFailureCode: 'VOICE_SERVICE_RECUT_UNUSABLE',
      })
    );
  });

  it('publishes filtered quality records even when no clip is usable', async () => {
    const { service, sessions } = createService();
    const collected = await service.addMaterials({ sub: USER_ID } as never, {
      materials: [
        {
          name: '远距离录音.mp3',
          objectKey: 'voice-training-materials/2026/08/noisy.mp3',
        },
      ],
    });
    await service.submitMaterials({ sub: USER_ID } as never, collected.id);

    const reviewing = await service.publishReviewClips(
      collected.id,
      [],
      sessions[0].clippingJobId,
      {
        clips: [],
        filteredClips: [
          {
            sourceMaterialId: collected.materials[0].id,
            sourceName: '远距离录音.mp3',
            durationSeconds: 7.4,
            qualityMetrics: {
              durationSeconds: 7.4,
              silenceRatio: 0.2,
              rmsDb: -37,
              peakDb: -24,
              clippingRatio: 0,
              noiseFloorDb: -26,
              signalToNoiseDb: 2,
            },
            qualityIssues: [
              {
                code: 'background_noise_severe',
                severity: 'rejected',
                message: '估算信噪比仅 2 dB，背景噪声盖过人声',
              },
            ],
          },
        ],
        metrics: {
          recognitionDurationMs: 1200,
          recognitionMaterialCount: 1,
          filteredClipCount: 1,
          volumeAdjustedClipCount: 0,
        },
        platformErrors: [],
      }
    );

    expect(reviewing.status).toBe('reviewing');
    expect(reviewing.reviewClips).toEqual([]);
    expect(reviewing.filteredClips).toEqual([
      expect.objectContaining({
        sourceName: '远距离录音.mp3',
        qualityMetrics: expect.objectContaining({ signalToNoiseDb: 2 }),
        qualityIssues: [
          expect.objectContaining({ code: 'background_noise_severe' }),
        ],
      }),
    ]);
    expect(sessions[0].observability).toEqual(
      expect.objectContaining({
        generatedClipCount: 0,
        filteredClipCount: 1,
        volumeAdjustedClipCount: 0,
      })
    );
    expect(reviewing.messages[reviewing.messages.length - 1]?.text).toContain(
      '明显质量问题'
    );
  });

  it('cuts submitted materials in the background and publishes review clips', async () => {
    const { service, sessions, createReviewClips } = createService();
    const collected = await service.addMaterials({ sub: USER_ID } as never, {
      materials: [
        {
          name: '微信语音录屏.mp4',
          objectKey: 'voice-training-materials/2026/08/wechat.mp4',
        },
      ],
    });
    await service.submitMaterials({ sub: USER_ID } as never, collected.id);
    const clippingJobId = sessions[0].clippingJobId;
    createReviewClips.mockResolvedValue([
      {
        sourceMaterialId: collected.materials[0].id,
        sourceName: '微信语音录屏.mp4',
        objectKey: 'voice-service-clips/2026/08/clip-1.mp3',
        publicUrl: 'https://example.com/clip-1.mp3',
        durationSeconds: 12,
      },
    ]);

    await service.processClippingJob(
      { sessionId: collected.id, clippingJobId },
      { isFinalAttempt: false }
    );
    const result = await service.getCurrentSession({ sub: USER_ID } as never);

    expect(result?.status).toBe('reviewing');
    expect(result?.reviewClips).toEqual([
      expect.objectContaining({
        sourceName: '微信语音录屏.mp4',
        reviewStatus: 'pending',
      }),
    ]);
    expect(result?.messages[result.messages.length - 1]?.text).toContain(
      '请你逐段听一听'
    );
  });

  it('deletes clipping output that arrives after the session was cancelled', async () => {
    const { service, sessions, createReviewClips, cleanupLateObjectKeys } =
      createService();
    const collected = await service.addMaterials({ sub: USER_ID } as never, {
      materials: [
        {
          name: '原始录音.mp3',
          objectKey: 'voice-training-materials/source.mp3',
        },
      ],
    });
    await service.submitMaterials({ sub: USER_ID } as never, collected.id);
    const clippingJobId = sessions[0].clippingJobId;
    createReviewClips.mockImplementation(async () => {
      sessions[0].status = VoiceServiceSessionStatus.collecting;
      sessions[0].clippingJobId = undefined;
      return [
        {
          sourceName: '原始录音.mp3',
          objectKey: 'voice-service-clips/late.mp3',
          durationSeconds: 8,
        },
      ];
    });

    await service.processClippingJob({
      sessionId: collected.id,
      clippingJobId,
    });

    expect(cleanupLateObjectKeys).toHaveBeenCalledWith(collected.id, [
      'voice-service-clips/late.mp3',
    ]);
    expect(sessions[0].reviewClips).toEqual([]);
  });

  it('records queue time, recognition time, clip count and user adoption rate', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-03T00:00:00.000Z'));
    try {
      const { service, sessions } = createService();
      const collected = await service.addMaterials({ sub: USER_ID } as never, {
        materials: [
          {
            name: '多人家庭视频.mp4',
            objectKey: 'voice-training-materials/2026/08/family.mp4',
          },
        ],
      });
      await service.submitMaterials({ sub: USER_ID } as never, collected.id);
      const clippingJobId = sessions[0].clippingJobId;
      const recognitionStartedAt = new Date('2026-08-03T00:00:05.100Z');
      const recognitionCompletedAt = new Date('2026-08-03T00:00:07.400Z');
      (
        service.voiceClippingService as unknown as {
          createReviewClipsWithMetrics: jest.Mock;
        }
      ).createReviewClipsWithMetrics = jest.fn().mockResolvedValue({
        clips: [
          {
            sourceName: '多人家庭视频.mp4',
            objectKey: 'voice-service-clips/clip-1.mp3',
            durationSeconds: 12,
          },
          {
            sourceName: '多人家庭视频.mp4',
            objectKey: 'voice-service-clips/clip-2.mp3',
            durationSeconds: 9,
          },
        ],
        metrics: {
          recognitionStartedAt,
          recognitionCompletedAt,
          recognitionDurationMs: 2300,
          recognitionMaterialCount: 1,
        },
        platformErrors: [
          {
            provider: 'dashscope',
            operation: 'recognition',
            code: 'PARTIAL_TRANSCRIPTION_FAILED',
            message: 'one channel could not be recognized',
            requestId: 'dashscope-request-1',
            httpStatus: 502,
          },
        ],
      });

      jest.setSystemTime(new Date('2026-08-03T00:00:05.000Z'));
      await service.processClippingJob(
        { sessionId: collected.id, clippingJobId },
        { workerAttempt: 1 }
      );
      const reviewing = await service.getCurrentSession({
        sub: USER_ID,
      } as never);
      await service.reviewClip(
        { sub: USER_ID } as never,
        collected.id,
        reviewing?.reviewClips[0].id ?? '',
        { reviewStatus: 'accepted' }
      );
      await service.reviewClip(
        { sub: USER_ID } as never,
        collected.id,
        reviewing?.reviewClips[1].id ?? '',
        { reviewStatus: 'rejected', rejectionReason: '不是他的声音' }
      );

      expect(sessions[0].observability).toEqual(
        expect.objectContaining({
          clippingQueueDurationMs: 5000,
          recognitionDurationMs: 2300,
          recognitionMaterialCount: 1,
          generatedClipCount: 2,
          reviewedClipCount: 2,
          acceptedClipCount: 1,
          rejectedClipCount: 1,
          userAdoptionRate: 0.5,
          lastPlatformErrorCode: 'PARTIAL_TRANSCRIPTION_FAILED',
        })
      );
      expect(sessions[0].processingAttempts?.[0]).toEqual(
        expect.objectContaining({
          stage: 'clipping',
          jobId: clippingJobId,
          queueDurationMs: 5000,
          recognitionDurationMs: 2300,
          generatedClipCount: 2,
          userAdoptionRate: 0.5,
          outcome: 'succeeded',
          platformErrors: [
            expect.objectContaining({
              provider: 'dashscope',
              code: 'PARTIAL_TRANSCRIPTION_FAILED',
              requestId: 'dashscope-request-1',
              workerAttempt: 1,
            }),
          ],
        })
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('returns to uploaded materials and ignores a late clipping result', async () => {
    const { service } = createService();
    const collected = await service.addMaterials({ sub: USER_ID } as never, {
      materials: [
        {
          name: '微信语音录屏.mp4',
          objectKey: 'voice-training-materials/2026/08/wechat.mp4',
        },
      ],
    });
    await service.submitMaterials({ sub: USER_ID } as never, collected.id);

    const returned = await service.returnToMaterials(
      { sub: USER_ID } as never,
      collected.id
    );
    expect(returned).toEqual(
      expect.objectContaining({
        status: 'collecting',
        materials: [expect.objectContaining({ name: '微信语音录屏.mp4' })],
        reviewClips: [],
      })
    );
    expect(returned.events.map(item => item.type)).toContain(
      'returned_to_materials'
    );

    const afterLateResult = await service.publishReviewClips(collected.id, [
      {
        sourceName: '微信语音录屏.mp4',
        objectKey: 'voice-service-clips/2026/08/late.mp3',
        durationSeconds: 12,
      },
    ]);
    expect(afterLateResult.status).toBe('collecting');
    expect(afterLateResult.reviewClips).toEqual([]);
  });

  it('ignores an older clipping generation after the user resubmits materials', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-02T00:00:00.000Z'));
    try {
      const { service, sessions, createReviewClips } = createService();
      const collected = await service.addMaterials({ sub: USER_ID } as never, {
        materials: [
          {
            name: '微信语音录屏.mp4',
            objectKey: 'voice-training-materials/2026/08/wechat.mp4',
          },
        ],
      });
      await service.submitMaterials({ sub: USER_ID } as never, collected.id);
      const firstClippingJobId = sessions[0].clippingJobId;

      jest.setSystemTime(new Date('2026-08-02T00:01:00.000Z'));
      await service.returnToMaterials({ sub: USER_ID } as never, collected.id);

      jest.setSystemTime(new Date('2026-08-02T00:02:00.000Z'));
      await service.submitMaterials({ sub: USER_ID } as never, collected.id);
      const secondClippingJobId = sessions[0].clippingJobId;
      expect(secondClippingJobId).not.toBe(firstClippingJobId);

      await service.processClippingJob(
        { sessionId: collected.id, clippingJobId: firstClippingJobId },
        { isFinalAttempt: false }
      );
      expect(createReviewClips).not.toHaveBeenCalled();
      expect(sessions[0].status).toBe(VoiceServiceSessionStatus.analyzing);
      expect(sessions[0].reviewClips).toEqual([]);

      createReviewClips.mockResolvedValue([
        {
          sourceName: '微信语音录屏.mp4',
          objectKey: 'voice-service-clips/2026/08/current.mp3',
          durationSeconds: 12,
        },
      ]);
      await service.processClippingJob(
        { sessionId: collected.id, clippingJobId: secondClippingJobId },
        { isFinalAttempt: false }
      );

      expect(sessions[0].status).toBe(VoiceServiceSessionStatus.reviewing);
      expect(sessions[0].reviewClips).toEqual([
        expect.objectContaining({
          objectKey: 'voice-service-clips/2026/08/current.mp3',
        }),
      ]);
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps uploaded materials when background clipping finally fails', async () => {
    const { service, sessions, createReviewClips } = createService();
    const collected = await service.addMaterials({ sub: USER_ID } as never, {
      materials: [
        {
          name: '没有声音的视频.mp4',
          objectKey: 'voice-training-materials/2026/08/silent.mp4',
        },
      ],
    });
    await service.submitMaterials({ sub: USER_ID } as never, collected.id);
    const clippingJobId = sessions[0].clippingJobId;
    createReviewClips.mockRejectedValue(
      Object.assign(new Error('没有可用声音'), {
        code: 'VOICE_SERVICE_NO_USABLE_AUDIO',
      })
    );

    await expect(
      service.processClippingJob(
        { sessionId: collected.id, clippingJobId },
        { isFinalAttempt: true }
      )
    ).rejects.toThrow('没有可用声音');
    const result = await service.getCurrentSession({ sub: USER_ID } as never);

    expect(result?.status).toBe('failed');
    expect(result?.materials).toHaveLength(1);
    expect(result?.failureReason).toContain('素材已经替你保留');
  });

  it('requeues an unfinished clipping session when the user returns', async () => {
    const { service, sessions, addJobToQueue } = createService();
    const now = new Date();
    sessions.push(
      Object.assign(new VoiceServiceSessionEntity(), {
        id: new MongoObjectId(SESSION_ID),
        userId: new MongoObjectId(USER_ID),
        status: VoiceServiceSessionStatus.analyzing,
        materials: [
          {
            id: 'material-existing',
            name: '微信语音录屏.mp4',
            objectKey: 'voice-training-materials/2026/08/wechat.mp4',
            createdAt: now,
          },
        ],
        reviewClips: [],
        messages: [],
        events: [],
        createdAt: now,
        updatedAt: now,
      })
    );

    const result = await service.getCurrentSession({ sub: USER_ID } as never);

    expect(result?.status).toBe('analyzing');
    expect(sessions[0].clippingJobId).toContain(
      `voice-service-clipping:${SESSION_ID}`
    );
    expect(addJobToQueue).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: SESSION_ID,
        clippingJobId: expect.stringContaining(
          `voice-service-clipping:${SESSION_ID}`
        ),
      }),
      expect.objectContaining({ attempts: 3 })
    );
  });

  it('runs accepted clips through model training and publishes the preview', async () => {
    const { service, sessions, trainVoiceModel } = createService();
    const now = new Date();
    const session = Object.assign(new VoiceServiceSessionEntity(), {
      id: new MongoObjectId(SESSION_ID),
      userId: new MongoObjectId(USER_ID),
      status: VoiceServiceSessionStatus.training,
      materials: [],
      reviewClips: [],
      messages: [],
      events: [],
      trainingStartedAt: now,
      trainingJobId: `voice-service-training:${SESSION_ID}:${now.getTime()}`,
      createdAt: now,
      updatedAt: now,
    });
    sessions.push(session);
    trainVoiceModel.mockResolvedValue({
      voiceTimbreId: TIMBRE_ID,
      previewAudioUrl: 'https://example.com/preview.mp3',
      trainingAudioObjectKey: 'voice-training-ready/training.wav',
    });

    await service.processTrainingJob(
      { sessionId: SESSION_ID, trainingJobId: session.trainingJobId },
      { isFinalAttempt: false }
    );
    const result = await service.getCurrentSession({ sub: USER_ID } as never);

    expect(result).toEqual(
      expect.objectContaining({
        status: 'preview_ready',
        voiceTimbreId: TIMBRE_ID,
        previewAudioUrl: 'https://example.com/preview.mp3',
        trainingAudioObjectKey: 'voice-training-ready/training.wav',
      })
    );
    expect(result?.events.map(item => item.type)).toContain(
      'training_completed'
    );
  });

  it('deletes a voice model that finishes after user data deletion', async () => {
    const { service, sessions, trainVoiceModel, cleanupLateTimbre } =
      createService();
    const now = new Date();
    const session = Object.assign(new VoiceServiceSessionEntity(), {
      id: new MongoObjectId(SESSION_ID),
      userId: new MongoObjectId(USER_ID),
      status: VoiceServiceSessionStatus.training,
      materials: [],
      reviewClips: [],
      messages: [],
      events: [],
      trainingStartedAt: now,
      trainingJobId: 'training-job-late',
      createdAt: now,
      updatedAt: now,
    });
    sessions.push(session);
    trainVoiceModel.mockImplementation(async () => {
      session.status = VoiceServiceSessionStatus.collecting;
      session.trainingJobId = undefined;
      session.dataDeletionRequestedAt = new Date();
      return {
        voiceTimbreId: TIMBRE_ID,
        previewAudioUrl: 'https://example.com/preview.mp3',
        previewAudioObjectKey: 'voice-timbre-previews/preview.mp3',
        trainingAudioObjectKey: 'voice-training-ready/training.wav',
      };
    });

    await service.processTrainingJob({
      sessionId: SESSION_ID,
      trainingJobId: 'training-job-late',
    });

    expect(cleanupLateTimbre).toHaveBeenCalledWith(SESSION_ID, TIMBRE_ID);
    expect(session.voiceTimbreId).toBeUndefined();
  });

  it('ignores an older training generation after a retry starts', async () => {
    const { service, sessions, trainVoiceModel } = createService();
    const now = new Date();
    sessions.push(
      Object.assign(new VoiceServiceSessionEntity(), {
        id: new MongoObjectId(SESSION_ID),
        userId: new MongoObjectId(USER_ID),
        status: VoiceServiceSessionStatus.training,
        materials: [],
        reviewClips: [
          {
            id: 'clip-accepted',
            objectKey: 'voice-service-clips/accepted.mp3',
            reviewStatus: 'accepted',
            createdAt: now,
          },
        ],
        messages: [],
        events: [],
        trainingStartedAt: now,
        trainingJobId: `voice-service-training:${SESSION_ID}:new`,
        createdAt: now,
        updatedAt: now,
      })
    );
    trainVoiceModel.mockResolvedValue({
      voiceTimbreId: TIMBRE_ID,
      previewAudioUrl: 'https://example.com/old-preview.mp3',
      trainingAudioObjectKey: 'voice-training-ready/old.wav',
    });

    await service.processTrainingJob(
      {
        sessionId: SESSION_ID,
        trainingJobId: `voice-service-training:${SESSION_ID}:old`,
      },
      { isFinalAttempt: false }
    );

    expect(trainVoiceModel).not.toHaveBeenCalled();
    expect(sessions[0].status).toBe(VoiceServiceSessionStatus.training);
    expect(sessions[0].voiceTimbreId).toBeUndefined();
    expect(sessions[0].previewAudioUrl).toBeUndefined();
    expect(sessions[0].trainingAudioObjectKey).toBeUndefined();
  });

  it('keeps clip reviews when model training finally fails', async () => {
    const { service, sessions, trainVoiceModel } = createService();
    const now = new Date();
    sessions.push(
      Object.assign(new VoiceServiceSessionEntity(), {
        id: new MongoObjectId(SESSION_ID),
        userId: new MongoObjectId(USER_ID),
        status: VoiceServiceSessionStatus.training,
        materials: [],
        reviewClips: [
          {
            id: 'clip-accepted',
            objectKey: 'voice-service-clips/accepted.mp3',
            reviewStatus: 'accepted',
            createdAt: now,
          },
        ],
        messages: [],
        events: [],
        createdAt: now,
        updatedAt: now,
      })
    );
    trainVoiceModel.mockRejectedValue(new Error('provider unavailable'));

    await expect(
      service.processTrainingJob(
        { sessionId: SESSION_ID },
        { isFinalAttempt: true }
      )
    ).rejects.toThrow('provider unavailable');
    const result = await service.getCurrentSession({ sub: USER_ID } as never);

    expect(result?.status).toBe('failed');
    expect(result?.failureStage).toBe('training');
    expect(result?.reviewClips).toHaveLength(1);
    expect(result?.failureReason).toContain('不需要再次审核');

    const returned = await service.returnToReview(
      { sub: USER_ID } as never,
      SESSION_ID
    );
    expect(returned.status).toBe('reviewing');
    expect(returned.reviewClips[0]).toEqual(
      expect.objectContaining({
        id: 'clip-accepted',
        reviewStatus: 'accepted',
      })
    );

    const retried = await service.startTraining(
      { sub: USER_ID } as never,
      SESSION_ID
    );
    expect(retried.status).toBe('training');
    expect(retried.failureStage).toBeUndefined();
  });

  it('records provider errors and training success rate across a retry', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-08-03T01:00:00.000Z'));
    try {
      const { service, sessions, trainVoiceModel } = createService();
      const now = new Date();
      sessions.push(
        Object.assign(new VoiceServiceSessionEntity(), {
          id: new MongoObjectId(SESSION_ID),
          userId: new MongoObjectId(USER_ID),
          status: VoiceServiceSessionStatus.reviewing,
          materials: [],
          reviewClips: [
            {
              id: 'clip-accepted',
              objectKey: 'voice-service-clips/accepted.mp3',
              reviewStatus: 'accepted',
              createdAt: now,
            },
          ],
          messages: [],
          events: [],
          observability: {
            trainingAttemptCount: 0,
            trainingSuccessCount: 0,
            trainingFailureCount: 0,
          },
          processingAttempts: [],
          createdAt: now,
          updatedAt: now,
        })
      );
      await service.startTraining({ sub: USER_ID } as never, SESSION_ID);
      const firstJobId = sessions[0].trainingJobId;
      trainVoiceModel.mockRejectedValueOnce(
        new AppError('QWEN_QUOTA_EXCEEDED', 'provider quota exceeded', 502, {
          providerError: {
            provider: 'qwen',
            operation: 'voice_enrollment',
            code: 'QWEN_QUOTA_EXCEEDED',
            message: 'provider quota exceeded',
            requestId: 'qwen-request-1',
            httpStatus: 429,
          },
        })
      );

      jest.setSystemTime(new Date('2026-08-03T01:00:04.000Z'));
      await expect(
        service.processTrainingJob(
          { sessionId: SESSION_ID, trainingJobId: firstJobId },
          { isFinalAttempt: true, workerAttempt: 3 }
        )
      ).rejects.toMatchObject({ code: 'QWEN_QUOTA_EXCEEDED' });
      expect(sessions[0].observability).toEqual(
        expect.objectContaining({
          trainingQueueDurationMs: 4000,
          trainingAttemptCount: 1,
          trainingSuccessCount: 0,
          trainingFailureCount: 1,
          trainingSuccessRate: 0,
          lastPlatformErrorCode: 'QWEN_QUOTA_EXCEEDED',
        })
      );

      jest.setSystemTime(new Date('2026-08-03T01:01:00.000Z'));
      await service.startTraining({ sub: USER_ID } as never, SESSION_ID);
      const secondJobId = sessions[0].trainingJobId;
      trainVoiceModel.mockResolvedValueOnce({
        voiceTimbreId: TIMBRE_ID,
        previewAudioUrl: 'https://example.com/preview.mp3',
        trainingAudioObjectKey: 'voice-training-ready/training.wav',
      });
      jest.setSystemTime(new Date('2026-08-03T01:01:02.000Z'));
      await service.processTrainingJob(
        { sessionId: SESSION_ID, trainingJobId: secondJobId },
        { workerAttempt: 1 }
      );

      expect(sessions[0].observability).toEqual(
        expect.objectContaining({
          trainingQueueDurationMs: 2000,
          trainingAttemptCount: 2,
          trainingSuccessCount: 1,
          trainingFailureCount: 1,
          trainingSuccessRate: 0.5,
        })
      );
      expect(sessions[0].processingAttempts).toEqual([
        expect.objectContaining({
          jobId: firstJobId,
          outcome: 'failed',
          platformErrors: [
            expect.objectContaining({
              provider: 'qwen',
              operation: 'voice_enrollment',
              code: 'QWEN_QUOTA_EXCEEDED',
              requestId: 'qwen-request-1',
              workerAttempt: 3,
            }),
          ],
        }),
        expect.objectContaining({
          jobId: secondJobId,
          outcome: 'succeeded',
        }),
      ]);
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps the trained timbre pending when the user has no voice access', async () => {
    const { service, sessions, agent } = createService();
    const now = new Date();
    sessions.push(
      Object.assign(new VoiceServiceSessionEntity(), {
        id: new MongoObjectId(SESSION_ID),
        userId: new MongoObjectId(USER_ID),
        status: VoiceServiceSessionStatus.training,
        materials: [],
        reviewClips: [],
        messages: [],
        createdAt: now,
        updatedAt: now,
      })
    );
    await service.completeTraining(SESSION_ID, {
      voiceTimbreId: TIMBRE_ID,
      previewAudioUrl: 'https://example.com/preview.mp3',
    });

    const result = await service.selectAgent(
      { sub: USER_ID } as never,
      SESSION_ID,
      { agentId: AGENT_ID }
    );

    expect(result.selectedAgentId).toBe(AGENT_ID);
    expect(result.status).toBe('completed');
    expect(result.voiceAccessEligible).toBe(false);
    expect(result.voiceBindingStatus).toBe('purchase_required');
    expect(agent.voiceTimbreId).toBeUndefined();
    expect(result.messages[result.messages.length - 1]?.text).toContain(
      '真正使用声音回复时'
    );
    expect(result.events.map(item => item.type)).toEqual(
      expect.arrayContaining(['training_completed', 'agent_selected'])
    );
  });

  it('binds the trained timbre for a user with historical voice access', async () => {
    const { service, sessions, agent, resolveVoiceUsageAccess } =
      createService();
    const now = new Date();
    resolveVoiceUsageAccess.mockResolvedValue({
      eligible: true,
      source: 'admin_voice_order',
      referenceId: '665000000000000000000105',
    });
    sessions.push(
      Object.assign(new VoiceServiceSessionEntity(), {
        id: new MongoObjectId(SESSION_ID),
        userId: new MongoObjectId(USER_ID),
        status: VoiceServiceSessionStatus.previewReady,
        voiceTimbreId: new MongoObjectId(TIMBRE_ID),
        materials: [],
        reviewClips: [],
        messages: [],
        events: [],
        createdAt: now,
        updatedAt: now,
      })
    );

    const result = await service.selectAgent(
      { sub: USER_ID } as never,
      SESSION_ID,
      { agentId: AGENT_ID }
    );

    expect(objectIdText(agent.voiceTimbreId)).toBe(TIMBRE_ID);
    expect(result).toEqual(
      expect.objectContaining({
        voiceAccessEligible: true,
        voiceAccessSource: 'admin_voice_order',
        voiceBindingStatus: 'bound',
        voiceBoundAgentIds: [AGENT_ID],
      })
    );
    expect(result.events.map(item => item.type)).toContain('agent_voice_bound');
    expect(result.messages[result.messages.length - 1]?.text).toContain(
      '声音已接入'
    );
  });

  it('automatically binds a selected timbre after voice access is added', async () => {
    const { service, sessions, agent, resolveVoiceUsageAccess } =
      createService();
    const now = new Date();
    sessions.push(
      Object.assign(new VoiceServiceSessionEntity(), {
        id: new MongoObjectId(SESSION_ID),
        userId: new MongoObjectId(USER_ID),
        status: VoiceServiceSessionStatus.previewReady,
        voiceTimbreId: new MongoObjectId(TIMBRE_ID),
        materials: [],
        reviewClips: [],
        messages: [],
        events: [],
        createdAt: now,
        updatedAt: now,
      })
    );
    const selected = await service.selectAgent(
      { sub: USER_ID } as never,
      SESSION_ID,
      { agentId: AGENT_ID }
    );
    expect(selected.voiceBindingStatus).toBe('purchase_required');

    resolveVoiceUsageAccess.mockResolvedValue({
      eligible: true,
      source: 'voice_membership_order',
      referenceId: '665000000000000000000107',
    });
    const resumed = await service.getCurrentSession({
      sub: USER_ID,
    } as never);

    expect(objectIdText(agent.voiceTimbreId)).toBe(TIMBRE_ID);
    expect(resumed).toEqual(
      expect.objectContaining({
        voiceAccessEligible: true,
        voiceBindingStatus: 'bound',
      })
    );
    expect(resumed?.messages[resumed.messages.length - 1]?.text).toContain(
      '已经确认你的声音权益'
    );
  });

  it('preserves an existing backend voice binding', async () => {
    const { service, sessions, agent, resolveVoiceUsageAccess } =
      createService();
    const now = new Date();
    const existingTimbreId = new MongoObjectId('665000000000000000000106');
    agent.voiceTimbreId = existingTimbreId;
    resolveVoiceUsageAccess.mockResolvedValue({
      eligible: true,
      source: 'existing_voice_binding',
      referenceId: AGENT_ID,
    });
    sessions.push(
      Object.assign(new VoiceServiceSessionEntity(), {
        id: new MongoObjectId(SESSION_ID),
        userId: new MongoObjectId(USER_ID),
        status: VoiceServiceSessionStatus.previewReady,
        voiceTimbreId: new MongoObjectId(TIMBRE_ID),
        materials: [],
        reviewClips: [],
        messages: [],
        events: [],
        createdAt: now,
        updatedAt: now,
      })
    );

    const result = await service.selectAgent(
      { sub: USER_ID } as never,
      SESSION_ID,
      { agentId: AGENT_ID }
    );

    expect(objectIdText(agent.voiceTimbreId)).toBe(
      existingTimbreId.toHexString()
    );
    expect(result.voiceBindingStatus).toBe('existing_voice_preserved');
    expect(result.messages[result.messages.length - 1]?.text).toContain(
      '保留了原来的声音服务'
    );
  });
});
