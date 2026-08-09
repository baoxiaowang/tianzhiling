import {
  Body,
  Controller,
  Del,
  Get,
  Inject,
  Param,
  Patch,
  Post,
} from '@midwayjs/core';
import { Context } from '@midwayjs/koa';
import { AppError } from '../common/errors';
import {
  AddVoiceServiceMaterialsBodyDTO,
  GenerateUserVoiceTimbreSpeechBodyDTO,
  RecutVoiceServiceClipBodyDTO,
  ReviewVoiceServiceClipBodyDTO,
  SelectAgentVoiceTimbreBodyDTO,
  SelectVoiceServiceAgentBodyDTO,
  SendVoiceServiceMessageBodyDTO,
  StartVoiceServiceTrainingBodyDTO,
  SubmitVoiceServiceMaterialsBodyDTO,
  UpdateUserVoiceTimbreBodyDTO,
} from '../dto/voice-service.dto';
import { AuthenticatedUserPayload } from '../interface';
import { VoiceServiceService } from '../service/voice-service.service';
import { VoiceTimbreLibraryService } from '../service/voice-timbre-library.service';

@Controller('/voice-services')
export class VoiceServiceController {
  @Inject()
  voiceServiceService: VoiceServiceService;

  @Inject()
  voiceTimbreLibraryService: VoiceTimbreLibraryService;

  @Inject()
  ctx: Context;

  @Get('/current')
  async getCurrentSession() {
    return {
      session: await this.voiceServiceService.getCurrentSession(
        this.requireAuth()
      ),
    };
  }

  @Post('/start')
  async startSession() {
    return this.voiceServiceService.startSession(this.requireAuth());
  }

  @Get('/timbres')
  async getVoiceTimbres() {
    return this.voiceTimbreLibraryService.getLibrary(this.requireAuth());
  }

  @Get('/timbres/:timbreId')
  async getVoiceTimbre(@Param('timbreId') timbreId: string) {
    return this.voiceTimbreLibraryService.getDetail(
      this.requireAuth(),
      timbreId
    );
  }

  @Patch('/timbres/:timbreId')
  async updateVoiceTimbre(
    @Param('timbreId') timbreId: string,
    @Body() body: UpdateUserVoiceTimbreBodyDTO
  ) {
    return this.voiceTimbreLibraryService.updateTimbre(
      this.requireAuth(),
      timbreId,
      body
    );
  }

  @Post('/timbres/:timbreId/speech')
  async generateVoiceTimbreSpeech(
    @Param('timbreId') timbreId: string,
    @Body() body: GenerateUserVoiceTimbreSpeechBodyDTO
  ) {
    return this.voiceTimbreLibraryService.generateSpeech(
      this.requireAuth(),
      timbreId,
      body
    );
  }

  @Del('/timbres/:timbreId')
  async deleteVoiceTimbre(@Param('timbreId') timbreId: string) {
    return this.voiceTimbreLibraryService.deleteTimbre(
      this.requireAuth(),
      timbreId
    );
  }

  @Get('/agents/:agentId/timbres')
  async getAgentVoiceModelCenter(@Param('agentId') agentId: string) {
    return this.voiceTimbreLibraryService.getAgentVoiceModelCenter(
      this.requireAuth(),
      agentId
    );
  }

  @Patch('/agents/:agentId/timbre')
  async selectAgentVoiceTimbre(
    @Param('agentId') agentId: string,
    @Body() body: SelectAgentVoiceTimbreBodyDTO
  ) {
    return this.voiceTimbreLibraryService.selectAgentVoiceTimbre(
      this.requireAuth(),
      agentId,
      body
    );
  }

  @Post('/materials')
  async addMaterials(@Body() body: AddVoiceServiceMaterialsBodyDTO) {
    return this.voiceServiceService.addMaterials(this.requireAuth(), body);
  }

  @Post('/:sessionId/submit')
  async submitMaterials(
    @Param('sessionId') sessionId: string,
    @Body() body: SubmitVoiceServiceMaterialsBodyDTO
  ) {
    return this.voiceServiceService.submitMaterials(
      this.requireAuth(),
      sessionId,
      body
    );
  }

  @Post('/:sessionId/back-to-materials')
  async returnToMaterials(@Param('sessionId') sessionId: string) {
    return this.voiceServiceService.returnToMaterials(
      this.requireAuth(),
      sessionId
    );
  }

  @Post('/:sessionId/back-to-review')
  async returnToReview(@Param('sessionId') sessionId: string) {
    return this.voiceServiceService.returnToReview(
      this.requireAuth(),
      sessionId
    );
  }

  @Del('/:sessionId/materials/:materialId')
  async removeMaterial(
    @Param('sessionId') sessionId: string,
    @Param('materialId') materialId: string
  ) {
    return this.voiceServiceService.removeMaterial(
      this.requireAuth(),
      sessionId,
      materialId
    );
  }

  @Del('/:sessionId/data')
  async deleteVoiceData(@Param('sessionId') sessionId: string) {
    return this.voiceServiceService.deleteVoiceData(
      this.requireAuth(),
      sessionId
    );
  }

  @Post('/messages')
  async sendFirstMessage(@Body() body: SendVoiceServiceMessageBodyDTO) {
    return this.voiceServiceService.sendMessage(
      this.requireAuth(),
      undefined,
      body
    );
  }

  @Post('/:sessionId/messages')
  async sendMessage(
    @Param('sessionId') sessionId: string,
    @Body() body: SendVoiceServiceMessageBodyDTO
  ) {
    return this.voiceServiceService.sendMessage(
      this.requireAuth(),
      sessionId,
      body
    );
  }

  @Patch('/:sessionId/clips/:clipId')
  async reviewClip(
    @Param('sessionId') sessionId: string,
    @Param('clipId') clipId: string,
    @Body() body: ReviewVoiceServiceClipBodyDTO
  ) {
    return this.voiceServiceService.reviewClip(
      this.requireAuth(),
      sessionId,
      clipId,
      body
    );
  }

  @Post('/:sessionId/clips/:clipId/recut')
  async recutClip(
    @Param('sessionId') sessionId: string,
    @Param('clipId') clipId: string,
    @Body() body: RecutVoiceServiceClipBodyDTO
  ) {
    return this.voiceServiceService.requestClipRecut(
      this.requireAuth(),
      sessionId,
      clipId,
      body
    );
  }

  @Post('/:sessionId/train')
  async startTraining(
    @Param('sessionId') sessionId: string,
    @Body() body: StartVoiceServiceTrainingBodyDTO
  ) {
    return this.voiceServiceService.startTraining(
      this.requireAuth(),
      sessionId,
      body
    );
  }

  @Patch('/:sessionId/agent')
  async selectAgent(
    @Param('sessionId') sessionId: string,
    @Body() body: SelectVoiceServiceAgentBodyDTO
  ) {
    return this.voiceServiceService.selectAgent(
      this.requireAuth(),
      sessionId,
      body
    );
  }

  private requireAuth(): AuthenticatedUserPayload {
    const auth = this.ctx.state.auth as AuthenticatedUserPayload | undefined;

    if (!auth?.sub) {
      throw new AppError('UNAUTHORIZED', 'authorization is required', 401);
    }

    return auth;
  }
}
