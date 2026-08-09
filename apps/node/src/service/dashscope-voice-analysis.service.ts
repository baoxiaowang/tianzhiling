import { Config, Logger, Provide } from '@midwayjs/core';
import type { ILogger } from '@midwayjs/logger';
import { request as httpRequest } from 'http';
import { request as httpsRequest } from 'https';
import { URL } from 'url';
import { AppError } from '../common/errors';

interface VoiceAnalysisConfig {
  enabled?: boolean;
  apiKey?: string;
  baseURL?: string;
  model?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
}

interface DashScopeTaskResponse {
  request_id?: string;
  code?: string;
  message?: string;
  output?: {
    task_id?: string;
    task_status?: string;
    results?: Array<{
      transcription_url?: string;
      subtask_status?: string;
      code?: string;
      message?: string;
    }>;
  };
}

interface DashScopeTranscriptionResult {
  transcripts?: Array<{
    sentences?: Array<{
      begin_time?: number;
      end_time?: number;
      text?: string;
      speaker_id?: string | number;
    }>;
  }>;
}

export interface VoiceAnalysisSentence {
  beginMs: number;
  endMs: number;
  text: string;
  speakerId: string;
}

@Provide()
export class DashScopeVoiceAnalysisService {
  @Logger()
  logger: ILogger;

  @Config('voiceAnalysis')
  config: VoiceAnalysisConfig;

  isEnabled(): boolean {
    return Boolean(
      this.config?.enabled !== false && this.config?.apiKey?.trim()
    );
  }

