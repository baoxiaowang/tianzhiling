import {
  AgentEntity,
  MongoObjectId,
  VoiceServiceClipReviewStatus,
  VoiceServiceSessionEntity,
  VoiceTimbreEntity,
  VoiceTimbreProvider,
  VoiceTimbreStatus,
} from '@tzl/entities';
import { VoiceTimbreLibraryService } from '../../src/service/voice-timbre-library.service';

const USER_ID = '665000000000000000000401';
const OTHER_USER_ID = '665000000000000000000402';
const SESSION_ID = '665000000000000000000403';
const TIMBRE_ID = '665000000000000000000404';
const AGENT_ID = '665000000000000000000405';
const OTHER_TIMBRE_ID = '665000000000000000000406';

function createFixture(
  options: {
    legacyOwner?: boolean;
    usageCount?: number;
    voiceAccessEligible?: boolean;
    agentHasBinding?: boolean;
  } = {}
) {
  const userId = new MongoObjectId(USER_ID);
  const timbre = Object.assign(new VoiceTimbreEntity(), {
    id: new MongoObjectId(TIMBRE_ID),
    userId: options.legacyOwner ? undefined : userId,
    name: '妈妈的声音',
    provider: VoiceTimbreProvider.qwen,
    providerVoiceId: 'qwen_voice_library_test',
    voiceServiceSessionId: new MongoObjectId(SESSION_ID),
    audioObjectKey: 'voice-training-ready/test.wav',
    cloneLanguage: 'zh',
    previewModel: 'qwen3-tts-vc-test',
    previewAudioUrl: 'https://example.com/preview.wav',
    status: VoiceTimbreStatus.active,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  });
  const session = Object.assign(new VoiceServiceSessionEntity(), {
    id: new MongoObjectId(SESSION_ID),
    userId,
    voiceTimbreId: timbre.id,
    trainingCompletedAt: new Date('2026-01-02T00:00:00.000Z'),
    reviewClips: [
      {
        id: 'clip_1',
        objectKey: 'voice-service-clips/clip-1.wav',
        publicUrl: 'https://example.com/clip-1.wav',
        sourceName: '微信录屏.mp4',
        durationSeconds: 18,
        transcript: '今天天气很好',
        qualityScore: 88,
        qualityLabel: '清晰',
        reviewStatus: VoiceServiceClipReviewStatus.accepted,
      },
    ],
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  });
  const agent = Object.assign(new AgentEntity(), {
    id: new MongoObjectId(AGENT_ID),
    createdUserId: userId,
    name: '妈妈',
    voiceTimbreId: options.agentHasBinding === false ? undefined : timbre.id,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const timbres: VoiceTimbreEntity[] = [timbre];
  const sessions = [session];
  const agents = [agent];
  const service = new VoiceTimbreLibraryService();

  service.logger = { warn: jest.fn() } as never;
  service.voiceTimbreModel = {
    find: jest.fn(async (optionsArg: { where?: Record<string, unknown> }) => {
      const where = optionsArg?.where || {};
      if (where.userId) {
        return timbres.filter(
          item => String(item.userId || '') === String(where.userId)
        );
      }
      if (where.provider || where.status) {
        return timbres.filter(
          item =>
            (!where.provider || item.provider === where.provider) &&
            (!where.status || item.status === where.status)
        );
      }
      return timbres;
    }),
    findOne: jest.fn(async (optionsArg: { where?: Record<string, unknown> }) => {
      const value = optionsArg?.where?.id || optionsArg?.where?._id;
      return timbres.find(item => String(item.id) === String(value)) || null;
    }),
    save: jest.fn(async (item: VoiceTimbreEntity) => item),
  } as never;
  service.voiceServiceSessionModel = {
    find: jest.fn(async (optionsArg: { where?: Record<string, unknown> }) => {
      const where = optionsArg?.where || {};
      if (where.userId) {
        return sessions.filter(item => String(item.userId) === String(where.userId));
      }
      if (where.voiceTimbreId) {
        return sessions.filter(
          item => String(item.voiceTimbreId) === String(where.voiceTimbreId)
        );
      }
      return sessions;
    }),
    findOne: jest.fn(async (optionsArg: { where?: Record<string, unknown> }) => {
      const value = optionsArg?.where?.id || optionsArg?.where?._id;
      return sessions.find(item => String(item.id) === String(value)) || null;
    }),
    save: jest.fn(async (item: VoiceServiceSessionEntity) => item),
  } as never;
  service.agentModel = {
    find: jest.fn(async (optionsArg: { where?: Record<string, unknown> }) => {
      const owner = optionsArg?.where?.createdUserId;
      return agents.filter(item => String(item.createdUserId) === String(owner));
    }),
    findOne: jest.fn(async (optionsArg: { where?: Record<string, unknown> }) => {
      const value = optionsArg?.where?.id || optionsArg?.where?._id;
      return agents.find(item => String(item.id) === String(value)) || null;
    }),
    save: jest.fn(async (item: AgentEntity) => item),
  } as never;
  service.voiceServiceDataDeletionService = {
    deleteSingleTimbreArtifacts: jest.fn(async (item: VoiceTimbreEntity) => {
      item.status = VoiceTimbreStatus.disabled;
      item.deletionStatus = 'completed';
      item.deletedAt = new Date();
      return {
        failures: [],
        deletedObjectCount: 2,
        deletedVoiceModelCount: 1,
        unboundAgentCount: 1,
        deletedTimbreCount: 1,
      };
    }),
  } as never;
  service.qwenVoiceSpeechService = {
    synthesize: jest.fn().mockResolvedValue({
      audioUrl: '',
      audioBuffer: Buffer.from('retained'),
      mimeType: 'audio/wav',
    }),
  } as never;
  service.voiceFfmpegService = {
    adjustSpeechOutput: jest.fn().mockResolvedValue({
      buffer: Buffer.from('adjusted'),
      contentType: 'audio/mpeg',
      fileName: 'speech.mp3',
    }),
  } as never;
  service.tencentCosService = {
    getPublicUrl: jest.fn((objectKey: string) => `https://cos.test/${objectKey}`),
    putBuffer: jest.fn().mockResolvedValue({
      objectKey: 'voice-timbre-generated/custom.mp3',
      url: 'https://example.com/custom.mp3',
    }),
  } as never;
  const redisStore = new Map<string, string>();
  service.redisService = {
    get: jest.fn(async (key: string) => {
      if (
        !redisStore.has(key) &&
        key.includes('custom-speech:usage:') &&
        options.usageCount !== undefined
      ) {
        return String(options.usageCount);
      }
      return redisStore.get(key) ?? null;
    }),
    set: jest.fn(
      async (key: string, value: string, ...args: Array<string | number>) => {
        if (args.includes('NX') && redisStore.has(key)) {
          return null;
        }
        redisStore.set(key, String(value));
        return 'OK';
      }
    ),
    incr: jest.fn(async (key: string) => {
      const next = Number(redisStore.get(key) ?? options.usageCount ?? 0) + 1;
      redisStore.set(key, String(next));
      return next;
    }),
    decr: jest.fn(async (key: string) => {
      const next = Number(redisStore.get(key) ?? 0) - 1;
      redisStore.set(key, String(next));
      return next;
    }),
    del: jest.fn(async (key: string) => {
      const deleted = redisStore.delete(key);
      return deleted ? 1 : 0;
    }),
  } as never;
  service.voiceUsageAccessService = {
    resolve: jest.fn().mockResolvedValue({
      eligible: options.voiceAccessEligible !== false,
      source:
        options.voiceAccessEligible === false
          ? undefined
          : 'voice_membership_record',
      referenceId:
        options.voiceAccessEligible === false ? undefined : 'membership-1',
    }),
  } as never;
  return { service, timbre, timbres, session, agent, redisStore };
}

describe('VoiceTimbreLibraryService', () => {
  it('backfills historical ownership and returns only the current user library', async () => {
    const { service, timbre } = createFixture({ legacyOwner: true });

    const result = await service.getLibrary({ sub: USER_ID } as never);

    expect(String(timbre.userId)).toBe(USER_ID);
    expect(timbre.providerLastUsedAt?.toISOString()).toBe(
      '2026-01-02T00:00:00.000Z'
    );
    expect(result.items).toEqual([
      expect.objectContaining({
        id: TIMBRE_ID,
        name: '妈妈的声音',
        bindings: [{ agentId: AGENT_ID, agentName: '妈妈' }],
      }),
    ]);
    expect(result.retentionPolicy).toEqual(
      expect.objectContaining({
        inactiveCleanupDays: 365,
        providerVoiceLimit: 1000,
        automaticRetentionEnabled: true,
      })
    );

    await expect(
      service.updateTimbre(
        { sub: OTHER_USER_ID } as never,
        TIMBRE_ID,
        { name: '别人的音色' }
      )
    ).rejects.toMatchObject({ code: 'VOICE_TIMBRE_NOT_FOUND' });
  });

  it('returns the exact accepted clips selected for training', async () => {
    const { service, timbre } = createFixture();

    const result = await service.getDetail({ sub: USER_ID } as never, TIMBRE_ID);

    expect(timbre.trainingClipIds).toEqual(['clip_1']);
    expect(result).toEqual(
      expect.objectContaining({
        id: TIMBRE_ID,
        speechSpeed: 1,
        speechVolume: 1,
        trainingAudioUrl: 'https://cos.test/voice-training-ready/test.wav',
        trainingClips: [
          expect.objectContaining({
            id: 'clip_1',
            sourceName: '微信录屏.mp4',
            audioUrl: 'https://example.com/clip-1.wav',
          }),
        ],
        customSpeechTextMaxLength: 100,
        customSpeechDailyLimit: 5,
        customSpeechGeneratedToday: 0,
        customSpeechRemainingToday: 5,
        voiceAccessEligible: true,
      })
    );
  });

  it('saves a selected timbre as pending until voice membership is available', async () => {
    const { service, agent, session } = createFixture({
      voiceAccessEligible: false,
      agentHasBinding: false,
    });

    const result = await service.selectAgentVoiceTimbre(
      { sub: USER_ID } as never,
      AGENT_ID,
      { timbreId: TIMBRE_ID }
    );

    expect(String(agent.pendingVoiceTimbreId)).toBe(TIMBRE_ID);
    expect(agent.voiceTimbreId).toBeNull();
    expect(result).toEqual(
      expect.objectContaining({
        selectedTimbreId: TIMBRE_ID,
        activeTimbreId: undefined,
        voiceAccessEligible: false,
        selectionStatus: 'pending_membership',
      })
    );
    expect(session.voiceBindingStatus).toBe('purchase_required');
    expect(session.events?.[session.events.length - 1]).toEqual(
      expect.objectContaining({
        type: 'agent_selected',
        metadata: expect.objectContaining({ timbreId: TIMBRE_ID }),
      })
    );
  });

  it('activates a pending timbre after voice membership becomes available', async () => {
    const { service, agent } = createFixture({
      voiceAccessEligible: false,
      agentHasBinding: false,
    });
    await service.selectAgentVoiceTimbre(
      { sub: USER_ID } as never,
      AGENT_ID,
      { timbreId: TIMBRE_ID }
    );
    service.voiceUsageAccessService.resolve = jest.fn().mockResolvedValue({
      eligible: true,
      source: 'voice_membership_record',
      referenceId: 'membership-2',
    });

    const result = await service.getAgentVoiceModelCenter(
      { sub: USER_ID } as never,
      AGENT_ID
    );

    expect(String(agent.voiceTimbreId)).toBe(TIMBRE_ID);
    expect(agent.pendingVoiceTimbreId).toBeUndefined();
    expect(result.selectionStatus).toBe('active');
    expect(result.activeTimbreId).toBe(TIMBRE_ID);
  });

  it('requires confirmation before replacing a pending timbre selection', async () => {
    const { service, timbre, timbres, agent } = createFixture({
      voiceAccessEligible: false,
      agentHasBinding: false,
    });
    const otherTimbre = Object.assign(new VoiceTimbreEntity(), timbre, {
      id: new MongoObjectId(OTHER_TIMBRE_ID),
      name: '原来选择的音色',
    });
    timbres.push(otherTimbre);
    agent.pendingVoiceTimbreId = otherTimbre.id;

    await expect(
      service.selectAgentVoiceTimbre(
        { sub: USER_ID } as never,
        AGENT_ID,
        { timbreId: TIMBRE_ID }
      )
    ).rejects.toMatchObject({
      code: 'VOICE_TIMBRE_REPLACE_CONFIRM_REQUIRED',
    });

    const result = await service.selectAgentVoiceTimbre(
      { sub: USER_ID } as never,
      AGENT_ID,
      { timbreId: TIMBRE_ID, replaceExisting: true }
    );

    expect(String(agent.pendingVoiceTimbreId)).toBe(TIMBRE_ID);
    expect(result.selectionStatus).toBe('pending_membership');
  });

  it('saves output settings and generated custom speech', async () => {
    const { service, timbre } = createFixture();
    await service.updateTimbre({ sub: USER_ID } as never, TIMBRE_ID, {
      speechSpeed: 1.2,
      speechVolume: 1.35,
    });

    const result = await service.generateSpeech(
      { sub: USER_ID } as never,
      TIMBRE_ID,
      { text: '  我一直都在这里。  ' }
    );

    expect(service.qwenVoiceSpeechService.synthesize).toHaveBeenCalledWith(
      expect.objectContaining({ text: '我一直都在这里。' })
    );
    expect(service.voiceFfmpegService.adjustSpeechOutput).toHaveBeenCalledWith(
      expect.objectContaining({ speechSpeed: 1.2, speechVolume: 1.35 })
    );
    expect(service.tencentCosService.putBuffer).toHaveBeenCalledWith(
      Buffer.from('adjusted'),
      expect.objectContaining({ folder: 'voice-timbre-generated' })
    );
    expect(timbre.generatedAudios).toEqual([
      expect.objectContaining({
        text: '我一直都在这里。',
        objectKey: 'voice-timbre-generated/custom.mp3',
        speechSpeed: 1.2,
        speechVolume: 1.35,
      }),
    ]);
    expect(result).toEqual(
      expect.objectContaining({
        text: '我一直都在这里。',
        audioUrl: 'https://example.com/custom.mp3',
        remainingToday: 4,
      })
    );
  });

  it('rejects custom speech over 100 characters before calling the provider', async () => {
    const { service } = createFixture();

    await expect(
      service.generateSpeech({ sub: USER_ID } as never, TIMBRE_ID, {
        text: '声'.repeat(101),
      })
    ).rejects.toMatchObject({
      code: 'VOICE_TIMBRE_SPEECH_TEXT_TOO_LONG',
    });
    expect(service.qwenVoiceSpeechService.synthesize).not.toHaveBeenCalled();
  });

  it('limits all custom speech generation for one user to five per Beijing day', async () => {
    const { service } = createFixture({ usageCount: 5 });

    await expect(
      service.generateSpeech(
        { sub: USER_ID } as never,
        TIMBRE_ID,
        { text: '明天再继续。' }
      )
    ).rejects.toMatchObject({
      code: 'VOICE_TIMBRE_SPEECH_DAILY_LIMIT_REACHED',
      status: 429,
    });
    expect(service.qwenVoiceSpeechService.synthesize).not.toHaveBeenCalled();
  });

  it('counts generated speech across every timbre owned by the user', async () => {
    const { service, timbres } = createFixture();
    const otherTimbre = Object.assign(new VoiceTimbreEntity(), {
      id: new MongoObjectId('665000000000000000000406'),
      userId: new MongoObjectId(USER_ID),
      name: '另一个音色',
      provider: VoiceTimbreProvider.qwen,
      providerVoiceId: 'qwen_voice_library_other',
      audioObjectKey: 'voice-training-ready/other.wav',
      status: VoiceTimbreStatus.active,
      generatedAudios: Array.from({ length: 5 }, (_, index) => ({
        id: `generated-other-${index}`,
        text: `第 ${index + 1} 条`,
        objectKey: `voice-timbre-generated/other-${index}.mp3`,
        speechSpeed: 1,
        speechVolume: 1,
        createdAt: new Date(),
      })),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    timbres.push(otherTimbre);

    await expect(
      service.generateSpeech(
        { sub: USER_ID } as never,
        TIMBRE_ID,
        { text: '不能通过切换音色增加次数。' }
      )
    ).rejects.toMatchObject({
      code: 'VOICE_TIMBRE_SPEECH_DAILY_LIMIT_REACHED',
    });
  });

  it('returns the reserved daily generation count when synthesis fails', async () => {
    const { service, redisStore } = createFixture();
    service.qwenVoiceSpeechService.synthesize = jest
      .fn()
      .mockRejectedValue(new Error('provider unavailable'));

    await expect(
      service.generateSpeech(
        { sub: USER_ID } as never,
        TIMBRE_ID,
        { text: '这次生成会失败。' }
      )
    ).rejects.toThrow('provider unavailable');

    const usageCount = Array.from(redisStore.entries()).find(([key]) =>
      key.includes('custom-speech:usage:')
    )?.[1];
    expect(usageCount).toBe('0');
    expect(
      Array.from(redisStore.keys()).some(key =>
        key.includes('custom-speech:lock:')
      )
    ).toBe(false);
  });

  it('uses the voice before the provider cleanup deadline and extends retention', async () => {
    const { service, timbre } = createFixture();
    timbre.providerLastUsedAt = new Date(Date.now() - 350 * 24 * 60 * 60 * 1000);
    timbre.providerEstimatedCleanupAt = new Date(
      timbre.providerLastUsedAt.getTime() + 365 * 24 * 60 * 60 * 1000
    );

    const before = Date.now();
    const result = await service.processRetentionMaintenance();

    expect(result).toEqual({
      checkedCount: 1,
      protectedCount: 1,
      failedCount: 0,
    });
    expect(service.qwenVoiceSpeechService.synthesize).toHaveBeenCalledWith(
      expect.objectContaining({ voiceId: 'qwen_voice_library_test' })
    );
    expect(timbre.retentionStatus).toBe('protected');
    expect(timbre.providerEstimatedCleanupAt?.getTime()).toBeGreaterThan(
      before + 360 * 24 * 60 * 60 * 1000
    );
  });

  it('permanently deletes one timbre and clears its session reference', async () => {
    const { service, timbre, session } = createFixture();

    const result = await service.deleteTimbre(
      { sub: USER_ID } as never,
      TIMBRE_ID
    );

    expect(result.deletionStatus).toBe('completed');
    expect(
      service.voiceServiceDataDeletionService.deleteSingleTimbreArtifacts
    ).toHaveBeenCalledWith(timbre);
    expect(session.voiceTimbreId).toBeUndefined();
    expect(session.previewAudioUrl).toBeUndefined();
  });
});
