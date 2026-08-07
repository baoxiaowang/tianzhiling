import { Config, Provide } from '@midwayjs/core';
import { spawn } from 'child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import type {
  VoiceServiceClipQualityIssue,
  VoiceServiceClipQualityMetrics,
} from '@tzl/entities';
import { VOICE_SERVICE_MAX_TRAINING_SECONDS } from '@tzl/shared';
import { AppError } from '../common/errors';

interface VoiceClippingConfig {
  binaryPath?: string;
  timeoutMs?: number;
  segmentSeconds?: number;
  maxClipsPerMaterial?: number;
  maxSourceSeconds?: number;
  minClipBytes?: number;
  minUsableDurationSeconds?: number;
  maxSilenceRatio?: number;
  maxClippingRatio?: number;
  minRecoverableRmsDb?: number;
  lowVolumeRmsDb?: number;
  targetRmsDb?: number;
  maxVolumeGainDb?: number;
  minSignalToNoiseDb?: number;
  warningSignalToNoiseDb?: number;
}

export interface VoiceFfmpegClip {
  buffer: Buffer;
  fileName: string;
  contentType: 'audio/mpeg';
  durationSeconds: number;
  qualityMetrics?: VoiceServiceClipQualityMetrics;
  qualityIssues?: VoiceServiceClipQualityIssue[];
}

export interface VoiceFfmpegSegment {
  beginMs: number;
  endMs: number;
  transcript?: string;
  speakerId?: string;
}

export interface VoiceFfmpegPreparedAudio {
  buffer: Buffer;
  fileName: string;
  contentType: 'audio/mpeg' | 'audio/wav';
  durationSeconds: number;
}

export interface VoiceFfmpegSpeechOutput {
  buffer: Buffer;
  fileName: string;
  contentType: 'audio/mpeg';
  durationSeconds: number;
}

export interface VoiceFfmpegFilteredClip extends Partial<VoiceFfmpegSegment> {
  durationSeconds: number;
  qualityMetrics: VoiceServiceClipQualityMetrics;
  qualityIssues: VoiceServiceClipQualityIssue[];
}

export interface VoiceFfmpegQualityBatch {
  clips: Array<VoiceFfmpegClip & Partial<VoiceFfmpegSegment>>;
  filteredClips: VoiceFfmpegFilteredClip[];
}

export interface VoiceClipQualityAssessment {
  usable: boolean;
  metrics: VoiceServiceClipQualityMetrics;
  issues: VoiceServiceClipQualityIssue[];
}

@Provide()
export class VoiceFfmpegService {
  @Config('voiceClipping')
  config: VoiceClippingConfig;

