import { AppError } from '@tzl/shared';
import {
  MongoObjectId,
  VoiceTimbreEntity,
  VoiceTimbreProvider,
  VoiceTimbreStatus,
} from '@tzl/entities';
import {
  AdminVoiceTimbreService,
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
      remark: '',
    });

    expect(service.voiceTimbreModel.save).toHaveBeenCalledWith(
      expect.objectContaining({
        name: '测试音色',
        status: VoiceTimbreStatus.creating,
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
        status: VoiceTimbreStatus.creating,
      })
    );
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
        previewAudioUrl: '',
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
      })
    );
    expect(result.status).toBe(VoiceTimbreStatus.creating);
  });

  it('rejects retry when the timbre is not failed', async () => {
    const { service } = createService();

    jest
      .mocked(service.voiceTimbreModel.findOne)
      .mockResolvedValue(createTimbre(VoiceTimbreStatus.active));

    await expect(
      service.retryVoiceTimbreCreate(TIMBRE_ID.toHexString())
    ).rejects.toMatchObject({
      code: 'VOICE_TIMBRE_RETRY_NOT_ALLOWED',
    });
  });
});
