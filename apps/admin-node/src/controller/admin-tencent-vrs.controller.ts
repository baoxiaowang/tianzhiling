import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
} from '@midwayjs/core';
import {
  AuditionTencentVrsDTO,
  DetectTencentVrsQualityDTO,
  TrainTencentVrsDTO,
} from '../dto/admin-tencent-vrs.dto';
import { AdminTencentVrsService } from '../service/admin-tencent-vrs.service';

/**
 * 管理员腾讯云声音复刻（一句话版）操作端点。
 * 全部走 /admin_api/tencent-vrs/*，由全局 AdminAuthMiddleware 校验 admin 角色。
 * 凭证只在服务端，前端绝不接触 SecretId/SecretKey。
 */
@Controller('/tencent-vrs')
export class AdminTencentVrsController {
  @Inject()
  adminTencentVrsService: AdminTencentVrsService;

  /** 获取指定训练文案（TextId + Text + 性别提示 + 录音要求）。 */
  @Get('/training-text')
  async getTrainingText() {
    return this.adminTencentVrsService.getTrainingText();
  }

  /** 音质检测：传入 COS audioKey + textId，服务端拉取→归一化→调用腾讯云检测。 */
  @Post('/detect-quality')
  async detectQuality(@Body() body: DetectTencentVrsQualityDTO) {
    return this.adminTencentVrsService.detectQuality({
      audioKey: body.audioKey,
      textId: body.textId,
    });
  }

  /** 创建训练任务：调用 CreateVRSTask 并在本地落 VoiceTimbreEntity。 */
  @Post('/train')
  async train(@Body() body: TrainTencentVrsDTO) {
    return this.adminTencentVrsService.train({
      audioId: body.audioId,
      voiceName: body.voiceName,
      voiceGender: body.voiceGender,
      textId: body.textId,
      userId: body.userId,
      audioKey: body.audioKey,
      voiceDescription: body.voiceDescription,
      remark: body.remark,
    });
  }

  /** 查询训练状态（带并发锁，避免重复付费试听）。 */
  @Get('/timbres/:timbreId/status')
  async getTrainStatus(@Param('timbreId') timbreId: string) {
    return this.adminTencentVrsService.getTrainStatus(timbreId);
  }

  /** 列出色音（GetVRSVoiceTypes，限频）。 */
  @Get('/voices')
  async listVoices() {
    return this.adminTencentVrsService.listVoices();
  }

  /** 试听合成：传入 timbreId + text，返回合成音频 URL。 */
  @Post('/audition')
  async audition(@Body() body: AuditionTencentVrsDTO) {
    return this.adminTencentVrsService.audition({
      timbreId: body.timbreId,
      text: body.text,
    });
  }
}