  async createReviewClips(input: {
    buffer: Buffer;
    fileName: string;
  }): Promise<VoiceFfmpegClip[]> {
    if (!Buffer.isBuffer(input.buffer) || input.buffer.length === 0) {
      throw new AppError(
        'VOICE_CLIPPING_INVALID_INPUT',
        'voice material is required',
        400
      );
    }

    const workdir = await mkdtemp(join(tmpdir(), 'tzl-voice-clipping-'));
    const inputPath = join(
      workdir,
      `source${this.safeExtension(input.fileName)}`
    );
    const outputPattern = join(workdir, 'clip-%03d.mp3');

    try {
      await writeFile(inputPath, input.buffer);
      await this.runFfmpeg(inputPath, outputPattern);
      const outputNames = (await readdir(workdir))
        .filter(name => /^clip-\d+\.mp3$/.test(name))
        .sort()
        .slice(0, this.maxClipsPerMaterial);
      const clips = await Promise.all(
        outputNames.map(async (name, index) => {
          const buffer = await readFile(join(workdir, name));

          if (buffer.length < this.minClipBytes) {
            return null;
          }

          return {
            buffer,
            fileName: `${this.safeBaseName(input.fileName)}-${index + 1}.mp3`,
            contentType: 'audio/mpeg' as const,
            durationSeconds: Math.max(
              1,
              Math.min(
                this.segmentSeconds,
                Math.round((buffer.length * 8) / 64000)
              )
            ),
          };
        })
      );
      const usableClips = clips.filter((clip): clip is VoiceFfmpegClip =>
        Boolean(clip)
      );

      if (usableClips.length === 0) {
        throw new AppError(
          'VOICE_CLIPPING_NO_USABLE_AUDIO',
          'no usable audio track found in voice material',
          422
        );
      }

      return usableClips;
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  }

  async prepareAnalysisAudio(input: {
    buffer: Buffer;
    fileName: string;
    maxDurationSeconds?: number;
  }): Promise<VoiceFfmpegPreparedAudio> {
    this.assertInput(input.buffer);
    const workdir = await mkdtemp(join(tmpdir(), 'tzl-voice-analysis-'));
    const inputPath = join(
      workdir,
      `source${this.safeExtension(input.fileName)}`
    );
    const outputPath = join(workdir, 'analysis.mp3');

    try {
      await writeFile(inputPath, input.buffer);
      await this.runCommand([
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        inputPath,
        '-map',
        '0:a:0',
        '-vn',
        '-t',
        String(
          Math.min(
            this.maxSourceSeconds,
            this.positiveInteger(
              input.maxDurationSeconds,
              this.maxSourceSeconds
            )
          )
        ),
        '-af',
        'highpass=f=100,lowpass=f=7600,afftdn=nf=-32,adeclick,loudnorm=I=-18:TP=-2:LRA=11',
        '-ac',
        '1',
        '-ar',
        '24000',
        '-codec:a',
        'libmp3lame',
        '-b:a',
        '64k',
        outputPath,
      ]);
      const buffer = await readFile(outputPath);
      this.assertOutput(buffer);

      return {
        buffer,
        fileName: `${this.safeBaseName(input.fileName)}-analysis.mp3`,
        contentType: 'audio/mpeg',
        durationSeconds: this.estimateMp3Duration(buffer),
      };
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  }

  async createReviewClipsFromSegments(input: {
    buffer: Buffer;
    fileName: string;
    segments: VoiceFfmpegSegment[];
    edgePadding?: boolean;
  }): Promise<Array<VoiceFfmpegClip & VoiceFfmpegSegment>> {
    const result = await this.createReviewClipsFromSegmentsWithQuality(input);

    return result.clips as Array<VoiceFfmpegClip & VoiceFfmpegSegment>;
  }

  async createReviewClipsFromSegmentsWithQuality(input: {
    buffer: Buffer;
    fileName: string;
    segments: VoiceFfmpegSegment[];
    edgePadding?: boolean;
  }): Promise<VoiceFfmpegQualityBatch> {
    this.assertInput(input.buffer);
    const segments = input.segments
      .filter(item => item.endMs > item.beginMs)
      .slice(0, this.maxClipsPerMaterial);

    if (segments.length === 0) {
      throw new AppError(
        'VOICE_CLIPPING_SEGMENT_REQUIRED',
        'voice clipping segment is required',
        422
      );
    }

    const workdir = await mkdtemp(join(tmpdir(), 'tzl-voice-segments-'));
    const inputPath = join(
      workdir,
      `source${this.safeExtension(input.fileName)}`
    );

    try {
      await writeFile(inputPath, input.buffer);
      const clips: Array<VoiceFfmpegClip & VoiceFfmpegSegment> = [];
      const filteredClips: VoiceFfmpegFilteredClip[] = [];

      for (let index = 0; index < segments.length; index += 1) {
        const segment = segments[index];
        const edgePadding = input.edgePadding !== false;
        const beginSeconds = Math.max(
          0,
          segment.beginMs / 1000 - (edgePadding ? 0.06 : 0)
        );
        const endSeconds = Math.max(
          beginSeconds + 0.5,
          segment.endMs / 1000 + (edgePadding ? 0.08 : 0)
        );
        const durationSeconds = Math.min(20, endSeconds - beginSeconds);
        const candidatePath = join(workdir, `candidate-${index}.wav`);
        const outputPath = join(workdir, `clip-${index}.mp3`);

        await this.runCommand([
          '-y',
          '-hide_banner',
          '-loglevel',
          'error',
          '-ss',
          beginSeconds.toFixed(3),
          '-t',
          durationSeconds.toFixed(3),
          '-i',
          inputPath,
          '-vn',
          '-af',
          'highpass=f=100,lowpass=f=7600',
          '-ac',
          '1',
          '-ar',
          '24000',
          '-codec:a',
          'pcm_s16le',
          candidatePath,
        ]);
        const metrics = await this.analyzeClipQuality(
          candidatePath,
          durationSeconds
        );
        const assessment = this.evaluateClipQuality(metrics);

        if (!assessment.usable) {
          filteredClips.push({
            ...segment,
            durationSeconds: assessment.metrics.durationSeconds,
            qualityMetrics: assessment.metrics,
            qualityIssues: assessment.issues,
          });
          continue;
        }

        await this.renderReviewClip(
          candidatePath,
          outputPath,
          assessment.metrics
        );
        const buffer = await readFile(outputPath);

        if (buffer.length >= this.minClipBytes) {
          clips.push({
            ...segment,
            buffer,
            fileName: `${this.safeBaseName(input.fileName)}-${index + 1}.mp3`,
            contentType: 'audio/mpeg',
            durationSeconds: Math.max(
              1,
              Math.round(assessment.metrics.durationSeconds)
            ),
            qualityMetrics: assessment.metrics,
            qualityIssues: assessment.issues,
          });
        }
      }

      if (clips.length === 0 && filteredClips.length === 0) {
        throw new AppError(
          'VOICE_CLIPPING_NO_USABLE_AUDIO',
          'no usable audio track found in voice material',
          422
        );
      }

      return { clips, filteredClips };
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  }

  async createReadyReviewClip(input: {
    buffer: Buffer;
    fileName: string;
  }): Promise<VoiceFfmpegClip> {
    const result = await this.createReadyReviewClipWithQuality(input);
    const clip = result.clips[0];
    if (!clip) {
      throw new AppError(
        'VOICE_CLIPPING_NO_USABLE_AUDIO',
        'no usable audio track found in voice material',
        422,
        { filteredClips: result.filteredClips }
      );
    }

    return {
      ...clip,
      fileName: `${this.safeBaseName(input.fileName)}-ready.mp3`,
    };
  }

  async createReadyReviewClipWithQuality(input: {
    buffer: Buffer;
    fileName: string;
  }): Promise<VoiceFfmpegQualityBatch> {
    this.assertInput(input.buffer);
    const workdir = await mkdtemp(join(tmpdir(), 'tzl-voice-ready-'));
    const inputPath = join(
      workdir,
      `source${this.safeExtension(input.fileName)}`
    );
    const candidatePath = join(workdir, 'candidate.wav');
    const outputPath = join(workdir, 'ready.mp3');

    try {
      await writeFile(inputPath, input.buffer);
      await this.runCommand([
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        inputPath,
        '-map',
        '0:a:0',
        '-vn',
        '-t',
        '30',
        '-af',
        'highpass=f=100,lowpass=f=7600',
        '-ac',
        '1',
        '-ar',
        '24000',
        '-codec:a',
        'pcm_s16le',
        candidatePath,
      ]);
      const metrics = await this.analyzeClipQuality(candidatePath, 30);
      const assessment = this.evaluateClipQuality(metrics);
      if (!assessment.usable) {
        return {
          clips: [],
          filteredClips: [
            {
              durationSeconds: assessment.metrics.durationSeconds,
              qualityMetrics: assessment.metrics,
              qualityIssues: assessment.issues,
            },
          ],
        };
      }

      await this.renderReviewClip(
        candidatePath,
        outputPath,
        assessment.metrics
      );
      const buffer = await readFile(outputPath);
      this.assertOutput(buffer);

      return {
        clips: [
          {
            buffer,
            fileName: `${this.safeBaseName(input.fileName)}-ready.mp3`,
            contentType: 'audio/mpeg',
            durationSeconds: Math.max(
              1,
              Math.round(assessment.metrics.durationSeconds)
            ),
            qualityMetrics: assessment.metrics,
            qualityIssues: assessment.issues,
          },
        ],
        filteredClips: [],
      };
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  }

  evaluateClipQuality(
    input: VoiceServiceClipQualityMetrics
  ): VoiceClipQualityAssessment {
    const metrics: VoiceServiceClipQualityMetrics = {
      ...input,
      durationSeconds: this.round(input.durationSeconds, 2),
      silenceRatio: this.round(this.clampRatio(input.silenceRatio), 4),
      clippingRatio: this.round(this.clampRatio(input.clippingRatio), 5),
    };
    const rejected: VoiceServiceClipQualityIssue[] = [];
    const warnings: VoiceServiceClipQualityIssue[] = [];

    if (metrics.durationSeconds < this.minUsableDurationSeconds) {
      rejected.push({
        code: 'too_short',
        severity: 'rejected',
        message: `时长不足 ${this.formatThreshold(
          this.minUsableDurationSeconds
        )} 秒`,
      });
    }
    if (metrics.silenceRatio > this.maxSilenceRatio) {
      rejected.push({
        code: 'mostly_silent',
        severity: 'rejected',
        message: `静音占比 ${this.formatPercent(
          metrics.silenceRatio
        )}，有效声音太少`,
      });
    } else if (metrics.silenceRatio >= 0.45) {
      warnings.push({
        code: 'silence_high',
        severity: 'warning',
        message: `静音占比 ${this.formatPercent(
          metrics.silenceRatio
        )}，请重点试听完整性`,
      });
    }
    if (metrics.clippingRatio > this.maxClippingRatio) {
      rejected.push({
        code: 'severe_clipping',
        severity: 'rejected',
        message: `削波占比 ${this.formatPercent(
          metrics.clippingRatio
        )}，爆音失真较严重`,
      });
    } else if (metrics.clippingRatio >= 0.01) {
      warnings.push({
        code: 'clipping_detected',
        severity: 'warning',
        message: `检测到 ${this.formatPercent(
          metrics.clippingRatio
        )} 削波，请留意爆音`,
      });
    }

    if (metrics.rmsDb == null || metrics.rmsDb < this.minRecoverableRmsDb) {
      rejected.push({
        code: 'volume_unrecoverable',
        severity: 'rejected',
        message: '音量过低，调高后仍可能听不清',
      });
    } else if (metrics.rmsDb < this.lowVolumeRmsDb) {
      const gainDb = this.round(
        Math.min(
          this.maxVolumeGainDb,
          Math.max(0, this.targetRmsDb - metrics.rmsDb)
        ),
        1
      );
      metrics.volumeAdjusted = gainDb >= 1;
      metrics.volumeGainDb = metrics.volumeAdjusted ? gainDb : undefined;
      if (metrics.volumeAdjusted) {
        warnings.push({
          code: 'volume_adjusted',
          severity: 'warning',
          message: `原音量偏低，已自动调高约 ${gainDb} dB`,
        });
      }
    }

    if (
      metrics.silenceRatio >= 0.02 &&
      metrics.signalToNoiseDb != null &&
      metrics.noiseFloorDb != null &&
      metrics.noiseFloorDb > -35 &&
      metrics.signalToNoiseDb < this.minSignalToNoiseDb
    ) {
      rejected.push({
        code: 'background_noise_severe',
        severity: 'rejected',
        message: `估算信噪比仅 ${this.formatDb(
          metrics.signalToNoiseDb
        )}，背景噪声盖过人声`,
      });
    } else if (
      metrics.silenceRatio >= 0.02 &&
      metrics.signalToNoiseDb != null &&
      metrics.noiseFloorDb != null &&
      metrics.noiseFloorDb > -45 &&
      metrics.signalToNoiseDb < this.warningSignalToNoiseDb
    ) {
      warnings.push({
        code: 'background_noise_high',
        severity: 'warning',
        message: `估算信噪比 ${this.formatDb(
          metrics.signalToNoiseDb
        )}，背景噪声偏多`,
      });
    }

    if (rejected.length > 0) {
      metrics.volumeAdjusted = undefined;
      metrics.volumeGainDb = undefined;
    }

    return {
      usable: rejected.length === 0,
      metrics,
      issues: [
        ...rejected,
        ...warnings.filter(
          item => rejected.length === 0 || item.code !== 'volume_adjusted'
        ),
      ],
    };
  }

  async combineTrainingClips(
    clips: Array<{ buffer: Buffer; durationSeconds?: number }>
  ): Promise<VoiceFfmpegPreparedAudio> {
    if (!clips.length) {
      throw new AppError(
        'VOICE_TRAINING_CLIP_REQUIRED',
        'accepted voice clip is required',
        400
      );
    }

    const workdir = await mkdtemp(join(tmpdir(), 'tzl-voice-training-'));
    const silencePath = join(workdir, 'silence.mp3');
    const listPath = join(workdir, 'inputs.txt');
    const outputPath = join(workdir, 'training.wav');

    try {
      const clipPaths: string[] = [];

      for (let index = 0; index < clips.length; index += 1) {
        this.assertInput(clips[index].buffer);
        const clipPath = join(workdir, `clip-${index}.mp3`);
        await writeFile(clipPath, clips[index].buffer);
        clipPaths.push(clipPath);
      }

      await this.runCommand([
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        'anullsrc=r=24000:cl=mono',
        '-t',
        '0.2',
        '-codec:a',
        'libmp3lame',
        '-b:a',
        '64k',
        silencePath,
      ]);
      const listEntries: string[] = [];
      clipPaths.forEach((clipPath, index) => {
        listEntries.push(`file '${clipPath}'`);
        if (index < clipPaths.length - 1) {
          listEntries.push(`file '${silencePath}'`);
        }
      });
      await writeFile(listPath, `${listEntries.join('\n')}\n`);
      await this.runCommand([
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        listPath,
        '-t',
        String(VOICE_SERVICE_MAX_TRAINING_SECONDS),
        '-af',
        'highpass=f=80,lowpass=f=8000,loudnorm=I=-18:TP=-2:LRA=11',
        '-ac',
        '1',
        '-ar',
        '24000',
        '-codec:a',
        'pcm_s16le',
        outputPath,
      ]);
      const buffer = await readFile(outputPath);
      this.assertOutput(buffer);
      const requestedDuration = clips.reduce(
        (total, clip) => total + Math.max(0, clip.durationSeconds || 0),
        Math.max(0, clips.length - 1) * 0.2
      );

      return {
        buffer,
        fileName: 'voice-training.wav',
        contentType: 'audio/wav',
        durationSeconds: Math.max(
          1,
          Math.min(
            VOICE_SERVICE_MAX_TRAINING_SECONDS,
            Math.round(requestedDuration)
          )
        ),
      };
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  }

  async adjustSpeechOutput(input: {
    buffer: Buffer;
    fileName: string;
    speechSpeed?: number;
    speechVolume?: number;
  }): Promise<VoiceFfmpegSpeechOutput> {
    this.assertInput(input.buffer);
    const speechSpeed = this.numberInRange(input.speechSpeed, 1, 0.5, 2);
    const speechVolume = this.numberInRange(input.speechVolume, 1, 0.25, 2);
    const workdir = await mkdtemp(join(tmpdir(), 'tzl-voice-output-'));
    const inputPath = join(
      workdir,
      `source${this.safeExtension(input.fileName)}`
    );
    const outputPath = join(workdir, 'speech.mp3');

    try {
      await writeFile(inputPath, input.buffer);
      await this.runCommand([
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        inputPath,
        '-map',
        '0:a:0',
        '-vn',
        '-af',
        `atempo=${speechSpeed.toFixed(2)},volume=${speechVolume.toFixed(2)}`,
        '-ac',
        '1',
        '-ar',
        '24000',
        '-codec:a',
        'libmp3lame',
        '-b:a',
        '64k',
        outputPath,
      ]);
      const buffer = await readFile(outputPath);
      this.assertOutput(buffer);
      return {
        buffer,
        fileName: 'speech.mp3',
        contentType: 'audio/mpeg',
        durationSeconds: this.estimateMp3Duration(buffer),
      };
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  }

  private async analyzeClipQuality(
    inputPath: string,
    fallbackDurationSeconds: number
  ): Promise<VoiceServiceClipQualityMetrics> {
    const output = await this.runCommand([
      '-hide_banner',
      '-nostats',
      '-i',
      inputPath,
      '-af',
      [
        'silencedetect=noise=-45dB:d=0.12',
        'astats=metadata=0:reset=0:measure_perchannel=none:measure_overall=RMS_level+Peak_level+Noise_floor+Peak_count+Number_of_samples',
      ].join(','),
      '-f',
      'null',
      '-',
    ]);
    const numberOfSamples = this.readLastFfmpegMetric(
      output,
      'Number of samples'
    );
    const measuredDuration =
      numberOfSamples != null && numberOfSamples > 0
        ? numberOfSamples / 24000
        : fallbackDurationSeconds;
    const durationSeconds = Math.max(0, measuredDuration);
    const silenceSeconds = this.readFfmpegMetricSum(output, 'silence_duration');
    const rmsDb = this.readLastFfmpegMetric(output, 'RMS level dB');
    const peakDb = this.readLastFfmpegMetric(output, 'Peak level dB');
    const noiseFloorDb = this.readLastFfmpegMetric(output, 'Noise floor dB');
    const peakCount = this.readLastFfmpegMetric(output, 'Peak count') ?? 0;
    const clippingRatio =
      peakDb != null && peakDb >= -1 && numberOfSamples
        ? peakCount / numberOfSamples
        : 0;
    const signalToNoiseDb =
      peakDb != null && noiseFloorDb != null
        ? Math.max(0, peakDb - noiseFloorDb)
        : undefined;

    return {
      durationSeconds: this.round(durationSeconds, 3),
      silenceRatio:
        durationSeconds > 0
          ? this.clampRatio(silenceSeconds / durationSeconds)
          : 1,
      rmsDb: this.roundOptional(rmsDb, 1),
      peakDb: this.roundOptional(peakDb, 1),
      clippingRatio: this.clampRatio(clippingRatio),
      noiseFloorDb: this.roundOptional(noiseFloorDb, 1),
      signalToNoiseDb: this.roundOptional(signalToNoiseDb, 1),
    };
  }

  private async renderReviewClip(
    inputPath: string,
    outputPath: string,
    metrics: VoiceServiceClipQualityMetrics
  ): Promise<void> {
    const fadeOutStart = Math.max(0.1, metrics.durationSeconds - 0.06);
    const filters = ['afftdn=nf=-32', 'adeclick'];
    if (metrics.volumeAdjusted && metrics.volumeGainDb) {
      filters.push(`volume=${metrics.volumeGainDb.toFixed(1)}dB`);
    }
    filters.push(
      'loudnorm=I=-18:TP=-2:LRA=11',
      'afade=t=in:d=0.03',
      `afade=t=out:st=${fadeOutStart.toFixed(3)}:d=0.05`
    );

    await this.runCommand([
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      inputPath,
      '-vn',
      '-af',
      filters.join(','),
      '-ac',
      '1',
      '-ar',
      '24000',
      '-codec:a',
      'libmp3lame',
      '-b:a',
      '64k',
      outputPath,
    ]);
  }

  private runFfmpeg(inputPath: string, outputPattern: string): Promise<void> {
    const args = [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      inputPath,
      '-map',
      '0:a:0',
      '-vn',
      '-t',
      String(this.maxSourceSeconds),
      '-af',
      [
        'highpass=f=80',
        'lowpass=f=8000',
        'silenceremove=start_periods=1:start_duration=0.1:start_threshold=-50dB:stop_periods=-1:stop_duration=0.5:stop_threshold=-50dB',
        'loudnorm=I=-18:TP=-2:LRA=11',
      ].join(','),
      '-ac',
      '1',
      '-ar',
      '24000',
      '-codec:a',
      'libmp3lame',
      '-b:a',
      '64k',
      '-f',
      'segment',
      '-segment_time',
      String(this.segmentSeconds),
      '-segment_format',
      'mp3',
      '-reset_timestamps',
      '1',
      outputPattern,
    ];

    return this.runCommand(args).then(() => undefined);
  }

  private runCommand(args: string[]): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const process = spawn(this.binaryPath, args);
      const errorChunks: Buffer[] = [];
      let settled = false;
      let timedOut = false;
      const finish = (error?: AppError, output = '') => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        error ? reject(error) : resolve(output);
      };
      const timeout = setTimeout(() => {
        timedOut = true;
        process.kill('SIGKILL');
      }, this.timeoutMs);

      process.stderr.on('data', chunk => errorChunks.push(Buffer.from(chunk)));
      process.on('error', error => {
        finish(new AppError('VOICE_CLIPPING_EXEC_FAILED', error.message, 500));
      });
      process.on('close', code => {
        if (timedOut) {
          finish(
            new AppError(
              'VOICE_CLIPPING_TIMEOUT',
              'voice clipping timed out',
              504
            )
          );
          return;
        }
        if (code !== 0) {
          const message =
            Buffer.concat(errorChunks).toString('utf8').trim().slice(0, 1000) ||
            'voice clipping failed';
          finish(new AppError('VOICE_CLIPPING_FAILED', message, 422));
          return;
        }

        finish(undefined, Buffer.concat(errorChunks).toString('utf8'));
      });
    });
  }

  private assertInput(buffer: Buffer): void {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw new AppError(
        'VOICE_CLIPPING_INVALID_INPUT',
        'voice material is required',
        400
      );
    }
  }

  private assertOutput(buffer: Buffer): void {
    if (!Buffer.isBuffer(buffer) || buffer.length < this.minClipBytes) {
      throw new AppError(
        'VOICE_CLIPPING_NO_USABLE_AUDIO',
        'no usable audio track found in voice material',
        422
      );
    }
  }

  private estimateMp3Duration(buffer: Buffer): number {
    return Math.max(1, Math.round((buffer.length * 8) / 64000));
  }

  private numberInRange(
    value: unknown,
    fallback: number,
    min: number,
    max: number
  ): number {
    const parsed = Number(value);
    return Number.isFinite(parsed)
      ? Math.min(max, Math.max(min, parsed))
      : fallback;
  }

  private safeBaseName(fileName: string): string {
    return (
      fileName
        .replace(/\\/g, '/')
        .split('/')
        .pop()
        ?.replace(/\.[^.]+$/, '')
        .replace(/[^0-9A-Za-z_-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40) || 'voice'
    );
  }

  private safeExtension(fileName: string): string {
    const extension = fileName.match(/\.[A-Za-z0-9]{1,8}$/)?.[0].toLowerCase();

    return extension || '.bin';
  }

  private get binaryPath(): string {
    return this.config?.binaryPath?.trim() || 'ffmpeg';
  }

  private get timeoutMs(): number {
    return this.positiveInteger(this.config?.timeoutMs, 300000);
  }

  private get segmentSeconds(): number {
    return this.positiveInteger(this.config?.segmentSeconds, 12);
  }

  private get maxClipsPerMaterial(): number {
    return this.positiveInteger(this.config?.maxClipsPerMaterial, 3);
  }

  private get maxSourceSeconds(): number {
    return this.positiveInteger(this.config?.maxSourceSeconds, 180);
  }

  private get minClipBytes(): number {
    return this.positiveInteger(this.config?.minClipBytes, 4096);
  }

  private get minUsableDurationSeconds(): number {
    return this.positiveNumber(this.config?.minUsableDurationSeconds, 2);
  }

  private get maxSilenceRatio(): number {
    return this.ratio(this.config?.maxSilenceRatio, 0.75);
  }

  private get maxClippingRatio(): number {
    return this.ratio(this.config?.maxClippingRatio, 0.12);
  }

  private get minRecoverableRmsDb(): number {
    return this.finiteNumber(this.config?.minRecoverableRmsDb, -58);
  }

  private get lowVolumeRmsDb(): number {
    return this.finiteNumber(this.config?.lowVolumeRmsDb, -32);
  }

  private get targetRmsDb(): number {
    return this.finiteNumber(this.config?.targetRmsDb, -22);
  }

  private get maxVolumeGainDb(): number {
    return this.positiveNumber(this.config?.maxVolumeGainDb, 20);
  }

  private get minSignalToNoiseDb(): number {
    return this.positiveNumber(this.config?.minSignalToNoiseDb, 4);
  }

  private get warningSignalToNoiseDb(): number {
    return this.positiveNumber(this.config?.warningSignalToNoiseDb, 12);
  }

  private readLastFfmpegMetric(
    output: string,
    label: string
  ): number | undefined {
    const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(
      `${escapedLabel}:\\s*(-?inf|[-+]?\\d+(?:\\.\\d+)?)`,
      'gi'
    );
    let value: number | undefined;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(output))) {
      const parsed = Number(match[1]);
      value = Number.isFinite(parsed) ? parsed : undefined;
    }

    return value;
  }

