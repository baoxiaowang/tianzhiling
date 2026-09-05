import { Config, Inject, Logger, Provide } from '@midwayjs/core';
import type { ILogger } from '@midwayjs/logger';
import { AppError } from '@tzl/shared';
import { request as httpRequest } from 'http';
import { request as httpsRequest } from 'https';
import { extname } from 'path';
import { URL } from 'url';
import { AdminStorageFileService } from './admin-storage-file.service';

interface VoiceTimbreAnalysisConfig {
  enabled?: boolean;
  apiKey?: string;
  baseURL?: string;
  model?: string;
  timeoutMs?: number;
}

interface QwenOmniResponse {
  id?: string;
  request_id?: string;
  choices?: Array<{
    message?: {
      content?: string | Array<{ text?: string }>;
    };
    delta?: {
      content?: string | Array<{ text?: string }>;
    };
  }>;
  code?: string;
  message?: string;
}

const ALLOWED_AUDIO_PREFIXES = [
  'voice-service-clips/',
  'voice-timbres/',
  'voice-training-ready/',
  'voice-timbre-merged/',
];

@Provide()
export class AdminVoiceTimbreAnalysisService {
  @Logger()
  logger: ILogger;

  @Config('voiceTimbreAnalysis')
  config: VoiceTimbreAnalysisConfig;

  @Inject()
  storageFileService: AdminStorageFileService;

