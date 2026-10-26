import { Config, Provide } from '@midwayjs/core';
import {
  AppError,
  buildSpeechOutputFfmpegFilter,
  VOICE_SERVICE_MAX_ENROLL_AUDIO_SECONDS,
} from '@tzl/shared';
import { spawn } from 'child_process';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

interface FfmpegConfig {
  binaryPath?: string;
  timeoutMs?: number;
}

export interface ExtractedAudioFile {
  buffer: Buffer;
  fileName: string;
  contentType: string;
}

@Provide()
export class AdminFfmpegService {
  @Config('ffmpeg')
  config: FfmpegConfig;

  async extractAudioToWav(input: {
    buffer: Buffer;
    fileName: string;
    /** 输出采样率，默认 24000（保持历史路径行为）。VRS 等需要 16k 的场景显式传 16000。 */
    sampleRate?: number;
  }): Promise<ExtractedAudioFile> {
    if (!Buffer.isBuffer(input.buffer) || input.buffer.length === 0) {
      throw new AppError('FFMPEG_INVALID_INPUT', 'media file is required', 400);
    }

    const sampleRate = this.normalizeSampleRate(input.sampleRate, 24000);
    const chunks: Buffer[] = [];
    const errorChunks: Buffer[] = [];
    const ffmpeg = spawn(this.binaryPath, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      'pipe:0',
      '-vn',
      '-acodec',
      'pcm_s16le',
      '-ar',
      String(sampleRate),
      '-ac',
      '1',
      '-f',
      'wav',
      'pipe:1',
    ]);
    const timeout = setTimeout(() => {
      ffmpeg.kill('SIGKILL');
    }, this.timeoutMs);

