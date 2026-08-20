import { Inject, Logger, Provide } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { ChatTraceStage } from '@tzl/entities';
import { OpenAIService } from './openai';
import {
  RecognitionJourney,
  RecognitionJourneyObservation,
  RecognitionJourneyTurnPlan,
} from './recognition-journey';

const OBSERVER_MAX_TOKENS = 220;
const OBSERVER_TIMEOUT_MS = 8000;

export interface RecognitionJourneyObserverResult {
  status: 'observed' | 'unavailable';
  observation?: RecognitionJourneyObservation;
  usage?: {
    model?: string;
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

/**
 * A post-generation state observer. It never plans, rewrites, blocks, or scores
 * the visible reply. Its only consumer is the durable recognition journey.
 */
@Provide()
export class RecognitionJourneyObserverService {
  @Inject()
  openAIService: OpenAIService;

  @Logger()
  logger: ILogger;

  async observe(options: {
    journey: RecognitionJourney;
    plan: RecognitionJourneyTurnPlan;
    currentUserText: string;
    assistantText: string;
  }): Promise<RecognitionJourneyObserverResult> {
    if (!this.openAIService || !this.shouldObserve(options)) {
      return { status: 'unavailable' };
    }

    try {
      const response = await this.openAIService.createChatCompletion(
        {
          temperature: 0,
          topP: 0.2,
          reasoningSplit: false,
          thinking: { type: 'disabled' },
          max_tokens: OBSERVER_MAX_TOKENS,
          response_format: { type: 'json_object' },
          trace: {
            stage: ChatTraceStage.review,
            operation: 'review.recognition_journey_observer',
          },
          messages: [
            {
              role: 'system',
              content: [
                '# 相认旅程状态观察',
                '你只观察已经发生的对话，不评价好坏，不设计下轮策略，不改写回复。',
                '“哎，闺女”“我也想你”“我在听”“是爸爸”只是身份或浅层情绪回应，不算打开相认。',
                '只有助手表达了跨越生死后重新联系、时间错位或未说完的爱与舍不得，并且主动带来了超过同义复述的角色情感，才是 emotionally_opened。',
                '当早先已打开重逢，当前用户明确接住这份重逢情绪，或双方已自然进入持续亲人关系，才是 emotionally_received。',
                '用户明确提供家人近况或离世时间/相隔时长是 provided；助手只给出自然说出这类信息的入口是 proposed。不要用关键词替代语义判断。',
                '严格输出 JSON：{"opening":"not_observed|shallow_acknowledgement|emotionally_opened|emotionally_received","familyStatus":"not_observed|proposed|provided","departureInterval":"not_observed|proposed|provided","evidence":"最多80字的观察依据"}',
              ].join('\n'),
            },
            {
              role: 'user',
              content: JSON.stringify({
                journeyState: {
                  opening: options.journey.opening.status,
                  familyStatus: options.journey.tasks.find(
                    item => item.id === 'family_status'
                  )?.status,
                  departureInterval: options.journey.tasks.find(
                    item => item.id === 'departure_interval'
                  )?.status,
                },
                suggestedThisTurn: {
                  opening: options.plan.openingSuggested,
                  task: options.plan.suggestedTaskId,
                },
                currentUserMessage: options.currentUserText.slice(0, 500),
                finalAssistantReply: options.assistantText.slice(0, 800),
              }),
            },
          ],
        },
        { timeout: OBSERVER_TIMEOUT_MS }
      );
      const content = response.choices?.[0]?.message?.content;
      const observation = parseObservation(
        typeof content === 'string' ? content : ''
      );
      if (!observation) return { status: 'unavailable' };
      return {
        status: 'observed',
        observation,
        usage: {
          model: response.model,
          promptTokens: response.usage?.prompt_tokens,
          completionTokens: response.usage?.completion_tokens,
          totalTokens: response.usage?.total_tokens,
        },
      };
    } catch (error) {
      this.logger?.warn?.(
        '[recognition-journey] semantic observation unavailable: %s',
        error instanceof Error ? error.message : String(error)
      );
      return { status: 'unavailable' };
    }
  }

  private shouldObserve(options: {
    journey: RecognitionJourney;
    plan: RecognitionJourneyTurnPlan;
  }): boolean {
    if (options.plan.userTurnNumber && options.plan.userTurnNumber > 20) {
      return false;
    }
    return (
      options.journey.opening.status === 'pending' ||
      options.journey.opening.status === 'emotionally_opened' ||
      options.journey.tasks.some(task =>
        ['pending', 'proposed'].includes(task.status)
      )
    );
  }
}

function parseObservation(
  content: string
): RecognitionJourneyObservation | undefined {
  try {
    const raw = JSON.parse(content.trim()) as Record<string, unknown>;
    const opening = String(raw.opening);
    const familyStatus = String(raw.familyStatus);
    const departureInterval = String(raw.departureInterval);
    if (
      ![
        'not_observed',
        'shallow_acknowledgement',
        'emotionally_opened',
        'emotionally_received',
      ].includes(opening) ||
      !['not_observed', 'proposed', 'provided'].includes(familyStatus) ||
      !['not_observed', 'proposed', 'provided'].includes(departureInterval)
    ) {
      return undefined;
    }
    return {
      opening: opening as RecognitionJourneyObservation['opening'],
      familyStatus:
        familyStatus as RecognitionJourneyObservation['familyStatus'],
      departureInterval:
        departureInterval as RecognitionJourneyObservation['departureInterval'],
      ...(typeof raw.evidence === 'string' && raw.evidence
        ? { evidence: raw.evidence.slice(0, 160) }
        : {}),
    };
  } catch {
    return undefined;
  }
}
