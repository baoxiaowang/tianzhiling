import { Config, Provide } from '@midwayjs/core';
import { AppError } from '@tzl/shared';
import { spawn } from 'child_process';

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
  }): Promise<ExtractedAudioFile> {
    if (!Buffer.isBuffer(input.buffer) || input.buffer.length === 0) {
      throw new AppError('FFMPEG_INVALID_INPUT', 'media file is required', 400);
    }

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
      '24000',
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