    return new Promise<ExtractedAudioFile>((resolve, reject) => {
      ffmpeg.stdout.on('data', chunk => chunks.push(Buffer.from(chunk)));
      ffmpeg.stderr.on('data', chunk => errorChunks.push(Buffer.from(chunk)));
      ffmpeg.on('error', error => {
        clearTimeout(timeout);
        reject(new AppError('FFMPEG_EXEC_FAILED', error.message, 500));
      });
      ffmpeg.on('close', code => {
        clearTimeout(timeout);

        if (code !== 0) {
          const message =
            Buffer.concat(errorChunks).toString('utf8').trim() ||
            'ffmpeg extract audio failed';
          reject(new AppError('FFMPEG_EXTRACT_AUDIO_FAILED', message, 400));
          return;
        }

        const buffer = Buffer.concat(chunks);

        if (buffer.length === 0) {
          reject(
            new AppError(
              'FFMPEG_EXTRACT_AUDIO_EMPTY',
              'no audio track found in media file',
              400
            )
          );
          return;
        }

        resolve({
          buffer,
          fileName: this.buildOutputFileName(input.fileName),
          contentType: 'audio/wav',
        });
      });

      ffmpeg.stdin.on('error', error => {
        reject(new AppError('FFMPEG_INPUT_FAILED', error.message, 500));
      });
      ffmpeg.stdin.end(input.buffer);
    });
  }

  async adjustSpeechOutput(input: {
    buffer: Buffer;
    speechSpeed?: number;
    speechVolume?: number;
    speechPitch?: number;
  }): Promise<ExtractedAudioFile> {
    if (!Buffer.isBuffer(input.buffer) || input.buffer.length === 0) {
      throw new AppError('FFMPEG_INVALID_INPUT', 'audio is required', 400);
    }

    const speechSpeed = this.numberInRange(input.speechSpeed, 1, 0.5, 2);
    const speechVolume = this.numberInRange(input.speechVolume, 1, 0.25, 2);
    const speechPitch = this.numberInRange(input.speechPitch, 0, -12, 12);
    const chunks: Buffer[] = [];
    const errorChunks: Buffer[] = [];
    const ffmpeg = spawn(this.binaryPath, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      'pipe:0',
      '-vn',
      '-af',
      buildSpeechOutputFfmpegFilter({
        speechSpeed,
        speechVolume,
        speechPitch,
      }),
      '-ac',
      '1',
      '-ar',
      '24000',
      '-codec:a',
      'libmp3lame',
      '-b:a',
      '64k',
      '-f',
      'mp3',
      'pipe:1',
    ]);
    const timeout = setTimeout(() => {
      ffmpeg.kill('SIGKILL');
    }, this.timeoutMs);

    return new Promise<ExtractedAudioFile>((resolve, reject) => {
      ffmpeg.stdout.on('data', chunk => chunks.push(Buffer.from(chunk)));
      ffmpeg.stderr.on('data', chunk => errorChunks.push(Buffer.from(chunk)));
      ffmpeg.on('error', error => {
        clearTimeout(timeout);
        reject(new AppError('FFMPEG_EXEC_FAILED', error.message, 500));
      });
      ffmpeg.on('close', code => {
        clearTimeout(timeout);

        if (code !== 0) {
          const message =
            Buffer.concat(errorChunks).toString('utf8').trim() ||
            'ffmpeg adjust speech output failed';
          reject(new AppError('FFMPEG_ADJUST_SPEECH_FAILED', message, 500));
          return;
        }

        const buffer = Buffer.concat(chunks);

        if (buffer.length === 0) {
          reject(
            new AppError(
              'FFMPEG_ADJUST_SPEECH_EMPTY',
              'adjusted speech output is empty',
              500
            )
          );
          return;
        }

        resolve({
          buffer,
          fileName: 'speech.mp3',
          contentType: 'audio/mpeg',
        });
      });

      ffmpeg.stdin.on('error', error => {
        reject(new AppError('FFMPEG_INPUT_FAILED', error.message, 500));
      });
      ffmpeg.stdin.end(input.buffer);
    });
  }

  /**
   * 将多段音频合并为一段训练用 WAV。
   * 每段先转码为统一 24kHz 单声道 PCM，段间插入 0.2s 静音，再 concat 输出。
   */
  async mergeAudios(
    clips: Array<{ buffer: Buffer; fileName: string }>
  ): Promise<ExtractedAudioFile> {
    if (!clips.length) {
      throw new AppError(
        'FFMPEG_INVALID_INPUT',
        'audio clips are required',
        400
      );
    }

    for (const clip of clips) {
      if (!Buffer.isBuffer(clip.buffer) || clip.buffer.length === 0) {
        throw new AppError('FFMPEG_INVALID_INPUT', 'audio clip is empty', 400);
      }
    }

    const workdir = await mkdtemp(join(tmpdir(), 'tzl-admin-voice-merge-'));
    const listPath = join(workdir, 'inputs.txt');
    const outputPath = join(workdir, 'merged.wav');

    try {
      const clipPaths: string[] = [];
      for (let index = 0; index < clips.length; index += 1) {
        const clipPath = join(workdir, `clip-${index}.wav`);
        await this.transcodeClipToWav(clips[index].buffer, clipPath);
        clipPaths.push(clipPath);
      }

      const silencePath = join(workdir, 'silence.wav');
      await this.createSilenceWav(silencePath);

      const entries: string[] = [];
      clipPaths.forEach((clipPath, index) => {
        entries.push(`file '${clipPath}'`);
        if (index < clipPaths.length - 1) {
          entries.push(`file '${silencePath}'`);
        }
      });
      await writeFile(listPath, `${entries.join('\n')}\n`);

      await this.runFfmpeg([
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
        String(VOICE_SERVICE_MAX_ENROLL_AUDIO_SECONDS),
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

      if (!buffer.length) {
        throw new AppError(
          'FFMPEG_MERGE_AUDIO_EMPTY',
          'merged audio is empty',
          400
        );
      }

      // 输出固定为 24kHz / 单声道 / 16bit PCM：每秒钟 48000 字节（去掉 44 字节头部）。
      // 太短说明素材里没有可用的语音（例如视频没有音轨、取音失败），
      // 直接给出可读错误，避免提交到厂商后只拿到 audio preprocess server error。
      const seconds = Math.max(0, buffer.length - 44) / 48000;
      if (seconds < 3) {
        throw new AppError(
          'FFMPEG_MERGE_AUDIO_TOO_SHORT',
          `训练音频只有 ${seconds.toFixed(1)} 秒，素材里可能没有可用人声（视频请确认包含音轨），请换一段包含说话的素材重试`,
          400
        );
      }

      return {
        buffer,
        fileName: 'voice-training.wav',
        contentType: 'audio/wav',
      };
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  }

  private async transcodeClipToWav(
    buffer: Buffer,
    outputPath: string
  ): Promise<void> {
    // 必须先落盘再转码：mp4/mov 的 moov 原子通常在文件尾部，从管道（pipe:0）读
    // 无法 seek，ffmpeg 会「成功退出但只写出 78 字节空 wav」，最终训练音频为空，
    // 复刻接口报 audio preprocess server error（2026-10-25 管理端上传 mp4 即此问题）。
    const sourcePath = `${outputPath}.src`;
    await writeFile(sourcePath, buffer);

    try {
      await this.runFfmpeg([
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        sourcePath,
        '-vn',
        '-acodec',
        'pcm_s16le',
        '-ar',
        '24000',
        '-ac',
        '1',
        '-f',
        'wav',
        outputPath,
      ]);
    } finally {
      await rm(sourcePath, { force: true });
    }
  }

  private async createSilenceWav(outputPath: string): Promise<void> {
    await this.runFfmpeg([
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'anullsrc=r=24000:cl=mono',
      '-t',
      '0.2',
      '-acodec',
      'pcm_s16le',
      '-ar',
      '24000',
      '-ac',
      '1',
      outputPath,
    ]);
  }

  private runFfmpeg(args: string[], stdinBuffer?: Buffer): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const ffmpeg = spawn(this.binaryPath, args);
      const errorChunks: Buffer[] = [];
      const timeout = setTimeout(() => {
        ffmpeg.kill('SIGKILL');
      }, this.timeoutMs);

      ffmpeg.stderr.on('data', chunk => errorChunks.push(Buffer.from(chunk)));
      ffmpeg.on('error', error => {
        clearTimeout(timeout);
        reject(new AppError('FFMPEG_EXEC_FAILED', error.message, 500));
      });
      ffmpeg.on('close', code => {
        clearTimeout(timeout);

        if (code !== 0) {
          const message =
            Buffer.concat(errorChunks).toString('utf8').trim() ||
            'ffmpeg merge audio failed';
          reject(new AppError('FFMPEG_MERGE_AUDIO_FAILED', message, 400));
          return;
        }

        resolve();
      });

      if (stdinBuffer !== undefined) {
        ffmpeg.stdin.on('error', error => {
          reject(new AppError('FFMPEG_INPUT_FAILED', error.message, 500));
        });
        ffmpeg.stdin.end(stdinBuffer);
      }
    });
  }

  private buildOutputFileName(fileName: string): string {
    const base =
      fileName
        .replace(/\\/g, '/')
        .split('/')
        .pop()
        ?.replace(/\.[^.]+$/, '')
        .replace(/[^a-zA-Z0-9._-]/g, '_') || 'voice';

    return `${base || 'voice'}.wav`;
  }

  private normalizeSampleRate(value: unknown, fallback: number): number {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
    return fallback;
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

  private get binaryPath(): string {
    return this.config?.binaryPath?.trim() || 'ffmpeg';
  }

  private get timeoutMs(): number {
    const value = Number(this.config?.timeoutMs);

    if (Number.isInteger(value) && value > 0) {
      return value;
    }

    return 120000;
  }
}
