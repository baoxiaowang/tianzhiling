import { Body, Controller, Inject, Post } from '@midwayjs/core';
import { AdminVoiceClippingDTO } from '../dto/admin-voice-clipping.dto';
import { AdminVoiceClippingService } from '../service/admin-voice-clipping.service';

@Controller('/voice-clipping')
export class AdminVoiceClippingController {
  @Inject()
  adminVoiceClippingService: AdminVoiceClippingService;

  @Post('/')
  async clip(@Body() body: AdminVoiceClippingDTO) {
    return this.adminVoiceClippingService.createClips(body);
  }

  @Post('/recut')
  async recut(@Body() body: Record<string, unknown>) {
    return this.adminVoiceClippingService.recutClip(body);
  }
}
