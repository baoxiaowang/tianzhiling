import { AppError } from '@tzl/shared';
import {
  MongoObjectId,
  VoiceTimbreEntity,
  VoiceTimbreProvider,
  VoiceTimbreStatus,
} from '@tzl/entities';
import {
  AdminVoiceTimbreService,
  DEFAULT_VOICE_TIMBRE_PREVIEW_TEXT,
  VOICE_TIMBRE_CREATE_QUEUE,
} from './admin-voice-timbre.service';

const TIMBRE_ID = new MongoObjectId('665000000000000000000501');
const UPDATED_AT = new Date('2026-05-03T08:00:00.000Z');

function createTimbre(
  status: VoiceTimbreStatus = VoiceTimbreStatus.creating
): VoiceTimbreEntity {
  return {
    id: TIMBRE_ID,
    name: '测试音色',
    provider: VoiceTimbreProvider.minimax,
    providerVoiceId: 'TestVoice_001',
    providerFileId: '',
    audioObjectKey: 'voice-timbres/demo.wav',
    audioUrl: 'https://cdn.example.com/voice-timbres/demo.wav',
    cloneLanguage: 'Chinese',
    previewText: '今天天气很好',
    previewModel: 'speech-2.8-turbo',
    previewAudioUrl: '',
    speechSpeed: 1.08,
    speechVolume: 1,
    speechPitch: 0,
    status,
    errorCode: '',
    errorMessage: '',
    remark: '',
    createdAt: UPDATED_AT,
    updatedAt: UPDATED_AT,
  } as VoiceTimbreEntity;
}

function createService() {
  const service = new AdminVoiceTimbreService();
  const queue = {
    addJobToQueue: jest.fn().mockResolvedValue(undefined),
  };

  service.voiceTimbreModel = {
    count: jest.fn(),
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(async timbre => {
      if (!timbre.id) {
        timbre.id = TIMBRE_ID;
      }

      return timbre;
    }),
  } as any;
  service.storageFileService = {
    normalizeForStorage: jest.fn(value => value),
    resolve: jest.fn(value => `https://cdn.example.com/${value}`),
    download: jest.fn().mockResolvedValue({
      buffer: Buffer.from('wav'),
      fileName: 'demo.wav',
      contentType: 'audio/wav',
    }),
  } as any;
  service.ffmpegService = {
    extractAudioToWav: jest.fn(),
  } as any;
  service.minimaxVoiceService = {
    getDefaultPreviewModel: jest.fn(() => 'speech-2.8-turbo'),
    uploadCloneAudio: jest.fn().mockResolvedValue('file_001'),
    cloneVoice: jest.fn().mockResolvedValue({
      providerVoiceId: 'TestVoice_001',
      demoAudio: 'https://cdn.example.com/demo-output.mp3',
    }),
  } as any;
  service.bullmqFramework = {
    getQueue: jest.fn(name =>
      name === VOICE_TIMBRE_CREATE_QUEUE ? queue : undefined
    ),
  } as any;

  return { service, queue };
}

