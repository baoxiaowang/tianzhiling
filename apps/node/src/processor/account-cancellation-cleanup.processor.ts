import { IProcessor, Processor } from '@midwayjs/bullmq';
import { Inject } from '@midwayjs/core';
import {
  ACCOUNT_CANCELLATION_CLEANUP_QUEUE,
  AccountCancellationCleanupJobData,
  AccountCancellationService,
} from '../service/account-cancellation.service';

@Processor(ACCOUNT_CANCELLATION_CLEANUP_QUEUE)
export class AccountCancellationCleanupProcessor implements IProcessor {
  @Inject()
  accountCancellationService: AccountCancellationService;

  async execute(data: AccountCancellationCleanupJobData): Promise<void> {
    await this.accountCancellationService.processCleanupRetry(data);
  }
}
