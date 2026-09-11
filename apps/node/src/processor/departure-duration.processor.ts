import { Inject, Logger } from '@midwayjs/core';
import { ILogger } from '@midwayjs/logger';
import { IProcessor } from '@midwayjs/bullmq';
import { DepartureDurationService, DEPARTURE_DURATION_QUEUE } from '../service/agents/departure-duration.service';
import { RuntimeProcessor } from './runtime-processor';

export interface DepartureDurationJobData {
  type: 'daily' | 'monthly' | 'single';
  agentId?: string;
}

@RuntimeProcessor(DEPARTURE_DURATION_QUEUE, undefined, {
  concurrency: 1,
})
export class DepartureDurationProcessor implements IProcessor {
  @Logger()
  logger: ILogger;

  @Inject()
  departureDurationService: DepartureDurationService;

  async execute(data: DepartureDurationJobData): Promise<void> {
    try {
      if (data?.type === 'single' && data.agentId) {
        await this.departureDurationService.computeForAgent(data.agentId);
        return;
      }

      if (data?.type === 'monthly') {
        const result = await this.departureDurationService.computeForAll();
        this.logger.info(
          '[departure-duration] monthly job completed, computed=%d, skipped=%d, durationMs=%d',
          result.computed,
          result.skipped,
          result.durationMs
        );
        return;
      }

      // 默认 daily
      const result = await this.departureDurationService.computeForActiveUsers();
      this.logger.info(
        '[departure-duration] daily job completed, computed=%d, skipped=%d, durationMs=%d',
        result.computed,
        result.skipped,
        result.durationMs
      );
    } catch (error) {
      this.logger.error(
        '[departure-duration] job failed, type=%s, reason=%s',
        data?.type || 'daily',
        error instanceof Error ? error.message : String(error)
      );
      throw error;
    }
  }
}
