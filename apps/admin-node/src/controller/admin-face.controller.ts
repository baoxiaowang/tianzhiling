import { Body, Controller, Get, Inject, Param, Post, Query } from '@midwayjs/core';
import { AdminFaceService } from '../service/admin-face.service';

/**
 * 管理端「家人相册」接口：列出某用户已认识的人、登记/删除人脸模板、识别测试。
 * 识别本身在 node 侧执行（sidecar 只做检测与编码）。
 */
@Controller('/face')
export class AdminFaceController {
  @Inject()
  adminFaceService: AdminFaceService;

  @Get('/persons')
  async persons(@Query() query: Record<string, string>) {
    return this.adminFaceService.listPersons(query?.userId || '');
  }

  @Post('/persons/:personId/faces')
  async registerFaces(
    @Param('personId') personId: string,
    @Body()
    body: { userId: string; objectKeys?: string[]; imageBase64s?: string[] }
  ) {
    return this.adminFaceService.registerFaces({
      userId: body?.userId,
      personId,
      objectKeys: body?.objectKeys,
      imageBase64s: body?.imageBase64s,
    });
  }

  @Post('/persons/:personId/merge')
  async merge(
    @Param('personId') personId: string,
    @Body() body: { userId: string; targetPersonId: string }
  ) {
    return this.adminFaceService.mergePersons({
      userId: body?.userId,
      sourcePersonId: personId,
      targetPersonId: body?.targetPersonId,
    });
  }

  @Post('/persons/:personId/faces/delete')
  async deleteFaces(
    @Param('personId') personId: string,
    @Body() body: { userId: string }
  ) {
    return this.adminFaceService.deleteFaces({
      userId: body?.userId,
      personId,
    });
  }

  @Get('/consent')
  async consent(@Query() query: Record<string, string>) {
    return this.adminFaceService.consentStatus(query?.userId || '');
  }

  @Post('/consent')
  async setConsent(@Body() body: { userId: string; granted: boolean }) {
    return this.adminFaceService.setConsent({
      userId: body?.userId,
      granted: body?.granted === true,
      source: 'admin',
    });
  }

  @Post('/recognize')
  async recognize(
    @Body()
    body: {
      userId: string;
      agentId?: string;
      objectKey?: string;
      imageBase64?: string;
    }
  ) {
    return this.adminFaceService.recognize(body);
  }
}
