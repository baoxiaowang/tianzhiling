import { Inject } from '@midwayjs/core';
import { IProcessor, Processor } from '@midwayjs/bullmq';
import type { Job } from 'bullmq';
import {
  VOICE_SERVICE_CLIPPING_QUEUE,
  VoiceServiceClippingJobData,
  VoiceServiceService,
} from '../service/voice-service.service';

@Processor(VOICE_SERVICE_CLIPPING_QUEUE)
export class VoiceServiceClippingProcessor implements IProcessor {
  @Inject()
  voiceServiceService: VoiceServiceService;

  async execute(data: VoiceServiceClippingJobData, job?: Job): Promise<void> {
    const attempts = Number(job?.opts?.attempts ?? 1);
    const attemptsMade = Number(job?.attemptsMade ?? 0);

    const options = {
      isFinalAttempt: attemptsMade + 1 >= Math.max(1, attempts),
      jobId: this.stringifyJobId(job?.id),
      workerAttempt: attemptsMade + 1,
    };

    if (data.jobType === 'clip_recut') {
      await this.voiceServiceService.processClipRecutJob(data, options);
      return;
    }

    await this.voiceServiceService.processClippingJob(data, options);
  }

  private stringifyJobId(jobId: string | number | undefined): string {
    return jobId === undefined ? '' : String(jobId);
  }
}