describe('AdminVoiceTimbreService voice timbre create queue', () => {
  it('lists all timbres without pagination when all is true', async () => {
    const { service } = createService();
    const activeTimbre = createTimbre(VoiceTimbreStatus.active);
    const disabledTimbre = {
      ...createTimbre(VoiceTimbreStatus.disabled),
      id: new MongoObjectId('665000000000000000000502'),
      name: '已禁用音色',
    } as VoiceTimbreEntity;

    jest
      .mocked(service.voiceTimbreModel.find)
      .mockResolvedValue([activeTimbre, disabledTimbre]);

    const result = await service.listVoiceTimbres({ all: 'true' });

    expect(service.voiceTimbreModel.count).not.toHaveBeenCalled();
    expect(service.voiceTimbreModel.find).toHaveBeenCalledWith({
      where: {},
      order: {
        updatedAt: 'DESC',
      },
    });
    expect(result).toEqual(
      expect.objectContaining({
        total: 2,
        page: 1,
        pageSize: 2,
      })
    );
    expect(result.items.map(item => item.status)).toEqual([
      VoiceTimbreStatus.active,
      VoiceTimbreStatus.disabled,
    ]);
  });

  it('creates a creating timbre and enqueues provider creation', async () => {
    const { service, queue } = createService();

    jest.mocked(service.voiceTimbreModel.findOne).mockResolvedValue(null);

    const result = await service.createVoiceTimbre({
      name: ' 测试音色 ',
      provider: 'minimax',
      providerVoiceId: 'TestVoice_001',
      audioObjectKey: 'voice-timbres/demo.wav',
      cloneLanguage: 'Chinese',
      previewText: '今天天气很好',
      speechSpeed: 1.08,
      speechVolume: 1,
      speechPitch: 0,
      remark: '',
    });

    expect(service.voiceTimbreModel.save).toHaveBeenCalledWith(
      expect.objectContaining({
        name: '测试音色',
        speechSpeed: 1.08,
        speechVolume: 1,
        speechPitch: 0,
        status: VoiceTimbreStatus.creating,
        audioObjectKey: 'voice-timbres/demo.wav',
        audioUrl: '',
        errorCode: '',
        errorMessage: '',
      })
    );
    expect(queue.addJobToQueue).toHaveBeenCalledWith(
      {
        timbreId: TIMBRE_ID.toHexString(),
      },
      expect.objectContaining({
        jobId: expect.stringContaining(
          `voice-timbre-create:${TIMBRE_ID.toHexString()}:`
        ),
        attempts: 3,
      })
    );
    expect(service.minimaxVoiceService.uploadCloneAudio).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        id: TIMBRE_ID.toHexString(),
        speechSpeed: 1.08,
        speechVolume: 1,
        speechPitch: 0,
        status: VoiceTimbreStatus.creating,
      })
    );
  });

  it('fills default preview text when creating without one', async () => {
    const { service } = createService();

    jest.mocked(service.voiceTimbreModel.findOne).mockResolvedValue(null);

    await service.createVoiceTimbre({
      name: '测试音色',
      provider: 'minimax',
      providerVoiceId: 'TestVoice_001',
      audioObjectKey: 'voice-timbres/demo.wav',
    });

    expect(service.voiceTimbreModel.save).toHaveBeenCalledWith(
      expect.objectContaining({
        cloneLanguage: 'auto',
        previewText: DEFAULT_VOICE_TIMBRE_PREVIEW_TEXT,
      })
    );
  });

  it('updates output speech settings without re-cloning the timbre', async () => {
    const { service } = createService();
    const timbre = createTimbre(VoiceTimbreStatus.active);

    jest.mocked(service.voiceTimbreModel.findOne).mockResolvedValue(timbre);

    const result = await service.updateVoiceTimbre(TIMBRE_ID.toHexString(), {
      speechSpeed: 1.16,
      speechVolume: 1.2,
      speechPitch: -1,
    });

    expect(service.minimaxVoiceService.uploadCloneAudio).not.toHaveBeenCalled();
    expect(service.minimaxVoiceService.cloneVoice).not.toHaveBeenCalled();
    expect(service.voiceTimbreModel.save).toHaveBeenCalledWith(
      expect.objectContaining({
        speechSpeed: 1.16,
        speechVolume: 1.2,
        speechPitch: -1,
      })
    );
    expect(result).toEqual(
      expect.objectContaining({
        speechSpeed: 1.16,
        speechVolume: 1.2,
        speechPitch: -1,
      })
    );
  });

  it('re-trains an enabled timbre after editing preview text', async () => {
    const { service, queue } = createService();
    const timbre = createTimbre(VoiceTimbreStatus.active);
    const oldProviderVoiceId = timbre.providerVoiceId;

    timbre.providerFileId = 'old_file';
    timbre.previewAudioUrl = 'https://cdn.example.com/old.mp3';
    jest.mocked(service.voiceTimbreModel.findOne).mockResolvedValue(timbre);

    const result = await service.updateVoiceTimbre(TIMBRE_ID.toHexString(), {
      name: '更新音色',
      status: VoiceTimbreStatus.active,
      previewText: '我好想你，最近过得好吗，有没有好好吃饭',
      speechSpeed: 1.05,
      speechVolume: 1,
      speechPitch: 0,
      remark: '更新后重训',
    });

    expect(timbre).toEqual(
      expect.objectContaining({
        name: '更新音色',
        status: VoiceTimbreStatus.creating,
        providerFileId: '',
        providerVoiceId: expect.stringMatching(/^TzlVoice_/),
        previewAudioUrl: '',
      })
    );
    expect(timbre.providerVoiceId).not.toBe(oldProviderVoiceId);
    expect(queue.addJobToQueue).toHaveBeenCalledWith(
      {
        timbreId: TIMBRE_ID.toHexString(),
      },
      expect.objectContaining({
        jobId: expect.stringContaining(
          `voice-timbre-create:${TIMBRE_ID.toHexString()}:`
        ),
      })
    );
    expect(result.status).toBe(VoiceTimbreStatus.creating);
  });

  it('does not re-train a timbre when editing it to disabled', async () => {
    const { service, queue } = createService();
    const timbre = createTimbre(VoiceTimbreStatus.active);

    jest.mocked(service.voiceTimbreModel.findOne).mockResolvedValue(timbre);

    const result = await service.updateVoiceTimbre(TIMBRE_ID.toHexString(), {
      status: VoiceTimbreStatus.disabled,
      previewText: '我好想你，最近过得好吗，有没有好好吃饭',
    });

    expect(queue.addJobToQueue).not.toHaveBeenCalled();
    expect(result.status).toBe(VoiceTimbreStatus.disabled);
  });

  it('processes the create job and marks the timbre active', async () => {
    const { service } = createService();
    const timbre = createTimbre();

    jest.mocked(service.voiceTimbreModel.findOne).mockResolvedValue(timbre);

    await service.processCreateVoiceTimbreJob({
      timbreId: TIMBRE_ID.toHexString(),
    });

    expect(service.storageFileService.download).toHaveBeenCalledWith(
      'voice-timbres/demo.wav'
    );
    expect(service.minimaxVoiceService.uploadCloneAudio).toHaveBeenCalledWith({
      buffer: Buffer.from('wav'),
      fileName: 'demo.wav',
      contentType: 'audio/wav',
    });
    expect(service.minimaxVoiceService.cloneVoice).toHaveBeenCalledWith(
      expect.objectContaining({
        fileId: 'file_001',
        voiceId: 'TestVoice_001',
        text: '今天天气很好',
        languageBoost: 'Chinese',
      })
    );
    expect(timbre).toEqual(
      expect.objectContaining({
        providerFileId: 'file_001',
        previewAudioUrl: 'https://cdn.example.com/demo-output.mp3',
        status: VoiceTimbreStatus.active,
        errorCode: '',
        errorMessage: '',
      })
    );
  });

  it('retries MiniMax clone with a new provider voice id when duplicate', async () => {
    const { service } = createService();
    const timbre = createTimbre();

    jest.mocked(service.voiceTimbreModel.findOne).mockResolvedValue(timbre);
    jest
      .mocked(service.minimaxVoiceService.cloneVoice)
      .mockRejectedValueOnce(
        new AppError(
          'MINIMAX_VOICE_CLONE_FAILED',
          'voice clone voice id duplicate',
          502,
          {
            status_code: 2039,
            status_msg: 'voice clone voice id duplicate',
          }
        )
      )
      .mockImplementationOnce(async input => ({
        providerVoiceId: input.voiceId,
        demoAudio: 'https://cdn.example.com/demo-output.mp3',
      }));

    await service.processCreateVoiceTimbreJob({
      timbreId: TIMBRE_ID.toHexString(),
    });

    expect(service.minimaxVoiceService.cloneVoice).toHaveBeenCalledTimes(2);
    expect(service.minimaxVoiceService.cloneVoice).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        voiceId: 'TestVoice_001',
      })
    );
    expect(service.minimaxVoiceService.cloneVoice).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        voiceId: expect.stringMatching(/^TzlVoice_/),
      })
    );
    expect(timbre).toEqual(
      expect.objectContaining({
        providerVoiceId: expect.stringMatching(/^TzlVoice_/),
        previewAudioUrl: 'https://cdn.example.com/demo-output.mp3',
        status: VoiceTimbreStatus.active,
      })
    );
  });

  it('marks permanent MiniMax api-key failures failed without retry throw', async () => {
    const { service } = createService();
    const timbre = createTimbre();

    jest.mocked(service.voiceTimbreModel.findOne).mockResolvedValue(timbre);
    jest
      .mocked(service.minimaxVoiceService.uploadCloneAudio)
      .mockRejectedValue(
        new AppError('MINIMAX_UPLOAD_FAILED', 'invalid api key', 502, {
          status_code: 2049,
          status_msg: 'invalid api key',
        })
      );

    await expect(
      service.processCreateVoiceTimbreJob({
        timbreId: TIMBRE_ID.toHexString(),
      })
    ).resolves.toBeUndefined();
    expect(timbre).toEqual(
      expect.objectContaining({
        status: VoiceTimbreStatus.failed,
        errorCode: 'MINIMAX_UPLOAD_FAILED',
        errorMessage: 'invalid api key',
      })
    );
  });

  it('retries a failed timbre by resetting status and enqueueing again', async () => {
    const { service, queue } = createService();
    const timbre = createTimbre(VoiceTimbreStatus.failed);

    timbre.errorCode = 'MINIMAX_REQUEST_FAILED';
    timbre.errorMessage = 'timeout';
    timbre.providerFileId = 'old_file';
    timbre.previewAudioUrl = 'https://cdn.example.com/old.mp3';
    const oldProviderVoiceId = timbre.providerVoiceId;
    jest.mocked(service.voiceTimbreModel.findOne).mockResolvedValue(timbre);

    const result = await service.retryVoiceTimbreCreate(
      TIMBRE_ID.toHexString()
    );

    expect(timbre).toEqual(
      expect.objectContaining({
        status: VoiceTimbreStatus.creating,
        errorCode: '',
        errorMessage: '',
        providerFileId: '',
        providerVoiceId: expect.stringMatching(/^TzlVoice_/),
        previewAudioUrl: '',
      })
    );
    expect(timbre.providerVoiceId).not.toBe(oldProviderVoiceId);
    expect(queue.addJobToQueue).toHaveBeenCalledWith(
      {
        timbreId: TIMBRE_ID.toHexString(),
      },
      expect.objectContaining({
        jobId: expect.stringContaining(
          `voice-timbre-create:${TIMBRE_ID.toHexString()}:`
        ),
      })
    );
    expect(result.status).toBe(VoiceTimbreStatus.creating);
  });

  it('re-trains an active timbre by resetting status and enqueueing again', async () => {
    const { service, queue } = createService();
    const timbre = createTimbre(VoiceTimbreStatus.active);

    timbre.providerFileId = 'old_file';
    timbre.previewAudioUrl = 'https://cdn.example.com/old.mp3';
    const oldProviderVoiceId = timbre.providerVoiceId;
    jest.mocked(service.voiceTimbreModel.findOne).mockResolvedValue(timbre);

    const result = await service.retryVoiceTimbreCreate(
      TIMBRE_ID.toHexString()
    );

    expect(timbre).toEqual(
      expect.objectContaining({
        status: VoiceTimbreStatus.creating,
        providerFileId: '',
        providerVoiceId: expect.stringMatching(/^TzlVoice_/),
        previewAudioUrl: '',
      })
    );
    expect(timbre.providerVoiceId).not.toBe(oldProviderVoiceId);
    expect(queue.addJobToQueue).toHaveBeenCalledWith(
      {
        timbreId: TIMBRE_ID.toHexString(),
      },
      expect.objectContaining({
        jobId: expect.stringContaining(
          `voice-timbre-create:${TIMBRE_ID.toHexString()}:`
        ),
      })
    );
    expect(result.status).toBe(VoiceTimbreStatus.creating);
  });

  it('fills default preview text before retrying a failed timbre', async () => {
    const { service } = createService();
    const timbre = createTimbre(VoiceTimbreStatus.failed);

    timbre.previewText = '';
    jest.mocked(service.voiceTimbreModel.findOne).mockResolvedValue(timbre);

    await service.retryVoiceTimbreCreate(TIMBRE_ID.toHexString());

    expect(timbre.previewText).toBe(DEFAULT_VOICE_TIMBRE_PREVIEW_TEXT);
  });

  it('rejects retry when the timbre is not failed or active', async () => {
    const { service } = createService();

    jest
      .mocked(service.voiceTimbreModel.findOne)
      .mockResolvedValue(createTimbre(VoiceTimbreStatus.creating));

    await expect(
      service.retryVoiceTimbreCreate(TIMBRE_ID.toHexString())
    ).rejects.toMatchObject({
      code: 'VOICE_TIMBRE_RETRY_NOT_ALLOWED',
    });
  });
});