  async analyze(input: {
    objectKeys: string[];
    transcripts?: string[];
  }): Promise<{
    description: string;
    instruction: string;
    model: string;
    requestId?: string;
  }> {
    this.ensureEnabled();
    const objectKeys = [...new Set(input.objectKeys.map(item => item.trim()))]
      .filter(Boolean)
      .slice(0, 8);
    if (!objectKeys.length) {
      throw new AppError(
        'VOICE_TIMBRE_ANALYSIS_AUDIO_MISSING',
        'at least one audio clip is required',
        400
      );
    }
    const audioItems = objectKeys.map(objectKey => {
      if (
        objectKey.includes('..') ||
        !ALLOWED_AUDIO_PREFIXES.some(prefix => objectKey.startsWith(prefix))
      ) {
        throw new AppError(
          'VOICE_TIMBRE_ANALYSIS_AUDIO_INVALID',
          'voice timbre analysis audio is invalid',
          400
        );
      }
      return {
        type: 'input_audio',
        input_audio: {
          data: this.storageFileService.resolve(objectKey),
          format: this.audioFormat(objectKey),
        },
      };
    });
    const transcripts = (input.transcripts ?? [])
      .map(item => item?.trim())
      .filter(Boolean)
      .slice(0, 8);
    const model = this.config?.model?.trim() || 'qwen3.5-omni-plus';
    const prompt = [
      '请综合分析以下同一说话人的声音片段，生成可供音色训练人员确认的中文音色描述。',
      '只描述能够从声音听出的稳定特征，例如音高听感、音质、语速、节奏、发音、口音倾向、情绪基调和表达力度。',
      '区分稳定音色与片段当下状态；不要断言真实性别、确切年龄、身份、健康状况或人格。',
      '不要复述语音内容，不要评价语句是否完整或时长是否合适。',
      '同时把上述稳定特征改写为一条可直接交给语音合成模型执行的中文声音效果指令，不要包含身份判断，不要要求改变为另一个人的声音。',
      '输出严格 JSON，格式为 {"description":"40到120字的自然中文描述","instruction":"10到40字、以动作要求表述的声音效果指令"}，不要输出其他内容。',
      transcripts.length ? `参考转写：${transcripts.join('；')}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    const response = await this.requestJson<QwenOmniResponse>({
      model,
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: prompt }, ...audioItems],
        },
      ],
      modalities: ['text'],
      stream: true,
      stream_options: { include_usage: true },
      enable_thinking: false,
      temperature: 0.2,
    });
    const analysis = this.parseAnalysis(
      response.choices?.[0]?.message?.content
    );
    if (!analysis.description) {
      throw new AppError(
        'VOICE_TIMBRE_ANALYSIS_EMPTY',
        'voice timbre analysis returned an empty description',
        502
      );
    }
    this.logger.info(
      '[admin-voice-timbre-analysis] completed, model=%s, clipCount=%s, requestId=%s',
      model,
      objectKeys.length,
      response.request_id || response.id || ''
    );
    return {
      description: analysis.description,
      instruction: analysis.instruction,
      model,
      requestId: response.request_id || response.id || undefined,
    };
  }

  private ensureEnabled(): void {
    if (this.config?.enabled === false) {
      throw new AppError(
        'VOICE_TIMBRE_ANALYSIS_DISABLED',
        'voice timbre analysis is disabled',
        400
      );
    }
    if (!this.config?.apiKey?.trim()) {
      throw new AppError(
        'VOICE_TIMBRE_ANALYSIS_API_KEY_MISSING',
        'voice timbre analysis api key is missing',
        500
      );
    }
  }

  private audioFormat(objectKey: string): string {
    const extension = extname(objectKey).slice(1).toLowerCase();
    return ['mp3', 'wav', 'aac', 'm4a', 'flac', 'ogg'].includes(extension)
      ? extension
      : 'wav';
  }

  private parseAnalysis(content?: string | Array<{ text?: string }>): {
    description: string;
    instruction: string;
  } {
    const raw = Array.isArray(content)
      ? content.map(item => item.text || '').join('')
      : content || '';
    const normalized = raw.trim().replace(/^```(?:json)?\s*|\s*```$/gi, '');
    try {
      const parsed = JSON.parse(normalized) as {
        description?: unknown;
        instruction?: unknown;
      };
      const description =
        typeof parsed.description === 'string'
          ? parsed.description.trim().slice(0, 500)
          : '';
      const instruction =
        typeof parsed.instruction === 'string'
          ? parsed.instruction.trim().slice(0, 50)
          : this.buildFallbackInstruction(description);
      return { description, instruction };
    } catch {
      const description = normalized.slice(0, 500);
      return {
        description,
        instruction: this.buildFallbackInstruction(description),
      };
    }
  }

  private buildFallbackInstruction(description: string): string {
    const normalized = description.trim().replace(/[。；;，,\s]+$/g, '');
    return normalized ? `请保持${normalized}`.slice(0, 50) : '';
  }

  private parseCompletionResponse(raw: string): QwenOmniResponse {
    if (raw.trim().startsWith('{')) {
      return JSON.parse(raw) as QwenOmniResponse;
    }
    return raw
      .split(/\r?\n/)
      .filter(line => line.startsWith('data:'))
      .reduce<QwenOmniResponse>((result, line) => {
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') return result;
        const chunk = JSON.parse(data) as QwenOmniResponse;
        const content = chunk.choices?.[0]?.delta?.content;
        const text = Array.isArray(content)
          ? content.map(item => item.text || '').join('')
          : content || '';
        return {
          ...result,
          id: result.id || chunk.id,
          request_id: result.request_id || chunk.request_id,
          code: chunk.code || result.code,
          message: chunk.message || result.message,
          choices: [
            {
              message: {
                content: `${
                  result.choices?.[0]?.message?.content || ''
                }${text}`,
              },
            },
          ],
        };
      }, {});
  }

  private async requestJson<T>(body: Record<string, unknown>): Promise<T> {
    const baseURL = (
      this.config?.baseURL?.trim() ||
      'https://dashscope.aliyuncs.com/compatible-mode/v1'
    ).replace(/\/$/, '');
    const endpoint = baseURL.endsWith('/chat/completions')
      ? baseURL
      : baseURL.endsWith('/compatible-mode/v1')
      ? `${baseURL}/chat/completions`
      : `${baseURL}/compatible-mode/v1/chat/completions`;
    const url = new URL(endpoint);
    const requester = url.protocol === 'http:' ? httpRequest : httpsRequest;
    const payload = Buffer.from(JSON.stringify(body));

    return new Promise<T>((resolve, reject) => {
      const req = requester(
        url,
        {
          method: 'POST',
          timeout: this.config?.timeoutMs || 120000,
          headers: {
            Authorization: `Bearer ${this.config.apiKey?.trim()}`,
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'Content-Length': String(payload.length),
          },
        },
        res => {
          const chunks: Buffer[] = [];
          res.on('data', chunk => chunks.push(Buffer.from(chunk)));
          res.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8');
            if (
              !res.statusCode ||
              res.statusCode < 200 ||
              res.statusCode >= 300
            ) {
              reject(
                new AppError(
                  'VOICE_TIMBRE_ANALYSIS_HTTP_ERROR',
                  raw || `voice timbre analysis http status ${res.statusCode}`,
                  502
                )
              );
              return;
            }
            try {
              const parsed = this.parseCompletionResponse(raw);
              if (parsed.code || (parsed.message && !parsed.choices?.length)) {
                reject(
                  new AppError(
                    parsed.code || 'VOICE_TIMBRE_ANALYSIS_FAILED',
                    parsed.message || 'voice timbre analysis failed',
                    502
                  )
                );
                return;
              }
              resolve(parsed as T);
            } catch {
              reject(
                new AppError(
                  'VOICE_TIMBRE_ANALYSIS_INVALID_RESPONSE',
                  'voice timbre analysis response is not valid JSON',
                  502
                )
              );
            }
          });
        }
      );
      req.on('timeout', () =>
        req.destroy(new Error('voice timbre analysis request timeout'))
      );
      req.on('error', error => {
        reject(
          error instanceof AppError
            ? error
            : new AppError('VOICE_TIMBRE_ANALYSIS_FAILED', error.message, 502)
        );
      });
      req.write(payload);
      req.end();
    });
  }
}
