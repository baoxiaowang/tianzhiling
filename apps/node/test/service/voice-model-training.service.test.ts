import {
  MongoObjectId,
  VoiceServiceClipReviewStatus,
  VoiceServiceSessionEntity,
  VoiceTimbreEntity,
  VoiceTimbreStatus,
} from '@tzl/entities';
import { AppError } from '../../src/common/errors';
import { VoiceModelTrainingService } from '../../src/service/voice-model-training.service';

const SESSION_ID = '665000000000000000000301';
const TIMBRE_ID = '665000000000000000000302';

describe('VoiceModelTrainingService', () => {
  it('combines accepted clips into one file before creating the voice model', async () => {
    const service = new VoiceModelTrainingService();
    const timbres: VoiceTimbreEntity[] = [];
    service.logger = { info: jest.fn(), error: jest.fn() } as never;
    service.voiceTimbreModel = {
      create: jest.fn((input: Partial<VoiceTimbreEntity>) =>
        Object.assign(new VoiceTimbreEntity(), input)
      ),
      save: jest.fn(async (timbre: VoiceTimbreEntity) => {
        if (!timbre.id) {
          timbre.id = new MongoObjectId(TIMBRE_ID);
          timbres.push(timbre);
        }
        return timbre;
      }),
    } as never;
    service.tencentCosService = {
      getBuffer: jest.fn(async (objectKey: string) => ({
        objectKey,
        buffer: Buffer.from(objectKey),
      })),
      putBuffer: jest.fn(
        async (_buffer: Buffer, input: { folder: string }) => ({
          objectKey: `${input.folder}/generated-audio`,
          url: `https://example.com/${input.folder}/generated-audio`,
        })
      ),
    } as never;
    const combineTrainingClips = jest.fn().mockResolvedValue({
      buffer: Buffer.from('combined wav'),
      fileName: 'voice-training.wav',
      contentType: 'audio/wav',
      durationSeconds: 28,
    });
    service.voiceFfmpegService = { combineTrainingClips } as never;
    service.qwenVoiceEnrollmentService = {
      getDefaultModel: jest.fn().mockReturnValue('qwen3-tts-vc-test'),
      createVoice: jest.fn().mockResolvedValue({
        providerVoiceId: 'qwen_voice_123',
        targetModel: 'qwen3-tts-vc-test',
      }),
    } as never;
    service.qwenVoiceSpeechService = {
      synthesize: jest.fn().mockResolvedValue({
        audioUrl: '',
        audioBuffer: Buffer.from('preview'),
        mimeType: 'audio/wav',
      }),
    } as never;
    const session = Object.assign(new VoiceServiceSessionEntity(), {
      id: new MongoObjectId(SESSION_ID),
      userId: new MongoObjectId('665000000000000000000303'),
      previewText: '孩子，最近过得好吗？有没有好好吃饭，好好睡觉？',
      reviewClips: [
        {
          id: 'clip-1',
          objectKey: 'voice-service-clips/clip-1.mp3',
          durationSeconds: 29,
          qualityScore: 70,
          reviewStatus: VoiceServiceClipReviewStatus.accepted,
          createdAt: new Date(),
        },
        {
          id: 'clip-2',
          objectKey: 'voice-service-clips/clip-2.mp3',
          durationSeconds: 29,
          qualityScore: 95,
          reviewStatus: VoiceServiceClipReviewStatus.accepted,
          createdAt: new Date(),
        },
        {
          id: 'clip-3',
          objectKey: 'voice-service-clips/clip-3.mp3',
          durationSeconds: 29,
          qualityScore: 90,
          reviewStatus: VoiceServiceClipReviewStatus.accepted,
          createdAt: new Date(),
        },
        {
          id: 'clip-rejected',
          objectKey: 'voice-service-clips/rejected.mp3',
          durationSeconds: 8,
          reviewStatus: VoiceServiceClipReviewStatus.rejected,
          createdAt: new Date(),
        },
      ],
    });

    const result = await service.train(session);

    expect(combineTrainingClips).toHaveBeenCalledWith([
      expect.objectContaining({
        objectKey: 'voice-service-clips/clip-2.mp3',
        durationSeconds: 29,
      }),
      expect.objectContaining({
        objectKey: 'voice-service-clips/clip-3.mp3',
        durationSeconds: 29,
      }),
    ]);
    expect(service.qwenVoiceEnrollmentService.createVoice).toHaveBeenCalledWith(
      expect.objectContaining({
        audioUrl: expect.stringContaining('voice-training-ready'),
      })
    );
    expect(service.qwenVoiceSpeechService.synthesize).toHaveBeenCalledWith({
      text: '孩子，最近过得好吗？有没有好好吃饭，好好睡觉？',
      voiceId: 'qwen_voice_123',
      model: 'qwen3-tts-vc-test',
      language: 'Chinese',
    });
    expect(result).toEqual({
      voiceTimbreId: TIMBRE_ID,
      previewAudioUrl:
        'https://example.com/voice-timbre-previews/generated-audio',
      previewAudioObjectKey: 'voice-timbre-previews/generated-audio',
      trainingAudioObjectKey: 'voice-training-ready/generated-audio',
    });
    expect(timbres[0]).toEqual(
      expect.objectContaining({
        userId: new MongoObjectId('665000000000000000000303'),
        providerVoiceId: 'qwen_voice_123',
        voiceServiceSessionId: new MongoObjectId(SESSION_ID),
        previewText: '孩子，最近过得好吗？有没有好好吃饭，好好睡觉？',
        previewAudioObjectKey: 'voice-timbre-previews/generated-audio',
        status: VoiceTimbreStatus.active,
        retentionStatus: 'protected',
      })
    );
  });

  it('marks the timbre failed when the provider rejects training', async () => {
    const service = new VoiceModelTrainingService();
    let savedTimbre: VoiceTimbreEntity | undefined;
    service.logger = {} as never;
    service.voiceTimbreModel = {
      create: jest.fn((input: Partial<VoiceTimbreEntity>) =>
        Object.assign(new VoiceTimbreEntity(), input)
      ),
      save: jest.fn(async (timbre: VoiceTimbreEntity) => {
        timbre.id ||= new MongoObjectId(TIMBRE_ID);
        savedTimbre = timbre;
        return timbre;
      }),
    } as never;
    service.tencentCosService = {
      getBuffer: jest.fn().mockResolvedValue({ buffer: Buffer.from('clip') }),
      putBuffer: jest.fn().mockResolvedValue({
        objectKey: 'voice-training-ready/training.wav',
        url: 'https://example.com/training.wav',
      }),
    } as never;
    service.voiceFfmpegService = {
      combineTrainingClips: jest.fn().mockResolvedValue({
        buffer: Buffer.from('combined'),
        fileName: 'training.wav',
        contentType: 'audio/wav',
        durationSeconds: 10,
      }),
    } as never;
    service.qwenVoiceEnrollmentService = {
      getDefaultModel: jest.fn().mockReturnValue('qwen-test'),
      createVoice: jest.fn().mockRejectedValue(
        new AppError('InvalidParameter', 'provider failed', 502, {
          request_id: 'qwen-request-failed',
        })
      ),
    } as never;
    service.qwenVoiceSpeechService = {} as never;
    const session = Object.assign(new VoiceServiceSessionEntity(), {
      id: new MongoObjectId(SESSION_ID),
      reviewClips: [
        {
          id: 'clip-1',
          objectKey: 'voice-service-clips/clip-1.mp3',
          durationSeconds: 10,
          reviewStatus: VoiceServiceClipReviewStatus.accepted,
          createdAt: new Date(),
        },
      ],
    });

    await expect(service.train(session)).rejects.toMatchObject({
      code: 'InvalidParameter',
      data: {
        providerError: expect.objectContaining({
          provider: 'qwen',
          operation: 'voice_enrollment',
          code: 'InvalidParameter',
          requestId: 'qwen-request-failed',
        }),
      },
    });
    expect(savedTimbre?.status).toBe(VoiceTimbreStatus.failed);
    expect(savedTimbre?.errorCode).toBe('InvalidParameter');
    expect(savedTimbre?.errorMessage).toBe('provider failed');
  });

  it('keeps the provider voice id when preview synthesis fails', async () => {
    const service = new VoiceModelTrainingService();
    let savedTimbre: VoiceTimbreEntity | undefined;
    service.logger = {} as never;
    service.voiceTimbreModel = {
      create: jest.fn((input: Partial<VoiceTimbreEntity>) =>
        Object.assign(new VoiceTimbreEntity(), input)
      ),
      save: jest.fn(async (timbre: VoiceTimbreEntity) => {
        timbre.id ||= new MongoObjectId(TIMBRE_ID);
        savedTimbre = timbre;
        return timbre;
      }),
    } as never;
    service.tencentCosService = {
      getBuffer: jest.fn().mockResolvedValue({ buffer: Buffer.from('clip') }),
      putBuffer: jest.fn().mockResolvedValue({
        objectKey: 'voice-training-ready/training.wav',
        url: 'https://example.com/training.wav',
      }),
    } as never;
    service.voiceFfmpegService = {
      combineTrainingClips: jest.fn().mockResolvedValue({
        buffer: Buffer.from('combined'),
        fileName: 'training.wav',
        contentType: 'audio/wav',
        durationSeconds: 10,
      }),
    } as never;
    service.qwenVoiceEnrollmentService = {
      getDefaultModel: jest.fn().mockReturnValue('qwen-test'),
      createVoice: jest.fn().mockResolvedValue({
        providerVoiceId: 'qwen_voice_created_before_preview',
        targetModel: 'qwen-test',
      }),
    } as never;
    service.qwenVoiceSpeechService = {
      synthesize: jest.fn().mockRejectedValue(new Error('preview failed')),
    } as never;
    const session = Object.assign(new VoiceServiceSessionEntity(), {
      id: new MongoObjectId(SESSION_ID),
      reviewClips: [
        {
          id: 'clip-1',
          objectKey: 'voice-service-clips/clip-1.mp3',
          durationSeconds: 10,
          reviewStatus: VoiceServiceClipReviewStatus.accepted,
          createdAt: new Date(),
        },
      ],
    });

    await expect(service.train(session)).rejects.toMatchObject({
      data: {
        providerError: expect.objectContaining({
          provider: 'qwen',
          operation: 'preview_synthesis',
        }),
      },
    });
    expect(savedTimbre).toEqual(
      expect.objectContaining({
        providerVoiceId: 'qwen_voice_created_before_preview',
        voiceServiceSessionId: new MongoObjectId(SESSION_ID),
        status: VoiceTimbreStatus.failed,
      })
    );
  });

  it('startTencentVrsTraining: 音质检测通过后创建腾讯复刻任务并记录音色', async () => {
    const service = new VoiceModelTrainingService();
    service.logger = { info: jest.fn(), error: jest.fn() } as never;
    let savedTimbre: VoiceTimbreEntity | undefined;
    service.voiceTimbreModel = {
      create: jest.fn((input: Partial<VoiceTimbreEntity>) =>
        Object.assign(new VoiceTimbreEntity(), input)
      ),
      save: jest.fn(async (timbre: VoiceTimbreEntity) => {
        timbre.id ||= new MongoObjectId(TIMBRE_ID);
        savedTimbre = timbre;
        return timbre;
      }),
      findOne: jest.fn().mockResolvedValue(null),
    } as never;
    service.tencentCosService = {
      putBuffer: jest.fn().mockResolvedValue({
        objectKey: 'voice-training-materials/vrs-recording.wav',
        url: 'https://example.com/recording.wav',
      }),
    } as never;
    jest
      .spyOn(service as never, 'normalizeTencentVrsWav' as never)
      .mockResolvedValue(Buffer.from('normalized-wav') as never);
    service.tencentVrsVoiceService = {
      getSingleSentenceVoiceType: jest.fn().mockReturnValue('200000000'),
      detectSoundQuality: jest.fn().mockResolvedValue({
        audioId: 'AUD-1',
        detectionCode: 0,
        detectionMsg: '通过',
        detectionTip: [],
      }),
      createVrsTask: jest.fn().mockResolvedValue({ taskId: 'TASK-1' }),
    } as never;

    const result = await service.startTencentVrsTraining({
      userId: '665000000000000000000303',
      audioBuffer: Buffer.from('recording'),
      textId: 'TID-1',
      voiceGender: 2,
    });

    expect(service.tencentVrsVoiceService.detectSoundQuality).toHaveBeenCalledWith(
      expect.objectContaining({ textId: 'TID-1', codec: 'wav' })
    );
    expect(service.tencentVrsVoiceService.createVrsTask).toHaveBeenCalledWith(
      expect.objectContaining({ audioId: 'AUD-1', voiceGender: 2 })
    );
    expect(result).toEqual({ timbreId: TIMBRE_ID, taskId: 'TASK-1' });
    expect(savedTimbre).toEqual(
      expect.objectContaining({
        provider: 'tencent_vrs',
        providerTaskId: 'TASK-1',
        providerVoiceType: '200000000',
        status: VoiceTimbreStatus.creating,
        previewText: '最近过得好吗？有没有好好吃饭，好好睡觉？',
      })
    );
  });

  it('startTencentVrsTraining: 音质检测失败时抛错且不落库音色', async () => {
    const service = new VoiceModelTrainingService();
    service.logger = { info: jest.fn(), error: jest.fn() } as never;
    const saveMock = jest.fn();
    service.voiceTimbreModel = {
      create: jest.fn((input: Partial<VoiceTimbreEntity>) =>
        Object.assign(new VoiceTimbreEntity(), input)
      ),
      save: saveMock,
    } as never;
    service.tencentCosService = {
      putBuffer: jest.fn(),
    } as never;
    jest
      .spyOn(service as never, 'normalizeTencentVrsWav' as never)
      .mockResolvedValue(Buffer.from('normalized-wav') as never);
    service.tencentVrsVoiceService = {
      getSingleSentenceVoiceType: jest.fn().mockReturnValue('200000000'),
      detectSoundQuality: jest.fn().mockRejectedValue(
        new AppError(
          'TENCENT_VRS_DETECTION_FAILED',
          '录音与指定文本不一致',
          422
        )
      ),
    } as never;

    await expect(
      service.startTencentVrsTraining({
        userId: '665000000000000000000303',
        audioBuffer: Buffer.from('recording'),
        textId: 'TID-1',
      })
    ).rejects.toMatchObject({ code: 'TENCENT_VRS_DETECTION_FAILED' });
    // 检测失败不应创建任何持久化音色记录
    expect(saveMock).not.toHaveBeenCalled();
    expect(service.tencentCosService.putBuffer).not.toHaveBeenCalled();
  });

  it('pollTencentVrsTraining: 不查询或合成其他用户的音色', async () => {
    const service = new VoiceModelTrainingService();
    service.voiceTimbreModel = {
      findOne: jest.fn().mockResolvedValue(
        Object.assign(new VoiceTimbreEntity(), {
          id: new MongoObjectId(TIMBRE_ID),
          userId: new MongoObjectId('665000000000000000000303'),
          provider: 'tencent_vrs',
          providerTaskId: 'TASK-1',
          status: VoiceTimbreStatus.creating,
        })
      ),
    } as never;
    service.tencentVrsVoiceService = {
      describeVrsTaskStatus: jest.fn(),
      synthesize: jest.fn(),
    } as never;

    const result = await service.pollTencentVrsTraining(
      TIMBRE_ID,
      '665000000000000000000304'
    );
    expect(result).toBeNull();
    expect(service.tencentVrsVoiceService.describeVrsTaskStatus).not.toHaveBeenCalled();
    expect(service.tencentVrsVoiceService.synthesize).not.toHaveBeenCalled();
  });
});