  private readFfmpegMetricSum(output: string, label: string): number {
    const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(
      `${escapedLabel}:\\s*([-+]?\\d+(?:\\.\\d+)?)`,
      'gi'
    );
    let total = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(output))) {
      const parsed = Number(match[1]);
      if (Number.isFinite(parsed) && parsed > 0) {
        total += parsed;
      }
    }

    return total;
  }

  private roundOptional(
    value: number | undefined,
    digits: number
  ): number | undefined {
    return value == null ? undefined : this.round(value, digits);
  }

  private round(value: number, digits: number): number {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
  }

  private clampRatio(value: number): number {
    return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
  }

  private ratio(value: number | undefined, fallback: number): number {
    return this.clampRatio(this.finiteNumber(value, fallback));
  }

  private positiveNumber(value: number | undefined, fallback: number): number {
    const parsed = Number(value);

    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  private finiteNumber(value: number | undefined, fallback: number): number {
    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : fallback;
  }

  private formatThreshold(value: number): string {
    return Number.isInteger(value) ? String(value) : value.toFixed(1);
  }

  private formatPercent(value: number): string {
    return `${Math.round(this.clampRatio(value) * 100)}%`;
  }

  private formatDb(value: number): string {
    return `${this.round(value, 1)} dB`;
  }

  private positiveInteger(value: number | undefined, fallback: number): number {
    const parsed = Number(value);

    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
  }
}
