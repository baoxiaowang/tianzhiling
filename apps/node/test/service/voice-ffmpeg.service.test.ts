import { VoiceFfmpegService } from '../../src/service/voice-ffmpeg.service';

function createService() {
  const service = new VoiceFfmpegService();
  service.config = {
    minUsableDurationSeconds: 2,
    maxSilenceRatio: 0.75,
    maxClippingRatio: 0.12,
    minRecoverableRmsDb: -58,
    lowVolumeRmsDb: -32,
    targetRmsDb: -22,
    maxVolumeGainDb: 20,
    minSignalToNoiseDb: 4,
    warningSignalToNoiseDb: 12,
  };

  return service;
}

function healthyMetrics() {
  return {
    durationSeconds: 8,
    silenceRatio: 0.12,
    rmsDb: -24,
    peakDb: -4,
    clippingRatio: 0.001,
    noiseFloorDb: -52,
    signalToNoiseDb: 48,
  };
}

describe('VoiceFfmpegService clip quality', () => {
  it.each([
    [{ durationSeconds: 1.4 }, 'too_short'],
    [{ silenceRatio: 0.82 }, 'mostly_silent'],
    [{ clippingRatio: 0.15 }, 'severe_clipping'],
    [{ rmsDb: -65 }, 'volume_unrecoverable'],
    [
      { peakDb: -23, noiseFloorDb: -25, signalToNoiseDb: 2 },
      'background_noise_severe',
    ],
  ])('rejects an unusable clip for %s', (overrides, expectedCode) => {
    const result = createService().evaluateClipQuality({
      ...healthyMetrics(),
      ...overrides,
    });

    expect(result.usable).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: expectedCode,
          severity: 'rejected',
        }),
      ])
    );
  });

  it('keeps recoverable low-volume audio and records the applied gain', () => {
    const result = createService().evaluateClipQuality({
      ...healthyMetrics(),
      rmsDb: -42,
    });

    expect(result.usable).toBe(true);
    expect(result.metrics).toEqual(
      expect.objectContaining({
        volumeAdjusted: true,
        volumeGainDb: 20,
      })
    );
    expect(result.issues).toContainEqual(
      expect.objectContaining({
        code: 'volume_adjusted',
        severity: 'warning',
      })
    );
  });

  it('does not claim volume was adjusted when the clip is filtered', () => {
    const result = createService().evaluateClipQuality({
      ...healthyMetrics(),
      durationSeconds: 1.4,
      rmsDb: -42,
    });

    expect(result.usable).toBe(false);
    expect(result.metrics.volumeAdjusted).toBeUndefined();
    expect(result.metrics.volumeGainDb).toBeUndefined();
    expect(result.issues).not.toContainEqual(
      expect.objectContaining({ code: 'volume_adjusted' })
    );
  });

  it('keeps a healthy clip without quality warnings', () => {
    const result = createService().evaluateClipQuality(healthyMetrics());

    expect(result.usable).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.metrics.volumeAdjusted).toBeUndefined();
  });
});
