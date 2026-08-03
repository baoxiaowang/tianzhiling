import {
  VoiceServiceProcessingMode,
  type VoiceServiceMaterialItem,
} from '@tzl/entities';
import { AppError } from '../../src/common/errors';
import {
  resolveVoiceClipRecutRange,
  VoiceClippingService,
} from '../../src/service/voice-clipping.service';

function material(
  id: string,
  name: string,
  objectKey: string
): VoiceServiceMaterialItem {
  return {
    id,
    name,
    objectKey,
    createdAt: new Date(),
  };
}

describe('VoiceClippingService', () => {
  it.each([
    ['去掉开头 2 秒', 10, { startSeconds: 2, endSeconds: 10 }],
    ['去掉前两秒和最后一秒', 10, { startSeconds: 2, endSeconds: 9 }],
    ['只保留 3 秒到 8 秒', 10, { startSeconds: 3, endSeconds: 8 }],
    ['只要最后 4 秒', 10, { startSeconds: 6, endSeconds: 10 }],
    ['保留 00:02 至 00:07', 10, { startSeconds: 2, endSeconds: 7 }],
  ])('turns recut instruction %s into an exact range', (text, duration, range) => {
    expect(resolveVoiceClipRecutRange(text, duration)).toEqual(range);
  });

  it('rejects a recut instruction that cannot be executed safely', () => {
    expect(() => resolveVoiceClipRecutRange('把杂音剪掉', 10)).toThrow(
      expect.objectContaining({
        code: 'VOICE_SERVICE_RECUT_INSTRUCTION_UNCLEAR',
      })
    );
    expect(() => resolveVoiceClipRecutRange('只保留 1 秒到 2 秒', 10)).toThrow(
      expect.objectContaining({ code: 'VOICE_SERVICE_RECUT_RANGE_INVALID' })
    );
  });

  it('recuts only the requested review clip and uploads the replacement', async () => {
    const service = new VoiceClippingService();
    service.config = {};
    service.logger = { warn: jest.fn() } as never;
    const createReviewClipsFromSegmentsWithQuality = jest
      .fn()
      .mockResolvedValue({
        clips: [
          {
            buffer: Buffer.from('recut'),
            fileName: 'recut.mp3',
            contentType: 'audio/mpeg',
            durationSeconds: 6,
            qualityMetrics: {
              durationSeconds: 6,
              silenceRatio: 0.1,
              rmsDb: -24,
              peakDb: -4,
              clippingRatio: 0,
            },
            qualityIssues: [],
          },
        ],
        filteredClips: [],
      });
    service.tencentCosService = {
      getBuffer: jest.fn().mockResolvedValue({ buffer: Buffer.from('source') }),
      putBuffer: jest.fn().mockResolvedValue({
        objectKey: 'voice-service-clips/recut.mp3',
        url: 'https://example.com/recut.mp3',
      }),
    } as never;
    service.voiceFfmpegService = {
      createReviewClipsFromSegmentsWithQuality,
    } as never;

    const result = await service.recutReviewClip({
      objectKey: 'voice-service-clips/original.mp3',
      fileName: 'clip.mp3',
      durationSeconds: 10,
      instruction: '去掉开头 2 秒和最后 2 秒',
      sourceMaterialId: 'material-1',
      sourceName: '家庭视频.mp4',
    });

    expect(createReviewClipsFromSegmentsWithQuality).toHaveBeenCalledWith(
      expect.objectContaining({
        edgePadding: false,
        segments: [expect.objectContaining({ beginMs: 2000, endMs: 8000 })],
      })
    );
    expect(result).toEqual(
      expect.objectContaining({
        objectKey: 'voice-service-clips/recut.mp3',
        durationSeconds: 6,
        qualityLabel: '已按要求重新剪辑，请试听确认',
      })
    );
  });

  it('uses speaker diarization and sentence boundaries for assisted clipping', async () => {
    const service = new VoiceClippingService();
    service.config = { maxTotalClips: 8 };
    service.logger = { warn: jest.fn() } as never;
    service.tencentCosService = {
      getBuffer: jest.fn().mockResolvedValue({ buffer: Buffer.from('source') }),
      putBuffer: jest.fn(
        async (
          _buffer: Buffer,
          input: { folder: string; fileName: string }
        ) => ({
          objectKey: `${input.folder}/${input.fileName}`,
          url: `https://example.com/${input.folder}/${input.fileName}`,
        })
      ),
    } as never;
    service.dashScopeVoiceAnalysisService = {
      isEnabled: jest.fn().mockReturnValue(true),
      analyze: jest.fn().mockResolvedValue([
        {
          beginMs: 1000,
          endMs: 5000,
          text: '今天风很大。',
          speakerId: '0',
        },
        {
          beginMs: 5500,
          endMs: 9000,
          text: '你出门多穿一点。',
          speakerId: '0',
        },
        {
          beginMs: 10000,
          endMs: 14000,
          text: '我知道了。',
          speakerId: '1',
        },
      ]),
    } as never;
    const createReviewClipsFromSegments = jest.fn(async input =>
      input.segments.map((segment, index) => ({
        ...segment,
        buffer: Buffer.from(`clip-${index}`),
        fileName: `voice-${index}.mp3`,
        contentType: 'audio/mpeg' as const,
        durationSeconds: Math.round((segment.endMs - segment.beginMs) / 1000),
      }))
    );
    service.voiceFfmpegService = {
      prepareAnalysisAudio: jest.fn().mockResolvedValue({
        buffer: Buffer.from('analysis'),
        fileName: 'analysis.mp3',
        contentType: 'audio/mpeg',
        durationSeconds: 14,
      }),
      createReviewClipsFromSegments,
    } as never;

    const result = await service.createReviewClips([
      material('usable', '家庭视频.mp4', 'voice-training-materials/video.mp4'),
    ]);

    expect(result).toHaveLength(2);
    expect(createReviewClipsFromSegments).toHaveBeenCalledWith(
      expect.objectContaining({
        segments: expect.arrayContaining([
          expect.objectContaining({
            speakerId: '0',
            transcript: '今天风很大。 你出门多穿一点。',
          }),
          expect.objectContaining({
            speakerId: '1',
            transcript: '我知道了。',
          }),
        ]),
      })
    );
    expect(result.map(item => item.speakerId)).toEqual(['1-0', '1-1']);
    expect(result[0].qualityLabel).toContain('语句完整');
  });

  it('keeps a pre-edited material as one review clip', async () => {
    const service = new VoiceClippingService();
    service.config = {};
    service.logger = { warn: jest.fn() } as never;
    service.tencentCosService = {
      getBuffer: jest.fn().mockResolvedValue({ buffer: Buffer.from('source') }),
      putBuffer: jest.fn().mockResolvedValue({
        objectKey: 'voice-service-clips/ready.mp3',
        url: 'https://example.com/ready.mp3',
      }),
    } as never;
    service.dashScopeVoiceAnalysisService = {
      isEnabled: jest.fn().mockReturnValue(true),
      analyze: jest.fn(),
    } as never;
    service.voiceFfmpegService = {
      createReadyReviewClip: jest.fn().mockResolvedValue({
        buffer: Buffer.from('ready'),
        fileName: 'ready.mp3',
        contentType: 'audio/mpeg',
        durationSeconds: 16,
      }),
    } as never;

    const result = await service.createReviewClips(
      [
        material(
          'ready',
          '已经剪好的声音.mp3',
          'voice-training-materials/ready.mp3'
        ),
      ],
      VoiceServiceProcessingMode.readyToUse
    );

    expect(result).toHaveLength(1);
    expect(result[0].qualityLabel).toBe('已按原素材整理，请试听确认');
    expect(
      service.dashScopeVoiceAnalysisService.analyze
    ).not.toHaveBeenCalled();
  });

  it('uploads repaired low-volume clips and keeps filtered reasons', async () => {
    const service = new VoiceClippingService();
    service.config = {};
    service.logger = { warn: jest.fn() } as never;
    const putBuffer = jest.fn().mockResolvedValue({
      objectKey: 'voice-service-clips/repaired.mp3',
      url: 'https://example.com/repaired.mp3',
    });
    service.tencentCosService = {
      getBuffer: jest.fn().mockResolvedValue({ buffer: Buffer.from('source') }),
      putBuffer,
    } as never;
    service.voiceFfmpegService = {
      createReadyReviewClipWithQuality: jest.fn().mockResolvedValue({
        clips: [
          {
            buffer: Buffer.from('repaired'),
            fileName: 'repaired.mp3',
            contentType: 'audio/mpeg',
            durationSeconds: 8,
            qualityMetrics: {
              durationSeconds: 8,
              silenceRatio: 0.1,
              rmsDb: -42,
              peakDb: -5,
              clippingRatio: 0,
              noiseFloorDb: -55,
              signalToNoiseDb: 50,
              volumeAdjusted: true,
              volumeGainDb: 20,
            },
            qualityIssues: [
              {
                code: 'volume_adjusted',
                severity: 'warning',
                message: '原音量偏低，已自动调高约 20 dB',
              },
            ],
          },
        ],
        filteredClips: [
          {
            durationSeconds: 1.2,
            qualityMetrics: {
              durationSeconds: 1.2,
              silenceRatio: 0.1,
              rmsDb: -24,
              peakDb: -3,
              clippingRatio: 0,
            },
            qualityIssues: [
              {
                code: 'too_short',
                severity: 'rejected',
                message: '时长不足 2 秒',
              },
            ],
          },
        ],
      }),
    } as never;

    const result = await service.createReviewClipsWithMetrics(
      [material('ready', '偏低录音.mp3', 'voice-training-materials/quiet.mp3')],
      VoiceServiceProcessingMode.readyToUse
    );

    expect(putBuffer).toHaveBeenCalledTimes(1);
    expect(result.clips[0]).toEqual(
      expect.objectContaining({
        qualityLabel: '音量已自动调高，请试听确认',
        qualityMetrics: expect.objectContaining({ volumeAdjusted: true }),
      })
    );
    expect(result.filteredClips).toEqual([
      expect.objectContaining({
        sourceMaterialId: 'ready',
        qualityIssues: [expect.objectContaining({ code: 'too_short' })],
      }),
    ]);
    expect(result.metrics).toEqual(
      expect.objectContaining({
        filteredClipCount: 1,
        volumeAdjustedClipCount: 1,
      })
    );
  });

  it('returns quality reasons instead of failing when every candidate is filtered', async () => {
    const service = new VoiceClippingService();
    service.config = {};
    service.logger = { warn: jest.fn() } as never;
    const putBuffer = jest.fn();
    service.tencentCosService = {
      getBuffer: jest.fn().mockResolvedValue({ buffer: Buffer.from('source') }),
      putBuffer,
    } as never;
    service.voiceFfmpegService = {
      createReadyReviewClipWithQuality: jest.fn().mockResolvedValue({
        clips: [],
        filteredClips: [
          {
            durationSeconds: 10,
            qualityMetrics: {
              durationSeconds: 10,
              silenceRatio: 0.9,
              rmsDb: -60,
              peakDb: -48,
              clippingRatio: 0,
            },
            qualityIssues: [
              {
                code: 'mostly_silent',
                severity: 'rejected',
                message: '静音占比 90%，有效声音太少',
              },
            ],
          },
        ],
      }),
    } as never;

    const result = await service.createReviewClipsWithMetrics(
      [
        material(
          'silent',
          '静音录音.mp3',
          'voice-training-materials/silent.mp3'
        ),
      ],
      VoiceServiceProcessingMode.readyToUse
    );

    expect(result.clips).toEqual([]);
    expect(result.filteredClips).toHaveLength(1);
    expect(result.filteredClips[0].qualityIssues[0].code).toBe('mostly_silent');
    expect(putBuffer).not.toHaveBeenCalled();
  });

  it('continues with other materials when one file cannot be processed', async () => {
    const service = new VoiceClippingService();
    service.config = { maxTotalClips: 2 };
    service.logger = { warn: jest.fn() } as never;
    service.tencentCosService = {
      getBuffer: jest.fn(async (objectKey: string) => {
        if (objectKey.endsWith('broken.mp4')) {
          throw new Error('download failed');
        }
        return { objectKey, buffer: Buffer.from('source') };
      }),
      putBuffer: jest.fn(
        async (_buffer: Buffer, input: { fileName: string }) => ({
          objectKey: `voice-service-clips/${input.fileName}`,
          url: `https://example.com/${input.fileName}`,
        })
      ),
    } as never;
    service.voiceFfmpegService = {
      createReadyReviewClip: jest.fn(async () => ({
        buffer: Buffer.from('clip-1'),
        fileName: 'voice-1.mp3',
        contentType: 'audio/mpeg',
        durationSeconds: 12,
      })),
    } as never;

    const result = await service.createReviewClips(
      [
        material(
          'broken',
          '损坏的视频.mp4',
          'voice-training-materials/broken.mp4'
        ),
        material(
          'usable',
          '微信录屏.mp4',
          'voice-training-materials/usable.mp4'
        ),
      ],
      VoiceServiceProcessingMode.readyToUse
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(
      expect.objectContaining({
        sourceMaterialId: 'usable',
        sourceName: '微信录屏.mp4',
      })
    );
    expect(service.logger.warn).toHaveBeenCalledTimes(1);
  });

  it('keeps recognition timing and provider codes when only some materials fail', async () => {
    const service = new VoiceClippingService();
    service.config = { maxTotalClips: 8 };
    service.logger = { warn: jest.fn() } as never;
    service.tencentCosService = {
      getBuffer: jest.fn().mockResolvedValue({ buffer: Buffer.from('source') }),
      putBuffer: jest.fn(
        async (
          _buffer: Buffer,
          input: { folder: string; fileName: string }
        ) => ({
          objectKey: `${input.folder}/${input.fileName}`,
          url: `https://example.com/${input.folder}/${input.fileName}`,
        })
      ),
    } as never;
    service.dashScopeVoiceAnalysisService = {
      isEnabled: jest.fn().mockReturnValue(true),
      analyze: jest
        .fn()
        .mockRejectedValueOnce(
          new AppError('InvalidParameter', 'unsupported audio channel', 502, {
            request_id: 'dashscope-failed-request',
          })
        )
        .mockResolvedValueOnce([
          {
            beginMs: 1000,
            endMs: 6000,
            text: '今天记得早点回家。',
            speakerId: '0',
          },
        ]),
    } as never;
    service.voiceFfmpegService = {
      prepareAnalysisAudio: jest.fn().mockResolvedValue({
        buffer: Buffer.from('analysis'),
        fileName: 'analysis.mp3',
        contentType: 'audio/mpeg',
      }),
      createReviewClipsFromSegments: jest.fn(async input =>
        input.segments.map((segment, index) => ({
          ...segment,
          buffer: Buffer.from(`clip-${index}`),
          fileName: `clip-${index}.mp3`,
          contentType: 'audio/mpeg',
          durationSeconds: 5,
        }))
      ),
    } as never;

    const result = await service.createReviewClipsWithMetrics([
      material('failed', '失败素材.mp4', 'voice-training-materials/failed.mp4'),
      material('usable', '可用素材.mp4', 'voice-training-materials/usable.mp4'),
    ]);

    expect(result.clips).toHaveLength(1);
    expect(result.metrics).toEqual(
      expect.objectContaining({
        recognitionMaterialCount: 2,
        recognitionDurationMs: expect.any(Number),
      })
    );
    expect(result.platformErrors).toEqual([
      expect.objectContaining({
        provider: 'dashscope',
        operation: 'recognition',
        code: 'InvalidParameter',
        requestId: 'dashscope-failed-request',
      }),
    ]);
  });

  it('does not publish unverified fixed clips when AI analysis is unavailable', async () => {
    const service = new VoiceClippingService();
    service.config = {};
    service.logger = { warn: jest.fn() } as never;
    service.tencentCosService = {
      getBuffer: jest.fn().mockResolvedValue({ buffer: Buffer.from('source') }),
    } as never;
    service.dashScopeVoiceAnalysisService = {
      isEnabled: jest.fn().mockReturnValue(false),
    } as never;
    service.voiceFfmpegService = {
      createReviewClips: jest.fn(),
    } as never;

    await expect(
      service.createReviewClips([
        material(
          'source',
          '微信录屏.mp4',
          'voice-training-materials/source.mp4'
        ),
      ])
    ).rejects.toMatchObject({
      code: 'VOICE_SERVICE_ANALYSIS_UNAVAILABLE',
      status: 503,
    });
    expect(service.voiceFfmpegService.createReviewClips).not.toHaveBeenCalled();
  });

  it('reports a useful error when no material contains usable audio', async () => {
    const service = new VoiceClippingService();
    service.config = {};
    service.logger = { warn: jest.fn() } as never;
    service.tencentCosService = {
      getBuffer: jest.fn().mockRejectedValue(new Error('download failed')),
    } as never;
    service.voiceFfmpegService = {} as never;

    await expect(
      service.createReviewClips([
        material(
          'broken',
          '损坏的视频.mp4',
          'voice-training-materials/broken.mp4'
        ),
      ])
    ).rejects.toMatchObject({
      code: 'VOICE_SERVICE_NO_USABLE_AUDIO',
      status: 422,
    });
  });
});
