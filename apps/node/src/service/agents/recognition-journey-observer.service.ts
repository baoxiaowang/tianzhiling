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
    openingAssistantText?: string;
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
                '只观察系统给出的当前检查点。没有检查点时不应调用你。',
                '“哎，闺女”“我也想你”“我在听”“是爸爸”只是身份或浅层情绪回应，不算打开相认。',
                '只有助手表达了跨越生死后重新联系、时间错位或未说完的爱与舍不得，并且主动带来了超过同义复述的角色情感，才是 emotionally_opened。',
                'emotionally_received 必须同时看到：实际相认开场、开场后的用户回应、随后亲人继续承接；只凭普通安慰或“奶奶记着你”不能成立。',
                '助手自行编造的小时候、老宅、饭菜、睡觉习惯等共同往事既不能作为相认证据，也不能证明用户接住了相认。',
                '在 task_proposal 检查点，只判断最终回复实际带出了哪个候选信息入口；程序给了候选但助手没问，必须是 not_observed。',
                '在 task_response 检查点，以及 task_proposal 中标记的 observedTasks，只判断用户是否确实提供了对应信息。老宅拆除、房产争议等无关信息不等于“家人近况”。',
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
                  checkpoint: options.plan.observerCheckpoint,
                  opening: options.plan.openingSuggested,
                  task: options.plan.suggestedTaskId,
                  eligibleTasks: options.plan.eligibleTaskIds,
                  observedTask: options.plan.observedTaskId,
                  observedTasks: options.plan.observedTaskIds,
                },
                openingAssistantMessage: (
                  options.openingAssistantText || ''
                ).slice(0, 800),
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
    if (!options.plan.observerCheckpoint) return false;
    if (options.plan.observerCheckpoint === 'task_response') return true;
    return !options.plan.userTurnNumber || options.plan.userTurnNumber <= 20;
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
