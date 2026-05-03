import { Inject } from '@midwayjs/core';
import { IProcessor, Processor } from '@midwayjs/bullmq';
import {
  AdminVoiceTimbreService,
  VOICE_TIMBRE_CREATE_QUEUE,
  VoiceTimbreCreateJobData,
} from '../service/admin-voice-timbre.service';

@Processor(VOICE_TIMBRE_CREATE_QUEUE)
export class VoiceTimbreCreateProcessor implements IProcessor {
  @Inject()
  adminVoiceTimbreService: AdminVoiceTimbreService;

  async execute(data: VoiceTimbreCreateJobData): Promise<void> {
    await this.adminVoiceTimbreService.processCreateVoiceTimbreJob(data);
  }
}