  async analyze(audioUrl: string): Promise<VoiceAnalysisSentence[]> {
    this.ensureEnabled();
    const normalizedUrl = audioUrl?.trim();

    if (!/^https?:\/\//i.test(normalizedUrl)) {
      throw new AppError(
        'VOICE_ANALYSIS_AUDIO_URL_INVALID',
        'voice analysis audio url must be publicly accessible',
        400
      );
    }

    const task = await this.requestJson<DashScopeTaskResponse>({
      url: this.buildApiUrl('/api/v1/services/audio/asr/transcription'),
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey?.trim()}`,
        'Content-Type': 'application/json',
        'X-DashScope-Async': 'enable',
      },
      body: Buffer.from(
        JSON.stringify({
          model: this.config?.model?.trim() || 'paraformer-v2',
          input: { file_urls: [normalizedUrl] },
          parameters: {
            channel_id: [0],
            language_hints: ['zh', 'en'],
            diarization_enabled: true,
            timestamp_alignment_enabled: true,
          },
        })
      ),
    });
    const taskId = task.output?.task_id?.trim();

    if (!taskId) {
      throw new AppError(
        task.code || 'VOICE_ANALYSIS_TASK_ID_MISSING',
        task.message || 'voice analysis task id is missing',
        502,
        task
      );
    }

    this.logger.info('[voice-analysis] task submitted, taskId=%s', taskId);
    const transcriptionUrl = await this.waitForResult(taskId);
    const transcription = await this.requestJson<DashScopeTranscriptionResult>({
      url: transcriptionUrl,
      method: 'GET',
    });
    const sentences = (transcription.transcripts ?? [])
      .reduce<
        NonNullable<DashScopeTranscriptionResult['transcripts']>[number]['sentences']
      >((items, transcript) => items.concat(transcript.sentences ?? []), [])
      .map(item => ({
        beginMs: Math.max(0, Math.round(Number(item.begin_time) || 0)),
        endMs: Math.max(0, Math.round(Number(item.end_time) || 0)),
        text: item.text?.trim() || '',
        speakerId:
          item.speaker_id === undefined || item.speaker_id === null
            ? '0'
            : String(item.speaker_id),
      }))
      .filter(item => item.endMs > item.beginMs && Boolean(item.text))
      .sort((a, b) => a.beginMs - b.beginMs);

    if (sentences.length === 0) {
      throw new AppError(
        'VOICE_ANALYSIS_NO_SPEECH',
        'voice analysis did not find complete speech',
        422
      );
    }

    return sentences;
  }

  private async waitForResult(taskId: string): Promise<string> {
    const deadline = Date.now() + this.timeoutMs;

    while (Date.now() < deadline) {
      const response = await this.requestJson<DashScopeTaskResponse>({
        url: this.buildApiUrl(`/api/v1/tasks/${encodeURIComponent(taskId)}`),
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.config.apiKey?.trim()}`,
        },
      });
      const status = response.output?.task_status?.toUpperCase();

      if (status === 'SUCCEEDED') {
        const result = response.output?.results?.find(
          item =>
            item.subtask_status?.toUpperCase() === 'SUCCEEDED' &&
            item.transcription_url
        );

        if (!result?.transcription_url) {
          const failed = response.output?.results?.[0];
          throw new AppError(
            failed?.code || 'VOICE_ANALYSIS_RESULT_MISSING',
            failed?.message || 'voice analysis result is missing',
            502,
            response
          );
        }

        return result.transcription_url;
      }

      if (status && status !== 'PENDING' && status !== 'RUNNING') {
        throw new AppError(
          response.code || 'VOICE_ANALYSIS_TASK_FAILED',
          response.message || `voice analysis task failed: ${status}`,
          502,
          response
        );
      }

      await this.sleep(this.pollIntervalMs);
    }

    throw new AppError(
      'VOICE_ANALYSIS_TIMEOUT',
      'voice analysis timed out',
      504
    );
  }

  private async requestJson<T>(input: {
    url: string;
    method: 'GET' | 'POST';
    headers?: Record<string, string>;
    body?: Buffer;
  }): Promise<T> {
    const url = new URL(input.url);
    const requester = url.protocol === 'http:' ? httpRequest : httpsRequest;

    return new Promise<T>((resolve, reject) => {
      const req = requester(
        url,
        {
          method: input.method,
          timeout: Math.min(this.timeoutMs, 60000),
          headers: {
            Accept: 'application/json',
            ...(input.body
              ? { 'Content-Length': String(input.body.length) }
              : {}),
            ...input.headers,
          },
        },
        res => {
          const chunks: Buffer[] = [];
          res.on('data', chunk => chunks.push(Buffer.from(chunk)));
          res.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8');

            if ((res.statusCode || 0) < 200 || (res.statusCode || 0) >= 300) {
              const providerError = this.parseJsonRecord(raw);
              reject(
                new AppError(
                  this.readText(providerError?.code) ||
                    'VOICE_ANALYSIS_HTTP_ERROR',
                  this.readText(providerError?.message) ||
                    raw ||
                    `voice analysis http status ${res.statusCode || 0}`,
                  502,
                  {
                    ...(providerError ?? {}),
                    httpStatus: res.statusCode || 0,
                  }
                )
              );
              return;
            }

            try {
              resolve(JSON.parse(raw) as T);
            } catch {
              reject(
                new AppError(
                  'VOICE_ANALYSIS_INVALID_RESPONSE',
                  'voice analysis response is not valid JSON',
                  502
                )
              );
            }
          });
        }
      );
      req.on('timeout', () => req.destroy(new Error('voice analysis timeout')));
      req.on('error', error =>
        reject(
          new AppError('VOICE_ANALYSIS_REQUEST_FAILED', error.message, 502)
        )
      );

      if (input.body) {
        req.write(input.body);
      }
      req.end();
    });
  }

  private ensureEnabled(): void {
    if (!this.isEnabled()) {
      throw new AppError(
        'VOICE_ANALYSIS_DISABLED',
        'voice analysis service is not configured',
        503
      );
    }
  }

  private parseJsonRecord(raw: string): Record<string, unknown> | undefined {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : undefined;
    } catch {
      return undefined;
    }
  }

  private readText(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private buildApiUrl(path: string): string {
    const baseURL =
      this.config?.baseURL?.trim() || 'https://dashscope.aliyuncs.com';

    return new URL(path, `${baseURL.replace(/\/+$/, '')}/`).toString();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private get timeoutMs(): number {
    const value = Number(this.config?.timeoutMs);
    return Number.isInteger(value) && value > 0 ? value : 240000;
  }

  private get pollIntervalMs(): number {
    const value = Number(this.config?.pollIntervalMs);
    return Number.isInteger(value) && value >= 500 ? value : 2000;
  }
}
