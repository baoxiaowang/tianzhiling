import { Inject } from '@midwayjs/core';
import { IProcessor, Processor } from '@midwayjs/bullmq';
import type { Job } from 'bullmq';
import {
  VOICE_SERVICE_TRAINING_QUEUE,
  VoiceServiceService,
  type VoiceServiceTrainingJobData,
} from '../service/voice-service.service';

@Processor(VOICE_SERVICE_TRAINING_QUEUE)
export class VoiceServiceTrainingProcessor implements IProcessor {
  @Inject()
  voiceServiceService: VoiceServiceService;

  async execute(data: VoiceServiceTrainingJobData, job?: Job): Promise<void> {
    const attempts = Number(job?.opts?.attempts ?? 1);
    const attemptsMade = Number(job?.attemptsMade ?? 0);

    await this.voiceServiceService.processTrainingJob(data, {
      isFinalAttempt: attemptsMade + 1 >= Math.max(1, attempts),
      jobId: this.stringifyJobId(job?.id),
      workerAttempt: attemptsMade + 1,
    });
  }

  private stringifyJobId(jobId: string | number | undefined): string {
    return jobId === undefined ? '' : String(jobId);
  }
}
