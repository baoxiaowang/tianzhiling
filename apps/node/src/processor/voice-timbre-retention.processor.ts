import { Inject } from '@midwayjs/core';
import { IProcessor, Processor } from '@midwayjs/bullmq';
import {
  VOICE_TIMBRE_RETENTION_QUEUE,
  VoiceTimbreLibraryService,
} from '../service/voice-timbre-library.service';

@Processor(VOICE_TIMBRE_RETENTION_QUEUE)
export class VoiceTimbreRetentionProcessor implements IProcessor {
  @Inject()
  voiceTimbreLibraryService: VoiceTimbreLibraryService;

  async execute(): Promise<void> {
    await this.voiceTimbreLibraryService.processRetentionMaintenance();
  }
}
