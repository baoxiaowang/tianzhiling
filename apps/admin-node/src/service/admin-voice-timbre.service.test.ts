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
  service.agentModel = {
    find: jest.fn().mockResolvedValue([]),
  } as any;
  service.storageFileService = {
    normalizeForStorage: jest.fn(value => value),
    resolve: jest.fn(value => `https://cdn.example.com/${value}`),
    download: jest.fn().mockResolvedValue({
      buffer: Buffer.from('wav'),
      fileName: 'demo.wav',
      contentType: 'audio/wav',
      url: 'https://cdn.example.com/voice-timbres/demo.wav',
    }),
  } as any;
  service.storageService = {
    uploadCosBuffer: jest.fn().mockResolvedValue({
      objectKey: 'voice-timbre-previews/preview.mp3',
      publicUrl: 'https://cdn.example.com/voice-timbre-previews/preview.mp3',
      contentType: 'audio/mpeg',
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
  service.cosyVoiceVoiceService = {
    getDefaultPreviewModel: jest.fn(() => 'cosyvoice-v3.5-plus'),
    cloneVoice: jest.fn().mockResolvedValue({
      providerVoiceId: 'cosyvoice-v3.5-plus-tzlvoice-abc123',
      demoAudio: '',
      requestId: 'dashscope-request-001',
    }),
    queryVoice: jest.fn().mockResolvedValue({
      voiceId: 'cosyvoice-v3.5-plus-tzlvoice-abc123',
      status: 'OK',
      targetModel: 'cosyvoice-v3.5-plus',
      requestId: 'dashscope-query-001',
    }),
    synthesizePreview: jest.fn().mockResolvedValue({
      audioUrl: '',
      audioBuffer: Buffer.from([0xff, 0xfb, 0x90, 0x64]),
      mimeType: 'audio/mpeg',
      requestId: 'dashscope-preview-001',
    }),
  } as any;
  service.qwenVoiceService = {
    getDefaultPreviewModel: jest.fn(() => 'qwen3-tts-vc-2026-01-22'),
    cloneVoice: jest.fn().mockResolvedValue({
      providerVoiceId: 'qwen-tts-vc-tzlvoice-voice-20260606220000123-abcd',
      targetModel: 'qwen3-tts-vc-2026-01-22',
      requestId: 'qwen-request-001',
    }),
    synthesizePreview: jest.fn().mockResolvedValue({
      audioUrl: '',
      audioBuffer: Buffer.from([0x52, 0x49, 0x46, 0x46]),
      mimeType: 'audio/wav',
      requestId: 'qwen-preview-001',
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
      where: { deletionStatus: { $ne: 'completed' } },
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
        cloneLanguage: 'Chinese',
        previewText: DEFAULT_VOICE_TIMBRE_PREVIEW_TEXT,
      })
    );
  });

  it('creates a CosyVoice timbre with a prefix and provider default model', async () => {
    const { service, queue } = createService();

    jest.mocked(service.voiceTimbreModel.findOne).mockResolvedValue(null);

    const result = await service.createVoiceTimbre({
      name: '百炼音色',
      provider: 'cosyvoice',
      providerVoiceId: 'tzlvoice',
      audioObjectKey: 'voice-timbres/demo.wav',
      cloneLanguage: 'zh',
    });

    expect(service.voiceTimbreModel.save).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: VoiceTimbreProvider.cosyvoice,
        providerVoiceId: 'tzlvoice',
        cloneLanguage: 'zh',
        previewModel: 'cosyvoice-v3.5-plus',
        status: VoiceTimbreStatus.creating,
      })
    );
    expect(queue.addJobToQueue).toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        provider: VoiceTimbreProvider.cosyvoice,
        providerVoiceId: 'tzlvoice',
      })
    );
  });

  it('creates a Qwen timbre with a preferred name and provider default model', async () => {
    const { service, queue } = createService();

    jest.mocked(service.voiceTimbreModel.findOne).mockResolvedValue(null);

    const result = await service.createVoiceTimbre({
      name: '千问音色',
      provider: 'qwen',
      providerVoiceId: 'tzlvoice',
      audioObjectKey: 'voice-timbres/demo.wav',
      cloneLanguage: 'zh',
    });

    expect(service.voiceTimbreModel.save).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: VoiceTimbreProvider.qwen,
        providerVoiceId: 'tzlvoice',
        cloneLanguage: 'zh',
        previewModel: 'qwen3-tts-vc-2026-01-22',
        status: VoiceTimbreStatus.creating,
      })
    );
    expect(queue.addJobToQueue).toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        provider: VoiceTimbreProvider.qwen,
        providerVoiceId: 'tzlvoice',
      })
    );
  });

  it('persists an explicitly named dialect instead of leaving it as auto', async () => {
    const { service } = createService();

    jest.mocked(service.voiceTimbreModel.findOne).mockResolvedValue(null);

    const result = await service.createVoiceTimbre({
      name: '陕西方言音色',
      provider: 'qwen',
      providerVoiceId: 'tzlvoice',
      audioObjectKey: 'voice-timbres/demo.wav',
      speechDialect: 'auto',
      speechInstruction: '陕西关中长安地区方言',
    });

    expect(service.voiceTimbreModel.save).toHaveBeenCalledWith(
      expect.objectContaining({
        speechDialect: 'shaanxi',
        speechInstruction: '陕西关中长安地区方言',
      })
    );
    expect(result).toEqual(
      expect.objectContaining({
        speechDialect: 'shaanxi',
        speechInstruction: '陕西关中长安地区方言',
      })
    );
  });

  it('rejects unknown providers that are not connected', async () => {
    const { service } = createService();

    await expect(
      service.createVoiceTimbre({
        name: '未知音色',
        provider: 'unknown',
        audioObjectKey: 'voice-timbres/demo.wav',
      })
    ).rejects.toMatchObject({
      code: 'INVALID_VOICE_TIMBRE_PROVIDER',
    });
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

  it('processes a CosyVoice create job with the public audio url', async () => {
    const { service } = createService();
    const timbre = {
      ...createTimbre(),
      provider: VoiceTimbreProvider.cosyvoice,
      providerVoiceId: 'tzlvoice',
      cloneLanguage: 'zh',
      previewModel: 'cosyvoice-v3.5-plus',
    } as VoiceTimbreEntity;

    jest.mocked(service.voiceTimbreModel.findOne).mockResolvedValue(timbre);

    await service.processCreateVoiceTimbreJob({
      timbreId: TIMBRE_ID.toHexString(),
    });

    expect(service.minimaxVoiceService.uploadCloneAudio).not.toHaveBeenCalled();
    expect(service.minimaxVoiceService.cloneVoice).not.toHaveBeenCalled();
    expect(service.cosyVoiceVoiceService.cloneVoice).toHaveBeenCalledWith({
      audioUrl: 'https://cdn.example.com/voice-timbres/demo.wav',
      prefix: 'tzlvoice',
      targetModel: 'cosyvoice-v3.5-plus',
      languageHint: 'zh',
    });
    expect(service.cosyVoiceVoiceService.synthesizePreview).toHaveBeenCalledWith(
      {
        text: '今天天气很好',
        voiceId: 'cosyvoice-v3.5-plus-tzlvoice-abc123',
        model: 'cosyvoice-v3.5-plus',
        languageHint: 'zh',
        speed: 1.08,
        volume: 1,
        pitch: 0,
      }
    );
    expect(service.storageService.uploadCosBuffer).toHaveBeenCalledWith({
      buffer: Buffer.from([0xff, 0xfb, 0x90, 0x64]),
      fileName: expect.stringMatching(/^voice_timbre_preview_\d+\.mp3$/),
      folder: 'voice-timbre-previews',
      contentType: 'audio/mpeg',
    });
    expect(timbre).toEqual(
      expect.objectContaining({
        providerFileId: 'dashscope-request-001',
        providerVoiceId: 'cosyvoice-v3.5-plus-tzlvoice-abc123',
        previewAudioUrl: 'https://cdn.example.com/voice-timbre-previews/preview.mp3',
        status: VoiceTimbreStatus.active,
      })
    );
  });

  it('processes a Qwen create job with the public audio url', async () => {
    const { service } = createService();
    const timbre = {
      ...createTimbre(),
      provider: VoiceTimbreProvider.qwen,
      providerVoiceId: 'tzlvoice',
      cloneLanguage: 'zh',
      previewModel: 'qwen3-tts-vc-2026-01-22',
    } as VoiceTimbreEntity;

    jest.mocked(service.voiceTimbreModel.findOne).mockResolvedValue(timbre);

    await service.processCreateVoiceTimbreJob({
      timbreId: TIMBRE_ID.toHexString(),
    });

    expect(service.minimaxVoiceService.uploadCloneAudio).not.toHaveBeenCalled();
    expect(service.minimaxVoiceService.cloneVoice).not.toHaveBeenCalled();
    expect(service.qwenVoiceService.cloneVoice).toHaveBeenCalledWith({
      audioUrl: 'https://cdn.example.com/voice-timbres/demo.wav',
      preferredName: 'tzlvoice',
      targetModel: 'qwen3-tts-vc-2026-01-22',
      language: 'zh',
    });
    expect(service.qwenVoiceService.synthesizePreview).toHaveBeenCalledWith({
      text: '今天天气很好',
      voiceId: 'qwen-tts-vc-tzlvoice-voice-20260606220000123-abcd',
      model: 'qwen3-tts-vc-2026-01-22',
      language: 'zh',
      dialect: undefined,
      speed: 1.08,
    });
    expect(service.storageService.uploadCosBuffer).toHaveBeenCalledWith({
      buffer: Buffer.from([0x52, 0x49, 0x46, 0x46]),
      fileName: expect.stringMatching(/^voice_timbre_preview_\d+\.wav$/),
      folder: 'voice-timbre-previews',
      contentType: 'audio/wav',
    });
    expect(timbre).toEqual(
      expect.objectContaining({
        providerFileId: 'qwen-request-001',
        providerVoiceId: 'qwen-tts-vc-tzlvoice-voice-20260606220000123-abcd',
        previewAudioUrl: 'https://cdn.example.com/voice-timbre-previews/preview.mp3',
        status: VoiceTimbreStatus.active,
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

  it('generates missing CosyVoice preview audio without cloning a new active timbre', async () => {
    const { service, queue } = createService();
    const timbre = {
      ...createTimbre(VoiceTimbreStatus.active),
      provider: VoiceTimbreProvider.cosyvoice,
      providerVoiceId: 'cosyvoice-v3.5-plus-tzlvoice-abc123',
      cloneLanguage: 'zh',
      previewModel: 'cosyvoice-v3.5-plus',
      previewAudioUrl: '',
    } as VoiceTimbreEntity;

    jest.mocked(service.voiceTimbreModel.findOne).mockResolvedValue(timbre);

    const result = await service.retryVoiceTimbreCreate(
      TIMBRE_ID.toHexString()
    );

    expect(queue.addJobToQueue).not.toHaveBeenCalled();
    expect(service.cosyVoiceVoiceService.cloneVoice).not.toHaveBeenCalled();
    expect(service.cosyVoiceVoiceService.synthesizePreview).toHaveBeenCalledWith(
      {
        text: '今天天气很好',
        voiceId: 'cosyvoice-v3.5-plus-tzlvoice-abc123',
        model: 'cosyvoice-v3.5-plus',
        languageHint: 'zh',
        speed: 1.08,
        volume: 1,
        pitch: 0,
      }
    );
    expect(timbre).toEqual(
      expect.objectContaining({
        status: VoiceTimbreStatus.active,
        providerVoiceId: 'cosyvoice-v3.5-plus-tzlvoice-abc123',
        previewAudioUrl:
          'https://cdn.example.com/voice-timbre-previews/preview.mp3',
      })
    );
    expect(result.status).toBe(VoiceTimbreStatus.active);
  });

  it('generates missing Qwen preview audio without cloning a new active timbre', async () => {
    const { service, queue } = createService();
    const timbre = {
      ...createTimbre(VoiceTimbreStatus.active),
      provider: VoiceTimbreProvider.qwen,
      providerVoiceId: 'qwen-tts-vc-tzlvoice-voice-20260606220000123-abcd',
      cloneLanguage: 'zh',
      previewModel: 'qwen3-tts-vc-2026-01-22',
      previewAudioUrl: '',
    } as VoiceTimbreEntity;

    jest.mocked(service.voiceTimbreModel.findOne).mockResolvedValue(timbre);

    const result = await service.retryVoiceTimbreCreate(
      TIMBRE_ID.toHexString()
    );

    expect(queue.addJobToQueue).not.toHaveBeenCalled();
    expect(service.qwenVoiceService.cloneVoice).not.toHaveBeenCalled();
    expect(service.qwenVoiceService.synthesizePreview).toHaveBeenCalledWith({
      text: '今天天气很好',
      voiceId: 'qwen-tts-vc-tzlvoice-voice-20260606220000123-abcd',
      model: 'qwen3-tts-vc-2026-01-22',
      language: 'zh',
      dialect: undefined,
      speed: 1.08,
    });
    expect(timbre).toEqual(
      expect.objectContaining({
        status: VoiceTimbreStatus.active,
        providerVoiceId: 'qwen-tts-vc-tzlvoice-voice-20260606220000123-abcd',
        previewAudioUrl:
          'https://cdn.example.com/voice-timbre-previews/preview.mp3',
      })
    );
    expect(result.status).toBe(VoiceTimbreStatus.active);
  });

  it('validates an OK CosyVoice provider voice and syncs it active', async () => {
    const { service } = createService();
    const timbre = {
      ...createTimbre(VoiceTimbreStatus.failed),
      provider: VoiceTimbreProvider.cosyvoice,
      providerVoiceId: 'cosyvoice-v3.5-plus-tzlvoice-abc123',
      errorCode: 'COSYVOICE_VOICE_UNDEPLOYED',
      errorMessage: 'CosyVoice 音色不可用：UNDEPLOYED',
    } as VoiceTimbreEntity;

    jest.mocked(service.voiceTimbreModel.findOne).mockResolvedValue(timbre);

    const result = await service.validateProviderVoice(
      TIMBRE_ID.toHexString()
    );

    expect(service.cosyVoiceVoiceService.queryVoice).toHaveBeenCalledWith(
      'cosyvoice-v3.5-plus-tzlvoice-abc123'
    );
    expect(service.voiceTimbreModel.save).toHaveBeenCalledWith(
      expect.objectContaining({
        previewModel: 'cosyvoice-v3.5-plus',
        status: VoiceTimbreStatus.active,
        errorCode: '',
        errorMessage: '',
      })
    );
    expect(result).toEqual(
      expect.objectContaining({
        provider: VoiceTimbreProvider.cosyvoice,
        providerVoiceId: 'cosyvoice-v3.5-plus-tzlvoice-abc123',
        providerStatus: 'OK',
        targetModel: 'cosyvoice-v3.5-plus',
        requestId: 'dashscope-query-001',
        record: expect.objectContaining({
          previewModel: 'cosyvoice-v3.5-plus',
          status: VoiceTimbreStatus.active,
          errorCode: '',
          errorMessage: '',
        }),
      })
    );
  });

  it('validates an UNDEPLOYED CosyVoice provider voice and syncs it failed', async () => {
    const { service } = createService();
    const timbre = {
      ...createTimbre(VoiceTimbreStatus.active),
      provider: VoiceTimbreProvider.cosyvoice,
      providerVoiceId: 'cosyvoice-v3.5-plus-tzlvoice-abc123',
    } as VoiceTimbreEntity;

    jest.mocked(service.voiceTimbreModel.findOne).mockResolvedValue(timbre);
    jest.mocked(service.cosyVoiceVoiceService.queryVoice).mockResolvedValue({
      voiceId: 'cosyvoice-v3.5-plus-tzlvoice-abc123',
      status: 'UNDEPLOYED',
      targetModel: 'cosyvoice-v3.5-plus',
      requestId: 'dashscope-query-002',
    });

    const result = await service.validateProviderVoice(
      TIMBRE_ID.toHexString()
    );

    expect(timbre).toEqual(
      expect.objectContaining({
        status: VoiceTimbreStatus.failed,
        errorCode: 'COSYVOICE_VOICE_UNDEPLOYED',
        errorMessage: 'CosyVoice 音色不可用：UNDEPLOYED',
      })
    );
    expect(result).toEqual(
      expect.objectContaining({
        providerStatus: 'UNDEPLOYED',
        requestId: 'dashscope-query-002',
        record: expect.objectContaining({
          status: VoiceTimbreStatus.failed,
          errorCode: 'COSYVOICE_VOICE_UNDEPLOYED',
          errorMessage: 'CosyVoice 音色不可用：UNDEPLOYED',
        }),
      })
    );
  });

  it('rejects provider voice validation for non-CosyVoice timbres', async () => {
    const { service } = createService();

    jest
      .mocked(service.voiceTimbreModel.findOne)
      .mockResolvedValue(createTimbre(VoiceTimbreStatus.active));

    await expect(
      service.validateProviderVoice(TIMBRE_ID.toHexString())
    ).rejects.toMatchObject({
      code: 'VOICE_TIMBRE_PROVIDER_VALIDATE_UNSUPPORTED',
    });
    expect(service.cosyVoiceVoiceService.queryVoice).not.toHaveBeenCalled();
  });

  it('falls back to CosyVoice provider preview url when preview audio buffer is unavailable', async () => {
    const { service } = createService();
    const timbre = {
      ...createTimbre(VoiceTimbreStatus.active),
      provider: VoiceTimbreProvider.cosyvoice,
      providerVoiceId: 'cosyvoice-v3.5-plus-tzlvoice-abc123',
      cloneLanguage: 'zh',
      previewModel: 'cosyvoice-v3.5-plus',
      previewAudioUrl: '',
    } as VoiceTimbreEntity;

    jest.mocked(service.voiceTimbreModel.findOne).mockResolvedValue(timbre);
    jest.mocked(service.cosyVoiceVoiceService.synthesizePreview).mockResolvedValue({
      audioUrl: 'https://dashscope-result.example.com/preview.mp3',
      audioBuffer: Buffer.alloc(0),
      mimeType: 'audio/mpeg',
      requestId: 'dashscope-preview-002',
    });

    const result = await service.retryVoiceTimbreCreate(
      TIMBRE_ID.toHexString()
    );

    expect(service.storageService.uploadCosBuffer).not.toHaveBeenCalled();
    expect(timbre.previewAudioUrl).toBe(
      'https://dashscope-result.example.com/preview.mp3'
    );
    expect(result.previewAudioUrl).toBe(
      'https://dashscope-result.example.com/preview.mp3'
    );
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

  it('lists timbres filtered by userId', async () => {
    const { service } = createService();
    const userId = new MongoObjectId('665000000000000000000999').toHexString();
    const timbre = {
      ...createTimbre(VoiceTimbreStatus.active),
      userId: new MongoObjectId(userId),
    } as VoiceTimbreEntity;

    jest.mocked(service.voiceTimbreModel.find).mockResolvedValue([timbre]);
    jest.mocked(service.voiceTimbreModel.count).mockResolvedValue(1);

    const result = await service.listVoiceTimbres({ userId });

    expect(service.voiceTimbreModel.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          deletionStatus: { $ne: 'completed' },
          userId: new MongoObjectId(userId),
        },
      })
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0].userId).toBe(userId);
  });

  it('rejects list with an invalid userId', async () => {
    const { service } = createService();

    await expect(
      service.listVoiceTimbres({ userId: 'not-an-object-id' })
    ).rejects.toMatchObject({
      code: 'INVALID_USER_ID',
    });
  });

  it('creates a timbre with the given userId', async () => {
    const { service } = createService();
    const userId = new MongoObjectId('665000000000000000000999').toHexString();

    jest.mocked(service.voiceTimbreModel.findOne).mockResolvedValue(null);

    const result = await service.createVoiceTimbre({
      name: '用户音色',
      provider: 'minimax',
      providerVoiceId: 'TestVoice_002',
      audioObjectKey: 'voice-timbres/user.wav',
      userId,
    });

    expect(service.voiceTimbreModel.save).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: new MongoObjectId(userId),
      })
    );
    expect(result.userId).toBe(userId);
  });

  it('rejects create with an invalid userId', async () => {
    const { service } = createService();

    await expect(
      service.createVoiceTimbre({
        name: '用户音色',
        provider: 'minimax',
        providerVoiceId: 'TestVoice_003',
        audioObjectKey: 'voice-timbres/user.wav',
        userId: 'not-an-object-id',
      })
    ).rejects.toMatchObject({
      code: 'INVALID_USER_ID',
    });
  });

  it('merge-creates a timbre from multiple audio object keys', async () => {
    const { service, queue } = createService();
    const userId = new MongoObjectId('665000000000000000000999').toHexString();

    jest.mocked(service.voiceTimbreModel.findOne).mockResolvedValue(null);
    jest.mocked(service.storageFileService.download).mockResolvedValue({
      buffer: Buffer.from('clip-audio-bytes'),
      fileName: 'clip-1.mp3',
      contentType: 'audio/mpeg',
      url: 'https://cdn.example.com/clips/clip-1.mp3',
    });
    service.ffmpegService = {
      ...service.ffmpegService,
      mergeAudios: jest.fn().mockResolvedValue({
        buffer: Buffer.from('merged-wav-bytes'),
        fileName: 'voice-training.wav',
        contentType: 'audio/wav',
      }),
    } as any;
    jest.mocked(service.storageService.uploadCosBuffer).mockResolvedValue({
      provider: 'tencent-cos',
      bucket: 'tzl-test',
      region: 'ap-guangzhou',
      endpoint: 'https://tzl-test.cos.ap-guangzhou.myqcloud.com',
      objectKey: 'voice-timbre-merged/merged.wav',
      publicUrl: 'https://cdn.example.com/voice-timbre-merged/merged.wav',
      contentType: 'audio/wav',
    });

    const result = await service.mergeCreateVoiceTimbre({
      userId,
      audioObjectKeys: ['clips/clip-1.mp3', 'clips/clip-2.mp3'],
      name: '合并音色',
      provider: 'minimax',
      providerVoiceId: 'TestVoice_Merged',
    });

    expect(service.storageFileService.download).toHaveBeenCalledTimes(2);
    expect(service.ffmpegService.mergeAudios).toHaveBeenCalledWith([
      expect.objectContaining({ buffer: Buffer.from('clip-audio-bytes') }),
      expect.objectContaining({ buffer: Buffer.from('clip-audio-bytes') }),
    ]);
    expect(service.storageService.uploadCosBuffer).toHaveBeenCalledWith(
      expect.objectContaining({
        buffer: Buffer.from('merged-wav-bytes'),
        fileName: 'voice-training.wav',
        contentType: 'audio/wav',
        folder: 'voice-timbre-merged',
      })
    );
    expect(service.voiceTimbreModel.save).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: new MongoObjectId(userId),
        audioObjectKey: 'voice-timbre-merged/merged.wav',
        name: '合并音色',
        provider: VoiceTimbreProvider.minimax,
      })
    );
    expect(queue.addJobToQueue).toHaveBeenCalled();
    expect(result.userId).toBe(userId);
  });

  it('rejects merge-create when audio object keys are empty', async () => {
    const { service } = createService();
    const userId = new MongoObjectId('665000000000000000000999').toHexString();

    await expect(
      service.mergeCreateVoiceTimbre({
        userId,
        audioObjectKeys: [],
        name: '合并音色',
        provider: 'minimax',
      })
    ).rejects.toMatchObject({
      code: 'VOICE_TIMBRE_MERGED_AUDIO_REQUIRED',
    });
  });

  it('rejects merge-create with an invalid userId', async () => {
    const { service } = createService();

    await expect(
      service.mergeCreateVoiceTimbre({
        userId: 'not-an-object-id',
        audioObjectKeys: ['clips/clip-1.mp3'],
        name: '合并音色',
        provider: 'minimax',
      })
    ).rejects.toMatchObject({
      code: 'INVALID_USER_ID',
    });
  });
});
