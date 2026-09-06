import { Inject } from '@midwayjs/core';
import { IProcessor } from '@midwayjs/bullmq';
import {
  VOICE_TIMBRE_RETENTION_QUEUE,
  VoiceTimbreLibraryService,
} from '../service/voice-timbre-library.service';
import { RuntimeProcessor } from './runtime-processor';

@RuntimeProcessor(VOICE_TIMBRE_RETENTION_QUEUE)
export class VoiceTimbreRetentionProcessor implements IProcessor {
  @Inject()
  voiceTimbreLibraryService: VoiceTimbreLibraryService;

  async execute(): Promise<void> {
    await this.voiceTimbreLibraryService.processRetentionMaintenance();
  }
}
